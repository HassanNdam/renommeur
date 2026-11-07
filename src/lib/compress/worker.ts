/*
 * Compression d'une image hors du fil principal, un travail à la fois par worker.
 * Entrée : le File d'origine (cloné par référence, aucun octet copié) et les options.
 * Sortie : un Blob (référence, pas de copie) et ce qu'il faut afficher, ou la raison de ne rien faire.
 * Une image gardée perd quand même ses métadonnées (EXIF, XMP, textes PNG) ; l'orientation reste.
 * Les codecs WASM ne se chargent qu'au premier fichier qui en a besoin.
 */
import { FLAT_RATIO, LOSSLESS_MAX_PIXELS, MAX_PIXELS, MIN_GAIN, NATIVE_JPEG, SMALL_FILE, type JobOptions } from './settings';
import {
  hasTransparency,
  headerSize,
  isAnimated,
  joinParts,
  measurePixels,
  scanJpeg,
  sniff,
  stripJpegMetadata,
  stripPngMetadata,
  stripWebpMetadata,
  webpIsLossless,
  type JpegInfo,
  type Part,
  type Sniffed,
} from './inspect';

export interface Request {
  id: string;
  file: File;
  options: JobOptions;
}

/** Commun à toutes les réponses. */
interface Flags {
  /** Codecs WASM non chargés dans ce worker : encodeurs du navigateur, images moins allégées. */
  natif?: boolean;
  /** Un codec a planté (trap WASM, mémoire épuisée) : son module est inutilisable, le worker est remplacé. */
  fatal?: boolean;
}

export type Reply = Flags &
  (
    | { id: string; press: 'done'; blob: Blob; ext: string; width: number; height: number; srcWidth: number; srcHeight: number; note?: string }
    | { id: string; press: 'same'; blob?: Blob; srcWidth: number; srcHeight: number; note: string }
    | { id: string; press: 'skip' | 'fail'; note: string }
  );

/** Réponse sans l'identifiant (Omit distribué sur l'union). */
type Outcome = Reply extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

// Le fichier est compilé avec la lib DOM du projet : on ne type que ce qu'on utilise du worker.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: Reply): void;
};

/* ---------- Codecs, chargés à la demande ---------- */

const once = <T>(load: () => Promise<T>) => {
  let promise: Promise<T> | undefined;
  return () => (promise ??= load().catch((e) => ((promise = undefined), Promise.reject(e))));
};
// init() de MozJPEG ne rend pas sa promesse : un encodage d'un pixel force le vrai chargement.
const mozjpeg = once(async () => {
  const m = await import('@jsquash/jpeg/encode');
  await m.default({ data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData);
  return m.default;
});
const libwebp = once(async () => {
  const m = await import('@jsquash/webp/encode');
  await m.init();
  return m.default;
});
// Version mono-fil : la version parallèle exige SharedArrayBuffer (COOP/COEP) et contient un new Function.
const oxipng = once(async () => {
  const m = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
  await m.default();
  return m;
});
// Enveloppe MIT autour d'imagequant 4 (GPL v3 ou licence commerciale) : voir la spécification.
const imagequant = once(async () => {
  const m = await import('libimagequant-wasm/wasm/libimagequant_wasm.js');
  await m.default();
  return m;
});
type ImageQuant = Awaited<ReturnType<typeof imagequant>>;
const pngCodecs = () => Promise.all([oxipng(), imagequant()]);

/** Vrai dès qu'un module WASM refuse de se charger (CSP, type MIME, réseau, navigateur) : le reste passe en natif. */
let wasmBroken = false;

/** Plantage d'un codec (trap WASM, abandon Emscripten, mémoire épuisée) : son module en cache a avorté. */
const crashed = (e: unknown) => e instanceof WebAssembly.RuntimeError || e instanceof RangeError;

/** Seul le chargement du codec fait basculer le worker en natif ; une erreur d'encodage remonte telle quelle. */
async function withFallback<C>(load: () => Promise<C>, encode: (codec: C) => ArrayBuffer | Promise<ArrayBuffer>, native: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  if (wasmBroken) return native();
  let codec: C;
  try {
    codec = await load();
  } catch (e) {
    wasmBroken = true;
    console.warn('Codec WASM indisponible, repli sur l’encodeur du navigateur :', e);
    return native();
  }
  return encode(codec);
}

/* ---------- Décodage ---------- */

/**
 * Réduit par moitiés puis finit en qualité « high » : net même là où resizeQuality est ignoré
 * (Firefox avant 149). Ferme la source.
 */
async function shrink(source: ImageBitmap, scale: number): Promise<ImageBitmap> {
  if (scale >= 1) return source;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  let bitmap = source;
  try {
    while (bitmap.width / 2 >= width * 1.5) {
      const half = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width / 2), resizeHeight: Math.round(bitmap.height / 2), resizeQuality: 'high' });
      bitmap.close();
      bitmap = half;
    }
    return await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  } finally {
    bitmap.close();
  }
}

/** Transparence et aplats, mesurés sur une copie au plus proche voisin de 4 Mpx au plus (16 Mo). */
function classify(bitmap: ImageBitmap): { transparent: boolean; flat: boolean } {
  const step = Math.max(1, Math.ceil(Math.sqrt((bitmap.width * bitmap.height) / 4_000_000)));
  const w = Math.max(1, Math.floor(bitmap.width / step));
  const h = Math.max(1, Math.floor(bitmap.height / step));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false; // le plus proche voisin garde les aplats exacts
  ctx.drawImage(bitmap, 0, 0, w, h);
  const acc = measurePixels(ctx.getImageData(0, 0, w, h).data, w);
  return { transparent: acc.transparent, flat: acc.seen > 0 && acc.same >= acc.seen * FLAT_RATIO };
}

function toPixels(bitmap: ImageBitmap): ImageData {
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/* ---------- Encodage ---------- */

async function nativeEncode(image: ImageData, type: string, quality?: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error(`Encodeur ${type} absent de ce navigateur`); // Safari et le WebP
  return blob.arrayBuffer();
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer;

function encodeJpeg(image: ImageData, quality: number) {
  return withFallback(
    mozjpeg,
    // 4:2:0 imposé : en « auto », jSquash passe en 4:2:2 dès q80 et en 4:4:4 dès q90 (+25 à +90 % de poids).
    (encode) => encode(image, { quality, progressive: true, optimize_coding: true, auto_subsample: false, chroma_subsample: 2 }),
    () => nativeEncode(image, 'image/jpeg', NATIVE_JPEG[quality] ?? quality / 100),
  );
}

function encodeWebp(image: ImageData, quality: number, lossless: boolean) {
  return withFallback(
    libwebp,
    (encode) => encode(image, lossless ? { lossless: 1, quality: 75, method: 4 } : { quality, method: 4 }),
    () => nativeEncode(image, 'image/webp', lossless ? 1 : quality / 100),
  );
}

/** Palette de 256 couleurs au plus ; null quand la qualité minimale n'est pas atteinte (QualityTooLow). */
function quantize(liq: ImageQuant, image: ImageData, png: JobOptions['png']): Uint8Array | null {
  const quantizer = new liq.ImageQuantizer();
  try {
    quantizer.setQuality(png.min, png.target);
    quantizer.setSpeed(4);
    quantizer.setMaxColors(256);
    let result;
    try {
      result = quantizer.quantizeImage(image.data, image.width, image.height);
    } catch (e) {
      if (crashed(e)) throw e;
      return null;
    }
    try {
      result.setDithering(1.0);
      const indices = result.getPaletteIndices(image.data, image.width, image.height);
      return liq.encode_palette_to_png(indices, result.getPalette(), image.width, image.height);
    } finally {
      result.free();
    }
  } finally {
    quantizer.free();
  }
}

/** Palette d'abord ; sinon sans perte (oxipng), à partir des octets d'origine quand l'image n'a pas changé. */
function encodePng(image: ImageData, png: JobOptions['png'], original: Uint8Array | null) {
  const small = image.width * image.height <= LOSSLESS_MAX_PIXELS;
  return withFallback(
    pngCodecs,
    ([oxi, liq]) => {
      const palette = quantize(liq, image, png);
      if (palette) return exact(oxi.optimise(palette, 2, false, true));
      if (small && original) {
        try {
          // oxipng garde eXIf, tEXt et iTXt : on les retire avant.
          return exact(oxi.optimise(joinParts(original, stripPngMetadata(original)), 2, false, true));
        } catch (e) {
          if (crashed(e)) throw e;
          // Octets refusés (CRC faux sur un chunk annexe…) : on repart des pixels.
        }
      }
      if (small) return exact(oxi.optimise_raw(image.data, image.width, image.height, 2, false, true));
      return nativeEncode(image, 'image/png'); // trop grand pour oxipng : le garde-fou tranchera
    },
    () => nativeEncode(image, 'image/png'),
  );
}

/* ---------- Travail ---------- */

const LABEL: Record<Sniffed, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', bmp: 'BMP', heic: 'HEIC', tiff: 'TIFF', gif: 'GIF', avif: 'AVIF', svg: 'SVG', other: '' };
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const;
type Target = keyof typeof EXT;

const skip = (note: string): Outcome => ({ press: 'skip', note });
const fail = (note: string): Outcome => ({ press: 'fail', note });

/** Blob fait de tranches du File : il le référence sans recopier ses octets (seuls les octets nouveaux sont copiés). */
const fromParts = (file: File, parts: Part[], type: string) =>
  new Blob(parts.map((p) => (p instanceof Uint8Array ? p : file.slice(p[0], p[1]))) as BlobPart[], { type });

/**
 * Original conservé, sans réencoder : JPEG sans EXIF, XMP, IPTC, MPF, commentaires ni remorque (orientation
 * gardée dans un APP1 minimal) ; PNG sans eXIf, textes ni date ; WebP sans EXIF ni XMP.
 */
function keep(file: File, bytes: Uint8Array, type: Sniffed, jpeg: JpegInfo | null, srcWidth: number, srcHeight: number, note: string): Outcome {
  const parts = jpeg ? stripJpegMetadata(bytes, jpeg.orientation) : type === 'png' ? stripPngMetadata(bytes) : type === 'webp' ? stripWebpMetadata(bytes) : null;
  const blob = parts && fromParts(file, parts, `image/${type}`);
  return { press: 'same', blob: blob && blob.size < file.size ? blob : undefined, srcWidth, srcHeight, note };
}

async function compress({ file, options: o }: Request): Promise<Outcome> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (type === 'gif' || type === 'svg' || type === 'avif') return skip(`${LABEL[type]} conservé tel quel`);
  if (type === 'other') return skip('Format non compressé');
  if (isAnimated(bytes, type)) return skip('Image animée conservée telle quelle');
  const head = headerSize(bytes, type);
  if (head && head.width * head.height > MAX_PIXELS) return fail('Image trop grande pour ce navigateur');
  const jpeg = type === 'jpeg' ? scanJpeg(bytes) : null;

  let bitmap: ImageBitmap;
  try {
    // Applique l'orientation EXIF et convertit en sRGB (Display P3 des iPhone compris).
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
  } catch {
    return fail(type === 'heic' || type === 'tiff' ? `${LABEL[type]} non lu par ce navigateur` : 'Image illisible par ce navigateur');
  }
  const srcWidth = bitmap.width;
  const srcHeight = bitmap.height;
  if (srcWidth * srcHeight > MAX_PIXELS) {
    bitmap.close();
    return fail('Image trop grande pour ce navigateur');
  }

  const scale = o.maxSide > 0 ? Math.min(1, o.maxSide / Math.max(srcWidth, srcHeight)) : 1;
  const nonWeb = type === 'bmp' || type === 'heic' || type === 'tiff';
  const toWebp = o.format === 'webp' && type !== 'webp';
  // Réencodage obligatoire : le garde-fou n'exige plus 10 %, seulement d'être plus léger.
  const forced = scale < 1 || nonWeb || toWebp || (!!jpeg && (jpeg.orientation !== 1 || jpeg.foreignProfile || jpeg.cmyk));

  if (!forced && file.size < SMALL_FILE) {
    bitmap.close();
    return keep(file, bytes, type, jpeg, srcWidth, srcHeight, 'Déjà légère');
  }

  // Cible : JPEG et WebP gardent leur format ; PNG, BMP, HEIC, TIFF selon leurs pixels.
  let target: Target = type === 'jpeg' ? 'jpeg' : type === 'webp' ? 'webp' : 'png';
  let lossless = type === 'webp' && webpIsLossless(bytes);
  let image: ImageData;
  let scaled: ImageBitmap | undefined;
  try {
    if (type !== 'jpeg' && type !== 'webp') {
      const { transparent, flat } = classify(bitmap);
      const photo = !transparent && !flat;
      if (o.format === 'webp') lossless = flat;
      else if (photo && (o.format === 'auto' || type === 'heic' || type === 'tiff')) target = 'jpeg';
    }
    if (o.format === 'webp') target = 'webp';
    scaled = await shrink(bitmap, scale);
    image = toPixels(scaled);
  } finally {
    // shrink a déjà fermé la source quand il réduit ; close() sur un bitmap fermé ne fait rien.
    bitmap.close();
    scaled?.close();
  }
  // classify ne lit qu'un pixel sur step² : un liseré transparent plus fin lui échappe. L'alpha est donc
  // relu ici sur tous les pixels avant de passer en JPEG ; une image opaque n'a plus besoin de fond blanc.
  if (target === 'jpeg' && type !== 'jpeg' && hasTransparency(image.data)) target = 'png';

  const out =
    target === 'jpeg'
      ? await encodeJpeg(image, o.jpeg)
      : target === 'webp'
        ? await encodeWebp(image, o.webp, lossless)
        : await encodePng(image, o.png, type === 'png' && scale >= 1 ? bytes : null);

  const size = out.byteLength;
  const worth = size <= file.size * MIN_GAIN.ratio && file.size - size >= MIN_GAIN.bytes;
  // BMP, HEIC et TIFF ne servent pas sur un site : la conversion est gardée même plus lourde.
  if (nonWeb || (forced && size < file.size) || worth) {
    const changed = EXT[target] !== EXT[type as Target];
    return {
      press: 'done',
      blob: new Blob([out], { type: `image/${target}` }),
      ext: EXT[target],
      width: image.width,
      height: image.height,
      srcWidth,
      srcHeight,
      note: changed ? `${LABEL[type]} converti en ${target === 'webp' ? 'WebP' : EXT[target].toUpperCase()}` : undefined,
    };
  }
  return keep(file, bytes, type, jpeg, srcWidth, srcHeight, 'Déjà optimisée');
}

scope.onmessage = async ({ data }) => {
  let outcome: Outcome;
  try {
    outcome = await compress(data);
  } catch (e) {
    console.warn('Compression impossible :', data.file.name, e);
    outcome = { ...fail('Compression impossible sur ce poste'), fatal: crashed(e) };
  }
  scope.postMessage({ id: data.id, ...outcome, natif: wasmBroken } as Reply);
};

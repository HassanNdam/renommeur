/*
 * Lecture des en-têtes d'image et retrait des métadonnées, sans rien décoder.
 * Fonctions pures : testées par Vitest dans Node.
 */

export type Sniffed = 'jpeg' | 'png' | 'webp' | 'bmp' | 'gif' | 'heic' | 'avif' | 'tiff' | 'svg' | 'other';

const latin1 = new TextDecoder('latin1');
const ascii = (b: Uint8Array, offset: number, length: number) => latin1.decode(b.subarray(offset, offset + length));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Format réel, d'après les octets magiques (un .jpg peut être un PNG). */
export function sniff(b: Uint8Array): Sniffed {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return 'tiff';
  if (/<svg[\s>]/i.test(ascii(b, 0, 2048))) return 'svg';
  return 'other';
}

/** PNG : chunk acTL avant IDAT. WebP : drapeau d'animation du chunk VP8X. */
export function isAnimated(b: Uint8Array, type: Sniffed): boolean {
  if (type === 'png') {
    const v = view(b);
    for (let i = 8; i + 8 <= b.length; i += 12 + v.getUint32(i)) {
      const chunk = ascii(b, i + 4, 4);
      if (chunk === 'acTL') return true;
      if (chunk === 'IDAT') return false;
    }
    return false;
  }
  if (type === 'webp') return ascii(b, 12, 4) === 'VP8X' && (b[20] & 0x02) !== 0;
  return false;
}

/** WebP sans perte (VP8L), directement ou dans un conteneur VP8X. */
export function webpIsLossless(b: Uint8Array): boolean {
  const v = view(b);
  for (let i = 12; i + 8 <= b.length; ) {
    const chunk = ascii(b, i, 4);
    if (chunk === 'VP8L') return true;
    if (chunk === 'VP8 ') return false;
    const size = v.getUint32(i + 4, true);
    i += 8 + size + (size & 1);
  }
  return false;
}

export interface JpegInfo {
  width: number;
  height: number;
  orientation: number;
  /** Profil ICC qui n'est pas du sRGB (Display P3, Adobe RGB…) : le site l'ignorera. */
  foreignProfile: boolean;
  cmyk: boolean;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function scanJpeg(b: Uint8Array): JpegInfo {
  const v = view(b);
  const info: JpegInfo = { width: 0, height: 0, orientation: 1, foreignProfile: false, cmyk: false };
  try {
    for (let i = 2; i + 4 <= b.length; ) {
      if (b[i] !== 0xff || b[i + 1] === 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = v.getUint16(i + 2);
      if (marker === 0xe1 && ascii(b, i + 4, 6) === 'Exif\0\0') {
        info.orientation = exifOrientation(v, i + 10);
      } else if (marker === 0xe2 && ascii(b, i + 4, 12) === 'ICC_PROFILE\0' && b[i + 16] === 1) {
        if (ascii(b, i + 34, 4) === 'CMYK') info.cmyk = true;
        // La description peut être en UTF-16 (balise mluc) : on retire les octets nuls avant de chercher.
        if (!ascii(b, i + 18, length - 16).replace(/\0/g, '').includes('sRGB')) info.foreignProfile = true;
      } else if (SOF.has(marker)) {
        info.height = v.getUint16(i + 5);
        info.width = v.getUint16(i + 7);
        if (b[i + 9] === 4) info.cmyk = true;
      }
      i += 2 + length;
    }
  } catch {
    info.foreignProfile = true; // en-tête abîmé : on réencodera
  }
  return info;
}

function exifOrientation(v: DataView, tiff: number): number {
  const le = v.getUint16(tiff) === 0x4949;
  const ifd = tiff + v.getUint32(tiff + 4, le);
  for (let k = 0, n = v.getUint16(ifd, le); k < n; k++) {
    const entry = ifd + 2 + k * 12;
    if (v.getUint16(entry, le) === 0x0112) return v.getUint16(entry + 8, le);
  }
  return 1;
}

/** Dimensions lues dans l'en-tête, pour refuser une image démesurée avant de la décoder. */
export function headerSize(b: Uint8Array, type: Sniffed): { width: number; height: number } | null {
  const v = view(b);
  try {
    if (type === 'png') return { width: v.getUint32(16), height: v.getUint32(20) };
    if (type === 'bmp') return { width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
    if (type === 'jpeg') {
      const { width, height } = scanJpeg(b);
      return width && height ? { width, height } : null;
    }
    if (type === 'webp') {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
      if (chunk === 'VP8L')
        return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
  } catch {
    // en-tête tronqué : le décodage tranchera
  }
  return null;
}

/* ---------- Retrait des métadonnées, sans réencoder ---------- */

/**
 * Morceau du fichier nettoyé : plage [début, fin[ de l'original, ou octets nouveaux.
 * Le worker fait un Blob de tranches du File : les octets gardés ne sont pas recopiés.
 */
export type Part = readonly [start: number, end: number] | Uint8Array;

/** Recolle les morceaux (oxipng, tests). Une seule plage : sous-tableau, sans copie. */
export function joinParts(b: Uint8Array, parts: readonly Part[]): Uint8Array {
  const chunks = parts.map((p) => (p instanceof Uint8Array ? p : b.subarray(p[0], p[1])));
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Ajoute à parts ce qui précède from depuis start, puis les octets insérés ; renvoie le nouveau début. */
function cut(parts: Part[], start: number, from: number, to: number, insert?: Uint8Array): number {
  if (from > start) parts.push([start, from]);
  if (insert) parts.push(insert);
  return to;
}

/** Orientation à porter dans le fichier nettoyé (2 à 8 ; 1 ou une valeur aberrante : rien à garder). */
const turned = (o: number) => o >= 2 && o <= 8;
/** EXIF abîmé : orientation 1. */
const safeOrientation = (v: DataView, tiff: number) => {
  try {
    return exifOrientation(v, tiff);
  } catch {
    return 1;
  }
};

/** TIFF gros-boutiste réduit à la seule balise Orientation (26 octets) : rien d'autre ne part. */
const tiffOrientation = (o: number) => [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];

/** APP1 minimal de 36 octets : « Exif\0\0 » puis le TIFF d'orientation. */
const jpegOrientation = (o: number) => new Uint8Array([0xff, 0xe1, 0, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiffOrientation(o)]);

/** Segments gardés : JFIF (APP0), profil ICC (APP2), Adobe (APP14, transformée des couleurs). */
function keptApp(b: Uint8Array, i: number, marker: number): boolean {
  if (marker === 0xe0 || marker === 0xee) return true;
  // APP2 : le profil seul ; MPF pointerait dans le vide une fois coupé après EOI.
  if (marker === 0xe2) return ascii(b, i + 4, 12) === 'ICC_PROFILE\0';
  return false;
}

/** Marqueurs sans longueur : bourrage (FF 00), TEM, RST0-7, SOI, EOI. Tous les autres en ont une. */
const standalone = (m: number) => m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd9);

/**
 * Fin de l'image : juste après le premier EOI. Les segments entre deux passes sont sautés d'après leur
 * longueur ; dans les données, FF 00 est du bourrage, FF D0-D7 un RST. Ce qui suit EOI (vidéo d'une
 * Motion Photo, images MPF, remorque de fabricant) ne part pas. Sans EOI (fichier tronqué) : tout.
 */
function jpegEnd(b: Uint8Array, v: DataView, sos: number): number {
  for (let i = sos; i + 1 < b.length; ) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd9) return i + 2;
    if (marker === 0xff) i++;
    else if (!standalone(marker) && i + 4 <= b.length) i += 2 + v.getUint16(i + 2);
    else i += 2;
  }
  return b.length;
}

/**
 * JPEG : retire EXIF et XMP (APP1), MPF (APP2), IPTC (APP13), les autres APPn et les commentaires,
 * les octets parasites entre segments, et tout ce qui suit EOI. Garde JFIF, le profil ICC et Adobe (APP14).
 * Orientation différente de 1 : un APP1 minimal la porte, juste après SOI ou après un APP0 en tête.
 */
export function stripJpegMetadata(b: Uint8Array, orientation = 1): Part[] {
  const v = view(b);
  const parts: Part[] = [];
  let pending = turned(orientation) ? jpegOrientation(orientation) : undefined;
  let start = 0;
  let end = b.length;
  let i = 2;
  while (i + 4 <= b.length) {
    if (pending && !(i === 2 && b[i] === 0xff && b[i + 1] === 0xe0)) {
      start = cut(parts, start, i, i, pending);
      pending = undefined;
    }
    // Octet parasite ou de remplissage (scanJpeg les saute aussi) : retiré.
    if (b[i] !== 0xff || b[i + 1] === 0xff) {
      start = cut(parts, start, i, i + 1);
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xda) {
      end = jpegEnd(b, v, i);
      break;
    }
    if (marker === 0xd9) {
      end = i + 2;
      break;
    }
    if (standalone(marker)) {
      // Marqueur isolé (RST, SOI répété) égaré avant l'image : retiré.
      start = cut(parts, start, i, i + 2);
      i += 2;
      continue;
    }
    const next = i + 2 + v.getUint16(i + 2);
    if (marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && !keptApp(b, i, marker))) start = cut(parts, start, i, next);
    i = next;
  }
  if (pending) start = cut(parts, start, i, i, pending);
  if (end > start) parts.push([start, Math.min(end, b.length)]);
  return parts;
}

/* PNG : CRC des chunks (polynôme de zlib), pour le seul chunk que l'on écrit. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Chunk eXIf réduit à l'orientation (38 octets). */
function pngOrientation(o: number): Uint8Array {
  const chunk = new Uint8Array([0, 0, 0, 26, 0x65, 0x58, 0x49, 0x66, ...tiffOrientation(o), 0, 0, 0, 0]);
  view(chunk).setUint32(34, crc32(chunk.subarray(4, 34)));
  return chunk;
}

/** EXIF, textes (auteur, logiciel, parfois une position) et date de modification. */
const PNG_META = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/**
 * PNG : la signature puis chaque chunk, sauf eXIf, tEXt, zTXt, iTXt et tIME ; rien après IEND.
 * Un eXIf tourné est remplacé par un eXIf qui ne porte que l'orientation.
 */
export function stripPngMetadata(b: Uint8Array): Part[] {
  const v = view(b);
  const parts: Part[] = [];
  let start = 0;
  let end = b.length;
  for (let i = 8; i + 12 <= b.length; ) {
    const next = i + 12 + v.getUint32(i);
    const type = ascii(b, i + 4, 4);
    if (PNG_META.has(type)) {
      const o = type === 'eXIf' ? safeOrientation(v, i + 8) : 1;
      start = cut(parts, start, i, next, turned(o) ? pngOrientation(o) : undefined);
    }
    if (type === 'IEND') {
      end = next;
      break;
    }
    i = next;
  }
  if (end > start) parts.push([start, Math.min(end, b.length)]);
  return parts;
}

/**
 * WebP : retire les chunks EXIF et XMP et efface leurs drapeaux du VP8X (0x08 et 0x04) ;
 * la taille RIFF est recalculée, rien ne part après la fin du RIFF.
 */
export function stripWebpMetadata(b: Uint8Array): Part[] {
  const v = view(b);
  const riffEnd = Math.min(b.length, 8 + v.getUint32(4, true));
  const extended = riffEnd >= 30 && ascii(b, 12, 4) === 'VP8X' && v.getUint32(16, true) === 10;
  const head = b.slice(0, extended ? 30 : 12);
  const parts: Part[] = [head];
  let start = head.length;
  let i = 12;
  while (i + 8 <= riffEnd) {
    const size = v.getUint32(i + 4, true);
    const next = Math.min(riffEnd, i + 8 + size + (size & 1));
    const type = ascii(b, i, 4);
    if (type === 'EXIF' || type === 'XMP ') start = cut(parts, start, i, next);
    i = next;
  }
  if (riffEnd > start) parts.push([start, riffEnd]);
  const total = parts.reduce((n, p) => n + (p instanceof Uint8Array ? p.length : p[1] - p[0]), 0);
  view(head).setUint32(4, total - 8, true);
  if (extended) head[20] &= ~0x0c;
  return parts;
}

/* ---------- Pixels ---------- */

/** Un alpha sous 255 sur un tableau RGBA, lu en entier (un liseré d'un pixel compte). */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Transparence réelle et part de pixels identiques à leur voisin de droite (un pixel sur 7),
 * sur un tableau RGBA. Les compteurs s'additionnent d'une bande à l'autre.
 */
export function measurePixels(data: Uint8ClampedArray, width: number, acc = { transparent: false, same: 0, seen: 0 }) {
  if (!acc.transparent) acc.transparent = hasTransparency(data);
  const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
  for (let p = 0; p + 1 < px.length; p += 7) {
    if ((p + 1) % width === 0) continue;
    acc.seen++;
    if (px[p] === px[p + 1]) acc.same++;
  }
  return acc;
}

/*
 * Tout ce qui touche au contenu des fichiers se passe ici, dans le navigateur :
 * une petite vignette pour l'affichage, et pour le modèle soit une image
 * réduite, soit un extrait de texte. Les fichiers ne quittent jamais le poste.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { Kind } from './kinds';
import { splitName } from './kinds';

/** Côté le plus long de l'image envoyée au modèle (≈ 500 à 800 jetons). */
const MODEL_IMAGE_SIZE = 768;
const PREVIEW_SIZE = 144;
const TEXT_LIMIT = 3000;

export interface Prepared {
  previewUrl: string | null;
  /** Vignette JPEG en data URL, pour le modèle. */
  image?: string;
  /** Extrait de texte, pour le modèle. */
  text?: string;
  /** Dimensions décodées (images seulement) : budget mémoire de la compression. */
  width?: number;
  height?: number;
}

/**
 * forModel = false (« Compresser ») : vignette et extrait seulement, sans l'image de 768 px pour
 * le modèle ; le store la refait au moment du nommage si l'on repasse en « Les deux ».
 */
export async function prepare(file: File, kind: Kind, forModel = true): Promise<Prepared> {
  switch (kind) {
    case 'image':
      return fromImage(file, forModel);
    case 'video':
      return fromVideo(file, forModel);
    case 'pdf':
      return fromPdf(file, forModel);
    case 'document':
    case 'spreadsheet':
    case 'presentation':
      return fromOffice(file);
    case 'text':
      return { previewUrl: null, text: await readTextExcerpt(file) };
    default:
      return { previewUrl: null };
  }
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function sizeOf(source: Drawable): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth || 512, height: source.naturalHeight || 512 };
  return { width: source.width, height: source.height };
}

/** Redessine la source sur fond blanc (la transparence devient blanche en JPEG). */
async function toJpeg(source: Drawable, maxSide: number, quality: number): Promise<Blob> {
  const { width, height } = sizeOf(source);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encodage'))), 'image/jpeg', quality),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fromDrawable(source: Drawable, forModel: boolean, text?: string): Promise<Prepared> {
  const [preview, model] = await Promise.all([
    toJpeg(source, PREVIEW_SIZE, 0.8),
    forModel ? toJpeg(source, MODEL_IMAGE_SIZE, 0.82) : null,
  ]);
  return { previewUrl: URL.createObjectURL(preview), image: model ? await blobToDataUrl(model) : undefined, text };
}

async function fromImage(file: File, forModel: boolean): Promise<Prepared> {
  const isSvg = splitName(file.name).ext.toLowerCase() === 'svg' || file.type === 'image/svg+xml';
  if (isSvg) return fromSvg(file, forModel);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC, TIFF, PSD, RAW… : le navigateur ne sait pas les lire, on nommera sur le nom d'origine.
    return { previewUrl: null };
  }
  try {
    return { ...(await fromDrawable(bitmap, forModel)), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function fromSvg(file: File, forModel: boolean): Promise<Prepared> {
  const source = await file.text();
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const words = [...doc.querySelectorAll('title, desc, text')].map((n) => n.textContent ?? '').join(' ');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await fromDrawable(img, forModel, clip(words) || undefined);
  } catch {
    return { previewUrl: null, text: clip(words) || undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromVideo(file: File, forModel: boolean): Promise<Prepared> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await waitFor(video, 'loadeddata', 15000);
    video.currentTime = Math.min(1, (video.duration || 0) / 3);
    await waitFor(video, 'seeked', 15000);
    return await fromDrawable(video, forModel);
  } catch {
    return { previewUrl: null };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitFor(target: HTMLMediaElement, event: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('délai dépassé')), timeout);
    target.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
    target.addEventListener('error', () => (clearTimeout(timer), reject(new Error('lecture'))), { once: true });
  });
}

async function fromPdf(file: File, forModel: boolean): Promise<Prepared> {
  const pdfjs = await import('./pdf');
  try {
    // Un PDF piégé ou démesuré ne doit pas bloquer la file de lecture.
    const side = forModel ? MODEL_IMAGE_SIZE : PREVIEW_SIZE;
    const { canvas, text } = await withTimeout(pdfjs.firstPageAndText(file, side), 30_000);
    return await fromDrawable(canvas, forModel, clip(text) || undefined);
  } catch {
    return { previewUrl: null };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), ms))]);
}

/**
 * Word, Excel, PowerPoint (Office Open XML) et LibreOffice (ODF) sont des ZIP de
 * XML : on en tire le titre et le début du texte sans bibliothèque dédiée.
 */
async function fromOffice(file: File): Promise<Prepared> {
  const ext = splitName(file.name).ext.toLowerCase();
  if (ext === 'csv') return { previewUrl: null, text: await readTextExcerpt(file) };
  const wanted = (name: string) =>
    name === 'docProps/core.xml' ||
    name === 'word/document.xml' ||
    name === 'xl/workbook.xml' ||
    name === 'xl/sharedStrings.xml' ||
    /^ppt\/slides\/slide\d+\.xml$/.test(name) ||
    name === 'content.xml' ||
    name === 'meta.xml';
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => wanted(f.name) });
  } catch {
    // .doc, .xls, .ppt binaires, ou fichier abîmé.
    return { previewUrl: null };
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const title = xmlText(read('docProps/core.xml').match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] ?? '')
    || xmlText(read('meta.xml').match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] ?? '');

  const parts: string[] = [];
  if (title) parts.push(`Titre : ${title}`);
  if (files['word/document.xml']) parts.push(xmlText(read('word/document.xml').replace(/<\/w:p>/g, '\n')));
  if (files['xl/workbook.xml']) {
    const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => xmlText(m[1]));
    parts.push(`Feuilles : ${sheets.join(', ')}`);
    const strings = [...read('xl/sharedStrings.xml').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]));
    parts.push(`Cellules : ${strings.slice(0, 150).join(' | ')}`);
  }
  const slides = Object.keys(files)
    .filter((n) => n.startsWith('ppt/slides/'))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  slides.slice(0, 8).forEach((name, i) => parts.push(`Diapo ${i + 1} : ${xmlText(read(name).replace(/<\/a:p>/g, '\n'))}`));
  if (files['content.xml']) parts.push(xmlText(read('content.xml').replace(/<\/text:(p|h)>/g, '\n')));

  return { previewUrl: null, text: clip(parts.join('\n')) || undefined };
}

async function readTextExcerpt(file: File): Promise<string | undefined> {
  let text = await file.slice(0, 40_000).text();
  if (/\.(html?|xml|svg)$/i.test(file.name)) {
    text = new DOMParser().parseFromString(text, 'text/html').body?.textContent ?? '';
  }
  return clip(text) || undefined;
}

/** Retire les balises et décode les entités d'un fragment XML. */
function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function clip(text: string): string {
  return text.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, TEXT_LIMIT);
}

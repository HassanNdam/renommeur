/*
 * État de l'application et les trois files de travail :
 * - lecture : prépare vignette et extrait de chaque fichier déposé (3 à la fois) ;
 * - nommage : envoie les fichiers prêts par lots au serveur (3 lots à la fois),
 *   avec nouvel essai automatique quand l'erreur est passagère ;
 * - compression : chaque image lue part dans le pool de workers (compress/pool.ts).
 * Nommage (status) et compression (press) sont indépendants : une ligne peut être nommée
 * et encore en compression, ou compressée sans jamais être nommée.
 */
import { api, ApiError, type Settings } from './api';
import { sourcePath } from './dropped';
import { isJunkFile, kindOf, normalizeExt, splitName, type Kind } from './kinds';
import { prepare } from './prepare';
import { assignFileNames, slugify } from './slug';
import { showToast } from './ui.svelte';
import { CompressPool, UNKNOWN_MPX } from './compress/pool';
import { isCompressible, jobOptions, parseSqueeze, type Squeeze } from './compress/settings';

export type Status = 'reading' | 'ready' | 'queued' | 'naming' | 'done' | 'error';
export type Mode = 'rename' | 'compress' | 'both';
/** skip : rien à compresser (PDF, SVG, GIF…) ; same : original gardé ; fail : non compressée. */
export type Press = 'skip' | 'wait' | 'run' | 'done' | 'same' | 'fail';

export interface Output {
  blob: Blob;
  /** Extension de sortie quand le format change (jpg, png, webp) ; null : celle d'origine. */
  ext: string | null;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
}

export interface Entry {
  id: string;
  file: File;
  kind: Kind;
  ext: string;
  previewUrl: string | null;
  image?: string;
  /** Lue en « Compresser » sans l'image pour Claude : elle est faite au moment du nommage. */
  imageLater?: boolean;
  text?: string;
  /** Mégapixels lus pendant la préparation : budget mémoire du pool. */
  mpx?: number;
  status: Status;
  slug: string;
  alt: string;
  edited: boolean;
  error: string | null;
  attempts: number;
  press: Press;
  output?: Output;
  /** Phrase courte : raison d'un fail ou d'un skip, conversion d'un done (« PNG converti en JPG »). */
  pressNote?: string;
}

const READ_CONCURRENCY = 3;
const NAME_CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
/** Taille maximale d'un lot envoyé au serveur, vignettes comprises. */
const MAX_BATCH_BYTES = 6_000_000;
/** Un réglage changé relance la compression après ce délai (plusieurs clics, une seule relance). */
const RESTART_DELAY = 300;
/** Poids estimé de l'image pour Claude d'une ligne qui ne l'a pas encore (taille d'un lot). */
const LATER_IMAGE_BYTES = 200_000;
/** Sans limite de taille, la mémoire suit les pixels de sortie : une grande photo compte triple. */
const UNLIMITED_COST = 3;

export const app = $state({
  settings: null as Settings | null,
  apiProblem: null as string | null,
  fatal: null as string | null,
  context: storedValue('context', ''),
  lang: storedValue('lang', 'fr') as 'fr' | 'en',
  mode: parseMode(storedValue('mode', 'both')),
  squeeze: parseSqueeze(storedValue('squeeze', '')),
  entries: [] as Entry[],
  autoQueue: false,
  /** > 0 pendant l'écriture d'un ZIP : le traitement est figé, les relances attendent. */
  zipping: 0,
});

const compressing = () => app.mode !== 'rename';
const settledPress = (p: Press) => p !== 'wait' && p !== 'run';

/**
 * Nom de sortie avant numérotation des doublons, ou null si la ligne ne part pas encore.
 * Compresser : nom d'origine (extension d'origine, casse comprise, si le format ne change pas),
 * précédé du chemin dans le dossier déposé : le ZIP garde l'arborescence.
 * Renommer, Les deux : nom proposé, extension de sortie en « Les deux ».
 */
export function nameParts(e: Entry, slug = e.slug): { base: string; ext: string } | null {
  const outExt = compressing() ? e.output?.ext : null;
  if (app.mode === 'compress') {
    const { base, ext } = splitName(sourcePath(e.file));
    return { base, ext: outExt ?? ext };
  }
  return e.status === 'done' ? { base: slug, ext: outExt ?? e.ext } : null;
}

/** Nom final de chaque fichier qui part, doublons numérotés. */
const fileNames = $derived.by(() =>
  assignFileNames(
    app.entries.flatMap((e) => {
      const parts = nameParts(e);
      return parts ? [{ id: e.id, slug: parts.base, ext: parts.ext, converted: compressing() && !!e.output?.ext }] : [];
    }),
  ),
);

const counts = $derived.by(() => {
  const c = { total: app.entries.length, reading: 0, ready: 0, pending: 0, done: 0, error: 0 };
  for (const e of app.entries) {
    if (e.status === 'reading') c.reading++;
    else if (e.status === 'ready') c.ready++;
    else if (e.status === 'queued' || e.status === 'naming') c.pending++;
    else if (e.status === 'done') c.done++;
    else c.error++;
  }
  return c;
});

/** Compteurs de compression ; before / after : octets des images réglées (done, same, fail). */
const squeezeCounts = $derived.by(() => {
  const s = { images: 0, wait: 0, run: 0, done: 0, same: 0, fail: 0, before: 0, after: 0 };
  for (const e of app.entries) {
    if (e.press === 'skip') continue;
    s.images++;
    s[e.press]++;
    if (settledPress(e.press)) {
      s.before += e.file.size;
      s.after += e.output?.blob.size ?? e.file.size;
    }
  }
  return s;
});

export const view = {
  get fileNames() {
    return fileNames;
  },
  get counts() {
    return counts;
  },
  get squeeze() {
    return squeezeCounts;
  },
};

function storedValue(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`renommeur.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function parseMode(value: string): Mode {
  return value === 'rename' || value === 'compress' ? value : 'both';
}

export function remember(key: 'context' | 'lang' | 'mode' | 'squeeze', value: string): void {
  try {
    localStorage.setItem(`renommeur.${key}`, value);
  } catch {
    // Navigation privée : tant pis, la valeur ne sera pas retenue.
  }
}

/* ---------- Réglages du serveur ---------- */

export async function loadSettings(): Promise<void> {
  try {
    app.settings = await api.settings();
    void checkApi();
  } catch (e) {
    app.fatal = e instanceof ApiError ? e.message : 'Impossible de joindre le serveur.';
  }
}

async function checkApi(): Promise<void> {
  try {
    const result = await api.ping();
    app.apiProblem = result.ok ? null : (result.reason ?? 'L’API Claude ne répond pas.');
  } catch (e) {
    app.apiProblem = e instanceof ApiError ? e.message : 'L’API Claude ne répond pas.';
  }
}

/* ---------- Ajout et retrait de fichiers ---------- */

let sequence = 0;
const fingerprints = new Set<string>();
// Chemin compris : deux copies identiques dans deux dossiers déposés partent toutes les deux.
const fingerprint = (f: File) => `${sourcePath(f)}|${f.size}|${f.lastModified}`;

/** Ajoute des fichiers ; ignore les doublons exacts et les fichiers système. */
export function addFiles(files: Iterable<File>): number {
  let added = 0;
  for (const file of files) {
    if (isJunkFile(file.name) || file.size === 0 || fingerprints.has(fingerprint(file))) continue;
    fingerprints.add(fingerprint(file));
    const ext = splitName(file.name).ext;
    app.entries.push({
      id: `f${++sequence}`,
      file,
      kind: kindOf(file.name),
      ext: normalizeExt(ext),
      previewUrl: null,
      status: 'reading',
      slug: '',
      alt: '',
      edited: false,
      error: null,
      attempts: 0,
      press: isCompressible(ext) ? 'wait' : 'skip',
    });
    added++;
  }
  pumpReading();
  return added;
}

export function removeEntry(id: string): void {
  const index = app.entries.findIndex((e) => e.id === id);
  if (index === -1) return;
  const [entry] = app.entries.splice(index, 1);
  fingerprints.delete(fingerprint(entry.file));
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  pool.cancel(id);
  notify(id);
}

export function clearAll(): void {
  for (const e of app.entries) if (e.previewUrl) URL.revokeObjectURL(e.previewUrl);
  const ids = app.entries.map((e) => e.id);
  app.entries = [];
  fingerprints.clear();
  app.autoQueue = false;
  generation++;
  // Les lectures et les lots partis chez Claude rendent leur place tout de suite : un nouveau lot part sans attendre.
  epoch++;
  reading = 0;
  naming = 0;
  inProgress.clear();
  zipAbort?.abort(); // un ZIP en cours échoue au lieu de s'enregistrer incomplet
  zipAbort = null;
  pool.dispose(); // workers arrêtés : leur mémoire WASM est rendue
  for (const id of ids) notify(id);
}

/* ---------- File de lecture ---------- */

let reading = 0;
/** Change à chaque « Tout retirer » : une lecture ou un lot d'avant ne rend pas une place déjà rendue. */
let epoch = 0;

function pumpReading(): void {
  while (reading < READ_CONCURRENCY) {
    const entry = app.entries.find((e) => e.status === 'reading' && !inProgress.has(e.id));
    if (!entry) return;
    const ep = epoch;
    inProgress.add(entry.id);
    reading++;
    void readEntry(entry.id).finally(() => {
      if (ep === epoch) {
        reading--;
        inProgress.delete(entry.id);
      }
      pumpReading();
    });
  }
}

const inProgress = new Set<string>();
const byId = (id: string) => app.entries.find((e) => e.id === id);

async function readEntry(id: string): Promise<void> {
  const start = byId(id);
  if (!start) return;
  let result: Awaited<ReturnType<typeof prepare>> = { previewUrl: null };
  // En « Compresser », l'image pour Claude ne sert pas : elle sera faite si l'on repasse au nommage.
  const forModel = app.mode !== 'compress';
  try {
    result = await prepare(start.file, start.kind, forModel);
  } catch {
    // Fichier illisible : on le nommera sur son nom d'origine.
  }
  const entry = byId(id);
  if (!entry) {
    if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
    return;
  }
  entry.previewUrl = result.previewUrl;
  entry.image = result.image;
  entry.imageLater = !forModel && !!result.previewUrl;
  entry.text = result.text;
  if (result.width && result.height) entry.mpx = (result.width * result.height) / 1e6;
  entry.status = app.autoQueue ? 'queued' : 'ready';
  if (app.autoQueue) pumpNaming();
  // La compression part dès la lecture faite, dans l'ordre de la liste (celui du ZIP).
  if (entry.press === 'wait' && compressing()) submit(entry);
}

/* ---------- File de compression ---------- */

const pool = new CompressPool();
/** Change à chaque relance : un résultat d'une génération précédente est ignoré. */
let generation = 0;
const waiters = new Map<string, (() => void)[]>();

const sameSqueeze = (a: Squeeze, b: Squeeze) => a.level === b.level && a.maxSide === b.maxSide && a.format === b.format;
/** Réglages réellement appliqués : app.squeeze change dès le clic, ceux-ci à la relance seulement. */
let jobSqueeze: Squeeze = { ...app.squeeze };
/** Le repli natif (codecs WASM non chargés) n'est signalé qu'une fois. */
let nativeWarned = false;

function submit(entry: Entry): void {
  const id = entry.id;
  const gen = generation;
  entry.press = 'wait';
  entry.output = undefined;
  entry.pressNote = undefined;
  const started = () => {
    const current = byId(id);
    if (current && gen === generation) current.press = 'run';
  };
  const cost = (entry.mpx ?? UNKNOWN_MPX) * (jobSqueeze.maxSide ? 1 : UNLIMITED_COST);
  void pool.run(id, entry.file, jobOptions(jobSqueeze), cost, started).then((reply) => {
    const e = byId(id);
    if (!e || gen !== generation || reply.press === 'cancelled') return;
    if ('natif' in reply && reply.natif && !nativeWarned) {
      nativeWarned = true;
      showToast({
        text: 'Codecs de compression non chargés : images moins allégées. Prévenez la personne qui gère l’outil.',
        tone: 'error',
        persist: true,
      });
    }
    let note = 'note' in reply ? reply.note : undefined;
    if (reply.press === 'done') {
      // Extension inchangée (jpg pour .JPG ou .jpeg) : null, pour garder celle d'origine, casse comprise.
      const ext = reply.ext === e.ext ? null : reply.ext;
      if (ext && !note) note = `Extension corrigée en ${ext.toUpperCase()}`; // un PNG qui était un JPEG
      // Le proxy de $state n'enveloppe que les objets simples : le Blob reste tel quel.
      e.output = { blob: reply.blob, ext, width: reply.width, height: reply.height, srcWidth: reply.srcWidth, srcHeight: reply.srcHeight };
    } else if (reply.press === 'same') {
      // Original gardé ; pour un JPEG, métadonnées retirées sans réencodage (reply.blob).
      const { srcWidth: w, srcHeight: h } = reply;
      e.output = { blob: reply.blob ?? e.file, ext: null, width: w, height: h, srcWidth: w, srcHeight: h };
    }
    e.pressNote = note;
    e.press = reply.press;
    notify(id);
  });
}

function notify(id: string): void {
  const list = waiters.get(id);
  if (!list) return;
  waiters.delete(id);
  for (const resolve of list) resolve();
}

/** Attend que la compression de la ligne soit réglée ; ne rejette jamais (retrait, mode Renommer compris). */
export function whenSettled(id: string): Promise<void> {
  const e = byId(id);
  if (!e || !compressing() || settledPress(e.press)) return Promise.resolve();
  return new Promise((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
}

/** Ce qui part dans le ZIP ou au téléchargement : la sortie compressée si elle existe et sert. */
export function outgoing(e: Entry): Blob {
  return compressing() && (e.press === 'done' || e.press === 'same') && e.output ? e.output.blob : e.file;
}

/**
 * Change de traitement sans rien perdre : noms et résultats déjà obtenus restent.
 * Refusé pendant l'écriture d'un ZIP : noms et contenus de l'archive en dépendent.
 */
export function setMode(mode: Mode): void {
  if (mode === app.mode || app.zipping > 0) return;
  const before = app.mode;
  app.mode = mode;
  remember('mode', mode);
  if (mode === 'rename') {
    generation++;
    pool.dispose(); // workers arrêtés : leur mémoire WASM est rendue
    for (const e of app.entries) if (e.press === 'run') e.press = 'wait';
    for (const id of [...waiters.keys()]) notify(id); // aucune attente ne reste sans réponse
  } else if (before === 'rename') {
    for (const e of app.entries) if (e.press === 'wait' && e.status !== 'reading') submit(e);
  }
  // Compresser met le nommage en pause : les lots partis se terminent, les autres attendent.
  if (mode !== 'compress') pumpNaming();
}

let restartTimer: ReturnType<typeof setTimeout> | undefined;
let restartPending = false;
let zipAbort: AbortController | null = null;

export function setCompression(change: Partial<Squeeze>): void {
  const next = { ...app.squeeze, ...change };
  if (sameSqueeze(next, app.squeeze)) return; // segment déjà coché, Début ou Fin sur place
  app.squeeze = next;
  remember('squeeze', JSON.stringify(app.squeeze));
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    restartCompression();
  }, RESTART_DELAY);
}

/**
 * Vrai si le résultat d'une ligne peut changer entre les réglages a et b ; sinon il est gardé.
 * Ligne sans sortie, en attente, en cours ou en échec : toujours relancée.
 */
function mayChange(e: Entry, a: Squeeze, b: Squeeze): boolean {
  if ((e.press !== 'done' && e.press !== 'same') || !e.output) return true;
  if (a.level !== b.level) return true;
  if ((a.format === 'webp') !== (b.format === 'webp')) return true;
  // Automatique ou D'origine ne décide que pour un PNG ou un BMP (extension corrigée : par prudence).
  if (a.format !== b.format && (e.ext === 'png' || e.ext === 'bmp' || !!e.output.ext)) return true;
  if (a.maxSide === b.maxSide) return false;
  const side = (n: number) => n || Infinity; // 0 : sans limite
  return Math.max(e.output.srcWidth, e.output.srcHeight) > Math.min(side(a.maxSide), side(b.maxSide));
}

/** Recompresse, à partir des originaux, les images dont le résultat peut changer (les noms ne bougent pas). */
function restartCompression(): void {
  if (sameSqueeze(app.squeeze, jobSqueeze)) {
    restartPending = false; // aller-retour A → B → A : rien à refaire
    return;
  }
  if (app.zipping > 0) {
    restartPending = true; // le ZIP en cours garde les réglages avec lesquels il a commencé
    return;
  }
  const before = jobSqueeze;
  jobSqueeze = { ...app.squeeze };
  generation++;
  pool.cancelAll();
  for (const e of app.entries) {
    if (e.press === 'skip' || !mayChange(e, before, jobSqueeze)) continue;
    if (compressing() && e.status !== 'reading') submit(e);
    else {
      e.press = 'wait';
      e.output = undefined;
      e.pressNote = undefined;
    }
  }
}

/**
 * Le ZIP tient la relance et le traitement pendant qu'il s'écrit ; la fonction rendue les libère.
 * Une relance encore dans son délai part avant : l'archive suit le réglage affiché.
 */
export function holdRestart(): () => void {
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
    restartCompression();
  }
  app.zipping++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--app.zipping === 0 && restartPending) {
      restartPending = false;
      restartCompression();
    }
  };
}

/** Signal du ZIP qui commence : « Tout retirer » l'interrompt. */
export function zipSignal(): AbortSignal {
  zipAbort = new AbortController();
  return zipAbort.signal;
}

/* ---------- File de nommage ---------- */

let naming = 0;

/** Lance le nommage de tout ce qui est prêt ; les fichiers ajoutés ensuite suivront. */
export function nameAll(): void {
  app.autoQueue = true;
  for (const e of app.entries) {
    if (e.status === 'ready' || e.status === 'error') {
      e.status = 'queued';
      e.error = null;
      e.attempts = 0;
    }
  }
  pumpNaming();
}

export function renameOne(id: string): void {
  const entry = byId(id);
  if (!entry || entry.status === 'reading' || entry.status === 'naming' || entry.status === 'queued') return;
  entry.status = 'queued';
  entry.edited = false;
  entry.error = null;
  entry.attempts = 0;
  pumpNaming();
}

function pumpNaming(): void {
  if (app.mode === 'compress') return;
  const batchSize = app.settings?.batchSize ?? 8;
  while (naming < NAME_CONCURRENCY) {
    const batch: Entry[] = [];
    let bytes = 0;
    for (const e of app.entries) {
      if (e.status !== 'queued') continue;
      const size = (e.image?.length ?? (e.imageLater ? LATER_IMAGE_BYTES : 0)) + (e.text?.length ?? 0) + 500;
      if (batch.length > 0 && (batch.length >= batchSize || bytes + size > MAX_BATCH_BYTES)) break;
      batch.push(e);
      bytes += size;
    }
    if (batch.length === 0) return;
    for (const e of batch) e.status = 'naming';
    const ep = epoch;
    naming++;
    void sendBatch(batch.map((e) => e.id)).finally(() => {
      if (ep === epoch) naming--;
      pumpNaming();
    });
  }
}

async function sendBatch(ids: string[]): Promise<void> {
  await addLaterImages(ids);
  const entries = ids.map(byId).filter((e): e is Entry => !!e);
  if (entries.length === 0) return;
  try {
    const result = await api.name(
      app.context.trim(),
      app.lang,
      entries.map((e) => ({ id: e.id, kind: e.kind, name: e.file.name, image: e.image, text: e.text })),
    );
    const named = new Map(result.files.map((f) => [f.id, f]));
    for (const id of ids) {
      const entry = byId(id);
      if (!entry || entry.status !== 'naming') continue;
      const file = named.get(id);
      const slug = file ? slugify(file.name, app.lang) : '';
      if (slug) {
        entry.slug = slug;
        entry.alt = file!.alt;
        entry.status = 'done';
      } else {
        fail(entry, 'Aucun nom reçu pour ce fichier.', true);
      }
    }
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError('Erreur inattendue.', 0, 'unknown', true);
    for (const id of ids) {
      const entry = byId(id);
      if (entry?.status === 'naming') fail(entry, error.message, error.retryable);
    }
  }
}

/** Lignes lues en « Compresser » : l'image pour Claude est faite maintenant, une à la fois. */
async function addLaterImages(ids: string[]): Promise<void> {
  for (const id of ids) {
    const e = byId(id);
    if (!e?.imageLater) continue;
    let image: string | undefined;
    try {
      const extra = await prepare(e.file, e.kind);
      if (extra.previewUrl) URL.revokeObjectURL(extra.previewUrl); // la ligne a déjà sa vignette
      image = extra.image;
    } catch {
      // Illisible cette fois : nommée sur son nom d'origine et son extrait.
    }
    const current = byId(id);
    if (!current) continue;
    current.image = image;
    current.imageLater = false;
  }
}

/** Remet le fichier en file après une pause croissante, ou le marque en erreur. */
function fail(entry: Entry, message: string, retryable: boolean): void {
  entry.attempts++;
  if (retryable && entry.attempts < MAX_ATTEMPTS) {
    entry.status = 'ready';
    const id = entry.id;
    setTimeout(() => {
      const current = byId(id);
      if (current?.status === 'ready') {
        current.status = 'queued';
        pumpNaming();
      }
    }, 1500 * 2 ** entry.attempts);
    return;
  }
  entry.status = 'error';
  entry.error = message;
}

/* ---------- Modifications manuelles ---------- */

export function editSlug(id: string, value: string): void {
  const entry = byId(id);
  if (!entry) return;
  const slug = slugify(value, app.lang);
  if (!slug || slug === entry.slug) return;
  entry.slug = slug;
  entry.edited = true;
}

export function editAlt(id: string, value: string): void {
  const entry = byId(id);
  if (entry) entry.alt = value.trim();
}

/** Point d'entrée pour les essais automatisés en développement. */
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__renommeur = { app, addFiles, nameAll, setMode, setCompression, view };

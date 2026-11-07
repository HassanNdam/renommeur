export type Kind =
  | 'image'
  | 'video'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'audio'
  | 'other';

const BY_EXTENSION: Record<string, Kind> = {};
const groups: [Kind, string][] = [
  ['image', 'jpg jpeg jpe jfif png gif webp avif bmp svg ico tif tiff heic heif psd ai eps raw cr2 nef arw dng'],
  ['video', 'mp4 m4v webm mov ogv avi mkv'],
  ['audio', 'mp3 wav ogg oga m4a aac flac'],
  ['pdf', 'pdf'],
  ['document', 'docx odt doc rtf pages'],
  ['spreadsheet', 'xlsx ods xls csv numbers'],
  ['presentation', 'pptx odp ppt key'],
  ['text', 'txt md json xml html htm css js vtt srt'],
];
for (const [kind, list] of groups) for (const ext of list.split(' ')) BY_EXTENSION[ext] = kind;

/** Libellé court affiché à la place d'une vignette. */
export const KIND_LABEL: Record<Kind, string> = {
  image: 'Image',
  video: 'Vidéo',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Texte',
  spreadsheet: 'Tableur',
  presentation: 'Diapo',
  text: 'Texte',
  other: 'Fichier',
};

/** Accepte un chemin relatif (« images/v1.2/photo ») : seul le dernier segment porte l'extension. */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= name.lastIndexOf('/') + 1 || dot === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

export function kindOf(name: string): Kind {
  return BY_EXTENSION[splitName(name).ext.toLowerCase()] ?? 'other';
}

/** Extension finale : minuscules, et .jpg pour toutes les variantes JPEG. */
export function normalizeExt(ext: string): string {
  const lower = ext.toLowerCase();
  return lower === 'jpeg' || lower === 'jpe' ? 'jpg' : lower;
}

/** Fichiers système qu'un glisser-déposer de dossier ramasse au passage. */
export function isJunkFile(name: string): boolean {
  return /^(\.ds_store|thumbs\.db|desktop\.ini)$/i.test(name) || name.startsWith('._');
}

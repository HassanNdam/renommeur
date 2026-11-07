import { downloadZip } from 'client-zip';
import { slugify } from './slug';
import type { Mode } from './store.svelte';

/** Un fichier qui part : son nom et son contenu ne sont connus qu'une fois sa compression réglée. */
export interface Outgoing {
  lastModified: number;
  /** null : le fichier a été retiré de la liste entre-temps. */
  resolve: () => Promise<{ name: string; blob: Blob } | null>;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Un fichier seul s'enregistre sous son nom, sans les dossiers que le ZIP garde (« images/x.jpg »). */
export function downloadOne(blob: Blob, name: string): void {
  saveBlob(blob, name.slice(name.lastIndexOf('/') + 1));
}

export function archiveName(subject: string, extension: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${slugify(subject, 'fr', 40) || 'fichiers'}-${date}.${extension}`;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream> }>;

/**
 * Chaque fichier n'est lu qu'à son tour : le ZIP attend une compression sans tout garder en mémoire.
 * Un signal interrompu (« Tout retirer ») fait échouer l'archive au lieu de l'enregistrer incomplète.
 */
async function* inputs(items: Outgoing[], signal?: AbortSignal) {
  for (const item of items) {
    signal?.throwIfAborted();
    const ready = await item.resolve();
    signal?.throwIfAborted();
    if (ready) yield { name: ready.name, input: ready.blob, lastModified: new Date(item.lastModified) };
  }
}

/**
 * ZIP sans recompression (images et PDF sont déjà compressés). Quand le navigateur le permet,
 * l'archive s'écrit directement sur le disque au fil de l'eau. Le sélecteur s'ouvre avant toute
 * attente : l'activation par le clic reste valable. Interrompu par `signal`, il rejette : le fichier
 * temporaire du sélecteur est abandonné, et le repli n'enregistre rien.
 */
export async function downloadArchive(items: Outgoing[], name: string, signal?: AbortSignal): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    let handle;
    try {
      handle = await picker({ suggestedName: name, types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }] });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      handle = null;
    }
    if (handle) {
      await downloadZip(inputs(items, signal)).body!.pipeTo(await handle.createWritable(), { signal });
      return;
    }
  }
  saveBlob(await downloadZip(inputs(items, signal)).blob(), name);
}

export interface ReportRow {
  originalName: string;
  name: string;
  alt: string;
  before: number;
  after: number;
  /** « 2560 × 1920 », vide pour un fichier qui n'est pas une image. */
  dims: string;
  /** « Compressée », « Déjà optimisée », « Non compressée : … », « Tel quel ». */
  treatment: string;
}

const ko = (bytes: number) => String(bytes ? Math.max(1, Math.round(bytes / 1024)) : 0);

/** Correspondance des noms, et des poids quand on compresse ; lisible par Excel (UTF-8 avec BOM, « ; »). */
export function downloadCsv(rows: ReportRow[], mode: Mode, name: string): void {
  const columns: [string, (r: ReportRow) => string][] =
    mode === 'rename'
      ? [['Nom d’origine', (r) => r.originalName], ['Nouveau nom', (r) => r.name], ['Texte alternatif', (r) => r.alt]]
      : [
          ['Nom d’origine', (r) => r.originalName],
          [mode === 'compress' ? 'Nom final' : 'Nouveau nom', (r) => r.name],
          ...(mode === 'both' ? [['Texte alternatif', (r: ReportRow) => r.alt] as [string, (r: ReportRow) => string]] : []),
          ['Poids d’origine (Ko)', (r) => ko(r.before)],
          ['Poids final (Ko)', (r) => ko(r.after)],
          ['Dimensions finales', (r) => r.dims],
          ['Compression', (r) => r.treatment],
        ];
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [columns.map(([title]) => title), ...rows.map((r) => columns.map(([, value]) => value(r)))];
  const csv = '﻿' + lines.map((line) => line.map(cell).join(';')).join('\r\n');
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
}

/* Textes chiffrés de l'interface : poids, gain, résumé des réglages. Espaces insécables compris. */
import type { Squeeze } from './compress/settings';

const NB = ' '; // espace insécable
const FINE = ' '; // espace fine insécable, avant %

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}${NB}o`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}${NB}Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')}${NB}Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')}${NB}Go`;
}

/** « −88 % » ; « +12 % » pour un HEIC converti plus lourd ; signe moins U+2212. */
export function formatGain(before: number, after: number): string {
  const pct = Math.round((1 - after / before) * 100);
  return pct >= 0 ? `−${pct}${FINE}%` : `+${-pct}${FINE}%`;
}

export const LEVEL_LABEL = { legere: 'Légère', equilibree: 'Équilibrée', forte: 'Forte' } as const;

/** « Équilibrée, côté le plus long 2560 px, format automatique » : suit le libellé « Compression ». */
export function resumeSqueeze(s: Squeeze): string {
  const side = s.maxSide ? `côté le plus long ${s.maxSide}${NB}px` : 'sans redimensionnement';
  const format = s.format === 'auto' ? 'format automatique' : s.format === 'keep' ? 'formats d’origine' : 'converties en WebP';
  return `${LEVEL_LABEL[s.level]}, ${side}, ${format}`;
}

export const AIDE_COMPRESSION = [
  'Équilibrée convient presque partout ; Légère pour les visionneuses et les bannières plein écran, Forte pour les actualités et les vignettes.',
  'Format automatique : un PNG sans transparence qui est une photo passe en JPG, le reste garde son format. Le site se charge du WebP.',
  'Les métadonnées (EXIF, position GPS) sont retirées des images compressées ou gardées ; les fichiers Tel quel et Non compressée partent intacts.',
] as const;

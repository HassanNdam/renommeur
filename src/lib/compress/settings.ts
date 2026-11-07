/*
 * Réglages de compression : ce que l'interface propose, et leur traduction en valeurs de codec.
 * Aucun import de navigateur ici : le fichier est lu par la page, par le worker et par Vitest.
 */

export type Level = 'legere' | 'equilibree' | 'forte';
export type OutFormat = 'auto' | 'keep' | 'webp';
export type MaxSide = 0 | 1280 | 1920 | 2560;

/** Ce que la personne choisit (retenu dans localStorage). */
export interface Squeeze {
  level: Level;
  maxSide: MaxSide;
  format: OutFormat;
}

export const SQUEEZE_DEFAULT: Squeeze = { level: 'equilibree', maxSide: 2560, format: 'auto' };

/**
 * Qualités MozJPEG et libwebp. À SSIM égal (mesuré, Chrome 152, 2560 px) : MozJPEG q82 ≈ JPEG natif 0,75,
 * q88 ≈ natif 0,83 ; q76 est un peu sous le natif 0,70 (Squoosh : 75). Équilibrée garde une marge pour le
 * second encodage de YOOtheme (WebP 85) ; Légère sert la visionneuse, qui reçoit le fichier tel quel.
 * PNG : bornes min / cible de libimagequant ; sous le min, on passe au sans perte.
 */
export const LEVELS: Record<Level, { jpeg: number; webp: number; png: { min: number; target: number } }> = {
  legere: { jpeg: 88, webp: 85, png: { min: 80, target: 95 } },
  equilibree: { jpeg: 82, webp: 80, png: { min: 65, target: 85 } },
  forte: { jpeg: 76, webp: 72, png: { min: 45, target: 70 } },
};

/** Repli sans WASM : qualité du JPEG natif au même SSIM que la qualité MozJPEG (voir ci-dessus). */
export const NATIVE_JPEG: Record<number, number> = { 88: 0.83, 82: 0.75, 76: 0.7 };

/** Le fichier recompressé n'est gardé que s'il pèse au plus 90 % de l'original et fait gagner 10 Ko. */
export const MIN_GAIN = { ratio: 0.9, bytes: 10 * 1024 };
/** Sous ce poids, une image déjà à la bonne taille et sans défaut à corriger n'est pas réencodée. */
export const SMALL_FILE = 50 * 1024;
/** Part de pixels identiques à leur voisin au-delà de laquelle un PNG est un aplat (capture, logo). */
export const FLAT_RATIO = 0.6;
/** Au-delà, le navigateur risque de manquer de mémoire : l'image n'est pas décodée. */
export const MAX_PIXELS = 100_000_000;
/** Au-delà, oxipng sans perte est trop lent : on garde l'original (ou le PNG natif s'il est plus léger). */
export const LOSSLESS_MAX_PIXELS = 4_000_000;

/**
 * Extensions envoyées au worker. Les autres fichiers sont « Tel quel » sans même être lus.
 * .jfif : JPEG enregistré ainsi par Windows ; le worker le reconnaît à ses octets et rend un .jpg.
 */
const COMPRESSIBLE = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff']);
export const isCompressible = (ext: string) => COMPRESSIBLE.has(ext.toLowerCase());

/** Options numériques transmises au worker (il ignore tout de l'interface). */
export interface JobOptions {
  maxSide: number;
  jpeg: number;
  webp: number;
  png: { min: number; target: number };
  format: OutFormat;
}

export function jobOptions(s: Squeeze): JobOptions {
  const l = LEVELS[s.level];
  return { maxSide: s.maxSide, jpeg: l.jpeg, webp: l.webp, png: l.png, format: s.format };
}

/** Relit le réglage retenu ; toute valeur inconnue retombe sur le défaut. */
export function parseSqueeze(raw: string | null): Squeeze {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<Squeeze>;
    return {
      level: v.level && v.level in LEVELS ? v.level : SQUEEZE_DEFAULT.level,
      maxSide: ([0, 1280, 1920, 2560] as const).find((n) => n === v.maxSide) ?? SQUEEZE_DEFAULT.maxSide,
      format: (['auto', 'keep', 'webp'] as const).find((f) => f === v.format) ?? SQUEEZE_DEFAULT.format,
    };
  } catch {
    return { ...SQUEEZE_DEFAULT };
  }
}

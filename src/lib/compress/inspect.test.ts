import { describe, expect, it } from 'vitest';
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
} from './inspect';
import { jobOptions, parseSqueeze, SQUEEZE_DEFAULT } from './settings';
import { formatGain, formatSize, resumeSqueeze } from '../format';
import { assignFileNames } from '../slug';

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const segment = (marker: number, payload: Uint8Array) => bytes([0xff, marker], u16(payload.length + 2), payload);

/** EXIF minimal, petit-boutiste, avec la seule balise Orientation. */
const exif = (orientation: number) =>
  bytes('Exif\0\0', 'II', [0x2a, 0], le32(8), [1, 0], [0x12, 0x01], [3, 0], le32(1), [orientation, 0, 0, 0], le32(0));
const icc = (description: string, space = 'RGB ') =>
  bytes('ICC_PROFILE\0', [1, 1], new Uint8Array(16), space, new Uint8Array(40), 'desc', description);
const sof = (width: number, height: number, components = 3) => bytes([8], u16(height), u16(width), [components]);
const jpeg = (...segments: Uint8Array[]) => bytes([0xff, 0xd8], ...segments, [0xff, 0xda, 0, 2], [1, 2, 3], [0xff, 0xd9]);

const chunk = (type: string, data: number[] = []) => bytes(u32(data.length), type, data, [0, 0, 0, 0]);
const png = (...chunks: Uint8Array[]) => bytes([0x89], 'PNG\r\n\x1a\n', ...chunks);
const ihdr = (w: number, h: number) => chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]);

describe('sniff', () => {
  it('reconnaît le format aux octets, pas à l’extension', () => {
    expect(sniff(jpeg())).toBe('jpeg');
    expect(sniff(png(ihdr(1, 1)))).toBe('png');
    expect(sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('webp');
    expect(sniff(bytes('GIF89a'))).toBe('gif');
    expect(sniff(bytes('BM', new Uint8Array(30)))).toBe('bmp');
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBe('heic');
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftypavif'))).toBe('avif');
    expect(sniff(bytes('II*\0'))).toBe('tiff');
    expect(sniff(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">'))).toBe('svg');
    expect(sniff(bytes('%PDF-1.7'))).toBe('other');
  });
});

describe('isAnimated', () => {
  it('voit un APNG à son chunk acTL avant IDAT', () => {
    expect(isAnimated(png(ihdr(2, 2), chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), chunk('IDAT')), 'png')).toBe(true);
    expect(isAnimated(png(ihdr(2, 2), chunk('IDAT'), chunk('acTL')), 'png')).toBe(false);
  });

  it('voit un WebP animé au drapeau du chunk VP8X', () => {
    const vp8x = (flags: number) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', le32(10), [flags, 0, 0, 0], [9, 0, 0, 9, 0, 0]);
    expect(isAnimated(vp8x(0x02), 'webp')).toBe(true);
    expect(isAnimated(vp8x(0x10), 'webp')).toBe(false);
    expect(headerSize(vp8x(0), 'webp')).toEqual({ width: 10, height: 10 });
  });
});

describe('webpIsLossless', () => {
  it('trouve VP8L directement ou derrière VP8X', () => {
    expect(webpIsLossless(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', le32(5), [0x2f, 0, 0, 0, 0], [0]))).toBe(true);
    expect(webpIsLossless(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', le32(10), new Uint8Array(10), 'VP8L', le32(1), [0x2f, 0]))).toBe(true);
    expect(webpIsLossless(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', le32(1), [0, 0]))).toBe(false);
  });
});

describe('scanJpeg', () => {
  it('lit orientation, dimensions et profil', () => {
    const info = scanJpeg(jpeg(segment(0xe1, exif(6)), segment(0xe2, icc('Display P3')), segment(0xc0, sof(4032, 3024))));
    expect(info).toEqual({ width: 4032, height: 3024, orientation: 6, foreignProfile: true, cmyk: false });
  });

  it('accepte un profil sRGB et repère le CMJN', () => {
    expect(scanJpeg(jpeg(segment(0xe2, icc('sRGB IEC61966-2.1')))).foreignProfile).toBe(false);
    expect(scanJpeg(jpeg(segment(0xc0, sof(10, 10, 4)))).cmyk).toBe(true);
    expect(scanJpeg(jpeg(segment(0xe2, icc('U.S. Web Coated (SWOP) v2', 'CMYK')))).cmyk).toBe(true);
  });

  it('sans EXIF, l’orientation vaut 1', () => {
    expect(scanJpeg(jpeg(segment(0xc0, sof(800, 600)))).orientation).toBe(1);
  });
});

/** EXIF petit-boutiste avec Orientation et un IFD GPS (balise 0x8825), comme une photo de téléphone. */
const exifGps = (orientation: number) =>
  bytes(
    'Exif\0\0',
    'II',
    [0x2a, 0],
    le32(8),
    [2, 0],
    [0x12, 0x01, 3, 0],
    le32(1),
    [orientation, 0, 0, 0],
    [0x25, 0x88, 4, 0],
    le32(1),
    le32(38), // IFD GPS juste après IFD0 (8 + 2 + 2 × 12 + 4)
    le32(0),
    [1, 0],
    [1, 0, 2, 0],
    le32(2),
    'N\0\0\0',
    le32(0),
  );
const jfif = bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]);
const xmp = bytes('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>exif:GPSLatitude 48,51N</x:xmpmeta>');
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const contains = (b: Uint8Array, seq: number[]) => b.some((_, i) => seq.every((x, k) => b[i + k] === x));
const jpegMarkers = (b: Uint8Array) => [...b.keys()].filter((i) => b[i] === 0xff && b[i + 1] >= 0xc0).map((i) => b[i + 1]);
const strippedJpeg = (b: Uint8Array, orientation?: number) => joinParts(b, stripJpegMetadata(b, orientation));

describe('stripJpegMetadata', () => {
  it('retire EXIF, IPTC et commentaires, garde le profil ICC et les données', () => {
    const source = jpeg(segment(0xe0, jfif), segment(0xe1, exif(1)), segment(0xed, bytes('Photoshop 3.0\0')), segment(0xfe, bytes('commentaire')), segment(0xe2, icc('sRGB')), segment(0xc0, sof(2, 2)));
    const out = strippedJpeg(source);
    expect(jpegMarkers(out)).toEqual([0xd8, 0xe0, 0xe2, 0xc0, 0xda, 0xd9]);
    expect(out.length).toBeLessThan(source.length);
    expect(scanJpeg(out).orientation).toBe(1);
  });

  it('orientation 6 et GPS : l’orientation reste, dans un APP1 minimal après APP0, le GPS et le XMP partent', () => {
    const source = jpeg(segment(0xe0, jfif), segment(0xe1, exifGps(6)), segment(0xe1, xmp), segment(0xe2, icc('sRGB')), segment(0xc0, sof(4032, 3024)));
    expect(contains(source, [0x25, 0x88])).toBe(true);
    const out = strippedJpeg(source, scanJpeg(source).orientation);
    expect(scanJpeg(out)).toMatchObject({ orientation: 6, width: 4032, height: 3024 });
    expect(contains(out, [0x25, 0x88])).toBe(false);
    expect(text(out)).not.toContain('xmpmeta');
    expect(jpegMarkers(out)).toEqual([0xd8, 0xe0, 0xe1, 0xe2, 0xc0, 0xda, 0xd9]);
    expect([...out.subarray(20, 24)]).toEqual([0xff, 0xe1, 0, 0x22]); // SOI (2) + APP0 (18)
  });

  it('sans APP0, l’APP1 d’orientation suit SOI', () => {
    const out = strippedJpeg(jpeg(segment(0xe1, exifGps(8)), segment(0xc0, sof(10, 20))), 8);
    expect(jpegMarkers(out)).toEqual([0xd8, 0xe1, 0xc0, 0xda, 0xd9]);
    expect(scanJpeg(out).orientation).toBe(8);
    expect(out.length).toBe(2 + 36 + 2 + 2 + 6 + 4 + 3 + 2);
  });

  it('octet parasite, MPF et remorque après EOI (Motion Photo) : tout part, l’image reste intacte', () => {
    const motion = bytes([0xff, 0xd8], segment(0xe1, exifGps(1)), [0xff, 0xd9], 'MotionPhoto_Data', 'GPS 48.85N 2.35E');
    const source = bytes(
      [0xff, 0xd8],
      segment(0xe0, jfif),
      [0x00], // octet parasite : la boucle s'arrêtait là et recopiait l'APP1 qui suit
      segment(0xe1, exifGps(1)),
      segment(0xe2, bytes('MPF\0', 'MM', [0, 0x2a, 0, 0, 0, 8])),
      segment(0xc0, sof(2, 2)),
      [0xff, 0xda, 0, 2],
      [1, 2, 3],
      [0xff, 0xd9],
      motion,
    );
    const out = strippedJpeg(source);
    expect(out).toEqual(jpeg(segment(0xe0, jfif), segment(0xc0, sof(2, 2))));
  });

  it('progressif : bourrage, RST et segments entre les passes ne coupent pas l’image avant le vrai EOI', () => {
    const image = bytes(
      [0xff, 0xd8],
      segment(0xc2, sof(2, 2)),
      [0xff, 0xda, 0, 2],
      [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56], // FF 00 : bourrage ; FF D0 : RST
      segment(0xc4, bytes([0x10, 0xff, 0xd9, 0x01])), // FF D9 dans la longueur d'un DHT : pas un EOI
      [0xff, 0xda, 0, 2],
      [0x78],
      [0xff, 0xff, 0xd9], // octet de remplissage avant EOI
    );
    expect(strippedJpeg(bytes(image, 'remorque du fabricant'))).toEqual(image);
  });

  it('rien à retirer : des plages du fichier seulement, sans octets recopiés', () => {
    const source = jpeg(segment(0xe0, jfif), segment(0xc0, sof(2, 2)));
    const parts = stripJpegMetadata(source);
    expect(parts.every((p) => !(p instanceof Uint8Array))).toBe(true);
    expect(joinParts(source, parts)).toEqual(source);
  });
});

/** CRC-32 bit à bit, indépendant de la table d'inspect.ts. */
const crc = (b: Uint8Array) => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
};
const pngChunks = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list: { type: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 8; i + 12 <= b.length; i += 12 + v.getUint32(i)) {
    list.push({ type: text(b.subarray(i + 4, i + 8)), data: b.subarray(i + 8, i + 8 + v.getUint32(i)), crc: v.getUint32(i + 8 + v.getUint32(i)) });
  }
  return list;
};
const ascii = (s: string) => [...bytes(s)];

describe('stripPngMetadata', () => {
  const meta = [
    chunk('tEXt', ascii('Author\0Hassan')),
    chunk('zTXt', ascii('Comment\0\0x')),
    chunk('iTXt', ascii('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>GPS</x:xmpmeta>')),
    chunk('tIME', [0x07, 0xea, 10, 23, 12, 0, 0]),
  ];

  it('retire eXIf, tEXt, zTXt, iTXt, tIME et ce qui suit IEND', () => {
    const source = png(ihdr(2, 2), chunk('iCCP', ascii('sRGB\0\0x')), chunk('eXIf', [...exifGps(1).subarray(6)]), ...meta, chunk('IDAT', [1, 2, 3]), chunk('IEND'), bytes('remorque'));
    const out = joinParts(source, stripPngMetadata(source));
    expect(pngChunks(out).map((c) => c.type)).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND']);
    expect(out).toEqual(png(ihdr(2, 2), chunk('iCCP', ascii('sRGB\0\0x')), chunk('IDAT', [1, 2, 3]), chunk('IEND')));
  });

  it('eXIf tourné : remplacé par un eXIf qui ne porte que l’orientation, CRC juste', () => {
    expect(crc(bytes('IEND'))).toBe(0xae426082); // le CRC du test lui-même
    const source = png(ihdr(2, 2), chunk('eXIf', [...exifGps(6).subarray(6)]), ...meta, chunk('IDAT', [1, 2, 3]), chunk('IEND'));
    const out = joinParts(source, stripPngMetadata(source));
    const chunks = pngChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    const exifChunk = chunks[1];
    expect(exifChunk.data.length).toBe(26);
    expect(exifChunk.crc).toBe(crc(bytes('eXIf', exifChunk.data)));
    expect(contains(out, [0x25, 0x88])).toBe(false);
    // Même TIFF dans un APP1 : scanJpeg le relit.
    expect(scanJpeg(jpeg(segment(0xe1, bytes('Exif\0\0', exifChunk.data)))).orientation).toBe(6);
  });
});

describe('stripWebpMetadata', () => {
  const riff = (...chunks: Uint8Array[]) => {
    const body = bytes('WEBP', ...chunks);
    return bytes('RIFF', le32(body.length), body);
  };
  const webpChunk = (type: string, data: Uint8Array) => bytes(type, le32(data.length), data, data.length & 1 ? [0] : []);
  const vp8x = (flags: number) => webpChunk('VP8X', bytes([flags, 0, 0, 0], [9, 0, 0, 9, 0, 0]));
  const iccp = webpChunk('ICCP', bytes('profil'));
  const vp8l = webpChunk('VP8L', bytes([0x2f, 0, 0, 0, 0]));

  it('retire EXIF et XMP, efface leurs drapeaux et recalcule la taille RIFF', () => {
    const source = bytes(riff(vp8x(0x20 | 0x08 | 0x04 | 0x10), iccp, vp8l, webpChunk('EXIF', exifGps(1).subarray(6)), webpChunk('XMP ', xmp)), 'remorque');
    const out = joinParts(source, stripWebpMetadata(source));
    expect(out).toEqual(riff(vp8x(0x20 | 0x10), iccp, vp8l));
    expect(webpIsLossless(out)).toBe(true);
    expect(headerSize(out, 'webp')).toEqual({ width: 10, height: 10 });
  });

  it('sans métadonnées : même taille que l’original', () => {
    const source = riff(vp8x(0x10), vp8l);
    expect(joinParts(source, stripWebpMetadata(source))).toEqual(source);
  });
});

describe('headerSize', () => {
  it('lit l’IHDR d’un PNG', () => {
    expect(headerSize(png(ihdr(12000, 9000)), 'png')).toEqual({ width: 12000, height: 9000 });
  });
});

describe('measurePixels', () => {
  it('distingue un aplat d’une photo et voit la transparence', () => {
    const w = 64;
    const flat = new Uint8ClampedArray(w * w * 4).fill(255);
    const noise = new Uint8ClampedArray(w * w * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 251));
    const a = measurePixels(flat, w);
    const b = measurePixels(noise, w);
    expect(a.same / a.seen).toBeGreaterThan(0.9);
    expect(b.same / b.seen).toBeLessThan(0.1);
    expect(a.transparent || b.transparent).toBe(false);
    flat[3] = 0;
    expect(measurePixels(flat, w).transparent).toBe(true);
  });

  it('voit un seul pixel transparent, où qu’il soit', () => {
    const data = new Uint8ClampedArray(3000 * 4).fill(255);
    expect(hasTransparency(data)).toBe(false);
    data[2999 * 4 + 3] = 254;
    expect(hasTransparency(data)).toBe(true);
  });
});

describe('réglages', () => {
  it('retombe sur le défaut pour une valeur inconnue', () => {
    expect(parseSqueeze(null)).toEqual(SQUEEZE_DEFAULT);
    expect(parseSqueeze('{"level":"forte","maxSide":3840,"format":"jpeg"}')).toEqual({ level: 'forte', maxSide: 2560, format: 'auto' });
    expect(parseSqueeze('pas du json')).toEqual(SQUEEZE_DEFAULT);
    expect(jobOptions(SQUEEZE_DEFAULT)).toMatchObject({ maxSide: 2560, jpeg: 82, webp: 80, format: 'auto' });
  });

  it('écrit poids, gain et résumé en français', () => {
    expect(formatSize(3_565_158)).toBe('3,4 Mo');
    expect(formatSize(421_888)).toBe('412 Ko');
    expect(formatGain(3_565_158, 421_888)).toBe('−88 %');
    expect(formatGain(100, 112)).toBe('+12 %');
    expect(resumeSqueeze(SQUEEZE_DEFAULT)).toBe('Équilibrée, côté le plus long 2560 px, format automatique');
  });
});

describe('assignFileNames et la casse', () => {
  it('numérote deux noms qui ne diffèrent que par la casse', () => {
    const names = assignFileNames([
      { id: 'a', slug: 'IMG_1', ext: 'JPG' },
      { id: 'b', slug: 'img_1', ext: 'jpg' },
      { id: 'c', slug: 'photo', ext: 'jpg' },
      { id: 'd', slug: 'photo', ext: 'jpg' },
    ]);
    expect([...names.values()]).toEqual(['IMG_1.JPG', 'img_1-2.jpg', 'photo.jpg', 'photo-2.jpg']);
  });
});

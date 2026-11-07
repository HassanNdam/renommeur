import { describe, expect, it } from 'vitest';
import { assignFileNames, slugify } from './slug';
import { kindOf, normalizeExt, splitName } from './kinds';

describe('slugify', () => {
  it('met en minuscules, retire les accents et pose des tirets', () => {
    expect(slugify('Façade Église Saint-Pierre — Saumur')).toBe('facade-eglise-saint-pierre-saumur');
  });

  it('traite ligatures, apostrophes et esperluettes', () => {
    expect(slugify("Œuvre d'art & cœur")).toBe('oeuvre-d-art-et-coeur');
    expect(slugify('Salt & Pepper', 'en')).toBe('salt-and-pepper');
  });

  it('nettoie les tirets en trop et les caractères exotiques', () => {
    expect(slugify('  --IMG_2034 (copie) [final]!!--  ')).toBe('img-2034-copie-final');
    expect(slugify('™ ® ©')).toBe('tm');
    expect(slugify('***')).toBe('');
  });

  it('coupe sur une fin de mot', () => {
    expect(slugify('renovation cuisine contemporaine annecy', 'fr', 25)).toBe('renovation-cuisine');
    expect(slugify('abcdefghijklmnopqrstuvwxyz', 'fr', 10)).toBe('abcdefghij');
  });
});

describe('assignFileNames', () => {
  it('numérote les doublons à partir de 2, extension comprise', () => {
    const names = assignFileNames([
      { id: 'a', slug: 'vitrine', ext: 'jpg' },
      { id: 'b', slug: 'vitrine', ext: 'jpg' },
      { id: 'c', slug: 'vitrine', ext: 'pdf' },
      { id: 'd', slug: 'vitrine', ext: 'jpg' },
      { id: 'e', slug: '', ext: '' },
    ]);
    expect([...names.values()]).toEqual(['vitrine.jpg', 'vitrine-2.jpg', 'vitrine.pdf', 'vitrine-3.jpg', 'fichier']);
  });

  it('ne réutilise pas un nom déjà pris par un suffixe', () => {
    const names = assignFileNames([
      { id: 'a', slug: 'plan-2', ext: 'png' },
      { id: 'b', slug: 'plan', ext: 'png' },
      { id: 'c', slug: 'plan', ext: 'png' },
    ]);
    expect([...names.values()]).toEqual(['plan-2.png', 'plan.png', 'plan-3.png']);
  });

  it('laisse le nom d’un vrai JPG au JPG, pas au PNG converti, quel que soit l’avancement', () => {
    // Avant la compression du PNG, puis après sa conversion en JPG : le vrai photo.jpg ne bouge pas.
    const avant = assignFileNames([
      { id: 'png', slug: 'photo', ext: 'png' },
      { id: 'jpg', slug: 'photo', ext: 'jpg' },
    ]);
    const apres = assignFileNames([
      { id: 'png', slug: 'photo', ext: 'jpg', converted: true },
      { id: 'jpg', slug: 'photo', ext: 'jpg' },
    ]);
    expect(avant.get('jpg')).toBe('photo.jpg');
    expect(apres.get('jpg')).toBe('photo.jpg');
    expect(apres.get('png')).toBe('photo-2.jpg');
  });

  it('dédoublonne par chemin : deux x.jpg de deux dossiers gardent leur nom', () => {
    const names = assignFileNames([
      { id: 'a', slug: 'images/blog/x', ext: 'jpg' },
      { id: 'b', slug: 'images/equipe/x', ext: 'jpg' },
      { id: 'c', slug: 'images/blog/X', ext: 'JPG' },
    ]);
    expect([...names.values()]).toEqual(['images/blog/x.jpg', 'images/equipe/x.jpg', 'images/blog/X-2.JPG']);
  });
});

describe('kinds', () => {
  it('reconnaît le type par extension', () => {
    expect(kindOf('Photo.JPEG')).toBe('image');
    expect(kindOf('rapport.final.docx')).toBe('document');
    expect(kindOf('sans-extension')).toBe('other');
    expect(kindOf('.htaccess')).toBe('other');
  });

  it('normalise les extensions', () => {
    expect(normalizeExt('JPEG')).toBe('jpg');
    expect(normalizeExt('PNG')).toBe('png');
    expect(splitName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: 'gz' });
  });

  it('lit un JPEG en .jfif comme une image, sans renommer son extension', () => {
    expect(kindOf('photo-gps.jfif')).toBe('image');
    expect(normalizeExt('JFIF')).toBe('jfif');
  });

  it('découpe un chemin relatif sur son dernier segment', () => {
    expect(splitName('images/blog/x.JPG')).toEqual({ base: 'images/blog/x', ext: 'JPG' });
    expect(splitName('images/v1.2/photo')).toEqual({ base: 'images/v1.2/photo', ext: '' });
    expect(splitName('site/.htaccess')).toEqual({ base: 'site/.htaccess', ext: '' });
  });
});

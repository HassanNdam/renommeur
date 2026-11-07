const LIGATURES: Record<string, string> = {
  œ: 'oe', Œ: 'oe', æ: 'ae', Æ: 'ae', ß: 'ss', ø: 'o', Ø: 'o', đ: 'd', Đ: 'd', ł: 'l', Ł: 'l',
};

export const MAX_SLUG_LENGTH = 70;

/**
 * Nom SEO : minuscules, sans accents, mots séparés par un tiret.
 * Coupe à `max` caractères sur une fin de mot.
 */
export function slugify(input: string, lang: 'fr' | 'en' = 'fr', max = MAX_SLUG_LENGTH): string {
  let s = input
    .replace(/[œŒæÆßøØđĐłŁ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/&/g, lang === 'en' ? ' and ' : ' et ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > max) {
    const cut = s.slice(0, max + 1);
    const lastDash = cut.lastIndexOf('-');
    s = (lastDash > 0 ? cut.slice(0, lastDash) : s.slice(0, max)).replace(/-+$/, '');
  }
  return s;
}

export const withExt = (base: string, ext: string) => (ext ? `${base}.${ext}` : base);

/**
 * Noms de fichiers finaux, sans doublon : le second « vitrine.jpg » devient
 * « vitrine-2.jpg ». L'ordre de la liste décide qui garde le nom nu.
 * La comparaison ignore la casse : « IMG_1.JPG » et « img_1.jpg » s'écraseraient
 * une fois l'archive ouverte sous Windows ou macOS.
 * Deux passes : les fichiers qui gardent leur extension sont numérotés d'abord. Un PNG converti
 * en JPG ne prend donc jamais le nom d'un vrai JPG du lot, quel que soit l'ordre ou l'avancement.
 */
export function assignFileNames(
  entries: readonly { id: string; slug: string; ext: string; converted?: boolean }[],
): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const late of [false, true]) {
    for (const entry of entries) {
      if (!!entry.converted !== late) continue;
      const base = entry.slug || 'fichier';
      let name = withExt(base, entry.ext);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = withExt(`${base}-${n}`, entry.ext);
      used.add(name.toLowerCase());
      names.set(entry.id, name);
    }
  }
  return names;
}

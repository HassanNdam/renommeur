// Essai de la compression dans la vraie interface, en mode « Compresser » (aucun appel à Claude) :
//   RENOMMEUR_PW=… node <pilote-cdp> dev/essai-compression.mjs <dossier-captures>
// Lot : dev/fixtures/compression (photos lourdes, PNG photo, détouré, capture, portrait EXIF 6) + quelques
// fichiers des fixtures de base (petit JPEG, faux HEIC, Word) pour les cas « déjà légère », « illisible », « tel quel ».
const BASE = 'http://localhost:5173/';
const PW = process.env.RENOMMEUR_PW ?? '';
const LOT = process.env.RENOMMEUR_LOT ? JSON.parse(process.env.RENOMMEUR_LOT) : [
  'compression/grande.jpg',
  'compression/photo.jpg',
  'compression/photo2.jpg',
  'compression/photo-exif6.jpg',
  'compression/photo.png',
  'compression/detoure.png',
  'compression/capture.png',
  'vitrine.jpg',
  'IMG_4410.HEIC',
  'devis final V2.docx',
];

const PAINT = 'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));';
// Le cadre de réglages et le bandeau entrent en fondu (200 ms) : on attend sa fin avant toute capture.
const FONDU = 'await new Promise(r => setTimeout(r, 300));';

/** Attend la fin des compressions puis relève chaque ligne, sorties décodées pour vérifier dimensions et intégrité. */
const RELEVE = `
  const R = window.__renommeur;
  const t0 = performance.now();
  for (let i = 0; i < 1800 && R.app.entries.some(e => e.press === 'wait' || e.press === 'run' || e.status === 'reading'); i++) await new Promise(r => setTimeout(r, 100));
  const duree = Math.round(performance.now() - t0);
  const rows = [];
  for (const e of R.app.entries) {
    let decode = null;
    if (e.output && e.press === 'done') {
      try { const b = await createImageBitmap(e.output.blob); decode = b.width + 'x' + b.height; b.close(); } catch { decode = 'ILLISIBLE'; }
    }
    rows.push({ fichier: e.file.name, statut: e.press, note: e.pressNote ?? '', avant: Math.round(e.file.size / 1024), apres: e.output ? Math.round(e.output.blob.size / 1024) : null,
      type: e.output?.blob.type ?? '', dims: e.output ? e.output.width + 'x' + e.output.height : '', decode, nom: R.view.fileNames.get(e.id) ?? '' });
  }
  return { duree, rows, total: R.view.squeeze };`;

async function shot(p, name) {
  await p.eval(PAINT);
  return p.shot(name);
}

export const scenarios = [
  {
    nom: 'Compression seule, réglages par défaut',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`await fetch('api/login.php', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: ${JSON.stringify(PW)}})});
        localStorage.removeItem('renommeur.squeeze');`);
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`window.__renommeur.setMode('compress'); ${FONDU}`);
      log(await shot(p, 'c01-vide-compresser-1280'));
      // Tâches longues du fil principal pendant toute la compression.
      await p.eval(`window.__longues = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__longues.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
        const dt = new DataTransfer();
        for (const n of ${JSON.stringify(LOT)}) dt.items.add(new File([await fetch('/dev/fixtures/' + n.split('/').map(encodeURIComponent).join('/')).then(r => r.blob())], n.split('/').pop()));
        const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 900));`);
      log(await shot(p, 'c02-compression-en-cours-1280'));
      const r = await p.eval(RELEVE);
      log(`durée du lot : ${r.duree} ms`);
      for (const row of r.rows) log(JSON.stringify(row));
      log('totaux', JSON.stringify(r.total));
      log('tâches longues (ms) :', JSON.stringify(await p.eval(`return window.__longues;`)));
      log(await shot(p, 'c03-compresse-1280'));
    },
  },
  {
    nom: 'Niveaux et tailles',
    async run(p, log) {
      for (const change of [{ level: 'forte' }, { level: 'legere' }, { level: 'equilibree', maxSide: 1920 }, { maxSide: 0 }, { maxSide: 2560, format: 'webp' }]) {
        await p.eval(`window.__renommeur.setCompression(${JSON.stringify(change)}); await new Promise(r => setTimeout(r, 600));`);
        const r = await p.eval(RELEVE);
        log(JSON.stringify(change), `${r.duree} ms`, r.rows.filter((x) => x.apres !== null).map((x) => `${x.fichier} ${x.avant}→${x.apres} Ko ${x.dims} ${x.statut}${x.decode === 'ILLISIBLE' ? ' ILLISIBLE' : ''}`).join(' | '));
      }
      await p.eval(`window.__renommeur.setCompression({ format: 'auto' });`);
      await p.eval(RELEVE);
      // « Modifier » à côté du résumé « Compression » du bandeau.
      await p.eval(`document.getElementById('cmp-edit-btn')?.click(); ${FONDU}`);
      log('réglages ouverts', await p.eval(`return !!document.querySelector('.brief-compact .cmp-edit');`));
      log(await shot(p, 'c04-reglages-ouverts-1280'));
    },
  },
  {
    nom: 'Mobile',
    async run(p, log) {
      await p.goto(BASE, { width: 375, height: 812 });
      await p.eval(`window.__renommeur.setMode('compress'); ${FONDU}
        const dt = new DataTransfer();
        for (const n of ${JSON.stringify(LOT.slice(0, 7))}) dt.items.add(new File([await fetch('/dev/fixtures/' + n.split('/').map(encodeURIComponent).join('/')).then(r => r.blob())], n.split('/').pop()));
        const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`);
      await p.eval(RELEVE);
      log(await shot(p, 'c05-compresse-375'));
      log('débordement', await p.eval(`return document.documentElement.scrollWidth > innerWidth;`));
    },
  },
];

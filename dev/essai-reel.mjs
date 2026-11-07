// Essai réel de bout en bout : dépôt de photos dans l'interface, nommage par l'API Claude, lecture des noms.
//   node <pilote-cdp> dev/essai-reel.mjs <dossier-captures>
// Consomme de vrais jetons. Photos dans dev/fixtures/reel/ ; contexte réglable par RENOMMEUR_CONTEXTE.
const BASE = 'http://localhost:5173/';
const CONTEXTE =
  process.env.RENOMMEUR_CONTEXTE ??
  'Pixim, agence de communication à Saumur : visuels de nos réalisations (vidéo, print, sites web) pour la page Réalisations du site';
const PHOTOS = ['IMG_5101.jpg', 'DSC_0042.jpg', 'mockup final v3.jpg', 'Scan_20240312.jpg', 'AVV2018-23-abby-pixim_DSC3539.jpg', 'image.jpg'];

export const scenarios = [
  {
    nom: 'Nommage réel',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`
        const ctx = document.querySelector('#context');
        ctx.value = ${JSON.stringify(CONTEXTE)}; ctx.dispatchEvent(new Event('input', {bubbles: true}));
        const dt = new DataTransfer();
        for (const n of ${JSON.stringify(PHOTOS)}) dt.items.add(new File([await fetch('/dev/fixtures/reel/' + encodeURIComponent(n)).then(r => r.blob())], n, {type: 'image/jpeg'}));
        const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true}));
        const R = window.__renommeur;
        for (let i = 0; i < 100 && R.app.entries.some(e => e.status === 'reading'); i++) await new Promise(r => setTimeout(r, 100));
        document.querySelector('.bar .btn-rouge').click();`);
      const t0 = Date.now();
      const result = await p.eval(`
        const R = window.__renommeur;
        for (let i = 0; i < 1200 && R.app.entries.some(e => !['done', 'error'].includes(e.status)); i++) await new Promise(r => setTimeout(r, 100));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return [...document.querySelectorAll('.rows li')].map(li => {
          const e = R.app.entries.find(x => x.id === li.dataset.id);
          return { origine: e.file.name, statut: e.status, nom: li.querySelector('.name-btn')?.getAttribute('aria-label')?.replace('Modifier le nom : ', '') ?? null, alt: e.alt, erreur: e.error };
        });`);
      log(`durée : ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      log(JSON.stringify(result, null, 2));
      log(await p.shot('essai-reel-1280'));
    },
  },
];

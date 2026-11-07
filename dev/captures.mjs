// Captures et contrôles de comportement, à lancer avec un pilote Chrome DevTools :
//   RENOMMEUR_PW=… node <pilote-cdp> dev/captures.mjs <dossier-captures>
// Il faut `npm run api` et `npm run dev` lancés. Les états sont posés via window.__renommeur (dev).
const BASE = 'http://localhost:5173/';
const PW = process.env.RENOMMEUR_PW ?? '';

const FIXTURES = [
  'IMG_2034.JPG',
  'IMG_2035.JPG',
  'DSC00012.jpeg',
  'Photo équipe 2024 (copie).png',
  'Document numérisé 3.pdf',
  'devis final V2.docx',
  'Classeur1.xlsx',
  'IMG_4410.HEIC',
  'vitrine.jpg',
];

// Un état par fichier : [statut, nom, alt, modifié].
const PLAN = [
  ['done', 'vitrine-boulangerie-martin-annecy', 'Vitrine de la boulangerie Martin à Annecy, pains et viennoiseries exposés derrière la vitre', false],
  ['done', 'croissants-pur-beurre-boulangerie-martin', 'Croissants pur beurre dorés alignés sur une plaque de cuisson', false],
  ['naming', '', '', false],
  ['done', 'equipe-boulangerie-martin-devant-le-fournil', 'L’équipe de la boulangerie Martin réunie devant le fournil', true],
  ['done', 'carte-des-patisseries-boulangerie-martin-annecy', '', false],
  ['queued', '', '', false],
  ['error', '', '', false],
  ['done', 'baguettes-tradition-panier-osier-boulangerie-martin-annecy-centre-ville', 'Baguettes tradition dressées dans un panier en osier', false],
  ['done', 'vitrine-boulangerie-martin-annecy', 'Vitrine de la boulangerie, vue de la rue', false],
];

// Deux images de rendu : les lignes en content-visibility ne sont peintes qu'après.
const PAINT = 'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));';

async function shot(p, name) {
  await p.eval(PAINT);
  return p.shot(name);
}

async function login(p) {
  await p.eval(`await fetch('api/logout.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    const r = await fetch('api/login.php', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: ${JSON.stringify(PW)}})});
    return r.status;`);
}

async function seed(p, { apiProblem = null, plan = PLAN, names = FIXTURES } = {}) {
  await p.eval(`
    const R = window.__renommeur;
    const names = ${JSON.stringify(names)};
    const files = [];
    for (const n of names) {
      const src = n.startsWith('copie-') ? 'IMG_2034.JPG' : n;
      files.push(new File([await fetch('/dev/fixtures/' + encodeURIComponent(src)).then(r => r.blob())], n));
    }
    R.addFiles(files);
    for (let i = 0; i < 80 && R.app.entries.some(e => e.status === 'reading'); i++) await new Promise(r => setTimeout(r, 100));
    const plan = ${JSON.stringify(plan)};
    R.app.entries.forEach((e, i) => {
      const [s, slug, alt, edited] = plan[i] ?? ['ready', '', '', false];
      e.status = s; e.slug = slug; e.alt = alt; e.edited = edited;
      if (s === 'error') e.error = 'Claude est momentanément surchargé.';
    });
    R.app.apiProblem = ${JSON.stringify(apiProblem)};
    await new Promise(r => setTimeout(r, 1400));`);
}

export const scenarios = [
  {
    nom: 'Connexion',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 860 });
      await p.eval(`await fetch('api/logout.php', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); location.reload();`);
      await p.sleep(1500);
      log(await shot(p, '01-connexion-1280'));
      await p.eval(`document.querySelector('form button[type=submit]').click(); await new Promise(r => setTimeout(r, 300));`);
      log(await shot(p, '02-connexion-erreur-1280'));
      await p.goto(BASE, { width: 375, height: 812 });
      log(await shot(p, '03-connexion-375'));
      await p.eval(`window.__renommeur.app.fatal = 'Impossible de joindre le serveur.';`);
      log(await shot(p, '03b-erreur-fatale-375'));
    },
  },
  {
    nom: 'Espace vide',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 860 });
      await login(p);
      await p.goto(BASE, { width: 1280, height: 860 });
      await p.sleep(1500);
      log(await shot(p, '04-vide-avec-bandeau-1280'));
      await p.eval(`window.__renommeur.app.apiProblem = null; window.__renommeur.app.settings.mock = true;`);
      log(await shot(p, '05-vide-mode-demo-1280'));
      await p.eval(`window.__renommeur.app.settings.mock = false;
        const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.jpg')); window.dispatchEvent(new DragEvent('dragenter', {dataTransfer: dt, bubbles: true})); await new Promise(r => setTimeout(r, 400));`);
      log(await shot(p, '06-voile-depot-1280'));
      await p.eval(`const d = new DataTransfer(); d.items.add(new File(['x'], 'a.jpg')); window.dispatchEvent(new DragEvent('dragleave', {dataTransfer: d, bubbles: true}));`);
    },
  },
  {
    nom: 'Liste',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 860 });
      await seed(p);
      log(await shot(p, '07-liste-haut-1280'));
      await p.eval(`window.scrollTo(0, 480);`);
      log(await shot(p, '08-liste-defilee-1280'));
      // Édition d'un nom avec saisie non normalisée, puis Échap.
      await p.eval(`document.querySelector('.rows li .name-btn').click(); await new Promise(r => setTimeout(r, 200));
        const t = document.querySelector('textarea.slug'); t.value = 'Vitrine Boulangerie Martin, Été 2026'; t.dispatchEvent(new Event('input', {bubbles: true}));
        window.scrollTo(0, 300);`);
      log(await shot(p, '09-edition-nom-1280'));
      await p.eval(`document.querySelector('textarea.slug').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        const R = window.__renommeur; R.app.entries[5].status = 'ready';
        R.app.apiProblem = 'Cette clé n’est rattachée à aucun espace de travail.'; window.scrollTo(0, 0);`);
      log(await shot(p, '10-liste-api-indisponible-1280'));
      await p.eval(`window.__renommeur.app.apiProblem = null; window.__renommeur.app.entries[2].status = 'ready';`);
      log(await shot(p, '10b-bouton-nommer-1280'));
      await p.eval(`document.getElementById('clear-ask').click(); await new Promise(r => setTimeout(r, 200));`);
      log(await shot(p, '10c-confirmation-tout-retirer-1280'));
      const afterCancel = await p.eval(`document.getElementById('clear-cancel').click(); await new Promise(r => setTimeout(r, 200)); return document.activeElement.id;`);
      log('focus après Annuler :', afterCancel);
      // Doublon relu dans le filtre « Doublons », validé par Entrée : la ligne sort de la vue.
      const dup = await p.eval(`
        const errs = []; window.addEventListener('error', e => errs.push(e.message));
        [...document.querySelectorAll('.filters button')].find(b => b.textContent.startsWith('Doublons')).click();
        await new Promise(r => setTimeout(r, 200));
        document.querySelector('.rows li .name-btn').click(); await new Promise(r => setTimeout(r, 200));
        const t = document.querySelector('textarea.slug'); t.value = 'vitrine-vue-de-la-rue'; t.dispatchEvent(new Event('input', {bubbles: true}));
        t.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        await new Promise(r => setTimeout(r, 300));
        return { erreurs: errs, focus: document.activeElement.tagName + '.' + document.activeElement.className };`);
      log('doublon validé :', JSON.stringify(dup));
      // Tout nommé : le ZIP devient l'action principale. Un fichier déjà présent déclenche le toast.
      await p.eval(`[...document.querySelectorAll('.filters button')][0].click();
        const R = window.__renommeur; R.app.entries.forEach((e, i) => { if (e.status !== 'done') { e.slug = 'fichier-exemple-' + i; e.status = 'done'; } });
        await new Promise(r => setTimeout(r, 1400));
        const input = document.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(R.app.entries[0].file); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true}));
        window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 400));`);
      log(await shot(p, '11-tout-nomme-toast-1280'));
      const removed = await p.eval(`const li = document.querySelectorAll('.rows li')[1]; li.querySelector('.remove').click(); await new Promise(r => setTimeout(r, 300));
        const a = document.activeElement; return a.closest('li')?.dataset.id + ' ' + a.className;`);
      log('focus après Retirer :', removed);
      const m = await p.eval(`const row = document.querySelector('.rows li'); const bar = document.querySelector('.bar');
        return { ligne: row.getBoundingClientRect().height, barre: bar.getBoundingClientRect().height, barH: getComputedStyle(document.documentElement).getPropertyValue('--bar-h'), debordement: document.documentElement.scrollWidth > innerWidth };`);
      log('mesures', JSON.stringify(m));
    },
  },
  {
    nom: 'Enchaînement au clavier sur 30 lignes',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 860 });
      const names = Array.from({ length: 30 }, (_, i) => `copie-${i + 1}.jpg`);
      const plan = names.map((n, i) => ['done', `photo-vitrine-numero-${i + 1}`, `Vitrine de la boulangerie, vue ${i + 1}`, false]);
      await seed(p, { names, plan });
      const res = await p.eval(`
        const bar = () => document.querySelector('.bar').getBoundingClientRect().top;
        document.querySelector('.rows li .name-btn').click(); await new Promise(r => setTimeout(r, 200));
        const out = [];
        for (let i = 0; i < 14; i++) {
          const t = document.querySelector('textarea.slug');
          t.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
          await new Promise(r => setTimeout(r, 250));
          const n = document.querySelector('textarea.slug');
          if (n) out.push(Math.round(n.getBoundingClientRect().bottom) < Math.round(bar()) ? 'ok' : 'CACHÉ');
        }
        return out.join(' ');`);
      log('éditeur visible après chaque Entrée :', res);
    },
  },
  {
    nom: 'Tablette et mobile',
    async run(p, log) {
      await p.goto(BASE, { width: 900, height: 900 });
      await seed(p);
      log(await shot(p, '12-liste-900'));
      await p.goto(BASE, { width: 375, height: 812 });
      await p.sleep(800);
      log(await shot(p, '13-vide-375'));
      await seed(p);
      log(await shot(p, '14-liste-375'));
      await p.eval(`window.scrollTo(0, 700);`);
      log(await shot(p, '15-liste-defilee-375'));
      await p.eval(`document.querySelector('.rows li .more').click(); await new Promise(r => setTimeout(r, 500));`);
      log(await shot(p, '16-feuille-actions-375'));
      const m = await p.eval(`return { debordement: document.documentElement.scrollWidth > innerWidth, largeur: document.documentElement.scrollWidth, vue: innerWidth, focusFeuille: document.activeElement.closest('#row-sheet') ? 'dans la feuille' : document.activeElement.tagName };`);
      log('mesures', JSON.stringify(m));
      await p.goto(BASE, { width: 360, height: 760 });
      await seed(p, { plan: PLAN.map(([, slug, alt]) => ['done', slug || 'fichier-sans-nom', alt, false]) });
      const narrow = await p.eval(`${PAINT} return { debordement: document.documentElement.scrollWidth > innerWidth, largeur: document.documentElement.scrollWidth };`);
      log('360 px', JSON.stringify(narrow));
    },
  },
];

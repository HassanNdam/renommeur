// Captures des trois traitements (Renommer, Compresser, Les deux) pour revue de design, à 1280, 1024 et 375 px.
// Aucun appel à Claude : en « Les deux », les statuts de nommage sont posés à la main ; la compression, elle, tourne pour de vrai.
//   RENOMMEUR_PW=… node <pilote-cdp> dev/captures-compression.mjs <dossier-captures>
const BASE = 'http://localhost:5173/';
const PW = process.env.RENOMMEUR_PW ?? '';
const LOT = ['compression/grande.jpg', 'compression/photo.png', 'compression/detoure.png', 'compression/capture.png', 'compression/photo-exif6.jpg', 'vitrine.jpg', 'Document numérisé 3.pdf', 'IMG_4410.HEIC'];
const NOMS = ['facade-hotel-de-ville-saumur-panorama', 'salon-lumineux-canape-gris', 'chaise-design-detouree-fond-transparent', 'capture-tableau-de-bord-statistiques', 'portrait-artisan-atelier-bois', 'vitrine-boulangerie-martin-annecy', 'carte-des-patisseries-boulangerie-martin', ''];
const CONTEXTE = 'Boulangerie Martin à Annecy, photos de la vitrine et des produits pour la page Boutique.';
const WAIT = 'await new Promise(r => setTimeout(r, 500)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));';
const PAINT = 'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));';
// Le cadre de réglages et le bandeau entrent en fondu (200 ms) : on attend sa fin après chaque changement de mode.
const FONDU = 'await new Promise(r => setTimeout(r, 300));';

const AJOUT = `
    const dt = new DataTransfer();
    for (const n of ${JSON.stringify(LOT)}) dt.items.add(new File([await fetch('/dev/fixtures/' + n.split('/').map(encodeURIComponent).join('/')).then(r => r.blob())], n.split('/').pop()));
    const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`;

const NOMMER = `
    const noms = ${JSON.stringify(NOMS)};
    const nommer = (e, i) => {
      if (noms[i]) { e.slug = noms[i]; e.alt = i < 5 ? 'Texte alternatif proposé pour ' + noms[i].replaceAll('-', ' ') : ''; e.status = 'done'; }
      else { e.status = 'error'; e.error = 'Claude est momentanément surchargé.'; }
    };`;

/** Hauteur de chaque ligne de la liste, dans l'ordre. */
const HAUTEURS = `[...document.querySelectorAll('.rows li[data-id]')].map((li) => Math.round(li.getBoundingClientRect().height))`;

/** Bandeau replié : hauteur, largeur du texte de contexte (au moins 150 px à 1024), débordement horizontal. */
const BANDEAU = `
  const b = document.querySelector('.brief-compact'), c = document.querySelector('.ctx-text');
  return { bandeau: b ? Math.round(b.getBoundingClientRect().height) : null, contexte: c ? Math.round(c.getBoundingClientRect().width) : null,
    debordement: document.documentElement.scrollWidth > innerWidth };`;

async function shot(p, name) {
  await p.eval(WAIT);
  return p.shot(name);
}

async function mode(p, m) {
  await p.eval(`window.__renommeur.setMode(${JSON.stringify(m)}); ${FONDU}`);
}

async function load(p, { mode: m, names = false, contexte = '' }) {
  await p.eval(`
    const R = window.__renommeur; R.setMode(${JSON.stringify(m)}); ${FONDU}
    R.app.context = ${JSON.stringify(contexte)};
    ${AJOUT}
    for (let i = 0; i < 600 && R.app.entries.some(e => e.status === 'reading' || e.press === 'wait' || e.press === 'run'); i++) await new Promise(r => setTimeout(r, 100));
    if (${names}) {
      ${NOMMER}
      R.app.entries.forEach(nommer);
    }
    await new Promise(r => setTimeout(r, 1300)); window.scrollTo(0, 0);`);
}

/**
 * « Les deux » pendant la compression : chaque ligne reçoit son nom dès sa lecture finie, et la capture part dès que
 * des lignes nommées montrent leur poids compressé alors que d'autres compressent encore (l'état où une ligne sauterait).
 * Puis on attend la fin et on compare la hauteur de chaque ligne.
 */
async function during(p, largeur) {
  const r = await p.eval(`
    const R = window.__renommeur; R.setMode('both'); ${FONDU}
    ${AJOUT}
    ${NOMMER}
    const nommes = new Set();
    const nommerLus = () => R.app.entries.forEach((e, i) => { if (e.status !== 'reading' && !nommes.has(e.id)) { nommer(e, i); nommes.add(e.id); } });
    let probant = false;
    for (let i = 0; i < 1000; i++) {
      nommerLus();
      const press = R.app.entries.map(e => e.press);
      const enCours = press.some(x => x === 'wait' || x === 'run');
      if (nommes.size && press.some(x => x === 'done' || x === 'same') && enCours) { probant = true; break; }
      if (!enCours && !R.app.entries.some(e => e.status === 'reading')) break;
      await new Promise(r => setTimeout(r, 30));
    }
    window.scrollTo(0, 0); ${PAINT}
    return { probant, press: R.app.entries.map(e => e.press), hauteurs: ${HAUTEURS} };`);
  const file = await p.shot(`v-compression-en-cours-both-${largeur}`);
  const fin = await p.eval(`
    const R = window.__renommeur;
    ${NOMMER}
    for (let i = 0; i < 600 && R.app.entries.some(e => e.status === 'reading' || e.press === 'wait' || e.press === 'run'); i++) await new Promise(r => setTimeout(r, 100));
    R.app.entries.forEach((e, i) => { if (e.status !== 'done' && e.status !== 'error') nommer(e, i); });
    await new Promise(r => setTimeout(r, 500)); window.scrollTo(0, 0); ${PAINT}
    return { hauteurs: ${HAUTEURS} };`);
  const bouge = r.hauteurs.map((h, i) => (fin.hauteurs[i] !== h ? `n° ${i + 1} : ${h} → ${fin.hauteurs[i]} px` : null)).filter(Boolean);
  return { file, probant: r.probant, press: r.press, avant: r.hauteurs, apres: fin.hauteurs, bouge };
}

function logDuring(log, d, largeur) {
  log(d.file);
  log(d.probant ? `en cours (${largeur}) : ${d.press.join(' ')}` : `NON PROBANT (${largeur}) : compression finie avant la capture`);
  log(`hauteurs pendant ${JSON.stringify(d.avant)}, après ${JSON.stringify(d.apres)}`);
  log(d.bouge.length ? `LIGNES QUI BOUGENT : ${d.bouge.join(' ; ')}` : 'aucune ligne ne bouge');
}

export const scenarios = [
  {
    nom: 'États vides',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 860 });
      await p.eval(`await fetch('api/login.php', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: ${JSON.stringify(PW)}})}); localStorage.removeItem('renommeur.squeeze');`);
      for (const width of [1280, 1024]) {
        for (const m of ['rename', 'compress', 'both']) {
          await p.goto(BASE, { width, height: 860 });
          await mode(p, m);
          log(await shot(p, `v-vide-${m}-${width}`));
        }
      }
      for (const m of ['both', 'compress']) {
        await p.goto(BASE, { width: 375, height: 812 });
        await mode(p, m);
        log(await shot(p, `v-vide-${m}-375`));
        log(`débordement 375 (${m})`, await p.eval(`return document.documentElement.scrollWidth > innerWidth;`));
      }
    },
  },
  {
    nom: 'Les deux',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 900 });
      await load(p, { mode: 'both', names: true });
      log(await shot(p, 'v-liste-both-1280'));
      log('bandeau 1280', JSON.stringify(await p.eval(BANDEAU)));
      await p.eval(`document.getElementById('cmp-edit-btn')?.click(); ${FONDU}`);
      log('réglages ouverts', await p.eval(`return !!document.querySelector('.brief-compact .cmp-edit');`));
      log(await shot(p, 'v-reglages-ouverts-both-1280'));
      await p.goto(BASE, { width: 375, height: 812 });
      await load(p, { mode: 'both', names: true });
      log(await shot(p, 'v-liste-both-375'));
      log('débordement 375', await p.eval(`return document.documentElement.scrollWidth > innerWidth;`));
    },
  },
  {
    nom: 'Les deux pendant la compression, noms posés',
    async run(p, log) {
      for (const [width, height] of [[1280, 900], [375, 812]]) {
        await p.goto(BASE, { width, height });
        logDuring(log, await during(p, width), width);
        log(await shot(p, `v-compression-finie-both-${width}`));
      }
    },
  },
  {
    nom: 'Compresser et Renommer',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 900 });
      await load(p, { mode: 'compress' });
      log(await shot(p, 'v-liste-compress-1280'));
      await p.goto(BASE, { width: 375, height: 812 });
      await load(p, { mode: 'compress' });
      log(await shot(p, 'v-liste-compress-375'));
      log('débordement 375', await p.eval(`return document.documentElement.scrollWidth > innerWidth;`));
      await p.goto(BASE, { width: 1280, height: 900 });
      await load(p, { mode: 'rename', names: true });
      log(await shot(p, 'v-liste-rename-1280'));
    },
  },
  {
    nom: 'Trois traitements à 1024 px',
    async run(p, log) {
      // Contexte rempli : la checklist demande au moins 150 px pour son texte dans le bandeau à 1024.
      for (const [m, names] of [['rename', true], ['compress', false], ['both', true]]) {
        await p.goto(BASE, { width: 1024, height: 900 });
        await load(p, { mode: m, names, contexte: CONTEXTE });
        log(await shot(p, `v-liste-${m}-1024`));
        log(`bandeau 1024 (${m})`, JSON.stringify(await p.eval(BANDEAU)));
      }
    },
  },
];

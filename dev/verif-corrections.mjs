// Vérifie dans la vraie interface les défauts relevés par la revue de la compression.
//   node <pilote-cdp> dev/verif-corrections.mjs <dossier-captures>
const BASE = 'http://localhost:5173/';
const REELS = ['pieuvre1.jpg', 'pieuvre5.jpg', 'aladdin1.jpg', 'grandchenille3.jpg', 'photo-1507754988072-8667848efc79.jpg', 'background-04.png', 'conductrice-flexibus-audouard-voyages.png'];

// Cherche des métadonnées dans des octets : segment EXIF, IFD GPS (0x8825, dans les deux boutismes), XMP, chunks PNG de texte.
const SCAN = `
  const scan = async (blob) => {
    const b = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
    const s = new TextDecoder('latin1').decode(b);
    const exif = s.indexOf('Exif\\0\\0');
    let gps = false;
    if (exif >= 0) for (let i = exif; i < Math.min(b.length - 1, exif + 65536); i++) if ((b[i] === 0x88 && b[i + 1] === 0x25) || (b[i] === 0x25 && b[i + 1] === 0x88)) { gps = true; break; }
    return { exif: exif >= 0, gps, xmp: s.includes('http://ns.adobe.com/xap/1.0/'), pngTexte: ['eXIf', 'tEXt', 'iTXt', 'zTXt'].filter((c) => s.includes(c)) };
  };`;

const WAIT_ALL = `for (let i = 0; i < 1800 && R.app.entries.some(e => e.status === 'reading' || e.press === 'wait' || e.press === 'run'); i++) await new Promise(r => setTimeout(r, 100));`;

async function add(p, paths) {
  await p.eval(`
    const dt = new DataTransfer();
    for (const n of ${JSON.stringify(paths)}) dt.items.add(new File([await fetch('/dev/fixtures/' + n.split('/').map(encodeURIComponent).join('/')).then(r => r.blob())], n.split('/').pop()));
    const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`);
}

export const scenarios = [
  {
    nom: 'Métadonnées des sorties',
    async run(p, log) {
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`localStorage.removeItem('renommeur.squeeze');`);
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`window.__renommeur.setMode('compress'); await new Promise(r => setTimeout(r, 300));`);
      await add(p, [...REELS.map((f) => 'reels-lourds/' + f), 'compression/photo-exif6.jpg', 'vitrine.jpg']);
      const rows = await p.eval(`${SCAN} const R = window.__renommeur; ${WAIT_ALL}
        const out = [];
        for (const e of R.app.entries) out.push({ fichier: e.file.name, statut: e.press, avant: await scan(e.file), apres: e.output ? await scan(e.output.blob) : null, ko: e.output ? Math.round(e.output.blob.size / 1024) : null });
        return out;`);
      for (const r of rows) log(JSON.stringify(r));
      const fuite = rows.filter((r) => r.apres && (r.apres.gps || r.apres.exif || r.apres.xmp || r.apres.pngTexte.length));
      log(fuite.length ? `FUITE : ${fuite.map((r) => r.fichier).join(', ')}` : 'Aucune métadonnée EXIF, GPS, XMP ni texte PNG dans les sorties.');
    },
  },
  {
    nom: 'Gardes et noms',
    async run(p, log) {
      // Réglage recliqué : aucune relance.
      const relance = await p.eval(`const R = window.__renommeur; const avant = R.app.entries.map(e => e.press).join(); R.setCompression({ level: 'equilibree' }); await new Promise(r => setTimeout(r, 700)); return { avant, apres: R.app.entries.map(e => e.press).join() };`);
      log('réglage identique recliqué, statuts inchangés :', relance.avant === relance.apres);
      // Changement de traitement refusé pendant un ZIP.
      const garde = await p.eval(`const R = window.__renommeur; R.app.zipping = 1; R.setMode('rename'); const pendant = R.app.mode; await new Promise(r => setTimeout(r, 300));
        const seg = [...document.querySelectorAll('[aria-disabled="true"]')].length; R.app.zipping = 0; return { pendant, segDesactives: seg };`);
      log('pendant un ZIP :', JSON.stringify(garde));
      // Vrai JPG face à un PNG converti : on dépose le PNG d'abord.
      await p.goto(BASE, { width: 1280, height: 900 });
      await p.eval(`window.__renommeur.setMode('compress'); await new Promise(r => setTimeout(r, 300));`);
      await add(p, ['compression/photo.png', 'compression/photo.jpg']);
      const noms = await p.eval(`const R = window.__renommeur; ${WAIT_ALL} return R.app.entries.map(e => e.file.name + ' → ' + R.view.fileNames.get(e.id) + ' (' + e.press + (e.pressNote ? ', ' + e.pressNote : '') + ')');`);
      log('noms :', JSON.stringify(noms));
    },
  },
];

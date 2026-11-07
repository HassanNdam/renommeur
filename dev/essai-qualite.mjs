// Contrôle visuel de la compression : recadrage 1:1 de l'original (ramené à la taille de sortie par le
// navigateur) à gauche, de la sortie compressée à droite. Réglages par défaut, mode « Compresser ».
//   RENOMMEUR_LOT='["reels-lourds/pieuvre1.jpg"]' node <pilote-cdp> dev/essai-qualite.mjs <dossier-captures>
const BASE = 'http://localhost:5173/';
const LOT = JSON.parse(process.env.RENOMMEUR_LOT ?? '["reels-lourds/pieuvre1.jpg"]');

export const scenarios = [
  {
    nom: 'Comparaison 1:1',
    async run(p, log) {
      await p.goto(BASE, { width: 1400, height: 900 });
      await p.eval(`localStorage.removeItem('renommeur.squeeze');`);
      await p.goto(BASE, { width: 1400, height: 900 });
      for (const [i, n] of LOT.entries()) {
        const info = await p.eval(`
          const R = window.__renommeur; R.setMode('compress');
          const file = new File([await fetch('/dev/fixtures/' + ${JSON.stringify(n)}.split('/').map(encodeURIComponent).join('/')).then(r => r.blob())], ${JSON.stringify(n)}.split('/').pop());
          R.addFiles([file]);
          let e; for (let k = 0; k < 600; k++) { e = R.app.entries.find(x => x.file === file); if (e && ['done','same','fail','skip'].includes(e.press)) break; await new Promise(r => setTimeout(r, 100)); }
          const out = await createImageBitmap(e.output.blob);
          const ref = await createImageBitmap(file, { resizeWidth: out.width, resizeHeight: out.height, resizeQuality: 'high', imageOrientation: 'from-image' });
          const W = 660, H = 760, x = Math.max(0, Math.round(out.width / 2 - W / 2)), y = Math.max(0, Math.round(out.height * 0.45 - H / 2));
          document.body.innerHTML = '<div id="cmp" style="display:flex;gap:16px;padding:16px;background:#fff;font:14px sans-serif"></div>';
          for (const [label, bmp] of [['Original ramené à ' + out.width + ' × ' + out.height + ' (' + Math.round(file.size / 1024) + ' Ko)', ref], ['Compressé (' + Math.round(e.output.blob.size / 1024) + ' Ko)', out]]) {
            const fig = document.createElement('figure'); fig.style.margin = '0';
            const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(bmp, x, y, W, H, 0, 0, W, H);
            const cap = document.createElement('figcaption'); cap.textContent = label; fig.append(c, cap); document.getElementById('cmp').append(fig);
          }
          return { fichier: file.name, sortie: out.width + 'x' + out.height, ko: Math.round(e.output.blob.size / 1024) };`);
        log(JSON.stringify(info));
        log(await p.shot('q' + (i + 1) + '-' + n.split('/').pop().replace(/\.[^.]+$/, ''), '#cmp', 0));
        await p.goto(BASE, { width: 1400, height: 900 });
      }
    },
  },
];

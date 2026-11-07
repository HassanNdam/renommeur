// Prépare release/renommeur/ : le dossier à envoyer tel quel par FTP, plus une copie zippée.
// api/config.php et api/var/ ne sont jamais livrés : ils vivent sur le serveur.
import { build } from 'vite';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'release', 'renommeur');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const apiVersion = readFileSync(join(root, 'api', 'bootstrap.php'), 'utf8').match(/const APP_VERSION = '([^']*)';/)?.[1];
if (apiVersion !== version) {
  console.error(`Versions différentes : package.json ${version}, api/bootstrap.php ${apiVersion}. Lancez « node scripts/sync-version.mjs ».`);
  process.exit(1);
}

if (!existsSync(join(root, 'api', 'vendor', 'autoload.php'))) {
  console.error('api/vendor absent : lancez « composer install » dans api/ avant la livraison.');
  process.exit(1);
}

await build({ root, logLevel: 'warn' });

rmSync(join(root, 'release'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'dist'), out, { recursive: true });

const skipped = (path) => {
  const rel = relative(join(root, 'api'), path).split(sep).join('/');
  return (
    rel === 'config.php' ||
    rel === 'composer.json' ||
    rel === 'composer.lock' ||
    rel === 'var' ||
    rel.startsWith('var/') ||
    // Documentation, exemples et tests des dépendances : inutiles en production.
    /^vendor\/.+\/(examples|fixtures|tests|docs)(\/|$)/.test(rel) ||
    /^vendor\/.+\.md$/.test(rel)
  );
};
cpSync(join(root, 'api'), join(out, 'api'), { recursive: true, filter: (src) => !skipped(src) });

const files = {};
(function collect(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path);
    else files[`renommeur/${relative(out, path).split(sep).join('/')}`] = readFileSync(path);
  }
})(out);
writeFileSync(join(root, 'release', `renommeur-${version}.zip`), zipSync(files, { level: 6 }));

console.log(`release/renommeur/ prêt (${Object.keys(files).length} fichiers) + release/renommeur-${version}.zip`);

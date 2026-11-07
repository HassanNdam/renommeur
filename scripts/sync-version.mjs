// Recopie la version de package.json dans APP_VERSION (api/bootstrap.php).
// Lancé tout seul par `npm version …` ; avec --check, échoue si les deux diffèrent (CI, release).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(root, 'api', 'bootstrap.php');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const php = readFileSync(file, 'utf8');
const pattern = /const APP_VERSION = '([^']*)';/;
const current = php.match(pattern)?.[1];

if (current === undefined) {
  console.error('APP_VERSION introuvable dans api/bootstrap.php.');
  process.exit(1);
}
if (process.argv.includes('--check')) {
  if (current !== version) {
    console.error(`Versions différentes : package.json ${version}, api/bootstrap.php ${current}. Lancez « node scripts/sync-version.mjs ».`);
    process.exit(1);
  }
  console.log(`Version ${version} alignée.`);
} else if (current !== version) {
  writeFileSync(file, php.replace(pattern, `const APP_VERSION = '${version}';`));
  console.log(`APP_VERSION : ${current} → ${version}`);
}

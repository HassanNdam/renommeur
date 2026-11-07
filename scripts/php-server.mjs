// Serveur PHP de développement pour api/ (le proxy de Vite y envoie /api/*).
// PHP_BIN choisit l'exécutable ; à défaut, `php` du PATH puis la dernière version 8.x de Laragon.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function findPhp() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;
  if (spawnSync('php', ['-v']).status === 0) return 'php';
  const laragon = 'C:/laragon/bin/php';
  if (existsSync(laragon)) {
    const versions = readdirSync(laragon).filter((d) => /^php-8\.[1-4]\./.test(d)).sort();
    if (versions.length) return join(laragon, versions.at(-1), 'php.exe');
  }
  throw new Error('PHP introuvable : définissez PHP_BIN.');
}

const args = ['-S', '127.0.0.1:8090', '-t', join(root, 'api')];
// Antivirus ou proxy qui inspecte le TLS : son certificat racine (.tmp/ca.pem) est ajouté à la liste de PHP.
const ca = join(root, '.tmp', 'ca.pem');
if (existsSync(ca)) args.unshift('-d', `curl.cainfo=${ca}`, '-d', `openssl.cafile=${ca}`);

const php = findPhp();
console.log(`API PHP sur http://127.0.0.1:8090 (${php})`);
spawn(php, args, { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));

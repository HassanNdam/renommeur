# Mise en ligne, réglages et sécurité

## Mise en ligne sur OVH

1. **Un sous-domaine dédié**, par exemple `renommeur.pixim.fr`, déclaré en Multisite dans le Manager OVH et pointé vers un dossier à lui (`renommeur/`). Activer le certificat SSL.
2. **PHP 8.1 au minimum** (8.3 conseillé). Si le dossier n'a pas déjà son `.ovhconfig`, en déposer un à sa racine :
   ```
   app.engine=php
   app.engine.version=8.3
   http.firewall=none
   environment=production
   container.image=stable64
   ```
3. **Fabriquer le paquet** sur le poste : `npm ci` puis `npm run release`. On obtient `release/renommeur/` (à envoyer tel quel) et la même chose zippée, `release/renommeur-<version>.zip` (version lue dans `package.json`, 0.2.0 depuis la compression). Le script vide `release/` d'abord : un ancien paquet ne peut pas partir par erreur. Avant l'envoi, vérifier que `assets/` contient les 5 codecs (`mozjpeg_enc-*.wasm`, `webp_enc-*.wasm`, `webp_enc_simd-*.wasm`, `squoosh_oxipng_bg-*.wasm`, `libimagequant_wasm_bg-*.wasm`) et un `worker-*.js`, et que `licences.txt` est à la racine.
4. **Envoyer par FTP** le contenu de `release/renommeur/` dans le dossier du sous-domaine. Les dépendances PHP représentent environ 3 800 fichiers : la première fois, FileZilla y passe quelques minutes.
5. **Créer `api/config.php` sur le serveur** à partir de `api/config.sample.php` : clé API, modèle, `'mock' => false`. Pour la clé, le plus simple est de créer dans console.anthropic.com un espace de travail dédié, par exemple « Renommeur », puis une clé dans cet espace : les coûts de l'outil y sont suivis à part, et on peut leur fixer un plafond. Une clé d'utilisateur (`sk-ant-usr…`), valable sur plusieurs espaces de travail, marche aussi, à condition de renseigner `workspace_id` (`wrkspc_…`).
6. **Ouvrir l'adresse.** Si un bandeau « Nommage indisponible » apparaît, il dit pourquoi : clé absente ou refusée, modèle inconnu, serveur qui ne joint pas api.anthropic.com.
7. **Contrôler les en-têtes des codecs.** Une vraie requête GET dont on n'affiche que les en-têtes (`curl -I` n'envoie pas `Accept-Encoding` : le serveur ne compresse pas, et le gzip ne se voit pas). Les noms exacts sont dans `release/renommeur/assets/`. Sous PowerShell, taper `curl.exe` et non `curl` ; sous Git Bash, remplacer `-o NUL` par `-o /dev/null`.
   ```
   curl.exe -s -o NUL -D - -H "Accept-Encoding: gzip" https://renommeur.pixim.fr/assets/mozjpeg_enc-DO-zoExo.wasm
   ```
   Attendu : `Content-Type: application/wasm`, `Content-Encoding: gzip`, `Cache-Control: max-age=31536000`. Même contrôle sur `assets/pdf.worker.min-*.mjs` : `text/javascript` et gzip.
   ```
   curl.exe -s -o NUL -D - https://renommeur.pixim.fr/assets/worker-XXXXXXXX.js
   ```
   Attendu : un en-tête `Content-Security-Policy` qui contient `'wasm-unsafe-eval'`. Un worker applique la CSP de sa propre réponse : sans cette valeur, les codecs ne se compilent pas et l'outil passe sur l'encodeur natif, moins efficace. Enfin, `licences.txt` doit répondre `Content-Type: text/plain; charset=utf-8`, et la console du navigateur ne doit signaler aucune violation de CSP pendant un lot.

**Mettre à jour** : `npm ci`, `npm run release`, puis renvoyer le dossier et refaire le contrôle 7. `api/config.php` et `api/var/` ne font pas partie du paquet : ils ne sont jamais écrasés.

## Réglages (`api/config.php`)

| Clé | Par défaut | Rôle |
|---|---|---|
| `workspace_id` | vide | Seulement avec une clé d'utilisateur (`sk-ant-usr…`) : l'espace de travail à facturer |
| `model` | `claude-sonnet-5-5` | Coûts mesurés sur un lot réel : `claude-sonnet-5-5` ≈ 2,20 $ / 1 000 images (conseillé), `claude-opus-5-5` ≈ 4,40 $ pour une qualité équivalente, `claude-haiku-5-5` ≈ 0,20 $ avec des noms plus génériques à relire |
| `effort` | `low` | Profondeur de réflexion du modèle ; `low` suffit pour nommer |
| `batch_size` | `8` | Fichiers par requête (1 à 12) |
| `mock` | `false` | `true` : noms factices, aucun appel à l'API |

Avec Opus et Sonnet, la requête active le repli automatique d'Anthropic (`fallbacks: "default"`) : si un filtre de sécurité refuse un lot, un modèle voisin le traite. Haiku n'en a pas.

**Consommation** : chaque appel ajoute une ligne à `api/var/usage.csv` (date ; modèle ; nombre de fichiers ; jetons d'entrée ; jetons de sortie). Le fichier se récupère par FTP.

## Sécurité

- **Aucune connexion :** l'outil s'ouvre directement sur l'espace de travail. Quiconque connaît l'adresse peut lancer des nommages, facturés sur la clé API. Pour en limiter l'accès, protéger le sous-domaine par une authentification HTTP Basic (`.htpasswd`, possible sur le mutualisé OVH) et fixer un plafond de dépenses à l'espace de travail dans console.anthropic.com.
- Les points d'entrée n'acceptent que du JSON, ce qui bloque les formulaires venus d'un autre site.
- `.htaccess` : `vendor/`, `var/`, `config.php` et `bootstrap.php` inaccessibles depuis le web ; en-têtes CSP, `X-Frame-Options`, `nosniff`.
- La clé API ne quitte jamais le serveur.
- `index.html`, `assets/` (scripts et codecs `.wasm`) et `licences.txt` se téléchargent librement : ils ne contiennent ni clé ni donnée, mais quiconque connaît l'adresse en reçoit une copie, module GPL compris (voir [Compression](compression.md), Licence du module PNG).
- CSP : `script-src 'self' 'wasm-unsafe-eval'`. Cette exception sert seulement à compiler les codecs WebAssembly ; aucun `eval` JavaScript. Les workers ne chargent que des fichiers du site.
- La compression a lieu sur le poste : aucune image ne part, en Compresser comme ailleurs.
- Métadonnées : retirées des images compressées ou gardées (EXIF, position GPS, numéro de série de l'appareil). Les fichiers « Tel quel » et « Non compressée », et tous les fichiers en Renommer, partent intacts : penser aux photos d'iPhone en HEIC, que Chrome ne lit pas et qui gardent leur position GPS.

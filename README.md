# Renommeur Pixim

Outil interne : on dépose un lot de fichiers (images, PDF, Word, Excel, PowerPoint, vidéos, textes), Claude propose pour chacun un nom SEO (`vitrine-boulangerie-martin-annecy.jpg`) et un texte alternatif pour les images. On relit, on corrige au besoin, puis on télécharge un ZIP, les fichiers un par un ou la table de correspondance en CSV. Les images peuvent aussi être compressées dans le navigateur, avec ou sans renommage (voir [Compression](#compression)).

## Comment ça marche

```
Navigateur                                   Serveur PHP (OVH mutualisé)     API Claude
fichiers → vignette 768 px / extrait de texte
         → lot de 8 ─────────────────────────► api/name.php ─────────────────► modèle
         ← { name, alt } × 8 ◄───────────────────────────────────────────────◄
format imposé (minuscules, tirets, doublons -2, -3) → ZIP créé dans le navigateur
```

- **Les fichiers ne sont jamais envoyés au serveur.** Seules une vignette JPEG (images, première page des PDF, image d'une vidéo) ou un extrait de texte (Word, Excel, PowerPoint, texte) partent vers l'API. Rien n'est stocké chez OVH.
- Le navigateur envoie 3 lots en parallèle et relance seul un lot en cas d'erreur passagère. Chaque requête ne dure que quelques secondes : pas de file d'attente, pas de tâche planifiée, pas de délai PHP dépassé.
- Claude propose les mots ; le format final (minuscules, sans accents, tirets, 70 caractères au plus, doublons numérotés) est imposé par le code, dans `src/lib/slug.ts`.

## Compression

Trois traitements, au-dessus de la zone de dépôt ; le choix est retenu d'une session à l'autre.

| Traitement | Ce qui part dans le ZIP |
|---|---|
| Renommer | Les fichiers d'origine, intacts, sous les noms de Claude |
| Compresser | Les images compressées, sous leur nom d'origine, extension et casse comprises (pour écraser les fichiers sur le serveur). Aucun appel à Claude. |
| Les deux (par défaut) | Les images compressées, sous les noms de Claude |

**Fonctionnement**

- Tout se passe dans le navigateur, dès le dépôt : aucune image n'est envoyée. Un pool de workers (3 au plus, 2 sur un poste de 4 Go ou moins) encode avec des codecs WebAssembly : MozJPEG pour le JPEG, libwebp pour le WebP, libimagequant puis oxipng pour le PNG. Les codecs (un peu plus d'1 Mo, environ 400 Ko compressés par le serveur) se chargent à la première image qui en a besoin.
- Chaque compression repart du fichier d'origine. Le résultat n'est gardé que s'il pèse au plus 90 % de l'original et fait gagner au moins 10 Ko ; sous 50 Ko, l'image n'est pas réencodée. Un réencodage imposé (redimensionnement, orientation, profil P3, CMJN) n'est gardé que s'il allège le fichier. Seuls BMP, HEIC et TIFF, inutilisables sur un site, sont convertis même plus lourds.
- Statuts d'une ligne : « Compressée » ; « Déjà optimisée » (l'original convient) ; « Tel quel » (GIF, SVG, AVIF, images animées, documents, copiés à l'identique) ; « Non compressée », en ocre, quand l'image ne peut pas être traitée (HEIC ou TIFF que le navigateur ne décode pas, comme Chrome, fichier tronqué, plus de 100 Mpx, compression trop longue), avec la raison sur la ligne.
- Le ZIP s'écrit au fil des résultats : on peut cliquer avant la fin. Pendant l'écriture, le traitement ne peut pas changer, et un réglage modifié ne s'applique qu'une fois le ZIP fini.
- Sans WebAssembly (CSP privée de `'wasm-unsafe-eval'`, `.wasm` servi avec un mauvais type), l'encodeur natif du navigateur prend le relais : JPEG un peu plus lourds, PNG sans palette. Le contrôle 7 de la mise en ligne le vérifie.

**Réglages** : bouton « Modifier » à côté du résumé « Compression » (cadre « Réglages de compression » en Compresser). Ils sont retenus dans le navigateur. Changer un réglage relance la compression : les lignes concernées repassent « En attente ».

| Réglage | Choix | Par défaut |
|---|---|---|
| Niveau | Légère, Équilibrée, Forte (MozJPEG 88, 82, 76) | Équilibrée |
| Côté le plus long | 1280 px, 1920 px, 2560 px, Sans limite | 2560 px |
| Format | Automatique, D’origine, WebP | Automatique |

Textes d'aide de l'interface :

> Équilibrée convient presque partout ; Légère pour les visionneuses et les bannières plein écran, Forte pour les actualités et les vignettes.
>
> Format automatique : un PNG sans transparence qui est une photo passe en JPG, le reste garde son format. Le site se charge du WebP.

« D’origine » garde chaque extension, pour remplacer des fichiers en place (un HEIC passe quand même en JPG). « WebP » convertit tout.

**Métadonnées.** Texte de l'interface :

> Les métadonnées (EXIF, position GPS) sont retirées des images compressées ou gardées ; les fichiers Tel quel et Non compressée partent intacts.

En Renommer, aucun fichier n'est modifié : tous gardent leurs métadonnées, position GPS comprise.

**Licence du module PNG (GPL v3).** Ce n'est pas un avis juridique.

- Le quantificateur PNG est libimagequant (crate `imagequant` 4.4.1), compilé dans `assets/libimagequant_wasm_bg-*.wasm` par le paquet `libimagequant-wasm` 0.3.0. Il est sous GPL v3 ou licence commerciale. `package.json` et le LICENSE du paquet annoncent MIT : c'est la licence de l'enveloppe seule, et un inventaire automatique (npm, SBOM) s'y trompera.
- Tant que l'outil ne sert qu'aux salariés de Pixim, il n'y a pas de diffusion à des tiers : la GPL n'impose rien de plus.
- Le module part pourtant dans chaque navigateur qui ouvre l'outil, et les fichiers statiques se téléchargent sans connexion. Prêter l'outil à un freelance, à un prestataire qui travaille hors des locaux ou à un client, c'est lui en remettre une copie : une diffusion au sens de la GPL.
- En place : `licences.txt`, servi à la racine du site (`https://renommeur.pixim.fr/licences.txt`), donne le texte de la GPL v3, l'adresse de la source correspondante (dépôt `libimagequant-wasm` 0.3.0, crate `imagequant` 4.4.1) et les avis des autres composants. L'interface n'y renvoie pas encore.
- Avant de prêter l'outil hors de l'équipe :
  - garder une copie de cette source tant que l'outil est en ligne : la GPL en laisse la charge à celui qui diffuse, même quand elle est hébergée ailleurs ;
  - le worker qui appelle le module peut former avec lui un seul programme ; remis à des tiers, son code devrait alors être disponible sous GPL v3 lui aussi. Les autres issues : la licence commerciale, ou remplacer `quantize()` (`src/lib/compress/worker.ts`, déjà isolée) par un quantificateur MIT comme image-q, puis remesurer les PNG.
- Ne pas modifier le `.wasm` : la source citée ne lui correspondrait plus.
- Pour ne rien diffuser du tout, on peut protéger tout le sous-domaine par une authentification HTTP Basic (`.htpasswd`, possible sur le mutualisé OVH).

**Côté Joomla**

- Laisser vides « Image Max Width » et « Image Max Height » du plugin Media Action - Resize (Système → Plugins). Sinon Joomla réencode chaque image à l'envoi en qualité 100 : dans un essai, une photo de 2,2 Mo est passée à 4,7 Mo.
- YOOtheme produit lui-même le WebP et les tailles du srcset à partir du fichier déposé : inutile de choisir WebP. Il convertit aussi les PNG en WebP qualité 100, si bien qu'une photo laissée en PNG reste énorme sur le site : c'est pourquoi le format Automatique la passe en JPG.

## Structure

| Dossier | Rôle |
|---|---|
| `src/` | Interface Svelte 5 + TypeScript, compilée par Vite en fichiers statiques |
| `src/lib/prepare.ts` | Vignettes et extraits de texte, dans le navigateur (pdf.js pour les PDF) |
| `src/lib/store.svelte.ts` | État de l'appli, files de lecture, de nommage et de compression |
| `src/lib/compress/` | Compression : moteur (`worker.ts`), pool de workers (`pool.ts`), réglages, lecture des en-têtes d'images |
| `public/` | Copié tel quel dans le paquet : `.htaccess` (en-têtes, cache, gzip) et `licences.txt` (licences des composants livrés) |
| `api/` | Serveur PHP 8.1+ sans framework : `settings`, `ping`, `name` |
| `api/config.php` | Clé API, modèle — **reste sur le serveur, jamais livré** |
| `api/var/` | Journal de consommation (créé tout seul) |
| `scripts/release.mjs` | Fabrique le dossier à envoyer par FTP |
| `dev/make-fixtures.php` | Fabrique des fichiers d'essai dans `dev/fixtures/` |

## Développement local

Branches, commits et publication d'une version : voir [CONTRIBUTING.md](CONTRIBUTING.md) (git flow).

Prérequis : Node 22+, PHP 8.1+ (celui de Laragon convient) et Composer.

```bash
npm install
```

```bash
composer install --working-dir=api
```

Copier `api/config.sample.php` en `api/config.php`, et mettre `'mock' => true` (noms factices, sans appel à l'API). Puis lancer le serveur de développement et ouvrir http://localhost:5173 :

```bash
npm run dev
```

`npm run dev` démarre aussi le serveur PHP de l'API (port 8090) et l'arrête avec lui. S'il tourne déjà, lancé à part avec `npm run api`, il est réutilisé. Une « erreur 502 » au chargement veut dire que le proxy de Vite ne trouve pas ce serveur PHP : relancer `npm run dev`.

Contrôles : `npm test` (règles de nommage, en-têtes d'images, retrait des métadonnées) et `npm run check` (TypeScript).

Essais de la compression dans la vraie interface : `dev/essai-compression.mjs` (poids, statuts, tâches longues) et `dev/captures-compression.mjs` (captures des trois traitements à 1280, 1024 et 375 px). Ils se lancent avec un pilote Chrome DevTools ; la commande est en tête de chaque fichier.

> Derrière un antivirus ou un proxy qui inspecte le TLS, PHP et Composer ont besoin de son certificat racine : le placer dans `.tmp/ca.pem`, que `npm run api` passe automatiquement à PHP, et préfixer Composer de `COMPOSER_CAFILE=.tmp/ca.pem`.

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
- `index.html`, `assets/` (scripts et codecs `.wasm`) et `licences.txt` se téléchargent librement : ils ne contiennent ni clé ni donnée, mais quiconque connaît l'adresse en reçoit une copie, module GPL compris (voir [Compression](#compression), Licence du module PNG).
- CSP : `script-src 'self' 'wasm-unsafe-eval'`. Cette exception sert seulement à compiler les codecs WebAssembly ; aucun `eval` JavaScript. Les workers ne chargent que des fichiers du site.
- La compression a lieu sur le poste : aucune image ne part, en Compresser comme ailleurs.
- Métadonnées : retirées des images compressées ou gardées (EXIF, position GPS, numéro de série de l'appareil). Les fichiers « Tel quel » et « Non compressée », et tous les fichiers en Renommer, partent intacts : penser aux photos d'iPhone en HEIC, que Chrome ne lit pas et qui gardent leur position GPS.

## Limites connues

- HEIC (iPhone), TIFF, PSD, RAW : le navigateur ne sait pas les afficher. Ils sont nommés d'après leur nom d'origine et le contexte, et l'interface l'indique (« sans aperçu »). Même chose pour les anciens `.doc`, `.xls` et `.ppt`.
- La cohérence des noms se joue à l'intérieur d'un lot de 8. D'un lot à l'autre, seuls les doublons exacts sont évités, par numérotation.
- Le ZIP s'écrit directement sur le disque dans Chrome et Edge, donc sans limite pratique de taille. Firefox et Safari l'assemblent en mémoire : au-delà de quelques Go, mieux vaut découper.
- La compression n'a été essayée que sous Chrome, sur des fichiers d'essai. Firefox, Safari, de vraies photos d'appareil et la mémoire d'un gros lot restent à vérifier.

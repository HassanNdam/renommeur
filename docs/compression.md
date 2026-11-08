# Compression des images

Tout se passe dans le navigateur : aucune image n'est envoyée au serveur.

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
- Sans WebAssembly (CSP privée de `'wasm-unsafe-eval'`, `.wasm` servi avec un mauvais type), l'encodeur natif du navigateur prend le relais : JPEG un peu plus lourds, PNG sans palette. Le contrôle 7 de la [mise en ligne](deploiement.md) le vérifie.

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

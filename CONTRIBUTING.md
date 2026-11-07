# Contribuer au Renommeur

Le dépôt suit **git flow** (extension `git flow`, édition AVH, fournie avec Git pour Windows). La configuration est déjà faite dans ce dépôt ; sur un nouveau clone, lancer une fois :

```bash
git flow init -d
```

puis vérifier avec `git flow config` que la branche de production est bien `main` (et non `master`).

## Branches

| Branche | Rôle | Part de | Revient dans |
|---|---|---|---|
| `main` | Ce qui est en ligne. Chaque commit est une version taguée `vX.Y.Z`. | — | — |
| `develop` | La prochaine version : toujours lançable en local. | `main` | — |
| `feature/<nom>` | Une fonctionnalité. | `develop` | `develop` |
| `bugfix/<nom>` | Correction d'un défaut pas encore livré. | `develop` | `develop` |
| `release/X.Y.Z` | Préparation d'une version : numéro, derniers correctifs, paquet. | `develop` | `main` + `develop` |
| `hotfix/X.Y.Z` | Correction urgente de ce qui est en ligne. | `main` | `main` + `develop` |

On ne commite jamais directement sur `main`. Sur `develop`, seulement de petites retouches ; le reste passe par une branche.

Noms de branches : minuscules, mots séparés par des tirets, en français comme le code (`feature/export-csv-alt`, `bugfix/heic-sans-apercu`).

## Fonctionnalité ou correction

```bash
git flow feature start export-csv-alt
```

Travailler, commiter, puis :

```bash
npm run check
```

```bash
npm test
```

```bash
git flow feature finish export-csv-alt
```

Avec un dépôt distant, pousser plutôt la branche (`git flow feature publish`) et ouvrir une pull request vers `develop` : le modèle de PR et la CI (`.github/workflows/ci.yml`) font les contrôles. Même chose avec `bugfix` à la place de `feature`.

## Messages de commit

En français, à l'indicatif présent, sujet court sans point final, comme l'historique existant :

```
Supprime la connexion par mot de passe

Pourquoi le changement, ce qu'il implique (corps facultatif, lignes de 72 caractères).
```

Un commit = un changement cohérent. Pas de fichier généré (`dist/`, `release/`, `*.zip`), ni de `api/config.php`, ni de `api/var/` : le `.gitignore` les écarte.

## Numéro de version

[SemVer](https://semver.org/lang/fr/) : `X.Y.Z`.

- **Z** (correctif) : un défaut corrigé, rien ne change pour l'utilisateur.
- **Y** (mineure) : une fonctionnalité, un comportement qui change (ex. : suppression de la connexion).
- **X** (majeure) : changement qui oblige à refaire la mise en place sur le serveur (nouvelle config obligatoire, version de PHP…).

La version vit dans `package.json` ; `npm version` la recopie dans `APP_VERSION` (`api/bootstrap.php`) grâce à `scripts/sync-version.mjs`. La CI et `npm run release` refusent deux versions différentes.

## Publier une version

```bash
git flow release start 0.3.0
```

```bash
npm version 0.3.0 --no-git-tag-version
```

```bash
git commit -am "Version 0.3.0"
```

Vérifier, fabriquer le paquet et le contrôler (étapes 3 et 7 de « Mise en ligne sur OVH » dans le README) :

```bash
npm run release
```

Puis clore la version : fusion dans `main`, tag `v0.3.0`, retour dans `develop`.

```bash
git flow release finish -m "Version 0.3.0" 0.3.0
```

Envoyer ensuite `release/renommeur/` par FTP, depuis `main` taguée.

## Correction urgente en production

```bash
git flow hotfix start 0.3.1
```

Corriger, puis :

```bash
npm version 0.3.1 --no-git-tag-version
```

```bash
git commit -am "Version 0.3.1"
```

```bash
git flow hotfix finish -m "Version 0.3.1" 0.3.1
```

Puis `npm run release` depuis `main` et envoi par FTP.

## Dépôt distant

Le dépôt est pour l'instant local. Une fois un dépôt distant créé (GitHub, par exemple) :

```bash
git remote add origin <adresse-du-depot>
```

```bash
git push -u origin main develop --follow-tags
```

Sur GitHub, protéger ensuite `main` et `develop` (fusion par pull request, CI au vert obligatoire).

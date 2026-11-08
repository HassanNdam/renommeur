# Outils de test

- `make-fixtures.php` fabrique un lot de fichiers d'essai dans `dev/fixtures/` (ignoré par git) :

  ```bash
  php dev/make-fixtures.php
  ```

- Les fichiers `*.mjs` sont des scénarios de bout en bout, joués dans la vraie interface (`npm run dev` lancé) par un pilote Chrome DevTools Protocol qui ne fait pas partie du dépôt. Chaque fichier exporte `scenarios`, une liste de `{ nom, run(p, log) }` ; `p` pilote l'onglet (`goto`, `eval`, `shot`, `sleep`). La commande et le lot de fichiers attendus sont en tête de chaque fichier. Les états sont posés par `window.__renommeur`, exposé en développement seulement.

# SvelteKit security fix: apps/focus

- Vulnérabilité initiale :
  - ID: `GHSA-29g2-3rmr-qm68` (`@sveltejs/kit` ReDoS via Accept header)
  - CVE: `CVE-2026-66062`
  - Versions affectées: `@sveltejs/kit <= 2.70.1` (audit monorepo reporté via version installée `2.69.2`)
  - Version patchée minimale retenue: `2.70.2`

- Bump effectué:
  - Avant: `@sveltejs/kit: "^2.53.3"`
  - Après: `@sveltejs/kit: "^2.70.2"`

- Vérifications réalisées dans `apps/focus`:
  - `npm audit --json` avant: `moderate: 1` sur `@sveltejs/kit` (`GHSA-29g2-3rmr-qm68`)
  - `npm audit --json` après: `moderate: 0`, `@sveltejs/kit` plus signalé en `low` uniquement
    - dépendances associées toujours en `low` (pas de breaking update appliqué)
  - `npm run build` ✅
  - `npm run lint` ✅

- Décision:
  - Aucune correction majeure forcée (pas de migration breaking).
  - Les `low` restantes sont associées au chemin transitoire `cookie` et `@sveltejs/adapter-node` ; elles restent hors du seuil CI (`security-debt`) attendu ici.

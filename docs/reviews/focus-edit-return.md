---
status: selection-failed
review-author:
  host: codex
  model: unknown-not-provided
  effort: unknown-not-provided
target-ref: be669ecceb2cc7cbbb8e5822711e5fa85cd5740b
legs: []
observed-failure: Exact author metadata unavailable; owner confinement prohibits installed h2a and native/live mesh access required by the review protocol.
---

# Livraison Focus edit-return — 19 octobre 2026

Le brouillon livre le contrat indépendant, la réconciliation pure et un
consommateur manuel. **Il ne livre pas encore l'édition dans le dossier HTML.**
La première boucle complète n'est pas acceptée : FE-3 s'arrête sur FE-2 DS,
comme demandé par le propriétaire. [Contrat et limites](../focus/document-editing.md).

PR brouillon unique : [#378](https://github.com/rhanka/h2a/pull/378), branche
`feat/focus-edit-return`, à jour sur `origin/main` au push, sans rebase nécessaire.

| Commits poussés | Contenu |
| --- | --- |
| `c4409623a` | Contrats, identités, codec source, diff et réconciliation cumulative |
| `be669ecce` | Consommateur manuel, registre durable, journal et reçus |
| `e504507d6` | Contrat documenté, preuves et dépendance DS |

| Lot | Résultat observable | Gate encore ouverte |
| --- | --- | --- |
| FE-0 | Schémas sidecar, JSON/YAML sans trim, couches S/F/M, hashes et vecteur navigateur/Node | Revue Focus/DS des noms, de `retiredParagraphIds` et du codec final |
| FE-1 | Identités persistantes, diff par paragraphe, application atomique pure, révocation totale/partielle, tombstones transitifs, ordre indéterminé refusé | Codec Tiptap réel ; listes conservées opaques |
| FE-3/4 | Arrêt sur dépendance publiée manquante ; hôte existant inchangé | Éditeur DS, export/reprise `file://`, IME, presse-papiers et tarball éditable |
| FE-5 | `focus feedback retain/apply`, source explicite, journal, registre durable, reçus, transfert manuel sans agent vivant | Export réel du navigateur, reconstruction de présentation, capacités registre versionnées, reprise de verrou après arrêt brutal |
| FE-6/8/9 | Non acceptés | Politiques Q1–Q4/CAS/Track, langues et budgets mesurés puis vérifiés, vrai dossier influence qualifié |

## Preuve de dépendance

`npm view @sentropic/design-system-svelte@latest version exports --json` :
version `0.36.0`, export racine uniquement. Inspection du tarball exact :

```json
{
  "version": "0.36.0",
  "tarballSha256": "7b37830dbf168ae4057949925b0b8ecc9aa155827d55eebeda4c2e731a1a6880",
  "files": 708,
  "editorFileMatches": [],
  "editorExportPresent": false
}
```

Responsable du déblocage : conducteur design-system, FE-2. Livrer un sous-chemin
publié `RichTextEditor`, son codec exact et ses témoins d'identité/lecture seule/
composition/paste. Critère : installation de cet artefact par h2a, puis passage
des témoins FE-3/4 sur le fichier portable. Aucun fallback D23 n'a été engagé.

## Commandes et sorties

Toutes les commandes shell passent par `rtk`. Les tests utilisent une racine
créée par `mkdtemp`, ici `/home/antoinefa/.cache-tmp/focus-edit-proof-bzPotY`.
Les derniers gates redirigent `HOME`, `TMPDIR`, tous les répertoires XDG
(`CONFIG_HOME`, `CONFIG_DIRS`, `STATE_HOME`, `CACHE_HOME`, `DATA_HOME`, `DATA_DIRS`,
`RUNTIME_DIR`) dans cette racine ; les autres variables XDG de session sont
retirées. Aucun skip, état réel, Python, h2a installé ou suite complète.

| Commande ciblée, après le préfixe d'isolation | Sortie observée |
| --- | --- |
| Depuis `packages/focus` : `node ../../node_modules/vitest/vitest.mjs run tests/editing-contract.spec.ts tests/editing-anchors.spec.ts tests/editing-codec.spec.ts tests/editing-diff.spec.ts tests/editing-reconcile.spec.ts tests/schema.spec.ts tests/packaging.spec.ts tests/registry.spec.ts tests/render.spec.ts` | `Test Files 9 passed (9)` ; `Tests 153 passed (153)` |
| `node --test packages/h2a/test/focus-feedback.test.js packages/h2a/test/focus-edit-recovery.test.js packages/h2a/test/focus-build.test.js` | `tests 38` ; `pass 38` ; `fail 0` ; `skipped 0` |
| Dernière reprise en séquence : `node --test packages/h2a/test/focus-feedback.test.js packages/h2a/test/focus-edit-recovery.test.js` | `tests 5` ; `pass 5` ; `fail 0` ; `skipped 0` |
| `node node_modules/typescript/bin/tsc -b --pretty false` | exit 0, aucune erreur |
| `node packages/focus/scripts/sync-editing-schemas.mjs --check` | exit 0, aucun drift |
| `node scripts/vendor-focus.mjs` | `re-vendored 101 files ... from a fresh build of packages/focus` |
| `node scripts/check-focus-vendor.mjs` | `focus-vendor OK: ... is byte-identical to a fresh build of packages/focus` |
| `git diff --check` | exit 0 |

Un lancement ultérieur des deux fichiers Node en parallèle du contrôle vendor a
échoué à `4 pass / 1 fail` : le nettoyage de `track/dist` par le générateur a
croisé le démarrage du CLI (`ERR_MODULE_NOT_FOUND`). Après fin du générateur,
la même commande passe `5/5` en séquence. Aucun test ni timeout n'a été assoupli.
Les sourcemaps du tarball Focus extrait émettent des diagnostics de sources
absentes ; le gate packaging passe avec ses assertions conservées.

## RED puis GREEN

| Régression / fonction | RED observé avant correction | GREEN ciblé |
| --- | --- | --- |
| Nouveau cœur : contrat/ancres/codec/diff/réconciliation | 5 fichiers, `19 failed (19)`, API absentes | 5 fichiers, `26 passed (26)` |
| Révocation structurelle exacte, reçu malformé, digest d'un ID refusé | `3 failed / 10` dans `editing-reconcile.spec.ts` | `10 passed (10)` |
| Clés masquant `Object.prototype` | `1 failed / 7` dans `editing-contract.spec.ts` | Inclus dans le gate final |
| Bundle navigateur sans DOM | `ReferenceError: document is not defined` dans le test du vecteur | Vecteur figé inchangé avec Lezer ; test navigateur sans DOM vert |
| Cibles réelles des réponses/notes | `1 failed / 9` dans `editing-contract.spec.ts` | `9 passed`, inclus dans le gate final |
| Consommateur absent | `6 failed`, zéro skip ; deux inscriptions dupliquées retirées en déplaçant le helper | 5 tests uniques verts, dont processus CLI distincts |

Les fixtures influence sont des **tranches réduites** avec provenance et
`qualifiedRealDossier: false`. L'original et son HTML voisin restent intacts.
Le témoin de navigateur est un bundle exécuté sans DOM, pas un vrai navigateur :
il prouve le calcul partagé du hash et l'absence de cette dépendance, pas FE-3/4.

## Écarts et limites explicites

| Point | État |
| --- | --- |
| Champ `retiredParagraphIds` | Vocabulaire concret supplémentaire du manifeste proposé, hashé et fermé ; à confirmer en revue FE-0 avant merge |
| Profil source | Lezer/GFM avec mapping CRLF ; pas de paire Tiptap/Markdown qualifiée ; listes, liens, HTML, images, tables, code et titres opaques |
| Application manuelle | Source JSON publiée ; aucun HTML reconstruit, événement Track, décision ou signature annoncé |
| Crash / concurrence | Journal qualifié au point d'arrêt injecté après publication ; arrêt brutal pouvant laisser le verrou et écrivains non coopératifs hors couverture |
| Distribution | Nouveau contrat présent dans les sources/tarball Focus construit ; publication npm et boucle d'édition installée FE-4 non revendiquées |
| Revue | Les deux revues fournies donnent GO-CODE pour la spec v3 ; aucune revue de code indépendante revendiquée |

La règle du skill
[`harness-review`](/home/antoinefa/.codex/skills/harness-review/SKILL.md) impose
« Launch only through the installed h2a MCP server's `h2a_run` tool » et refuse
une sélection sans métadonnées exactes de l'auteur. Ces prérequis sont indisponibles
dans le confinement imposé. La sélection est donc `selection-failed`, sans
verdict de consensus ni lancement par un autre canal.

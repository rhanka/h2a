---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: e518da2b25d5daa57b08a1fa7dafec4b3fe1eced
observed-failure: Exact author model/effort are unavailable. The required installed h2a/mesh review dispatch is forbidden by owner confinement. No peers dispatched and no consensus verdict claimed.
---

# Estimateur de délai — preuve de réalisation

PR brouillon demandée : `feat(track): delivery-time estimator from measured agent velocity`.
Base : `7ebbcf266e1988c18624d0158936949a214f9fd8` (post-#374).
Spec copiée sans changement : SHA-256 `4388546e0c488212efdfb3402595ed14a33c568ae3fa1d3a3287a61569858ccb`.
Les deux revues fournies, cfveloa-last.md et cfvelos-last.md, portent GO-CODE sur ce digest.

| Lot | Réalisation / commits | Gate |
| --- | --- | --- |
| L0-D | `41d647342` : spec, cohortes h2a union 23, 285 checks Astra, engram 60/121, anomalies ; digests dans BRANCH.md | Documents et intégrité validés |
| L0-C, bootstrap h2a | `92a9a7b79`, `66cd654c8` : tests d'abord ; `dc3a0e7f8`, `e518da2b2` : copie isolée, builds et preuves d'exécution | T-V00-I qualifié localement ; lot complet encore bloqué |
| L0-C, artefact et pin | Aucun artefact de substitution, aucun contrat importé | Bloqué en amont, T-V00-C non exécuté |
| L1–L7 | Aucune implémentation commencée | Dépendent du vrai gate L0-C |

## Blocage et transfert à gr-conductor

La spec §6 L0-C exige : **« L1 cannot start against a placeholder contract. »**
Le dépôt engram local à `8f19554cea3a4397fd66a90c7e9fd5ea54c81626` ne contient aucun fichier au chemin annoncé ;
`rtk gh api 'repos/rhanka/engram/contents/profiles/repo-knowledge/1?ref=main'` retourne HTTP 404 le 18/10.
Le SHA et le chemin de publication ont été demandés au propriétaire pendant le travail ; aucun n'a été fourni.

| Responsable | Livrable borné | Acceptation observable |
| --- | --- | --- |
| gr-conductor / engram | `profiles/repo-knowledge/1/{profile,timing.schema,engram-mapping,manifest}.json`, export/validation `src/repo-knowledge-contract.ts`, fixtures/tests et pin du validateur DS prévus par L0-C | Publication revue à un SHA complet, preuve DS + mapping Engram, T-V00-C RED/GREEN, horloges/unités/types/cross-domain validés |
| h2a après publication | Copier les octets amont dans `knowledge/contracts/`, verrouiller SHA/digests, implémenter le consommateur et `velocity-contract.test.ts` | Verdicts amont reproduits hors ligne, sans schéma local réinventé ; ensuite seulement L1 |

Aucun fichier engram, événement Track, skill installé, état du propriétaire, service ou processus étranger n'a été modifié.

## RED / GREEN observés

Fichier ciblé : `packages/h2a/test/velocity-test-lane.test.js`.
Digest identique dans le RED final et le GREEN : `7e50ca8d745bfddf7a2a35f1a70ef0b4dc5c0863f22d4f681fb178e6342dd413`.
RED final sur l'implémentation test-first de `66cd654c8` (module stub SHA-256 `91d97844b8132f3cdfbaae40c2074dd6cfaf6b65bc9f11fda241b2f196062666`), copié dans une meta-lane temporaire :

```text
rtk node --import ./packages/h2a/test/helpers/identity-isolation-guard.mjs --test packages/h2a/test/velocity-test-lane.test.js
# tests 28
# pass 0
# fail 28
# cancelled 0
# skipped 0
# todo 0
exit 1
```

GREEN via le vrai bootstrap, dépendances et compilation du checkout temporaire incluses :

```text
rtk node scripts/velocity-test-lane.mjs --package h2a --file test/velocity-test-lane.test.js
npm ci --ignore-scripts --no-audit --no-fund: exit 0
npm run build -w @sentropic/agent-stats: exit 0
npm run build -w @sentropic/track: exit 0
npm run build:h2a: exit 0
node --import ./packages/h2a/test/helpers/identity-isolation-guard.mjs --test [reporters] packages/h2a/test/velocity-test-lane.test.js: exit 0
{"passed":28,"excluded":0}
```

| Régression observée dans le même fichier | RED (pass/fail) | GREEN (pass/fail) | Skips / exclusions |
| --- | --- | --- | --- |
| Contrat initial du runner | 0/25 | 25/0 | 0/0 |
| Copie de docs/focus/index.html, lien sans rapport avec le gate | 25/1 | 26/0 | 0/0 |
| Track non construit avant build:h2a : TS2307 réel, puis assertion d'ordre | 23/3 | 26/0 | 0/0 |
| Guard refusant les écritures relatives du build privé | 26/1 | 27/0 | 0/0 |
| CI sans le filtre facultatif RTK | 27/1 | 28/0 | 0/0 |

Les étapes testées incluent un vrai enfant Node contrôlé, la persistance des PID possédés, un refus de chemin synthétique avant accès,
les builds/fixtures absents, les sélecteurs vides/glob/symlink, les comptes malhonnêtes et les skips renommés/non autorisés.
Le test négatif de fixture absente exécute réellement un enfant qui échoue ENOENT ; cet échec est attendu et vérifié, pas un skip.

```text
rtk node scripts/velocity-test-lane.mjs --package agent-stats --file tests/agent-stats.test.ts
npm ci --ignore-scripts --no-audit --no-fund: exit 0
npx --no-install vitest run --config vitest.config.ts tests/agent-stats.test.ts [reporters]: exit 0
{"passed":16,"excluded":0}
rtk bash scripts/check-no-python.sh
ZERO PYTHON OK (1 allowlisted hit(s), 0 unexcused), exit 0
```

Logs complets conservés dans `tmp/velocity-evidence/` et dans les lanes privées : GREEN Node `/home/antoinefa/.cache-tmp/velocity-lane-F4Qpma`,
GREEN Vitest `/home/antoinefa/.cache-tmp/velocity-lane-iKb9bA`, RED final `/home/antoinefa/.cache-tmp/velocity-lane-UV5HMm`.
Les `commands.json`, `tests.json`, `result.json` et logs par commande attestent cwd, argv, exits, source et assertions exécutées.
Ce sont des preuves locales retenues, pas des liens portables ni une qualification CI.

## Premier contrôle des mesures figées

Contrôle d'intégrité indépendant en Node : tri des différences entre horodatages PR, sélection nearest-rank `ceil(n*p)-1`.
Ce contrôle L0-D ne constitue pas le moteur L1 ni une prévision prospective.

| Cohorte | n | P50 | P80 | P95 | Qualification |
| --- | ---: | ---: | ---: | ---: | --- |
| h2a Astra `astra-merged-desc/1` | 20 | 9 918 s | 46 770 s | 108 177 s | descriptive |
| h2a Sol `sol-created-desc/1` | 20 | 9 918 s | 13 240 s | 46 770 s | descriptive |
| engram enriched | 60 | 0,49 h | 1,00 h | 6,66 h | descriptive, cohorte séparée |
| engram older | 121 | 0,24 h | 3,51 h | 67,87 h | descriptive, cohorte séparée |

Mesure = ouverture PR → fusion, jamais temps actif/temps de développement restant. `installedAt: unknown`, tours de revue inconnus.
Collecte des checks : `2026-10-18T20:31:53.887Z` ; disponibilité historique non attestée, donc aucune prétention de backtest prospectif.

## Limites, écarts et CI

- L0-C amont/pin/T-V00-C et L1–L7 ne sont pas livrés. Aucun estimate CLI, plan, forecast, calibration ou reçu d'installation annoncé.
- Le build Track ajouté corrige le prérequis manquant de §6.0. Le guard existant normalise les chemins relatifs, sans retirer les refus.
- Le runner prend les mêmes exécutables directement si RTK est absent sur CI ; il journalise la commande réellement lancée. Aucun nouveau paquet requis.
- Seuls les goldens documentaires sont copiés, car la documentation générale contient un lien hors périmètre ; sources/fixtures/contrats requis restent copiés.
- Le commit documentaire volumineux est la copie demandée de la spec/des faits. Les commits de comportement restent sous 150 lignes ; pas de Makefile ni de template harness disponible.
- Qualification locale Linux Node 22.22.1. Node 24, le runner Track/public-contract, les tests L1–L7 et le tarball/installation ne sont pas qualifiés ici.
- Revue de code sans consensus : [harness-review/SKILL.md](/home/antoinefa/.codex/skills/harness-review/SKILL.md) exige « Launch only through the installed h2a MCP server's h2a_run tool » et les métadonnées auteur exactes ; confinement et métadonnées absentes empêchent cette sélection. Gate avant merge non franchi ; PR reste brouillon.
- CI : à renseigner après ouverture de la PR ; aucune suite complète lancée localement, aucun workflow/gate existant modifié.

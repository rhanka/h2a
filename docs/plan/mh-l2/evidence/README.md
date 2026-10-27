# MH-L2 — index des preuves

Les journaux contiennent commande réelle, sortie et code. Les preuves du premier run sont conservées ; les labels `node22-final` et `node24-final` ont été revalidés après reboot. Tous les tests utilisent le wrapper `scripts/mh-l2-test.mjs`, HOME/XDG/store dans un mkdtemp privé. Aucune suite globale.

| Fichier ciblé | Node 22.22.1 | Node 24.21.0 |
|---|---:|---:|
| mh-l2-authority.test.js | [2/2, code 0](mh-l2-authority.test.js-node22-final.log) | [2/2, code 0](mh-l2-authority.test.js-node24-final.log) |
| mh-l2-auth.test.js | [3/3, code 0](mh-l2-auth.test.js-node22-final.log) | [3/3, code 0](mh-l2-auth.test.js-node24-final.log) |
| mh-l2-starters.test.js | [1/1, code 0](mh-l2-starters.test.js-node22-final.log) | [1/1, code 0](mh-l2-starters.test.js-node24-final.log) |
| mh-l2-cold.test.js | [4/4, code 0](mh-l2-cold.test.js-node22-final.log) | [4/4, code 0](mh-l2-cold.test.js-node24-final.log) |
| mh-l2-compensation.test.js | [1/1, code 0](mh-l2-compensation.test.js-node22-final.log) | [1/1, code 0](mh-l2-compensation.test.js-node24-final.log) |
| mh-l2-integration.test.js | [3/3, code 0](mh-l2-integration.test.js-node22-final.log) | [3/3, code 0](mh-l2-integration.test.js-node24-final.log) |
| mh-l2-image.test.js | [1/1, code 0](mh-l2-image.test.js-node22-final.log) | [1/1, code 0](mh-l2-image.test.js-node24-final.log) |

Commande de reprise : `rtk node scripts/mh-l2-matrix.mjs`, puis `rtk /home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node scripts/mh-l2-matrix.mjs`. Le script appelle chaque fichier séparément avec `node --test`; 15 tests par version, fail 0, skip 0.

| Régression / faute injectée | Rouge effectif | Vert après restauration |
|---|---|---|
| unicode | [fail 1, code 1](mh-l2-auth.test.js-mutation-unicode-red.log) | [pass 3, code 0](mh-l2-auth.test.js-mutation-unicode-green.log) |
| durable | [fail 1, code 1](mh-l2-image.test.js-mutation-durable-red.log) | [pass 1, code 0](mh-l2-image.test.js-mutation-durable-green.log) |
| owner-record | [fail 1, code 1](mh-l2-image.test.js-mutation-owner-record-red.log) | [pass 1, code 0](mh-l2-image.test.js-mutation-owner-record-green.log) |
| compensation | [fail 1, code 1](mh-l2-compensation.test.js-mutation-compensation-red.log) | [pass 1, code 0](mh-l2-compensation.test.js-mutation-compensation-green.log) |
| pause | [fail 1, code 1](mh-l2-starters.test.js-mutation-pause-red.log) | [pass 1, code 0](mh-l2-starters.test.js-mutation-pause-green.log) |
| mac | [fail 1, code 1](mh-l2-auth.test.js-mutation-mac-red.log) | [pass 2, code 0](mh-l2-auth.test.js-mutation-mac-green.log) |
| socket | [fail 1, code 1](mh-l2-auth.test.js-mutation-socket-red.log) | [pass 2, code 0](mh-l2-auth.test.js-mutation-socket-green.log) |
| owner | [fail 1, code 1](mh-l2-authority.test.js-mutation-owner-red.log) | [pass 1, code 0](mh-l2-authority.test.js-mutation-owner-green.log) |
| inode | [fail 1, code 1](mh-l2-authority.test.js-mutation-inode-red.log) | [pass 1, code 0](mh-l2-authority.test.js-mutation-inode-green.log) |
| precheck | [fail 1, code 1](mh-l2-image.test.js-mutation-precheck-red.log) | [pass 1, code 0](mh-l2-image.test.js-mutation-precheck-green.log) |
| stop | [fail 2, code 1](mh-l2-cold.test.js-mutation-stop-red.log) | [pass 4, code 0](mh-l2-cold.test.js-mutation-stop-green.log) |
| budget | [fail 1, code 1](mh-l2-cold.test.js-mutation-budget-red.log) | [pass 4, code 0](mh-l2-cold.test.js-mutation-budget-green.log) |

Mutations ciblées : `rtk node scripts/mh-l2-mutate.mjs <nom>`. Elles ont été terminées avant reboot ; les sources sont restaurées. Les rouges nominaux authority/auth/starters/cold échouent sur le module absent avant implémentation. Integration échoue sur le marker non-v2 ; image échoue effectivement dans `successor-readiness-red`. Le fichier `mh-l2-image.test.js-nominal-red.log` a code 0 : son label est erroné et il ne compte jamais comme preuve rouge.

Admission pendant le raccord asynchrone : [rouge](mh-l2-integration.test.js-admission-red.log), puis [vert](mh-l2-integration.test.js-node22-final.log).

Fixture L1 : [rouge prefix_owner_mismatch](mh-l1-shim.test.js-node22-resume-regression.log), puis [Node 22 vert](mh-l1-shim.test.js-node22-resume-prefix-green.log) et [Node 24 vert](mh-l1-shim.test.js-node24-resume-prefix-green.log). Seul `physicalPrefix: f.dir` est ajouté ; aucune assertion affaiblie.

Régressions L0/L1 : `rtk node scripts/mh-l2-test.mjs packages/h2a/test/<fichier>.test.js node22-resume-regression` pour `mh-l0-formats`, `mh-l0-state`, `mh-l0-wire`, `mh-l1-routing`, `mh-l1-transport` ; 16 pass, fail 0, skip 0. Shim compte 2 pass supplémentaires après correction. CLI : labels `node22-resume-central` (2 pass) et `node22-resume-counts` (1 pass), sélection par `--test-name-pattern`, aucun skip rapporté.

NON-FUSIONNABLE
Reviewer: sol-xhigh
Repo: rhanka/h2a
PR: 355
Head-SHA: d91fe64e067545d2944690ea225e1934f66e11e0

- **P1 — L’upgrade installe une commande inutilisable.** [cli.ts:2186](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/cli.ts:2186) passe `managedRoot/managed` au lanceur, qui exige `managedRoot/launcher/h2a.mjs`. Reproduction avec le vrai lanceur : upgrade → **exit 0, `completed:true`**, puis commande installée → **exit 1, `managed_launcher_location_invalid`**. Le test nominal masque ce défaut en exécutant directement l’entrée sélectionnée.

- **P1 — Qualification contournée sur #354 empilée.** [mcp-central-policy.ts:10](/home/antoinefa/src/h2a/tmp/worktrees/r5r6/packages/h2a/src/runtime/mcp-central-policy.ts:10) admet le bridge sans vérifier `qualifiedClaudeInitialize`. Reproduction sur `757a5b933479361b5d176f6091433fd87d6dfb89` : manifest vide, client `x/0`, marqueur privé de fixture → **initialize accepté, 60 outils servis, exit 0**. La route publiée doit appliquer la qualification exacte avant délégation.

- **P1 — LOT-2B reste bloquant.** Le [manifest livré](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/runtime/mcp-central-qualification.ts:20) contient toujours `clients: []`. Le rapport déclare `not executed / no_enrolled_seat` et D-01 non couvert. Les gates G-1/G-2 de la spec restent donc ouvertes : les tests synthétiques ne qualifient aucun vrai Claude.

- **P2 — Le worker automatique ne retrouve pas l’installation npm.** [index.ts:503](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/runtime/upgrade/index.ts:503) reconnaît uniquement un chemin finissant par `upgrade/index.js`, alors que le worker transmet `upgrade/boot-worker.js`. Reproduction sans `H2A_MANAGED_ROOT` : résolution depuis `index.js` réussie, depuis le vrai worker → `undefined`. L’upgrade automatique devient ainsi un no-op malgré l’installation présente.

- **P2 — Une sélection déjà satisfaite renvoie 2.** [cli.ts:2223](/home/antoinefa/src/h2a/tmp/worktrees/mh-l0/packages/h2a/src/cli.ts:2223) transforme également `already_adopted` en résultat incomplet. Reproduit avec une sélection identique et un lien npm valide : **exit 2**, contrairement au contrat « aucun changement nécessaire → 0 ».

- **P2 — G-6 échoue sur la tête vérifiée.** `gh pr checks 355` donne **17/18 verts**. [`npm-test-trust-root`](https://github.com/rhanka/h2a/actions/runs/39230734175/job/118001915106) termine en échec : étape `tests` interrompue après **1 260 s**, sans verdict complet. Les autres jobs verts ne remplacent pas cette preuve.

Tests ciblés réexécutés : **106/106 sur #355**, puis **14/14 pour le CLI registre de #354**, sur chacun des Node **22.22.1** et **24.18.0** ; aucun skip ni TODO.

**P3 — Hygiène des preuves :** deux logs contiennent des PEM privés générés par les fixtures temporaires ; à expurger. Aucun secret de production identifié dans le diff textuel inspecté. Aucun fichier suivi modifié pendant cette revue ; diff `.track` vide.
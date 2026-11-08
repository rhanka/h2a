NON-FUSIONNABLE
Reviewer: sol-xhigh
PR: 382
Head-SHA: 0e4a0e47e37245b6e709aaf3b73b77586fd7b4a0

HEAD local/GitHub concordants ; base origin/main : dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3. Spec v4 et deux revues R1 relues. R = packages/h2a-runtime ; H = packages/h2a. Revue indépendante, sans revendication de consensus. L7/#375 reste hors verdict conformément à la décision du conducteur ; security-debt est le problème connu traité séparément par #385.

1. **P1 — La première frappe humaine désactive durablement le wake.** R/src/native-terminal/host.ts:1570, :1655 : humanInputSeq ne fait qu’augmenter ; aucun chemin d’observation/passation ni adaptateur ne permet de prouver ensuite un composeur vide. Reproduction sur vrai PTY avec bail humain : envoyer une ligne complète, attendre son accusé de consommation par le lecteur puis 4,2 s, injecter WAKE. Sortie : `refused-unproven-composition, controlled:true`, zéro wake ; une autre exécution, après libération du bail et expiration du délai, refuse aussi avec controlled:false. Le brouillon dangereux de R1 est protégé, mais le cas nominal L2/L3 après utilisation humaine reste impossible jusqu’à recréation du PTY. Livrer la passation D6 et sa voie positive, en conservant le refus sur brouillon. Le test drive.functional:465 accepte désormais le refus permanent à la place du seul différé retryable et ne vérifie aucune reprise.

2. **P2 — Le dédoublonnage oublie encore les identifiants appliqués.** R/src/native-terminal/host.ts:1605–1609. La nouvelle limite de 4096 tombstones déplace le défaut S5. Reproduction : injecter original, 4609 identifiants distincts, puis original à nouveau. Sortie : `first.seq=1, last.seq=4611, writes=4610→4611`. La reproduction R1 à 513 requêtes intermédiaires retourne maintenant refused-evicted-request sans nouvelle écriture, mais D5/D7 restent violés au seuil suivant, sans crash ni reconnexion. Conserver une preuve de frontière permettant de refuser un ancien identifiant, sans l’admettre à nouveau après éviction.

3. **P2 — Le nouveau “foreground” observe le groupe du shell, pas celui du job au premier plan.** R/src/native-terminal/host.ts:303, :311. Reproduction dans un Bash interactif isolé, job control actif : lancer un exécutable fixture nommé codex avec un argument de conversation, attendre son marqueur READY puis appeler host.state. foregroundProcesses contient uniquement `/bin/bash --noprofile --norc -i` ; le CLI vivant est dans son propre groupe. D1 conclut alors shell/needs-adapter, et le garde natif sans PID ne peut plus reconnaître ce writer. Observer le foreground réel du terminal avec sa filiation/incarnation ; le pgrp du leader ne constitue pas cette preuve. Le raccord produit R1 existe désormais, mais cette preuve réelle échoue.

4. **P2 — Un restore entièrement différé sort encore avec succès.** R/src/restore.ts:1364, appelé par R/src/index.ts:10315. Reproduction avec le vrai restore, registre/inventaire privés : une primaire attach-live, subtree Bash ⇒ `ledger=[{session:"prim",outcome:"deferred",reason:"needs-adapter"}]`, puis `restoreExitCode(ledger)=0`. Le CLI n’a pas été repris. D2 impose non-zéro pour cet objectif bloqué, y compris si un autre candidat a réussi. Inclure les différés bloquants ; garder zéro pour dry-run valide, aucun candidat et already-active.

5. **P2 — L0 reste bloquant dans la CI malgré l’installation de bwrap.** .github/workflows/ci.yml:155 ; scripts/test-sandbox.mjs:128. `bwrap --version` ne qualifie pas l’enveloppe effectivement utilisée. Les logs de build-and-test Node 22, host-oracle et zero-python au HEAD donnent tous `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, exit 1, avant les tests ([build](https://github.com/rhanka/h2a/actions/runs/39479883852/job/118825365000)). Corriger/qualifier les namespaces et capacités de cette enveloppe sur les runners, en conservant le confinement et le refus sans repli.

6. **P2 — Un échec de persistance enterre toujours un wake différé au redémarrage.** H/src/runtime/drive/inbox-wake.ts:94–105 ; H/src/runtime/mcp/stdio.ts:638. Les erreurs du store deviennent silencieusement un état vide. Reproduction : save lève une erreur de disque, le driver diffère, puis reconstruire le handler sur le même inbox non vide. Le compteur reste `calls=1` au lieu de 2 : l’enveloppe non livrée est initialisée comme vue. Le store stdio masque déjà l’erreur avant le handler. D9 exige une reprise durable ; conserver/surfacer l’échec et empêcher ce seed de déclarer vus les dépôts sans preuve de wake accepté.

Recontrôle de **tous les P1/P2 R1** (A = astra, S = sol) :

| Finding R1 | Reproduction au HEAD |
|---|---|
| A1/S2, identité wake | Corrigé : deux arrivées reliées au vrai host.inject ⇒ deux clés digest distinctes, deux écritures, bail conservé. |
| A2/S1, brouillon humain | Corrigé pour la reproduction : vrai Bash/readline, brouillon consommé, attente 4,2 s ⇒ refused-unproven-composition ; la clôture humaine produit draft-original, aucune concaténation machine. Disponibilité encore défectueuse (1). |
| A3/S7, observations/ledger produit | Partiel : producteur nativeSubtrees et sweep natif raccordés ; primaire au UUID connu ⇒ already-active, exit 0. Foreground et différés encore incorrects (3–4). L1b demeure explicitement needs-adapter. |
| A4/S3, deux destinataires | Corrigé : deux vrais runMcpStdio sur le même root ; A différé garde [A], B réussi garde [] dans son fichier distinct ; après arrêt/redémarrage de A, une nouvelle tentative a lieu. |
| A5/S4, audit indisponible | Corrigé : XDG_STATE_HOME dirigé vers un fichier de fixture ⇒ refused-audit-unavailable, zéro écriture ; test inject correspondant vert. |
| S5, éviction 512 | Reproduction exacte à 513 autres unités corrigée : refused-evicted-request, 514 écritures conservées. Défaut reporté au seuil 4096 (2). |
| S6, coupure après ESC | Corrigé : coupure 1 incluse ; ESC puis [?61;1;21c devient une réponse typée, pas deux inputs ; suites classifier et final-write vertes. |
| A6, remote non classifié | Corrigé : delegated-unknown sans facet ⇒ aucune sélection et nom remonté ; flags --primary/--secondary présents, garde d’enrôlement/provenance vert. |
| A7, LG | Labels exacts et projectPrefixes par segment reproduits verts ; groups:"invalid" refuse désormais. Les champs supplémentaires tools/tags/excludeProjects/maxTabs restent hors contrat spécifié ; les détails de validation restent en anglais après le préfixe localisé (config.ts:116, :758). |
| A8/S9, CI sans barrière | Installation corrigée ; qualification effective toujours rouge (5). |
| A9, VTE sous barrière | Corrigé : /tmp privé du namespace ; fichier VTE exécuté avec gnome-terminal/Xvfb/bus privés : 2 passed, 0 skipped, exit 0. Aucun /tmp réel utilisé. |
| S8, conv-guard/.test-scratch | Corrigé : conv-guard.test.ts repassé sous barrière, sans EROFS ni skip, y compris le contrôle du propriétaire natif sans PID. |

Lots : L0 partiel (CI) ; L6a/L6 catalogues et rendu/dist ciblés verts ; LG matchers/partition verts avec réserves ci-dessus ; L5 provenance et remote ciblés verts. L1a reste partiel (3–4 et dispatch de fenêtre toujours compté launched dans launch-layout.ts:463 sans observation du CLI). L1b est différé, ce que la règle première-RC permet. L2 reste partiel : line seulement, pas de transaction submit-text, managed-shell.ts ou surface D8 inspect/watch/status/cancel ; (1) empêche la voie positive après frappe. L3 n’est pas qualifié contre de vraies CLI attachées : les lecteurs d’octets ne suffisent pas ; (6) reste ouvert. L4 déterministe et VTE vert dans le jeu exécuté, hints conservés. Aucun B5 revendiqué.

Preuves exécutées dans deux archives privées sous `/home/antoinefa/.cache-tmp/h2a-test/run-r2-sol-*`, dépendances en lecture seule. T = cette racine ; chaque commande de test ci-dessous était préfixée par `rtk env TMPDIR="$T/tmp"`. La barrière bubblewrap est conservée ; l’escalade de l’outil ne sert qu’à autoriser sa création de namespaces.

```sh
rtk env TMPDIR="$T/tmp" node node_modules/typescript/bin/tsc -b "$T/head/packages/h2a" "$T/head/packages/h2a-runtime" --force --pretty false
# exit 0 ; même commande avec main : exit 0.

node scripts/test-sandbox.mjs -- node node_modules/vitest/vitest.mjs run packages/h2a-runtime/src/native-terminal/inject.test.ts packages/h2a-runtime/src/native-terminal/drive.functional.test.ts packages/h2a-runtime/src/native-terminal/terminal-replies.test.ts packages/h2a-runtime/src/conv-guard.test.ts packages/h2a-runtime/src/restore-ledger.test.ts packages/h2a-runtime/src/restore-inplace.test.ts packages/h2a-runtime/src/restore-groups.test.ts --maxWorkers=1
# HEAD : 67 passed, 0 failed, 0 skipped, exit 0.

node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/inbox-wake-durability.test.js packages/h2a/test/human-output-dist.test.js packages/h2a/test/upgrade-human-output.test.js packages/h2a/test/pty-restore-facet-hint.test.js
# HEAD : 19 pass, 0 fail, 0 skipped, exit 0.

node scripts/test-sandbox.mjs -- node node_modules/vitest/vitest.mjs run packages/h2a-runtime/src/native-terminal/drive.functional.test.ts --maxWorkers=1
# origin/main : 1 passed, 1 failed, 0 skipped, exit 1.
# :432 expected driven, received deferred avec fenêtre attachée.

node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/inbox-wake-durability.test.js
# origin/main : 0 pass, 4 fail, 0 skipped, exit 1.
# Nombre de reprises 1≠2 ; defer absent ; résultat true ; clés absentes.
# HEAD : les quatre cas passent dans la commande Node ci-dessus.
```

Les archives main gardent le produit origin/main ; seuls le lanceur/setup/preload/guard L0 et les deux fichiers de tests comparés viennent du HEAD. Les erreurs de préparation d’archive/import/fixture ne sont pas comptées comme RED.

Autres commandes ciblées, même préfixe et enveloppe : Vitest sur `native-terminal/{terminal-replies.functional,op}.test.ts`, `{test-state-isolation,attach-reconnect-livelock,restore-human-sessions}.test.ts` et la sonde deux-wakes ⇒ **50 passed, 0 failed, 0 skipped**, exit 0 ; `r2-groups-review.test.ts` (copie de restore-groups + trois reproductions) et `registry-restore-facet.test.ts` ⇒ **21 passed, 0 failed, 0 skipped**, exit 0. VTE : **2 passed, 0 skipped**. Sondes indépendantes : brouillon Bash vert ; wake, débordement dédup et foreground confirmé avec un binaire Node nommé codex : **3 échecs comportementaux** ; restore **3 passed, 1 failed** ; stdio/persistance **1 pass, 1 fail** ; zéro skip. Le contrôle binaire est exécuté via le même lanceur Vitest sur native-terminal/r2-foreground-review.test.ts (0 passed, 1 failed, exit 1). Fichiers temporaires supprimés avec les archives.

`rtk gh pr checks 382 -R rhanka/h2a` : **10 fail, 6 pass, 0 pending**, exit 1. Fail : build-and-test 22/24, host-oracle, native-namespaces, npm-test-trust-root, portable-focus, scoped-hosts 22/24, security-debt, zero-python. Pass : Publish rehearsal, hook-selftest, scan-commits, smoke-install macOS/Ubuntu/Windows. Security-debt est exclu des reproches de cette revue (#385).

18 commits inspectés, aucun trailer d’attribution ; aucun fichier Python ajouté/exécuté. Aucun état réel h2a/workspace-scope, secret ou host du propriétaire consulté. Worktree PR propre, git diff --check sans erreur, aucun correctif/commit/push. Seul ce rapport est conservé.

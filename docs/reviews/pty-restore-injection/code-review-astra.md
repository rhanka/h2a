NON-FUSIONNABLE
Reviewer: astra-max
PR: 382
Head-SHA: 91dfb72f8339fb6669ac8887a003cf7d207c6118

Base vérifiée : origin/main = dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3. Spec v4 et GO-CODE r3-wonder/r4-astra relus. R = packages/h2a-runtime ; H = packages/h2a. **L7 : blocage accepté par le conducteur (#375 absent de main), aucun reproche pour cette absence ni qualification B5 revendiquée.**

1. **P1 — Après le premier message, les suivants ne réveillent plus le destinataire.** H/src/runtime/drive/inbox-wake.ts:110 interpole un H2AEnvelope au lieu de son identifiant : toutes les requêtes valent `wake:[object Object]`. Le cache de R/src/native-terminal/host.ts:1399 retourne le premier ACK sans écrire, puis le handler marque les nouveaux messages vus. Reproduction : deux enveloppes distinctes, deux appels au vrai handler relié à host.inject, bail humain conservé. Sortie : `ids=["wake:[object Object]","wake:[object Object]"], first=true, second=true, writeCount=1, controlled=true`. Corriger l'identité stable par réveil ; tester deux dépôts successifs jusqu'aux octets reçus et après reconnexion.

2. **P1 — Une pause de frappe permet de modifier et d'exécuter le brouillon humain.** R/src/native-terminal/host.ts:1415 puis :1428 : seul le délai est vérifié, ensuite `text + CR` est écrit sans preuve de brouillon vide ni de foreground. Le chemin actif op.ts:1092 l'utilise sans incarnation. Reproduction sur **vrai Bash/readline isolé**, contrôleur attaché : saisir sans Entrée `printf 'REVIEW_RESULT:<%s>\n' HUMAN`, attendre 4,2 s, injecter `MACHINE`. Résultat : `injected, controlled=true, REVIEW_RESULT:<HUMANMACHINE>`, sans validation humaine. D5/D6 exigent la preuve de composition/prompt principal et la transaction avec préemption ; le timer ne la remplace pas. Zéro octet tant que cette preuve manque.

3. **P2 — L1 n'est pas raccordé au produit ; une primaire active devient un échec.** R/src/restore.ts:1674–1721 déduit le facet du tool enregistré et de la vie du PTY ; le CLI ne renseigne jamais `nativeSubtrees` (R/src/index.ts:10200). Reproduction avec le vrai restore, registre privé et inventaire natif simulé vivant, conversation résolue : `ledger=[{outcome:"blocked",reason:"occupied-human"}], observed.blocked=1` au lieu de already-active ; un vrai run en déduit exit 1 (:10238). Aucun producteur de nativeSubtrees, aucun appel produit à relaunchCandidatesForNative, aucun managed-shell.ts : reprise et garde du propriétaire natif sans pid restent incomplètes. Le ledger n'observe pas les CLI lancées ; sa condition de sortie masque aussi un échec dès qu'une entrée progresse. Raccorder D1–D4 et tester les entrées CLI, les succès partiels et la seconde restauration.

4. **P2 — Deux destinataires s'effacent leurs réveils différés.** H/src/runtime/mcp/stdio.ts:608 utilise un unique `root/inbox-wake-pending.json`, sans instance ; inbox-wake.ts:120 écrit `[]` après tout succès. Reproduction avec deux handlers et un fichier privé partagé : A différé laisse `["a1"]` ; B réussit et laisse `[]` ; après redémarrage de A, son message est initialisé comme vu : `drivesA=1` au lieu de 2. Persister atomiquement par destinataire, avant envoi, puis réconcilier l'ACK (D9).

5. **P2 — L'audit indisponible n'empêche pas la mutation.** R/src/native-terminal/host.ts:1428 écrit avant l'audit :1442 ; :1454 rend celui-ci best effort. Reproduction : XDG_STATE_HOME privé pointant vers un fichier ordinaire, donc journal impossible ; inject retourne `{outcome:"injected",automationSeq:1}` et écrit `MACHINE\r`. D7 impose l'admission durable **avant** les octets et une issue incertaine réconciliable après écriture.

6. **P2 — Les sessions distantes non classifiées sont restaurées par défaut.** R/src/restore.ts:180 exclut seulement secondary ; le CLI transmet l'absence de facet lorsque le serveur ne fournit rien (index.ts:10176). Reproduction : `selectRemoteTabsForGroups([{id:"r1",label:"delegated-unknown",cwd:"/fixture"}])` retourne une entrée. D12c exige des primaires positivement classifiées ; exclure et nommer les autres. Les options de lancement primary/secondary de D12a sont aussi absentes.

7. **P2 — LG ignore des sélecteurs spécifiés et accepte une configuration invalide.** R/src/config.ts:46 et R/src/restore.ts:1113 n'implémentent ni labels ni projectPrefixes (D13), mais ajoutent tools/tags/excludeProjects/maxTabs. `{title:"Equipe",labels:["worker"]}` est accepté puis ne matche rien. À config.ts:722, `groups:"invalide"` devient silencieusement `[]` avant validation. Implémenter le contrat ou fournir son amendement ratifié ; refuser les mauvais types avant lancement. Les nouveaux diagnostics sont également codés en anglais, hors catalogue.

8. **P2 — L0 casse la CI avant les tests.** .github/workflows/ci.yml:147 et scripts/test-sandbox.mjs:119 exigent bwrap sans le provisionner. `rtk gh run view 39468937928 -R rhanka/h2a --job 118787576300 --log-failed` : `qualification-incomplete: bubblewrap (bwrap) is unavailable on this Linux machine`, exit 3 ([job](https://github.com/rhanka/h2a/actions/runs/39468937928/job/118787576300)). Installer et qualifier la barrière dans les runners, sans repli non confiné.

9. **P2 — La preuve VTE ne fonctionne pas sous l'enveloppe autorisée.** R/src/native-terminal/vte-qualification.functional.test.ts:38 exige une écriture dans /tmp/.X11-unix, monté en lecture seule par scripts/test-sandbox.mjs:130. :116 saute donc le test sous la barrière, même avec les binaires disponibles. Fournir un espace X11 privé et rendre la qualification manquante bloquante ; les tests déterministes ne qualifient pas D10.

Couverture des lots :

| Lots / décisions | État constaté |
|---|---|
| L0 / D16 | Barrière/gardes présentes ; tests ciblés locaux verts, CI bloquée. L'attestation vérifie un fichier et un flag, pas le confinement actif (test-state-guard.ts:162). |
| L1a/L1b / D1–D4, D18 | Partiel, raccords produit et reprise absents (3). Déduplication commune aux surfaces non raccordée. |
| L2 / D5–D8 | Injection line seulement ; défauts 2/5. Pas de submit-text transactionnel, adaptateur Bash, surface D8, ni mandat revalidé au commit. |
| L3 / D9 | RED/GREEN partiel confirmé ; défauts 1/4. Pas de preuve dépôt → réception par une vraie CLI attachée ; le shell lecteur de drive.functional ne suffit pas. |
| L4 / D10–D11 | Parseur/écritures typées et hints présents ; déterministe vert, VTE non qualifiable sous l'enveloppe actuelle. |
| L5 / D12 | Provenance locale présente ; distant et flags incomplets. |
| LG / D13 | Partition/cwdPrefixes présents ; contrat incomplet (7). |
| L6a/L6 / D14 | Catalogue partagé et rendu upgrade présents, contrôles dist verts ; restore dépend du ledger défectueux. |
| L7 / D15, raccord D17 à #375 | Bloqué par décision conducteur ; aucune seconde mécanique de swap ajoutée. |

Vérifications : copies git archive jetables sous `/home/antoinefa/.cache-tmp/h2a-test/run-review-astra-jxaEO6/{head,main}` ; TMPDIR privé, tests sous bubblewrap, worktree intact. Main conserve seulement le lanceur/setup/preload L0 et les deux fichiers de tests nécessaires à la comparaison ; code produit inchangé. Build des deux packages dans chaque copie : `rtk env TMPDIR="$T/tmp" node node_modules/typescript/bin/tsc -b packages/h2a packages/h2a-runtime --force --pretty false`, **exit 0 sur les deux**. T désigne la racine privée ci-dessus.

Commandes comparées depuis chaque copie, préfixées par `rtk env TMPDIR="$T/tmp"` :

~~~sh
node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/inbox-wake-durability.test.js
node scripts/test-sandbox.mjs -- node node_modules/vitest/vitest.mjs run packages/h2a-runtime/src/native-terminal/drive.functional.test.ts
~~~

- Wake durability : main **0 pass / 3 fail / 0 skipped**, exit 1 ; head **3 pass / 0 fail / 0 skipped**, exit 0. Échecs comportementaux de la base : une tentative au lieu de deux, absence de deferred, résultat truthy incorrect.
- Drive attaché : main **1 passed / 1 failed**, refus initial deferred au lieu de driven (:432). Head : premier bloc reçu avec bail tenu, puis échec à :457, driven au lieu de deferred. La fenêtre du test de 300 ms expire pendant le lancement tsx : **test non vert**, défaut distinct de la reproduction 4,2 s du finding 2.
- Head, même enveloppe Vitest, R/src/`native-terminal/{inject,drive.functional,terminal-replies,terminal-replies.functional}.test.ts` et `{test-state-isolation,restore-inplace,restore-ledger,restore-groups,registry-restore-facet,human-output}.test.ts` : **70 passed / 1 failed / zéro skip**, exit 1 (même test drive).
- Head, même enveloppe Node, H/test/`{human-output-dist,upgrade-human-output,pty-restore-facet-hint}.test.js` : **15 pass / 0 fail / 0 skipped**, exit 0.
- Six témoins temporaires supplémentaires, même enveloppe Vitest (`native-terminal/astra-review.test.ts`, `native-terminal/astra-durability-review.test.ts`, `astra-restore-review.test.ts`) : **6 échecs comportementaux / zéro skip**, reproductions 1–6. Fixtures supprimées avec les copies. Aucun test produit modifié ou affaibli. Les autres RED/acceptations ne sont pas présentés comme démontrés ; aucune CLI fournisseur ni VTE exécutée.

`rtk gh pr checks 382 -R rhanka/h2a`, head revérifié, **exit 1** :

- **fail (11)** : Publish rehearsal (dry-run) ; build-and-test Ubuntu 22/24 ; host-oracle ; native-namespaces ; npm-test-trust-root ; portable-focus ; scoped-hosts 22/24 ; security-debt ; zero-python.
- **pass (5)** : hook-selftest ; scan-commits ; smoke-install Ubuntu/macOS/Windows. Aucun pending.

13 commits examinés, aucun trailer d'attribution ; aucun fichier Python ajouté, aucun Python exécuté. Aucun état réel h2a, secret ou host du propriétaire consulté ; aucun commit/push. Worktree PR propre. Seul ce rapport est conservé.

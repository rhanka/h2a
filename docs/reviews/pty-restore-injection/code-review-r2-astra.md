NON-FUSIONNABLE
Reviewer: astra-max
PR: 382
Head-SHA: 0e4a0e47e37245b6e709aaf3b73b77586fd7b4a0

HEAD local/GitHub concordants ; base origin/main : dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3. Spec v4. R = packages/h2a-runtime ; H = packages/h2a. A/S désignent les findings des revues Astra/Sol du premier tour. L7/#375 reste exclu du verdict conformément au blocage conducteur. Le gate security-debt, traité séparément dans #385, n’est pas un finding.

Recontrôle des P1/P2 du premier tour :

| Référence | Reproduction à ce HEAD |
|---|---|
| A1 / S2 — identité des wakes | Corrigé : deux enveloppes successives → deux identifiants distincts, deux écritures par le vrai host.inject, contrôleur attaché conservé. |
| A2 / S1 — brouillon humain | Reproduction corrigée sur vrai Bash/readline via le vrai attach : saisir sans Entrée `printf 'REVIEW_RESULT:<%s>\n' HUMAN`, attendre 4,2 s, injecter MACHINE → `refused-unproven-composition`, contrôleur toujours tenu. L’Entrée humaine exécute ensuite seulement `REVIEW_RESULT:<HUMAN>`. La voie positive après utilisation humaine manque encore (1). |
| A3 / S7 — restore/facets/ledger | Partiel : producteur nativeSubtrees raccordé et anciens cas attach-live/UUID vert ; mais refus de foreground perdu, deferred annoncé réussi et attachement supprimé (4–6). Adaptateur Bash et reprise en place toujours absents. |
| A4 / S3 — pending partagé | Corrigé sur deux vrais runMcpStdio, même racine privée : A différé laisse ["a1"] ; succès de B conserve ["a1"] ; redémarrage de A retente effectivement. Publication par fichier destinataire + rename. |
| A5 / S4 — audit indisponible | Corrigé : XDG_STATE_HOME de fixture dirigé vers un fichier ordinaire → `refused-audit-unavailable`, zéro écriture. Test inject rejoué. |
| A6 — distant non classifié | Corrigé : seules les primaires explicites passent ; inconnues exclues et nommées, secondaires sous opt-in. Tests rejoués ; flags --primary/--secondary désormais raccordés dans index.ts. |
| A7 — groupes | Reproductions corrigées : label worker placé ; préfixe de segments h2a distingue h2a2 ; groups:"invalide" lève avant lancement. restore-groups vert. |
| A8 / S9 — barrière CI | Non clos : bwrap est installé, mais son namespace échoue avant les tests (7). |
| A9 — VTE sous barrière | Ancien obstacle corrigé : /tmp privé dans le namespace ; les deux tests VTE passent ici sans skip. Le harnais exécute toutefois process.ts/op.ts via tsx, pas un package installé dans la fixture : cette partie de l’acceptation D10 reste non démontrée. |
| S5 — éviction/double soumission | Non clos : refus après éviction du premier cache, puis oubli après remplissage du second (3). |
| S6 — réponse coupée après ESC | Coupure immédiate désormais couverte ; la nouvelle minuterie réintroduit la fuite lorsque la suite est retardée (2). |
| S8 — conv-guard hors TMPDIR | Corrigé : conv-guard et conv-guard-wiring passent sous la barrière, contrôle du propriétaire natif sans PID compris. |

Findings :

1. **P1 — Après une première saisie humaine, aucun wake ne peut plus reprendre dans ce PTY.** `R/src/native-terminal/host.ts:1570`, `:1654` ; `R/src/native-terminal/op.ts:1167`. humanInputSeq croît à chaque chunk humain et n’a aucune transition de réattestation ; tout compteur positif refuse définitivement. Le driver transforme ce refus en deferred et le sidecar réessaie indéfiniment. Reproduction : CLI témoin Node dans un PTY réel, vrai attach maintenu ; envoyer `human-completed\r`, observer `ACCEPTED:<human-completed>` et son composeur vidé, attendre 4,2 s, injecter un wake. Résultat : `refused-unproven-composition, controlled:true`, aucun wake. Le refus protège bien le brouillon R1 ; il ne livre pas la passation/observation ou l’adaptateur D6 permettant de retrouver un état injectable. Implémenter cette preuve et son retour positif, sans retirer le garde. Les tests actuels ne prouvent que le succès avant toute frappe puis le refus.

2. **P2 — La minuterie ESC déverse une réponse terminal partielle dans l’entrée humaine.** `R/src/native-terminal/op.ts:671`–`:680`. Elle est armée pour un ESC isolé ; si le chunk suivant transforme le suffixe en CSI incomplet, elle reste armée et appelle flush sans revérifier hasHeldBareEscape. Reproduction par le vrai attach, lecteur post-CLI de la fixture terminal-replies : envoyer ESC, attendre 10 ms, envoyer `[?1;`, attendre 120 ms, puis `2cHUMAN-R2\r`. Sortie brute du lecteur : `\u001b[?1;2cHUMAN-R2\r\r\n`. La réponse a contourné la voie typée et sa revalidation host. Annuler/revérifier la minuterie quand le suffixe change ; couvrir cette frontière avec délai, pas seulement deux feed synchrones.

3. **P2 — La double soumission est repoussée, pas empêchée.** `R/src/native-terminal/host.ts:1602`–`:1609`. Le nouveau ring de 4096 tombstones oublie à son tour les identifiants. Reproduction sur vrai broker + PTY espion : injecter original, 4609 requêtes distinctes, puis original. Sortie : `first.automationSeq=1, second.automationSeq=4611, writes=4611, originals=2`. La même commande est donc soumise deux fois. D5/D7 exigent une réconciliation ou un refus durable des identités trop anciennes, jamais leur réadmission comme nouvelles.

4. **P2 — Un foreground explicitement inconnu devient « already-active ».** `R/src/restore.ts:1786`–`:1845`. decideInPlaceResume retourne refused pour vim, mais restore ne traite que attach/deferred ; la passe suivante recrée un facet depuis l’ancien tool du registre et la seule vie du PTY. Reproduction avec primaire UUID connue, inventaire natif vivant et nativeSubtrees contenant seulement vim : `ledger=[already-active], exit=0, total=0`. Même dégradation sans observation sur ancien host. Conserver le refus/unknown dans le ledger et ne jamais promouvoir la vie du wrapper en preuve de CLI actif (D1/D2/D18).

5. **P2 — Une primaire à reprendre, différée faute d’adaptateur, fait réussir restore.** `R/src/restore.ts:1364`. Le prédicat ne compte que blocked/failed. Reproduction : même primaire connue, subtree décrivant Bash avec `{command:"bash",args:["bash","-l"],pid:7,ppid:1,startedAtMs:1}` ; le vrai restore produit `deferred:needs-adapter`, zéro lancement, puis restoreExitCode retourne **0**. Inclure les objectifs différés non satisfaits dans le statut d’échec, y compris en présence d’un autre succès ; conserver le contrat distinct du dry-run (D2).

6. **P2 — Restore ne rouvre plus la vue d’une CLI active à conversation connue.** `R/src/restore.ts:1832`–`:1853`. Tous les noms live-agent-cli quittent le plan sans tenir compte de controlled:false. Reproduction : primaire UUID résolue, CLI claude attestée par subtree, PTY vivant sans contrôleur. **origin/main : total=1, spawnCalls=1, attachement ; HEAD : total=0, spawnCalls=0, already-active.** C’est une régression du contrôle conservé explicitement par L1 (« live uncontrolled → exactly one attach »). `R/src/restore-wiring.test.ts:170` remplace justement la conversation connue de l’ancien test par une conversation non résolue ; `:275` impose maintenant zéro tab pour le cas connu. Restaurer la distinction CLI active / vue attachée et conserver la fixture connue.

7. **P2 — Le provisionnement bwrap ne qualifie toujours pas la barrière CI.** `.github/workflows/ci.yml:153`, `scripts/test-sandbox.mjs:128`. Le workflow vérifie seulement --version. Commande rejouée :
   `rtk gh run view 39479883852 -R rhanka/h2a --job 118825365000 --log-failed`.
   Sortie du job Node 22 : `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, exit 1 avant les tests de messagerie. Qualifier une création réelle du namespace sur le runner et corriger sa configuration, sans repli non confiné. [Job](https://github.com/rhanka/h2a/actions/runs/39479883852/job/118825365000).

Couverture : L0 local ciblé vert, CI bloquée ; L6a/LG/L5 ciblés verts ; L6 conserve les défauts du ledger ; L1a incomplet (4–6). L1b n’a toujours ni managed-shell.ts ni reprise effective/sweep natif raccordé. L2 reste limité à line : pas de submit-text transactionnel, passation D6, adaptateur primaire requis, ni surface D8 complète ; le mandat agent au commit et les courses humaines en vol ne sont pas qualifiés. L3 n’a pas de preuve dépôt → réception par une vraie CLI fournisseur attachée et reste bloqué par (1). L4-hint ciblé vert ; VTE local vert mais D10 échoue sur (2). Aucun B5/#375 revendiqué.

Vérifications reproductibles :

Copies git archive privées `T=/home/antoinefa/.cache-tmp/h2a-test/run-r2-astra-mF1OIE`, sous-répertoires head/main. Produit de main inchangé ; seuls l’enveloppe/setup/preload L0 actuels et les tests comparés y sont reportés. Dépendances inchangées liées en lecture seule, packages examinés reconstruits dans chaque copie. Tests sous bubblewrap, HOME/XDG/TMPDIR privés ; l’élévation nécessaire au namespace local conserve cette barrière.

Depuis chaque copie :

~~~sh
rtk env TMPDIR="$T/tmp" node node_modules/typescript/bin/tsc -b packages/h2a packages/h2a-runtime --force --pretty false
rtk env TMPDIR="$T/tmp" node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/inbox-wake-durability.test.js
rtk env TMPDIR="$T/tmp" node scripts/test-sandbox.mjs -- node node_modules/vitest/vitest.mjs run packages/h2a-runtime/src/native-terminal/drive.functional.test.ts --maxWorkers=1
~~~

- Builds : exit 0 des deux copies, après correction des liens de dépendances de la fixture ; les erreurs initiales d’import ne comptent pas comme RED.
- Wake durability : main **0 pass / 4 fail / 0 skip**, head **4 pass / 0 fail / 0 skip**. Main : tentative 1 au lieu de 2, deferred absent, résultat truthy, requestId absent.
- Drive : main **1 pass / 1 fail / 0 skip**, `:432 expected driven, received deferred` ; head **2 pass / 0 fail / 0 skip**.
- HEAD, même enveloppe Vitest, `R/src/native-terminal/{inject,drive.functional,terminal-replies,terminal-replies.functional,vte-qualification.functional}.test.ts` + `R/src/{restore-wiring,restore-inplace,restore-ledger,restore-groups,conv-guard,conv-guard-wiring}.test.ts`, --maxWorkers=1 : **141 passed, exit 0, zéro skip**.
- HEAD, même enveloppe, `R/src/{restore-human-sessions,registry-restore-facet,launch-layout,test-state-isolation}.test.ts` : **54 passed, exit 0, zéro skip**.
- HEAD, enveloppe Node ci-dessus, `H/test/{inbox-wake-durability,human-output-dist,upgrade-human-output,pty-restore-facet-clis,pty-restore-facet-hint,wake-defer}.test.js` : **31 pass, exit 0, zéro skip**.
- Témoins privés ajoutés seulement dans l’archive : `R/src/native-terminal/astra-r2-{attach,unit}.test.ts`, `R/src/astra-r2-restore.test.ts`, `H/test/astra-r2-pending.test.js`. Ils réutilisent les fixtures existantes avec les étapes décrites ci-dessus : **six échecs comportementaux** (1–6), succès des deux batches et des deux destinataires. Le Bash R1 passe après correction de la détection de prompt du témoin ; rerun filtré : **1 pass, 2 écartés par -t**, sans prétendre qualifier tout le fichier. Le témoin d’attachement connu, copié seul sur main, passe **1/1**. Aucun changement du code produit ni des tests dans le worktree PR.
- Les autres RED/acceptations normatives ne sont pas présentés comme démontrés ; aucune CLI fournisseur n’a été exécutée.

`rtk gh pr checks 382 -R rhanka/h2a` : **exit 1, 10 fail, 6 pass, 0 pending**. Échecs : build-and-test 22/24, host-oracle, native-namespaces, npm-test-trust-root, portable-focus, scoped-hosts 22/24, security-debt, zero-python. Réussites : Publish rehearsal, hook-selftest, scan-commits, smoke-install Ubuntu/macOS/Windows. Security-debt signalé uniquement pour l’exactitude de cet état, exclu du verdict (#385).

18 commits examinés, aucun trailer d’attribution ; git diff --check sans erreur. Aucun Python exécuté/ajouté, aucun état réel h2a/workspace-scope, secret ou host natif du propriétaire consulté. Aucun commit/push. Copies et témoins temporaires supprimés ; worktree PR propre. Seul ce rapport est conservé.

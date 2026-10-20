NO-GO
Reviewer: sol-max

Re-review de la v2, SHA-256 `81b47e6ffa9231b4640070a4dbce5795b3d2c8b3fac4b9d556377ec909f82db3`. Code vérifié dans `spec-pty` à `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, capital #375 dans `ptycode` à `d5d34e20ba3cd3fecd1280647f29619bfeb3187a`. `SPEC:ligne` désigne `docs/specs/pty-restore-injection/SPEC_EVOL_PTY_RESTORE_INJECTION.md` ; `R/` = `packages/h2a-runtime/`, `H/` = `packages/h2a/`.

Recontrôle des anciennes réserves, avant les nouveaux défauts :

| Réserve précédente | État dans la v2 |
|---|---|
| Astra 1, P1 — retraite pré-B | Corrigée : D15b (`SPEC:565`), RED de la création concurrente (`SPEC:1295`). Conforme à l’amendement ratifié de #375, `BRANCH.md:50`. |
| Astra 2, P1 / Sol 3, P2 — raccord D21 | Corrigée : identité/frontière d’automatisation distincte en D5/D17 (`SPEC:555`, `SPEC:567`), fichiers et preuves sur B3 en L2 (`SPEC:937`, `SPEC:998`). Nouvelle contradiction dans une assertion de ces preuves : finding 3 ci-dessous. |
| Astra 3, P1 — brouillon/transaction | Corrigée : D5/D6 (`SPEC:555`, `SPEC:556`) fixent observation/passation, preuve du brouillon et préemption sans Ctrl-U ; RED explicites en L2 (`SPEC:968`, `SPEC:971`). |
| Astra 4, P1 — réponse terminal en vol | Corrigée : revalidation au dernier write en D10 (`SPEC:560`), raccord protocole/client/serveur (`SPEC:1132`), RED RPC suspendue (`SPEC:1115`). |
| Astra 5, P1 / Sol 2, P1 — réservation de conversation | Corrigée : D3 (`SPEC:553`), raccord au claim (`SPEC:849`), courses même PTY/deux PTY/autre écrivain (`SPEC:821`). |
| Astra 6, P2 — autorité | Corrigée : D7 distingue les garanties des deux canaux (`SPEC:557`), limite même-uid explicite (`SPEC:1382`), révocation et refus du downgrade testés (`SPEC:974`). |
| Astra 7, P2 — restore idempotent | Corrigée : D2 (`SPEC:552`) et contrôles déjà-actif/aucun candidat/dry-run (`SPEC:811`). |
| Astra 8, P2 / Sol 4, P2 — catalogue/prérequis | Corrigée : L6a (`SPEC:742`), export runtime et loader paresseux distribuables (`SPEC:771`), ordre explicite (`SPEC:645`). |
| Astra 9, P2 / Sol 5, P2 — veto Q5 | Corrigée : bascule livrée par L6 (`SPEC:1217`), Q5 reste ouverte sans veto (`SPEC:1483`). |
| Astra 10, P2 — commande avant import/inventaire L0 | Partiellement corrigée : preload et inventaire désormais nommés (`SPEC:666`, `SPEC:707`), mais commande inexécutable et raccord CI incomplet : findings 1–2. |
| Astra 11, P2 — harnais VTE | Corrigée : harnais à créer nommé, affichage/bus/installation privés, absence = qualification incomplète (`SPEC:1081`). |
| Sol 1, P1 — chemins explicites/descendants natifs | Corrigée : D16 (`SPEC:566`), garde au point de mutation et barrière OS ; cas chemin explicite, symlink sortant et enfant non-Node (`SPEC:672`). |
| Sol 6, P3 — contrôle présenté comme RED | Corrigée : reclassé explicitement en contrôle conservé (`SPEC:834`). |

1. **P2 — La commande Node obligatoire ne résout pas le preload.** Localisation : `SPEC:609` et D16 (`SPEC:566`).

   `node --import packages/h2a/test/helpers/native-isolation.js --test <file>` fournit un spécificateur ESM nu : Node cherche le paquet `packages`, pas le fichier relatif du dépôt. La commande échoue avant le preload et avant tout test ; ce n’est pas le RED comportemental exigé. Le runner existant utilise déjà un chemin absolu construit avec `join(REPO_ROOT, …)` (`scripts/run-tests.mjs:409`).

   **Correction minimale :** fixer le cwd à la racine et écrire `--import ./packages/h2a/test/helpers/native-isolation.js`, ou une URL fichier calculée comme dans le helper (`H/test/helpers/native-isolation.js:175`). Harmoniser D16, le préambule et les commandes CI, avec l’enveloppe de barrière L0 ; vérifier que la suite sans helper atteint réellement son writer après le preload.

2. **P2 — L0 exige un changement de commandes que sa liste fermée ne permet pas de qualifier.** Localisation : `SPEC:698` et `SPEC:702`.

   Les workflows manquants sont identifiables dès cette revue : `.github/workflows/ci.yml:147` et `:209`, ainsi que `.github/workflows/codex-drift.yml:54`, lancent encore `node --test` sans preload. Surtout, modifier le workflow release déjà autorisé fait échouer ses contrôles existants : `H/test/release-workflow.test.js:285` et `:610` exigent exactement l’ancienne commande nue. `H/test/run-test-gates.test.js:494` fige aussi celle du job CI indépendant. Aucun de ces deux fichiers de test n’est autorisé par L0. Laisser les commandes conserve le trou ; les remplacer laisse les gates rouges. La clause d’amendement futur ne fournit pas encore le lot aux fichiers exacts demandé par le brief.

   **Correction minimale :** ajouter maintenant les deux workflows et les deux tests de contrat à L0, pour le seul raccord preload/barrière. Actualiser les assertions vers la commande sûre exacte, en conservant l’indépendance du trust root, son exécution avant `npm test` et les preuves d’exécution existantes. Ajouter ces contrôles aux vérifications ciblées L0.

3. **P2 — Le test concurrent impose une frontière humaine immobile pendant des écritures humaines.** Localisation : `SPEC:960`, particulièrement `SPEC:963` ; acceptation `SPEC:1022`.

   Le scénario annonce deux producteurs humain/automatisation, chacun avec des octets appliqués exactement une fois, puis exige que la frontière humaine soit identique avant/après. Dans #375, chaque nouveau chunk humain D21 avance précisément `writeFrontier` vers `identity.seq` (`PR375:R/src/native-terminal/host.ts:1336`, `:1349`). Conserver cette frontière malgré les chunks humains casserait ACK/dédup ; ne pas produire de frappe humaine ne prouverait pas la concurrence annoncée.

   **Correction minimale :** conserver bail, epoch et jeton humains ; exiger que la frontière humaine avance exactement du nombre de chunks humains appliqués, sans contribution des injections. Prouver séparément qu’une injection seule ne la modifie pas, et que les deux flux reçoivent leurs ACK sans perte ni doublon.

Les cibles A1–A5/B/C/D restent couvertes, les groupes restent de la configuration owner et Q1–Q5 restent ouvertes avec leurs défauts. Aucun nouveau P1 démontré ; les trois P2 ci-dessus demandent des amendements bornés avant le code. Aucune seconde implémentation d’upgrade ni qualification B5 revendiquée.

Vérification par lecture des sources uniquement : aucun test, build, Python, binaire h2a installé ou état réel utilisé. Seul ce rapport est écrit ; aucun échec dynamique ni consensus revendiqué.

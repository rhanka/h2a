NO-GO
Reviewer: astra-max

Re-revue indépendante de la v2, SHA-256 `81b47e6ffa9231b4640070a4dbce5795b3d2c8b3fac4b9d556377ec909f82db3`. Sources confrontées : demandes verbatim, deux analyses, deux revues précédentes, code du worktree à `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, PR #375 à `d5d34e20ba3cd3fecd1280647f29619bfeb3187a`, amendement pré-B ratifié et spec PTY-B v3. Aucun test/build exécuté : les RED restent à mesurer. Aucun état réel consulté, aucun Python, aucune autre écriture.

`SPEC:ligne` désigne `docs/specs/pty-restore-injection/SPEC_EVOL_PTY_RESTORE_INJECTION.md` ; `R/` = `packages/h2a-runtime/`, `H/` = `packages/h2a/` ; `PR375:` désigne son worktree.

Contrôle des findings précédents, avant les défauts résiduels :

| Finding v1 | Vérification v2 |
|---|---|
| Astra 1, P1 | **Corrigé** : D15b (`SPEC:565`) supprime l'exception « pré-B vide » ; L7 ajoute la création v1 concurrente (`SPEC:1296`). Conforme à `PR375:BRANCH.md:50`. |
| Astra 2, P1 / Sol 3, P2 | **Contrat corrigé** : identité/frontière d'automatisation distincte, raccord `owner-protocol`, preuve sur B3 avant L3 — D5/D17 (`SPEC:555`, `SPEC:567`), L2 (`SPEC:937`). Une assertion nouvelle reste contradictoire : finding 3 ci-dessous. |
| Astra 3, P1 | **Partiellement corrigé** : D5 interdit le nettoyage et définit la transaction ; D6 fixe l'observation des délégations (`SPEC:555`, `SPEC:556`). Le parcours primaire reste incomplet : finding 1. |
| Astra 4, P1 | **Corrigé** : D10a porte la corrélation jusqu'à l'owner (`SPEC:560`), L4 nomme protocole/client/serveur et le RED RPC suspendu (`SPEC:1115`). |
| Astra 5, P1 / Sol 2, P1 | **Corrigé** : D3 impose claim commun, garde, revalidation et conservation jusqu'à observation/enrôlement (`SPEC:553`) ; L1 couvre les concurrents inter-PTY et `run --resume` (`SPEC:821`). |
| Astra 6, P2 | **Corrigé** : D7 distingue explicitement confiance même-uid et mandat agent révocable au commit (`SPEC:557`) ; §5 retire la garantie d'identité impossible sur le canal local. |
| Astra 7, P2 | **Corrigé** : D2 définit succès idempotent, zéro candidat et contrat dry-run (`SPEC:552`), repris dans l'acceptation L1. |
| Astra 8, P2 / Sol 4, P2 | **Corrigé** : L6a précède les consommateurs, export runtime `./human-output`, chargement paresseux côté h2a, tests des artefacts construits (`SPEC:742`). |
| Astra 9, P2 / Sol 5, P2 | **Corrigé** : D14f et Q5 appliquent le défaut TTY→humain avec L6 ; l'identification d'un parseur sous PTY reste ouverte sans veto (`SPEC:564`, §6 Q5). |
| Astra 10, P2 | **Inventaire et preload nommés**, mais commande exécutable à corriger (`SPEC:609`) : finding 2. |
| Astra 11, P2 | **Corrigé** : vrai harnais VTE à créer, display/bus privés, build de branche en fixture, absence = qualification incomplète (`SPEC:1086`). |
| Sol 1, P1 | **Couche mutation corrigée** : chemins explicites, symlinks, garde avant effets et enfant non-Node sont exigés (D16, L0). Barrière système nommée, mais raccord aux commandes directes incomplet : finding 2. |
| Sol 6, P3 | **Corrigé pour le scénario signalé** : attach sans injection reclassé contrôle conservé (`SPEC:836`). Autre contrôle à reclasser : finding 4. |

1. **P2 — Le chemin sûr fixé pour les délégations ne ferme pas le cas nominal des primaires à restaurer.** `SPEC:556` (D6), `SPEC:943`, `SPEC:948` (L2).

   La voie sans adaptateur suppose une fenêtre déléguée en observation dès le départ. Après une prise de main, même sa restitution exige un adaptateur prouvant l'état du brouillon ; aucun n'est nommé ni rendu obligatoire pour le shell des primaires. L2 autorise alors simplement le différé. Or A2/L1b visent précisément un PTY primaire déjà utilisé par l'humain, resté attaché après la sortie du CLI. Aujourd'hui `R/src/native-terminal/op.ts:571` prend le contrôleur humain et `R/src/tmux.ts:131` retombe dans un shell ordinaire ; ces sessions ne satisfont pas la preuve « jamais de composition humaine ». La fixture L1b CLI stub→shell peut passer sans qualifier ce parcours réel.

   **Correction minimale :** fixer une preuve et une transition positives pour le shell primaire géré — adaptateur de shell nommé ou passation attestant composition vide et octets en vol — avant L1b, avec ses fichiers autorisés. Ajouter le couple de scénarios : primaire ayant déjà reçu des frappes, CLI sorti, shell vide ⇒ reprise unique dans le même PTY ; même cas avec brouillon consommé par readline ⇒ zéro injection. Ne pas déduire cette preuve du timeout, d'une simple restitution ou d'un basculement en observation.

2. **P2 — Les commandes ciblées ne raccordent pas la barrière système qu'exige L0.** `SPEC:608`, `SPEC:609`, `SPEC:698` ; D16 (`SPEC:566`).

   §4 continue à donner directement `npx vitest run …` et `node --import … --test …`. Le launcher système est câblé au gate runner, mais aucune règle n'impose au setup/preload de refuser une exécution directe hors barrière avant l'évaluation des tests. Le preload isole l'environnement ; il ne confine pas un enfant natif écrivant vers un chemin absolu (`H/test/helpers/native-isolation.js:197`). La promesse D16 et les recettes d'exécution restent donc divergentes. En outre `--import packages/h2a/…` est un spécificateur de paquet Node, pas le chemin relatif voulu : il manque `./` ou une URL `file:`.

   **Correction minimale :** donner les deux commandes ciblées complètes passant par `scripts/test-sandbox.mjs`, avec le preload résolu correctement ; imposer au setup/preload le refus avant import produit si la barrière requise manque, ou un ré-exec confiné avant toute évaluation. Tester aussi l'invocation directe sans barrière : aucun test/enfant ne commence à écrire. L'indisponibilité de la barrière reste une qualification incomplète, jamais un repli d'exécution non confiné.

3. **P2 — Le RED des deux producteurs exige de figer la frontière humaine malgré ses écritures.** `SPEC:960`, particulièrement `SPEC:963`.

   Le test demande les octets des deux producteurs appliqués exactement une fois, puis lease/epoch/**frontier** humains « identical before and after ». Dans #375, chaque nouvelle écriture humaine D21 fait obligatoirement avancer `writeFrontier` (`PR375:R/src/native-terminal/host.ts:1336`, `:1350`). Figer cette frontière après des frappes réussies casse les ACK/dédup que D17 impose de conserver. L'indépendance vis-à-vis de l'automatisation ne signifie pas l'immobilité face aux écritures humaines.

   **Correction minimale :** garder lease/epoch/token invariants ; après N nouvelles écritures humaines, exiger `frontierAprès = frontierAvant + N`, avec zéro incrément dû aux injections. Vérifier séparément la frontière d'automatisation et la redélivrance des deux flux après coupure, octets exacts à l'appui.

4. **P3 — Le succès « tout déjà actif » n'est pas à lui seul un RED.** `SPEC:811`.

   Le chemin actuel saute les PTY contrôlés (`R/src/launch-layout.ts:269`) et finit sans code d'échec (`R/src/index.ts:10007`). Le seul exit 0 est donc déjà satisfait.

   **Correction minimale :** classer cette assertion comme contrôle conservé ; faire porter le RED sur le ledger `already-active` effectivement observé et ses totaux, aujourd'hui absents.

Les demandes A1–A5/B/C/D ont une cible, le groupement reste une configuration owner, les langues passent par des données et les questions ouvertes ne bloquent plus les lots interdits par le brief. Les corrections demandées ci-dessus restent dans ces contrats : aucune nouvelle implémentation d'upgrade, aucun assouplissement de B5 et aucune intervention sur les sessions réelles.

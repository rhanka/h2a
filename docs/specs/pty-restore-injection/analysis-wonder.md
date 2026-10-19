# Analyse — bugs upgrade/restore/PTY (A, B) + supervision/injection des PTY délégués (C)

- Date : 2026-10-19. Nature : analyse indépendante, aucun code, aucun commit.
- Sources lues : `origin/main` du dépôt `/home/antoinefa/src/h2a` (lecture par `git show origin/main:<path>`, l'arbre de travail principal étant sale, son contenu non commité n'a pas été utilisé), diff `origin/main...HEAD` du worktree PR #375 `/home/antoinefa/src/h2a/tmp/worktrees/ptycode` (branche `feat/pty-b-handover`), spec `SPEC_EVOL_PTY_B_BATCH_HANDOVER.v3.md`, brief commun et faits du conducteur.
- Aucun accès à l'état réel owner, aucun binaire installé exécuté, aucun test exécuté dans cette analyse. Les constats marqués « observé (code) » sont lus dans le code ; les constats marqués « inféré » découlent du code + des captures décrites dans le brief, sans reproduction sur machine réelle.
- Track : 01M5A9CAZ75BNCP73B0JCA9H4J, 01M5A9CGQJV44H4XYK4XCT8TPV, 01M5A9G9ESXD5RM0T7K0DJ12QM (C).
- Langue : analyse en français ; les textes de spec proposés sont en anglais (blocs « Proposed spec »).

## 0. Conclusion principale

Les sept symptômes ont une cause structurante commune : **le modèle d'état confond trois niveaux — PTY vivant, CLI vivant, fenêtre attachée — et le bail contrôleur unique confond trois rôles — humain attaché, injection ponctuelle, resize**. Restore décide sur « PTY `running` », donc il attache ou saute au lieu de relancer un CLI retombé au shell (A.2). L'injection (`drive`/`write`) exige de prendre le bail exclusif à la fenêtre humaine, donc elle échoue précisément dans le cas nominal de supervision d'un délégué visible (B, C). Le wrapper confond « fin du CLI » et « fin du PTY », d'où le hint `relaunch` au mauvais moment avec la mauvaise commande (B). La classification restore est binaire `human|background` et ignore la provenance de délégation, d'où les secondaires visibles (A.4) ; l'identité d'une session physique existe en deux lignes registry (`run` par slug, `hook` par UUID) jointes seulement à un endroit, d'où les doublons (A.5). L'upgrade échange le paquet sans jamais ordonner le sort de l'hôte PTY déjà chargé, et sa seule sortie est du JSON machine imbriqué (A.1, skew 16/10→18/10). Les réponses du terminal extérieur (DA, DECRPM) ne sont corrélées à aucune requête ni à aucun processus foreground, donc elles atterrissent dans le shell (A.3).

PR #375 (PTY phase B) traite le skew d'upgrade pour les hôtes phase-B (owner stable, frontend remplaçable, rétention, reporting `pty` par composant) mais **ne traite aucun des bugs A.1–A.5, B, C dans leur forme owner actuelle** : son diff ne touche ni `restore.ts`, ni `launch-layout.ts`, ni `relaunch.ts`, ni `tmux.ts` (wrapper), ni `registry.ts`/`session-class.ts`, ni la sémantique de bail de `drive`/`write` ; et pour l'hôte pré-B réel de l'owner (démarré le 16/10), l'amendement ratifié inscrit dans son `BRANCH.md` dit explicitement : sessions conservées sur l'ancien propriétaire, `admission: unfenced`, `retirement: deferred`, sans convergence garantie. B5 reste en outre non qualifié (cohorte CLI réelle absente, CI rouge par conception sur ce gate).

| Bug | Cause racine (1 ligne) | PR #375 |
|---|---|---|
| A.1 mur JSON upgrade | `cmdUpgrade` n'a qu'une sortie `JSON.stringify` ; le champ `hosts` embarque le stdout brut (JSON) de `doctor --repair` par hôte, ré-échappé | Non : ajoute un champ `pty` au même JSON |
| A.2 restore ne redémarre pas | Liveness = PTY `running` (wrapper→shell), pas « CLI au travail » ; hôte ancien ⇒ `controlled: undefined`/`complete:false` ⇒ fail-closed silencieux côté effet | Non (restore inchangé) ; le skew pré-B est rendu explicite `deferred`, pas résorbé |
| A.3 réponses terminal dans le shell | Requêtes DA/DECRQM relayées au terminal extérieur ; réponses retransmises sans corrélation ni drain à la transition CLI→shell, y compris au replay | Non |
| A.4 secondaires dans restore | Gate = `role!=='job' && sessionClass==='human'` (ou transcript legacy) ; ignore `delegationOrigin`/`delegator*`/`parent` ; un délégué attaché est classé `human` | Non |
| A.5 deux `i-cond` même session | Deux lignes registry par session physique (`run`:id=slug, `hook`:id=UUID) ; dédup restore par `sid` seulement, `sid:''` (attach-live) jamais dédupliqué ; surfaces sans le join affichent 2 | Non |
| B pas d'écriture PTY + hint | `write/paste/enter` = bail exclusif refusé si fenêtre attachée ; `drive` = refusé si tout contrôleur ; wrapper imprime `h2a run …` à la sortie du CLI alors que le PTY vit et que ce `run` y est refusé (`already exists`) | Non (write-identity attach seulement) |
| C send/sendmessage cassé | En tmux, `send-keys` coexiste avec le client attaché ; en PTY, la chaîne send→inbox→wake→`op drive` bute sur le bail + fenêtre d'activité ; tout échec d'acquisition est aplati en `deferred` | Non |

---

## A. Causes racines, bug par bug

### A.1 — `h2a upgrade` : mur de JSON échappé

Observé (code) :

- [packages/h2a/src/cli.ts](/home/antoinefa/src/h2a/packages/h2a/src/cli.ts:1878) `cmdUpgrade` — les quatre issues (`--check`, `upgraded`, `already-current`, `deferred-propagation`, échec) écrivent toutes `JSON.stringify(..., null, 2)` sur stdout. Il n'existe aucun mode humain, aucun `--json` opt-in, aucune détection TTY.
- [packages/h2a/src/hosts/upgrade-equipment.ts](/home/antoinefa/src/h2a/packages/h2a/src/hosts/upgrade-equipment.ts:7) `convergeAfterExplicitUpgrade` est appelé même quand rien n'a été upgradé (`already-current`, `deferred-propagation`). Pour chaque hôte de `NATIVE_HOSTS` (`vibe|muse|agy`, [packages/h2a/src/hosts/native-paths.ts](/home/antoinefa/src/h2a/packages/h2a/src/hosts/native-paths.ts:3)) il exécute `doctor --repair --host <h>` en sous-processus et retourne `{ host, ok, command: [process.execPath, ...args], result: child.stdout, diagnostic: child.stderr }` : **le stdout brut du doctor — lui-même un gros JSON — est embarqué comme chaîne**, puis ré-échappé par le `JSON.stringify` extérieur. C'est exactement la capture owner : manifests d'installation avec `sha256`, `sources`, `"selected": true`, produits par `nativeHostReport`/`convergeNativeHost` ([packages/h2a/src/cli.ts](/home/antoinefa/src/h2a/packages/h2a/src/cli.ts:7110), `cmdDoctor` à partir de la ligne 5829), terminés par `"reason": "already current or registry unreachable"` (branche `already-current` de `cmdUpgrade`).
- Défauts composés : (a) double encodage (JSON dans JSON échappé `\n\"`) illisible ; (b) la commande complète avec chemins absolus est exposée ; (c) un `already-current` déclenche quand même une convergence doctor complète sur 3 hôtes et en déverse le détail ; (d) `reason` fusionne deux causes distinctes (« déjà à jour » OU « registre injoignable ») en une phrase non actionnable ; (e) tout est en anglais machine alors que `restore` écrit déjà en français sur stderr — incohérence de langue au sein du même produit (aucun helper de locale trouvé dans ces chemins).
- Les tests existants figent ce contrat : [packages/h2a/test/upgrade.test.js](/home/antoinefa/src/h2a/packages/h2a/test/upgrade.test.js:541) parse la sortie de `cmdUpgrade` en JSON. Tout passage en sortie humaine par défaut doit donc préserver un mode machine explicite et mettre à jour ces tests en connaissance de cause.

### A.2 — `h2a restore` : les instances ne redémarrent pas, les PTY « semblent actifs »

Trois mécanismes superposés, tous observés (code) ; leur poids relatif sur la machine owner est inféré des faits du conducteur (hôte du 16/10, install du 18/10).

**M1 — Restore raisonne en vie/mort du PTY, jamais en présence du CLI.** Le wrapper partagé [packages/h2a-runtime/src/tmux.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/tmux.ts:121) `LOCAL_WRAPPER` fait retomber toute session interactive sur `exec /bin/bash -l` à la sortie du CLI. L'hôte natif ne connaît donc que `status: "running"` tant que le shell vit ([packages/h2a-runtime/src/native-terminal/host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/host.ts:567) `NativeTerminalSessionState` : aucun champ « processus foreground », « CLI présent », « shell au prompt »). [packages/h2a-runtime/src/restore.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore.ts:494) `captureHostViewSnapshot` ne retient que les sessions `status === "running"` + le bit `controlled`. [packages/h2a-runtime/src/launch-layout.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/launch-layout.ts:183) `launchLayout` en déduit, pour un onglet `local-native` vivant : `controlled:true` → sauté (« déjà visible ») ; `controlled:false` → un onglet `h2a attach` ; jamais « relancer le CLI dans ce PTY ». Il n'existe dans restore **aucun chemin in-situ** équivalent tmux (`relaunchInSession`, [packages/h2a-runtime/src/tmux.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/tmux.ts:2383)) pour un PTY natif au shell. Résultat owner : fenêtres ré-attachées sur des shells vides, ou rien — « les pty semblent actifs donc je pense que tu peux faire qqchose » : exact, l'info nécessaire (shell au prompt) n'est juste jamais relevée.

**M2 — Skew de version hôte/client ⇒ fail-closed de masse.** L'hôte réel tourne depuis le 16/10 23:33 ; le paquet 0.98.7-rc.4 a été installé le 18/10 sans redémarrage ordonné de l'hôte : sur `origin/main`, `performAutoUpgrade` ([packages/h2a/src/runtime/upgrade/index.ts](/home/antoinefa/src/h2a/packages/h2a/src/runtime/upgrade/index.ts)) ne signale ni ne remplace jamais l'hôte PTY (aucune référence à l'hôte natif hors chargement du module `node-pty` stagé), et le superviseur **adopte** tout hôte sain déjà présent sans comparer les versions (`#connectOrStart`/`connectHealthy`, [packages/h2a-runtime/src/native-terminal/supervisor.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/supervisor.ts:271)). Conséquences en cascade dans restore, toutes « sûres » individuellement, catastrophiques en somme :

- un vieil hôte ne rapporte pas `controlled` → `view.controlled === undefined` → restore imprime « controller visibility UNKNOWN … attach manually » et **saute** l'onglet (`launchLayout`) ;
- un vieil hôte ne rapporte pas `complete:true` → `listNativeSessions` pose `complete:false` ([packages/h2a-runtime/src/native-host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-host.ts:265)) → toute session absente de l'inventaire partiel devient `unknown` (`managedLiveLookupFromSnapshot`) → ni attach ni relance ;
- les boucles « native terminal connection interrupted; reconnecting » rapportées par le conducteur sont le symptôme attach du même skew (le pont [packages/h2a-runtime/src/native-terminal/op.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/op.ts:387) `runAttach` reconnecte contre un hôte dont les capacités ont divergé).

**M3 — Gates d'identité qui écartent sans relancer.** Une ligne `run` dont le `convId` est le label (bug historique documenté dans `reconcileRunConvIds`, [packages/h2a-runtime/src/restore.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore.ts:375)) non jointe à un hook `customTitle` devient `unresolved` : si le PTY est vivant elle passe en « attach-live » (attach seul, aucun resume possible) ; sinon elle est sautée avec un hint `h2a attach <slug>` sur stderr. Une identité enregistrée sur les deux hôtes (`ambiguous`, règle 3 de `resolveManagedHost`) est abandonnée par `dropDualHostIdentities`. `h-cond` « redémarrée manuellement » par l'owner est compatible avec M1+M2 (PTY au shell ou visibilité inconnue) ; trancher exigerait l'état réel, hors périmètre.

Point de méthode : chacun de ces fail-closed est défendable isolément (ne jamais fabriquer un second écrivain). Le défaut produit est l'absence (a) d'un troisième état exploitable « PTY vivant, CLI absent, shell au prompt ⇒ relance in-situ », (b) d'un bilan restore par session disant ce qui a été fait et pourquoi, (c) d'une étape d'upgrade qui traite l'hôte chargé.

### A.3 — Séquences de réponse du terminal dans la ligne du shell

Inféré (code + capture décrite). Les fragments `>|VTE(8400)`, `ESC[?61;1;21;22;28c`, `ESC[?2026;4$y`, `ESC[?1016;4$y` sont des **réponses** du terminal extérieur (VTE) : XTVERSION, Primary DA, et rapports DECRPM pour les modes 2026 (sortie synchronisée) et 1016 (souris SGR-pixels), élicitées par les requêtes d'interrogation qu'un TUI émet au démarrage. Trois défauts d'architecture, observés (code) :

1. **Aucune corrélation requête→réponse.** La sortie du PTY est relayée telle quelle vers le terminal extérieur (`relayOutput` dans `runAttach`, op.ts), donc les requêtes du CLI atteignent VTE, qui répond sur l'entrée du pont attach ; `onInput` (op.ts) retransmet **tout** octet reçu vers le PTY via `client.write`, sans distinguer frappe humaine et réponse machine, sans fenêtre d'attente, sans identité du processus foreground destinataire. Si la réponse arrive après la mort du CLI émetteur (course normale au démarrage/sortie), le lecteur foreground est `bash` : readline consomme les `ESC` comme préfixes méta et insère la queue printable — exactement la forme de la capture.
2. **Double terminal en série.** L'hôte répond déjà lui-même aux DSR curseur `ESC[6n` par un `ESC[1;1R` fabriqué (boucle « Answer Device Status Report », [packages/h2a-runtime/src/native-terminal/host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/host.ts:1023)) tout en relayant aussi la requête dans le replay vers l'extérieur : pour les familles de requêtes non interceptées (DA, DECRQM, XTVERSION…), seule la réponse extérieure existe ; pour DSR, les deux coexistent. Aucune table ne dit quelle famille est terminée par l'hôte et laquelle est déléguée.
3. **Le replay ré-émet les requêtes.** À chaque (ré)attach, le pont repeint le scrollback (« Paint the existing scrollback once », op.ts) depuis le buffer de replay de l'hôte ; les séquences d'interrogation historiques qu'il contient ré-élicitent des réponses fraîches de VTE, alors que le programme interrogateur est mort ou n'attend plus rien. Le relais de reset ([packages/h2a-runtime/src/native-terminal/reset-relay.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/reset-relay.ts), marqueur `ESC]777;h2a-reset` du wrapper) et [packages/h2a-runtime/src/native-terminal/terminal-modes.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/terminal-modes.ts) nettoient les **modes de sortie** avant le prompt du shell — couverts par `terminal-modes.functional.test.ts` (« should reset the native wrapper before its shell prompt ») — mais rien ne **draine l'entrée** : pas d'équivalent `tcflush`/quarantaine des réponses orphelines à la transition CLI→shell.

### A.4 — Des secondaires/déléguées apparaissent dans restore

Observé (code). Le gate restore est `isHumanFacingSession` = `deriveLegacySessionClass(...) === "human"` ([packages/h2a-runtime/src/restore.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore.ts:301), [:314](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore.ts:314)) :

- `endedAt` ou `role === "job"` → `background` ; sinon `sessionClass` persisté fait foi ; sinon (legacy sans classe) un transcript claude/codex ou une preuve tmux vivante suffisent à classer `human`.
- Ce gate **ignore** `delegationOrigin`, `delegatorInstance`, `delegatorTmuxSession`, `parent`, `callbackTo` — pourtant persistés et validés par le registry ([packages/h2a-runtime/src/registry.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/registry.ts:200)). Une session déléguée « revue de code » lancée visible (le mode de supervision voulu en C) n'est pas un `role:"job"` du chemin `delegate` : c'est un `h2a run` attaché.
- Au lancement, [packages/h2a-runtime/src/session-class.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/session-class.ts:18) `deriveSessionClass` classe `human` dès que `background`/`headless` sont faux et `humanTerminal` vrai ; le chemin `run` principal pose `humanTerminal: opts.attachedTerminal !== false` (défaut vrai, [packages/h2a-runtime/src/index.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/index.ts:6524)). Un conducteur qui lance un secondaire attaché pour le superviser produit donc, par construction, du `human` restaurable.
- Le vocabulaire est binaire (`human|background`) : il ne sait pas dire « primaire owner » vs « secondaire déléguée avec fenêtre ». Le scan transcripts, lui, est déjà neutralisé (`restoreClass:"unclassified"`, filtré avant groupement) — la fuite vient des lignes registry. Les tests existants ([packages/h2a-runtime/src/restore-human-sessions.test.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore-human-sessions.test.ts), DEFECT #2/#2b) ne couvrent que `role:"job"` et `background` explicite, jamais `delegationOrigin`/`parent` ni le cas legacy « transcript présent + provenance déléguée ».

### A.5 — Deux instances `i-cond` sur la même session

Observé (code) pour les mécanismes ; l'écran précis vu par l'owner n'est pas dans le brief, donc l'attribution au premier mécanisme est inférée.

1. **Deux lignes registry pour une session physique.** `enrollFromRun` upsert par `id = slug` ([packages/h2a-runtime/src/registry.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/registry.ts:1640) ; clé d'upsert `e.id === input.id` dans `applyEnroll`, même fichier) ; le hook SessionStart enroll une seconde ligne `id = session_id` (UUID conversation), `kind:"local"`, `source:"hook"` ([packages/h2a-runtime/src/enroll.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/enroll.ts:141)). Le join n'existe qu'au plan restore (`reconcileRunConvIds` + `claimedConvIds`). Toute surface qui énumère les lignes sans ce join (ls, présence, projections d'instance) peut montrer deux « instances » pour une session.
2. **Le chemin attach-live rouvre le doublon dans restore même.** `mergeDiscovered` ([packages/h2a-runtime/src/restore.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/restore.ts:729)) déduplique par `sid` non vide ; une ligne `run` non résolue mais vivante reçoit `sid:""` (attach-live) et **contourne la dédup**, pendant que sa ligne `hook` jumelle — non « claimed » puisque la résolution a échoué — survit avec le vrai UUID. `groupSessions` conserve ensuite *toutes* les sessions registry d'un projet (pas de plafond, choix assumé anti-effondrement) : deux onglets, une session.
3. Amplificateurs à écarter ou confirmer par les données : inventaire natif contenant deux entrées de même nom (détecté `ambiguous-owner` par `managedLiveLookupFromSnapshot`/`launchLayout` — alors restore refuse, pas double) ; sidecar `.h2a` compté comme instance (`nativeSidecarName`, [packages/h2a-runtime/src/native-host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-host.ts:66)) si une surface liste les sessions PTY sans filtrer le suffixe (restore filtre `h2a-`…`.h2a` dans sa vue slug-union, toutes les surfaces ne le font pas nécessairement — non vérifié exhaustivement).

La cause racine commune : **l'identité canonique d'une session physique n'est pas une clé unique du registry** (slug, nom managé `h2a-<slug>`, UUID conversation, id d'instance bus coexistent sans table de correspondance faisant autorité hors du plan restore).

### B — « Pas de méthodes d'écriture dans le PTY » ; `relaunch` bloqué ; hint au mauvais moment

Observé (code). Les primitives d'écriture existent mais sont inutilisables dans le cas nominal, et aucune surface produit ne les expose au conducteur :

- [packages/h2a-runtime/src/native-terminal/op.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/op.ts) expose `write` (frappes brutes base64), `paste` (un bloc bracketed-paste `ESC[200~…ESC[201~`), `enter` (CR), `drive` (une ligne soumise), `capture`, `state`, `probe`, `kill(-if-incarnation)`, `attach`. C'est un binaire d'opérations one-shot consommé par `execFileSync` depuis [packages/h2a-runtime/src/native-host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-host.ts) (`nativeSendKeysLiteral`, `nativePasteBlock`, `nativeSendEnter`, `driveNativeInstruction` à partir de la ligne 442) — **aucune commande CLI/MCP owner** du type « écrire dans le PTY de X » n'est câblée dessus ; les seuls appelants sont la livraison du prompt initial (`nativePromptDeliveryDeps`, native-host.ts:846), le restart (`driveNativeInstruction`, index.ts:8954) et le wake (C).
- `write/paste/enter/resize` passent par `withController` (op.ts) → `acquireController` [packages/h2a-runtime/src/native-terminal/host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/host.ts:1139) : bail **exclusif**, refus `terminal session already has a controller` dès qu'une fenêtre humaine est attachée (sans `takeover`). Pis : `withController` omet l'activité, donc défaut `"human"` ([packages/h2a-runtime/src/native-terminal/client.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/client.ts) `acquireController(..., activity = "human")`) — une écriture machine réussie **simule une activité humaine** (`lastHumanActivityAt = now`, host.ts `write`) et empoisonne la fenêtre anti-écrasement de `drive`.
- `drive` utilise `acquireAutomationControllerIfNoRecentHuman` (host.ts:1189) : refus si *tout* contrôleur est présent (même une fenêtre attachée inactive depuis une heure) ou si activité humaine < fenêtre (4 s par défaut, `H2A_WAKE_DEFER_ACTIVITY_MS`). Dans op.ts, **tout** échec d'acquisition — bail occupé, activité récente, hôte ancien sans l'opération — est aplati en `{outcome:"deferred"}` : impossible de distinguer « réessaie dans 4 s » de « ne marchera jamais avec cette fenêtre ouverte ».
- `h2a relaunch <filtre> --apply` sur une session native vivante = `killNativeSessionTree` + `startNativeSession` (détruire/recréer le PTY, [packages/h2a-runtime/src/index.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/index.ts:8990)) ; le balayage nu `relaunch --apply` (retape dans les shells idle, non destructif) ne voit que l'inventaire **tmux**. Il n'existe pas de « relancer le CLI dans ce PTY ouvert » natif — d'où le constat owner : le PTY est ouvert, donc la commande qui recrée bloque/est à côté.
- Le hint : `LOCAL_WRAPPER` (tmux.ts:121) imprime `[h2a] relaunch: h2a run <profile> <cwd> --name <label> -r <conv>` (construit par `localRelaunchCommand`, tmux.ts:181) **à la sortie du CLI**, puis `exec /bin/bash -l`. Or dans ce PTY encore vivant : (a) la bonne action est re-exécuter le CLI dans le shell courant (`claude --resume <id>` et équivalents par profil) ; (b) le `h2a run --name <même>` suggéré est refusé — `terminal session already exists` (host.ts, `create`) / `native session <slug> already exists; no agent was started` ([packages/h2a-runtime/src/native-host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-host.ts:374)) : « h2a dans h2a n'est pas possible ». Le hint `h2a run` n'a de sens **qu'après la fin du PTY** (second Ctrl-D sortant du login shell), donc côté terminal extérieur, par le pont attach ou le lanceur qui survit — jamais par le wrapper qui meurt avec lui. Le test fonctionnel actuel fige le mauvais comportement : il attend `[h2a] relaunch:` *avant* le prompt du shell (terminal-modes.functional.test.ts).

### C — Supervision et injection dans les PTY délégués ; historique send/sendmessage/wake

Demande owner (track 01M5A9G9ESXD5RM0T7K0DJ12QM) : « il faut des méthode pour superviser les pty délégués donc il faut ces méthodes d'injection, comme les sendmessage qui reposent la dessus j'imagine (historiquement c'était la méthode sendmessage en tmux, qui ne fonctionne toujours plus depuis le switch a pty) ».

#### C.1 Comment send/sendmessage et wake atteignaient un CLI sous tmux

Chaîne complète, observée (code) — deux transports distincts qu'il faut cesser de confondre :

1. **Transport message (durable, signé)** : `h2a send` / MCP `h2a_send({to,message})` → `sendLocalMessage`/[packages/h2a/src/runtime/send.ts](/home/antoinefa/src/h2a/packages/h2a/src/runtime/send.ts) : résolution du destinataire (présence + noms enregistrés, refus si ambigu), enveloppe canonique `{kind:"message",topic:"MESSAGE",text}` signée par l'identité active de l'émetteur, vérifiée contre son keyring, déposée dans l'inbox du pair. Le texte du message **n'est jamais tapé** dans un terminal (spec [docs/specs/2026-09-15-SPEC_EVOL_h2a-send.md](/home/antoinefa/src/h2a/docs/specs/2026-09-15-SPEC_EVOL_h2a-send.md), D3/D8 : le dépôt durable n'est pas présenté comme une livraison confirmée).
2. **Réveil (éphémère, tapé)** : le sidecar du destinataire (`mcp-serve --wake`) détecte les enveloppes nouvelles (`decideInboxWake`, [packages/h2a/src/wake.ts](/home/antoinefa/src/h2a/packages/h2a/src/wake.ts)), se signe à lui-même une ligne d'instruction visible `[h2a from=… sig=…] [h2a-wake reason=inbox …] run /h2a receive` (`formatSignedDriveInstruction` + `createInboxWakeHandler`, [packages/h2a/src/runtime/drive/inbox-wake.ts](/home/antoinefa/src/h2a/packages/h2a/src/runtime/drive/inbox-wake.ts)) et l'injecte dans son propre CLI hôte via un `H2ADriver`. Le `seen` n'avance que si le drive réussit : un échec transitoire est retenté au tick suivant.
3. **Driver tmux** : `localTmuxDriver` ([packages/h2a/src/runtime/drive/index.ts](/home/antoinefa/src/h2a/packages/h2a/src/runtime/drive/index.ts:509)) résout le pane depuis `launchContext.tmux`, vérifie `paneHasRecentHumanActivity` ([packages/h2a/src/runtime/drumbeat/relaunchers.ts](/home/antoinefa/src/h2a/packages/h2a/src/runtime/drumbeat/relaunchers.ts:187) — `client_activity` tmux, fenêtre 4 s, *fail-open* si illisible), puis `tmuxSendSubmit` (même fichier, ligne 152) : `tmux send-keys -t <pane> -l <texte>` puis deux `send-keys Enter` séparés (le détail compte : un `send-keys "texte" Enter` combiné ne commit pas sur les TUI modernes — commentaire du code).
4. **Propriété décisive du substrat tmux** : `send-keys` est une opération du **serveur tmux**, indépendante des clients attachés. Un humain peut regarder le pane pendant que le serveur y tape ; la seule protection nécessaire est donc la fenêtre d'activité récente (ne pas écraser une frappe en cours), pas une exclusion. Les variantes historiques vivent dans [packages/h2a-runtime/src/tmux.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/tmux.ts) : `sendKeysLiteral` (load-buffer + paste + Enter), `pasteLiteralBlock` (`paste-buffer -p`, un bloc), `submitPane`, `clearPaneComposer` (4× `C-u`), `relaunchInSession` (send-keys d'une commande dans le shell idle), `capturePaneVisible` (supervision lecture). C'est sur ces primitives que reposaient « sendmessage en tmux », les nudges de throttle, la livraison du prompt initial et le drumbeat.
5. **Autorité** (déjà présente, à réutiliser telle quelle) : `authorizeDrive` (drive/index.ts:339) — soi-même, ou `to.conductor === from`, ou `to.principal === from`, ou scope partagé + rôle pouvant émettre un MANDATE, ou consentement explicite (`findDriveConsent`) ; vérification côté récepteur `verifyDriveOnReceive`/`acceptDriveInstruction` (signature, fraîcheur, anti-rejeu, cible) exposée aux hooks via `h2a drive receive --stdin` ([packages/h2a/src/cli.ts](/home/antoinefa/src/h2a/packages/h2a/src/cli.ts:3976), câblage [packages/h2a/src/hosts/plugin.ts](/home/antoinefa/src/h2a/packages/h2a/src/hosts/plugin.ts:176)).

#### C.2 Ce qui a remplacé send-keys sous PTY natif, et pourquoi ça casse aujourd'hui

Remplacements, observés (code) :

| Primitive tmux | Équivalent PTY actuel | Écart |
|---|---|---|
| `send-keys -l` + Enter | `op drive` (1 ligne validée + CR, aucun caractère de contrôle) | Bail automation exclusif ; refus si fenêtre attachée ; échecs aplatis en `deferred` |
| `paste-buffer -p` | `op paste` (`ESC[200~…ESC[201~`) | Bail exclusif via `withController` (activité `"human"` par défaut) |
| Frappes quelconques | `op write` (base64 brut) | Idem ; aucun appelant produit hors prompt initial |
| Enter de soumission | `op enter` | Idem |
| `capture-pane` | `op capture` (écran rendu par `@xterm/headless`, [packages/h2a-runtime/src/native-terminal/screen.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-terminal/screen.ts)) | Lecture seule OK, mais aucune surface CLI/MCP de supervision |
| Observer sans contrôler | Protocole `attach-observer` + `attachObserver` client/hôte | **Aucune commande op ni surface** ne l'expose |
| Cible du wake | `H2A_NATIVE_TARGET_SESSION` posé dans l'env du sidecar ([packages/h2a-runtime/src/native-host.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/native-host.ts:694)), lu par `nativePtyWakeTarget` puis `nativePtyBackchannelDriver` qui spawn `op.js drive --target …` ([packages/h2a/src/cli.ts](/home/antoinefa/src/h2a/packages/h2a/src/cli.ts:3809)) | Résolution registre dans op (`nativeDriveSessionId`) : `unresolved`/`unknown` → pas d'injection |

Pourquoi « ne fonctionne toujours plus depuis le switch a pty », en séquence causale :

1. L'owner supervise ses délégués **avec une fenêtre attachée** (c'est la demande). Cette fenêtre détient le bail contrôleur exclusif (`runAttach` → `acquireController(..., "human", ...)`).
2. Un send arrive : dépôt inbox OK (le transport signé n'a jamais dépendu du PTY). Le sidecar destinataire tente le wake : `chainDriver(nativePtyBackchannelDriver, localTmuxDriver)` (cli.ts:2158, `--wake auto`). Le natif spawn `op drive` → `acquireAutomationControllerIfNoRecentHuman` jette `already has a controller` → op émet `deferred` → le driver journalise `failed` ; le repli tmux n'a pas de pane (session native) → `false`. Le handler garde l'enveloppe « fraîche » et retente à chaque tick — indéfiniment, sans jamais pouvoir réussir tant que la fenêtre est attachée. De l'extérieur : messages déposés, jamais de réveil, aucun diagnostic distinguant « différé 4 s » de « structurellement impossible ».
3. Même sans fenêtre : hôte ancien (pré-opération automation) ⇒ même `deferred` muet ; `write/paste` par un conducteur échouent symétriquement dès qu'un humain regarde.
4. Le test fonctionnel existant `drive.functional.test.ts` (« should submit a signed line to a real native PTY and defer after human activity ») qualifie le seul cas **sans contrôleur attaché** : le cas nominal owner n'est couvert par aucun test. C'est le trou de qualification central de C.

Cause racine unique de B et C : **le bail contrôleur a été conçu comme une exclusion d'écriture globale (« un seul écrivain »), alors que tmux fournissait un serveur d'injection concurrent de l'observation**. La protection légitime n'est pas « personne ne regarde » mais « ne pas taper par-dessus une frappe humaine en cours ». Tant que ces deux notions restent fusionnées, toute supervision déléguée visible casse l'injection, et réciproquement.

#### C.3 Ce qui existe déjà à réutiliser (capital)

- Autorité et signature bout-en-bout : `authorizeDrive`, consentement, `formatSignedDriveInstruction`, gate `drive receive`, anti-rejeu (`driveReplayGuard`). Rien à réinventer côté *qui peut demander*.
- Résolution sûre de cible : `nativeDriveSessionId` (op.ts) refuse l'ambiguïté registre ; `registryEntriesForNativeTarget`. À conserver.
- Fences d'incarnation (`generation`+`incarnation`+`epoch`, `stopIfIncarnation`) et, dans PR #375, les write-identities D21 (exactement-une-fois d'un chunk attach à travers un swap de frontend) : le futur chemin d'injection doit émettre des identités d'écriture du même type pour être auditable et non duplicable.
- Lecture : `op capture` + `renderTerminalScreen`, `op state/probe` (verdict 3 états en bande, jamais « échec = mort »), replay `read-output` par `afterSeq`, rôle observer déjà au protocole.
- Activité humaine côté hôte : `lastHumanActivityAt` est déjà tenu par session et exposé dans l'état (host.ts:567) — c'est le signal tmux `client_activity` équivalent, déjà sérielisé dans le handler de requêtes de l'hôte (décision atomique possible dans l'hôte, sans TOCTOU client).
- Journaux structurés : `appendCrashLog` (composants `cli|attach|mcp-server`, rotation, redaction — [packages/h2a-runtime/src/crash-log.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/crash-log.ts:435)) et journal hôte ; les refus d'admission y écrivent déjà. L'audit d'injection doit y trouver sa place (ou un journal frère), pas un nouveau format.

---

## B. Comportements cibles (avec textes de spec proposés)

### B.1 Sorties upgrade/restore lisibles, dans la langue de l'utilisateur

Principe : la sortie par défaut d'une commande invoquée par un humain dans un terminal est un texte court, structuré en lignes d'état ; le JSON complet reste disponible explicitement et pour les consommateurs machine actuels.

> **Proposed spec — human-first CLI output**
>
> 1. `h2a upgrade`, `h2a upgrade --check`, and `h2a restore` write human-readable output by default when stdout is a TTY: one status line per component/session, then at most one `next:` action line. No raw or nested JSON is ever printed in human mode. `--json` selects the machine contract explicitly; non-TTY stdout without `--json` keeps the current JSON contract for one deprecation cycle, announced in `--help`.
> 2. Human strings come from a single locale catalog keyed by `H2A_LANG`, then `LANG` (`fr*` → French, default English). Machine values (`outcome`, codes, versions) are never localized. Existing French strings in restore/launch output move into the same catalog; mixed-language output in one run is a defect.
> 3. Embedded sub-reports are summarized, never inlined: `convergeAfterExplicitUpgrade` returns per-host `{host, ok, changed, findings}` counts; the full doctor payload is written to the diagnostics file and referenced by path (`details: <path>`), like `logPath` today. A child process's raw stdout must never be embedded as a string field in another command's output.
> 4. `already-current` and `registry unreachable` are distinct outcomes with distinct next actions; an outcome string must never join two causes with "or".
> 5. `h2a upgrade` with no version change performs no host convergence unless `--repair` (or current `--host`) is explicit; it reports `already current` in one line. Host convergence after a real upgrade reports one line per host (`ok`/`changed n`/`action required: …`).
> 6. Every restore run ends with a per-session ledger (name → `relaunched in place` / `attached` / `already visible` / `skipped: <reason>` / `refused: <reason>`) and a totals line. A run that launches nothing while restorable sessions exist exits non-zero and names the dominant blocker (e.g., stale PTY host) with its remedy.

Exemple de forme (français, à titre d'acceptation visuelle) :

```
h2a upgrade — déjà à jour (0.98.7-rc.4). Hôte PTY : chargé 0.98.6 (pid 1234, démarré le 16/10) — voir ci-dessous.
hôtes : non convergés (aucune mise à jour ; --repair pour forcer)
pty : frontend à jour, propriétaire pré-B conservé (retrait différé) — 14 sessions préservées
suivant : rien à faire ; l'hôte PTY ancien sera traité à la fin de ses sessions (h2a doctor pour le détail)
```

### B.2 Restore qui redémarre vraiment les CLI

> **Proposed spec — three-state session liveness for restore**
>
> 1. The native host exposes, per session, a foreground facet in addition to PTY status: `foreground: "cli" | "shell" | "other" | "unknown"`, derived host-side from the PTY foreground process group / worker descendant (no client-side /proc guessing). Older hosts omit it; absence is `unknown`, never `shell`.
> 2. Restore decisions use the pair (PTY status, foreground): dead PTY + resolved conversation → recreate via `h2a run --resume` (current behaviour); live PTY + `foreground:"shell"` + resolved conversation → **relaunch in place** by injecting the profile's own resume command into that PTY through the sanctioned injection path (§B.6), then verify the CLI appears (screen/foreground change) before reporting success; live PTY + `foreground:"cli"` → attach only; any facet `unknown` → skip with a named reason (fail closed as today, but reported per session, §B.1.6).
> 3. `h2a relaunch` (bare sweep) covers native sessions with the same in-place rule; the destructive kill/recreate native path requires the existing explicit single-target form and stays out of the sweep.
> 4. A restore that finds a stale host (loaded version ≠ installed version, or missing capabilities such as `controlled`/`foreground`) says so once, with the ordered remedy from §B.7, instead of per-session UNKNOWN notes.

### B.3 Les réponses du terminal n'atteignent jamais le shell

> **Proposed spec — terminal query/reply discipline**
>
> 1. The attach bridge classifies inbound terminal replies (at minimum: Primary/Secondary DA, XTVERSION reply, DECRPM `…$y`, CPR `…R`, DECRQSS, kitty keyboard reply, OSC color replies, focus/bracketed-paste events are input and stay input) with a streaming parser. A reply is forwarded to the PTY only while a matching query is outstanding for the current controller epoch and its age is below a bounded window; otherwise it is swallowed and counted (`orphan-terminal-replies` host fault counter, surfaced in `h2a logs`).
> 2. Output relayed from the replay buffer on (re)attach must not re-elicit replies: query sequences are stripped from repainted history, or repainting is done from the rendered screen state, not raw history. Live output is untouched.
> 3. At the wrapper CLI→shell transition, after the existing mode reset, the host drains late replies for a bounded grace window before the shell prompt accepts input: bytes classified as replies during the drain are dropped; human keystrokes queued in the same window are preserved in order (they are distinguishable by the same classifier; on ambiguity, prefer preserving human input and count the event).
> 4. The host remains the single answerer for cursor-position queries it already intercepts; the outer terminal's duplicate CPR falls under rule 1 (no outstanding external query) and is swallowed.
> 5. Acceptance is measured on a real PTY pair with a real outer terminal emulator (VTE via the existing functional harness): a fixture TUI emits the startup query set and exits immediately; the following shell prompt receives zero printable bytes, and `echo` of the input line stays empty.

Note de prudence : la classification entrée humaine/réponse machine n'est jamais parfaite (un humain peut coller une séquence d'échappement). Le défaut sûr est asymétrique : en fenêtre « requête en attente », transmettre ; hors fenêtre et à la transition vers le shell, ne transmettre au shell que ce qui ne correspond à **aucun** motif de réponse connu, et journaliser les chutes.

### B.4 Exclure les déléguées/secondaires de restore

> **Proposed spec — primary vs secondary sessions**
>
> 1. Registry sessions carry an explicit restore facet set at launch: `restoreClass: "primary" | "secondary"`, independent of `sessionClass` (`human|background`). Every launch that carries delegation provenance (`delegationOrigin`, `delegatorInstance`, `delegatorTmuxSession`, `parent`, or `role:"job"`) is `secondary` by construction; the enrollment boundary rejects `primary` combined with any delegation field. An interactive owner launch with no delegation provenance is `primary`. `--secondary` / `--primary` flags on `h2a run` make the facet explicit; `--primary` is refused when delegation provenance is present.
> 2. `isHumanFacingSession`/the restore gate admits only `restoreClass:"primary"` plus class `human`. Legacy rows without the facet are classified once by evidence: any delegation field → `secondary`; `role:"job"`/`background` → excluded as today; transcript/legacy evidence may still prove `human` but never erases delegation provenance. The legacy classification result is persisted (same pattern as reconciled convIds) instead of being re-derived per restore.
> 3. `h2a restore --include-secondary` (name proposed) is the explicit opt-in that lists and restores secondaries too; `--dry-run` always prints excluded secondaries by name so the owner can see what was held back.
> 4. The h2a-sidecar companion sessions (`<name>.h2a`) are never restore tabs and never listed as instances on any surface.

### B.5 Une session physique = une instance, partout

> **Proposed spec — one physical session, one identity**
>
> 1. The registry gains one canonical session key: the exact managed name (native session id / exact tmux name). `run` and `hook` enrollments for the same physical session merge onto one row at write time (hook enrollment resolves its managed session from the stamped environment — session class env plus the native target session env already propagated to sidecars — and, when unresolvable, records the conversation as `local` evidence that read paths must join before display).
> 2. Until write-time merge has drained legacy rows, every read surface that lists sessions/instances (`ls`, restore plan, presence projections) applies the same join used by restore today (`reconcileRunConvIds` + claimed convIds), factored into one shared function. A surface may not implement its own dedup.
> 3. Merge/dedup keys, in order: exact managed name → conversation UUID → registry id. An attach-live (empty-sid) row shares its managed name with at most one other row; two live rows claiming one managed name render as one tab (attach) and produce a named registry-conflict note, never two launches.
> 4. Duplicate live names in the native inventory remain `ambiguous-owner` (refuse), as today.

### B.6 Chemin d'écriture conducteur sanctionné (cœur de B+C)

C'est le lot structurant. Idée : rétablir la sémantique tmux — un **canal d'injection hébergé**, concurrent de la fenêtre attachée, gardé par l'activité humaine et par l'autorité signée — au lieu d'un vol de bail.

> **Proposed spec — sanctioned PTY injection and supervision (delegated PTYs)**
>
> 1. **New host operation `inject`** (protocol v1 extension, capability-advertised): the host accepts an injection request `{sessionId, incarnation, payload, submit, actor}` and applies it under its own serialized handler *without* taking or revoking the human controller lease. Payload kinds: `line` (one validated text line, current drive rules), `paste` (one bracketed block), `keys` (named keys only: Enter, C-u, C-c, Escape — no arbitrary control bytes), `raw` is **not** exposed outside the existing controller write path.
> 2. **Never type over a human.** The host refuses or defers `inject` inside one atomic decision when any of: human input activity within the defer window (existing `lastHumanActivityAt`, same default 4000 ms, same env override); the PTY input queue holds unconsumed human bytes from the attached controller; the target foreground facet (§B.2) is `shell` while the payload kind targets a CLI composer (or vice versa) unless the caller names the expected facet and it matches. Refusals are typed: `deferred-recent-human` (retryable, carries `retryAfterMs`), `refused-facet`, `refused-incarnation`, `refused-no-capability` (old host). Flattening distinct refusals into one outcome is prohibited.
> 3. **Works with an attached window.** An attached human controller neither blocks injection by itself nor loses input: injections and human writes are serialized by the host in arrival order; each injected unit is bracketed so it can never interleave byte-wise with a human write chunk. Attach remains the only holder of resize authority; `inject` never resizes.
> 4. **Authority (owner model, unchanged).** Two caller classes only: (a) the *local owner channel* — processes running as the same uid that can already reach the 0600 host socket (the conductor's own CLI/MCP actions, `h2a`-internal wake/prompt-delivery) — the socket permission stays the boundary, as with tmux's socket today; (b) the *signed drive channel* for agent-to-agent instruction — the existing signed line + `authorizeDrive` + consent + receiver gate, whose final transport becomes `inject` instead of lease-stealing `drive`. The unsigned local `drive` op remains for self-wake only (caller instance == target instance) and is reimplemented on `inject`.
> 5. **Visibility.** No silent typing: agent-channel injections keep the visible signed `[h2a from=…]` line. Owner-channel injections are announced in-band with a compact visible marker line unless the payload *is* the user's own prompt delivery at launch (measured prompt-delivery protocol keeps its current composer-detection contract). Wake lines keep their `[h2a-wake …]` tag.
> 6. **Audit.** Every injection attempt appends one structured record (existing crash-log/journal plumbing): `{at, sessionId, incarnation, actor, channel, kind, bytes, outcome, reason?, controllerEpoch, foreground facet}` — content itself is never logged, only its length and, for the signed channel, envelope/nonce ids. Replayed nonce → refused before any write (existing replay guard). Injected units carry write-identities (PR #375 D21 vocabulary) so a frontend swap can neither lose nor duplicate them.
> 7. **Composer-safety for prompt-like payloads.** `paste`+submit sequences used for initial prompts and owner nudges reuse the existing measured protocol (`deliverInitialPrompt`: detect composer, paste one block, verify by capture/CPU) with `inject` as transport; a bare `line` injection never auto-submits into a shell facet.
> 8. **Supervision surface.** The same authority exposes read-only supervision for delegated PTYs: `capture` (rendered screen), `tail` (replay `read-output` from a seq cursor), `state` (incl. foreground facet + controller identity + last activity), and a long-lived `observe` built on the protocol's existing observer role — all usable while a human window is attached, none of them taking the controller lease. A single owner-facing entry point (CLI `h2a pty <session> <verb>` and/or MCP tools, name proposed not validated) wraps op operations; `op.js` stays an internal binary.
> 9. **Wake rerouting.** `nativePtyBackchannelDriver` and `driveNativeInstruction` are reimplemented on `inject`; `acquireAutomationControllerIfNoRecentHuman` and the automation controller lease are retired for injection (kept, if still needed, for stop authority only). Send→inbox→wake then works with the target window attached, deferred only by real recent typing, with the defer reason surfaced to the wake log.
> 10. **Kill/stop stay fenced.** This spec changes nothing about stop authority: `stopIfIncarnation`, takeover, and the single-controller rule for *interactive attach* are unchanged.

Points durs à ne pas édulcorer dans l'implémentation : le garde « ne pas taper sur un humain » doit être décidé **dans l'hôte** (sérialisé avec les écritures du contrôleur), pas par un client qui lit puis écrit (TOCTOU) ; la fenêtre 4 s seule ne suffit pas si l'humain a tapé sans soumettre il y a 10 s — d'où la condition « octets humains non consommés »/facet, et pour les payloads de type prompt, la vérification composer de `deliverInitialPrompt` plutôt qu'un envoi aveugle.

### B.7 Hint relaunch au bon moment + redémarrage ordonné de l'hôte à l'upgrade

> **Proposed spec — relaunch hint lifecycle**
>
> 1. On CLI exit inside a live PTY, the wrapper prints exactly: exit line (unchanged) + the in-PTY relaunch for this profile and conversation (e.g. `claude --resume <id>`, from the same resume-args source restore uses; when no conversation id is known, the plain profile command, never `h2a run …`). The words `h2a run` must not appear inside a live managed PTY.
> 2. The `h2a run … --name … -r …` recreation line is printed by the component that survives the PTY — the attach bridge on observing session exit, or the launching parent in attached mode — in the outer terminal, after raw mode and terminal modes are restored. It names the exact command that recreates this session now that the name is free.
> 3. Detach (Ctrl-\) without session exit prints the attach command (`h2a attach <label>`), never a recreation command.
> 4. `h2a run` executed inside a managed PTY for the same managed name fails with a message naming the in-PTY action from rule 1 (today: bare "already exists").
>
> **Proposed spec — ordered host treatment on upgrade**
>
> 1. `h2a upgrade` (explicit and boot auto-upgrade, same path) inventories loaded PTY components (existing fleet inventory + ping versions/capabilities) before and after the package swap and reports `installed / loaded / switched / deferred` per component in human and JSON modes uniformly (PR #375 supplies the phase-B mechanics and much of this reporting).
> 2. Phase-B hosts: swap the frontend only; never signal the owner (PR #375 D4). Pre-B fused hosts: never killed under live sessions; the upgrade states they are retained and deferred, keeps the old install pinned while referenced, and registers the ordered end-state: when their last session ends, the endpoint withdraws and the next session starts on the current host. A host with zero sessions is stopped and replaced during the same upgrade, in this order: verify staged install → probe inventory → stop empty old host → start new host → verify handshake, each step reported.
> 3. An upgrade must never finish claiming success while any component is `deferred` without naming it (PR #375 already moves this way with `pty-deferred`; extend the same rule to the boot worker's quiet-outcome set so a deferral is never silent at boot either).
> 4. Until the pre-B cohort drains, `h2a doctor` shows the stale host, its age, session count, and the exact safe next action; restore §B.2.4 points to it instead of scattering UNKNOWN notes.

---

## C. Lots, tests RED, fichiers exacts — ordonnés par douleur owner

Conventions imposées par les règles du brief : tests ciblés uniquement, racines temporaires (`mkdtemp`, `XDG_RUNTIME_DIR` temporaire), rouge-avant/vert-après prouvé par commande et sortie, aucun Python, aucune suite complète dans les lots (le conducteur la lance à l'intégration). Les noms de tests ci-dessous sont proposés.

### Lot 1 — Injection hébergée + wake qui remarche avec fenêtre attachée (B + C ; douleur n°1)

Fichiers : `packages/h2a-runtime/src/native-terminal/host.ts`, `protocol.ts`, `client.ts`, `server.ts` (dispatch), `op.ts` (op `inject`, `drive` réimplémenté), `packages/h2a-runtime/src/native-host.ts` (`nativeInject…`, `driveNativeInstruction`, `nativePromptDeliveryDeps`), `packages/h2a/src/cli.ts` (`nativePtyBackchannelDriver`), `packages/h2a/src/runtime/drive/index.ts` (inchangé côté autorité). Tests : `packages/h2a-runtime/src/native-terminal/inject.test.ts` (nouveau), `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts` (extension), `packages/h2a-runtime/src/native-terminal/op.test.ts`.

RED proposés :

- `it('injects a signed wake line while a human window stays attached')` — PTY réel + attach réel ouvrant le bail, puis send→wake ; rouge aujourd'hui (`deferred` éternel), vert = ligne visible dans le PTY, fenêtre jamais détachée.
- `it('defers injection after real human keystrokes and retries after the window')` — frappe humaine dans le PTY, injection immédiate ⇒ `deferred-recent-human` typé avec `retryAfterMs`, puis succès après expiration (horloge du harnais, pas de sleep réel long).
- `it('never interleaves injected bytes with a human write chunk')` — écritures concurrentes attach/inject, ordre et intégrité des unités vérifiés sur le flux PTY.
- `it('refuses facet mismatch instead of typing a CLI line into a shell prompt')` — wrapper au shell, payload `line` sans facet explicite ⇒ `refused-facet`, shell inchangé.
- `it('distinguishes refused-no-capability on an old host from deferred')` — hôte stub sans capability `inject-v1`.
- `it('audits every injection attempt without logging payload content')` — journal lu après succès/refus/différé.
- `it('owner write/paste/enter no longer require stealing the controller lease')` — les trois verbes réussissent fenêtre attachée ; l'activité humaine n'est pas forgée (`lastHumanActivityAt` inchangé par une injection machine).

### Lot 2 — Restore qui relance in-situ + ledger par session (A.2, avec B.1.6)

Fichiers : `packages/h2a-runtime/src/native-terminal/host.ts` (facet foreground dans `#snapshot`), `packages/h2a-runtime/src/native-host.ts` (type `NativeSessionState`), `packages/h2a-runtime/src/restore.ts` (`captureHostViewSnapshot`, plan), `packages/h2a-runtime/src/launch-layout.ts` (décision in-situ + ledger), `packages/h2a-runtime/src/index.ts` (sweep natif de `relaunch`). Tests : `packages/h2a-runtime/src/restore-launch.test.ts`, `packages/h2a-runtime/src/restore-live-recovery.test.ts`, `packages/h2a/test/runtime-restore-native.test.js`, `packages/h2a-runtime/src/native-terminal/host.test.ts`.

RED proposés :

- `it('relaunches the CLI inside a live PTY that sits at a shell prompt')` — fixture wrapper réelle (CLI stub qui sort, shell), restore ⇒ la commande resume du profil est injectée, le « CLI » réapparaît (facet passe à `cli`), aucun `h2a run`, aucun nouveau PTY.
- `it('attaches but never injects when the CLI is foreground')`.
- `it('reports one ledger line per session and exits non-zero when nothing launched')` — hôte stub sans `controlled`/`foreground` ⇒ blocage nommé une fois (« hôte PTY ancien »), pas N notes UNKNOWN.
- `it('relaunch sweep covers native shell-state sessions')`.

### Lot 3 — Sortie humaine upgrade (+ langue) (A.1)

Fichiers : `packages/h2a/src/cli.ts` (`cmdUpgrade`), `packages/h2a/src/hosts/upgrade-equipment.ts` (résumés), nouveau `packages/h2a/src/runtime/human-output.ts` (nom proposé : catalogue fr/en + sélection TTY/`--json`), `packages/h2a/src/runtime/upgrade/index.ts` (distinguer `already-current` de `registry-unreachable` si l'outcome doit être scindé — sinon porter la cause dans le résultat), help/contrat CLI. Tests : `packages/h2a/test/upgrade.test.js` (les cas `cmdUpgrade` ligne 541+ deviennent `--json`), nouveau fichier de golden humain fr/en.

RED proposés :

- `it('prints one human line and no JSON on a TTY when already current')` — sortie ≤ quelques lignes, zéro `{`, zéro `sha256`.
- `it('never embeds a child stdout string in upgrade output')` — faux doctor bavard (runtime injecté) ⇒ résumé compté + chemin de détail.
- `it('keeps the exact JSON contract under --json')` — reprend les assertions actuelles.
- `it('renders French under LANG=fr_FR and English otherwise')`.

### Lot 4 — Hint relaunch : fin du CLI ≠ fin du PTY (B, partie visible immédiatement)

Fichiers : `packages/h2a-runtime/src/tmux.ts` (`LOCAL_WRAPPER`, `localRelaunchCommand`), `packages/h2a-runtime/src/native-host.ts` (passer au wrapper la commande resume du profil, déjà connue via `resumeId`/profils), `packages/h2a-runtime/src/profiles.ts` (`resumeArgsFor` comme source unique), `packages/h2a-runtime/src/native-terminal/op.ts` (`runAttach` : imprimer la recréation à la fin de session, l'attach au detach), `packages/h2a-runtime/src/index.ts` (message `already exists` actionnable). Tests : `packages/h2a-runtime/src/tmux.test.ts` (le harnais wrapper ligne 1797 attend aujourd'hui l'ancien libellé), `packages/h2a-runtime/src/native-terminal/terminal-modes.functional.test.ts` (le cas wrapper attend `[h2a] relaunch:` avant le prompt — à inverser), `packages/h2a-runtime/src/native-terminal/op.test.ts`.

RED proposés :

- `it('prints the profile resume command, never h2a run, when the CLI exits inside a live PTY')`.
- `it('prints the h2a run recreation line only after the PTY itself ends (second Ctrl-D)')`.
- `it('prints h2a attach, not a recreation command, on detach')`.

### Lot 5 — Discipline des réponses terminal (A.3)

Fichiers : `packages/h2a-runtime/src/native-terminal/op.ts` (classifieur d'entrée du pont, fenêtre de requête en attente), `packages/h2a-runtime/src/native-terminal/host.ts` (compteur de fautes, drain de transition coordonné au marqueur reset), `packages/h2a-runtime/src/native-terminal/replay-buffer.ts`/`screen.ts` (repaint sans ré-élicitation), `packages/h2a-runtime/src/tmux.ts` (wrapper inchangé sauf si le drain a besoin d'un second marqueur — à éviter). Tests : nouveau `terminal-replies.functional.test.ts` sur la machinerie de `terminal-modes.functional.test.ts` (double PTY, terminal extérieur émulé qui répond comme VTE), `terminal-modes.test.ts` (classifieur unitaire, séquences coupées aux frontières de chunk).

RED proposés :

- `it('leaves the shell input line empty when a TUI emits startup queries and exits at once')` — le cas capture owner : DA + DECRQM 2026/1016 + XTVERSION, réponses extérieures différées après la sortie ⇒ aucun caractère printable au prompt suivant.
- `it('does not re-elicit terminal replies when repainting history on reattach')`.
- `it('still forwards human input typed during the drain window, in order')`.
- `it('swallows the outer CPR answer to a host-intercepted cursor query')`.

### Lot 6 — Primaires vs secondaires + identité unique (A.4 + A.5)

Fichiers : `packages/h2a-runtime/src/registry.ts` (champ `restoreClass`, garde à l'enrollment, validation), `packages/h2a-runtime/src/session-class.ts`, `packages/h2a-runtime/src/restore.ts` (gate + `--include-secondary` côté commande + persistance de la classification legacy), `packages/h2a-runtime/src/enroll.ts` (résolution session managée du hook), `packages/h2a-runtime/src/index.ts` (flags `run`, passages `enrollFromRun`), surfaces de liste qui énumèrent le registry. Tests : `packages/h2a-runtime/src/restore-human-sessions.test.ts` (nouveaux cas DEFECT #2c/#2d), `packages/h2a-runtime/src/restore.test.ts`, `packages/h2a-runtime/src/registry.test.ts`, `packages/h2a-runtime/src/restore-convid-reconcile.test.ts`.

RED proposés :

- `it('excludes an attached delegated session (delegationOrigin/parent set) from restore')` — rouge aujourd'hui par construction (classée `human`).
- `it('excludes a legacy classless delegated row even when a transcript exists')`.
- `it('renders one tab when an attach-live run row and its hook twin share a managed name')` — le doublon A.5 en fixture registry pure.
- `it('refuses primary enrollment carrying delegation provenance')`.

### Lot 7 — Isolation d'état des tests (question D) — voir section D pour les fichiers exacts.

### Lot 8 — Traitement ordonné de l'hôte à l'upgrade : s'appuyer sur PR #375, ne pas le doubler

Ne pas rouvrir un chantier parallèle : PR #375 porte déjà owner/frontend, rétention, `pty-deferred`, inventaire multi-générations (`fleet.ts`, `knownNativeTerminalSocketPaths`). Le travail restant après son atterrissage : brancher §B.7.2–4 dans les sorties du lot 3, qualifier B5 (cohorte réelle), et traiter la cohorte pré-B de la machine owner par le drain prévu (aucune migration de sessions vivantes pré-B n'est possible — D5 de la spec).

### Ce qui peut partir dans la prochaine rc

| Contenu | RC ? | Condition |
|---|---|---|
| Lot 3 (sortie humaine upgrade, sans scission d'outcome si risquée) | Oui | Changement de surface pur ; `--json` préserve les consommateurs |
| Lot 4 (hint aux bons moments) | Oui | Wrapper + pont ; aucun changement de protocole hôte |
| Lot 7 (isolation tests) | Oui, en premier | Prérequis de confiance pour tester les autres lots sur machine owner |
| Lot 6 lecture seule (gate provenance + dédup par nom managé, sans le nouveau champ persisté) | Oui si borné | Le gate `delegationOrigin/parent/role` sur les champs existants est un read-path ; le champ `restoreClass` persisté peut suivre |
| Lot 1 (inject) | Non en l'état | Nouveau protocole hôte + capability + hôte ancien à gérer ; c'est le chantier de la version suivante, à qualifier sur PTY réel avec fenêtre attachée |
| Lot 2 (facet foreground + in-situ) | Non | Dépend du lot 1 pour l'injection et d'un changement d'état hôte |
| Lot 5 (réponses terminal) | Partiel | Le drain à la transition + repaint sans requête peuvent précéder le classifieur complet ; à qualifier sur VTE réel |
| PR #375 phase B | Selon sa qualification propre | B5 non qualifié (cohorte) ; ne pas présenter ses reports `deferred` comme le fix des bugs du 19/10 |

Avertissement de séquençage : les lots 3/4/6-read-path améliorent l'expérience mais **ne résolvent pas** le skew d'hôte de la machine owner ; tant que l'hôte du 16/10 porte les sessions, restore restera partiellement fail-closed. La sortie de secours owner (procédure manuelle documentée : laisser finir/drainer l'ancien hôte, ou redémarrage ordonné à sessions vides) relève du conducteur/owner, pas d'un lot de code — à écrire dans le runbook existant plutôt qu'à improviser.

### Couverture PR #375, bug par bug (rappel tranché)

Diff mesuré : 40 fichiers, +6 893/−226, concentrés sur `native-terminal/{owner-protocol,owner-process,frontend-process,fleet,supervisor,server,host,op,client,protocol}`, `runtime/upgrade/index.ts`, `hosts/upgrade-equipment.ts`, `cli.ts` (ajout du champ `pty` aux sorties JSON de `cmdUpgrade` — vérifié dans le diff) et leurs tests. Aucun fichier de restore/relaunch/wrapper/registry/session-class n'est touché ; dans `op.ts`, seuls les write-identities du chemin attach changent, pas la sémantique `drive`/`write`.

| Bug | PR #375 apporte | Reste entier après #375 |
|---|---|---|
| A.1 | Reporting par composant `pty` dans le **même** JSON | Le mur JSON, l'imbrication doctor, la langue |
| A.2 | Pour un hôte phase-B : plus de skew frontend (swap sans signaler l'owner, D21 sur les écritures en vol) | La décision restore PTY-vs-CLI ; l'hôte pré-B actuel (amendement : `unfenced/deferred`, coexistence indéfinie) ; B5 non qualifié |
| A.3 | Rien (la discipline réponses n'est pas au périmètre ; §8 de la spec liste l'ANSI/TUI complexe comme non couvert) | Tout |
| A.4 | Rien | Tout |
| A.5 | Rien (les identités d'écriture D21 ne sont pas l'identité registry) | Tout |
| B | Préservation des chunks attach pendant un swap de frontend | Le bail comme porte d'écriture ; le hint ; le relaunch destructif par défaut |
| C | Rien sur `drive`/wake | Le réveil avec fenêtre attachée |

---

## D. Empêcher les tests d'écrire dans l'état réel de l'owner

### D.1 Quel test a écrit le `attach.log` réel le 17/10 — réponse

Deux fichiers de test, un mécanisme. Identification par les identifiants de fixture uniques, observée (code + historique git) :

1. **`packages/h2a-runtime/src/attach-reconnect-livelock.test.ts`** — appelle `attach({ sessionId: "sess-livelock", … })` (ligne 72) de `packages/h2a-runtime/src/attach.ts`, qui journale `appendCrashLog("attach", { event:"refusal", sessionId, reason:"reconnect-give-up", … })` (attach.ts:445, et aussi :127/:397/:477/:498). Le fichier de test ne positionne **aucune** isolation (`XDG_STATE_HOME`, `HOME`) : `appendCrashLog` résout alors `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/attach.log` ([packages/h2a-runtime/src/crash-log.ts](/home/antoinefa/src/h2a/packages/h2a-runtime/src/crash-log.ts:108) `resolveCrashLogPath`, [:435](/home/antoinefa/src/h2a/packages/h2a-runtime/src/crash-log.ts:435) `appendCrashLog`), soit le fichier réel de l'owner. C'est la source des entrées `sess-livelock`.
2. **`packages/h2a-runtime/src/native-terminal/op.test.ts`, premier `describe` (« native terminal attach recovery », dès la ligne ~84)** — pilote `runAttach("h2a-alpha", …)` (lignes 100, 145, 275, 379…) avec des clients factices ; `runAttach` journale dans `attach.log` aux sorties/refus (op.ts:453, :490, :541, :602, :609, :635, :648, :710, :720). Le *second* `describe` du même fichier (ligne ~315) positionne correctement `XDG_STATE_HOME` vers un `mkdtemp` en `beforeEach` — le premier ne le fait pas. C'est la source des entrées `h2a-alpha`.
3. **Pourquoi le 17/10** : les crash logs par composant ont été introduits le 16/10 (`d6ac6d614 feat(logs): per-component crash logs…`, durcis `f505f9e16`/`018657196`, clôture revue `2081e521b` le 17/10 — `git log` sur ces trois fichiers). Des tests préexistants, qui n'écrivaient jusque-là aucun fichier d'état, ont commencé à écrire dans le réel **sans aucun changement de leur côté** le jour où le code de production sous test a gagné un effet de bord fichier à chemin par défaut. Les versions 0.98.7/0.98.8 des entrées correspondent à `getCrashLogVersion()` (version du paquet runtime lu au moment du run — deux états d'arbre entre 14:44 et 18:58, plausible en pleine campagne de revues ; inféré).
4. **Pourquoi la barrière existante n'a rien vu** : le setup global vitest (`packages/h2a-runtime/vitest.config.ts` → `setupFiles: ["./vitest.native-isolation.mjs"]`, et même setup dans `vitest.config.mjs` racine) n'installe **que** `afterEach(assertNoNativeTestSpawnViolations)` — une assertion sur les *spawns* d'enfants natifs. L'isolation complète existe ([packages/h2a/test/helpers/native-isolation.js](/home/antoinefa/src/h2a/packages/h2a/test/helpers/native-isolation.js) : `setupNativeTestEnvironment`, `nativeTestEnvironment`, `assertIsolatedEnvironment` exigeant `HOME`, `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `H2A_NATIVE_SOCKET` sous une racine de qualification privée, refus explicite des chemins owner) mais elle est **opt-in par fichier** (une quinzaine de fichiers l'appellent) et pensée pour les processus enfants. Aucune des deux suites coupables ne spawn le moindre enfant : la fuite est une écriture **en processus**, hors du modèle de menace du garde actuel. Tout autre appelant en processus d'un writer à chemin par défaut (crash logs, journal hôte, registry, `layout-last.json`, config résolue par `resolveConfigPath`) présente le même risque latent — un inventaire systématique fait partie du lot.

### D.2 Prévention structurelle (proposée)

> **Proposed spec — test state isolation by construction**
>
> 1. The package test setup (`vitest.native-isolation.mjs`, both configs) installs, before any test file runs, a per-worker temporary environment: `HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`, `REMOTE_CLI_CONFIG_HOME`, `TMPDIR` under one `mkdtemp` root, reusing `nativeTestEnvironment`'s builder. Setting these earlier is unnecessary: every default-path writer in scope resolves its path at call time (verified for `appendCrashLog`); any writer that caches a resolved path at module load must be fixed to resolve at call time as part of this lot.
> 2. A test file may narrow further (its own sub-root) but can no longer run with owner paths by omission: `assertIsolatedEnvironment` runs in a global `beforeAll`, and a suite whose environment still points at owner state **fails** (owner rule: a test that silently depends on or skips because of real state is failed, never green).
> 3. Defense in depth in production code: default-path state writers refuse to write when a test harness is provably in control but isolation is missing — concrete rule: if the qualification root marker env used by `native-isolation.js` is set, every resolved state path must lie under it, enforced at the shared path resolvers (`resolveCrashLogPath`/`resolveCrashLogDir`, registry path, journal path, config path), throwing a named error instead of writing. No such check applies outside the marked test environment.
> 4. The spawn guard gains an in-process twin: the setup snapshots the temp state tree and, per test file, asserts no write escaped it (canary: the real owner state dir is never stat'ed for content — instead the resolvers in rule 3 are the enforcement, and a unit test proves each resolver refuses an owner path under the marker).
> 5. Node `--test` suites (`packages/h2a/test/*.test.js`) get the same treatment through their existing runner entry (`scripts/run-tests.mjs` or the suites' shared helper): same temporary env contract, same failure on omission. Test files that already self-isolate keep working unchanged.
> 6. Regression fixtures are the two historical leakers: both suites run green with **zero** writes outside the temp root, proven by pointing `HOME` at an unwritable sentinel directory whose untouched mtime/content is asserted after the run — without ever reading or touching the owner's real state in CI.

### D.3 Lot 7 (fichiers et RED)

Fichiers : `packages/h2a-runtime/vitest.native-isolation.mjs`, `packages/h2a-runtime/vitest.config.ts`, `vitest.config.mjs` (racine), `packages/h2a/test/helpers/native-isolation.js` (extension, en respectant son statut dans les lots existants — lecture seule imposée par la spec PTY-B lot B5 pour *ce* chantier-là ; ici c'est un autre lot, à coordonner), `packages/h2a-runtime/src/attach-reconnect-livelock.test.ts`, `packages/h2a-runtime/src/native-terminal/op.test.ts`, `packages/h2a-runtime/src/crash-log.ts` (+ les résolveurs de chemins d'état partagés identifiés à l'inventaire), point d'entrée des suites node `--test`.

RED proposés :

- `it('attach-reconnect-livelock writes its crash rows only under the isolated state root')` — aujourd'hui : écrit dans le `HOME` ambiant (à démontrer contre un faux `HOME` temporaire sentinelle, jamais contre le réel).
- `it('the first op.test describe cannot reach the ambient attach.log')` — même harnais sentinelle.
- `it('a suite with no explicit isolation still runs on the worker temp environment')` — fichier fixture minimal qui appelle `appendCrashLog` sans rien configurer.
- `it('state path resolvers refuse owner paths under the qualification marker')` — unitaire par résolveur inventorié.

Séquençage : lot 7 **en premier** dans la prochaine rc — c'est lui qui rend les preuves rouge/vert des autres lots exécutables sur la machine de l'owner sans risque.

---

## E. Questions ouvertes pour l'owner (principes, avec recommandation)

Forme : question ouverte sur le principe, contexte minimal, recommandation de l'analyse. Aucune n'est bloquante pour les lots 3/4/7.

**Q1 — Autorité d'injection locale : la permission du socket suffit-elle comme frontière « owner », ou faut-il une identité signée aussi en local ?**
Contexte : sous tmux, quiconque accède au socket du serveur peut `send-keys` partout ; le canal signé `drive` ajoute signature+consentement pour l'agent-à-agent, mais le wake de soi à soi et les actions du conducteur passent aujourd'hui sans signature, par le socket 0600 de l'hôte. §B.6.4 propose de conserver ce modèle à deux canaux. Alternative : exiger l'identité signée pour toute injection, y compris locale (plus d'audit, plus de friction, casse le prompt-delivery au lancement avant identité).
Recommandation : conserver les deux canaux de §B.6.4. Le socket 0600 même-uid est déjà la frontière de fait de tout le substrat (create/kill inclus) ; la valeur ajoutée est dans l'audit systématique (§B.6.6), pas dans une signature de soi à soi.

**Q2 — Que doit faire une injection quand l'humain a tapé sans soumettre (composer non vide) mais que la fenêtre d'activité est expirée ?**
Contexte : la fenêtre de 4 s ne voit pas un brouillon vieux de 30 s. Options : différer jusqu'à soumission/vidage (peut différer indéfiniment un wake), injecter en préservant le brouillon quand le protocole composer le permet (paste mesuré), ou signaler sans taper (le message reste en inbox, un marqueur non-injecté s'affiche). Le choix touche au principe « jamais taper sur un humain » vs « un délégué supervisé doit recevoir ses ordres ».
Recommandation : différer avec raison typée et borne configurable (défaut proposé : retenter jusqu'à soumission, alerte conducteur au-delà d'un seuil), jamais d'écrasement silencieux ; le conducteur humain garde un forçage explicite par la surface de supervision. Le seuil et le forçage demandent votre arbitrage.

**Q3 — Les secondaires doivent-elles être restaurables en un geste séparé, ou jamais restaurées automatiquement ?**
Contexte : §B.4 propose `restore` = primaires seulement + opt-in `--include-secondary`. Reste ouvert : une secondaire interrompue au milieu d'une tâche déléguée (revue, analyse) a-t-elle une valeur de reprise pour vous, ou doit-elle toujours être relancée fraîche par son conducteur ?
Recommandation : opt-in explicite par restore (proposition §B.4), parce que la reprise d'une conversation de revue a une valeur réelle mais ne doit jamais envahir le restore du matin. Si votre usage est « jamais », le flag devient inutile et la règle se simplifie.

**Q4 — À l'upgrade, quel sort pour l'hôte PTY ancien encore chargé : coexistence affichée (drain naturel), ou redémarrage ordonné proposé explicitement quand il ne porte que des shells ?**
Contexte : la spec PTY-B tranche « ne jamais migrer/tuer un pré-B avec sessions » ; l'amendement #375 accepte une coexistence indéfinie `deferred`. Mais un hôte qui ne porte plus que des PTY au shell (aucun CLI vivant — détectable avec le lot 2) pourrait être redémarré sans perte de conversation, moyennant la perte des shells/scrollbacks. Principe en jeu : « ne jamais casser une session » inclut-il le shell et son historique ?
Recommandation : ne jamais redémarrer automatiquement un hôte avec CLI vivant ; pour le cas « shells seuls », proposer (jamais imposer) le redémarrage ordonné dans la sortie d'upgrade, avec le compte exact de ce qui serait perdu. Votre définition de « session à préserver » décide.

**Q5 — La sortie humaine par défaut casse le contrat JSON actuel de `h2a upgrade` sur TTY : acceptez-vous le basculement TTY→humain / pipe→JSON, ou faut-il un défaut inchangé + `--human` explicite ?**
Contexte : des scripts/outils peuvent parser la sortie actuelle (les tests du dépôt le font). Le basculement par TTY est le standard des CLI, mais tout consommateur qui allocue un PTY et parse serait cassé.
Recommandation : TTY→humain, `--json` explicite, pipe→JSON pendant un cycle de dépréciation annoncé (§B.1.1). Si vous connaissez un consommateur PTY-parseur, inverser le défaut.

**Q6 — Langue des sorties : catalogue fr/en piloté par `LANG` (§B.1.2), ou français fixe pour les commandes owner locales (restore est déjà partiellement en français dans le code) ?**
Recommandation : catalogue piloté par l'environnement, défaut anglais pour la distribution, français complet dès le lot 3 — votre règle « parler français à l'owner » est satisfaite par votre `LANG`, sans figer le produit. À confirmer si vous préférez le français sans condition sur votre machine.

---

## Limites de cette analyse

| Élément | Statut |
|---|---|
| Causes A.1, A.4, B (bail, hint), C (chaîne wake), D (fuites) | Observées dans le code `origin/main`, chemins et symboles cités |
| A.2 poids relatif M1/M2/M3 sur chaque instance nommée (`h-cond`, `k8s`, `gr-conductor`) | Inféré des faits conducteur ; non vérifié (état réel hors périmètre, règles du brief) |
| A.3 séquence exacte de la capture (quelle requête a produit quelle réponse) | Inférée ; le mécanisme (absence de corrélation/drain/repaint) est observé dans le code |
| A.5 surface exacte où les deux `i-cond` ont été vues | Non fournie ; mécanismes 1 et 2 observés, attribution au plus probable |
| PR #375 | Lu par diff contre `origin/main` + `BRANCH.md` + spec v3 ; aucun de ses tests n'a été exécuté ici ; ses preuves rouge/vert citées proviennent de son `BRANCH.md` (non revérifiées) |
| Tests | Aucun test exécuté (analyse seule, conformément au brief) ; tous les RED sont des propositions à faire échouer d'abord sur le code actuel |
| macOS/Windows | Non couverts au-delà de ce que la spec PTY-B énonce (lot BM, gates séparés) |



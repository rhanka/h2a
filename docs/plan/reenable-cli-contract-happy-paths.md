# Plan — réactivation des 16 tests happy-path du contrat CLI (DEC-034)

Branche : `test/reenable-cli-contract-happy-paths` (depuis `origin/main` v0.98.5).
Fichier : `packages/h2a/test/cli-contract.test.js` (les 16 skips datent du 2026-06-29, DEC-034).

Demande (owner, verbatim) : « les 16 tests désactivés pourquoi ils sont désactivés, ce
sont des fonctions qui devraient fonctionner, lance une autre branche pour ça car il
faut planifier leur réactivation ».

## 1. Pourquoi ils étaient désactivés

Deux causes distinctes dans le harnais historique :

1. **`outputShape === "stream"`** (8 verbes) : le harnais one-shot ne sait lire qu'un
   payload stdout unique ; un flux long-courant n'a pas de « fin ». Le skip disait
   « covered by mcp-stdio.test.js » — exact pour `mcp-serve`, faux pour les 7 autres.
2. **`buildHappyArgv` renvoie `null`** (8 verbes) : soit le verbe est asynchrone
   (dispatché par `bin.ts`, hors `runCli` synchrone : `loop tick`, `sysml verify`,
   `drumbeat relance-inbox`, `keepalive`), soit il lui manque un fixture
   (`negotiate stabilize` : quorum + clé ed25519 enregistrée ; `drive`/`drive receive` :
   paire conducteur/agent enregistrée + ligne signée ; `upgrade` : chemin d'upgrade
   réel — réseau + préfixe global).

## 2. Harnais de réactivation

- **Harnais « streaming » borné** (verbes `stream` + verbes async one-shot) : chaque
  verbe démarre **dans une racine temporaire** (`mkdtemp` ; `HOME`, `XDG_RUNTIME_DIR`,
  `H2A_ROOT` isolés pour tout processus enfant), le test lit son **première
  enveloppe**, asserte la forme déclarée, puis **l'arrête proprement** :
  - in-process avec `PassThrough` + `AbortSignal` quand le runner exporté le permet
    (précédent du dépôt : `mcp-stdio.test.js`, `focus-serve.test.js`,
    `drumbeat-watch-d5.test.js`) ;
  - spawn de `packages/h2a/dist/bin.js` (jamais le `h2a` installé) quand le verbe
    s'attache à stdio du process (`track-mcp`) — arrêt garanti : SIGTERM sur le PID
    enfant spawné, puis SIGKILL en dernier recours, timeout dur sur chaque test.
- **Verbes one-shot sync** : le harnais `runCli` existant reçoit les fixtures qui
  manquaient (paires d'instances, quorum, runtime d'upgrade injecté).

## 3. Les 16 verbes

| # | Verbe | Cause du skip | Ce qu'il faut | Risque | Statut visé |
|---|-------|--------------|---------------|--------|-------------|
| 1 | `loop tick` | async (lazy runtime), hors `runCli` | racine temp + loop créée ; `runLoopEngineCli` in-process ; plan JSON (`loopId`, `outcome`, `actions`) | import lourd du runtime (lent mais borné) | réactivé |
| 2 | `loop watch` | idem + périodique | `--max 1` : le verbe se termine seul après 1 plan ; 1re ligne = plan JSON avec `exec` | aucun (self-terminating) | réactivé |
| 3 | `canevas serve` | stream | serveur 127.0.0.1 in-process avec port libre sondé ; 1re enveloppe = bandeau `on http://127.0.0.1:<p>` ; GET `/api/decisions` ; abort → rc 0 | port 8788 par défaut → collision possible ; on passe un port libre | réactivé |
| 4 | `focus serve` | stream | repo tracké temporaire + assets vendored (`packages/h2a/focus-app`) ; `--port 0` ; 1re enveloppe = `Focus Web: http://127.0.0.1:<p>` ; abort → rc 0 | mutates `process.env` (restauré en `finally`) | réactivé |
| 5 | `focus web` | alias exact de `focus serve` | même harnais, argv `web` | idem | réactivé |
| 6 | `mcp-serve` | stream (vraiment couvert par mcp-stdio.test.js) | in-process `runMcpServe` + `PassThrough` ; requête `initialize` ; 1re réponse JSON-RPC (`jsonrpc:"2.0"`, `id`, `result.protocolVersion`, `serverInfo.name`) ; EOF stdin → rc 0 | aucun (précédent du dépôt) | réactivé |
| 7 | `track-mcp` | stream | spawn `dist/bin.js track-mcp --track-dir <temp>` (le runner s'attache à stdio du process → in-process impossible) ; `initialize` → réponse JSON-RPC (`serverInfo.name === "@sentropic/track"`) ; EOF stdin → exit 0 ; SIGTERM/SIGKILL en secours | processus enfant → isolation HOME/XDG_RUNTIME_DIR temp | réactivé |
| 8 | `drive serve` | stream | in-process `runDriveServe` `--port 0` + `onListening` ; 1re enveloppe = ligne `listening on http://…` ; `server.close()` → rc 0 | aucun | réactivé |
| 9 | `drumbeat watch` | stream | racine temp + stop-entry seedée ; in-process `runDrumbeatWatch` (relauncher `logging`) ; 1re enveloppe = bandeau `watching <root> every …` ; abort → rc 0 | tick asynchrone → abort propre via signal | réactivé |
| 10 | `negotiate stabilize` | quorum + clé ed25519 | registre la clé publique de `req-001` (`addInstanceKey`), `negotiate sign` (sink), puis `stabilize` sur `nego-cc` ; enveloppe action `{ok:true, record.status:"stabilized"}` | aucun (recette de `cli-negotiate-sign-stabilize.test.js`) | réactivé |
| 11 | `upgrade` | réseau + install global | `cmdUpgrade` avec **runtime injecté** (seam DEC-107 déjà utilisé par `upgrade.test.js`) : fetch/stage/swap entièrement factices, préfixe **temporaire** ; enveloppe action `{ok:true, upgraded:true}` ; aucune installation réelle touchée | aucun — le chemin réel n'est jamais branché | réactivé |
| 12 | `drive` | fixtures (paire signataire) | enregistre `claude:lead` (CONDUCTOR, cap `drive`, clé publique) + `codex:worker` (AGENTS, conducteur lead) ; `--driver logging` ; enveloppe action `{ok:true, driven:true}` | aucun (recette de `drive.test.js`) | réactivé |
| 13 | `drive receive` | fixtures (ligne signée) | même paire ; `formatSignedDriveInstruction` + `--now` fixé ; enveloppe action `{ok:true, from, to, instruction}` | garde anti-replay persistante → racine fraîche | réactivé |
| 14 | `sysml verify` | async + enveloppe signée | `createEnvelope`+`signEnvelope` (ed25519) avec `sysmlRef` ; commit-trust seulement (**pas** `--content-integrity` → zéro réseau) ; in-process `runSysmlVerify` ; enveloppe resource `{ok:true, signatureVerified:true}` | aucun | réactivé |
| 15 | `drumbeat relance-inbox` | async | racine temp + `recordStop` + enveloppe `drumbeat.resume` dans l'inbox ; in-process `runDrumbeatRelanceInbox` (relauncher `logging`) ; enveloppe action `{ok:true, relanced:[…]}` (le relauncher log écrit aussi sur stdout → extraction de la dernière enveloppe JSON) | aucun (recette de `drumbeat-remote-relance.test.js`) | réactivé |
| 16 | `keepalive` | async + tmux | **reste désactivé** — voir §4 | — | reste skip |

## 4. `keepalive` — pourquoi il reste désactivé

Raison exacte (le test le dit) : *la forme déclarée par DEC-034 est `action`
(enveloppe JSON `{ok:true}`), mais le verbe n'émet JAMAIS de JSON sur stdout —
seulement des lignes texte `h2a keepalive: refreshed …`, et rien du tout quand tmux
est absent ou qu'aucun pane n'est vivant. Avec `--once`, le happy-path isolé
(sans tmux) produit un stdout vide et rc 0.* Activer le test aujourd'hui échouerait
sur `assertShape("action")` que le code ne peut pas satisfaire.

Dépendance bloquante : amendement DEC-034 (contrat gelé) — soit re-déclarer
`outputShape: "text"` ET faire émettre au verbe une sortie non vide sur `--once`
(bannière), soit faire émettre au verbe une vraie enveloppe action. Toute autre
option dépend de tmux (le prober lit `tmux list-panes -a` — l'environnement du
propriétaire), incompatible avec le confinement des tests.

Date cible : **2026-10-26** (une décision DEC suffit ; pas de travail de fond).

## 5. Ordre d'exécution

1. Verbes one-shot sync avec fixtures (10, 12, 13, 14, 11, 15) — risque nul, harnais existant.
2. Verbes async one-shot (1, 14 déjà, 15 déjà) — `runLoopEngineCli` in-process.
3. Streams in-process à arrêt propre (2, 3, 4, 5, 8, 9, 6).
4. Spawn enfant isolé (7).
5. `keepalive` : skip documenté + DEC à prendre.

Chaque test réactivé est prouvé par mutation : casser la sortie du verbe (dans
`dist/`, jamais commis) → le test échoue ; restauration → vert.

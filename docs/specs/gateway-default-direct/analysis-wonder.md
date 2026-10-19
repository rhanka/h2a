# Gateway par défaut au restart — analyse (WP14, bug owner 19/10)

Objet : track `01M5AANHQWK4RZRCXT5VVA2CM6`. Contexte : après restart de
l'hôte natif (`h2a restore` / upgrade des instances PTY), des sessions
Claude reviennent via la gateway locale llm-mesh
(`ANTHROPIC_BASE_URL=http://localhost:<port>`) alors que le direct est le
défaut attendu. Lecture seule, aucun état réel owner touché.

## Base lue et méthode

| Élément | Valeur |
| --- | --- |
| Code analysé | `origin/main` `dc78dc5f7` via `git show` |
| Checkout courant | `docs/org-raci-wp7-hinfra` `0d6b2eaf5` (non utilisé) |
| Arbre sale | Non lu comme preuve |
| `main` locale | `ec09dac96` (v0.97.9), en retard de 594 sur `origin/main` |
| Numéros de ligne | Ceux de `origin/main` |

## Conclusion en tête

Le défaut « direct » existe pour un lancement neuf sans pin. Au restart,
trois mécanismes le contournent et suffisent à reproduire le bug.

| # | Mécanisme | Effet au restart |
| --- | --- | --- |
| 1 | Pins `gatewayMode` fossiles | `gateway` sans `--gw` du jour |
| 2 | Drapeau global `llmMesh.enabled` | Restore/délégation rallument la gateway |
| 3 | Héritage `ANTHROPIC_*` | Enfant gateway sans décision |

Cause racine unique : il n'y a pas une source de vérité du défaut. Le mot
`auto` a deux résolutions selon le chemin (voir §1.0), et l'état persisté
d'avant les correctifs n'a jamais été migré (voir §2 et §3).

## 1. Chemins qui activent la gateway sans opt-in explicite

### 1.0 Les deux résolutions de « auto »

| Résolution | Ancrage | `auto` devient |
| --- | --- | --- |
| Via `gatewayModeForProfile` | `protocol-local.ts:37` | `direct` |
| Via `injectLlmMeshGatewayEnv` brut | `index.ts:2218` | `gateway` si `enabled=true` |

Détail. `gatewayModeForProfile(profile, requested)` rend `direct` pour tout
profil non-Claude, et `direct` pour `auto` sinon (`protocol-local.ts:37-43`,
décision owner 2026-09 commentée lignes 25-35).
`injectLlmMeshGatewayEnv(mode)` purge si `direct`, purge aussi si
`mode != gateway` et `enabled=false`, sinon acquiert ou démarre la gateway
et injecte l'env (`index.ts:2223-2247`, message
`gateway was stopped; started on …` ligne 2246). Tout appelant qui transmet
`auto` brut contourne donc le défaut direct dès que `enabled=true`.

Défauts lib déjà directs sur `origin/main` (à verrouiller, pas à corriger) :

| Surface | Ancrage | Défaut |
| --- | --- | --- |
| `llmMesh.enabled` absent | `config.ts:527-532` | `false` |
| Profils CLI | `profiles.ts:11-21` | Aucun champ gateway |
| Config gateway absente | `gateway-host/config-file.ts:43` | `null`, port 3002 |
| Siège CLI synthétique | `cli-seat-materialization.ts:213` | `gateway: "off"` imposé |

Aucun écrivain primo-install trouvé sur `origin/main` : pas de seed
`enabled=true` à l'installation, `doctor` ne touche pas la gateway, la
migration de home copie l'ancien état tel quel (`index.ts:2704`,
`config.ts:353`). Le point 1 du bug (« conf par défaut de la lib ») est donc
aujourd'hui un risque de régression à tester, pas un défaut codé aux trois
endroits ci-dessus. Deux pièges primo-usage subsistent (§1.1, lignes G1-G2).

### 1.1 Config globale, daemon et primo-usage

| ID | Chemin | Ancrage | Déclencheur → effet |
| --- | --- | --- | --- |
| G1 | `llm-mesh start` persiste | `index.ts:10956,10965` | Un start → G3+G4 à vie |
| G2 | `llm-mesh stop` ne désarme pas | `index.ts:11001-11010` | Stop seul → résurrection |
| G3 | Restore prépare avant onglets | `index.ts:9995-10000` | Sans `--no-gw` → gateway |
| G4 | Délégation `startJob` | `index.ts:1560-1563` | Claude+`enabled` → gateway |

- G1. `h2a llm-mesh start`, `enable` et `restart` écrivent
  `llmMesh.enabled=true` dans `config.json` (`index.ts:10956`, `10965`,
  `10982`, `11030` via `config.ts:534`). Seul `disable` écrit `false`
  (`index.ts:10994`). Un start de qualification ou d'enrôlement devient
  donc une posture durable, sans que l'opérateur ait demandé « gateway par
  défaut ».
- G2. `stop` arrête le process (`gateway-host/daemon.ts:278`) sans toucher
  `enabled`. Le prochain `inject("auto")` redémarre le daemon.
- G3. `h2a restore` sans `--no-gw` appelle
  `prepareLlmMeshForRestore({mode: forceGateway ?? "auto"})`
  (`index.ts:9997-10000`). Cette fonction transmet `auto` brut à
  `inject` (`index.ts:2417-2430`, `2377-2384`) : si `enabled=true`, elle
  démarre la gateway et pollue `process.env` du process restore, même si
  aucun onglet n'est en gateway. Les onglets directs se purgent ensuite
  via leur propre `h2a run`, mais le daemon est « mis en place » et tout
  shell de repli hérite l'env.
- G4. La délégation ne lit ni flag ni pin : `profil Claude && enabled &&
  sessionId` suffit à acquérir un bearer (`index.ts:1560-1563`), puis
  `replaceAnthropicGatewayEnvironment` l'impose à l'enfant
  (`index.ts:1571-1574`, sémantique `gateway-host/daemon.ts:23-44`).
  `acquire` ne démarre pas le daemon (`daemon.ts:219-264`) : gateway
  seulement si le daemon tourne déjà. Défaut déjà mesuré le 2026-07-30
  (track `01KYR2J6M1ANHFC7YG184R7HYC`), toujours présent.

### 1.2 Pins par instance : resume, run, restart, relaunch, restore

Intention d'origine : le pin ne naît que d'un `--gw/--no-gw` explicite,
absent = suit le défaut (`registry.ts:250-255`). État actuel : les pins
sont lus partout via `?? "auto"`, et plusieurs chemins réécrivent la
posture résolue, ce qui fossilise un choix passé en défaut futur.

| ID | Chemin | Ancrage lecture | Ancrage écriture |
| --- | --- | --- | --- |
| P1 | `h2a resume` | `index.ts:5749-5751` | `index.ts:6049` toujours |
| P2 | `h2a run --resume` | `index.ts:6517-6519` | `index.ts:6968` toujours |
| P3 | `h2a restart` natif | `native-restart.ts:144-151` | `index.ts:8946` si non-auto |
| P4 | `h2a relaunch` natif | `index.ts:9095` | `index.ts:9131` toujours |
| P5 | `h2a relaunch` tmux | `index.ts:9432-9435` | `index.ts:9462` si pin |
| P6 | `h2a restore` onglets | `launch-layout.ts:77-79` | Réémet `--gw/--no-gw` |
| P7 | Registre (conservation) | `registry.ts:1292-1293` | `input ?? prev` |

Lecture commune : sans flag CLI, `demandé = pin ?? "auto"`, puis
`gatewayModeForProfile` tranche. Sans pin : `direct` (correct). Avec pin
`gateway` : `gateway`, sans aucun opt-in contemporain. C'est le chemin le
plus probable du bug du 19/10 : `restart --all` sans `--gw` rejoue les
pins (`native-restart.ts:150` : `session.gatewayMode ?? "auto"` ;
préparation `index.ts:2324-2329`).

Écritures incohérentes entre chemins :

| Politique | Chemins | Conséquence |
| --- | --- | --- |
| Toujours la résolue | P1, P2, P4 | `auto` crée un pin |
| Seulement si explicite/pin | P3, P5 | Absence préservée |
| Préserve l'ancien si absent | P7 | Aucun pin ne vieillit |

Le commentaire de P2 affirme l'inverse du code : « Pin ONLY when explicit »
(`index.ts:6954-6956`) puis `gatewayMode: launchGatewayMode` inconditionnel
(`index.ts:6968`). Un seul `--gw` historique (test, UAT, session d'avant
septembre relancée) suffit donc à rendre la gateway permanente pour cette
conversation/instance, indiscernable d'un défaut au restart suivant.

Restore (P6) : `posture = forceGateway ?? tab.gatewayMode`
(`launch-layout.ts:77`), rendu en flag shell ligne 79, onglet sans pin =
aucun flag = défaut du `h2a run` enfant (direct). `restore --gw/--no-gw`
(`index.ts:9958-9967`, `restore.ts:993`) ne remplace jamais une session
vivante : elle est seulement rattachée (`launch-layout.ts:103-109`).
Transfert du pin : `restore.ts:676` puis `restore.ts:918`.

### 1.3 Lancements neufs : CLI, MCP, boucle

| ID | Chemin | Ancrage | Sans opt-in |
| --- | --- | --- | --- |
| L1 | `run/resume` interactif | `index.ts:2145-2164` | Direct (résolu) |
| L2 | MCP `h2a_run auto` | `agent-launch.ts:194,317` | Direct (contrat) |
| L3 | Boucle `gateway auto/omis` | `adapters.ts:528,559` | Gateway acceptée |
| L4 | `run` structuré | `index.ts:6566-6580` | Direct (résolu avant) |

- L1/L4 sont sains : le mode injecté est déjà résolu
  (`effectiveGatewayMode`, `launchGatewayMode`), jamais `auto` brut.
  Reste l'effet pin P1/P2 en reprise.
- L2 est sain mais indirect : `auto` (défaut schéma,
  `agent-launch.ts:194`, `tools.ts:768-771`) n'émet aucun flag
  (`agent-launch.ts:317-321`) et le contrat exige `direct`
  (`agent-launch.ts:356-361`). Un pin `gateway` sur reprise ferait échouer
  le contrat plutôt que passer en gateway : fail-closed, à conserver.
- L3 est le trou neuf : la boucle émet `--gw` seulement pour `required`
  (`adapters.ts:528`) mais valide `gateway OU direct` pour `auto`/omis
  (`adapters.ts:559-563`). Toute posture gateway héritée (pin, env) est
  donc acceptée silencieusement, là où le MCP la refuse.

### 1.4 Héritage d'environnement (hôte, tmux, PTY natif, upgrade)

| ID | Vecteur | Ancrage | Garde actuelle |
| --- | --- | --- | --- |
| E1 | `process.env` du lanceur | `index.ts:2224-2226` | Purge si direct |
| E2 | Env serveur tmux | `tmux.ts:325-342` | `env -u` si lanceur propre |
| E3 | Snapshot natif complet | `native-host.ts:397-400` | Dépend de E1 |
| E4 | `op create` sans env-file | `op.ts:834-840` | Aucune purge |
| E5 | Hôte natif (process) | `supervisor.ts:232` | Env par session explicite |
| E6 | Bearers persistés | `sessions.ts:51-88` | Ancien token valide |

- E2. `tmuxEnvironmentArgs` copie `ANTHROPIC_*` du lanceur dans la session
  (`tmux.ts:327-330`) ; le préfixe `env -u …` ne part que si le lanceur est
  déjà propre (`tmux.ts:339-341`). Un lanceur lui-même sous gateway
  (session Claude parente, restore G3) propage donc l'env à tout spawn qui
  ne purge pas d'abord.
- E3. `startNativeSession` photographie tout `process.env` dans un
  env-file éphémère (`native-host.ts:397-414`) ; le serveur exige cet env
  explicite par session (`server.ts:175-188`). Correct si et seulement si
  l'appelant a injecté/purgé avant (c'est le cas de run/resume/restart).
  E4 reste ouvert pour tout appel direct sans env-file.
- E5. Le superviseur lance l'hôte avec `env: process.env`
  (`supervisor.ts:232`) : l'hôte hérite l'env de son démarrage, mais les
  PTY reçoivent l'env par session (E3). Un upgrade d'hôte ne réinjecte
  donc pas la gateway à lui seul ; le risque est la recréation des
  sessions par restart/restore (P3/P6) après l'upgrade.
- E6. Depuis le 2026-10-10, les bearers survivent au restart/upgrade de la
  gateway (`sessions.ts:14-18`, hydratation lignes 66-88). Une session
  relancée avec une env gateway périmée continue de fonctionner au lieu
  d'échouer en 401 : le signal qui aurait révélé la posture disparaît.
- Upgrade `h2a upgrade` : swap stagé sans relance de sessions
  (`cli.ts:1874-1917`). `soft-refresh` (Pods) respawne avec l'env du Pod,
  fixée au provisionnement (§1.5), sans purge (`soft-refresh.ts:109-123`).

### 1.5 Distant k8s : défaut de déploiement, pas de lib

| Surface | Ancrage | Défaut |
| --- | --- | --- |
| Spec Pod | `spec.ts:172-182,728` | Direct si URL/token absents |
| Control-plane | `sessions.ts:417-428` | Gateway pour toute session |
| Source URL | `control-plane/index.ts:127,310` | Env `LLM_GATEWAY_URL` |
| `deploy/scw` | `configmap.example.yaml` | Aucune URL, broker `false` |

La lib k8s est directe par défaut et testée comme telle
(`spec.test.ts:386`). Mais dès que le déploiement pose `LLM_GATEWAY_URL`,
le control-plane mint un token pour **chaque** création de session, sans
champ d'opt-out par session (`sessions.ts:417`), et le Pod naît avec
`ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` (`spec.ts:728-736`,
`provisioner.ts:111`). C'est un défaut-on de flotte par variable
d'environnement de déploiement. `deploy/scw` livré ne la pose pas : le
risque vise tout déploiement local/privé qui l'a posée une fois.

## 2. Historique : demandes owner et correctifs qui n'ont pas tenu

Sources : `.track/events.jsonl` sur `origin/main` (1512 événements) et
`git log --all`. L'owner compte « au moins 4 fois ». Traçables ici : deux
demandes explicites « défaut off/direct » (D1, D2), une instruction
opérationnelle répétée (D0), puis deux décisions adjacentes qui ont rouvert
ou masqué le défaut (D3, D5) et une restatement documentaire (D4). L'écart
avec le compte owner est un `source-gap` assumé : demandes de session non
journalisées possibles, journal restauré après purge le 2026-09-12
(`cc8d2f81a`, 1423 événements récupérés), item D1 cité en commit mais
absent du journal `origin/main`. Ne pas inventer les demandes manquantes.

| Quand | Demande owner | Correctif | Tenue |
| --- | --- | --- | --- |
| D0 2026-07-29 | Lanes en gateway off | Aucun (mesures) | Non tenu (G4) |
| D1 2026-07-30 | Défaut configurable OFF | `b1a37adce` branche | Jamais mergé |
| D2 2026-09-14 | Direct sauf `--gw` | `df92c0f7c` PR #261 | Partiel |
| D3 2026-09-19 | `--bare` opt-in + pins | `0cc1e59d2` PR #275 | Régression pins |
| D4 2026-10-03 | Défauts documentés | `a49bfa419` docs | Carve-out codifié |
| D5 2026-10-10 | Restart sans 401 | `01541db24` bearers | Masque E6 |
| D6 2026-10-19 | Primo + local sans gw | Présent bug | Ouvert |

### D0 — 2026-07-29/30 : l'option honorée sur un chemin, ignorée sur l'autre

- `01KYR1N47P97GC5BPF5P4X35NW` : `required` rétrogradé en direct hors
  Claude, garde inopérante.
- `01KYR2J6M1ANHFC7YG184R7HYC` : `startJob` ignore `gatewayMode` persisté ;
  « gateway off » ne protège pas la délégation alors qu'il protège
  `run`/`h2a_run`. C'est G4, inchangé.
- `01KYR59E09FWGPHZ024WYKBWQY` : motif « option acceptée, parfois
  persistée, puis silencieusement non honorée ». Aucun correctif de fond
  n'est rattaché à ces items sur `origin/main`.

### D1 — 2026-07-30 : défaut configurable, jamais livré

Commit `b1a37adce` (branche `origin/fix/h2a-gateway-default-config`,
jumeau `5dadf86b7`) : « Owner request 2026-07-30 », item
`01KYSTGGF57MET8WETDDV6G1W4` (WP5, absent du journal `origin/main`).
Ajoutait `config.json:defaultGateway`, `getDefaultGatewayMode()` retombant
sur `direct`, priorité flag > config > défaut câblé, et MCP sans défaut
propre (aucun flag émis). Vérifié : non ancêtre de `origin/main`,
`defaultGateway` absent de `origin/main`. Le correctif n'a pas « mal
tenu » : il n'est jamais arrivé. `main` a gardé `auto` résolu par
`enabled` jusqu'en septembre.

### D2 — 2026-09-14 : direct par défaut, périmètre lancement neuf

Commit `df92c0f7c`, mergé par `5b406f378` (PR #261), track
`01M2GY3KYGGWKQXVPJKVX30691` + décision `01M2GY6BNED8RPXY23GRBA74SN`.
Avant : `gatewayModeForProfile` renvoyait `requested` tel quel pour Claude
(`auto` survivait jusqu'à `inject`). Après : `auto → direct`, purge de
l'héritage, contrat MCP `auto = direct`, test comportemental resume sous
env parente gateway (`conv-guard-wiring.test.ts`). Le message de commit
préserve explicitement pins et réémission restore (« posture épinglée
préservée ») et déclare `deploy/scw` inchangé. Non traités, toujours
ouverts : G3 (restore `auto` brut), G4 (délégation), L3 (boucle),
migration des pins et de `enabled`. Le test ajouté couvre `resume` sans
pin ; aucun test ne couvre restore/délégation avec `enabled=true`.

### D3 — 2026-09-19 : reproduction des pins, régression de D2

Commit `0cc1e59d2` (PR #275, v0.97.2) : `--bare` devient opt-in (condition
de retour owner `index.ts:2175-2180`), et resume/run doivent reproduire
`bare` + `gatewayMode` épinglés. Changements décisifs : lecture du pin en
`auto` (futurs P1/P2) et écriture de la posture résolue à chaque reprise
(avant : pin seulement si flag explicite). Effet non voulu : D2 ne
s'applique plus qu'aux conversations sans histoire. Toute conversation
avec pin `gateway` — y compris né d'un `--gw` ponctuel — reste gateway à
chaque restart, et chaque restart réécrit le pin. C'est la régression
structurelle centrale.

Faits voisins, même fenêtre : `c61205b48` (2026-08-22) crée `restart`
natif avec `--gw on|off` explicite mais défaut = pin (`native-restart.ts`) ;
`1743549f7` (2026-08-07) rend la préparation restore fail-closed pour
`gateway` requis sans toucher au démarrage `auto+enabled`.

### D4 — 2026-10-03 : la doc fige l'exception

Commit `a49bfa419` : « New CLI/MCP launches are direct by default »
(`docs/llm-mesh-account-migration.md:77`, skill `h2a-run/SKILL.md:56`),
immédiatement suivi de « Existing restore/delegate behavior and explicitly
pinned resume/restart choices are preserved ». La phrase documente le
défaut et son contournement dans le même paragraphe. Aucun test nouveau
sur restore/délégation (seul `gateway-host-docs.test.js`).

### D5 — 2026-10-10 : continuité des bearers

Commit `01541db24` (décision owner 2026-10-10, `sessions.ts:17-18`) :
persistance des bearers dans `llm-mesh-gateway-sessions.json`. Juste pour
les sessions explicitement gateway, mais supprime le 401 qui signalait
une relance gateway involontaire après upgrade. Combiné à P3/P6, l'upgrade
devient silencieusement gateway-compatible.

Lecture d'ensemble : chaque correctif a fermé le chemin nommé dans la
demande du jour et préservé les autres au nom de la compatibilité
(pins, restore, délégation, bearers). Aucun n'a migré l'état déjà écrit.
Le restart — précisément le chemin préservé — est celui du bug D6.

## 3. État persisté qui porte encore la gateway, et migration requise

Chemins déduits du code uniquement (aucun fichier owner réel lu).
`<configDir>` = répertoire de `config.json` (`config.ts:334`) ;
`~/.sentropic` = `sentropicDir()` (`config-file.ts:19-20`).

| # | Fichier / état | Champ porteur | Ancrage |
| --- | --- | --- | --- |
| S1 | `<configDir>/config.json` | `llmMesh.enabled` | `config.ts:188-189` |
| S2 | `<configDir>/registry.json` | `entries[].gatewayMode` | `registry.ts:333-334` |
| S3 | `<configDir>/layout-last.json` | `tabs[].cmd` (`--gw`) | `restore.ts:1185,1202` |
| S4 | `~/.sentropic/llm-mesh.json` | `port`, `routing` | `config-file.ts:23-24` |
| S5 | `~/.sentropic/llm-mesh.pid` | Daemon vivant | `daemon.ts:46-48` |
| S6 | `~/.sentropic/llm-mesh-token.json` | `baseUrl`, `pid` | `daemon.ts:50-52` |
| S7 | `~/.sentropic/llm-mesh-gateway-sessions.json` | Bearers valides | `sessions.ts:51-52` |
| S8 | Home legacy `remote-cli/` | Copie verbatim S1-S3 | `config.ts:353-401` |
| S9 | Serveur tmux + options | Env + `@remote_launch_*` | `tmux.ts:325`, `launch-context.ts:14` |
| S10 | Pod distant | Env au provisionnement | `spec.ts:728-736` |
| S11 | Déploiement control-plane | `LLM_GATEWAY_URL` | `index.ts:127,310` (apps) |

Comment l'ancien code a écrit S1/S2 :

| Époque | S1 `enabled` | S2 pin |
| --- | --- | --- |
| Avant 2026-09-14 | `start` ⇒ `true` durable | Explicite seulement |
| Depuis 2026-09-19 | Inchangé | Résolue réécrite (P1/P2/P4) |
| Toujours | `stop` sans effet | `?? prev` sans expiration |

Problème de provenance (bloquant pour toute migration aveugle) : le schéma
actuel ne distingue plus un pin explicite (`--gw` voulu) d'un pin fossilisé
(résolue réécrite par P1/P2/P4), ni un `enabled=true` voulu (`enable`)
d'un effet de bord (`start`). Les deux s'écrivent avec la même valeur,
sans source ni date. Supprimer tous les pins `gateway` effacerait de vrais
opt-ins ; tous les garder conserve le bug. Même dilemme pour S1.

Ce qu'une migration doit réécrire, sans jamais effacer un opt-in prouvé :

| État | Réécriture cible | Garde opt-in |
| --- | --- | --- |
| S2 pin avec provenance `flag` | Conserver tel quel | Opt-in prouvé |
| S2 pin sans provenance (legacy) | Marquer `unknown`, lister | Aucun effacement sans principe §5 |
| S2 pin `direct` fossilisé | Retirer (= défaut) | Aucun opt-in perdu |
| S1 `enabled` | Dissocier daemon/posture (§4) | `enable` explicite tracé |
| S3 `layout-last` | Régénérer au restore suivant | Diagnostic, jamais réexécuté seul |
| S7 bearers | Conserver (continuité D5) | Ne décide pas la posture |
| S10/S11 Pods existants | Ne pas réécrire en place | Posture au prochain provisionnement |

Forme recommandée : migration versionnée, idempotente, en deux temps —
(1) inventaire en lecture seule (compte pins `gateway/direct/absent`,
`enabled`, URL déploiement) exposé par `doctor`/rapport ; (2) réécriture
seulement des cas prouvés implicites (pins `direct` redondants, futurs pins
sans flag), les pins legacy `gateway` restant intacts tant que le principe
owner du §5 n'a pas tranché leur sort. Toute nouvelle écriture doit porter
sa provenance dès le premier jour (`source: flag|mcp-required|restore-force`,
date), faute de quoi la prochaine migration butera sur le même mur.
S4 (`routing`) ne décide pas direct/gateway : ne pas y toucher. S8 suit S1-S3
par le symlink de compat, aucune double écriture.

## 4. Design cible

### 4.1 Une seule source de vérité pour le défaut

| Règle | Effet |
| --- | --- |
| Un résolveur, un défaut `direct` | `auto` disparaît des signatures internes |
| Opt-in explicite seulement | `--gw`, `required`, `--gw on`, profil |
| `enabled` = daemon, pas posture | Plus aucun lancement décidé par S1 |
| Pin seulement si explicite | `auto` n'écrit rien, suit le défaut |
| Restore : pin explicite gardé | Implicite/inconnu ⇒ direct (§5) |
| Env toujours résolue | Aucun snapshot brut sans purge |

Concret :

- Résolveur unique (successeur de `gatewayModeForProfile`,
  `protocol-local.ts:37`) : entrée = choix explicite éventuel
  (flag CLI, `required` MCP/boucle, `on/off` restart, force restore,
  champ profil optionnel) + pin explicite prouvé ; sortie =
  `gateway|direct`. Absence de choix ⇒ `direct`, en un seul endroit.
  `profiles.ts` n'a aujourd'hui aucun champ gateway : le « profile flag »
  est un ajout (champ optionnel lu par le résolveur, absent = direct),
  jamais un défaut de profil Claude.
- Supprimer le transit `auto` brut : `injectLlmMeshGatewayEnv`,
  `prepareStructuredGateway` (`index.ts:2377`) et
  `prepareLlmMeshForRestore` (`index.ts:2404`) n'acceptent qu'un mode
  résolu. Restore ne prépare la gateway que si au moins un onglet relancé
  est résolu `gateway` (ou force `--gw`) ; sinon aucun démarrage, aucune
  pollution `process.env`.
- Délégation et boucle passent par le même résolveur : suppression du
  test `enabled` de `startJob` (`index.ts:1560`), validation boucle
  alignée sur le MCP (`auto`/omis ⇒ `direct` exigé,
  `adapters.ts:559`).
- `llm-mesh start` démarre le daemon sans décider des lancements futurs ;
  `enable/disable` (s'ils subsistent) ne gouvernent que la disponibilité
  du daemon, avec provenance écrite. `stop` redevient symétrique et
  lisible dans `status` (daemon, posture par défaut, source).
- Pins : écriture uniquement sur choix explicite, avec provenance ;
  lecture `pin explicite > force du jour > défaut direct`. Rétablir
  l'intention `registry.ts:250-255` et corriger P1/P2/P4 + commentaire
  `index.ts:6954`. Un restart sans `--gw` garde un pin explicite, rend
  direct sinon, et affiche la posture effective + sa source (déjà partiel :
  `index.ts:2355`, `launch-context.ts:67`).
- Env : tout spawn reçoit l'env résolue (purge ou injection), y compris
  env-file natif (`native-host.ts:397`) et repli `op create`
  (`op.ts:834`) ; le snapshot brut `process.env` cesse d'être un défaut.
- k8s : `LLM_GATEWAY_URL` nomme une capacité, la demande de session porte
  l'opt-in ; sans opt-in, aucun mint, Pod direct (`sessions.ts:417`).

### 4.2 Tests de non-régression (chacun doit rougir si le défaut rebascule)

| # | Test | Couvre |
| --- | --- | --- |
| T1 | Primo-install HOME vide : config, run, restore directs | Lib, point 1 du bug |
| T2 | `restore` non-épinglé, `enabled=true` : aucun start | G3, déploiement local |
| T3 | Délégation Claude, `enabled=true` : directe sans flag | G4 / D0 |
| T4 | Boucle `auto`/omis : `direct` exigé, gateway refusée | L3 |
| T5 | `restart --all` : pin explicite gardé, absent direct | P3 |
| T6 | Reprise `auto` : aucun pin créé au registre | P1/P2/P4, D3 |
| T7 | Parent sous gateway : enfant direct purgé (tmux+natif) | E1-E4, D2 |
| T8 | k8s sans opt-in malgré URL : aucun mint, Pod direct | §1.5 |
| T9 | Migration dry-run : opt-in prouvé intact, legacy listé | §3 |
| T10 | `llm-mesh start` seul : lancement suivant direct | G1/G2 |

T1 et T2 sont le couple demandé : T1 prouve la conf lib primo-install,
T2 prouve le déploiement local déjà « contaminé » (`enabled=true`, daemon
arrêté) — le scénario exact du 19/10. Tests existants à conserver :
`config.test.ts:148` (défaut `enabled=false`), resume direct sous env
parente (D2), `spec.test.ts:386` (k8s conditionnel), pins restore
(`restore.test.ts:239,487`). Aucun ne couvre T2/T3/T6 aujourd'hui.

## 5. Questions ouvertes pour l'owner (principes)

Aucune question binaire : chaque réponse fixe un principe durable, puis le
code suit.

1. **Provenance des pins legacy.** Un pin `gateway` sans source tracée
   vaut-il opt-in durable, indice à reconfirmer, ou simple historique ?
   Qui porte la reconfirmation (inventaire nominatif, échéance, silence) ?
2. **Durée de vie d'un opt-in.** Un `--gw` engage-t-il la conversation,
   l'instance, ou seulement le lancement ? À quel événement expire-t-il
   (fin de session, reboot, upgrade, jamais) ?
3. **Sens de `llm-mesh start/enable`.** Démarrer le daemon autorise-t-il
   autre chose que sa disponibilité ? Quelle surface doit exprimer une
   préférence de posture, si une telle préférence doit exister ?
4. **Restore face aux sessions vivantes.** La posture d'une session
   vivante rattachée doit-elle être seulement affichée, ou restore
   peut-il proposer (jamais imposer) sa convergence vers le défaut ?
5. **Flotte distante.** L'opt-in gateway des Pods relève-t-il de la
   demande de session, du profil, ou de la politique de déploiement —
   et quelle trace rend ce choix auditable par session ?
6. **Visibilité de la posture effective.** Quelle est la phrase canonique
   qu'un opérateur doit pouvoir lire partout (`ls`, `status`, restore) :
   posture, source du choix, ancienneté du pin, état du daemon ?
7. **Continuité contre signal.** Les bearers persistés (D5) doivent-ils
   survivre à tout restart, ou un changement de posture/défaut doit-il
   invalider les anciennes postures de façon visible ?







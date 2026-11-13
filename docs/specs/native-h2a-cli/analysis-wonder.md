# Analyse indépendante — CLI native h2a (agents)

Date : 2026-10-18. Type : ANALYSIS, aucun code, aucun commit.
Analyste : Muse Code / muse-wonder-full-1.0, en parallèle sans visibilité
sur l'autre analyse.

## Conclusion principale

La CLI native n'existe pas comme produit utilisable au 2026-10-18.
Il existe un design papier abondant et convergent sur la cible,
un front `h2a run <profile>` qui lance des CLI tierces en PTY,
une gateway llm-mesh fonctionnelle en surface, et côté sentropic
un moteur de chat réel mais qui n'est pas un moteur d'agent de code.

Le bloqueur n'est pas technique au sens « boucle impossible ».
Le bloqueur mesuré est triple :

1. La co-validation sentropic du moteur n'a jamais eu lieu.
   Les questions Q1–Q5 et A1–A4 du 2026-07-18 sont restées sans
   réponse tracée dans le dépôt h2a.
2. Le dossier de décision demandé le 2026-09-28 existe en local
   sous forme de fichiers non suivis, non commités, donc non
   livrés par le chemin standard.
3. Le périmètre maximal de septembre (123 fonctionnalités,
   9 waves, k8s, fédération) a déplacé le premier incrément
   utilisable hors de portée immédiate.

Le chemin le plus court vers un usage owner réel n'est ni le
programme maximal, ni un fork d'une CLI ouverte.
C'est un incrément explicite et réversible :
`h2a run native -p "<prompt>"` en headless d'abord,
boucle LLM↔outils propriété sentropic consommée comme librairie
par h2a en local, egress uniquement par la gateway/llm-mesh,
outils de code locaux sous gate de permission, sans basculer
`h2a` nu ni `h2a run` sans profil dans le même lot.

## Méthode et limites

| Élément | Statut |
|---|---|
| h2a lu via `git show origin/main` | `d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188` |
| sentropic lu via `git show origin/main` | `81deb7bd78d99bca8d51f67c4f1d4424fb772d75` |
| engram (ex-graphify) `origin/main` | `01697527`, `package.json` version `0.20.0` |
| Track lu en lecture seule | `/home/antoinefa/src/h2a/.track/events.jsonl` |
| Hôte réel, binaire installé, processus tiers | non touchés, non invoqués |
| Tests exécutés | aucun ; analyse seule, par mandat |
| Docs locales non suivies | signalées `??` ligne par ligne ci-dessous |

Limites déclarées :

- `source-gap` : composition exacte des sièges « 2 Claude,
  1 Codex, 2 Muse, 1 agy », phrase « n'utilise plus claude
  code », phrase du 18/10 « et la cli h2a ? c pour quand ?? »,
  « engram guardian of dev ontologies », et « stream S7 »
  au sens serveur unique n'ont pas été retrouvés verbatim
  dans `events.jsonl` avec les motifs cherchés le 2026-10-18.
  Ils sont traités comme transmis par le conducteur, pas
  comme verbatim Track vérifié. Voir §A.1.
- `unverified` : aucun runtime tiers (OpenCode, Codex CLI,
  Claw) n'a été exécuté pour cette analyse. Les licences
  citées en §C viennent de sources web consultées le
  2026-10-18 et du benchmark local du 2026-09-27.
- Les fichiers de septembre sous `docs/specs/2026-09-27-*`
  et `2026-09-28-*` sont présents sur disque dans le checkout
  h2a mais absents de `origin/main` (`git status` = `??`).
  Toute affirmation qui en dépend est marquée « local non
  suivi », jamais « livré ».

---

## A. Ce que l'owner veut dire par « notre propre cli »

### A.1 Verbatim retrouvé dans Track

Recherche : `node` sur `.track/events.jsonl`, motifs
`propre cli`, `cli native`, `sentropic local`, `agentic.cli`,
plus lecture des items D-008, D-028, D-029, D-063
(reconstitutions du 2026-10-16/17, lignes 1640, 1676,
1678, 1736 du fichier au moment de la lecture).

| Date source | Verbatim | Référence Track |
|---|---|---|
| 2026-07-06 | « et puis, quand est ce qu'on lance notre propre cli ? deja concu avec l'architecte (x9 mais devait deja exister) » | item `01KWVNYNHVJGA8CCW566PG4WMH`, ligne 252 |
| 2026-07-13, cité 2026-07-28 | « notre propre cli devrait être articulée via sentropic avec le lane agents... Ça me semble valoir un workpackage en propre, et j'aimerais le débuter. » | item `01KYNAXT7BX7PMFPMZKJ30WPB4`, ligne 594 |
| 2026-07-30 | « ok faut bien prioriser l'avancement sur memory, et la cli. ou en est on pour la cli native (agents) stp ? » | D-008, ligne 1640 |
| 2026-08-07 | « et la cli native ???? personne ne bosse ou ne drumbleat (/loop des lanes + la tienne + objective loop) je ne comprends pas » | D-008, ligne 1640 |
| 2026-08-09 | « pour moi h2a etait un sentropic local. il faut penser dans cette direction on ira bcp plus vite » ; « en local, je prefererais que h2a repose sur du sqlite plutot que du postgres » | D-028, ligne 1676 |
| 2026-08-14 | « j'avais demandé que le mcp, que le focus et que les sessions soient portées par un putani de serveur h2a » (forme tronquée à la reconstitution) | D-029, ligne 1678 |
| 2026-09-28 | « pour la cli agentique: j'attends un décision dossier - revue opus 5.5 max + muse 1.3 xhighi - format h2a focus design system, avec des schema » ; « je veux un decision dossier. claude 5.5 xhigh + relecture muse 1.3 max » | D-063, ligne 1736 |
| 2026-10-14 | « il faudra introduire gemini argon et muse wonder (les 2 version) avec les mapping pour la gw claude stp avec sentropic » | item catalogue, ligne 1544 |
| 2026-10-16 | « les sieges servent - aux tests gw - aux tests cli (a2a inter cli) il faut donc bien des sieges enrôlables CLI ET LLM-MESH Claude, codex, muse, vibe, agy/cloud-code » | item sièges, ligne 1617 |
| 2026-10-17, relayé | engram expose sa mémoire par MCP au standard sentropic ; h2a peut en hériter par choix via cluster-mesh ; engram 0.20.0 dès que prêt, outils désactivés par défaut | item MCP-L8, ligne 1777 |

Corrections mesurées, à ne pas perdre :

- La prémisse « déjà conçu avec l'architecte » est fausse au
  sens co-validation. Amendement du 2026-07-29, ligne 756 :
  le design existe en STUDY (2026-07-13, 2026-07-17,
  2026-07-18), les questions A1–A4 ont été déposées à
  `claude:architect:ed8bbd8bf573`, cible enregistrée mais
  non live, aucune réponse tracée dans le dépôt.
  Formule consignée : conçu POUR le seam architecte,
  pas AVEC l'architecte.
- Le WP « Native CLI & agent runtime » créé le 2026-07-28
  (`01KYNAXT…`) a été annulé le 2026-07-29
  (`realization.transition` → `cancelled`, ligne 656).
  Le conteneur vivant porteur du code `WP13` est
  `01KXDPBR505FKNV9XCZ45P638H`, créé le 2026-07-13,
  titre : « Native h2a agent runtime via sentropic —
  main loop managed by sentropic ».
- D-008 et D-063 ont été reparentés sous ce WP13 le
  2026-10-18. Leur statut de réalisation tracé reste
  « inconnu » dans les corps reconstitués.

Non retrouvé verbatim dans `events.jsonl` (transmis
conducteur, `source-gap` dans ce fichier) :
« et la cli h2a ? c pour quand ?? » (18/10),
« n'utilise plus claude code »,
la composition chiffrée des sièges,
« engram guardian of dev ontologies and memory »,
« stream S7 » comme nom du serveur unique.
Le seul `S7` retrouvé dans les specs locales désigne
une source graphify memory, pas le serveur :
`docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md:70`.

### A.2 Résultat attendu — inférence séparée du verbatim

Ce qui suit est une inférence à partir du verbatim §A.1,
des décisions consignées le 2026-07-13 et le 2026-07-18,
et des directions transmises par le conducteur.
Chaque ligne porte son niveau.

| Attendu | Niveau | Base |
|---|---|---|
| Un agent interactif complet lancé par `h2a`, équivalent d'usage à claude/codex/hermes/agy, pas un lanceur de plus | décision consignée | STUDY 2026-07-18 §0 : « Build the equivalent of Claude Code / Codex / Hermes / agy: a native h2a agent » |
| `h2a` nu et `h2a run` exact démarrent cet agent ; `h2a run native` est la forme explicite | décision owner 2026-07-18 | STUDY 2026-07-18, section « Owner decision » |
| La boucle LLM↔outils nous appartient et passe par la gateway ; ce n'est pas un habillage d'une CLI opaque | décision owner 2026-07-13 | SPEC_STUDY 2026-07-13, clarification : D3 tranché vers « own the loop », option B ; option C exclue de WP13 |
| Le moteur de session est propriété sentropic ; h2a fronte, coordonne, gouverne | décision consignée, non co-validée | STUDY 2026-07-18 §0 contrainte 1 ; Q1–Q5/A1–A4 sans réponse tracée |
| Tout modèle du mesh est utilisable depuis la CLI native, catalogue comme autorité, pas de liste locale figée | inférence forte | STUDY 2026-07-18 §6 ; catalogue #373 livré depuis, voir §B |
| Sessions plaçables local / k8s / in-sentropic, reprise par ré-instanciation depuis un checkpoint, jamais migration PTY | décision consignée | SPEC_STUDY 2026-07-13 D2 relu par la clarification |
| Mémoire, Track, Focus, MCP h2a disponibles dans la session native comme dans les sessions actuelles | inférence | D-008 couple « memory, et la cli » ; protocole h2a comme différenciateur, STUDY §7 |
| Un seul serveur h2a local portant sessions, MCP mutualisé, gateway, Focus, bus en mémoire, auto-upgrade sans tuer les sessions | demande owner 2026-08-14 | item `01M015678ZGSQFHM7S8RF8EF27` ; D-029 ; étude déclarée `done` en Track le 2026-08-15, sans doc correspondant retrouvé sur `origin/main` |
| h2a pensé comme un sentropic local, persistance locale SQLite plutôt que Postgres | verbatim 2026-08-09 | D-028 |
| Sortir de la dépendance à Claude Code comme hôte par défaut du travail quotidien | transmis conducteur, `source-gap` Track | cohérent avec « notre propre cli », non prouvé comme interdiction des profils vendor |
| Sièges enrôlables CLI et llm-mesh pour tester gateway et inter-CLI | verbatim 2026-10-16 | ligne 1617 ; les sièges servent les tests, ils ne sont pas l'identité de la boucle native |

Lecture d'ensemble, en une phrase :
l'owner attend de pouvoir travailler dans un agent dont
h2a/sentropic possèdent la boucle, le routage de modèles,
la mémoire et la gouvernance, au lieu de subir les boucles,
les comptes, les limites et les changements de quatre à
six CLI tierces orchestrées en PTY.

### A.3 Ce qui n'est pas requis pour la première version

Séparation explicite, car le glissement vers le maximal
est la cause mesurée du retard :

| Non requis en v1 | Pourquoi |
|---|---|
| Basculer `h2a` nu et `h2a run` exact vers native | C'est un breaking majeur coordonné ; la forme explicite `h2a run native` suffit à valider l'usage et reste réversible |
| Supprimer les profils vendor `claude`, `codex`, `agy`, `gemini`, `mistral`, `muse`, `vibe`, `opencode`, `shell` | Le contrat 2026-07-18 les garde explicites indéfiniment ; native est le seul implicite, pas le seul runtime |
| Parité complète claude/codex/hermes (fork, rewind, subagents en session, hooks complets, ACP, budgets $ partout) | Ce sont les exigences R3, R9, R10, R14 de la STUDY §4 ; aucune n'est nécessaire pour prouver une boucle de code utile |
| Placement k8s et in-sentropic, fédération inter-serveurs | Les seams cluster-mesh correspondantes restent `CapabilityGatedError` selon la baseline locale de septembre ; le local d'abord était déjà la règle de la roadmap du 2026-09-07 |
| Un serveur unique en un seul PID avant la CLI | La décision « unité de service ou PID unique » du 2026-08-15 (`01M01MKK2BGWR0Y6D65C3A83Z6`) n'a pas à bloquer un headless local ; PTY host, MCP central et gateway-host existent déjà comme pièces séparées |
| Réécrire le moteur de chat sentropic entier | Le besoin v1 est une boucle de code sur des ports existants, pas la refonte de `chat-service.ts` |
| Remplacer Focus, Track ou engram | Ils sont des surfaces à consommer par MCP/outils, pas à reconstruire dans la CLI |
| Un nouveau modèle de sièges pour la boucle native | La boucle native consomme les comptes gateway via llm-mesh ; les sièges CLI restent un dispositif de test et d'enrôlement vendor |

Point de vigilance : « dépasser le moteur sentropic actuel »
est une exigence owner du 2026-07-18 pour la cible.
La lire comme précondition de la v1 reproduit le blocage.
La lecture compatible avec une livraison est :
v1 = sous-ensemble utile et mesuré de R1–R15,
cible = R1–R15 co-validés ensuite. Voir question E2.

---

## B. Ce qui existe aujourd'hui, et l'écart réel

### B.1 Capital papier

Tous les chemins sont dans le dépôt h2a sauf mention contraire.
« Sur `origin/main` » = vérifié par `git show origin/main:<path>`.

| Document | Sur origin/main | Apport | Limite |
|---|---|---|---|
| `docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md` (118 l.) | oui | WP13, trois boucles séparées, D3 tranché « own the loop » | STUDY, aucun code autorisé |
| `docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md` (399 l.) | oui | Architecture d'information de la surface CLI, verbes non-run | Remplacée pour les deux formes vides par la STUDY du 18 |
| `docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md` (794 l.) | oui | Contrat cible complet : dispatch ordonné §0, état de l'art §3, exigences moteur R1–R15 §4, seam §5, parité §7, gates §10 | Tout le cross-owner est « to co-validate with sentropic » ; Q1–Q5/A1–A4 sans réponse tracée (§9 du doc) |
| `docs/specs/2026-07-26-INDEX_cli-studies-capitalisation.md` | oui | Acte que les deux STUDY n'existaient qu'en fichiers non suivis, inaccessibles aux autres agents | Ne réconcilie rien, par construction |
| `docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md` rév. 3 du 2026-08-02 | oui | 35 clauses opposables DISP/ADMIT/ID/EXIT, fichiers et tests futurs nommés (`native-dispatch.ts`, `native-admission.test.ts`, `native-session-contract.ts`) | Le doc le dit lui-même : 33 clauses sur 35 sans mécanisme qui rejette, 0 clause au niveau `test`, 23 preuves `not-yet-written` ; EVOL papier, autorise zéro code |
| `docs/specs/2026-09-27-SPEC_STUDY_agentic-cli-maximal.r2.2.md`, `2026-09-27-BENCHMARK_agentic-cli.md`, `2026-09-27-BASELINE_agentic-cli.md`, `2026-09-27-HANDOFF_agentic-cli-h-cond.md` | **non, `??` local** | 123 fonctionnalités, 36 lignes E2E, 9 waves ; benchmark Claw/Muse/Codex sourcé ; baseline cluster-mesh 0.13 | Non commités, branche ancienne `docs/org-raci-wp7-hinfra` sale ; handoff dit « aucun mandat d'implémentation » |
| `docs/specs/2026-09-28-DOSSIER_agentic-cli-maximal.md` rév. r5 | **non, `??` local** | Le dossier de décision demandé le 28/09 : options A–D sur le premier lot EVOL, contrôles Opus, conditions d'entrée W0 (NR2-01, NR-12, P3) | Statut interne : vérification mécanique encore attendue avant lot 1 ; jamais versé au dépôt ni présenté par le chemin Focus standard à notre connaissance tracée |
| `docs/specs/2026-08-18-SPEC_integration-cluster-mesh-serveur-local*.md` v1 à v5.2 | **non, `??` local** | Serveur local mono-instance fail-closed sur cluster-mesh 0.1.0, modèle de menace, gates owner du 2026-08-15 | Périmé en versions (h2a consomme cluster-mesh 0.16.0 sur `origin/main`, sentropic publie 0.19.1) ; non commité |
| Étude serveur unifié du 2026-08-14/15 (item `01M015678…`) | `source-gap` | Demande et transitions Track `in-progress` → `done` en 1 seconde le 2026-08-15 | Aucun document correspondant retrouvé par `git grep` sur `origin/main:docs/` |

Fait structurant : le capital papier cible est complet
depuis le 2026-07-18 pour le contrat, et depuis le
2026-09-28 pour la décision de premier lot.
Ce qui manque depuis n'est pas une étude de plus.
C'est une réponse sentropic au seam, un commit du dossier,
et un lot de code borné.

### B.2 Front h2a aujourd'hui (code vérifié sur origin/main)

Versions : `@sentropic/h2a` 0.98.7 et
`@sentropic/h2a-runtime` 0.98.7, peer exact.
Runtime consomme `@sentropic/cluster-mesh` 0.16.0,
`@sentropic/llm-gateway` 0.20.0, `@sentropic/llm-mesh` 0.26.0
(`packages/h2a-runtime/package.json`).

| Pièce | Preuve | État pour native |
|---|---|---|
| Dispatch core → runtime paresseux | `packages/h2a/src/bin-routing.ts` : `shouldDispatchRuntime`, `H2A_RUNTIME_CLI_API_VERSION = 1`, fallback premier-mot, pas d'allowlist | Socle sain ; aucun classifier native, aucun `DispatchMode` dans `packages/*/src` (mesure EVOL §0.1, toujours vraie par construction tant que le lot n'existe pas) |
| `h2a` nu | `packages/h2a/src/cli.ts` `runCli` : aide, exit 0 (rappelé STUDY §0 et EVOL §1) | Inchangé ; la bascule cible n'a pas eu lieu |
| `h2a run <profile> [path]` | `packages/h2a-runtime/src/index.ts:6070` Commander ; options `--model`, `--effort low\|medium\|high\|xhigh`, `--headless`, `--json`, `--llm-gateway/--gw`, `--count`, `--prompt-stdin`, `-r/--resume` | Lanceur vendor complet ; `h2a run` exact échoue toujours sur l'argument requis ; aucun sélecteur `native` |
| Profils | `packages/h2a-runtime/src/profiles.ts` : `shell, codex, opencode, claude, agy, gemini, mistral, muse, vibe` + alias ; `protocol-local.ts` `CLI_PROFILES` | Muse et Vibe sont des profils vendor comme les autres ; rien ne distingue un runtime « à nous » |
| Transport de session | `packages/h2a-runtime/src/run.ts` : `RunOptions{profile,resume,cwd,env…}` → PTY + enveloppes `terminal.output` Hono/SSE/WS | Transport d'octets, pas une boucle ; confirmé STUDY §2 |
| Hôte PTY natif | `packages/h2a-runtime/src/native-host.ts` : jumeau de `tmux.ts`, démon long-vivant possédant les PTY, défaut actuel, `--tmux` en repli | Utile pour vendor et pour attacher une TUI future ; n'exécute aucun outil d'agent |
| MCP | `packages/h2a/src/runtime/mcp/tools.ts` dont `h2a_run` (l.744) ; `packages/h2a-runtime/src/central-mcp.ts` endpoint mutualisé | La session native hériterait des outils h2a par ce chemin ; `h2a_run` ne lance aujourd'hui que Claude/Codex/AGY/Muse/Vibe |
| Goldens de dispatch | `packages/h2a/test/dispatch-characterization-goldens.test.js` verrouille la forme actuelle dont `.command("run <profile> [path]")` | Base RED/GREEN prête pour caractériser avant de changer le dispatch |
| Boucle native h2a | `git grep` sur `origin/main` : les seuls `tool_use` sont dans `claude-code-cli-runner.ts` (parsing des frames Claude), `claude-seat-mesh-contract.ts` (types de siège), `gateway-host/native-tools.test.ts` | **Absente.** Aucun module n'itère modèle→outil→résultat pour notre compte |

Le défaut « échec indiscernable d'un succès » documenté
dans l'EVOL §2.1 reste le comportement source du chemin
ordinaire : sélecteur inconnu résolu en exécutable, session
créée et enrôlée, pane retombant en shell de login,
exit 0 possible. C'est un argument supplémentaire pour
commencer par le classifier, indépendamment de native.

### B.3 Gateway, catalogue, sièges (code vérifié)

| Pièce | Preuve | Portée réelle |
|---|---|---|
| Gateway embarquée | `packages/h2a-runtime/src/gateway-host/host.ts` : `createLlmMesh` + registre providers (OpenAI/Codex, Gemini/CloudCode, Mistral, Muse, Anthropic) importés via `@sentropic/cluster-mesh/llm-mesh`, namespace gateway via `@sentropic/cluster-mesh/compose/gateway`, ledger de session `gateway-host/ledger.ts` | Le chemin d'egress gouverné existe en local, consommé par les CLI vendor en `--gw` |
| Catalogue #373 | merge `46b82b427` « PR #373 feat/gw-h0-tuple-catalog » ; `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts` : `gemini-4-argon`, `gemini-3.8-flash`, `muse-spark-1.3(+contributor)`, `muse-wonder-1.0`, `muse-wonder-full-1.0`, alias identité-seulement, table Claude→slots cloud/muse | Les modèles Muse/Sol/Astra/Argon/Wonder demandés sont adressables **via une CLI vendor sous gateway** ; il n'existe aucun consommateur « boucle native » de ce catalogue |
| Enrôlement comptes | `packages/h2a-runtime/src/llm-mesh-accounts.ts` : façade cluster-mesh, modes `oauth\|cli\|token`, providers `cloud-code, codex, muse, mistral-vibe, claude-code` | Prêt pour la boucle native : mêmes comptes, même ownerScope |
| Sièges CLI | `cli-seat-materialization.ts`, `cli-seat-codecs.ts`, `claude-seat-input.ts`, famille de tests `cli-seat-*.test.ts` : matérialisation synthétique/siège, circuit `seat` vs `product-oauth`, garde « seat launch requires gateway-off » | Dispositif de test inter-CLI et gateway, pas un moteur ; sa garde gateway-off confirme qu'un siège n'est pas interchangeable avec un compte gateway |
| Runner Claude structuré | `claude-code-cli-runner.ts` + `claude-code-cli-lifecycle.ts` : assemblage des `stream_event` Claude, sandbox orphelins | Preuve qu'on sait consommer un flux d'événements d'agent tiers ; réutilisable comme référence de forme, pas comme boucle |

Écart gateway pour native, précis :
le catalogue h2a est un miroir H0 fermé (6 ids).
La STUDY §6 exige l'inverse pour native : intent transmis
tel quel, catalogue du service comme autorité, aucun
filtrage local. La v1 devra choisir : fermer sur le miroir
testé, ou ouvrir au catalogue mesh. Voir E4.

### B.4 Moteur sentropic aujourd'hui (re-vérifié 2026-10-18)

Versions sur sentropic `origin/main` :
`@sentropic/chat-core` 0.1.7, `@sentropic/llm-mesh` 0.27.0,
`@sentropic/llm-gateway` 0.21.0, `@sentropic/cluster-mesh` 0.19.1.
h2a épingle un tuple plus ancien (0.16.0 / 0.20.0 / 0.26.0) :
tout lot native devra d'abord qualifier le tuple consommé,
conformément à la règle de la baseline septembre.

| Dimension | État re-vérifié | Preuve |
|---|---|---|
| Boucle LLM↔outils | Oui, dans l'api : `runAssistantGeneration` | `api/src/services/chat-service.ts:3178` ; migration en cours vers `ChatRuntime`, lots 13+ « move tool loop, finally runAssistantGeneration itself » dans `packages/chat-core/src/runtime.ts` |
| Ports chat-core | Checkpoint, Message, Session, Stream, Mesh, context-budget ; adaptateurs in-memory complets | `packages/chat-core/src/{checkpoint-port,session-port,stream-port,mesh-port,context-budget}.ts`, `src/in-memory/*` |
| Streaming rejouable | Oui, séquencé | `stream-port.ts`, `stream-sequencer-port.ts` ; inventaire STUDY §3.7 toujours cohérent |
| Checkpoint / fork | save/load/restore oui ; `tag` et `fork` lèvent « not implemented yet » côté Postgres | `api/src/services/chat/postgres-checkpoint-adapter.ts:209,213` re-vérifié 2026-10-18 |
| Outils de code (shell, fichier, git) | Absents de la boucle chat ; outils serveur de connaissance | `runtime-tool-dispatch.ts` : aucun outil shell/fichier ; STUDY §3.7 R6 « Critical » reste vrai |
| Subagents en session, hooks, gate interactive, budget $ appliqué | Absents ou partiels selon R7–R11 | STUDY §4 ; aucune pièce nouvelle trouvée dans `chat-core/src` qui ferme ces lignes |
| Egress LLM du chat | Mesh en process, pas la gateway HTTP | `api/src/services/llm-runtime/mesh-dispatch.ts:424` `createLlmMesh` ; R12 reste ouverte |
| Placement | Processus api unique, Postgres, file de jobs en DB | Incompatible tel quel avec « sentropic local SQLite » de D-028 ; compatible avec une consommation par ports + adaptateurs locaux |
| MCP côté sentropic | `packages/mcp-platform`, `packages/mcp-broker`, connecteurs | Plateforme et courtage existent ; la boucle chat ne consomme pas de serveurs MCP attachés par session (R15) |

Conclusion B.4 : l'inventaire du 2026-07-18 (§3.7) tient
encore sur les points qui comptent pour WP13.
Sentropic possède les ports et une boucle de conversation.
Il ne possède pas d'agent de code, et sa boucle de
production vit dans un service Postgres distant,
pas dans une librairie locale branchable dans `h2a`.

C'est exactement le fork E2 de la STUDY, toujours ouvert :
(a) worker local propriété sentropic lancé par h2a,
ou (b) moteur en librairie dans le process h2a.
La direction D-028 (local, SQLite) et le mandat du
2026-09-23 (cluster-mesh comme surface d'intégration
unique et paresseuse, item ligne 1449) renforcent (b)
pour une v1 locale, sans trancher (a) pour la cible.

### B.5 Mémoire, serveur unique, Focus

| Sujet | État | Preuve |
|---|---|---|
| engram | `@sentropic/engram` 0.20.0 sur `origin/main` du dépôt ex-graphify ; renommage graphify→engram sans migration des valeurs persistées `graphify-memory` | `package.json` lu par `git show` ; item Track ligne 1495 |
| Mémoire par MCP | Décision du 2026-10-17 : outils MCP au standard sentropic, ré-exposés dans le registre, h2a hérite par choix via cluster-mesh, désactivés par défaut ; lot h2a MCP-L8 dépend des lots sentropic L5–L7 | item ligne 1777 ; spec citée `graphify/.graphify/scratch/design/memory-mcp/SPEC-memory-mcp-v2.md`, hors dépôt h2a |
| Ontologies de dev gardées par engram | Transmis conducteur ; `source-gap` dans les fichiers lus ici | Aucun contrat lu dans h2a ne donne à engram une autorité d'ontologie opposable à la CLI ; à spécifier si l'owner le confirme (E5) |
| Serveur unique | Pièces : démon PTY natif (`native-host.ts`), MCP central (`central-mcp.ts`), gateway-host (`gateway-host/daemon.ts`, `host.ts`), Focus servi (`packages/h2a/src/runtime/focus/serve.ts`, `packages/focus`) | Aucune pièce lue ne compose le tout en un seul service auto-upgradable ; l'étude unifiée est `source-gap` sur `origin/main` (§B.1) |
| Focus dossiers | Renderer et kit présents dans `packages/h2a` (`focus-kit/`, `focus-app` dans `package.json` files) et `packages/focus` | Le dossier du 28/09 pouvait donc être présenté ; il ne l'a pas été par le chemin commité |

### B.6 Écart réel, en une table

| Couche cible (STUDY §1) | Existe | Manque pour une v1 headless locale |
|---|---|---|
| Front `h2a run native` | Dispatch paresseux, `run <profile>`, goldens | Sélecteur `native`, classifier pur, readiness sans effet de bord, exits 1/2/64/127 |
| Seam session | Proposition §5 complète sur papier | Schémas versionnés Create/Attach/Send/Stop, ou, en v1 librairie, leurs équivalents en types partagés sentropic |
| Boucle LLM↔outils | Boucle chat sentropic sur ports | Itération tool_use de code bornée (tours, budget tokens), événements de session, stop-reasons |
| Outils de code | Rien dans la boucle ; beaucoup dans les CLI vendor hébergées | read/search/edit/write/bash locaux, gate ask/allow/deny, journal d'exécution |
| Egress modèles | gateway-host + mesh 0.26/0.27 + catalogue #373 | Adaptateur boucle→mesh sans contournement, politique modèle inconnu |
| Contexte / reprise | context-budget chat-core, checkpoints Postgres partiels | Journal de session local append-only, reprise par ré-instanciation, compaction événement d'abord en v2 |
| MCP / mémoire / Track | MCP h2a central, engram 0.20.0, Track façade | Client MCP par session native, opt-in mémoire MCP-L8, aucun couplage dur si éteint |
| TUI interactive | PTY host, attach | Rendu interactif de la boucle ; **hors v1 headless** |
| Gouvernance | identité, enrôlement, sièges, ledger gateway | Admission workspace-binding pour native (ADMIT-02/03 de l'EVOL) |

Autrement dit : sur les trois couches de la cible,
la couche du bas (modèles) est la plus avancée,
la couche du haut (front) est à un classifier près,
et la couche du milieu (moteur de code) est le travail.
Aucune option sérieuse ne supprime ce milieu.
Les options ne diffèrent que par qui l'écrit,
où il vit, et ce qu'on jette ensuite.

---

## C. Options pour la première version utilisable

Critère de jugement, dans l'ordre :
(1) l'owner peut-il coder avec, vite ;
(2) la boucle reste-t-elle gouvernée (gateway, permissions,
journal) ; (3) le travail survit-il à la cible R1–R15 ;
(4) licences et dépendances sont-elles compatibles avec
la stack Node/TS validée, zéro Python.

Licences de nos dépôts, vérifiées : h2a MIT,
sentropic MIT, engram MIT (fichiers `LICENSE` lus par
`git show`). Toute option qui importe du code tiers doit
rester compatible MIT en distribution.

### C.1 Option 1 — Boucle sentropic, consommée par h2a

Variante 1a, service distant : h2a envoie un
`SessionLaunchIntent` au moteur sentropic hébergé
(api/chat), qui exécute la boucle. C'est la lecture
littérale de la STUDY §5 avec placement `sentropic`.

Variante 1b, librairie : sentropic publie la boucle comme
paquet (extension de `@sentropic/chat-core` ou nouveau
paquet, nom à trancher côté sentropic), h2a l'embarque
en local avec des adaptateurs locaux (fichiers/SQLite,
outils de code du poste, mesh en process via cluster-mesh).
Même code de boucle, deux placements plus tard.

| Aspect | 1a service | 1b librairie |
|---|---|---|
| Outils de code sur le poste owner | Exige un worker local ou un relais d'exécution ; sinon l'agent édite un workspace distant | Natifs : les outils tournent dans le process h2a, cwd réel |
| Hors-ligne / latence | Dépend du service sentropic | Local, seul l'appel modèle sort par la gateway |
| Conformité D-028 (local SQLite) | Non en l'état (Postgres api) | Oui si les stores locaux sont des adaptateurs des ports |
| Prérequis bloquant | Réponses Q1–Q5/A1–A4 + seam réseau versionné + R6/R12 côté api | Accord sentropic sur la forme paquet et les ports d'outils ; pas de seam réseau en v1 |
| Réutilisation cible | Maximale si sentropic héberge demain le même seam | Le même paquet peut être hébergé demain derrière le seam §5 sans réécrire la boucle |
| Risque propre | Rejoue le blocage de juillet : attendre un service qui n'a pas répondu | Deux contextes d'exécution du même paquet à tenir (le coût signalé par E2), borné si les ports restent la seule surface |

Dépendances : `@sentropic/chat-core` (MIT, deps
`@sentropic/contracts`, `@sentropic/events`), mesh via
cluster-mesh comme déjà consommé par `gateway-host`.
Aucune dépendance nouvelle hors écosystème sentropic
n'est nécessaire pour la boucle elle-même.

### C.2 Option 2 — Partir d'une CLI ouverte existante

Candidats examinés, licences consultées le 2026-10-18
(sources web, à re-vérifier sur le `LICENSE` du commit
épinglé avant tout emprunt de code) :

| Candidat | Licence annoncée | Forme | Ce qu'on gagnerait | Ce qui resterait à faire |
|---|---|---|---|---|
| OpenCode | MIT | CLI/TUI TS, agents et MCP | TUI et surface d'outils immédiates, langage de notre stack | Brancher gateway/catalogue/sièges à notre façon, journal de session compatible reprise h2a, gouvernance Track/h2a, tenir un fork ou une couche plugin |
| Muse | Apache-2.0 | CLI Rust + app-server | Moteur et sandbox OS éprouvés, `exec --json` | Rust hors stack validée pour un fork ; en simple profil, il est déjà là (`h2a run codex`) et sa boucle reste celle d'OpenAI |
| Gemini CLI | Apache-2.0 | CLI TS | Proche d'agy déjà hébergé | Même remarque : déjà consommable en profil, boucle non gouvernée par nous |
| OpenHands (SDK) | MIT, répertoire `enterprise` sous licence séparée selon les sources lues | SDK + serveur d'agent, ACP | Modèle d'événements et de délégation proches de R1/R9 | Surface très large à qualifier ; chevauche sentropic (sessions, placement) au lieu de le compléter |
| Claw Code | `unverified` ici | CLI étudiée par le benchmark de septembre (commit épinglé `08106b0c…`) | Référence de parité déjà capitalisée | Le benchmark lui-même avertit : registres internes ≠ transport réel ; aucune exécution qualifiée chez nous |
| Muse | propriétaire, conditions commerciales Meta | CLI fermée, déjà profil `muse` et fournisseur de modèles Wonder/Spark via gateway | Rien à forker ; usage immédiat en vendor | Ne peut pas devenir « notre » boucle ; le confondre avec la CLI native recréerait la dépendance qu'on veut quitter |

Deux usages distincts à ne pas mélanger :

- En **référence de forme** (événements `stream-json`,
  permissions, reprise), ces CLI sont déjà exploitées par
  la STUDY §3/§7 et le benchmark local. Coût nul, à garder.
- En **base de code forkée**, le gain réel se limite à la
  TUI et aux outils. Or la v1 recommandée est headless :
  le gain s'évapore, et il reste le coût permanent :
  suivre l'amont, porter nos invariants (pas de prompt en
  argv, pas de fallback modèle silencieux, exits typés,
  journal append-only) dans un code qui ne les a pas,
  et expliquer dans un an pourquoi « notre CLI » est un
  fork divergent d'OpenCode. La différenciation h2a
  (protocole inter-agents, Track, gouvernance) n'est dans
  aucun de ces amonts ; elle resterait à écrire dans tous
  les cas, dans le fork au lieu de chez nous.

Cas particulier ACP (Agent Client Protocol) : l'adopter
comme **wire** plus tard (R14) est compatible avec
l'option 1b et ne demande aucun fork. Le mettre en v1
ajoute une surface externe avant même d'avoir un moteur.

### C.3 Option 3 — Boucle écrite dans h2a-runtime

Écrire la boucle directement dans
`packages/h2a-runtime/src/` (nouveau dossier
`native-agent/`), en réutilisant `gateway-host`,
`llm-mesh-accounts`, `model-catalog`, `central-mcp`,
`native-host`, les gardes de lancement et le ledger.

| Pour | Contre |
|---|---|
| Aucune attente cross-repo pour démarrer ; tout est dans le dépôt qui a le besoin et les tests | Contredit la décision consignée « le moteur est sentropic » ; crée le deuxième moteur que la STUDY voulait éviter |
| Outils locaux, permissions et journal au plus près du code qui sait déjà lancer, attacher, restaurer | Si sentropic livre ensuite son moteur, il faudra migrer ou assumer deux boucles ; l'histoire de WP13 montre que les seams non co-validés pourrissent |
| Réutilise le tuple gateway déjà qualifié par h2a | La boucle de chat sentropic (compaction, streaming, checkpoints) serait réinventée au lieu d'être héritée par ports |

Cette option est la plus rapide à démarrer et la plus
chère à réconcilier. Elle ne se justifie que si l'owner
révoque explicitement la propriété sentropic du moteur.
Voir question E1, qui doit rester ouverte en principe.

### C.4 Recommandation

**Option 1b, bornée headless, avec repli explicite.**

En clair :

1. La boucle vit côté sentropic, comme code de paquet
   testable sans api ni Postgres, au-dessus des ports
   `chat-core` existants (`MeshDispatchPort`, stores,
   context-budget, stream). Sentropic choisit le nom et
   le découpage interne ; h2a ne spécifie que le contrat
   d'outils et d'événements qu'il consomme.
2. h2a fournit en local : le sélecteur `native`, les
   outils de code, la gate de permission rendue dans le
   terminal, le journal de session local, l'adaptateur
   mesh (gateway obligatoire), le client MCP
   (h2a toujours, engram si opt-in MCP-L8).
3. Première forme livrée : `h2a run native -p` headless
   + `--json` événementiel. L'interactif TUI vient après
   preuve headless, sur le même journal d'événements.
4. Si sentropic ne peut pas porter le lot boucle dans la
   fenêtre du §D, le repli n'est pas silencieux :
   l'owner tranche entre attendre, ou autoriser
   l'option 3 comme boucle h2a assumée et datée,
   avec migration ultérieure écrite dès le départ.
   Ce repli est une décision, pas un glissement.

Ce que la recommandation refuse :
le fork d'une CLI ouverte comme produit (C.2 en base),
le programme maximal 123 fonctionnalités comme
précondition, et la bascule des formes implicites
dans le lot qui prouve la boucle.

Texte de spec proposé (anglais, à verser tel quel
dans l'EVOL qui ouvrira les lots du §D) :

> **Native agent v1 — proposed normative excerpt (EN)**
>
> 1. `h2a run native` is an explicit selector. It MUST NOT
>    be inferred from configuration, workspace content, PATH,
>    prior use, a model identifier, or a picker. Bare `h2a`
>    and exact `h2a run` keep their current behaviour in v1.
> 2. The v1 surface is headless: `h2a run native -p <prompt>`
>    and `h2a run native --prompt-stdin`, with `--model`,
>    `--effort`, `--max-turns`, `--max-budget-usd`, `--json`
>    (one result object) and `--output-format stream-json`
>    (versioned session events). The prompt MUST NOT be
>    required in argv when a stdin/file form is used, and
>    MUST never be logged.
> 3. The agent loop is owned by sentropic and consumed by
>    h2a as a library over the `chat-core` ports. h2a owns
>    the CLI front, the local coding tools, the permission
>    UX, and the local session journal. Tool execution is
>    local to the h2a host in v1; no network session seam
>    is required by v1.
> 4. Every model call MUST go through llm-mesh/llm-gateway
>    as composed by cluster-mesh. A model identifier that
>    cannot be resolved MUST fail with a typed catalog
>    error and exit 2; silent model substitution and direct
>    provider fallback are prohibited.
> 5. The session journal is append-only. Resume means
>    re-instantiating the loop from the journal; it MUST
>    NOT claim PTY or process continuity. Every terminal
>    outcome carries a stop reason from a closed taxonomy
>    (completed, max-turns, budget, tool-denied, model-error,
>    cancelled, internal-error).
> 6. Coding tools in v1 are exactly: read, search, edit,
>    write, and shell. Mutating tools and shell MUST pass
>    the permission gate (allow once / allow for session /
>    deny); under `--json` and in non-TTY runs, an undecided
>    mutating call MUST be denied, never auto-approved.
> 7. MCP servers are attached per session by explicit
>    reference. The h2a MCP surface is attached by default;
>    engram memory tools are attached only when the
>    persisted MCP-L8 opt-in is enabled. A missing or
>    failing optional MCP server MUST degrade to a named
>    warning in the journal, not to loop failure.
> 8. Vendor profiles keep their existing argv, PTY, output
>    and exit behaviour. An unknown `run` selector MUST be
>    a usage error (exit 1, stderr only, no session, no
>    enrollment) once the corresponding owner decision is
>    recorded; until then it is characterised by tests, not
>    silently changed.
> 9. Exit codes: 0 clean completion; 1 usage or interactive
>    safety refusal; 2 readiness, admission, model, budget
>    or engine failure with a structured reason; 3 local
>    I/O failure; 64 runtime API incompatibility; 127
>    missing optional runtime; 128+signal on signals.

---

## D. Premier incrément utilisable — lots, tests RED, fichiers, date mesurée

Définition de « utilisable » pour cet incrément :
l'owner lance dans un dépôt réel, en headless,
`h2a run native --prompt-stdin --model muse-wonder-1.0`
(ou tout id du catalogue retenu), l'agent lit le code,
propose ses mutations sous gate, édite, lance une commande
de test ciblée, rend un objet résultat typé et un journal
rejouable. Aucune TUI, aucune bascule implicite.

Règles appliquées à tous les lots : RED d'abord
(test nommé, exécuté, rouge pour la bonne raison),
tests ciblés fichier par fichier uniquement
(`npx vitest run <file>` ou `node --test <file>`),
répertoires temporaires uniquement (`mkdtemp`,
`XDG_RUNTIME_DIR` temporaire créé par le test),
aucun accès à l'état h2a réel, aucun test « skip si absent »
compté comme vert, aucun Python.

### Lot 0 — Décision et tuple (h2a, papier ; sentropic, accusé)

Objet : fermer ce qui a bloqué juillet et septembre
avant d'écrire la boucle.

Fichiers exacts :

- h2a `docs/specs/2026-09-28-DOSSIER_agentic-cli-maximal.md`
  et ses dépendances locales `2026-09-27-*` : à verser tels
  quels par PR documentaire séparée, ou à écarter par une
  décision tracée. Ne pas les réécrire dans ce lot.
- h2a, nouveau : `docs/specs/<date>-SPEC_EVOL_native-agent-v1-headless.md`
  reprenant l'extrait normatif du §C.4, la correction
  NR2-01 et la charte NR-12 exigées par le dossier r5.
- h2a `packages/h2a-runtime/package.json`,
  `packages/h2a/package.json` : aucun bump dans ce lot ;
  seulement la qualification écrite du tuple consommé
  (cluster-mesh 0.16.0 / llm-gateway 0.20.0 / llm-mesh 0.26.0)
  face au tuple sentropic courant (0.19.1 / 0.21.0 / 0.27.0).

RED (mécanique, pas de code produit) :

- La vérification mécanique pendante du dossier r5
  (§5, §8.4, §10.3, §10.5, §14, §15 cités) est exécutée
  et son résultat joint ; tout écart bloque le lot 1.
- `node --test packages/h2a/test/runtime-version-range-guard.test.js`
  reste vert sur le tuple déclaré (test existant,
  caractérisation avant tout bump du lot 4).

Sortie : réponses sentropic écrites aux seules questions
que la v1 librairie pose (forme du paquet boucle,
port d'outils, événements), pas aux quinze R d'un coup.

### Lot 1 — Classifier pur et sélecteur explicite sans moteur (h2a)

Fichiers exacts :

- `packages/h2a/src/native-dispatch.ts` (nouveau, nommé
  par l'EVOL 2026-07-29 DISP-01/DISP-03) :
  `classifyNativeDispatch`, `assertDispatchMode`.
- `packages/h2a/test/native-dispatch-contract.test.js`
  (nouveau, `node --test`).
- `packages/h2a/src/bin-routing.ts`, `packages/h2a/src/bin.ts`,
  `packages/h2a/src/cli.ts` : réconciliation avec la
  chaîne existante, aide core sans import runtime.
- `packages/h2a-runtime/src/native-dispatch.ts` et
  `packages/h2a-runtime/src/native-dispatch.test.ts`
  (nouveaux, DISP-02) : classification avant la migration
  de config de `packages/h2a-runtime/src/index.ts`.
- `packages/h2a/test/dispatch-characterization-goldens.test.js`
  (existant, à étendre, jamais à affaiblir).

Tests RED nommés (repris de l'EVOL) :

- « classifies every DispatchMode row without I/O »
- « rejects an unknown DispatchMode before migration or session creation »
- « core help rows do not load runtime »
- « explicit native without a ready engine exits 2 and creates no session »
  (adaptation v1 d'ADMIT/readiness : pas de moteur au lot 1,
  donc tout `run native` doit échouer proprement)
- Non-régression : chaque profil vendor connu garde sa route ;
  sélecteur inconnu seulement caractérisé, pas encore rejeté,
  tant que la décision P3 de l'EVOL n'est pas consignée.

### Lot 2 — Boucle d'agent sentropic en librairie (sentropic)

Fichiers exacts (dépôt sentropic) :

- `packages/chat-core/src/agent-loop.ts` (nouveau) :
  itération bornée au-dessus de `MeshDispatchPort`
  (`packages/chat-core/src/mesh-port.ts`), réutilisant
  `context-budget.ts`, `stream-port.ts`,
  `runtime-tool-dispatch.ts` pour leur forme, sans importer
  `api/` ni un fournisseur concret.
- `packages/chat-core/src/` : port d'outils de session,
  soit extension du registre existant déclaré par le paquet,
  soit nouveau fichier nommé par sentropic ; l'exigence h2a
  est le contrat (nom, schéma d'entrée, résultat typé,
  erreur typée), pas le nom du fichier sentropic.
- `packages/chat-core/src/index.ts` : export de la boucle.
- `packages/chat-core/tests/agent-loop.test.ts`
  (nouveau, `npx vitest run tests/agent-loop.test.ts`
  depuis `packages/chat-core`), uniquement sur
  `src/in-memory/*` et un faux `MeshDispatchPort`.

Tests RED nommés :

- « runs tool_use then end_turn and returns completed with the tool result in context »
- « stops at maxTurns with stop reason max-turns and makes no further mesh call »
- « stops on the token budget before starting a new mesh call »
- « a mesh error is terminal, typed, and never retried against a second model »
- « cancellation between turns ends as cancelled and emits no further tool call »
- « every turn appends sequenced stream events that replay from a given sequence »

Hors lot : `fork`/`tag` Postgres, reprise de tour crashé
côté api, egress gateway de l'api (R3, R4, R12 restent
ouverts côté service ; la v1 locale ne les attend pas).

### Lot 3 — Outils de code, gate, journal local (h2a)

Fichiers exacts (nouveaux, sauf mention) :

- `packages/h2a-runtime/src/native-agent/coding-tools.ts`
  et `coding-tools.test.ts`
- `packages/h2a-runtime/src/native-agent/permission-gate.ts`
  et `permission-gate.test.ts`
- `packages/h2a-runtime/src/native-agent/session-journal.ts`
  et `session-journal.test.ts`
- Réutilisation sans modification de principe :
  `workspace.ts`, `gitdiff.ts`, `file-lock.ts`,
  `crash-log.ts` pour leurs primitives existantes.

Tests RED nommés (tous en `mkdtemp`) :

- « read and search are confined to the workspace root »
- « edit outside the workspace root is denied and writes nothing »
- « a mutating call without a decision is denied in non-TTY mode »
- « shell runs with an argv array, a timeout, and bounded captured output »
- « the journal is append-only and replays to the same message list »
- « resume re-instantiates from the journal and claims no process continuity »
- « no prompt bytes appear in argv, journal metadata, or crash log output »

Le format de journal v1 est un fichier JSONL local par
session. Le passage SQLite (D-028) est un adaptateur
ultérieur du même journal, pas une précondition :
exiger SQLite en lot 3 retarderait la preuve sans
changer le contrat. Voir question E3.

### Lot 4 — Egress mesh obligatoire et catalogue (h2a, consomme sentropic)

Fichiers exacts :

- `packages/h2a-runtime/src/native-agent/mesh-adapter.ts`
  et `mesh-adapter.test.ts` (nouveaux) : `MeshDispatchPort`
  sentropic implémenté sur la composition cluster-mesh
  déjà utilisée par `packages/h2a-runtime/src/gateway-host/host.ts`
  (`createLlmMesh`, `@sentropic/cluster-mesh/llm-mesh`).
- `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts`
  et `model-catalog.test.ts` (existants) : politique v1
  tranchée en E4 ; en attendant, catalogue fermé #373.
- `packages/h2a-runtime/src/llm-mesh-accounts.ts`
  (existant, réutilisé) pour comptes et ownerScope.
- Bump de tuple si le lot 2 l'exige :
  `packages/h2a-runtime/package.json`,
  `packages/h2a/package.json`, `package-lock.json`,
  avec `packages/h2a/test/runtime-version-range-guard.test.js`
  et `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.test.ts`
  en caractérisation avant/après.

Tests RED nommés :

- « an unknown model fails with a typed catalog error and zero provider calls »
- « a readable alias resolves by identity only (wonder → muse-wonder-1.0) »
- « the requested effort is forwarded as intent and never silently downgraded »
- « a completed call records exactly one ledger settlement through the sink »
- « there is no direct-provider path when the mesh is unavailable »

### Lot 5 — Assemblage headless et attache MCP (h2a)

Fichiers exacts :

- `packages/h2a-runtime/src/native-agent/run-native.ts`
  et `run-native.test.ts` (nouveaux)
- `packages/h2a-runtime/src/native-agent/mcp-attach.ts`
  et `mcp-attach.test.ts` (nouveaux), par-dessus
  `packages/h2a-runtime/src/central-mcp.ts` existant
- `packages/h2a-runtime/src/index.ts` : branchement du
  sélecteur `native` à côté de `.command("run <profile> [path]")`,
  sans changer les routes vendor
- `packages/h2a/test/native-run-contract.test.js`
  (nouveau, `node --test`) : contrat binaire avec faux
  mesh injecté, `XDG_RUNTIME_DIR` temporaire
- Différé en lot 5b seulement si l'owner le demande :
  `packages/h2a/src/runtime/mcp/tools.ts` pour exposer
  `native` dans `h2a_run`. La CLI d'abord, l'outil MCP
  ensuite ; mélanger les deux a déjà brouillé les
  responsabilités (cf. défauts de lancement `h2a_run`
  consignés en septembre, items lignes 1516–1517).

Tests RED nommés :

- « headless run reads, edits under an allowed decision, runs a command, and exits 0 with one result object »
- « stream-json emits versioned events with contiguous sequences and a terminal stop reason »
- « resume from the journal continues the same conversation with a new execution »
- « h2a MCP unavailable degrades to a named journal warning, not a failure »
- « engram tools are absent when the MCP-L8 opt-in is off, present when on, in a temp config »
- « SIGINT ends the run as cancelled with exit 130 and a flushed journal »

### Lot 6 — Qualification owner et release (sentropic puis h2a)

Fichiers exacts :

- sentropic : version du paquet boucle
  (`packages/chat-core/package.json` si tel est le choix),
  notes de version du dépôt selon son chemin standard.
- h2a : `packages/h2a/package.json`,
  `packages/h2a-runtime/package.json`,
  `scripts/release.mjs` (existant, non modifié sauf
  nécessité prouvée), aide (`packages/h2a/src/cli.ts`,
  `packages/h2a-runtime/src/cli-help-groups.ts`) annonçant
  `run native` explicite et rien de plus.
- Track, par le writer habituel : réalisation des items
  D-008 et du WP13 limitée à l'incrément, D-063 fermé
  par le dossier enfin versé.

Preuves exigées : chaque fichier de test des lots 1–5
exécuté en ciblé avec sortie consignée, revue croisée
par une famille de modèle distincte de l'auteur de
chaque lot, puis essai owner en situation réelle.
L'essai réel (vrai compte gateway, vrai dépôt) n'est pas
remplaçable par les faux mesh des tests ; il est la
dernière gate et il peut échouer. Voir §E, incertitudes.

### Hors incrément, dans l'ordre ensuite

1. Interactif : attache TUI au journal du lot 3 via
   `native-host.ts` / `attach.ts`, saisie tour par tour,
   décisions de permission en direct.
2. Compaction comme événement, fork de checkpoint
   (R5, R3), reprise de tour interrompu (R4) côté paquet.
3. Formes implicites `h2a` nu et `h2a run` exact :
   majeur coordonné de l'EVOL, avec annonce une version
   à l'avance et l'échappatoire datée.
4. Serveur unique : composition des pièces existantes
   derrière le cycle de vie déjà présent dans
   `gateway-host/daemon.ts` et `central-mcp.ts`,
   une fois la question « unité de service ou PID » close.
5. Subagents en session, hooks, ACP, placement k8s et
   in-sentropic (R9, R10, R14, R8).

### Date — calcul en temps agent mesuré

Données fournies par le conducteur :
PR h2a `open → merge` P50 = 2 h 45 sur 20 PR ;
chaîne engram contrats → release ≈ 21 h de mur.

Modèle, explicite pour être réfutable :

- Un « cycle lot-PR » = rédaction avec tests ciblés
  + `open → merge`. La rédaction n'est pas mesurée par
  les données fournies (`source-gap`) ; elle est
  budgétée à 1× à 2× le P50, soit un cycle de
  5 h 30 à 8 h 15 en lane dédiée continue.
- Chemin critique avec deux lanes en parallèle
  (sentropic lot 2, h2a lot 3) :
  lot 0, lot 1, max(2,3), lot 4, lot 5, lot 6 = 6 cycles,
  soit **33 h à 49 h 30 de mur agent en continu**,
  centre ≈ 41 h.
- Contrôle de cohérence : la sous-chaîne cross-repo
  lots 2 → 4 → 6 vaut 16 h 30 à 24 h 45 dans ce modèle ;
  la chaîne engram mesurée, de même nature
  (contrats puis release), fait ≈ 21 h. Le modèle ne
  contredit pas la mesure indépendante disponible.
- En une seule lane séquentielle : 7 cycles,
  **38 h 30 à 57 h 45**.
- Chaque revue concluant NO-GO sur un lot ajoute un
  cycle complet : +5 h 30 à 8 h 15. Budget prudent
  avec un NO-GO : **38 h 30 à 57 h 45** à deux lanes.

Date, sous hypothèse unique et datée :
GO owner le 2026-10-19 à 09:00 (heure du poste),
lanes en continu, décisions E1/E2/E4 closes au GO.
Alors l'incrément headless qualifié tombe entre le
**2026-10-20 18:00 et le 2026-10-21 11:00**,
centre le 2026-10-21 vers 02:00 ;
avec le NO-GO budgété, au plus tard le 2026-10-21 19:00.
Toute pause de lane, toute attente de réponse owner et
l'essai en situation réelle du lot 6 s'ajoutent heure
pour heure ; ce ne sont pas des jours ouvrés humains,
c'est du mur agent mesuré qui s'arrête quand personne
ne travaille.

Ce qui n'entre pas dans cette date : la TUI, les formes
implicites, le serveur unique, k8s. Les annoncer à la
même date serait refaire septembre.

---

## E. Questions ouvertes pour l'owner — principes, contexte, recommandation

Aucune de ces questions n'est fermée par la présente analyse.
Les recommandations aident à trancher ; elles ne tranchent pas.

### E1. À qui appartient la boucle, si sentropic ne la porte pas dans la fenêtre ?

Contexte : le 2026-07-13 vous avez tranché « la boucle
nous appartient » et « gérée par sentropic ».
Le 2026-07-18, h2a a posé le moteur chez sentropic.
Depuis, aucune réponse au seam n'est tracée, et la lane
agents a déjà valu une décision Track le 2026-07-31
« silencieuse 29,5 h, rien produit ».

Vos voies : (i) sentropic porte la boucle en lot 2,
dans la fenêtre du §D ; (ii) h2a écrit la boucle chez
lui, de façon assumée et datée, avec migration écrite ;
(iii) on attend un moteur hébergé, et la CLI attend aussi.

Recommandation : (i) en première demande, avec une date
de repli fixée au GO. Sans date de repli, (i) devient
(iii) sans que personne l'ait décidé. Jamais de boucle
h2a glissée en silence sous l'étiquette sentropic.

### E2. « Dépasser le moteur actuel » borne la cible, ou bloque la v1 ?

Contexte : vous avez demandé le 2026-07-18 un moteur
qui dépasse le moteur de code sentropic actuel, et la
STUDY en a fait les quinze exigences R1–R15.
Lue strictement, cette demande interdit de livrer avant
fork, reprise crashée, subagents, hooks, budgets $,
ACP. C'est la lecture qui a tenu depuis juillet,
et rien n'est sorti.

Recommandation : garder R1–R15 comme boussole de cible
co-validée rang par rang, et autoriser la v1 sur un
sous-ensemble nommé : R1 journal, R2 rejouable,
R5 budgets de contexte sans événement de compaction,
R6 outils de code, R7 gate simple, R11 partiel
(tours et tokens, pas de $), R12 egress mesh,
R13 headless. Tout le reste est différé de façon
écrite, pas abandonné.

### E3. Que signifie concrètement « h2a = un sentropic local » pour les données ?

Contexte : votre phrase du 2026-08-09 couple cette
image à SQLite plutôt que Postgres en local.
Or le moteur sentropic de production est Postgres,
et Track a déjà son journal d'événements propre.
Trois objets pourraient prétendre « être » la mémoire
d'une session native : le journal de session, Track,
la mémoire engram.

Recommandation : trois rôles, trois objets.
Journal de session local = vérité de la conversation,
append-only, JSONL en v1, adaptateur SQLite ensuite
si un besoin de requête est prouvé.
Track = vérité du travail et des décisions, inchangé.
engram = mémoire récupérable par outils MCP sous
opt-in, jamais la vérité de session.
À vous de confirmer, car toute autre répartition change
les lots 3 et 5.

### E4. Catalogue de modèles : fermé et testé, ou ouvert au mesh ?

Contexte : la STUDY §6 dit « tout id que le mesh route,
zéro validation locale ». Depuis, la PR #373 a livré
l'inverse en pratique pour `--gw` : un miroir fermé de
6 ids avec alias identité-seulement, testé.
Ouvrir en v1, c'est des comportements modèle par modèle
(outils parallèles, efforts, images) non qualifiés dans
notre boucle neuve. Fermer, c'est contredire la promesse
« tous les modèles du mesh » au premier essai.

Recommandation : v1 fermée sur le catalogue #373,
annoncée comme telle dans l'aide, avec erreur typée
qui nomme les ids acceptés. Ouvrir par vagues testées
ensuite, modèle par modèle. Le principe à vous :
voulez-vous la promesse large d'abord, ou la boucle
sûre d'abord ? Nous recommandons la boucle sûre.

### E5. Quel pouvoir la mémoire a-t-elle sur l'agent ?

Contexte : vous avez couplé dès le 2026-07-30
« memory, et la cli », et le conducteur transmet
« engram gardien des ontologies de dev et de la mémoire »
(formule non retrouvée verbatim dans Track, §A.1).
Deux produits très différents en découlent :
mémoire consultée à la demande comme un outil,
ou mémoire injectée d'office dans le contexte avec
autorité sur ce que l'agent croit du dépôt.

Recommandation : outil opt-in (ligne MCP-L8 du
2026-10-17, désactivé par défaut) pour la v1, avec
provenance citée à chaque récupération dans le journal.
L'injection d'office et toute autorité d'ontologie sont
des décisions produit séparées, à instruire quand une
mesure montrera ce que la consultation apporte ou pas.

### E6. Les CLI tierces restent-elles des égales, ou deviennent-elles un héritage ?

Contexte : Muse, Codex, agy, Muse, Vibe portent
aujourd'hui tout le travail, les sièges et les tests
inter-CLI. « Notre propre CLI » peut vouloir dire
un neuvième profil qui devient le défaut de travail,
ou une sortie progressive des autres.
Le contrat de juillet garde tous les profils vendor
explicites sans date de fin.

Recommandation : native devient le défaut proposé pour
les nouveaux travaux headless dès qu'elle passe vos
essais, et les profils vendor restent supportés sans
déchéance tant qu'une capacité réelle (revue croisée
entre familles, sandbox OS, un modèle exclusif) les
rend nécessaires. Aucune suppression sur un calendrier ;
suppression sur preuve d'inutilité.

Si votre intention est plus forte — par exemple cesser
toute dépendance à un fournisseur nommé, y compris ses
modèles via gateway — elle doit être dite en ces termes,
car elle change le catalogue du lot 4 et la politique
de sièges, pas seulement la CLI.

### E7. Le serveur unique précède, suit, ou ignore la CLI native ?

Contexte : la demande d'un seul serveur h2a (PTY, MCP,
gateway, Focus, bus) date du 2026-08-14 ; ses pièces ont
avancé séparément depuis (§B.5). Le conducteur transmet
un « stream S7 » dont le nom n'a pas été retrouvé dans
les fichiers lus (`source-gap`). Coupler la v1 native au
serveur unique ferait dépendre un incrément de 6 cycles
d'un programme dont même la forme, unité de service ou
PID unique, reste une décision ouverte du 2026-08-15.

Recommandation : découpler. La v1 headless tourne en
process direct sur les pièces existantes ; elle écrit
un journal que tout futur serveur unique pourra attacher
et rejouer. Le serveur unique hérite ensuite d'un
moteur prouvé au lieu de devoir naître en même temps
que lui.

### Incertitudes restantes (ne demandent pas de décision, elles bornent l'analyse)

| Incertitude | Niveau | Effet si elle tourne mal |
|---|---|---|
| Réponse et capacité réelles de la lane sentropic agents | `unverified` | Tout le §D glisse ou bascule en E1 option (ii) |
| Temps de rédaction par lot, non contenu dans le P50 `open→merge` | `source-gap` | La fourchette de date est un modèle calibré, pas une mesure ; l'écart se lit dès le lot 1 |
| Comportement des 6 modèles du catalogue dans notre boucle (outils parallèles, efforts, refus) | `not covered` | Découvert seulement à l'essai réel du lot 6 ; peut imposer des correctifs par modèle |
| État des travaux h2a/sentropic postérieurs aux deux `origin/main` lus, et contenu des branches locales sales | `partial` | Un lot peut découvrir qu'une pièce supposée absente existe en branche ; coût de réconciliation imprévu |
| Licences des CLI ouvertes citées en C.2, lues via sources web secondaires | `unverified` | Sans effet sur la recommandation (aucun emprunt de code) ; bloquant avant tout futur fork |
| Portée exacte de « ontologies de dev » côté engram et du « stream S7 » | `missing source` | E5 et E7 sont posées sans pouvoir citer le texte qui les définit |
| Qualité de code réelle d'une boucle neuve face aux CLI matures sur vos dépôts | `unknown` | La v1 peut être correcte, gouvernée, et décevante ; seuls vos essais du lot 6 le diront, et le critère d'arrêt doit être accepté avant |

---

## Annexe — preuves minimales relisables

```sh
# verbatim owner (lecture seule)
node -e 'const fs=require("fs");const L=fs.readFileSync("/home/antoinefa/src/h2a/.track/events.jsonl","utf8").split("\n");[252,594,1640,1676,1736].forEach(n=>console.log(n,L[n-1].slice(0,300)))'

# h2a, état du front et du catalogue sur origin/main
git -C /home/antoinefa/src/h2a show origin/main:packages/h2a-runtime/src/profiles.ts
git -C /home/antoinefa/src/h2a show origin/main:packages/h2a-runtime/src/index.ts | sed -n '6070,6085p'
git -C /home/antoinefa/src/h2a show origin/main:packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts | head -n 30
git -C /home/antoinefa/src/h2a status --short docs/specs/2026-09-27-BASELINE_agentic-cli.md docs/specs/2026-09-28-DOSSIER_agentic-cli-maximal.md

# sentropic, boucle et fork sur origin/main
git -C /home/antoinefa/src/sentropic grep -n "runAssistantGeneration" origin/main -- api/src/services/chat-service.ts | head -n 5
git -C /home/antoinefa/src/sentropic show origin/main:api/src/services/chat/postgres-checkpoint-adapter.ts | sed -n '205,215p'

# capital papier
git -C /home/antoinefa/src/h2a show origin/main:docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md | sed -n '1,60p'
```

Fin de l'analyse. Aucun code écrit, aucun commit,
aucun test exécuté, aucun processus tiers touché.







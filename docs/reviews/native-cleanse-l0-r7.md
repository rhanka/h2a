# PR #396 — L0, correction round 7

Spec : lot L0 « Baseline witnesses », SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Réception des trois P2 Astra/Sol sur `ff199a890`.

L'ancien observateur combinait deux flags universels et mémorisait seulement
un booléen de handshake. Il acceptait ainsi la réactivation Vibe masquée par
`enabled=false`, ainsi que des outils masqués dans la configuration native.

La sélection est maintenant capturée avant installation selon l'adaptateur.
Les champs inconnus suivent le lecteur natif (ignorés ou refusés) ; les champs natifs, listes par outil et
permissions sont conservés. La sonde garde le catalogue de `tools/list`,
applique les règles natives et utilise les overrides env/cwd du serveur.
Son cache distingue argv, env et cwd ; les cwd, scripts Node et exécutables
relatifs sont résolus depuis le workspace natif. Un serveur initialement désactivé
conserve sa sélection et sa cible actuelle sans être démarré. Une liste
initialement restrictive doit rester restrictive ; retirer ses filtres est
une réactivation interdite. Modifier une liste configurée est également un
changement de choix, même si elle ne correspond à aucun outil du catalogue.

| Adaptateur | État natif modélisé dans la fixture |
|---|---|
| Vibe | `disabled`, `enable_mcp`, listes globales avec glob/regex sans casse ; deny après allow ; liste serveur de noms bruts exacts ; permission par outil. `enabled` n'est pas un alias. |
| Codex | `enabled`, listes de noms exacts ; deny après allow ; allow vide masque tout. |
| Claude | Choix du projet dans `.claude.json`, `disabledMcpServers` ; aucun flag serveur universel. |
| Gemini | `mcp.allowed/excluded` et `includeTools/excludeTools` ; exclusion prioritaire, inclusions qualifiées par arguments. |
| Agy | `disabled`, `enabledTools/disabledTools`. |
| Hermes | `enabled` booléen ou valeur bool-like, repli natif sur on ; include prioritaire sur exclude, globs et liste vide. |
| OpenCode | `mcp`, transport local/argv tableau, `enabled`, règles tools/permission dans leur ordre, globs limités à * et ? (crochets littéraux), et override de l'agent sélectionné ; schéma legacy strict, aliases inconnus refusés. |
| Muse | `enabled` ; listes tools ignorées par 1.3.0 ; formes canonique/legacy ambiguës refusées. |

La fixture OpenCode utilisait auparavant une forme JSON d'un autre hôte.
Sa forme native change uniquement la signature de preuve de son contrat MCP.
Les **42 états du ledger restent RED**, sans assouplissement du vérificateur.
Les cinq nouveaux tests sont requis par l'inventaire npm et sa trust root
indépendante. Les contrôles Vibe sur le vrai paquet installé sont aussi
intégrés au test d'installation, sans ajouter de skip ou de toggle de gate.

## Preuves

Prérequis isolés : `npm run build -w @sentropic/track`, puis
`npm run build:h2a` : exit 0. Tous les chemins HOME/XDG/runtime sont privés.

| Campagne ciblée | Résultat observé |
|---|---|
| Reproductions des reviewers, ancien helper intact, vrai candidat préparé/prepacké/installé | Sain, filtre `mcp_h2a_*`, désactivé, puis réactivé avec `enabled=false` : chacun **48 PASS, gate 0**. Les deux mutations sont donc des faux GREEN. |
| Même paquet et mêmes mutations, helper corrigé | Sain et désactivé : **48/48, gate 0** ; filtre et réactivation : chacun **47 PASS / 1 FAIL, gate 1**, contrat MCP Vibe observé RED. |
| Deux contrôles Vibe permanents, avant correctif | Oracle : **22 PASS / 2 FAIL**, `true !== false`. |
| Tous les nouveaux contrôles contre l'ancien helper | **15 PASS / 12 FAIL**, gate 1, zéro skip/todo. |
| Baseline + oracle, vrai step npm ciblé | **75/75 PASS**, gate 0, **42 RED exacts** ; contrôles empaquetés permanents inclus. |
| Gate / preuve d'exécution / cache npm | **120/120 PASS**. |
| Mutations ledger a/b/c, assertion locale neutralisée | Chacune **48 PASS enfants**, mais gates **1/1/1** ; réparation + déclaration GREEN : **gate 0**. |
| Sources main `912dd3035` et rc.7 `8d588db05`, reconstruites séparément | **48/48 chacune**, gate 0, mêmes **42 RED exacts**. |
| Foreign host / recovery / contention, Node 22 | **38/38 PASS**. |
| Terminal reset fonctionnel, Node 22 | **6/6 PASS**. |
| Ordre des permissions OpenCode et crochets littéraux, avant/après | **25 PASS / 2 FAIL**, dont un faux GREEN de désactivation masquée ; contrôles permanents corrigés. |
| Override relatif Node, avant/après | **26 PASS / 1 FAIL**, puis contrôle permanent GREEN ; aucun skip/todo. |
| Schéma OpenCode, alias inconnu, avant/après | **0/1**, puis **1/1** ; contrôle permanent dans la sélection OpenCode. |
| Baseline, oracle et foreign-host, Node 24.22.0 | **94/94 PASS**, gate 0, 42 contrats ; chemin relatif inclus. |
| Course ENOENT, avant/après | Ancien : **43 PASS / 5 FAIL**, gate 1 ; corrigé : **48/48**, gate 0. |
| Dix répétitions du corps sockets inchangé | **50/50 PASS**, zéro skip/todo. |

Premier replay de l'ancien témoin en parallèle : 41/7, dont restore 18/20 et
ENOENT ; replay isolé : 43/5 sur l'ENOENT attendu. Aucun seuil modifié.

Commandes principales (driver privé : vrai `runGates`, reporter et
vérificateur npm, uniquement fichiers ciblés) :

`node "$TMPDIR/gate.mjs" packages/h2a/test/native-cleanse-baseline.test.js packages/h2a/test/native-cleanse-oracle.test.js`

`node --test packages/h2a/test/{run-test-gates,gate-execution-evidence,prepared-npm-cache}.test.js`

`node "$TMPDIR/mutations.mjs"` ; `node "$TMPDIR/history.mjs"`.

Les rounds 1–6 restent couverts : formats rc.7, cinq tarballs, deux endpoints
avec I/O, restore réel de vingt UUID via dispatcher/flock, préservation du
lock-id et des lignes humaines/inconnues ; faux MCP version/echo/protocole,
hooks désactivés/dupliqués, ressources/plugins/caches et collisions binaires,
activation et transport Vibe, parcours ENOENT/EACCES, teardown, contention,
ordre stty/ready et descripteur procfs fermé. Aucun timeout, garde ou budget
CI augmenté. Le seuil de 60 s est un diagnostic de suite lente.

## Rebase après fusion de #395

La référence origin/main a avancé à `ec04054b604f2b8948a16d955724fe5301e9dccb`
pendant la qualification. La branche est rebasée sur cette fusion : aucun merge
local ni cherry-pick. Les deux dossiers BRANCH.md sont conservés ; le lockfile
reste exactement celui de main avec `@hono/node-server 2.1.5`, sans retour à
l'ancien correctif 2.1.3. Les témoins L0 sont inchangés par le rebase et .track
est identique à main. Sur cette base : **75/75 Node 22**, **94/94 Node 24** et **120/120 trust root**,
zéro skip/todo ; les **42 signatures RED** sont inchangées.

## Sources et limites

Modèle indépendant des inspecteurs produit, confronté aux sources fournisseurs :
[Vibe 2.26.1 manager](https://github.com/mistralai/mistral-vibe/blob/v2.26.1/vibe/core/tools/manager.py),
[Vibe matching](https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/utils/matching.py),
[Codex MCP types](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs),
[Claude MCP](https://code.claude.com/docs/en/mcp),
[Gemini MCP](https://geminicli.com/docs/tools/mcp-server/),
[Agy MCP](https://antigravity.google/docs/mcp),
[Hermes filtres](https://github.com/NousResearch/hermes-agent/blob/main/tools/mcp_tool_registration.py),
[OpenCode MCP](https://docs.opencode.ai/docs/mcp-servers/),
[schéma strict OpenCode](https://opencode.ai/config.json),
[Muse 1.3.0](https://meta-models.github.io/muse-code-sdk/next/guides/extend/mcp-servers/).

Le masque historique `mcp_h2a_*` est conservé dans la reproduction exacte :
son ajout change une sélection configurée. Les contrôles de filtrage effectif
utilisent aussi les noms publiés `h2a_<nom brut>` de Vibe, un deny universel
et une allowlist excluant les outils MCP ; le nom brut serveur n'est pas un glob.

Ces fixtures modélisent leur configuration utilisateur sélectionnée ; elles
ne qualifient pas un CLI fournisseur vivant, ni ses couches workspace/session
arbitraires. La disponibilité réussit aussi sur rc.7 ; l'incident exact du
28/10 reste non démontré. L1–L6 restent séparés. Binding PTY précompilé via
preload privé pour ne jamais invoquer Python ; recompilation native locale
et suite complète non revendiquées. Nouveau consensus de pairs non revendiqué :
MCP h2a absent et dispatch installé interdit par le confinement propriétaire.

Logs : `tmp/h-cond/fix-native-cleanse.r7-*`. TMPDIR privé :
`/home/antoinefa/.cache-tmp/h2a-test/run-QMsBxu`, supprimé en fin de suivi CI.
Aucun état propriétaire, binaire h2a propriétaire, merge, tag ou trailer.

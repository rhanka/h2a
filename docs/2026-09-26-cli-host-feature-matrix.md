# Matrice fonctionnelle mesurée des CLI hôtes — 2026-09-26

## Verdict

Cette matrice mesure `origin/main` à `3a3c345582a113d4338ff7c54f4f4233be552a0d`
et les binaires présents le 26 septembre 2026. Elle ne déduit pas le support d'un
nom trouvé dans le code : chaque cellule renvoie à un exercice et à une sortie
ci-dessous.

Les écarts principaux sont :

1. les snippets d'enrôlement proposés par h2a ne sont pas consommables tels
   quels par Claude, Codex, OpenCode, Hermes et Muse aux versions mesurées ;
2. Hermes est bien accepté par `setup`, `plugin`, `connect` et
   `prove-control`, mais aucun profil de lancement ou de délégation ne
   l'accepte ;
3. le profil `mistral` lance un exécutable absent, alors que l'agent officiel
   Mistral installé s'appelle désormais `vibe` ;
4. `h2a_run` accepte Claude, Codex, AGY et Muse, mais la relance autonome des
   objective loops reste limitée à Claude et Codex ;
5. `keys prove-control` accepte six des sept hôtes enrôlables et rejette Muse ;
6. les chaînes d'aide sans argument de `host setup` et `host plugin` omettent
   Muse, même si l'exécution avec `--host muse` est acceptée.

Le registre historique P1 disant que `h2a_run` ne sait lancer que
Claude/Codex est périmé : AGY et Muse sont acceptés et leurs argv ont été
construits pendant cette mesure.

## Périmètre et vocabulaire

Les sept hôtes enrôlables sont Claude, Codex, AGY, OpenCode, Hermes, Gemini et
Muse. La huitième ligne, Mistral/Vibe, est conservée parce que `mistral` existe
dans la surface de lancement h2a malgré l'absence de descripteur. Le shell
générique n'est pas une CLI agent et ZCode n'a ni profil ni descripteur h2a ;
ils ne sont donc pas des lignes de la matrice.

Chaque cellule commence exactement par un état autorisé : `mesuré-OK`,
`mesuré-KO`, `non-applicable` ou `non-testé (raison)`. Les références `E…`
pointent vers les commandes et sorties de la section « Preuves ».

## Matrice hôte × axe

| Hôte | 1. Enrôlement | 2. Gateway | 3. Modèles | 4. Harnais | 5. Sous-agents | 6. Agent-à-agent | 7. Login llm-mesh | 8. Drumbeat / loops |
|---|---|---|---|---|---|---|---|---|
| Claude 2.1.283 | **mesuré-KO** — le snippet conseillé dans `~/.config/claude/mcp.json` est ignoré ; le témoin natif écrit dans `.claude.json` est chargé [E1]. | **mesuré-OK** — `required` devient `gateway`; seules `ANTHROPIC_BASE_URL` et `ANTHROPIC_AUTH_TOKEN` sont injectées, puis l'environnement parent est restauré [E2]. | **mesuré-OK** — `model/probe` et `high` deviennent `--model model/probe --effort high`; le catalogue reste celui de llm-mesh [E3]. | **non-testé (hook non déclenché)** — le fichier `hooks.Stop`/`UserPromptSubmit` est accepté par `--settings`, mais aucun appel modèle n'a été lancé pour faire partir l'événement [E4]. | **mesuré-OK** — `h2a_run` et `delegate` construisent un lancement ; profondeur bornée à 1–3 [E3, E5]. | **mesuré-KO** — dans la racine vierge, aucun endpoint h2a n'est chargé ; l'échange live n'est donc pas atteignable [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-OK** — participant durable et spécification de relance persistée ; le tick live n'a pas été exécuté [E8]. |
| Codex 0.157.1 | **mesuré-KO** — `config.json` est ignoré ; le témoin `codex mcp add` écrit `config.toml` et apparaît dans `codex mcp list` [E1]. | **non-applicable** — demandé en `gateway`, le profil reste `direct` et aucune variable Anthropic n'est injectée [E2]. | **mesuré-OK** — `model/probe` et `high` deviennent `-m model/probe -c model_reasoning_effort="high"` [E3]. | **mesuré-OK** — le scaffold h2a a été ajouté comme marketplace jetable puis `codex plugin list --json` le rend `installed:true, enabled:true` [E4]. | **mesuré-OK** — `h2a_run` et `delegate` acceptés ; profondeur 1–3 [E3, E5]. | **mesuré-KO** — le chemin d'enrôlement proposé ne charge aucun endpoint dans la base vierge [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-OK** — participant durable et spécification de relance persistée ; tick live non exécuté [E8]. |
| AGY 1.2.11 | **mesuré-OK** — `agy mcp list` rend `h2a`, type `http`, état `enabled` [E1]. | **non-applicable** — profil direct, sans variables Anthropic [E2]. | **mesuré-OK** — modèle et effort sont transmis par `--model` et `--effort`; le défaut mesuré reste `gemini-3.7-flash` [E3]. | **non-testé (régime poll-only)** — `--write` est refusé comme prévu ; le poll h2a n'a pas pu être joué via le MCP indisponible [E4, E6]. | **mesuré-OK** — `h2a_run` et `delegate` acceptés ; `xhigh` reste hors contrat AGY [E3, E5]. | **non-testé (surface MCP refusée avant le serveur)** — le chargeur natif est bon, mais aucun message live n'a atteint h2a [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-KO** — l'agent planifié est accepté, mais `--launch-stdin` répond `loop launch profile must be claude or codex` [E8]. |
| OpenCode 1.17.15 | **mesuré-KO** — OpenCode rejette `mcpServers`; son témoin natif écrit `mcp.oracle` et le liste [E1]. | **non-applicable** — profil direct, sans variables Anthropic [E2]. | **mesuré-KO** — le binaire a `-m provider/model`, mais h2a refuse tout lancement structuré hors Claude/Codex/AGY/Muse [E3]. | **mesuré-KO** — le JSON produit contient une clé Claude `hooks`; OpenCode la rejette comme `Unrecognized key: hooks` [E4]. | **mesuré-KO** — ni `h2a_run` ni `delegate` n'acceptent OpenCode [E3]. | **mesuré-KO** — la configuration d'endpoint h2a est invalide avant toute communication [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-KO** — participant planifiable, relance autonome rejetée [E8]. |
| Hermes 0.18.2 | **mesuré-KO** — `config.json`/`mcpServers` est ignoré ; le témoin `config.yaml`/`mcp_servers` apparaît dans `hermes mcp list` [E1]. | **non-applicable** — aucun profil de lancement h2a [E2, E3]. | **non-applicable** — Hermes accepte nativement `--model`, mais h2a n'a aucun chemin qui puisse le lui transmettre [E3]. | **mesuré-KO** — le fichier Claude-format produit dans `config.yaml` donne `No shell hooks configured`; les mentions « à la Hermes » ne sont pas un chemin d'exécution [E4, E5]. | **mesuré-KO** — enrôlable, mais absent de `h2a_run` et de `delegate` [E3, E5]. | **mesuré-KO** — le snippet d'enrôlement n'est pas chargé [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-KO** — participant planifiable, relance autonome rejetée [E8]. |
| Gemini 0.56.0 | **mesuré-OK** — `gemini mcp list` reconnaît l'endpoint, désactivé seulement parce que le dossier d'oracle n'est pas approuvé [E1]. | **non-applicable** — profil direct, sans variables Anthropic [E2]. | **mesuré-KO** — le binaire accepte `--model`, mais h2a refuse son lancement structuré [E3]. | **non-testé (hook non déclenché)** — le fichier direct est accepté par le parseur ; `hooks migrate` annonce une migration réussie sans produire le fichier annoncé dans l'oracle, et aucun événement n'a été lancé [E4]. | **mesuré-KO** — ni `h2a_run` ni `delegate` n'acceptent Gemini [E3]. | **non-testé (surface MCP refusée avant le serveur)** — endpoint reconnu, message live non joué [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-KO** — participant planifiable, relance autonome rejetée [E8]. |
| Muse 1.4.0 | **mesuré-KO** — le fichier produit manque `schema_version`; Muse le refuse. L'ajout témoin de `schema_version: 1` fait progresser jusqu'à la requête OAuth vers l'URL oracle [E1]. | **non-applicable** — profil direct, sans variables Anthropic [E2]. | **mesuré-OK** — modèle et effort deviennent `--model model/probe --reasoning-effort high` [E3]. | **non-testé (régime poll-only)** — `--write` est refusé comme prévu ; poll live non joué [E4, E6]. | **mesuré-OK** — `h2a_run` et `delegate` acceptés, reprise `resume --last` [E3, E5]. | **mesuré-KO** — l'artefact d'enrôlement par défaut est rejeté avant la connexion [E1, E6]. | **non-testé (coordination llm-mesh indisponible)** [E7]. | **mesuré-KO** — participant planifiable, mais relance autonome rejetée malgré le support de `h2a_run` [E8]. |
| Mistral / Vibe 2.17.1 | **mesuré-KO** — `host setup`, `host plugin`, `connect` et `prove-control` rejettent `mistral` [E9]. | **non-applicable** — aucun lancement effectif [E2, E9]. | **mesuré-KO** — le profil exécute `mistral`, et `spawnSync mistral --version` rend `ENOENT`; l'officiel installé est `vibe` [E9, E10]. | **non-applicable** — aucun descripteur ou mécanisme h2a [E9]. | **mesuré-KO** — ni premier rang ni lancement structuré [E3, E9]. | **non-applicable** — aucun enrôlement h2a [E9]. | **non-applicable** — aucun chemin h2a à coordonner [E9]. | **mesuré-KO** — participant syntaxiquement représentable, mais spécification de relance rejetée [E8]. |

## Preuves

Toutes les commandes h2a de cette section ont été appelées comme tableaux argv
via `runCli` depuis des scripts TypeScript jetables. La CLI `h2a` n'a jamais été
appelée depuis le shell.

### E0 — base et versions réelles

Commande :

```text
rtk git log -1 --format='%H%n%ad%n%s' --date=iso-strict
rtk env -i HOME=<oracle> XDG_CONFIG_HOME=<oracle>/.config PATH=<bins> <host> --version
```

Sortie résumée :

```text
3a3c345582a113d4338ff7c54f4f4233be552a0d
2026-09-26T18:34:48-04:00
claude 2.1.283 (Claude Code)
codex-cli 0.157.1
agy 1.2.11
opencode 1.17.15
Hermes Agent v0.18.2 (2026.7.7.2)
gemini 0.56.0
Muse Code 1.4.0 (1.4.0-R4161.1)
vibe 2.17.1
```

`which mistral`, `which zai`, `which z-ai`, `which glm` et `which zcode`
rendent tous `exit=1`; `which vibe` rend
`/home/antoinefa/.local/bin/vibe`. Les versions du brief sont donc confirmées
pour les sept binaires nommés, mais sa conclusion « aucune CLI agent Mistral
installée » est démentie par Vibe. Aucun paquet n'a été installé.

### E1 — enrôlement réellement consommé

Commande de génération :

```text
rtk ./node_modules/.bin/tsx tmp/oracles/prepare-native-loaders.ts
```

Chaque endpoint pointait vers `http://127.0.0.1:9/mcp`, volontairement fermé.
Cela permet de distinguer « entrée reconnue, connexion refusée » de « entrée
ignorée ou schéma invalide ». Les commandes natives ont ensuite donné :

```text
claude mcp list
  No MCP servers configured.
claude mcp add --scope user --transport http oracle http://127.0.0.1:9/mcp
  File modified: <oracle>/.claude.json
claude mcp list
  oracle ... Failed to connect

codex mcp list
  No MCP servers configured yet.
codex mcp add oracle --url http://127.0.0.1:9/mcp
  Added global MCP server 'oracle'.
codex mcp list
  oracle ... enabled

agy mcp list
  h2a  http  enabled  http://127.0.0.1:9/mcp

opencode mcp list
  Configuration is invalid ... Unrecognized key: mcpServers
opencode mcp add oracle --url http://127.0.0.1:9/mcp
  MCP server "oracle" added ... opencode.jsonc
opencode mcp list
  oracle failed ... http://127.0.0.1:9/mcp

hermes mcp list
  No MCP servers configured.
# témoin config.yaml: mcp_servers.oracle.url = http://127.0.0.1:9/mcp
hermes mcp list
  oracle ... enabled

gemini mcp list
  h2a: http://127.0.0.1:9/mcp (http) - Disabled
  Warning: ... folder is untrusted.

muse mcp login h2a --headless
  malformed settings file ... missing field `schema_version`
# même fichier + "schema_version": 1
muse mcp login h2a --headless
  OAuth HTTP request failed: error sending request
```

Les deux `exit 2` de `host setup` pour Claude/Codex sont des diagnostics
d'installation (marketplace/plugin absents), pas un rejet du nom d'hôte ; le
fichier était bien produit. Les témoins natifs ci-dessus établissent que le
problème est le chemin ou le schéma produit, pas le chargeur du binaire.

### E2 — gateway

Exercice : appel de `gatewayModeForProfile`,
`profileUsesLlmMeshGateway` et `replaceAnthropicGatewayEnvironment` pour chaque
profil, avec trois variables parentes sentinelles puis restauration.

```text
claude: profileUses=true, requested gateway => gateway,
        launch keys=ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL,
        parentRestored=true
codex|agy|opencode|hermes|gemini|muse:
        profileUses=false, requested gateway => direct,
        stale base/auth scrubbed, parentRestored=true
```

Ce n'est pas une lecture de constante : la mutation puis la fonction de
restauration ont été exécutées. Aucun appel payant à un modèle n'a été émis.

### E3 — modèles et surface de lancement

Exercice : résolution de profil, construction d'argv et validation de la
requête `h2a_run` avec modèle sentinelle `model/probe`.

```text
claude  accepted: --model model/probe --effort high
codex   accepted: -m model/probe -c model_reasoning_effort="high"
agy     accepted: --model model/probe --effort high
muse    accepted: --model model/probe --reasoning-effort high
opencode|hermes|gemini rejected:
  h2a_run unsupported profile ... Supported: claude, codex, agy, muse.
```

Les `--help` natifs confirment par ailleurs `--model` chez Claude, AGY,
Hermes, Gemini et Muse, `-m` chez Codex et OpenCode. La matrice ne copie pas la
liste des identifiants : h2a transmet un token, tandis que le catalogue et sa
résolution appartiennent à llm-mesh ou au fournisseur direct.

### E4 — harnais réellement chargé

Génération :

```text
host plugin --host <hôte> --instance <hôte>:matrix-probe --write <oracle>
```

Sorties et contre-épreuves natives :

```text
claude|codex|gemini|hermes|opencode:
  rc=0, hook=hooks.Stop + hooks.UserPromptSubmit
agy:
  rc=1, --write is not available ... poll-only
muse:
  rc=1, --write is not available ... poll-only

codex plugin marketplace add <scaffold> --json    rc=0
codex plugin add h2a-drumbeat@h2a-local --json    rc=0
codex plugin list --json
  installed=true, enabled=true, version=0.1.0

opencode mcp list avec le fichier produit:
  Unrecognized key: hooks
hermes hooks list avec le fichier produit dans config.yaml:
  No shell hooks configured in ~/.hermes/config.yaml.
gemini hooks migrate --from-claude:
  Hooks successfully migrated to .gemini/settings.json
find <oracle> -path '*/.gemini/settings.json': aucun fichier produit
```

Claude accepte le fichier via `--settings`, mais `mcp list` ne permet pas
d'observer les hooks et aucun événement agent n'a été déclenché. Gemini accepte
le fichier direct sans erreur de schéma, mais ne fournit pas de commande
`hooks list`; le chargement événementiel reste donc non testé.

### E5 — délégation et profondeur

`isDelegateType` et `buildDelegateArgs` ont été exécutés pour chaque hôte.

```text
claude|codex|agy|muse: delegateProfile=true
opencode|hermes|gemini: delegateProfile=false
clampDepth: -5→1, 0→1, 1→1, 2.9→2, 3→3, 99→3
budget hérité: top-level 99→3, child env 3→3, env 0→0
budget enfant: 0→0, 1→0, 2→1, 3→2
```

Les occurrences de « Hermes » dans `delegate.ts` servent de référence de
conception ; l'exercice de `isDelegateType("hermes")` rend `false`.

### E6 — communication agent-à-agent

Le serveur publie bien les outils `h2a_inbox`, `h2a_send`, `h2a_run`, sessions
et loops lors de l'appel programmatique `mcp-tools`. En revanche, l'appel MCP
réel depuis cette session est arrêté par la couche d'outillage avant le serveur :

```text
h2a_identity_status {}
  MCP tool call requires approval, but approval policy is never
h2a_discover_sessions {name:"plugins"}
  MCP tool call requires approval, but approval policy is never
```

La panne `identity_failed retryable:false` du 25/09 n'a donc pas elle-même été
atteinte. Aucune défaillance d'hôte n'est inférée de cette indisponibilité.

### E7 — login llm-mesh

La sous-traitance a été tentée, sans inventer le contrat :

```text
h2a_discover_sessions {name:"llm-mesh"}
  MCP tool call requires approval, but approval policy is never
```

Résultat : aucune affirmation de login, de stockage de secret ou de mapping de
compte n'est faite dans ce document. Cet axe entier reste non testé pour les
hôtes enrôlés.

### E8 — drumbeat et objective loops

Une boucle `matrix-loop` avec `autoTick:true` et un participant de chacun des
sept hôtes a été créée puis relue : les sept agents étaient `planned`. Un second
exercice a tenté de persister une spécification complète de relance par hôte :

```text
claude: rc=0, agents[0].launch.profile="claude"
codex:  rc=0, agents[0].launch.profile="codex"
agy|opencode|hermes|gemini|muse|mistral:
  rc=1, h2a loop create: loop launch profile must be claude or codex
```

Le drumbeat push est donc distinct de la relance objective-loop. AGY et Muse
sont lançables par `h2a_run`, mais ne sont pas lançables par la spécification
persistée de boucle. Aucun tick live n'a été joué : il aurait nécessité le MCP
indisponible ou le démarrage d'un agent réel.

### E9 — Hermes, Mistral, Muse et chaînes d'usage

Les hypothèses du brief ont été jouées :

```text
host setup --host hermes      rc=0, artefact écrit
host plugin --host hermes ... rc=0
connect --host hermes ...     rc=0
keys prove-control --host hermes ... rc=0
h2a_run(profile=hermes)       rejected

host setup --host mistral
  rc=1, unknown --host "mistral". Supported: ... muse.
connect --host mistral
  rc=1, unknown --host "mistral".
keys prove-control --host mistral
  rc=1, unknown --host "mistral".
resolveProfile("mistral")
  { command: "mistral", args: [] }
spawnSync("mistral", ["--version"])
  ENOENT

keys prove-control --host muse
  rc=1, unknown --host "muse". Supported: codex, claude, gemini,
  agy, hermes, opencode, remote.

--help principal:
  h2a host setup --host <codex|claude|gemini|agy|hermes|opencode|muse>
host setup sans --host:
  --host <codex|claude|gemini|agy|hermes|opencode> is required
host unknown:
  Use: ... <codex|claude|gemini|agy|hermes|opencode> ...
host plugin sans --host:
  --host <codex|claude|gemini|agy|hermes|opencode|muse> is required
host setup --host muse --write <oracle>:
  artefact produit (rc=0)
```

Les deux chaînes courtes sont bien périmées ; le comportement Muse existe.

### E10 — sources officielles Mistral et Z.ai

Mistral a une CLI agent officielle :

- documentation éditeur : <https://docs.mistral.ai/vibe/code/cli/install-setup.md> ;
- dépôt éditeur : <https://github.com/mistralai/mistral-vibe> ;
- installation officielle :
  `curl -LsSf https://mistral.ai/vibe/install.sh | bash`, ou
  `uv tool install mistral-vibe`, ou `pip install mistral-vibe` ;
- exécutables documentés : `vibe` et `vibe-acp` ; version locale mesurée :
  `vibe 2.17.1`.

Le profil h2a `command: "mistral"` est donc à la fois non lançable et désaligné
sur le nom officiel actuel.

Z.ai a également un agent officiel :

- dépôt éditeur : <https://github.com/zai-org/ZCode> ;
- site éditeur : <https://zcode.z.ai/> ;
- nom de commande documenté : `zcode` ;
- route reproductible documentée : cloner le dépôt, Node 24.14.0 + pnpm
  10.33.2, `pnpm bootstrap`, puis
  `pnpm --filter @zcode/cli... build` ou `pnpm build:zcode`.

`zcode` n'est pas installé ici et aucune distribution npm officielle n'a été
établie pendant la mesure. Aucun des paquets personnels `mistral-cli`,
`zai-cli` ou `muse-cli` n'a été installé ou exécuté.

### E11 — isolement et empreintes

Les exercices ont utilisé `HOME=<repo>/tmp/oracles/...` et
`XDG_CONFIG_HOME=<HOME>/.config`. L'empreinte ciblée avant/après est stable
pour Claude, Gemini et Hermes. Deux fichiers ont dérivé :

```text
~/.codex/config.toml
  avant c23dd376... ; après 158b6295... ; mtime 18:40:41
~/.config/muse/settings.json
  avant a8cccfbe... ; après 8a10dc7e... ; mtime 18:47:39
```

La dérive Codex est non attribuable dans une session Codex concurrente. La
dérive Muse coïncide avec une seconde mesure `muse --version` lancée sans la
racine jetable : le lanceur Muse a également rafraîchi `auth.json` à 18:47:38.
Ce contrôle a donc détecté une violation d'isolement. Aucun snippet h2a n'a été
injecté manuellement dans ces fichiers et ils n'ont pas été restaurés sans
copie exacte, pour ne pas écraser un token rafraîchi ou l'état d'une session
active. Toutes les autres écritures de l'oracle sont restées sous
`tmp/oracles/`.

### E12 — vérifications automatisées complémentaires

```text
npm run build
  exit 0
vitest: llm-mesh, profiles, agent-launch-args, delegate
  4 files passed; 135 passed, 1 skipped
node --test: host plugin/connect/capability, loop launch/autotick
  35 passed, 0 failed
```

Ces tests ne remplacent pas les oracles natifs. Ils prouvent seulement que les
contrats internes exercés correspondent à la base de code mesurée.

## Ce que la matrice couvre

- la présence et la version des sept binaires, plus Vibe ;
- l'acceptation des noms d'hôte par les commandes h2a ;
- la production **et la consommation native** des artefacts MCP ;
- le choix gateway/direct et l'environnement de lancement ;
- le passage des modèles sans figer le catalogue llm-mesh ;
- les hooks/polls/scaffolds, avec installation native témoin pour Codex ;
- `h2a_run`, la délégation, la reprise et le budget de profondeur ;
- la représentabilité dans une objective loop et le contrat de relance
  autonome ;
- les sources officielles Mistral et Z.ai, sans installation opportuniste.

## Ce que la matrice ne couvre pas

- aucun appel payant ou réponse modèle ;
- aucun message agent-à-agent reçu de bout en bout ;
- aucun contrat de login llm-mesh, la lane propriétaire étant injoignable ;
- aucun déclenchement réel des hooks Claude/Gemini et aucun cycle poll AGY/Muse ;
- aucun tick live ni relance de processus par objective loop ;
- aucun hôte distant, Windows/macOS, conteneur ou version différente des
  binaires datés ci-dessus ;
- aucune validation de tous les identifiants de modèles fournisseurs ;
- aucune installation de ZCode, ni audit de ses artefacts de distribution.

## Axes ayant demandé du vrai travail

Le travail substantiel a porté sur les chargeurs natifs, le harnais et les
loops. Il a fallu générer chaque artefact dans un HOME isolé, demander au
binaire de le charger, puis établir un témoin connu-bon quand il le refusait.
C'est ce qui a révélé les cinq ruptures d'enrôlement et les deux formats de
hook incompatibles, invisibles dans les tests de rendu. La comparaison entre
`h2a_run` et la spécification de relance des objective loops a également révélé
un tunnel plus étroit que le registre de premier rang.

Les constats plus simples ont été les versions, la présence des exécutables,
les quatre étages du tunnel de profils et les chaînes d'aide. Ils ont néanmoins
été exécutés, car Vibe installé et l'exclusion de Muse par `prove-control`
montrent qu'une liste lue seule aurait encore produit une conclusion fausse.

## Suites documentaires suggérées

Les documents `docs/plugin-capability-matrix.md` et
`docs/host-integration-matrix.md` décrivent encore plusieurs artefacts comme
« shipped » alors que les chargeurs actuels les refusent. Cette matrice datée
doit servir d'entrée à leur correction, pas être interprétée comme une
validation de publication.

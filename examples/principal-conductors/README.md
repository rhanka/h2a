# Exemple — 1 PRINCIPAL / 15 CONDUCTORS

> Cet exemple est la **définition exécutable** du cas d'usage cible documenté
> dans [`PLAN.md`](../../PLAN.md) (WP-50 / WP-60). Il fait tourner la pile
> `h2a` complète de bout en bout, en mémoire et sur disque, contre les API
> publiques des deux packages publiés.

## Topologie

- **1 PRINCIPAL** : `human:antoine`
- **15 CONDUCTORS** : `conductor:01` … `conductor:15`, tous rattachés au
  scope `scope:principal/antoine` et négociant sur `scope:engagement/ship-v1`.

Chaque instance dispose de sa propre paire de clés `ed25519` (PEM PKCS8
pour la clé privée, SPKI pour la clé publique enregistrée au registry).

## Scénario joué

Le script `run.mjs` :

1. Initialise un store `local-files` éphémère sous `<tmp>/h2a-pc-*/.h2a`.
2. Génère **16 paires de clés** `ed25519` (1 PRINCIPAL + 15 CONDUCTORS).
3. Enregistre les 16 instances via `createLocalStore(...).registerInstance(...)`
   (API librairie, pas le binaire CLI).
4. Ouvre la négociation `nego-charter` avec
   `requiredSigners = ["conductor:01", "conductor:02", "conductor:03"]`
   (quorum 3 sur 15).
5. `conductor:01` émet une `offer` (artefact `ENGAGEMENT`
   `engagement:ship-v1`).
6. `conductor:02` et `conductor:03` émettent chacun un `counter` portant
   l'artefact final ; les trois signent ensuite ce même artefact via
   `signCanonical({ artifactHash }, { by, privateKeyPem })`.
7. Stabilise la négociation via `stabilizeNegotiation` (vérification ed25519
   sur les `publicKeys` du registry + check de quorum) et imprime le record
   résultant ainsi que l'`artifactHash` gagnant.
8. Démarre le serveur MCP (`node packages/h2a-cli/dist/bin.js mcp-serve --root <tempRoot>`)
   en process enfant, envoie un `initialize`, un `tools/list`, puis un
   `tools/call` `h2a_discover_instances({ role: "CONDUCTOR" })` et affiche
   la liste retournée par le serveur (les 15 conducteurs).
9. Nettoie tous les répertoires temporaires.

Le script sort `0` en cas de succès complet et imprime une ligne verte
récapitulative.

## Pré-requis

- Node.js ≥ 20.
- Workspace **buildé** : le serveur MCP est démarré comme process enfant et
  a besoin de `packages/h2a-cli/dist/bin.js`. Exécutez `npm test` ou
  `npm --workspaces run build` au moins une fois avant de lancer l'exemple.
- Aucune dépendance externe : tout repose sur les modules `node:*` et sur
  les deux packages workspace `@sentropic/h2a` et `@sentropic/h2a-cli`.

## Lancement

Depuis la racine du dépôt :

```bash
# Variante portable (build + run)
./examples/principal-conductors/run.sh

# Ou directement, si `dist/` est déjà à jour
node examples/principal-conductors/run.mjs
```

## Sortie attendue (extrait)

```
1. Bootstrap local-files store
  root                   /tmp/h2a-pc-XXXXXX/.h2a

...

7. Stabilize the negotiation (quorum check + ed25519 verify)
  status                 stabilized
  winning artifactHash   sha256:9e388a51...
  signers                conductor:01, conductor:02, conductor:03

8. Probe the MCP server (JSON-RPC 2.0 over stdio)
  server                 @sentropic/h2a-cli@0.1.1
  tools/list             10 tools
  MCP returned           15 conductors

[OK] stabilized engagement:ship-v1 / quorum 3 of 15 conductors / 15 conductors discovered via MCP
```

## Brancher sur Codex / Claude Code

Une fois `@sentropic/h2a-cli` installé (le binaire `h2a` doit être résolvable
via `PATH`), un seul commande émet le snippet MCP à coller dans la config de
l'hôte. Le verbe `host setup` n'écrit jamais ailleurs que la cible passée
explicitement à `--write` ; sans `--write` il se contente d'imprimer le JSON
sur `stdout` et le hint de chemin sur `stderr`.

### Codex CLI

```bash
h2a host setup --host codex --print
# {
#   "mcpServers": {
#     "h2a": {
#       "command": "h2a",
#       "args": ["mcp-serve"]
#     }
#   }
# }
# # codex — paste this snippet under `mcpServers` in:
# # Codex CLI reads its MCP config from either ~/.codex/config.json (legacy)
# # or ~/.config/codex/mcp.json (XDG). Merge the snippet under the top-level
# # `mcpServers` key in whichever file your Codex CLI uses.
# # example path: ~/.config/codex/mcp.json
```

Pour appliquer directement (avec merge non destructif des autres serveurs MCP
déjà présents) :

```bash
h2a host setup --host codex --write ~/.config/codex/mcp.json
# ajouter --root /chemin/projet/.h2a pour épingler le store local du serveur,
# --force pour écraser un mcpServers.h2a divergent déjà présent.
```

### Claude Code

```bash
h2a host setup --host claude --print
# {
#   "mcpServers": {
#     "h2a": {
#       "command": "h2a",
#       "args": ["mcp-serve"]
#     }
#   }
# }
# # claude — paste this snippet under `mcpServers` in:
# # Claude Code reads its MCP config from either ~/.config/claude/mcp.json
# # (user-global) ou un .mcp.json local au workspace racine.
```

Variantes équivalentes :

```bash
# Config user-global
h2a host setup --host claude --write ~/.config/claude/mcp.json

# Config projet, épinglée sur un store .h2a local
h2a host setup --host claude --root "$PWD/.h2a" --write "$PWD/.mcp.json"
```

> Gemini est volontairement refusé (`DEC-028` — wave 2). Le descripteur reste
> visible via `h2a hosts`.

## Pourquoi cet exemple ?

Il joue le rôle de **documentation vivante** et de **smoke test** pour les
trois couches du runtime :

- la couche **artefacts / signatures** de `@sentropic/h2a`
  (`computeHash`, `signCanonical`, journal `prevHash`, quorum) ;
- le runtime **local-files** de `@sentropic/h2a-cli`
  (`createLocalStore`, ouverture / journal / stabilisation) ;
- la couche **MCP** (`runMcpStdio`) accédée comme un client externe le ferait
  via JSON-RPC 2.0 sur stdio.

Le test d'intégration
[`packages/h2a-cli/test/integration-example.test.js`](../../packages/h2a-cli/test/integration-example.test.js)
ré-exécute le script lorsque `H2A_RUN_EXAMPLE=1` est positionné (skip par
défaut pour garder la suite par défaut rapide).

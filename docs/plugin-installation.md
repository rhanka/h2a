# Installer et mettre à jour H2A dans Claude Code et Codex

Claude Code et Codex utilisent **le même marketplace `rhanka/h2a` et le même
plugin Sentropic unique : `h2a@sentropic`**.

Ce plugin fournit :

- un seul serveur MCP nommé `h2a` ;
- les outils de coordination `h2a_*` ;
- les outils Track en lecture seule `track_*` ;
- les skills H2A, Track et Harness.

`track` reste un composant séparé dans le code et son CLI reste responsable des
écritures Track. Ce n'est pas un plugin Claude séparé et ne doit pas être
installé comme un second MCP.

## Installation (une fois)

Claude Code :

```bash
claude plugin marketplace add rhanka/h2a
claude plugin install h2a@sentropic
```

Codex :

```bash
codex plugin marketplace add rhanka/h2a --ref main
codex plugin add h2a@sentropic
```

Codex lit le manifeste `.claude-plugin/marketplace.json` du dépôt : les deux
hôtes partagent donc une seule source de distribution, et le plugin est résolu
par le sélecteur `h2a@sentropic` des deux côtés.

**Ne jamais enregistrer un répertoire de build comme source de marketplace.**
Un marketplace local pointant vers `tmp/deploy-*` disparaît avec le répertoire ;
la source git est la seule qui survive à un déplacement du checkout.

## Mise à jour

Claude Code :

```bash
claude plugin update h2a@sentropic
```

Codex — il n'existe pas de verbe `plugin update` : on rafraîchit l'instantané
git, puis on réinstalle le sélecteur, ce qui installe la version la plus récente
du marketplace et remplace l'entrée de cache précédente.

```bash
codex plugin marketplace upgrade
codex plugin add h2a@sentropic
```

Redémarrer l'hôte après une installation ou mise à jour de plugin.

## État attendu

`/mcp` ou `claude mcp list` doit présenter exactement un endpoint H2A :

```text
plugin:h2a:h2a
```

Selon la version de Claude Code, son libellé peut être affiché différemment ;
le nom du plugin installé doit néanmoins rester `h2a@sentropic`.

Côté Codex, `codex plugin list` doit présenter exactement un plugin H2A —
`h2a@sentropic  installed, enabled` — et `codex plugin marketplace list` doit
répondre sans erreur. Un `marketplace root does not contain a supported
manifest` signifie qu'une source configurée a disparu : tant qu'elle est
présente, **plus aucun** plugin ne peut être listé, installé ni mis à jour, et
le plugin continue de tourner depuis son cache figé.

Ne pas ajouter manuellement `h2a mcp-serve` en plus du plugin. Ne pas installer
ni configurer `track-mcp` ou `h2a track-mcp` : les outils `track_*` sont déjà
servis par le MCP `h2a`.

## Migration d'une ancienne installation

Les installations historiques peuvent avoir des plugins locaux avec des noms
versionnés, par exemple `h2a-local-claude-08518@sentropic-local-claude-08518`,
ou un MCP Track séparé. Désinstaller seulement ces anciens plugins Sentropic,
puis installer le plugin canonique :

```bash
claude plugin uninstall h2a-local-claude-08518@sentropic-local-claude-08518
claude plugin install h2a@sentropic
```

Côté Codex, la même migration retire le plugin versionné **et** le marketplace
local qui le portait, avant de repasser sur la source git :

```bash
codex plugin remove h2a-local-codex-08518@sentropic-local-codex-08518
codex plugin marketplace remove sentropic-local-codex-08518
codex plugin marketplace add rhanka/h2a --ref main
codex plugin add h2a@sentropic
```

`h2a` converge automatiquement les entrées MCP H2A/Track **configurées dans les
fichiers hôte** lors de l'installation et du démarrage. Il ne désinstalle jamais
silencieusement un plugin Claude : Claude Code conserve cette autorité.

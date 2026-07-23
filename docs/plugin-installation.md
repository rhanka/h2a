# Installer et mettre à jour H2A dans Claude Code

Claude Code utilise **un seul plugin Sentropic : `h2a@sentropic`**.

Ce plugin fournit :

- un seul serveur MCP nommé `h2a` ;
- les outils de coordination `h2a_*` ;
- les outils Track en lecture seule `track_*` ;
- les skills H2A, Track et Harness.

`track` reste un composant séparé dans le code et son CLI reste responsable des
écritures Track. Ce n'est pas un plugin Claude séparé et ne doit pas être
installé comme un second MCP.

## Installation (une fois)

```bash
claude plugin marketplace add rhanka/h2a
claude plugin install h2a@sentropic
```

## Mise à jour

```bash
claude plugin update h2a@sentropic
```

Redémarrer Claude Code après une installation ou mise à jour de plugin.

## État attendu

`/mcp` ou `claude mcp list` doit présenter exactement un endpoint H2A :

```text
plugin:h2a:h2a
```

Selon la version de Claude Code, son libellé peut être affiché différemment ;
le nom du plugin installé doit néanmoins rester `h2a@sentropic`.

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

`h2a` converge automatiquement les entrées MCP H2A/Track **configurées dans les
fichiers hôte** lors de l'installation et du démarrage. Il ne désinstalle jamais
silencieusement un plugin Claude : Claude Code conserve cette autorité.

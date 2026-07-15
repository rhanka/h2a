# Golden-fixtures — surface publique gelée (baseline migration P1)

Baseline du **contrat public** capturée le 2026-06-29 (P1 de la migration track+remote, cf `../../specs/2026-06-29-h2a-migration-track-remote.md`).

## Fichiers
- **`mcp-tools.json`** — les 37 outils MCP `h2a_*` exposés sur le bus local (surface du bus, dont le mutateur local-only `h2a_run`). Source : `h2a mcp-tools` (trié).
- **`cli-verbs.json`** — les 90 verbes dispatchables de la CLI. Source : `H2A_CLI_VERB_CONTRACTS` (`packages/h2a-cli/src/cli-contract.ts`, trié).

## Usage (P2 — à câbler en CI)
Régénérer et **diff = échec sans bump de version explicite** :
```sh
diff <(h2a mcp-tools | jq 'sort') docs/contracts/golden/mcp-tools.json   # surface bus
node -e '…H2A_CLI_VERB_CONTRACTS…' | diff - docs/contracts/golden/cli-verbs.json  # verbes CLI
```
Tout ajout/retrait/rename d'outil MCP ou de verbe = changement de contrat public ⇒ revue + version.

## À venir (P1 reste)
Golden d'**enveloppes réelles** (trafic MCP rejoué) : presence, inbox put/read, negotiate open/sign/stabilize — capture nécessitant le serveur MCP live (P1 suite). La surface (noms) est gelée ici ; les schémas d'I/O et les enveloppes suivent.

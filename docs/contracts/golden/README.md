# Golden-fixtures — surface publique gelée (baseline migration P1)

Baseline du **contrat public** capturée le 2026-06-29 (P1 de la migration track+remote, cf `../../specs/2026-06-29-h2a-migration-track-remote.md`).

## Fichiers
- **`mcp-tools.json`** — les 37 outils MCP `h2a_*` exposés sur le bus local (surface du bus, dont le mutateur local-only `h2a_run`). Source : `h2a mcp-tools` (trié).
- **`cli-verbs.json`** — les 99 verbes dispatchables de la CLI. Source : `H2A_CLI_VERB_CONTRACTS` (`packages/h2a/src/cli-contract.ts`, trié). Le compte annoncé ici était resté à 90 alors que le contrat en portait 97 ; il suit maintenant les deux ajouts qui ont suivi : `keys prove-control` (PR #30, 97 → 98) puis `explain` (98 → 99). Le chemin cité pointait sur `packages/h2a-cli/`, qui est un stub déprécié.

### Les comptes annoncés sont gardés (2026-07-25)

Le nombre de verbes écrit à la main ci-dessus **et** `compat.cliVerbs` dans
`version-matrix.json` sont désormais vérifiés contre `len(cli-verbs.json)` par le test
« the announced CLI verb counts match the golden fixture »
(`packages/h2a/test/cli-command-map.test.js`). Avant ce garde, les deux nombres
pouvaient devenir faux en silence : `scripts/check-public-contract.sh` calcule son
propre compte dynamiquement et **ne lit aucun des deux fichiers**.

Le garde est posé au rang **test** et non dans le script shell, délibérément : le job
contrat de `ci.yml` est déjà rouge sur `main` pour une raison sans rapport (16 outils
`track_*` absents du golden MCP), et une garde déjà rouge ne peut plus rien attraper de
neuf. Conséquence pratique : **si vous ajoutez ou retirez un verbe, les trois artefacts
bougent ensemble ou la suite casse** — y compris lors d'un merge où `cli-verbs.json` se
résout proprement pendant que ces deux nombres, eux, ne se résolvent pas.

Ce cas exact s'est produit le 2026-07-25 : la PR #30 (`keys prove-control`) et la PR #37
(`explain`) ajoutaient chacune un verbe. Au rebase de #37 sur #30, `cli-verbs.json`,
`H2A_CLI_VERB_CONTRACTS` et le tableau `expected` ont fusionné proprement à 99, tandis
que ces deux nombres écrits à la main sont restés à 98 — et c'est le garde, pas une
relecture, qui l'a signalé.

## Usage (P2 — à câbler en CI)
Régénérer et **diff = échec sans bump de version explicite** :
```sh
diff <(h2a mcp-tools | jq 'sort') docs/contracts/golden/mcp-tools.json   # surface bus
node -e '…H2A_CLI_VERB_CONTRACTS…' | diff - docs/contracts/golden/cli-verbs.json  # verbes CLI
```
Tout ajout/retrait/rename d'outil MCP ou de verbe = changement de contrat public ⇒ revue + version.

## À venir (P1 reste)
Golden d'**enveloppes réelles** (trafic MCP rejoué) : presence, inbox put/read, negotiate open/sign/stabilize — capture nécessitant le serveur MCP live (P1 suite). La surface (noms) est gelée ici ; les schémas d'I/O et les enveloppes suivent.

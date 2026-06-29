# h2a — Contrat public GELÉ v1 (baseline migration)

Status: CONTRAT GELÉ (P1 de la migration track+remote). Date: 2026-06-29.
Toute évolution de ce contrat = **décision irréversible-produit** (réservée à Fabien). Tout diff sur ces surfaces doit échouer la CI sans bump de version explicite.

## 1. Clé de bus
- Clé du workspace bus = **`"h2a"`** (NE CHANGE PAS sans décision produit + plan de migration de données).
- Root par défaut : `~/h2a-workspace/.h2a` (+ override `H2A_ROOT` / `--root`).

## 2. Enveloppe / protocole (lib FEUILLE neutre — anti-cycle)
- L'enveloppe signée et le protocole de négociation sont la **feuille** consommée par cli + runtime + libs. Aucune dépendance retour vers `h2a-cli`/runtime.
- Wake/drive : ligne signée `[h2a from=… to=… nonce=… at=… sig=…] <instruction>` (runtime/drive/index.ts) — format stable.
- Ping : envelope `h2a.ping`.

## 3. Surface CLI (contrat figé)
- Contrat machine : `packages/h2a-cli/src/cli-contract.ts` (`H2A_CLI_VERB_CONTRACTS`, 90 verbes dispatchables).
- Mapping cible figé **255 → h2a** : `docs/focus/h2a-mapping.html` + `docs/specs/2026-06-28-h2a-command-mapping-v6.md` (généré par `docs/focus/gen-mapping.py`).
- Modèle : 5 finalités (Coordinate/Run/Track/Admin/Extend) ; 3 packages (`@sentropic/h2a`, `@sentropic/h2a-cli`, `@sentropic/track`) + libs consommées.
- Grammaire actée : pas de namespaces fourre-tout (`host`/`sub` dissous → verbes globaux + options) ; lancement `h2a run <cli> [--options]` ; agent natif `h2a` (bare, interactif) ; `h2a --resume`.

## 4. Codes de sortie
- Politique DEC-054 : hard checks (rootExists, schemaSentinel, liveSessions, cliBinary) → **exit 2** ; soft checks → `warnings[]` sans flipper `ok`.
- À compléter en P2 : table exhaustive exit-codes par commande (contract-tests).

## 5. Sortie machine (DEC-034 machine-first)
- Pas de flip `--json` : sortie machine-first par défaut sur les commandes d'état (formats JSON stables = contrat).

## 6. Politique de dépréciation
- Binaires `remote` et `track` → **shim transitoire** déléguant à `h2a …` + alias maintenus ; warning doux **après** stabilité mesurée ; retrait **seulement** après matrice de compat verte + **décision humaine** (fenêtre explicite).
- `stp` : déprécié immédiat (0 caller prouvé, ADR BR-42).

## 7. Garanties live-bus (gatées par smoke à chaque release)
- Un agent connecté via MCP peut `send`/`receive` sans rupture ; les sessions remote en cours (Pods) sont **intouchées** ; anciens `remote` et nouveaux `h2a` listent/attachent/reprennent les **mêmes** sessions.

Baseline gelée. P1 suivant : capture des **golden-fixtures du bus** (trafic MCP réel rejoué en CI).

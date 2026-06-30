# P3-prep — façade `h2a` → `@sentropic/track` (design réversible)

Status: DESIGN (P3-prep, réversible). Date: 2026-06-29. WP-MIG / P3.
Principe (consensus) : la façade h2a est une **délégation THIN** vers la lib track. **record-only préservé** (append-only, pas de rewrite) ; toute écriture h2a passe par l'API track. La façade n'ajoute QUE le pont bus↔décision (lier une décision à une négociation/dossier h2a).

## Mapping verbe h2a → commande track (1:1, pass-through)
| Surface h2a (cible mapping) | Délègue à (track CLI/lib) | Note |
|---|---|---|
| `h2a decision new` | `track decision new` | kind orientation\|commitment, targets, accountable |
| `h2a decision outcome` | `track decision outcome <id> go\|no-go\|deferred` | |
| `h2a decision dossier` | `track decision dossier <id> --context` | |
| `h2a decision disposition` | `track decision disposition` | |
| `h2a decision add-artifact` | `track decision add-artifact --kind h2a-decision-dossier --negotiation-ref …` | **seul ajout façade** : pont négo h2a → décision track |
| `h2a report` | `track report [--decisions] [--wp\|--flat] [--level] [--require-accepted]` | |
| `h2a query` | `track query [--role] [--bucket] [--realization]` | |
| `h2a item …` | `track item new\|ls\|show\|spec\|realize\|reparent\|scope-declare\|spec-amend` | |
| `h2a accept …` | `track accept criterion\|link\|run\|waive` | |
| `h2a blocker …` | `track blocker raise\|resolve\|resolve-external` | |
| `h2a consolidate` | `track consolidate --items --commit` | |
| `h2a priority` | `track priority assess` | |
| `h2a activity` | `track workspace-activity` | |

## Delta re-sync 2026-06-29 (track 0.24.0 — Lot A/B LOCKED ; évol finalisée)
Nouvelles commandes track à ajouter à la façade (pass-through) :
| Surface h2a (cible) | Délègue à (track 0.24.0) | Note |
|---|---|---|
| `h2a item assign-code` | `track item assign-code` | codes WP stables (A1 track) |
| `h2a report --active-roster` | `track report --active-roster` | exclusion WP terminaux (A3) |
| `h2a branch` | `track branch` | provenance de branche |
| `h2a focus` | `track focus` | curseur/focus |
| `h2a ingest` | `track ingest` | ingestion graphe |
| `h2a restructure` | `track restructure` | restructuration WP |
| `h2a scope` · `h2a validate` · `h2a audit` | `track scope` · `validate` · `audit` | |
| *(interne)* | `track events-contains` | ⚙ gate anti-perte de merge (plumbing, pas façade user) |

Le mapping reste **1:1 pass-through** ; la façade ne réinterprète rien. `events-contains` = plumbing (cf skill branch-lifecycle), hors surface user. Le contrat de façade est re-synchronisé sur track 0.24.0.

## Invariants (vérifiables, P4)
1. **Pass-through strict** : la façade ne réinterprète pas les arguments métier ; elle route. Exit codes/format JSON de track = inchangés (contrat).
2. **record-only** : aucune commande façade n'écrit en dehors de l'API track ; pas de shadow-store h2a (cf piège « merge track record-only »).
3. **Pont bus** : le seul enrichissement = `add-artifact --kind h2a-decision-dossier` reliant une décision track à une négociation h2a (`--negotiation-ref`) — déjà supporté par track, donc zéro nouvelle sémantique de stockage.
4. **Module** : la façade vit dans `@sentropic/h2a-cli` (UX/routing) ; la logique reste dans `@sentropic/track` (lib consommée). Pas de cycle (track ne dépend pas de h2a-cli).

## Mécanisme de délégation — FIGÉ (2026-06-29)
Décidé d'après le contrat track (skill track-operation) : **`.track` = append-only single-writer ; les écritures DOIVENT passer par la CLI `track`** (jamais un 2ᵉ writer concurrent). Donc :
- **Délégation = shell-out vers le bin `track`** (spawn `track <verbe> <args…>`, passthrough stdout/stderr/exit-code). Pas d'import de la lib pour les écritures (préserve le single-writer + les codes de sortie/format JSON = contrat inchangé).
- **Dépendance** : `@sentropic/h2a` déclare **`@sentropic/track@^0.24.0`** (publié sur npm ✓) → le bin `track` est dispo via `node_modules/.bin` à l'install. Pas de cycle (track ne dépend pas de h2a).
- **Verbes spécifiques** (pas de namespace `track`, dissous comme host/sub) : `h2a decision|report|accept|blocker|item|query|consolidate|priority|branch|focus|ingest|restructure` → `track <même verbe>`.
- **Reads** : mêmes verbes via la CLI track (uniforme) ; le MCP track read-only reste pour les agents.
- **Install story** : `npm i -g @sentropic/h2a` tire `@sentropic/track` → `h2a decision` marche sans install séparée.

Implémentation (prochain cycle) : helper `delegateToTrack(argv)` dans la CLI + câblage des verbes + un test passthrough (`h2a report` ⇒ `track report`). Réversible, testable, pas de republish track (track est déjà publié et re-owné — P3 « republish » est donc DÉJÀ satisfait côté npm).

## Réversibilité
Pur design + routing. Le **republish `@sentropic/track` re-owné** et le **shim binaire `track`** sont P3 exécution = décisions irréversibles-produit (réservées Fabien). Ici on ne fait que figer le contrat de façade.

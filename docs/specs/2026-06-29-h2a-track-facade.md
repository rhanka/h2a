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

## Invariants (vérifiables, P4)
1. **Pass-through strict** : la façade ne réinterprète pas les arguments métier ; elle route. Exit codes/format JSON de track = inchangés (contrat).
2. **record-only** : aucune commande façade n'écrit en dehors de l'API track ; pas de shadow-store h2a (cf piège « merge track record-only »).
3. **Pont bus** : le seul enrichissement = `add-artifact --kind h2a-decision-dossier` reliant une décision track à une négociation h2a (`--negotiation-ref`) — déjà supporté par track, donc zéro nouvelle sémantique de stockage.
4. **Module** : la façade vit dans `@sentropic/h2a-cli` (UX/routing) ; la logique reste dans `@sentropic/track` (lib consommée). Pas de cycle (track ne dépend pas de h2a-cli).

## Réversibilité
Pur design + routing. Le **republish `@sentropic/track` re-owné** et le **shim binaire `track`** sont P3 exécution = décisions irréversibles-produit (réservées Fabien). Ici on ne fait que figer le contrat de façade.

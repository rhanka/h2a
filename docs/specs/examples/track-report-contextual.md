# TRACK REPORT — h2a

> Historical illustration only — not an executable procedure and not a current factual report. It predates
> the deterministic conductor, its reconciled HORS ROLLUP total, required `track focus --workspace`, and
> the rule that model/effort must come from owner context. Follow
> `packages/h2a/skills/harness/track-report/SKILL.md` instead.

*baseline `5fa272e` · 54/84 (64%) · DONE 57 · TO-DO 29 · AWAITED 5 · DROPPED 2*

## FAIT

| scope | avancement | dernières actions |
|---|---|---|
| **global** | 54/84 (64%) | 15 PR mergées · release 0.86.0 publiée et installée · file 22 → 4 |
| WP1 · Protocol | 1/2 (50%) | Miroir sanitisé émission **et** ingestion, définition unique partagée |
| WP2 · Addressing | 11/14 (79%) | Titre natif dans la présence · restore élimine les sessions mortes |
| WP5 · Runtime | 6/7 (86%) | **tmux véridique livré** : `remote-` éradiqué, `?` sur l'invérifiable |
| WP7 · Infra | 4/9 (44%) | Golden MCP réconcilié 37 → 52 |
| WP8 · Tracking | 2/3 (67%) | Rapport track réparé : l'erreur avalée remonte avec code et stderr |
| WP9 · Harness | 2/3 (67%) | `npm test` remesure après 12 merges à zéro · sécurité 3 hautes → 0 |
| WP10 · Distribution | 8/9 (89%) | 0.86.0 publiée, tarball vérifié · aide CLI par intention |
| WP11 · Memory | 0/1 (0%) | Fusion mémoire mergée : D1–D13, notes verbatim, ouvertes préservées |

## À-FAIRE

*ordre = priorité ; les premières lignes sont le focus courant*

| WP | av. | à faire | bloqué | prochaine action |
|---|---|---|---|---|
| **WP13** · CLI native | 0% | Lancer notre propre CLI, conçue avec l'architecte | **D7** | Récupérer la conception, spécifier l'incrément 1 — *sol xhigh* |
| **WP12** · Registry MCP | 0% | Enregistrer les connecteurs (gmail…) aux CLIs | **D1–D5** | Route MCP publique + vrai fournisseur — *terra xhigh* |
| **WP11** · Mémoire agents | 0% | Contexte pérenne multi-session / multi-CLI | **D6** | Implémenter sans trancher les questions ouvertes — *terra xhigh* |
| **WP10** · h2a ↔ sentropic | 89% | Focus multi-projet, remote control, UAT proxy | — | Livrer la lecture, échelle d'autorité déjà specée — *terra xhigh* |
| **WP5** · tmux | 86% | — | — | **Livré** (#53) · reste à vérifier chez l'owner |
| WP1 · Protocol | 50% | Le réveil part alors que l'écriture a échoué | — | Réveil inatteignable sans reçu d'écriture |
| WP2 · Addressing | 79% | Restore relance des agents jamais human-facing | — | Classer à l'enrôlement, fail-closed au restore |
| WP5 · Runtime | 86% | `h2a run` accepte un modèle injoignable | — | Préflight contre `/v1/models` |
| WP8 · Tracking | 67% | Restructuration WP tranchée, non appliquée | — | Créer WP Intégration, rétrograder WP12→18 |
| WP18 · Parité | 0% | 8 items, rien commencé | — | Écrire le contrat de capacité seul |
| WP3 · Coordination | 83% | Réveil par hôte dans chaque plugin | **D1–D5** | — |
| WP7 · Infra | 44% | Proxy subagents gateway/Claude cassé | — | Diagnostiquer avant de corriger |
| WP9 · Harness | 67% | Worktrees `/tmp` encore autorisés | — | Garde + migration des recettes |
| WP4 · Governance | 63% | EVO-9 valeur / attention / mutualisation | — | À spécifier |
| WP6 · Identity | 80% | Contrôles NHI depuis `nhi.md` | — | À spécifier |

## DÉCISIONS

*Même donnée que `track focus`, rendue inline. Un tableau Markdown ne peut pas
contenir de saut de ligne : le tableau est donc DESSINÉ, comme le fait
`formatWpConductor`.*

```
┌────┬──────────────────────────────────┬─────────────────────────────────────────────┬───────┐
│ #  │ sujet                            │ alternatives                                │ préco │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D1 │ Un nom seul peut-il commander ?  │ A  Jamais : (racine, instance) résolue      │       │
│    │                                  │    et vivante                               │   A   │
│    │                                  │ B  Oui si la résolution est unique          │       │
│    │                                  │ C  Oui, avec confirmation si ambigu         │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D2 │ Un nom supprimé est-il           │ A  Jamais, le nom est brûlé                 │       │
│    │ réutilisable ?                   │ B  Après quarantaine de 24 h                │   B   │
│    │                                  │ C  Immédiatement — statu quo                │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D3 │ Plusieurs sessions               │ A  Refuser                                  │ A écr │
│    │ correspondent ?                  │ B  Lister et demander                       │ B lir │
│    │                                  │ C  Prendre la plus récente                  │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D4 │ Preuve avant                     │ A  Heartbeat seul — statu quo               │       │
│    │ « agent disponible » ?           │ B  Heartbeat + activité MCP récente         │   B   │
│    │                                  │ C  Aller-retour réel avant de déclarer      │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D5 │ Écrire dans un terminal          │ A  Refuser                                  │       │
│    │ ambigu ?                         │ B  Écrire au plus probable                  │   A   │
│    │                                  │ C  Demander                                 │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D6 │ Comment lance-t-on le            │ A  Processus local piloté par h2a           │       │
│    │ moteur natif ?                   │ B  Orchestré par sentropic                  │   A   │
│    │                                  │ C  Les deux, par configuration              │       │
├────┼──────────────────────────────────┼─────────────────────────────────────────────┼───────┤
│ D7 │ CLI native : quelle étude        │ A  18/07 — agent natif + moteur de session  │       │
│    │ fait foi ?                       │ B  17/07 — surface CLI et couture           │   A   │
│    │                                  │ C  Les fusionner                            │       │
└────┴──────────────────────────────────┴─────────────────────────────────────────────┴───────┘
```

## RECOMMANDATION

**Sans décision** : lancer **WP10** — le seul objectif du focus bloqué par rien,
à 89 %, spec d'autorité déjà écrite. Une lane *terra xhigh*.

**`D1 A · D2 B · D3 A · D4 B · D5 A`** → débloque WP12 et WP3 : *sol xhigh*
transforme les réponses en spec, *terra xhigh* implémente le courtier.
**`D6 A`** → débloque WP11 : une lane *terra xhigh*.
**`D7 A`** → débloque WP13 : une lane *sol xhigh*.

Réponse attendue : `vas y` (WP10 seul) ou `D1 A · D2 B · D3 A · D4 B · D5 A · D6 A · D7 A`.

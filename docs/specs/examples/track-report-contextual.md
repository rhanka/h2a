# TRACK REPORT — deterministic golden, no contextual conclusion

This is a reproducible golden for the fixed deterministic conductor, not an
agent-written recommendation. Its sole source is
[`track-report-raw.txt`](track-report-raw.txt): commit
`9b4efbcc039ac5f393cf1d35c51c3b2d9452f0d5`, event window `#1..#568`, folded
through cursor `count:568`.

Reproduce from the fixed Track tree by materializing the exact committed log
(the 568-event window is the entire `.track/events.jsonl` blob at that commit)
into an otherwise empty scratch `.track` directory, then point the read-only
command at it:

```sh
golden_track_dir="$(mktemp -d)"
git show 9b4efbcc039ac5f393cf1d35c51c3b2d9452f0d5:.track/events.jsonl > "$golden_track_dir/events.jsonl"
TRACK_DIR="$golden_track_dir" node packages/track/dist/cli/bin.js report --format text --decisions --commit 9b4efbcc039ac5f393cf1d35c51c3b2d9452f0d5
```

`--commit` selects the report baseline; `TRACK_DIR` pins the log. Both are
necessary. Run this after building the fixed Track tree. The report command is a
read and does not alter the materialized fixture.

## WP roster

Every row below is copied from the raw fixture; no priority order or recent-work
claim is inferred.

| label | title | done/active | pct |
|---|---|---:|---:|
| S1 | WP-C Keepalive, presence & infra | 0/0 | n/a |
| S2 | WP-E EVO roadmap | 0/0 | n/a |
| S3 | WP-MIG Migration track+remote → h2a (CLI unique) | 1/1 | 100 |
| WP1 | Protocol & envelopes | 1/1 | 100 |
| WP2 | Addressing & presence | 11/14 | 79 |
| WP3 | Coordination & loop | 10/12 | 83 |
| WP4 | Governance & RACI | 5/8 | 63 |
| WP5 | Execution & runtime | 6/7 | 86 |
| WP6 | Identity, auth & NHI | 4/5 | 80 |
| WP7 | Infra, deploy & MCP | 4/9 | 44 |
| WP8 | Tracking & record | 2/2 | 100 |
| WP9 | Method & harness | 2/4 | 50 |
| WP10 | Distribution, CLI & packaging | 8/9 | 89 |
| WP11 | Memory & context | 0/1 | 0 |
| S4 | Passerelle LLM : permettre à Hermes (et tout hôte) d'en profiter | 0/0 | n/a |
| WP14 | Spec EVO-4b: unified local decision cockpit (double-consensus GO) | 0/0 | n/a |
| WP15 | Spec: h2a<->sentropic enrollment (design + dossier, double-consensus GO) | 0/0 | n/a |
| WP12 | MCP connector brokering & sharing — h2a as connector hub | 0/1 | 0 |
| WP13 | Native h2a agent runtime via sentropic | 0/1 | 0 |
| WP16 | Native-plugin control plane | 0/0 | n/a |
| WP17 | tmux status surface | 0/0 | n/a |
| WP18 | Host operator capability parity & gap governance | 0/7 | 0 |

## Decision presentation

The native record has no options or recommendation for any of these rows. The
golden therefore renders no decision alternatives and makes no selection claim.

| renderer section | IDs | source fact |
|---|---|---|
| À INSTRUIRE | `01KY65RNV7GWCXV787PJW5FYQ1`, `01KY66FTP7Y4W214SADDWKHT15`, `01KY66FV4W1JKHBZ2MW44P9EP6`, `01KY66FVKFFVKRDXY9PFGEF4RD`, `01KY66FW260Q5TV1DVR6ZPH891`, `01KY66FWJ4MYNJMDDJXA54G3FD`, `01KY66FX0PFH958103YVQWRBQZ`, `01KY66T2F35VNZP6FHFAVVBGH0` | pending; native options `0`; native recommendation absent |
| HISTORIQUE NON STRUCTURÉ | `01KTSDXPY1F0S3PZSXHM9T2WJA`, `01KTSDXX77YGH3KGW3TN5ED1EM`, `01KWAVZZ1NB0DKQQ0AP1BFHJQM`, `01KWAW375CPJ9FDTZPNKVA37DT`, `01KWB13M2FZ9QE88GRT6BNTT7P`, `01KXC2PNENYM96ZFC3FJNEACVC` | historical `go`; native options `0`; no selected option attested |
| HISTORIQUE NON STRUCTURÉ | `01KTT31B9KWF68E0NSQDJRYJ1Q` | historical `deferred`; native options `0`; no selected option attested |

### Focus-source captures

The eight blocks below are copied verbatim from `FOCUS PROSE CAPTURES` in the
companion raw fixture, keyed by the same decision IDs. They are real Focus
source material, not native `Option[]` records: no block is selectable and none
attests a durable settlement. An authenticated author must first revise the
dossier into native options and a recommendation before `track decision select`
can settle it. The captures therefore preserve the owner's actual choices
without turning prose into an invented decision record.

#### `01KY65RNV7GWCXV787PJW5FYQ1`

```text
Décision produit requise avant les prochains lots parallèles. Problème observé : un nom tmux, un PID ou une présence MCP peuvent rester visibles alors que l’agent est terminé, remplacé ou occupé par un humain. Choix A (recommandé) : priorité à la sécurité — un alias sert d’abord à retrouver/afficher une session ; si H2A ne peut pas prouver une cible unique et disponible, il n’envoie rien et explique pourquoi. Choix B : priorité à la fluidité — H2A choisit automatiquement la session la plus récente et peut la réveiller. Choix C : intermédiaire — H2A propose la cible choisie et attend une confirmation humaine avant l’envoi. Conséquences : A évite les commandes au mauvais terminal mais demande parfois une étape explicite ; B est plus rapide mais peut perturber une session humaine ou une nouvelle session homonyme ; C est sûr mais ajoute une interaction. Cette décision fixe aussi la base des tracks adressage, liveness et tmux. Le moteur natif restera une fondation interne, sans remplacer h2a run, tant que cette sécurité n’est pas prouvée.
```

#### `01KY66FTP7Y4W214SADDWKHT15`

```text
Choix A : le nom sert seulement à retrouver et afficher une session ; H2A demande ensuite une cible vérifiée. Choix B : le nom peut envoyer directement une commande. Recommandation : A — un nom peut être réutilisé ou ambigu. Effet : débloque le lot adressage sûr.
```

#### `01KY66FV4W1JKHBZ2MW44P9EP6`

```text
Choix A : non par défaut ; H2A garde une trace et demande une réattribution explicite. Choix B : oui immédiatement. Recommandation : A — évite qu’un ancien lien pointe silencieusement vers une nouvelle session. Effet : fixe la conservation des noms et l’historique.
```

#### `01KY66FVKFFVKRDXY9PFGEF4RD`

```text
Choix A : il refuse d’agir et affiche les candidates. Choix B : il choisit automatiquement la plus récente. Choix C : il envoie à toutes. Recommandation : A — ni la date ni le nom ne prouvent la bonne cible. Effet : débloque l’adressage multi-session et le wake.
```

#### `01KY66FW260Q5TV1DVR6ZPH891`

```text
Choix A : une fenêtre tmux visible suffit. Choix B : un processus vivant suffit. Choix C : l’agent doit confirmer qu’il peut recevoir l’instruction. Recommandation : C — fenêtre et processus peuvent survivre après la fin de l’agent. Effet : fixe le statut liveness.
```

#### `01KY66FWJ4MYNJMDDJXA54G3FD`

```text
Choix A : non ; si le terminal peut être humain ou incertain, H2A ne frappe rien. Choix B : oui après confirmation humaine. Choix C : oui automatiquement. Recommandation : A — protège le travail humain ; une confirmation peut venir dans un lot ultérieur. Effet : fixe la sécurité de wake tmux.
```

#### `01KY66FX0PFH958103YVQWRBQZ`

```text
Choix A : construire d’abord le moteur en parallèle, sans modifier h2a run actuel, puis proposer un pilote. Choix B : remplacer progressivement h2a run dès le premier lot. Choix C : remplacer tmux immédiatement. Recommandation : A — permet de prouver la reprise après crash et la sécurité avant bascule. Effet : fixe le plan du moteur natif.
```

#### `01KY66T2F35VNZP6FHFAVVBGH0`

```text
Constat : le report Focus est fait pour suivre le travail, pas pour faire trancher une question. Le détour actuel (créer une décision Track, l’afficher dans le report, injecter une CLI) masque les options et crée du bruit. Proposition recommandée : ajouter une voie directe et stable « décision dossier » : création avec un schéma structuré (contexte, question, options, recommandation, impacts), URL dédiée, lecture centrée sur le dossier, choix humain durable/audité quand ce sera implémenté ; le report Track reste inchangé. Alternative : continuer à enrichir les cartes du report. Cette décision ne tranche pas les six choix de sessions ; elle tranche le produit Focus qui doit les présenter.
```

No session window, priority ordering, model/lane assignment, PR count, release,
or file-count assertion was supplied by the fixture. This golden makes none.

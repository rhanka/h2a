# F — surface CLI/auto commune et activation M18

Référence : spec §§8.9–8.10, U01/U02/U05/U06/U08, critères M18. La surface
`upgrade` (manuelle et automatique partagent la lecture) expose le statut
lisible, les codes d'erreur communs avec `--strict`, la reprise sur
diagnostics, l'abandon avec compensation, l'autorité inter-transactions, et
l'activation .7 seulement après la preuve H4 externe vérifiée de fermeture
maintenue des admissions héritées.

## F-1 — rapport `upgrade status` commun (livré)

`composeUpgradeStatus({ store, upgradeId })` dans
`packages/h2a/src/runtime/upgrade/status-report.js` : versions préparées
(intention), sélection durable (journal, provenance vérifiée miroir du
moteur — sélection étrangère refusée), chargées, identité et génération
observées, phase, activation (`unchanged` avant sélection, `failed` après
abandon, `completed` terminal, `deferred` dès qu'un verdict d'exclusion
non clôturé est enregistré, `unknown` sinon) et raison. L'inconnu reste
inconnu (null, jamais inventé). Lecture seule : rien forgé, arrêté, publié
ni muté.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-status.test.js final-F-1` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs status` (report, terminal, défaut, provenance, motif) | 5 rouges ERR_ASSERTION / 5 verts | 5 / 5 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Le test a prouvé une impossibilité : le moteur n'autorise qu'une
transaction vivante, donc préparé≠sélectionné est inatteignable en un seul
store — remplacé par le refus de sélection étrangère (garde miroir tuée).
Rouge initial : compositeur absent (`ERR_ASSERTION`, 1 test, exit 1),
conservé. Audit : `node scripts/mh-l6-f1-audit.mjs
/tmp/mh-l3-qualification-f1-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 5 paires/profil. Preuve :
`proof-F-1.json`.

| NOT covered restant | Gate |
|---|---|
| Codes/strict/reprise/abandon/compensation CLI, autorité inter-transactions, orchestration de la délégation, activation M18 après preuve externe | F-2b ; le rapport et le pilote seuls n'activent rien |
| Observateurs B2-3, npm réel D-2b, autres entrées, smoke CI, gel .6 | B2-3/D-2b/E2b3/E3b2b/E3c, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## F-2a — pilote de passe unique sans parsing CLI (livré)

`runUpgradeOnce({ session, store, upgradeId, target, launcherSource,
managedDir, commandPath, exclusion, management, explicit })` dans
`packages/h2a/src/runtime/upgrade/upgrade-run.js` : honore l'opt-out
(marqueur lu sauf `management` fourni, contourné seulement par
`explicit`), évalue le besoin, puis exécute l'adoption et propage le
report d'exclusion. Sans parsing de flags ni processus fils : le CLI
branchera cette passe unique.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-upgrade-run.test.js final-F-2a` | 6/6, exit 0 | 6/6, exit 0 |
| `mh-l6-mutate.mjs upgrade-run` (opt-out, rapport, exécution, exclusion) | 4 rouges ERR_ASSERTION / 4 verts | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : pilote absent (`ERR_ASSERTION`, 1 test, exit 1),
conservé. Garde d'enveloppe nulle ajoutée comme sur les autres modules.
Audit : `node scripts/mh-l6-f2-audit.mjs
/tmp/mh-l3-qualification-f2-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 4 paires/profil. Preuve :
`proof-F-2a.json`.

| NOT covered restant | Gate |
|---|---|
| Parsing CLI, codes/strict/reprise/abandon/compensation, orchestration de la délégation, activation M18 | F-2c |
| Observateurs B2-3, npm réel D-2b, autres entrées, smoke CI, gel .6 | B2-3/D-2b/E2b3/E3b2b/E3c, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## F-2b — autorité inter-transactions (livré)

`assertUpgradeAuthority({ store, upgradeId, controller })` dans
`packages/h2a/src/runtime/upgrade/upgrade-authority.js` : le contrôleur
présenté (défaut : identité courante) doit être le contrôleur lié ACTIF
de la transaction — miroir de la garde moteur, avec une raison CLI
distincte pour l'étranger (`upgrade_authority_foreign`) et la révocation
de référence moteur (`upgrade_authority_revoked`, mise en scène par une
vraie délégation). Lecture seule : ne lie rien, ne forge rien.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-authority.test.js final-F-2b` | 5/5, exit 0 | 5/5, exit 0 |
| `mh-l6-mutate.mjs authority` (discordance, révocation, époque, motif) | 4 rouges ERR_ASSERTION / 4 verts | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : garde absente (`ERR_ASSERTION`, 1 test, exit 1),
conservé. Audit : `node scripts/mh-l6-f2b-audit.mjs
/tmp/mh-l3-qualification-f2b-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 5 tests et 4 paires/profil. Preuve :
`proof-F-2b.json`.

| NOT covered restant | Gate |
|---|---|
| Parsing CLI et codes/strict, reprise/abandon/compensation branchés sur cette autorité, orchestration de la délégation, activation M18 | F-2c |
| Observateurs B2-3, npm réel D-2b, autres entrées, smoke CI, gel .6 | B2-3/D-2b/E2b3/E3b2b/E3c, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## F-2c1 — parsing CLI et codes de sortie (livré)

`parseUpgradeCommand(argv)` dans
`packages/h2a/src/runtime/upgrade/upgrade-cli.js` : la queue argv après
`h2a upgrade` devient une intention gelée (`run`/`check`/`status`/`resume`/
`abort`/`compensate`/`unmanage`/`help`) sans rien exécuter — flags inconnus
ou déplacés, identité manquante, composant inconnu et positionnels en trop
sont des `upgrade_cli_usage`, jamais devinés. `upgradeExitCode(outcome,
{ strict })` applique le contrat 0/1/2 : l'échec réel sort 1 même avec une
sélection réussie (`SUCCESSOR_FAILED`), le report de politique sort 0 sauf
sous `--strict` (2), l'incomplet sans échec sort 2. Enveloppes invalides
refusées (`upgrade_cli_invalid`). Sans dispatch ni processus fils : la
reprise/l'abandon branchés sur l'autorité, la compensation, l'orchestration
de la délégation et l'activation M18 restent F-2c.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-cli.test.js final-F-2c` | 9/9, exit 0 | 9/9, exit 0 |
| `mh-l6-mutate.mjs cli` (flags, identité, composant, codes, strict) | 7 rouges ERR_ASSERTION / 7 verts | 7 / 7 |
| `node scripts/mh-l6-f2c-audit.mjs /tmp/mh-l3-qualification-f2c-*` | exit 0 | exit 0 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : module absent (`ERR_ASSERTION`, 1 test, exit 1),
conservé. Une vraie faute trouvée et corrigée avant vert : la forme `run`
avec flags en tête (`--to …` sans positionnel) était rejetée puis perdait
son premier flag. Audit : 4 fichiers identiques, émission compilée liée
par SHA, 9 tests et 7 paires/profil. Preuve : `proof-F-2c.json`.

| NOT covered restant | Gate |
|---|---|
| Dispatch restant : reprise/abandon sur l'autorité, compensation, orchestration de la délégation, activation M18 après preuve externe | F-2c (suite) |
| Observateurs B2-3, autres entrées, smoke CI, gel .6 | B2-3/E2b3/E3b2b/E3c, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## F-2c2 — reprise/abandon sur l'autorité (livré)

`resumeUpgrade({ store, upgradeId, controller })` et `abortUpgrade(...)`
dans `packages/h2a/src/runtime/upgrade/upgrade-dispatch.js` : l'autorité
CLI est vérifiée d'abord (étranger/révoqué avec raisons propres), puis le
moteur revérifie l'identité courante et réconcilie ou abandonne. La reprise
ne fait jamais avancer une phase d'elle-même (PREPARED reste PREPARED,
SELECTED se referme), l'abandon ne ferme qu'une transaction réversible et
reste idempotent, l'après-sélection refuse `selection_irreversible`.
Sans compensation ni orchestration de la délégation : F-2c (suite).

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-dispatch.test.js final-F-2c2` | 7/7, exit 0 | 7/7, exit 0 |
| `mh-l6-mutate.mjs dispatch` (autorité ×2, appels ×2, enveloppe, gel) | 6 rouges ERR_ASSERTION / 6 verts | 6 / 6 |
| `node scripts/mh-l6-f2c2-audit.mjs /tmp/mh-l3-qualification-f2c2-*` | exit 0 | exit 0 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : module absent (`ERR_ASSERTION`, 1 test, exit 1),
conservé. Preuve d'ordre : sur transaction révoquée le refus est
`upgrade_authority_revoked` (raison CLI), jamais l'erreur moteur.
Audit : 4 fichiers identiques, émission compilée liée par SHA, 7 tests et
6 paires/profil. Preuve : `proof-F-2c2.json`.

| NOT covered restant | Gate |
|---|---|
| Compensation, orchestration de la délégation, activation M18 après preuve externe | F-2c (suite) |
| Observateurs B2-3, autres entrées, smoke CI, gel .6 | B2-3/E2b3/E3b2b/E3c, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

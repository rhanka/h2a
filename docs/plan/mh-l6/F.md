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

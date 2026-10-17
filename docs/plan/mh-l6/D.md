# D — désadoption et comportements npm

Référence : spec §8.7. Le lanceur hors npm implique `EEXIST` possible,
contournement par `--force`, suppression du lien par désinstallation, et
divergences diagnostiquées sans mutation silencieuse de la sélection H4.
`h2a upgrade unmanage` fournit la sortie explicite : sous les verrous
applicables, sans transaction engagée incompatible, restauration
conditionnelle du lien npm original vérifié, conservation des images et
pins des processus vivants, marquage de gestion désactivée (opt-out
jusqu'à adoption manuelle), sans remplacer de paquet ni arrêter de service.

## D-1 — désadoption conditionnelle (livré)

`unmanageInstallation({ store, commandPath, originalTarget, managedDir })`
dans `packages/h2a/src/runtime/upgrade/unmanage.js` : sous verrou
compatible, balaye le journal (transaction non quiescente —
`SELECTED`/`COMPLETED`/`ABORTED` seuls admis — ou journal illisible →
refus typé), exige la cible originale existante
(`unmanage_link_unrestorable`, lien intact), restaure le lien par symlink
tmp + rename vérifié, écrit `unmanaged.json` (tmp + fsync + rename,
`operator_unmanage`) sans toucher images ni pins. La sélection durable
`SELECTED` n'est pas une transaction engagée : elle est conservée, seule
la commande redevient npm.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-unmanage.test.js final-D-1` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs unmanage` (engagée, irrestaurable, marqueur, motif) | 4 rouges ERR_ASSERTION / 4 verts | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : opération absente (`ERR_ASSERTION`, 1 test, exit 1),
conservé comme diagnostic. Mutant `marker-write` recibré (retrait de
l'écriture → crash fsync, non tuable ; retrait de la promotion →
assertion). Verrou propre du module épinglé vert, sans mutant dédié
(son absence ne casse rien en monothread). Audit :
`node scripts/mh-l6-d1-audit.mjs /tmp/mh-l3-qualification-d1-*/source`,
exit 0 ; 4 fichiers identiques, émission compilée liée par SHA, 6 tests
et 4 paires/profil. Preuve : `proof-D-1.json`.

| NOT covered restant | Gate |
|---|---|
| Opt-out automatique (pas de réadoption immédiate), vrais `npm install/force/uninstall/up/down` contre les images, dérives `external_install_detected` en conditions réelles | D-2b/F ; le marqueur seul ne bloque rien sans pilote CLI |
| Observateurs B2-3, autres entrées, smoke CI, gel .6, CLI/auto + activation M18 | B2-3/E2b3/E3b2b/E3c/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## D-2a — bouclage opt-out décisionnel (livré)

`readManagementOptOut(managedDir)` dans `unmanage.js` lit le marqueur
D-1 : absent → non opt-out, présent valide → opt-out avec motif et date,
illisible → opt-out fail-closed (`marker_unreadable`). `assessAdoptionNeed`
accepte `management: { optedOut }` et rend `management_opted_out` avant
toute autre évaluation — aucune adoption automatique tant que le marqueur
subsiste, même sur sélection concordante. Le pilote CLI/auto (F-2)
consommera ce verdict ; l'adoption manuelle explicite reste possible.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `mh-l6-adoption.test.js` final-D-2a (11 + 2 tests) | 13/13, exit 0 | 13/13, exit 0 |
| `mh-l6-unmanage.test.js` final-D-2a (6 + 2 tests) | 8/8, exit 0 | 8/8, exit 0 |
| `mh-l6-mutate.mjs adoption` (8 + 2 paires) + `unmanage` (4 + 2 paires) | 16 rouges / 16 verts | 16 / 16 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouges initiaux : évaluateur puis lecteur absents (`ERR_ASSERTION`, 1 test
chacun, exit 1), conservés. Audit : `node scripts/mh-l6-d2-audit.mjs
/tmp/mh-l3-qualification-d2-*/source`, exit 0 ; 6 fichiers identiques,
deux émissions liées par SHA, 21 tests et 16 paires/profil. Preuve :
`proof-D-2a.json`.

| NOT covered restant | Gate |
|---|---|
| Pilote CLI/auto consommant `management_opted_out`, vrais `npm install/force/uninstall/up/down`, dérives `external_install_detected` réelles | D-2b/F-2b |
| Observateurs B2-3, autres entrées, smoke CI, gel .6, activation M18 | B2-3/E2b3/E3b2b/E3c/F-2b, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## D-2b — diagnostic de la commande npm (livré)

`assessNpmCommand({ commandPath, managedLauncher, legacyEntry })` dans
`packages/h2a/src/runtime/upgrade/npm-command.js` : lecture seule du lien
de commande — manquant (désinstallation), géré, héritage à adopter,
étranger ou pendant avec cible réelle (diagnostic), occupant fichier ou
dossier (EEXIST : `force-required`, jamais remplacé silencieusement).
L'installateur (C2b-2b) et la désadoption (D-1) consomment cette
classification ; le pilote CLI (F-2b) décidera installer/forcer/diagnostiquer.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-npm.test.js final-D-2b` | 8/8, exit 0 | 8/8, exit 0 |
| `mh-l6-mutate.mjs npm-command` (géré, héritage, manquant, occupant, pendant) | 5 rouges ERR_ASSERTION / 5 verts | 5 / 5 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Un test installe un vrai paquet fixture avec le binaire npm 11
(`pack` + `install --prefix` en répertoires privés) et classe le lien
réel en héritage. Rouge initial : classificateur absent
(`ERR_ASSERTION`, 1 test, exit 1), conservé. Audit :
`node scripts/mh-l6-d2b-audit.mjs /tmp/mh-l3-qualification-d2b-*/source`,
exit 0 ; 4 fichiers identiques, émission compilée liée par SHA, 8 tests
et 5 paires/profil. Preuve : `proof-D-2b.json`.

| NOT covered restant | Gate |
|---|---|
| Pilote CLI consommant la classification (installer/forcer/diagnostiquer), vrais round-trips EEXIST/force/uninstall/up/down, dérives réelles | F-2b |
| Observateurs B2-3, autres entrées, smoke CI, gel .6, activation M18 | B2-3/E2b3/E3b2b/E3c/F-2b, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

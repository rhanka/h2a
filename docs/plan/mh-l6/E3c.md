# E3c — gel comparatif du dist .6 publié

Le dist publié `@sentropic/h2a-runtime@0.98.6` (400 fichiers, tarball SHA-256
`44109da8…`, intégrité npm épinglée dans `legacy-integrity.json`) est gelé
octet par octet dans `dist-freeze-0986.json`, avec le sous-ensemble
installateur `dist/runtime/upgrade` du dist publié `@sentropic/h2a@0.98.6`
(4 fichiers). Le gel couvre la fermeture transitive, pas six entrées : tout
écart futur exige une régénération délibérée (`regen` dans le ledger).
Les relancements réels U07/U11 restent MH-L8 (vrais runs Claude) ; ce gel
est l'alternative confinement prévue par BRANCH.

Le diagnostic E3a est reproduit à l'identique contre le build local :
`launch-guard.js` identique, `native-host.js` et `native-terminal/{op,
process, supervisor, journal}.js` différants. Aucune restauration aveugle,
aucune garde affaiblie : les différences restent enregistrées, non effacées.

| Commande ciblée | Node 22.22.1 | Node 24.18.0 |
|---|---|---:|
| `MH_L5_ARTIFACTS=<privé> node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-dist-freeze.test.js final-E3c` | 3/3, exit 0 | 3/3, exit 0 |
| `node scripts/mh-l6-mutate.mjs dist-freeze` (copie privée) | 4 rouges ERR_ASSERTION / 4 verts restaurés | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : gel absent (`ENOENT`, exit 1), conservé comme diagnostic.
Génération : `MH_L5_ARTIFACTS=$root node scripts/mh-l6-e3c-freeze.mjs`
(tarballs vérifiés contre leur reçu avant extraction privée). Audit : `node
scripts/mh-l6-e3c-audit.mjs /tmp/mh-l3-qualification-b23`, exit 0 ; 7
fichiers identiques, 3 tests et 4 paires/profil. Preuve : `proof-E3c.json`.

| NOT covered restant | Gate |
|---|---|
| Vrais relancements U07/U11 sur artefacts convergés | MH-L8 (vrais runs Claude) |
| Admission héritée fermée / activation M18 | MH-L8/conducteur |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## Rebase vers la cible 0.98.8

Le gel publié .6 (400 fichiers runtime + 4 fichiers installateur) reste identique. Le diagnostic local a été régénéré après rebase sur main : trois entrées identiques (`launch-guard.js`, `native-terminal/process.js`, `native-terminal/supervisor.js`) et trois différentes. Le test compare désormais aussi les six empreintes locales/publiées, en plus du verdict par entrée. Aucun bump de version.

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
| Opt-out automatique (pas de réadoption immédiate), vrais `npm install/force/uninstall/up/down` contre les images, dérives `external_install_detected` en conditions réelles | D-2/F ; le marqueur seul ne bloque rien sans câblage CLI |
| Observateurs B2-3, préparation image, autres entrées, smoke CI, gel .6, CLI/auto + activation M18 | B2-3/C2b-2d/E2b3/E3b2b/E3c/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

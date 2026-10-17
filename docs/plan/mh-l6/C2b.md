# C2b — bootstrap et adoption avant raccourci de version

Référence : spec §8.6. Le bootstrap autonome identifie le préfixe depuis
l'entrée npm réelle, prépare une image indépendante, vérifie manifeste/graphe
fermé/binaires, applique les gardes héritées, installe le lanceur, sélectionne
durablement puis délègue au contrôleur cible absolu. `h2a upgrade` exécute
l'adoption nécessaire avant le raccourci `current == latest`.

## C2b-1 — session de bootstrap protégée (livré)

`openBootstrapSession({ prefix, entrypoint, legacyPrefix, target })` dans
`packages/h2a/src/runtime/upgrade/bootstrap-session.js` : contrôle
d'éligibilité de la cible (`bootstrap_target_invalid`), observation physique
C2a, prise du verrou compatible sur le préfixe canonique vérifié
(`bootstrap_lock_unavailable`), revalidation anti-dérive sous verrou avec
libération sur échec. La session gelée expose preuve, préfixe, cible et
`release()` idempotent. `assertBootstrapSessionUnchanged(session)` revalide
à la demande pour les étapes suivantes. Aucune image préparée, aucune
sélection, aucun paquet exécuté.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-bootstrap.test.js final-C2b-1` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs bootstrap` (verrou, dérive, cible, libération) | 4 rouges ERR_ASSERTION / 4 verts | 4 / 4 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : ouvreur absent (`ERR_ASSERTION`, 1 test, exit 1), conservé
comme diagnostic. Audit : `node scripts/mh-l6-c2b-audit.mjs
/tmp/mh-l3-qualification-c2b-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 4 paires/profil. Preuve :
`proof-C2b-1.json`.

| NOT covered restant | Gate |
|---|---|
| Revalidation interne à `open` non rejouable en monothread (aucune dérive intercalable entre observation et verrou sans second processus) ; elle partage le chemin prouvé d'`assertBootstrapSessionUnchanged`, tué/restauré ci-dessus | Noté ; C2b-2b/F l'exerceront sur chemins vivants |
| Préparation d'image indépendante, vérification graphe/binaires, installation conditionnelle du lanceur, sélection durable, délégation, adoption après remplacement et already-current | C2b-2b/F ; la session ne prépare ni ne sélectionne rien |

## C2b-2a — décision d'adoption avant raccourci (livré)

`assessAdoptionNeed({ managed, physical, target })` dans
`packages/h2a/src/runtime/upgrade/adoption-need.js` décide, sans rien
préparer ni muter, si `h2a upgrade` doit adopter avant le raccourci
`current == latest` : sélection absente, installation non reconnue, préfixe
étranger, sélection malformée, npm illisible et cible divergente exigent
l'adoption avec leur raison typée ; seule une sélection concordante rend
`already_adopted`. Enveloppe invalide refusée par
`adoption_assessment_invalid`. C2b-2b/F exécutent l'adoption requise.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-adoption.test.js final-C2b-2a` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs adoption` (défaut, 5 raisons, enveloppe, cible) | 8 rouges ERR_ASSERTION / 8 verts | 8 / 8 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Sélections vraies issues d'un `UpgradeStore` de fixture. Rouge initial :
évaluateur absent (`ERR_ASSERTION`, 1 test, exit 1), conservé comme
diagnostic. Audit : `node scripts/mh-l6-c2b2-audit.mjs
/tmp/mh-l3-qualification-c2b2-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 8 paires/profil. Preuve :
`proof-C2b-2a.json`.

| NOT covered restant | Gate |
|---|---|
| Exécution de l'adoption requise (préparation d'image, sélection durable, délégation) et câblage CLI du raccourci | C2b-2c/F |
| Observateurs B2-3, désadoption, autres entrées, smoke CI, gel .6 | B2-3/D/E2b3/E3b2b/E3c/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## C2b-2b — installation conditionnelle du lanceur (livré)

`installManagedLauncher({ session, launcherSource, managedDir, commandPath })`
dans `packages/h2a/src/runtime/upgrade/launcher-install.js` : sous session
bootstrap revalidée (dérive → refus sans rien écrire), source octet pour
octet enregistrée par SHA-256, fichier `launcher/h2a.mjs` en 0755 et
dossier en 0700 avec fsync, bascule atomique du lien (symlink tmp +
rename), vérification du lien final. L'arbre npm n'est jamais modifié.
Réinstallation idempotente aux mêmes octets.

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-launcher-install.test.js final-C2b-2b` | 6/6, exit 0 | 6/6, exit 0 |
| `node scripts/mh-l6-mutate.mjs launcher-install` (dérive, digest, modes, nom) | 5 rouges ERR_ASSERTION / 5 verts | 5 / 5 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Rouge initial : installateur absent (`ERR_ASSERTION`, 1 test, exit 1),
conservé comme diagnostic. Deux corrections de test en cours de route
(enveloppe nulle refusée proprement, motif du lien inutilisable), sans
retrait de garde produit. Audit : `node scripts/mh-l6-c2b2b-audit.mjs
/tmp/mh-l3-qualification-c2b2b-*/source`, exit 0 ; 4 fichiers identiques,
émission compilée liée par SHA, 6 tests et 5 paires/profil. Preuve :
`proof-C2b-2b.json`.

| NOT covered restant | Gate |
|---|---|
| Préparation d'image indépendante, sélection durable, délégation et câblage CLI de l'adoption | C2b-2c/F |
| Observateurs B2-3, désadoption, autres entrées, smoke CI, gel .6 | B2-3/D/E2b3/E3b2b/E3c/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

## C2b-2c — exécution de l'adoption (livré)

`executeAdoption({ session, store, upgradeId, target, launcherSource,
managedDir, commandPath, exclusion })` dans
`packages/h2a/src/runtime/upgrade/adoption-execute.js` : session revalidée,
besoin évalué (concordance → `already_adopted` sans rien muter, sans
nouvelle transaction), transfert explicite du verrou au moteur (le
concurrent du transfert rencontre le refus typé du moteur, jamais une
adoption à moitié écrite), begin/prepare, installation du lanceur, puis
sélection durable avec le verdict d'exclusion. La délégation au contrôleur
cible absolu reste une étape appelante explicite (primitif B1).

| Commande ciblée | Node 22.22.1 | Node 24.21.0 |
|---|---|---:|
| `node scripts/mh-l6-test.mjs packages/h2a/test/mh-l6-adoption.test.js final-C2b-2c` | 11/11, exit 0 | 11/11, exit 0 |
| `mh-l6-mutate.mjs adoption` (8 paires rejouées) + `adoption-execute` (raccourci, câblage, revalidation, install) | 12 rouges ERR_ASSERTION / 12 verts | 12 / 12 |
| Skips / annulations / enfants restants | 0 / 0 / 0 | 0 / 0 / 0 |

Le test a révélé un vrai conflit : la session tient le verrou que le moteur
reprend par opération — d'où le transfert explicite, épinglé vert par la
réacquisition concurrente après adoption. Deux mutants écartés en cours de
campagne : `need-shortcut` vide (le moteur refuse déjà la seconde
transaction vivante ; le mutant cible le rapport) et `lock-handoff` (son
absence donne le refus typé du moteur, fail-closed, non tuable par
assertion). Rouge initial : exécuteur absent (`ERR_ASSERTION`, 1 test,
exit 1), conservé. Audit : `node scripts/mh-l6-c2b2c-audit.mjs
/tmp/mh-l3-qualification-c2b2c-*/source`, exit 0 ; 5 fichiers identiques,
deux émissions liées par SHA, 11 tests et 12 paires/profil. Preuve :
`proof-C2b-2c.json`.

| NOT covered restant | Gate |
|---|---|
| Préparation d'image indépendante et câblage CLI de l'adoption + délégation | F ; l'exécuteur ne délègue pas et ne construit pas l'image |
| Observateurs B2-3, désadoption, autres entrées, smoke CI, gel .6 | B2-3/D/E2b3/E3b2b/E3c/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |
| Observateurs B2-3 alimentant `select({ exclusion })`, CLI/auto commune | B2-3/F, M18 toujours ouvert |
| Revue indépendante | Conducteur ; aucun consensus revendiqué |

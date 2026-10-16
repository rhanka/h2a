# MH-L6 — frontière H4 issue de M18

## Réalisation MH-L6 — sous-lots

- [x] Branche `feat/0.98.7-mh-l6` depuis MH-L5 relu ; confinement et règles owner prioritaires.
- [x] Allowed : H4/upgrade, lanceur/bootstrap, conditionnement, tests ciblés et docs MH-L6 ; adaptations directes CLI/starters/native seulement si nécessaires au contrat.
- [x] Forbidden : main, .track, état live, binaire/dist installé, découverte registry, conducteur live, Python, suite globale, signaux à des PID étrangers.
- [x] Conditional : manifests/npm/shrinkwrap/natifs pour le payload qualifié ; aucune compilation utilisateur ; aucun affaiblissement des gardes.
- [x] Exception de taille : chaque sous-lot conserve ensemble moteur, régressions, mutations et preuves nécessaires ; staging sélectif et rollback par commit.
- [x] A — Journal canonique, exclusion compatible, sélection durable/réconciliation ; `mh-l6-selection.test.js`, 10 tests + 15 fondations et 14 mutations tuées/restaurées par profil Node 22/24 ; limites SIGKILL/adoption/fermeture v1 explicites dans README.md.
- [x] B1 — Révocation/délégation exacte, acquisition unique, mort de candidat/gardien et reprise ; `mh-l6-delegation.test.js`, 14 tests et 16 mutations ; sélection requalifiée par 10 tests et 14 mutations ; profils Node 22/24. Journal seul, sans CLI/producer v1.
- [ ] B2 — Exclusion future des moteurs hérités et fermeture maintenue de leurs sources de relancement/admission ; producteur de preuve consommé par C/F/M18. Le verrou pris pendant une commande ne suffit pas.
- [x] C1 — Lanceur autonome, même PID, neutralisation des chargements ambiants, repli diagnostique sans exécution ni mutation ; `mh-l6-launcher.test.js`, 10 tests et 13 mutations par Node 22/24, artefact/manifeste reproduits depuis deux copies sources.
- [ ] C2 — Installation conditionnelle du lanceur, bootstrap/adoption avant raccourci de version, preuves physiques et chemins vivants ; `mh-l6-bootstrap.test.js`, avec B2/F pour le producteur M18.
- [ ] D — Désadoption conditionnelle, opt-out et dérives npm ; `mh-l6-unmanage.test.js`, `mh-l6-npm.test.js`.
- [x] E1 — Lecteur de modules lié au manifeste et installé dans le lanceur ; prérequis avant journal H4 ; ESM/CJS/createRequire/leurres/modes/métadonnées/probe PTY réel. Node 22/24 : quatre fichiers, 47 tests et 11 paires de mutation, zéro skip/enfant ; chaîne native locale non qualifiée release.
- [ ] E2 — Propager et qualifier le lecteur à chaque entrée directe, spawn/fork/Worker/eval-worker et import tardif ; ne pas déduire la couverture des enfants de celle du parent.
- [ ] E3 — Payload publié/shrinkwrap/runtime exact, natifs précompilés par chaîne épinglée, probe ancien moteur, reproductibilité, gel .6 et gate des relancements ; `mh-l6-package.test.js` et références affectées.
- [ ] F — Surface CLI/auto commune, codes/strict/status/resume/abort/compensate, preuve H4 externe M18 sur vrais .5/.6 ; tests CLI et v1 ciblés.
- [ ] Gate par sous-lot : commandes/sorties conservées, zéro skip/enfant, mutations tuées puis restaurées, vérification des références affectées, commit conventionnel anglais sans trailer, push fast-forward propre branche, rapport français mis à jour.
- [ ] Revue indépendante confiée au conducteur ; aucune invocation de dispatch installé et aucun verdict de consensus inventé.
- [ ] Rapport : scratchpad owner `0985/mhl6-report.md`, couvert/non couvert/écarts, reste en heures-agent et tours de revue.

Responsable : réalisateur H4/bootstrap MH-L6.
État : **à réaliser avant gel MH-L6** ; dépendance explicite de la campagne
M17 convergée [MH-L8](../mh-l8/BRANCH.md).

Argon finding 3, spec v7 F01 / §6.3 / §12 : les marqueurs v1 .5/.6 ne portent
ni identité de naissance complète ni bootId. La seule mort du PID ne constitue
pas une preuve durable. `mh-l5-v1.test.js` impose donc toujours
`owner_liveness_unknown`, sans réclamation ni fabrication de provenance.

- [ ] Produire et persister la preuve H4 externe de fermeture maintenue des
  admissions héritées, dans le chemin réel d'activation/bootstrap MH-L6.
- [ ] Après cette preuve vérifiée, permettre l'activation .7 et le retour
  d'éligibilité du store ; conserver le refus avec une preuve absente, invalide
  ou non concordante. Ne jamais assimiler PID absent à provenance durable.
- [ ] Tester les vrais dists .5 et .6 : arrêt froid, marqueur v1 résiduel,
  fermeture d'admission maintenue et démarrage .7 autorisé par la preuve H4.
  Exiger un rouge/vert par garde, commandes/sorties, zéro skip/enfant restant,
  uniquement des espaces temporaires ; aucun état réel de l'owner.

Ce fichier suit le besoin d'intégration ; il ne prétend pas que le producteur
H4 ou son chemin CLI est déjà livré par MH-L5.

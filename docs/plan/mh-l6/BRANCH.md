# MH-L6 — frontière H4 issue de M18

## Réalisation MH-L6 — sous-lots

- [x] Branche `feat/0.98.7-mh-l6` depuis MH-L5 relu ; confinement et règles owner prioritaires.
- [x] Allowed : H4/upgrade, lanceur/bootstrap, conditionnement, tests ciblés et docs MH-L6 ; adaptations directes CLI/starters/native seulement si nécessaires au contrat.
- [x] Forbidden : main, .track, état live, binaire/dist installé, découverte registry, conducteur live, Python, suite globale, signaux à des PID étrangers.
- [x] Conditional : manifests/npm/shrinkwrap/natifs pour le payload qualifié ; aucune compilation utilisateur ; aucun affaiblissement des gardes.
- [x] Exception de taille : chaque sous-lot conserve ensemble moteur, régressions, mutations et preuves nécessaires ; staging sélectif et rollback par commit.
- [x] A — Journal canonique, exclusion compatible, sélection durable/réconciliation ; `mh-l6-selection.test.js`, 10 tests + 15 fondations et 14 mutations tuées/restaurées par profil Node 22/24 ; limites SIGKILL/adoption/fermeture v1 explicites dans README.md.
- [x] B1 — Révocation/délégation exacte, acquisition unique, mort de candidat/gardien et reprise ; `mh-l6-delegation.test.js`, 14 tests et 16 mutations ; sélection requalifiée par 10 tests et 14 mutations ; profils Node 22/24. Journal seul, sans CLI/producer v1.
- [x] B2-1 — Producteur canonique du verdict d'exclusion (`legacy-exclusion.js`, `mh-l6-exclusion.test.js`, 8 tests et 8 mutations par Node 22/24, preuve-B2-1.json) ; consommé par C/F/M18.
- [x] B2-2 — Câblage du verdict au report de sélection (`select` refuse `selection_deferred:legacy_installer_unfenced` avant publication, verdict persisté au journal) ; 11 tests, sélection/délégation requalifiées et 12 mutations par Node 22/24, preuve-B2-2.json.
- [ ] B2-3 — Observateurs réels des quatre fermetures sur .5/.6 vivants alimentant la preuve ; le verrou pris pendant une commande ne suffit pas.
- [x] C1 — Lanceur autonome, même PID, neutralisation des chargements ambiants, repli diagnostique sans exécution ni mutation ; `mh-l6-launcher.test.js`, 10 tests et 13 mutations par Node 22/24, artefact/manifeste reproduits depuis deux copies sources.
- [x] C2a — Preuve physique npm en lecture seule, entrée/métadonnées/lien original liés aux inodes et empreintes, revalidation des dérives ; 22 tests et treize configurations de faute tuées/restaurées par Node 22/24 ; preuve-C2a.json. Aucune activation implicite, câblage C2b ouvert.
- [x] C2b-1 — Session de bootstrap protégée (préfixe identifié, artefacts vérifiés, verrou détenu, cible éligible) ; `mh-l6-bootstrap.test.js`, 6 tests et 4 mutations par Node 22/24, preuve-C2b-1.json.
- [ ] C2b-2 — Préparation d'image, installation conditionnelle du lanceur, adoption avant raccourci de version et chemins vivants, avec B2/F pour le producteur M18.
- [ ] D — Désadoption conditionnelle, opt-out et dérives npm ; `mh-l6-unmanage.test.js`, `mh-l6-npm.test.js`.
- [x] E1 — Lecteur de modules lié au manifeste et installé dans le lanceur ; prérequis avant journal H4 ; ESM/CJS/createRequire/leurres/modes/métadonnées/probe PTY réel. Node 22/24 : quatre fichiers, 47 tests et 11 paires de mutation, zéro skip/enfant ; chaîne native locale non qualifiée release.
- [x] E2a — Préchargeur autonome adressé par SHA, propagation aux descendants fichier du lanceur ; 37 tests et dix paires de mutation par Node 22/24, preuve-E2a ; détails et limites dans E2a.md.
- [x] E2b1 — Garde sur vraie entrée directe et routeur npm avant modules applicatifs ; descripteur fermé, préchargeur vérifié avant sa première instruction, argv sélectionné/même PID ; 42 tests ciblés et cinq paires par Node 22/24, preuve-E2b1.json.
- [x] E2b2 — Boot MCP fichier au lieu d'eval, vrais journal/fork+Worker et identité, API Node/alias physiques/URI/données opaques ; 75 tests ciblés et seize paires sur dix points de faute par Node 22/24, preuve-E2b2.json.
- [ ] E2b3 — Qualifier les autres vraies entrées natives et la sonde legacy avec les artefacts E3 ; propager et qualifier le lecteur à chaque entrée directe, spawn/fork/Worker/eval-worker et import tardif ; ne pas déduire la couverture des enfants de celle du parent.
- [x] E3a — Chaîne native épinglée (Zig, headers, sources), vrai prébuild node-pty N-API 8 distribué, consommation vérifiée sans compilateur ; 35 tests et treize configurations de faute tuées/restaurées par Node 22/24, preuve-E3a.json. Cible glibc 2.31, machine effectivement testée 2.43 seulement.
- [x] E3b1 — Construction des vrais paquets cœur/runtime .7, shrinkwrap et prébuild E3a, installations offline/scripts actifs, sondes .5/.6, SDK/PTY/transport réels, matrice Node 22/24 et préparation durable ; 148 tests ciblés et 26 + 11 paires/profil, preuve-E3b.json. Aucun verdict release.
- [x] E3b2a — Installation npm éligible aux diagnostics hors profil, plugins à la bonne version, refus glibc <2.31 avant préparation, garde seam sur vrai tarball et inventaire non vide ; 142 tests ciblés et 44 paires par Node 22/24, proof-E3b2a.json. Accès CLI réel hors profil et CI distante non qualifiés.
- [ ] E3b2b — Smoke CI sur propres artefacts PR, diagnostics CLI communs hors profil, backfills anciens tags et conditionnement final .7 après le bump de branche. E3b reste ouvert.
- [ ] E3c — Gel comparatif du dist .6 publié / fermeture transitive ou relancements réels U07/U11. Premier diagnostic : cinq des six entrées comparées diffèrent ; aucun gel ni relancement qualifié déduit des sources inchangées depuis MH-L6.
- [ ] F — Surface CLI/auto commune, codes/strict/status/resume/abort/compensate, autorité inter-transactions et preuve H4 externe M18 sur vrais .5/.6 ; tests CLI et v1 ciblés.
- [ ] F/M17 — Raccorder les sous-commandes CLI convergées aux droits de writer et aux primitives de mutation communes ; fournir à MH-L8 ses vrais acteurs CLI. L’admission maintenue et le retour d’éligibilité après héritage restent une réalisation MH-L6, jamais un scan/PID absent.
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

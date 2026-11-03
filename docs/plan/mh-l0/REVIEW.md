---
status: selection-failed
review-author:
  host: codex
  model: unattested
  effort: unattested
target-ref: bcd566f8c5e51c217aa96a6e907f262d62f0a586
observed-failure: Owner confinement forbids installed h2a and real mesh/state discovery; exact author model and effort are not attested by this session.
---

# Revue de réalisation MH-L0

Le target est le commit ci-dessus, incluant les contrats, tests et artefacts L0.
Les deux revues Astra/Opus fournies portent sur la spec v7, pas sur ce code.
Aucune jambe de revue n'a été lancée ; aucun verdict de consensus n'est revendiqué.

Le skill harness/review exige une sélection complémentaire attestée et un
lancement par h2a installé. L'instruction owner interdit ce lancement et la
lecture du mesh/état réels. La sélection et la revue s'arrêtent donc ici ;
le push demandé de cette branche de travail reste autorisé, sans merge/release.

L'inspection locale couvre le périmètre (34 fichiers autorisés avant ce dossier),
les marqueurs v1/v2, la persistance/fsync, l'epoch, la provenance, le digest
explicite d'image et les gardes BX. Les preuves rouge/vert sont dans
[red-green-evidence.json](red-green-evidence.json). Les neuf fichiers ciblés
ont 20 tests réussis, zéro échec et zéro skip à leur dernière exécution.
L'émission de déclarations des huit feuilles L0 vers un dossier temporaire
retourne exit 0 et huit fichiers. git diff --check est propre.

Le conducteur doit obtenir la revue indépendante de ce target et des éventuels
changements suivants avant intégration. Les limites REL et gates QF sont dans
[README.md](README.md), sans prétendre à une qualification .7 complète.

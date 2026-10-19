# PR #379 — corrections des deux revues de code

Autorité : SPEC v3 GO-CODE, SHA-256
`22ec83b1b51f7d2374176c4fec76173f45ca58f1656048c14bde75008ebf04fe`.
Revues d’entrée : Astra max et Sol xhigh sur `3d10f8b7b`.
Rebase sans conflit sur `origin/main` (`dc78dc5f7`), sans merge de main.
La modification L3 déjà présente au début de la session a été conservée et complétée.
Dernier commit de code : `791c905` (après `cc7a448c1`). Il complète les chemins
Claude, les frontières de matérialisation et de diagnostics, les replays RED,
et sépare les contrôles longs de simulation de leurs six shards CI.

| Finding commun aux revues | RED observé | GREEN observé | Commit |
| --- | --- | --- | --- |
| L3 : crédit avec un seul offset, single et periodic | Rejeu du head initial : les deux pollers obtiennent `simulated-OK`, `woke:true`, exit 0 ; les deux assertions échouent | Les deux contre-exemples sortent 2, sans crédit de wake ; contrôles positifs/replay : 9 répétitions séparées passent | `5238f0e31`, `cc7a448c1` |
| L11 : reçu sans provenance et preuves fausses | Le reçu fabriqué est accepté ; assertions de refus absentes | Provenance externe obligatoire, huit indicateurs, identités distinctes, barrière, répétitions, absence de blocker, débits et récupération vérifiés ; 17 tests passent | `cc7a448c1` |
| L11 : sonde transformée en R2 ; SHA source ignoré | Une ligne `loop:lifecycle` non exécutée devient `measured-OK` | Recherche par `(scenario,pair)`, groupe de répétitions, SHA et digest du résultat source ; la ligne absente reste bloquée | `cc7a448c1` |
| L11 : secrets avant validation du candidat | Test de workflow refuse les bundles au niveau du job et l’absence de validation | Validateur exécuté avant checkout : dépôt, événement, référence protégée, tête courante et SHA du workflow identiques ; bundles limités à l’étape de matérialisation | `cc7a448c1` |
| L11 : artefact inutilisable par les gates ; SHA de merge synthétique | Les lanes lisent un fichier committé et utilisent le mauvais SHA | API GitHub authentifiée : run réussi du workflow et du candidat exacts, branche protégée, identité/attempt du run, digest ZIP et contenu vérifiés ; head de PR et SHA de release figés ; 2 tests d’artefact passent | `cc7a448c1` |
| L2 : dépendance Focus non publiée | Installation des tarballs : `ETARGET`, `No matching version found for @sentropic/focus@0.5.0` | Tarball Focus local ajouté à h2a/track/runtime ; version installée attestée ; test de packaging : 1/1 sous Node 22 et 1/1 sous Node 24 | `0fcfb4551` |
| Campagne : racine, budget, Vibe, binaires absents | Trois assertions de lane échouent | Racine `/tmp/h2a-qual-*`, budget explicite 120 s, trois offsets financés, cinq versions dont Vibe mesurées dans des HOMEs privés avant les sièges ; runner provisionné explicitement sélectionné par D3 | `cc7a448c1` |
| L4 : canari conservé sans identité ; scan absent | Le canari `codex:workspace:deadbeefcafe` reste dans un inbox refusé ; scan inexistant | Instances limitées aux identités connues ; vocabulaire fermé des outils et diagnostics ; proxy 5/5, scan 1/1 et chaque upload dépend du scan ; les bundles malformés et racines de sièges aliasées ont leurs twins RED/GREEN | `c18cd7df8`, `cc7a448c1`, `791c905` |
| L4 : symlink dans un composant source | `.codex` lié à l’extérieur fournit un login copié | Marche par descripteurs avec `O_NOFOLLOW` sur chaque composant, source et destination ; fichiers réguliers, créations exclusives ; canari extérieur intact | `c18cd7df8`, `cc7a448c1` |
| L5 : transcript survivant | Effacement déclaré alors que le transcript reste présent | Effacement de l’état CLI complet ; le parent supprime sa cellule exacte indépendamment des chemins fournis par le worker ; tests de perte, sortie invalide et annulation passent | `c18cd7df8`, `cc7a448c1` |
| L5 : récupération des processus absente | Un worker terminé laisse vivre son enfant détaché | Superviseur natif, descendants possédés uniquement, arrêt borné, récolte des orphelins et preuve indépendante de récupération ; test positif vérifie `ESRCH` | `cc7a448c1` |
| L8 : prévols dans le HOME ambiant | La fausse CLI voit le HOME/XDG/cwd du processus parent | Version, oracle et précontrôle utilisent des espaces privés effacés ; Muse utilise aussi sa copie privée du programme | `c18cd7df8`, `cc7a448c1` |
| L8/L9 : chemins Codex, Claude et Muse erronés | HOME Codex valide refusé ; Claude reçoit le mapping Muse | Chemins imbriqués copiés par l’allowlist ; Claude `.claude/.credentials.json` et métadonnées filtrées dans `CLAUDE_CONFIG_DIR`, Muse `.config/muse/auth.json` ; 5 régressions de confinement passent | `c18cd7df8`, `cc7a448c1`, `791c905` |
| L6 : descendants non observés | Journal initial : 0/9 execs natifs `python3.14` détectés | Événements d’exec ptrace, sans auto-déclaration du fixture : 9/9 à 1/10/100 ms ; journaux bruts supprimés et allowance vendeur séparée | `cc7a448c1` |

Les deux revues se recouvrent ; aucune sévérité P1/P2 n’est omise dans cette table.

Commandes et sorties conservées dans la session (uniquement des tests ciblés) :

| Commande | Sortie observée |
| --- | --- |
| `rtk node --test scripts/xcli-review-regressions.test.mjs` | Avant correctif : 0 pass / 4 fail ; après : 5 pass / 0 fail |
| `rtk node --test scripts/xcli-proxy.test.mjs` | 5 pass / 0 fail ; canari reproduit en RED avec `--test-name-pattern 'L12: failed'` |
| `rtk env XCLI_WAKE_REVIEW_BASELINE=3d10f8b7b node --test --test-name-pattern 'poller counterexample' scripts/xcli-wake-review.test.mjs` | RED : 0 pass / 2 fail, chaque erreur montre `simulated-OK,woke:true` |
| `rtk node --test --test-name-pattern 'poller counterexample' scripts/xcli-wake-review.test.mjs` | GREEN : 2 pass / 0 fail |
| `rtk env XCLI_PROCESS_REVIEW_BASELINE=3d10f8b7b node --test scripts/xcli-process-review.test.mjs` | RED : 0 pass / 2 fail, `0 !== 9` et enfant survivant |
| `rtk node --test scripts/xcli-process-review.test.mjs` | GREEN : 3 pass / 0 fail, incluant la fin de l’allowance vendeur à l’entrée MCP |
| `rtk node --test scripts/xcli-receipt-check.test.mjs` | 17 pass / 0 fail ; les trois nouveaux refus étaient RED avant correction |
| `rtk node --test scripts/xcli-trusted-artifact.test.mjs` | 2 pass / 0 fail : API simulée et vraie lecture ZIP, sans siège |
| `rtk node --test scripts/xcli-campaign-lane.test.mjs` | 11 pass / 0 fail ; trois cas de lane et deux frontières de matérialisation étaient RED avant correction |
| `rtk node --test scripts/xcli-packaged-review.test.mjs` | RED : ETARGET ; GREEN après build : 1 pass / 0 fail |
| `rtk npm exec --yes --package=node@24 -- node --test scripts/xcli-packaged-review.test.mjs` | GREEN après build : 1 pass / 0 fail |
| `rtk node --test --test-name-pattern 'normal simulated\|replayed wake' scripts/xcli-simulation.test.mjs` | 2 pass / 0 fail, soit 9 répétitions positives |
| `rtk node --test scripts/xcli-startup.test.mjs scripts/xcli-gemini-registry.test.mjs` | 2 pass / 0 fail, sans login |
| `rtk node --test scripts/xcli-process-review.test.mjs scripts/xcli-scenarios.test.mjs scripts/xcli-evidence.test.mjs scripts/xcli-cleanup.test.mjs scripts/xcli-campaign.test.mjs scripts/xcli-wake-review.test.mjs` | Run ciblé initial : 36 pass / 0 fail ; les deux contre-exemples de polling ajoutés ensuite sont vérifiés séparément ci-dessus |
| `rtk npm run build:h2a` | exit 0, `vendor-engram-live mirror OK`, après `npm ci --ignore-scripts` du checkout rebasé |
| `rtk bash scripts/check-no-python.sh` | `ZERO PYTHON OK (1 allowlisted hit(s), 0 unexcused)` ; allowlist inchangée |

Le groupe rapide final (lab, proxy, regressions, process, seats, receipt,
artifact, campaign-lane, evidence-scan, matrix, docs) donne **73 pass / 0 fail**
sur Node 22 **et** Node 24. Le dernier resserrement des diagnostics du proxy
est ensuite revérifié séparément : 5/5 sur chaque Node. L’export est revérifié : 2/2.
Le run long initial a eu 8 pass / 3 fail pendant un chevauchement accidentel
avec `npm ci` (worker perdu puis deux reçus absents). Rejeu sans mutation des
dépendances :
`rtk node --test --test-name-pattern 'polling periods|slow poller|overlapping-window replications' scripts/xcli-simulation.test.mjs`
→ **3 pass / 0 fail**. Les quinze combinaisons de périodes/phases sont toutes
`simulated-KO,woke:false` ; le poller lent et le batch aux fenêtres superposées
échouent également au stade 7. Chaque cas du fichier a ainsi un passage ciblé
réussi ; aucune tolérance aux échecs ni skip n’a été ajouté.

Le test de dispatch L2 a réellement été exécuté :
`rtk node --test --test-name-pattern 'L2:' packages/h2a/test/run-test-gates.test.js`
→ 0 pass / 1 fail. Le lanceur direct confirme :
`sudo: The "no new privileges" flag is set, which prevents sudo from running as root.`
Le fichier trust-root ciblé donne 42 pass / 1 fail, le seul échec étant ce même
dispatch L2. Le test est conservé et ne devient ni skip ni succès artificiel.
Le conducteur doit obtenir sa preuve GREEN sur le runner CI avec espace PID privé.

Le lien avec le smoke rc.5 est la preuve de la version exacte du candidat :
les dépendances de la famille doivent venir des tarballs locaux du même arbre.
Le smoke conserve son pin `@sentropic/focus@0.5.0` ; un arbre `0.5.0-rc.5`
exige d’aligner explicitement les versions/dépendances et le pin de train avant
rejeu. Cette correction n’efface pas le refus de train et ne publie pas Focus.

Non couvert : qualification avec les connexions réelles, campagne R1 16/16
de confiance, validation GitHub en production des artefacts, intégration complète
et nouveaux verdicts des reviewers. D2/D3 et la référence protégée doivent être
configurés par le conducteur ; le workflow refuse leur absence. AGY n’a pas de
source de login réutilisable démontrée ; Gemini/Vibe n’ont pas de siège autorisé.
Le polling à phase variable reste exclu de la garantie ; les autres plateformes
restent non qualifiées pour l’observation Linux. Le manifeste des non-tests
est byte-identique. Aucune suite complète ni qualification réelle lancée.

Revue formelle harness : `status: selection-failed`. L’identité exacte
model/effort de l’auteur n’est pas disponible ; de plus, le dispatch via h2a
installé prescrit par le skill est interdit par les règles du conducteur.
Aucun consensus de revue supplémentaire n’est revendiqué.

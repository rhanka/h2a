# Qualification MH-L4 — 0.98.8

Source finale : le présent correctif flock/build-gate sur `feat/0.98.7-mh-l4` (base `c8a11016`, prédécesseur qualifié `008f2394c975ee84986dd9896be17a2b3fd0c95c`). Les contrats MH-L3 sont figés dans `CONTRACT.md`, l'audit des writers dans `WRITERS.md`.

Archive finale : `/tmp/mh-l4-release-check-RvMsgD`, créée par `git archive HEAD`, extraite sous umask 022. Installation et compilation exécutées sous umask 022 : `npm ci --ignore-scripts`, `npm run build -w @sentropic/track`, `node node_modules/typescript/bin/tsc -b --force --pretty false`. Codes 0 ; npm : 288 packages ajoutés, audit 298, 1 vulnérabilité basse préexistante dans le lockfile inchangé ; compilation sans diagnostic. Aucun script d'installation exécuté. Les préfixes node_modules et dist sont 0755.

Profils : `/usr/bin/node` v22.22.1 ; `/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node` v24.21.0. Chaque commande de test crée HOME/XDG/runtime/store privés temporaires. Aucun état propriétaire ni binaire installé consulté. Un skip provoque l'échec du runner. Aucun test global lancé.

| Commande ciblée, pour chacun des deux profils | Résultat final |
|---|---|
| `node scripts/mh-l4-matrix.mjs` | 10 fichiers nommés, 29/29 ; 0 échec, 0 skip |
| `node scripts/mh-l4-regressions.mjs` | 15 fichiers nommés, 89/89 ; 0 échec, 0 skip |
| `node scripts/mh-l4-test.mjs packages/h2a/test/mcp-central-attachments.test.js nodeNN-regression` | 33/33 ; 0 échec, 0 skip |
| `node scripts/mh-l4-test.mjs packages/h2a/test/mh-l0-formats.test.js nodeNN-final` | 4/4 ; 0 échec, 0 skip |
| `node scripts/mh-l4-mutations.mjs` | 23/23 mutations tuées sur chaque profil : 23 codes rouges 1, puis 23 codes verts 0 |

Les scripts de matrice/régression invoquent exclusivement `node --test <fichier explicite>`. `scripts/mh-l4-test.mjs` refuse avec une erreur actionnable nommant le setup documenté quand les imports `../dist` de la cible sont absents (worktree frais sans build préalable) ; l'en-tête de `mh-l4-integration.test.js` rappelle le prérequis. Chaque log de `evidence/` inclut la commande exacte, version, répertoire privé, sortie et reçu de code. Les logs conservent les octets originaux, y compris l'indentation TAP des lignes blanches, selon la convention `.gitattributes` des preuves MH-L1. `mh-l0-formats` s'exécute dans le worktree parce qu'il lit un vrai ancien lecteur par `git show` ; ce fichier ne teste aucun préfixe d'installation. Les 27 définitions L0/L2 sont identiques à celles de la base ; seuls les nouveaux records MH-L4 sont ajoutés.

| Oracle rouge → vert | Preuve conservée |
|---|---|
| Ownership, writers/readOnly, checkpoint, wake, lancement et intégration | Logs `nominal-red` puis `nominal-green`, renforcés par mutations ciblées |
| Epoch seul, fsync incertain, fenêtre de barrière, présence cible et janitor | Oracles séparés, mutations et verts finaux |
| Token async réel, conflit d'arguments et mémo final avant clôture | Tests cuts et mutations ; ancien test async 8/10 avant évolution, 10/10 après |
| Admission du vrai source du cycle froid | Ancienne fixture refusée `store_writer_set_unknown` ; factory source avec preuve privée maintenue, même starter successeur et assertions froides |
| Payload de réponse après gel | Vrai central : absence de recovery.ref avant correction, payload conservé après correction ; mutation reply-lifetime |
| Instance remplacée sous verrou, délégation perdue après mémo final | 2 échecs sur cuts avant correction, 7/7 après ; mutations presence-reread et delegation-recovery |
| Ligne signée d'un wake différé | 1/2 avant correction, 2/2 après ; mutation wake-freshness |
| Idle avant disponibilité durable | Historique Node22 : 32/33, `ECONNRESET`. Stall synchrone 250 ms : même reset ; correction sans relever idle/lease 100 ms ; mutation readiness-idle |
| Résolution flock (allow-list, hors-PATH, défaut util-linux) | 4 mutations tuées (fallback, fail-closed, PATH, qualification) : codes rouges 1 puis verts 0 ; logs `mh-l4-writers.test.js-node22-mutation-flock-*-red` et `mh-l4-writers.test.js-node2*-final` |

La première archive avait été extraite en 022, mais npm/build avaient hérité du umask 0002 du shell ; elle n'est pas utilisée comme qualification finale. Installation et build ont été repris explicitement sous 022 depuis des archives propres, sans affaiblir un guard. L'essai de `mh-l0-formats` sans historique Git a échoué, puis a été déplacé dans le worktree. La première variante asynchrone du stall idle n'a pas reproduit le reset ; le stall synchrone reproduit la fenêtre de timer retardé et constitue l'oracle rouge.

| NON couvert ici | Lot / limite |
|---|---|
| M17 complet : 10 000 mutations par chacun des sept domaines, huit rôles et acteur hérité | MH-L5 ; probe local huit processus, 160 écritures registry + 160 inbox, aucune perte acquittée |
| Matrice exhaustive de coupures, deux dists exacts et campagnes REL | MH-L5/MH-L8 ; seuls les scénarios ciblés décrits sont qualifiés |
| Vrai Claude, charge/endurance et qualification consommateurs | MH-L8 ; QC hors latest maintenu |
| Producteur réel de preuve maintenue de fermeture des admissions et qualification de la allow-list util-linux flock (`/usr/bin/flock`, `/bin/flock`, jamais PATH, défaut explicite `mutation_lock_unqualified`) | MH-L6/MH-L8 ; preuve interne de fixture seulement, défaut refusant la continuité |
| Shim logique, corrélation/replay/catalogue et consommation des contrats | MH-L3 ; aucune réalisation de ce lot |
| Acquisition/restauration produit et coordinateur vivant | .8 ; primitives source uniquement |
| Suite complète et revue indépendante intégration | Conductor ; deux critiques locales en lecture seule, aucune revendication FUSIONNABLE ou consensus cross-host |

Choix d'implémentation à qualifier : Linux util-linux flock, résolu depuis la allow-list fixe `/usr/bin/flock` puis `/bin/flock` (jamais PATH ; défaut explicite `mutation_lock_unqualified` nommant util-linux), ajoute un prérequis système explicite, sans fallback à verrou PID. Le confinement ne permettait pas bwrap ; les commandes ont reçu l'escalade automatique pour fichiers autorisés et tests temporaires. Aucun rejet automatique, aucun accès h2a réel. Les fixtures historiques modifiées conservent leurs oracles, avec conflits d'arguments et preuve privée conformes à la spec. Aucun écart de périmètre fonctionnel revendiqué ; les gates de release restantes ne sont pas déclarées acquises.

| Travail restant estimé | Heures-agent | Tours de revue |
|---|---:|---:|
| Revue indépendante MH-L4, corrections éventuelles et intégration conductor | 3–6 | 1–2 |
| Campagnes concurrence/coupures déléguées à MH-L5 | 8–16 | 2–3 |
| Fermeture d'admissions réelle et prérequis allow-list util-linux flock dans MH-L6/MH-L8 | 8–20 | 2–3 |

Ces estimations sont indicatives et excluent la réalisation complète des autres lots, notamment MH-L3 et la qualification réelle des consommateurs.

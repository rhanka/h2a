# Spike PTY owner — décision à prendre après mesures

**C : GO mécanique Linux ; NO-GO pour le contrat complet. B : GO de faisabilité
avec keeper lecteur autoritatif et listener conservé ; NO-GO de disponibilité
si chaque frontal possède seul son nouveau listener.** Le choix produit reste
au propriétaire. Rien n'a été intégré au runtime de production.

| Livraison | État |
|---|---|
| Branche | spike/pty-owner-reexec, base origin/main e3fc1a52 |
| Périmètre | spike/pty-owner/ uniquement, Node/JS ; aucun h2a installé |
| Banc | Linux 7.0.0-38-generic, x64 ; node-pty 1.1.0, setpriv 2.41.3, bash 5.3.9 |
| Isolation | mkdtemp HOME/XDG_RUNTIME_DIR/TMPDIR/H2A_ROOT pour drivers et fixtures ; liste des PID créés, aucune découverte par UID |
| Validation | 42 commandes ciblées, 138 assertions : 132 PASS, 6 rouges attendus, 0 skip |
| Preuves | [manifest](results/final/manifest.json), [complément S5](results/final/supplement.json), [commandes et sorties](results/final-campaign.log), [S5](results/supplement-campaign.log) |

Le statut 0 de la campagne signifie reproduction des observations attendues,
**pas succès du contrat C**. Les trois rouges de configuration et la course
waitpid sur les trois Node capables restent visibles. Le complément S5 répète
seulement faults.test.mjs avec exactement la même exception JS sans/avec retour.
Les SHA des sources de chaque phase sont conservés ; les logs portent les traces
complètes de naissances, FD, séquences et résultats. Les mesures p99 sont des
quantiles empiriques de 20/100 cycles, sans garantie statistique de production.

| C : Node | PTY × exec | p99 pause / demande→prêt, ms | Δ FD | Δ RSS final | erreurs connect |
|---|---:|---:|---:|---:|---:|
| v22.22.1 | 32 × 20 | 117.8 / 223.2 | 0 | -5.0 % | 0 |
| v22.22.1 | 4 × 100 | 126.5 / 223.6 | 0 | 0.8 % | 0 |
| v22.15.0 | 32 × 20 | 56.2 / 88.8 | 0 | 0.2 % | 0 |
| v22.15.0 | 4 × 100 | 56.7 / 86.7 | 0 | -0.2 % | 0 |
| v24.18.0 | 32 × 20 | 57.6 / 88.9 | 0 | 3.5 % | 0 |
| v24.18.0 | 4 × 100 | 61.5 / 91.1 | 0 | 1.5 % | 0 |

Chaque CLI/guardian garde PID, naissance, PGID/SID/TTY ; les compteurs Unicode
fragmentés restent complets et uniques. Écriture acceptée observée une fois,
resize réel 101×31, anciennes leases rejetées, concurrent contrôleur refusé,
ensure concurrent sous verrou privé sans deuxième publication. Connect cible
1 kHz (mesuré environ 996–1000 Hz). Les SIGWINCH de resize sont attendus ; aucun
SIGHUP/USR2/EOF nominal n'est observé côté CLI. L'état de l'owner reste le même
(pid,startTime), avec builds N0/N1 réellement alternés.

| B : Node, 32 PTY, 20 SIGKILL frontaux | p99 retour | Δ FD | Δ RSS final | erreurs connect |
|---|---:|---:|---:|---:|
| v22.22.1 | 95.9 ms | 0 | 6.7 % | 0 |
| v22.15.0 | 38.6 ms | 0 | 11.8 % | 0 |
| v24.18.0 | 27.9 ms | 0 | 21.7 % | 0 |
| v20.20.2 | 33.5 ms | 0 | 10.7 % | 0 |
| v22.14.0 | 26.8 ms | 0 | 9.7 % | 0 |

Le keeper continue à lire sans client. Le flood sous quota réduit produit un
gap explicite et une rétention bornée (capacité + un chunk, au plus 64 KiB),
sans blocage durable de l'écrivain. Les frontaux n'héritent d'aucun master.
Le rename publie un alias du **même inode de listener**, conservé dans K ;
il ne transfère aucun PTY. Sans conservation, le témoin B voit 1595
ECONNREFUSED sur 20 morts de frontal, malgré la survie de tous les CLI.

| Critère fusionné Opus / Astra | Résultat et limite |
|---|---|
| E1 / S7, FD étrangers | Rouge guardian exact ; vert fermeture FD ≥3 avant CLI ; masters restent non CLOEXEC (0104002). |
| E2 / E4 / S1 | 32×20 + 4×100 par Node capable ; cinq exec avec guardian exact ; six alternances réelles Node22↔24, mêmes naissances et I/O. |
| E3 / S2, sorties | 0/7/143 avant, pendant, après ; SIGKILL guardian 9 exact ; zombies hérités exposés. **FAIL** si waitpid a récolté avant exec mais callback JS encore en attente : code 7 perdu, issue unknown. |
| E5 / transfert Astra S3 | ERR_INVALID_FD_TYPE pour TTY via net.Socket ; mort du parent confine les fixtures. SCM_RIGHTS noyau/addon non tenté sous contrainte Node/TS. |
| S3, attach | Vrai runAttach du source 0.98.5 : six exec et EOF réels, reconnexion, séquences continues ; adaptateur IPC. Dist historique/protocole produit complet non qualifiés. |
| S4, ensure | Verrou exclusif du banc, PID/naissance conservés, refus retrySafe sans création ; **PB5 produit non qualifié**. |
| S5, défauts | Mort owner, dernier master, exception JS non rattrapée et abort natif tuent les seuls arbres fixtures. La même exception JS rattrapée + exec de retour garde les PTY. Un abort natif ne peut pas revenir. |
| Astra S4, état/entrée | Checkpoint/candidat/fd invalides refusés avant exec ; offset partiel repris une fois ; réponse perdue sans replay automatique ; mutation de lease après freeze refusée (rouge→vert). |
| Node20 / 22 pré-22.15 | Refus execve-unavailable, attempted:false ; B continue à fonctionner. Aucun minimum Node produit n'a été changé. |

Les risques principaux sont la perte irréversible d'un résultat déjà récolté,
les zombies sans reaper d'adoption maintenu, et le crash collectif au bootstrap
ou à un exec natif raté. Un simple waitpid ajouté après exec ne récupère pas un
enfant **déjà récolté** : il faut un contrat conservant les résultats natifs
jusqu'à l'ACK JS, et une barrière avant exec. La preuve nominale ne suffit pas.
Le listener doit être explicitement conservé : listen(fd≥3) met CLOEXEC, et la
duplication IPC explorée n'a pas fourni une réserve durable. C exploite ici le
FD 0 réservé du démon, garanti conservé par process.execve. B exige aussi le
listener/backlog stable pour survivre à un crash frontal sans refus de connect.

| Non couvert / déviation | Conséquence |
|---|---|
| Namespace bwrap indisponible | Commandes exécutées via approbation automatique ; isolation par données/PID, pas preuve de conteneur/UID distinct. Aucun état réel h2a lu, signalé ou modifié. |
| Native C, SCM_RIGHTS, waitpid réarmé | Exclus par Node/TS ; C complet reste NO-GO en l'état, pas déclaration d'impossibilité Linux. |
| État produit et compatibilité N↔N+1 | Trackers modes/DSR/CPR/reset relay, décodage de l'owner produit, fsync, auth IPC, transports/leases réels, watchers B et quotas globaux restent à qualifier. |
| Parc legacy / PB5 / supervision | Pas de dist installé, vrai ancien host, socket abstrait produit, ancien lanceur ou migration de sessions existantes. Drain obligatoire, aucune absorption démontrée. |
| Durée/plateformes | Aucun soak au-delà de 20/100 cycles, macOS/Windows, saturation du backlog ou crash noyau. |
| Revue harness externe | Non effectuée : lancement h2a réel interdit. Relecture locale seulement, aucun consensus revendiqué ; BRANCH.md/.track intacts par périmètre propriétaire. |

| Charge révisée Linux, j-ing, spike inclus | B sans exec du keeper | C avec backend d'exit qualifié |
|---|---:|---:|
| Spike / frontière | 4–6 | 4–6 |
| Extraction et IPC, ou état et adoption | 13–19 | 13–20 |
| Activation, orchestration, filets | 3–5 | 5–8 |
| Migration et qualification | 6–10 | 13–20 |
| **Total PTY sans UI/MCP/gateway** | **26–40** | **35–54** |

B inclut désormais activation/crash frontal, ce que le simple keeper ne garantit
pas. C baisse face à 38–58 j Astra après preuve de l'adoption JS et du swap Node,
mais reste au-dessus des 22–33 j Opus : l'exit natif et l'état exhaustif ne sont
pas résolus. UI native +12–18 j pour rendu/focus seul, ou +19–29 j avec statuts
et intégration run ; prototype tmux +3–5 j. Estimations, pas temps mesuré ni
engagement. Si Node/TS strict exclut toute évolution du backend natif existant,
ne pas engager C complet avant preuve indépendante de conservation des exits.

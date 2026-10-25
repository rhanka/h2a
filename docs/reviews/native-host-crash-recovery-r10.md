---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 4f6f0257d8c7053a0eda46c3c74a268c7eb7f023
observed-failure: "Identité exacte modèle/effort non fournie ; transport de revue h2a installé interdit par le confinement. Aucun nouveau consensus indépendant revendiqué."
---

# PR #390 — R10 : reprise concurrente et propriété des connexions

Code qualifié : **4f6f0257d8c7053a0eda46c3c74a268c7eb7f023**. Les revues R9 Astra/Sol restent le contrat de réception. Les [mesures complètes](native-host-crash-recovery-r10-metrics.json) conservent commandes, codes de sortie, diagnostics TAP, rouges et séries finales ; les essais intermédiaires ne sont pas comptés comme qualification.

**Deux changements de qualification sont soumis explicitement à la réception : nettoyage entre fixtures et plafond propre à huit instances sur huit CPU.** Aucun accord du propriétaire n'est inféré. Le profil historique conservait jusqu'à **800 agents** ; les verts ci-dessous portent sur **160 reprises concurrentes**, avec une fixture de 20 sessions par instance. Ils ne qualifient pas 800 agents persistants.

## Constats et preuves rouges

| Constat R9 | Reproduction avant correction | Correction R10 |
|---|---|---|
| P1 — convergence / expiration d'élection | Archive construite de 61271bd24 : huit instances sur CPU 0–7, **0/8 passages**, dont **6/20, 10/20 et 16/20 lancements**, 28 refus ; un autre passage échoue à la disponibilité du CLI. Le nouveau test op-probe reproduit aussi directement le TimeoutError de l'élection. | Après l'expiration d'acquisition à 5 s, adoption seulement en lecture dans le budget existant du successeur de 1 s, avec annulation des RPC. Aucun droit de création tiré de cette expiration. L'absence de successeur reste un refus. |
| P1 — host gelé pendant create | Serveur réel privé, registre retenu 800 ms : le ping borné à 250 ms expire. Trace sous huit instances : create jusqu'à **3912 ms**, dont seulement **70 ms CPU** ; retard de boucle jusqu'à **4804 ms**. | Attente du registre asynchrone **avant spawn**, puis création et persistance synchrones dans le même tour. Le contrat historique du registre reste **4 s, best-effort** ; aucun second délai n'est payé par la persistance. Ordre des demandes par connexion, annulation au départ du client et budgets de file conservés. |
| P2 — plafonds sous charge | R9 exact : p95 jusqu'à **15418 > 9798 ms**. Avec le même nettoyage entre fixtures pour le contrôle R9 : huit passages encore rouges, médianes **10189–11700 ms**, p95 **11919 ms**. | Chargement différé des fournisseurs de comptes, du rendu xterm et du service HTTP ; recherche du worker limitée aux descendants du PTY, enfants de tous les threads compris ; inventaire tmux partagé entre labels, sans le fork de disponibilité redondant. Attentes d'élection espacées progressivement, délai d'acquisition inchangé. |
| P2 — connexion perdue après list | Test fleet rouge : fermeture appelée **0 fois**. Serveur privé réel : ping valide, premier list expiré après 5 s, suivant réussi ; verdict dead/absent émis, **une connexion encore ouverte**. | Le client dont list échoue est fermé avant toute preuve/reconnexion. Même témoin vert : zéro connexion, processus terminé, exit 0. |

Commandes des témoins, avec TMPDIR privé :

~~~sh
rtk node --test --test-name-pattern='async probe closes' packages/h2a/test/native-host-crash-recovery.test.js
rtk node --test --test-name-pattern='contended registry creation' packages/h2a/test/native-host-crash-recovery.test.js
rtk npx vitest run packages/h2a-runtime/src/native-terminal/op-probe.test.ts --maxWorkers=1
~~~

Rouges puis verts enregistrés dans le JSON. Le témoin de registre vérifie aussi qu'aucun PTY n'est créé pendant l'attente ; une création déconnectée ou une file dépassant 64 demandes ne crée rien après libération. Le cas de ping suspendu après expiration d'élection est rouge au watchdog de 2 s avant annulation, puis vert avec le budget santé de 1 s. Les deux pings du refus historique SIGSTOP restent conservés.

## Cycle de vie des fixtures et charge mesurée

Le commentaire du test annonçait des sessions ne s'accumulant pas entre les mesures, mais fixture(t) n'enregistrait qu'un nettoyage à la fin du test parent. Échauffement, référence et trois cellules conservaient donc **100 agents par instance**. Chaque fixture est maintenant détruite après **toutes** ses assertions existantes ; le hook final reste le nettoyage des échecs. Le chronomètre jusqu'à l'I/O utilisable garde ses limites, le nettoyage est hors mesure.

Le changement ne retire aucune assertion : toujours 20/20 I/O utilisables, un seul host vivant, un seul candidat remplaçant, zéro auxiliaire de sonde/lancement et zéro timeout. La correction de charge est déclarée ; elle ne doit pas être confondue avec une preuve sur 800 agents conservés.

Le contrôle R9 avec ce même nettoyage rejoue les sources de 61271bd24 via un loader Node privé après transpilation TypeScript. **0/8** passent les anciens plafonds ; ces **huit** mesures dépassent également au moins un des nouveaux plafonds proposés. L'augmentation proposée ne suffit donc pas à faire passer R9. La reproduction rouge initiale utilise séparément le produit R9 construit et le banc historique inchangé.

## Bornes : proposition chiffrée pour huit instances seulement

La calibration finale de code ea32c665 comprend **5 tours × 8 instances**, tous convergents : 4000 reprises utilisables. Aux anciens plafonds, **17/40 passent et 23/40 restent rouges**. Maximum des médianes **9692 ms**, p95 maximal **9896 ms**, delta registre maximal **+997 ms**. Ces rouges ne sont pas présentés comme verts.

Le profil huit instances représente **160 reprises simultanées sur huit CPU**. Sa référence est figée sur ces maxima ; les marges existantes **500/800 ms** restent les mêmes. Une nouvelle série indépendante, puis le rejeu après le dernier contrôle de délai santé, vérifient les références gelées.

| Gate | Défaut / CI / quatre instances | Huit instances sur huit CPU — proposé |
|---|---:|---:|
| Plafond médian | 8926 ms, inchangé | **9692 + 500 = 10192 ms** (+1266) |
| Plafond p95 | 9798 ms, inchangé | **9896 + 800 = 10696 ms** (+898) |
| Delta registre | +1500 ms | +1500 ms, inchangé |
| Sonde médiane contre node -e | +500 ms | +500 ms, inchangé |

Le pilote choisit ce profil seulement pour huit enfants et huit CPU disponibles ; l'enfant vérifie l'affinité disponible. Les autres exécutions gardent la référence CI. Les gates fresh/resume/restore et systemd restent inchangés. **Les reviewers acceptent ou rejettent cette nouvelle enveloppe et la définition de charge ; aucune clôture de réception n'est présumée.**

## Qualification finale — quatre et huit instances séparées

~~~sh
rtk taskset -c 0-7 node scripts/owner-lab/incident-load.mjs 5 4
rtk taskset -c 0-7 node scripts/owner-lab/incident-load.mjs 5 8
rtk node scripts/owner-lab/incident-load.mjs 3 1
~~~

**Exit 0 pour les trois commandes.** Quatre instances : **20/20 passages**, seuils d'origine. Huit : **40/40 passages**, enveloppe proposée ci-dessus. Solos : **3/3**. Chaque passage conserve cinq fixtures et cent reprises : **6300 reprises utilisables** dans les séries finales, zéro skip.

| Tour | Quatre : médianes (ms) | p95 max | Delta max | Huit : médianes (ms) | p95 max | Delta max |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 4074–4721 | 4842 | +66 | 7536–9236 | 9466 | +585 |
| 2 | 4433–4807 | 4811 | +98 | 7984–9081 | 9385 | +27 |
| 3 | 4642–4797 | 4898 | +101 | 7949–9321 | 9438 | +291 |
| 4 | 4357–4834 | 4854 | +201 | 7706–8860 | 9177 | −59 |
| 5 | 4510–4677 | 4753 | +65 | 8208–9410 | 9658 | +402 |

Solos : médianes **710 / 687 / 702 ms**, p95 **735 / 705 / 738 ms**, deltas **+77 / +11 / +18 ms**. Tous conservent 20/20 utilisables, un host et zéro timeout.

## Contrôles conservés

| Contrôle | Sortie |
|---|---|
| Mutation privée +1 s après shebang, témoin node indépendant | Défaut : **FAIL attendu, 1199 > 500 ms** ; profil huit : **FAIL attendu, 1150 > 500 ms**. Binaire du worktree jamais muté. |
| Runtime ciblé | **610 tests uniques verts**, zéro pending : 609 dans le rejeu combiné, puis les sept assertions op-probe/op-launch-abort rejouées avec le cas supplémentaire de ping suspendu. |
| Publication / crash / release / trust-root | **84 PASS, 0 FAIL, 0 skip**. Inclut FIFO, annulation de création et limite de file. |
| Build | npm run build : **exit 0** ; dernier runtime tsc : **aucune erreur**. |
| Sécurité | audit-security-debt : **exit 0**, zéro moderate+ ; lockfile et registre d'exceptions inchangés. |
| Layering | **130 modules JS**, zéro import exécutable runtime vers core. |
| Isolation / release | Code host-scope/process/session-scope, cleanup always() et contrats exacts inchangés. Les matrices systemd et défaut mémoire restent dans la VM CI jetable. |

La CI du commit livré est suivie jusqu'à son état terminal ; son résultat et ses liens figurent dans le corps de PR. Aucun nouveau consensus indépendant n'est revendiqué : le skill de revue impose une identité complémentaire exacte et le transport installé, indisponibles dans ce confinement.

Confinement : **/home/antoinefa/.cache-tmp/h2a-test/run-ekkPHg**, HOME/XDG/socket privés, uniquement les PIDs créés et vérifiés par les fixtures. Aucun binaire h2a installé, état réel, processus du propriétaire, Python ou test de faute mémoire local. Suppression du TMPDIR confirmée au rapport de livraison ; diagnostics fournis et script non suivi préservés.

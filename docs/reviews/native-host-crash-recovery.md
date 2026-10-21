# Native host crash recovery — preuves du correctif

Le présent document conserve le premier tour. La qualification étendue,
les cgroups réels sur VM jetable et les 81 configurations de démarrage sont
dans le [rapport R2](native-host-crash-recovery-r2.md).

Branche : `fix/native-host-crash-recovery`. Implémentation examinée :
`99cc14a3f` ; base `40693473a`. Aucun binaire installé ni état h2a réel lu ou
modifié. Le script initial non suivi `scripts/owner-lab/restart.test.mjs` et le
diagnostic apparu en parallèle sous `docs/specs/native-host-crash-recovery/`
restent hors de ces commits.

## Diagnostic vérifié directement

| Défaut | Preuve | Correction |
|---|---|---|
| Reprise proportionnelle au registre | Le garde appelle la sonde 500 fois avant de filtrer une conversation. | Filtrer conversation, exclusion et lignes distantes avant `isLive`. Les lignes illisibles de la conversation demandée restent bloquantes. |
| Contentions après crash | Cinq reprises après SIGKILL produisent des refus de verrou/publication. Chaque preuve répète cinq connexions et quatre pauses sous le même verrou. | Pour un lancement seulement, retirer l'inode prouvé mort sous le verrou et après les contrôles d'identité. Une absence sans inode utilise une seule connexion, après les contrôles des propriétaires et avant la revérification du chemin. Les inventaires ne retirent aucun socket. |
| Verdict conservé après publication concurrente | Deux témoins Fleet échouent quand un successeur devient sain pendant la preuve d'absence. | Une nouvelle connexion et un nouvel inventaire peuvent adopter le successeur ; un échec reste inconnu, jamais assimilé à la mort. |
| Domaine mémoire du terminal hérité | Parent et enfant créé avec `detached: true` lisent un `/proc/self/cgroup` identique. | Le host demande son propre scope `app.slice` avant publication/PTY : son PID, `ManagedOOMPreference=avoid`, `MemoryHigh=75%` de la RAM physique. Une réponse systemd n'est acceptée comme isolation qu'après observation du cgroup effectif. Le repli est journalisé. |
| Faux humains | Sur 451 lignes, 360 lignes portant une provenance de délégation passent le filtre ancien ; un transcript ou tmux vivant suffit à promouvoir une ligne sans classe. | Exclure les marqueurs de délégation, conserver les classes humaines explicites et les confirmations explicites ; supprimer la promotion par simple existence. Aucun filtre de nom ou de chemin. |

Journaux système consultés en lecture seule, avec `TZ=America/Toronto` :

```sh
journalctl -b -1 -u systemd-oomd.service --grep='Killed' -n 4 -o short-iso --no-pager
journalctl -b 0 -k --grep='Previous system reset reason' -o short-iso --no-pager
```

Sorties pertinentes, machine et identifiants de scope omis :

```text
2026-10-20T19:01:29-04:00 systemd-oomd: Killed .../vte-spawn-....scope due to memory pressure ... being 83.47% > 50.00% for > 20s with reclaim activity
2026-10-20T19:39:35-04:00 kernel: x86/amd: Previous system reset reason [0x00800800]: internal CPU shutdown event occurred
detachedChildInheritsParentMemoryCgroup: true
```

La mort du scope et la vulnérabilité à l'héritage sont étayées. L'appartenance
historique du PID du host avant sa mort, la consommation par agent et le
déclencheur précis du reset CPU ne sont pas établis par cette investigation.

## RED puis GREEN

Toutes les commandes locales ont été préfixées par `rtk env TMPDIR="$RUN"`.
`RUN=/home/antoinefa/.cache-tmp/h2a-test/run-2jadsY`, créé par `mktemp -d`.
Pour les suites natives utilisant le helper commun :
`H2A_TEST_QUALIFICATION_ROOT="$RUN"`. Aucun fichier de test n'est silencieusement
écarté pour absence d'état réel. Aucun test global exécuté.

| Régression | Commande RED, après le préfixe ci-dessus | Sortie avant correction |
|---|---|---|
| Garde, démarrage et crash | `node --test --test-name-pattern='startup-latency\|crash-recovery' scripts/owner-lab/restart.test.mjs` | `Probed 500 sessions for one conversation` ; 2 échecs et 2 annulations aux budgets 10/32 s ; refus `publication lock timed out`. |
| Demande de scope | `node --test --test-name-pattern='oom-isolation' scripts/owner-lab/restart.test.mjs` | 0 passé / 1 échec : `Native host did not request an independent systemd scope`. |
| Adoption Fleet | `./node_modules/.bin/vitest run packages/h2a-runtime/src/native-terminal/fleet.test.ts` | 8 passés / 2 échecs. |
| Provenance | `./node_modules/.bin/vitest run packages/h2a-runtime/src/restore-provenance.test.ts packages/h2a-runtime/src/restore.test.ts` | 33 passés / 3 échecs : 360 délégués admis et 2 promotions de lignes anciennes. |
| Retrait réservé au lancement | `./node_modules/.bin/vitest run packages/h2a-runtime/src/native-terminal/publication-proof.test.ts` | 28 passés / 1 échec : inode encore présent après preuve positive. |

Le témoin de chemin absent a également montré 5 connexions au lieu d'une
avant correction. Les tests de publication ont ensuite été exécutés en entier.
Une tentative de correction par reconnexion seule n'a pas suffi : la répétition
du témoin concurrent a montré une expiration du superviseur. Le retrait de
l'inode au moment du lancement corrige cette file de preuves redondantes ;
aucun délai de test n'a été augmenté.

Commande de qualification des six scénarios, sur l'implémentation finale :

```sh
rtk env TMPDIR="$RUN" node --test packages/h2a/test/native-host-crash-recovery.test.js
```

```text
tests 6
pass 6
fail 0
cancelled 0
skipped 0
duration_ms 39850.497058
```

| Mesure finale | Résultat | Budget inchangé |
|---|---|---|
| Sondes du garde, 500 lignes / 1 conversation pertinente | 1 | 1 |
| Entrée dans le host, reprise avec 500 lignes | 797 ms | < 2 000 ms |
| Cinq reprises après SIGKILL | 3 948 ms ; 5 codes 0 ; un seul host vivant et cinq sessions | < 20 s pour le scénario |
| Dix reprises avec 500 lignes | 3 118 ms ; 10 codes 0 et dix sessions | < 30 s |
| Frais, médiane vide → 500 lignes | 1 820 → 1 806 ms, delta −14 ms | delta ≤ 500 ms |
| Reprise, médiane vide → 500 lignes | 1 788 → 1 826 ms, delta +38 ms | delta ≤ 500 ms |
| Plan restore, médiane vide → 500 lignes | 748 → 695 ms, delta −53 ms | delta ≤ 500 ms |

Chaque médiane contient trois mesures appariées. Registre mélangé : classes
humaines/background/anciennes, sessions natives/tmux et lignes terminées.
Le nombre de processus auxiliaires est borné dans le test. Ces différences
mesurent le coût du registre ; elles ne prouvent pas une parité de latence
absolue entre h2a et une CLI lancée directement. Le plan utilise le vrai
`restore --dry-run` et les dix reprises exécutent les vraies opérations PTY
avec une CLI factice hors réseau ; aucune qualification GNOME complète n'est
revendiquée.

Autres commandes GREEN, après le même préfixe et avec la racine courte ci-dessus :

```sh
./node_modules/.bin/tsc -b packages/h2a-runtime --pretty false

./node_modules/.bin/vitest run \
  packages/h2a-runtime/src/conv-guard.test.ts \
  packages/h2a-runtime/src/native-terminal/fleet.test.ts \
  packages/h2a-runtime/src/native-terminal/host-scope.test.ts \
  packages/h2a-runtime/src/restore.test.ts \
  packages/h2a-runtime/src/restore-provenance.test.ts \
  packages/h2a-runtime/src/restore-human-sessions.test.ts \
  packages/h2a-runtime/src/restore-convid-reconcile.test.ts
# Test Files 7 passed ; Tests 82 passed

./node_modules/.bin/vitest run \
  packages/h2a-runtime/src/native-terminal/publication-proof.test.ts \
  packages/h2a-runtime/src/native-terminal/fleet.test.ts
# Test Files 2 passed ; Tests 39 passed (Fleet déjà compté ci-dessus)

./node_modules/.bin/vitest run \
  packages/h2a-runtime/src/native-terminal/process.functional.test.ts \
  packages/h2a-runtime/src/native-terminal/server.test.ts \
  packages/h2a-runtime/src/native-terminal/op.test.ts
# Test Files 3 passed ; Tests 86 passed ; aucun skip

node --test packages/h2a/test/native-isolation.test.js \
  packages/h2a/test/native-spawn-guard.test.js \
  packages/h2a/test/restore-dead-session-recovery.test.js
# tests 14 ; pass 14 ; fail 0 ; skipped 0

node --test --test-name-pattern='cold absence|SIGKILL stale historical|SIGSTOP|missing endpoint unknown|live host without .owner|ordinary CLI|CURRENT-boot|attributed previous-boot|concurrent starts' \
  packages/h2a/test/native-inventory-absence.test.js
# tests 12 ; pass 12 ; fail 0 ; skipped 0
```

Compilation : code 0, aucune erreur. Total sans double compte de cette
qualification : **229 tests exécutés et passés, zéro skip**. Une exécution
supplémentaire de `supervisor.test.ts` a exécuté 16 tests et contient un marqueur
documentaire `it.skip` vide, déjà déclaré dans `scripts/test-non-tests-0986.json` ;
elle n'entre pas dans ce total et ne qualifie pas ce marqueur.

Les essais ont aussi révélé deux limites du laboratoire : chemin historique
AF_UNIX trop long dans ce worktree et master PTY nommé `/dev/pts/ptmx` dans le
namespace. Les premières commandes ont échoué respectivement 13/14 et 101/102
tests exécutés. Le helper accepte maintenant la racine cache privée autorisée
avec les mêmes contrôles UID/mode/symlink ; l'oracle FD reconnaît les deux alias
du master sans retirer aucune assertion CLOEXEC ni aucune assertion sur les
descendants. Les commandes GREEN ci-dessus les revérifient.

## Qualification, intégration et limites

Le nouveau laboratoire est découvert par le lanceur Node obligatoire de
`npm test`, donc par la vérification release existante. Ses six identités sont
inscrites dans `scripts/test-inventory.json`. Une sonde de découverte donne :
`Mandatory Node/release discovery: 6 normative lab scenarios present`.
Les nouveaux tests runtime sont également inscrits dans l'inventaire.

Le contrat systemd est vérifié par un bus factice privé, avec refus/repli, et
par les cas unitaires de déplacement effectif/absence de déplacement/délai.
**Un OOM réel et la destruction d'un vrai scope de terminal n'ont pas été
exécutés.** `avoid` est une préférence ; `MemoryHigh` est un seuil souple,
pas une limite dure ni une isolation par worker. Le host et ses PTY partagent
encore leur nouveau scope. Ce correctif ne prétend pas résoudre le reset AMD
ni qualifier des budgets mémoire/concurrence par agent.

Coordination #382 (`5e117c847`) : cette PR ajoute les facettes primary/secondary
et leur opt-in ; conserver ses seconds plans explicites lors de l'intégration
du refus de provenance par défaut et conserver le refus des anciennes lignes
sans preuve d'initiateur. Les tests de 451 lignes et des transcripts/tmux
anciens constituent le témoin à faire passer sur la combinaison. Aucun changement
sur cette autre branche. Le laboratoire d'incident complète celui de #388.

L'état réel du propriétaire est intact. La racine `RUN` est retirée après les
dernières opérations Git ; sa suppression est vérifiée et annoncée dans le
rapport de livraison.

## Revue

```yaml
status: selection-failed
target-ref: 99cc14a3f
review-author:
  host: codex
  model: unknown
  effort: unknown
observed-failure: exact author model/effort unavailable; owner confinement forbids installed-h2a review dispatch and real host access
legs: []
```

La revue locale du diff a été faite ; aucun consensus indépendant
d'implémentation n'est revendiqué. Le diagnostic Astra non suivi a été lu après
les reproductions et corrections ; il n'est pas une revue du correctif.

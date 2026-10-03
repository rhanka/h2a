# Test d’interruption UAT doctor

Branche : `fix/uat-doctor-interrupt-flake`.
Base intégrée : `origin/main`, `4a314f785ba9d590db4ad626fd88bcc37a9435ab`.

## Cause prouvée

Le marqueur `doctor-started` était publié par l’oracle après le build, le
scénario 3 et les snapshots de configuration. Dix démarrages Node précédaient
ce marqueur. Le délai de 5 000 ms mesurait ce parcours complet au lieu de la
condition nécessaire au test d’interruption : l’existence des deux arbres
possédés par le script.

Le journal signalé montre que le scénario 3 avait terminé mais que le marqueur
n’existait pas. Le chemin d’échec du test envoyait alors SIGTERM et récoltait
130 : ce code ne démontrait pas que l’oracle avait commencé.

La reproduction contrôlée retarde de 5 100 ms le démarrage Node qui charge le
contrat pour le snapshot, en conservant ce retard dans les deux variantes.
Avant : même attente expirée et enfant récolté en 130. Après : interruption
avant ce démarrage, au build npm simulé. Le build publie la barrière après
création des deux arbres, puis reste actif. Les assertions vérifient les deux
arbres, l’absence de scénario doctor, le code 130 et leur suppression.
Aucun délai du dépôt n’est modifié.

## RED-first et mesures de cette reprise

La copie avec les assertions finales et la fixture npm d’origine échoue
2/2 fois (SIGINT et SIGTERM), sur l’assertion de phase. Le correctif de fixture
passe ensuite ces deux assertions.

Campagnes : quatre processus CPU au maximum, tous épinglés avec les tests aux
cœurs 0–3. Cinq passages par version ; chaque passage teste SIGINT et SIGTERM.
Les campagnes anciennes à plus de quatre processus sont exclues des taux de
cette reprise.

| Version | SIGINT avant → après | SIGTERM avant → après |
| --- | --- | --- |
| Node 22.22.1 | 5/5 → 0/5 | 5/5 → 0/5 |
| Node 20.20.2 | 5/5 → 0/5 | 5/5 → 0/5 |

Total contrôlé : 20 échecs / 20 interruptions avant, 0 / 20 après.
Pour SIGTERM seul : 10/10 (100 %) → 0/10 (0 %).

Le fichier original corrigé est également vérifié intégralement :
22 tests, 22 réussites, 0 échec, 0 annulation, 0 ignoré, 0 TODO.

Journaux et scripts reproductibles : `tmp/uat-flake-evidence/h-cond-*`.
Ces instruments restent ignorés ; ils ne changent pas le code livré.

## Validation et livraison

Une suite `npm test` complète est requise sur cette branche, après celle de
`fix/test-flakes-central-drive`, avec un `REMOTE_CLI_CONFIG_HOME` jetable.
Synchronisation finale : `origin/main` à
`8c1912d7dfed785272d7cfe5feae79333ca3919b`, par avance rapide. Les événements
Track restent ceux de la base ; aucun changement `.track` n’est livré.
Validation complète et push en attente de la fin de la suite release h2a.
Décision h-cond : avant chaque suite, contrôle `ps` des runners et de leur cwd
sous `/home/antoinefa/src/h2a`. La suite externe bpmn-canvas, groupe 933523,
ne compte pas dans cette contrainte. Aucune nouvelle campagne de charge.

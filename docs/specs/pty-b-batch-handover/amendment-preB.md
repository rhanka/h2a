# Proposition d’amendement — admission des propriétaires pré-B déjà chargés

2026-10-18 · PR #375 · base `d91a53ffea14a31f6111fc784553f12f0f8ac20a`.
**Non ratifié ; destiné à deux revues indépendantes. Implémentation arrêtée.**

## Problème et preuve

B5 impose de refuser toute création après drainage, y compris sur une connexion
v1 préexistante. Les amendements approuvés autorisent `deferred` pour préserver
les sessions, mais maintiennent ce critère obligatoire et bloquant
(`BRANCH.md:225–234`). Les confirmations Astra et Sol signalent donc le même P1.

Le processus fusionné pré-B exécute directement `dispatch → host.create`
(`server.ts:254,1991`). Il ne consulte pas `.draining` et n’a aucune commande de
gel/rechargement. Ses signaux d’arrêt passent par `stopAll`, puis éventuellement
`forceStopAll` (`process.ts:189–205,234–236`). Le contrôle du propriétaire B
(`owner-process.ts:362`) ne se trouve pas sur ce chemin.

Ajouter un contrôle au nouveau `host.ts` ou `server.ts` ne modifie pas les modules
déjà chargés d’un ancien processus. Faire tourner cette nouvelle implémentation
comme « ancien hôte » dans la fixture masquerait précisément le contre-exemple.
Un proxy ou un refus client ne couvre pas les connexions v1 déjà acceptées.
Un arrêt/redémarrage avec sessions viole D4/D5 ; un `list` vide suivi d’un signal
conserve la course avec une création. Aucune primitive de gel rétroactif
compatible Linux/macOS n’existe dans le contrat approuvé.

Preuve ciblée Linux, HOME/XDG/TMPDIR privés via le helper inchangé :

| Exécution de `legacy-drain.functional.test.ts` complet | Résultat observé |
|---|---|
| Test hérité inchangé, Node 22.22.1 | 8 réussis, 0 échec, 0 ignore/TODO, exit 0 ; le cas du marqueur exige que les deux créations réussissent. Ce vert ne clôt pas B5. |
| Assertion stricte temporaire du refus, Node 22.22.1 | 7 réussis, 1 échec, 0 ignore/TODO, exit 1. |
| Même assertion stricte, Node 24.22.0 | 7 réussis, 1 échec, 0 ignore/TODO, exit 1. |

Dans les deux rouges : attendu `["rejected","rejected"]`, reçu
`["fulfilled","fulfilled"]` pour les connexions établie et nouvelle. Avant
l’assertion, les échanges et le PID/start-time de la session préexistante sont
vérifiés inchangés. Aucun contrôle de production n’a été modifié.

Commandes exécutées depuis `/home/antoinefa/src/h2a/tmp/worktrees/ptycode` :

```sh
rtk node tmp/pty-am2-run.mjs pty-preb-baseline22 node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=2 packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts
rtk node tmp/pty-am2-run.mjs pty-preb-contract-red22 node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=2 packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts
rtk env PATH=/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin:/usr/local/bin:/usr/bin:/bin node tmp/pty-am2-run.mjs pty-preb-contract-red24 node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=2 packages/h2a-runtime/src/native-terminal/legacy-drain.functional.test.ts
```

Sorties et rapports : `tmp/pty-preb-{baseline22,contract-red22,contract-red24}.{log,json}`.
Renforcement reproductible : `tmp/pty-preb-contract-red.patch` et copie du test
dans `tmp/pty-preb-contract-red.test.ts`. Le fichier suivi a été restauré à
l’octet près : SHA-256 `2834ab42944c62249f7fa8a7e715fb5eeaf9af357da61c6c52e8a87b99fd7a67`.
`git status --porcelain` et `git diff --stat` sont vides après restauration.

## Options et conséquences

| Option | Contrat et conséquences |
|---|---|
| A — Exception explicite des pré-B non coopérants déjà chargés | Modifier D5/B5 pour autoriser expressément leurs créations, même après marqueur et sur connexion v1 établie. Conserver endpoint, sessions, installations et `admission: unfenced`, `retirement: deferred`. Le gate B5 peut réussir avec cette exception déclarée si tous ses autres critères réussissent. Aucune garantie de refus ni de retrait automatique n’est annoncée pour ces hôtes ; leur présence peut durer indéfiniment. |
| B — Conserver l’exigence universelle actuelle | PR/B5 restent bloqués pour un déploiement avec pré-B non coopérant. Attendre la fin volontaire de ces processus et de leurs clients, puis prouver l’absence des anciens endpoints avant qualification ; aucune course `list`/signal n’est autorisée. Un futur build de transition peut intégrer une barrière propriétaire, mais son installation ne clôt pas les admissions d’un processus antérieur encore chargé. |

## Recommandation soumise aux deux revues

**A**, si l’owner accepte cette réduction explicite de la garantie de transition.
C’est un changement de contrat, pas une correction technique du pré-B. Le
passage ci-dessous remplacerait uniquement l’obligation universelle d’admission
et de retrait pré-B de D5/B5 et les passages correspondants des amendements :

> Un processus pré-B déjà chargé, dépourvu de barrière propriétaire effective sur
> toutes ses connexions, est exempté du refus de nouvelles créations. Un marqueur
> ne le place pas dans un état de drainage garanti. Il reste accessible,
> inventorié `unfenced/deferred`, avec ses installations conservées, sans signal,
> retrait automatique ni migration de ses sessions. B5 peut être qualifié avec
> cette exception explicitement rapportée ; le verdict nomme les propriétaires
> coopérants couverts et les pré-B exclus de la garantie. La barrière demeure
> obligatoire et testée pour chaque propriétaire coopérant, quel que soit le
> protocole client/frontend. Aucun lot L ne commence sur une plateforme tant
> qu’un pré-B non coopérant y subsiste ou que son absence reste inconnue.

Le contre-exemple v1 hérité reste obligatoire et inchangé. Les courses de
création/retrait, la préservation des sessions, les barrières B et l’inventaire
des deux générations restent testés. Aucun test ignoré, TODO, annulation, retrait
de scénario ou contournement de cohorte réelle ; D27 et les gates Linux/macOS
restent applicables. Sans accord sur A, retenir B et garder le P1 ouvert.

## Limites et suite attendue

Deux revues indépendantes doivent accepter le texte normatif et ses conséquences
avant ratification de l’owner et reprise du code. Aucun consensus n’est annoncé.
Après ratification seulement : mettre la spec/BRANCH en cohérence et rejouer les
fichiers ciblés B5 sur Linux puis macOS ARM64, Node 22/24, avec cohorte réelle
non vide et zéro ignore. Les CI Linux/macOS, un véritable binaire historique et
les CLI enrôlés n’ont pas été qualifiés ici. Aucun vert après correction, commit
ou push ; aucune modification suivie du dépôt n’est laissée par cette analyse.

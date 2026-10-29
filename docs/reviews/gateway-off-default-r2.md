# PR #395 — reprise du tour 2

État reçu : worktree propre, HEAD et origin/fix/gateway-off-by-default à
`e627645a4d546389f4702587ce024ac76609414a`, aucun commit en avance/retard,
PR ouverte, 16 checks réussis. Base `origin/main = 912dd3035` déjà ancêtre.
Les commits `a1835d4d7`, `e284e25ce` et `e627645a4` sont conservés.

Les deux revues indépendantes fournies portaient sur `a1835d4d7`, avec verdict
NON-FUSIONNABLE. Le présent travail traite leurs cinq constats :

| Constat | Correctif et témoin exécuté |
| --- | --- |
| Consentement transféré au réemploi du nom | `registry.ts` lie le pin à convId/cwd/tool et efface conversation/pin lors d'un run frais. `gateway-off-default.test.ts` : nouvelle conversation puis deuxième reprise, et run frais au même nom. |
| `relaunch --apply` non forcé sans purge | Résolution du pin et commande `env -u` juste devant le CLI ; un faux CLI exécuté dans un vrai shell pollué reçoit uniquement sa clé native. |
| Purge avant `bash -lc` | Les trois wrappers purgent après l'init fictive. Un contrôle sans garde prouve que la fixture réexporte URL/bearer. Le marqueur vaut explicitement 0 en gateway, y compris s'il était hérité à 1. Les chemins native et tmux partagent ces wrappers. |
| Clé native perdue dans une flotte mixte | Capture/restauration de l'environnement par itération ; gateway A puis direct B garde la clé native de B et restaure le parent. |
| Provisioning/refresh distants implicites | Choix `llmGateway` explicite transmis CLI → requête → descriptor → provisionneur → Pod ; URL/token globaux insuffisants. Hard refresh réacquiert seulement pour une session explicite. Soft refresh exécute un scrub au dernier moment, clé native conservée, ancien bearer `gw-*` supprimé. |

Un opt-in distant indisponible renvoie 503 avant provisioning/refresh ; aucun
repli direct silencieux. URL manquante, erreur HTTP, exception réseau et token
vide sont couverts. Le builder refuse aussi un Pod gateway sans URL/token.

## RED puis GREEN de reprise

Les correctifs poussés avant la reprise ne sont pas réécrits. Leur RED est
rejoué en remplaçant temporairement les sources de produit par celles de
`a1835d4d7` (index, registre, routes sessions, spec/provisioner k8s et soft
refresh), puis en restaurant les octets courants dans un `finally`.
Pour tmux, seule la nouvelle prologue des wrappers est retirée afin de garder
les helpers de test : c'est le comportement enfant de l'ancien code.

Commande commune, dans le worktree, avec TMPDIR privé :

```sh
rtk node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/gateway-off-default.test.ts \
  packages/h2a-runtime/src/tmux-wrapper-scrub.test.ts \
  packages/h2a-runtime/src/remote-gateway-consent.test.ts \
  packages/h2a-runtime/src/soft-refresh.test.ts
```

| Exécution observée | Résultat |
| --- | --- |
| Replay des sources fautives avant les corrections complémentaires | exit 1 : 22 échecs / 131 réussites / 0 ignoré. Chaque constat des deux revues échoue. |
| HEAD reçu + nouveaux contrôles | exit 1 : 8 échecs / 138 réussites / 0 ignoré (run frais, marqueur hérité, indisponibilité distante). |
| Contrôles remote supplémentaires | exit 1 : 7 échecs / 102 réussites / 0 ignoré (dont le choix global hérité par le provisionneur). |
| Enfant réel soft refresh, source de `a1835d4d7` | exit 1 : 1 échec / 6 réussites / 0 ignoré ; URL encore présente dans l'enfant. |
| GREEN avec les cinq fichiers voisins ci-dessous | exit 0 : 407 réussites / 0 échec / 0 ignoré. |
| Suite distante sans aucun `dist` des deux workspaces remote | exit 0 : 109 réussites / 0 échec / 0 ignoré. Les imports de test chargent les vraies sources. |

Le GREEN ajoute aux quatre fichiers communs : `structured-gateway.test.ts`,
`registry.test.ts`, `tmux.test.ts`, `conv-guard-wiring.test.ts`, `attach.test.ts`,
tous sous `packages/h2a-runtime/src/`.
Compilation : `rtk node_modules/.bin/tsc -b packages/h2a-runtime --pretty false`,
et `rtk node_modules/.bin/tsc --noEmit -p <workspace>/tsconfig.json --pretty false`
pour `apps/control-plane` et `packages/remote-k8s-orchestrator`, trois exit 0.

## CI et limites de preuve

`remote-gateway-consent.test.ts` importe les suites réelles routes, builder,
provisioner et schémas dans le gate h2a-runtime exécuté par `npm test`.
Les autres régressions sont également dans `src/**/*.test.ts`. Aucun gate ni
filtre de test n'est affaibli. Seuls les fichiers ciblés sont exécutés localement.

HTTP en mémoire, k8s simulé, faux CLI et vrais enfants shell ; aucun fournisseur,
gateway ou cluster réel, binaire h2a installé ou état personnel utilisé.
TMPDIR de reprise : `/home/antoinefa/.cache-tmp/h2a-test/run-ieKzxe`, à supprimer
après les derniers consommateurs. Aucun nouveau consensus indépendant revendiqué :
`status: selection-failed`, auteur exact des correctifs hérités non attesté et
outil MCP h2a absent ; le binaire installé est interdit par le brief.

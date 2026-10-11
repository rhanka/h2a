# Terminal multi-workspace — POC isolé

Un client plein écran, deux rangées d'onglets et un seul terminal visible.
Les sessions restent dans les PTY de l'hôte natif du worktree. Les émulateurs
VT sont alimentés hors focus pour conserver leur écran lors des bascules.
Aucun changement de code de production, aucune nouvelle dépendance.

Depuis `/home/antoinefa/src/h2a/tmp/worktrees/poc-mwt`, avec les dépendances
du worktree disponibles (`tsx`, `node-pty`, `@xterm/headless`) :

```sh
rtk node --import tsx poc/multi-workspace-terminal/demo.ts
```

La démo crée un `mkdtemp`, deux faux workspaces et trois sessions : compteur,
question y/n et idle. Elle démarre directement
`packages/h2a-runtime/src/native-terminal/process.ts` depuis les sources,
avec HOME, H2A_ROOT, XDG_RUNTIME_DIR, XDG_STATE_HOME, XDG_CONFIG_HOME et
registre entièrement temporaires. Elle imprime le chemin de `sandbox.json`
et une commande exacte à lancer depuis un deuxième terminal du même worktree.
Le détachement ferme la démo et arrête uniquement son propre hôte.

| Touche | Action |
|---|---|
| Ctrl-W | Workspace suivant ; retrouve sa session sélectionnée |
| Ctrl-N / Ctrl-P | Session suivante / précédente |
| Ctrl-\\ | Détachement ; les sessions continuent jusqu'au teardown de la démo |
| Autres touches | Entrée du PTY focalisé |

L'entrée équivalente à `h2a run <cli> --name X` est :

```sh
rtk node --import tsx poc/multi-workspace-terminal/cli.ts run --sandbox /CHEMIN/IMPRIME/sandbox.json --workspace /CHEMIN/IMPRIME/workspaces/repo-alpha --name counter -- /usr/bin/node /home/antoinefa/src/h2a/tmp/worktrees/poc-mwt/poc/multi-workspace-terminal/stub.mjs counter
```

Utiliser la commande imprimée par la démo pour remplacer les chemins temporaires.
Le workspace est un répertoire canonique explicite, normalement la racine du
repo. Workspace + nom identifient la session. Si elle est vivante, `run` focalise
le client existant et conserve son PTY et le PID de session. Sinon il la crée.
Si aucun client n'est ouvert, il démarre le client sur le terminal appelant.
Le socket de focus transporte des demandes d'interface ; le backend PTY reste
le protocole natif (`list`, `state`, `attachObserver`, `readOutput`, baux,
`write`, `resize`, `create`). Aucune découverte d'hôte par défaut.

Pour enregistrer la preuve sans asciinema :

```sh
rtk node --import tsx poc/multi-workspace-terminal/demo.ts --record poc/multi-workspace-terminal/artifacts
```

La preuve lance le véritable client dans un PTY de l'hôte temporaire et capture
ce PTY avec l'opération native `capture --socket <socket-temporaire> --id
__poc_observer_ui`. Ce PTY observateur est exclu des onglets. Les onze captures
et les reçus de création/focus sont dans [le transcript](artifacts/demo-transcript.md).
Seuls les espaces de remplissage et lignes vierges finales sont retirés des captures versionnées.
Toutes les assertions doivent passer ; aucune absence d'état réel ne produit un skip.

| Badge | Source |
|---|---|
| running | Sortie reçue il y a moins de 1,5 s |
| waiting-for-input-question | Dernière ligne visible : y/n, yes/no, « press enter », « continue? » ou finissant par `?` |
| idle | Silence depuis au moins 1,5 s |
| exited | État fourni par l'hôte natif |

Priorité du workspace : question, running, idle, puis exited si tout est sorti.
Les trois premiers badges sont des estimations, pas des événements h2a attestés.

Tests ciblés uniquement :

```sh
rtk node --import tsx --test poc/multi-workspace-terminal/model.test.ts
rtk node --import tsx --test poc/multi-workspace-terminal/screen.test.ts
rtk node --import tsx --test poc/multi-workspace-terminal/integration.test.ts
rtk node node_modules/typescript/bin/tsc -p poc/multi-workspace-terminal/tsconfig.json
```

Limites : perte de cellules si le journal natif de 4 MiB est déjà tronqué à
l'attache (avertissement visible), pas de souris ni scrollback interactif,
pas de réponses VT hors focus, pas de tests avec les véritables CLIs/providers,
ni de reprise après crash ou panne d'hôte. Les requêtes VT historiques sont
rejouées pour reconstruire l'écran, leurs réponses ne sont pas soumises comme
nouvelles entrées. La reconstruction après redémarrage ne connaît pas toute
l'histoire des redimensionnements. Les onglets longs sont tronqués ; largeur
Unicode et défilement de la barre ne sont pas gérés. Le rendu repeint l'écran
à 10 Hz. Deux `run` simultanés vers un client déjà lancé sont sérialisés ; deux
premiers lancements sans client peuvent se disputer le verrou. Le focus change
la vue dans le terminal attaché, sans relever la fenêtre de l'émulateur système.

Une version de production doit intégrer les événements de présence/questions
h2a, un snapshot VT complet avec séquences/dimensions, le multiplexage des
réponses VT et modes souris, une admission/reconnexion robuste, les vrais
providers et profils de lancement, les droits d'entrée, le scrollback et un
rendu incrémental. Le registre POC et son socket de focus doivent être intégrés
au cycle de vie natif plutôt que devenir un second backend.

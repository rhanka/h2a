# Restauration des modes du terminal après attach natif

Branche : `fix/attach-terminal-mode-restore`, base `db12b3b7`.
Commit du correctif et des tests : `41faf4a`.
Qualification du 2026-10-04, uniquement sur des hôtes, sockets et PTY privés.
Aucune publication, aucun accès au socket natif ou aux sessions du propriétaire.

## Cause et trajet des octets

L'application interne émet les séquences VT sur son PTY. Le host les conserve
dans son replay (`packages/h2a-runtime/src/native-terminal/host.ts:1015`).
L'attach les écrit sur stdout, qui est le terminal extérieur
(`packages/h2a-runtime/src/native-terminal/op.ts:595`). Avant correction,
`op.ts:516` à la base écrivait directement `chunk.data` et le seul nettoyage
terminal, `op.ts:552`, était `stdin.setRawMode(false)`. Les termios du PTY
et les modes du terminal VT sont deux états différents : quitter le mode brut
ne désactive pas le focus reporting. Le shell reçoit donc encore les événements
focus et affiche `^[[O^[[I`.

L'attach ne crée pas lui-même les DECSET de Claude : il les transporte.
Le programme de régression émet explicitement focus, paste, souris, écran
alternatif, curseur caché et kitty sur un vrai PTY, puis la sortie capturée du
PTY extérieur prouve leur propagation et l'absence de nettoyage à la base.
Les autres modes du tableau sont vérifiés par les tests unitaires ; aucune
session Claude active n'a été utilisée pour attribuer ses séquences internes.

Le lanceur natif hérite des descripteurs du terminal réel
(`packages/h2a-runtime/src/native-host.ts:714`). Le wrapper partagé lançait
l'application puis exécutait le shell de login sans nettoyage
(`packages/h2a-runtime/src/tmux.ts:116`). Sa version native demande désormais
un reset sélectif avant le message de sortie et avant chaque prompt hérité.
Le host remplace la requête privée par les resets calculés, même sans attach
(`host.ts:1011`), et l'attach sait aussi la consommer pour un ancien host qui
la relaie textuellement (`op.ts:372`).

`h2a_expected_parent` appartient à la garde Linux des processus, pas à une
boucle de relance d'application (`packages/h2a-runtime/src/pty.ts:9`). Sa boucle
`wait` attend le même enfant (`pty.ts:23`). Elle contient la mort du host mais
n'écrit aucun reset sur le terminal extérieur. Les relances via shell/tmux
passent par `relaunchInSession` (`tmux.ts:2365`) ; une recréation native termine
l'ancien PTY, donc l'ancien attach nettoie ses modes avant de sortir.

## Modes : émetteur et reset

Pour le chemin natif, « application » signifie l'émetteur des octets PTY ;
l'attach les relaie, puis nettoie seulement les modifications encore actives.
Le calcul est dans `terminal-modes.ts:103`, la restauration dans
`terminal-modes.ts:118`. Aucun RIS ni reset global n'est émis. Un RIS reçu de
l'application est observé pour éviter des resets devenus inutiles.

| Mode | Qui l'active sur le chemin natif | Reset sélectif |
| --- | --- | --- |
| Focus `?1004` | Application, `CSI ?1004h` | `CSI ?1004l` |
| Bracketed paste `?2004` | Application ou readline au prompt | `CSI ?2004l` |
| Souris `?1000/1002/1003/1006/1015` | Application, DECSET correspondant | DECRST correspondant pour chaque mode actif |
| Écran alternatif `?1049/47/1047` | Application | DECRST correspondant avant retour au shell |
| Curseur caché `?25l` | Application | `CSI ?25h`, seulement si caché |
| Curseurs applicatifs `?1` | Application | `CSI ?1l` |
| Pavé applicatif `ESC =` | Application | `ESC >` |
| Sortie synchronisée `?2026` | Application | `CSI ?2026l`, en premier |
| Kitty `CSI >flags u`, `CSI <n u` | Application, pile propre à chaque écran | Pop exact des pushes restants avant de quitter leur écran |
| Kitty direct `CSI =flags;operation u` | Application | `CSI =0u` seulement si la base a été changée |
| modifyOtherKeys `CSI >4;n m` | Application | `CSI >4;0m` si encore actif |
| Mode brut de stdin | Attach, `op.ts:525` | État initial de stdin, `op.ts:640` |
| Séquence de contrôle incomplète | Application | CAN avant les resets, pour empêcher leur absorption |

Le parser garde les CSI coupés entre chunks, ignore OSC/DCS/SOS/PM/APC et
borne ses buffers et piles. Les tests parcourent toutes les coupures d'une
séquence de modes combinée ainsi que des chunks d'un caractère.

## Sorties et reconnexion

Les références « base » désignent `db12b3b7`, avant modification.

| Chemin | Trou à la base | Traitement actuel |
| --- | --- | --- |
| Ctrl-\\ / buffer d'entrée plein | `op.ts:400`, `:405`, enfin termios seul `:552` | `finally`, resets VT puis restauration stdin (`op.ts:630`) |
| Fin/crash de l'application | `op.ts:532`, termios seul | Même `finally`, sans arrêter une autre session |
| Socket fermé / timeout / écriture incertaine | `op.ts:464`, `:546`, modes maintenus pendant recovery | Reset pendant interruption (`op.ts:544`), puis restauration des modes à reconnexion |
| Mort du host / socket disparu | `op.ts:489`, `:539`, termios seul | Reset local sans dépendre d'un host encore vivant |
| SIGTERM/SIGHUP/SIGINT/SIGQUIT sur attach | Aucun handler de nettoyage VT | Handlers et écriture synchrone (`op.ts:310`, `:407`) |
| Exception non interceptée / sortie du processus | Pas de nettoyage VT | `uncaughtExceptionMonitor` et `exit` (`op.ts:315`) ; l'erreur reste fatale |
| EOF stdin | Pas de détachement explicite | Fermeture de l'observateur puis `finally` |
| Retour au shell / incarnation suivante | Wrapper sans reset, `tmux.ts:116` à la base | Marqueur avant retour et hook de prompt natif (`tmux.ts:118`) |
| SIGKILL de l'attach | Impossible à intercepter | Reçu privé et parent survivant (`attach-recovery.ts:20`, `native-host.ts:714`) |

Le replay conserve un checkpoint des modes et du parser avant les chunks
encore disponibles (`replay-buffer.ts:96`, `:126`). Après une éviction,
l'attach nettoie son ancien état, applique ce préfixe, puis relaie les chunks
retenus (`op.ts:586`). Le curseur de replay avance même si un gros chunk a été
entièrement évincé. Une reconnexion sans trou rétablit les modes de l'attach
avant de continuer au même numéro de séquence, sans dupliquer les pushes kitty.

Le parent conserve un reçu atomique, dans un répertoire temporaire privé,
avant de relayer les changements de modes. À la fin du sous-processus, il
écrit les resets qui restent et restaure les termios sauvegardés avec `stty`.
La vérification réelle `stty -g` avant/après a révélé que libuv peut considérer
son handle parent déjà en mode normal et ne rien faire lorsque l'enfant a
modifié les termios du noyau ; le snapshot réel corrige ce cas.

## Chemin tmux

`attachLocalSession` lance le client tmux avec les descripteurs hérités, ou
fait `switch-client` lorsqu'il est déjà dans tmux (`tmux.ts:2111`). Les octets
de l'application sont interprétés par tmux : c'est son client qui active et
restaure les modes du terminal extérieur. h2a configure notamment souris et
focus-events (`tmux.ts:90`, `:752`). Le lancement direct de reprise à
`index.ts:5776` est dans une pane tmux existante : il ne contourne pas ce client.

Un serveur tmux 3.6 privé, sans configuration personnelle, a été lancé par le
test, attaché sur un PTY extérieur puis détaché par Ctrl-b d. L'observation
contient les activations `?1049`, `?2004`, `?1000` et leurs resets, ainsi que
`?1004l`, le retour au clavier normal et le curseur visible. Aucun mode suivi
ne reste actif. L'activation du focus extérieur dépend de la négociation tmux
avec le terminal ; elle n'est pas revendiquée dans cette fixture.

## RED → GREEN et vérification

Les reçus locaux sont dans `tmp/terminal-mode-evidence/` (ignoré par Git).
Les premiers problèmes de chargement des dépendances ne comptent pas comme
RED : l'installation locale suit le lockfile et le loader TS a un chemin absolu.

| Régression | RED observé | GREEN |
| --- | --- | --- |
| Tracker initial | 4 échecs, 2 réussites ; reset reçu vide | Les 9 tests unitaires passent |
| Host réel + PTY extérieur | 6 fins testées sans aucun reset ; 7 tests échoués au total | Sortie/crash interne, mort du host, quatre signaux, detach et re-attach passent |
| Replay tronqué | Focus/paste perdus au checkpoint | État et CSI partiel préservés |
| Wrapper natif | Aucun reset avant `[h2a]`, focus conservé | Reset avant message, puis entre commandes du shell |
| SIGKILL avec parent | Sortie arrêtée à `ready`, sans reset | Reset exact et session interne encore vivante |
| Termios après SIGKILL | Modes VT propres mais `stty -g` différent | Snapshot réel restauré à l'identique |
| Ancien host verbatim | Marqueur visible, focus actif | Marqueur consommé et reset exact |
| RIS émis par l'application | Resets superflus malgré RIS | Aucun reset supplémentaire |

La première fixture de replay utilisait un chunk plus gros que son budget,
ce qui évincait aussi le marqueur de readiness ; elle a été corrigée pour
émettre un tail distinct avant la vérification de re-attach.

Commande de qualification : `node node_modules/vitest/vitest.mjs run` avec
les neuf fichiers concernés, `--maxWorkers=1 --no-file-parallelism`, et
`REMOTE_CLI_CONFIG_HOME` / `H2A_NATIVE_SOCKET` imposés dans le scratch privé.
Résultat final : **207 réussites, 1 test ignoré par l'environnement**.
Cela inclut 12 scénarios fonctionnels sur PTY, les modes et le replay,
ainsi que les contrôles host/server/tmux/native-host existants.
`npm run build:h2a` et `git diff --check` passent.
Aucune suite complète n'a été lancée pendant l'expérience parallèle.

## Limites

SIGKILL ne peut pas être intercepté par l'attach. Le nettoyage automatique
supplémentaire exige que son parent h2a survive, que le terminal reste accessible
et, pour les termios POSIX, que `stty` soit disponible. Tuer aussi le parent
avec SIGKILL ou lancer directement `op attach` sans parent protecteur ne permet
aucune garantie de nettoyage. Cette limite s'applique également à un client
tmux tué par SIGKILL ; le reçu ajouté ici appartient au chemin natif.

Un ancien host ne fournit pas les checkpoints de modes : après éviction de
ses séquences d'activation, leur état ne peut pas être deviné par un nouvel
attach. La qualification du replay tronqué utilise le host corrigé ; aucun
host existant du propriétaire n'a été remplacé ou arrêté. Le hook de prompt
est transmis par l'environnement ; un profil qui remplace `PROMPT_COMMAND`
peut le remplacer, sans affecter le reset explicite avant le shell initial.
Les modes extérieurs antérieurs à l'attach ne sont pas interrogés : les resets
visent un terminal de shell normal et uniquement les changements observés.

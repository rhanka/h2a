# Plan fusionné Opus / Astra — 2026-10-11

Périmètre : ce répertoire seulement ; Node/JS, node-pty 1.1.0, setpriv et bash
réels. Aucun import du dist installé, appel h2a, scan global de /proc ou action
sur une session existante. HOME/XDG_RUNTIME_DIR/TMPDIR/H2A_ROOT sont des mkdtemp.
Les lectures /proc et signaux sont limités à self et aux naissances lancées par
le banc. Les gardiens conservent leur confinement par groupe dans leur fixture.

| Lot | Origine | Essai et critère |
|---|---|---|
| Référence | E1-E5, Astra S0 | Guardian exact copié du source ; stubs silencieux, TUI, gros flux, sortie, résistant HUP et petit-enfant ; canal privé des identités. FD/PGID/SID/TTY/naissances et séquences mesurés. |
| C nominal | Opus S1, Astra S2 | 32 PTY × 20 exec ; 4 PTY × 100 exec ; même naissance, nouveau build, I/O exactes, resize, ancienne lease refusée, pas de doubles writers ; FD stables, RSS ≤ +25 %, p99 < 1 s (plus strict qu'Astra ≤ 2 s). |
| Listener/attach | Opus S3-S4 | Socket hérité, connect à cible 1 kHz, ensure concurrent sans deuxième publication. Client neuf et logique attach historique depuis le source du checkout, pas le dist installé. Zéro ENOENT/ECONNREFUSED. |
| Sorties | E3, Opus S2, Astra S4 | Sortie 0/7/signal avant, pendant, après ; compter une seule fois ; exposer les zombies et toute issue perdue. |
| Fautes C | Opus S5, Astra S4 | Mort réelle owner, dernier master fermé, exception d'adoption, exec de retour ; checkpoint/fd/candidat invalides refusés avant exec ; abort natif distinct d'un rollback. Écritures partielles et livraison incertaine sans replay automatique. |
| B | Opus S6, Astra S4 | Keeper autoritatif lit même sans clients ; SIGKILL frontal ×20, nouveaux frontaux publiés par rename sous connect ; replay, leases, quotas/gaps et PID des CLI intacts. |
| FD | E1, Opus S7 | Rouge avec guardian exact : master étranger hérité. Vert avec fermeture FD ≥3 dans la variante expérimentale ; owner garde masters non CLOEXEC. |
| Matrice | Deux études | Node 22.15 exact si téléchargeable, 22 corrigé disponible et 24 ; Node 20 et 22 pré-22.15 refusent explicitement C et restent utilisables pour B. Aucune absence transformée en skip réussi. |

Tous les essais s'exécutent par fichiers `node --test <file>` ciblés. Logs,
manifestes, erreurs et mesures sont conservés ici. Le témoin C natif et le
binding SCM_RIGHTS/waitpid proposés par Astra sont exclus par la contrainte
Node/TS du propriétaire ; les limites JS sont elles-mêmes des résultats.

Le lanceur bwrap est indisponible (création de namespace refusée avant la
commande). Les commandes autorisées passent donc par l'approbation automatique,
avec isolation des données par environnement et liste de PID, sans promesse de
namespace Linux. Ce défaut du banc est une déviation à publier.

Les instructions harness sont appliquées pour le périmètre et les tests ciblés.
BRANCH.md/.track restent intacts par règle propriétaire. Aucun lancement de revue
via le h2a réel n'est admissible ; aucun consensus externe n'est revendiqué.

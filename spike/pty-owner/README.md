# Spike PTY owner

Lire [REPORT.md](REPORT.md) et [PLAN.md](PLAN.md). Ce code est un banc jetable,
pas un backend à intégrer. Tout changement du produit demeure une décision du
propriétaire après les mesures.

Pré-requis : Linux, Node, node-pty **1.1.0 du checkout** déjà compilé, bash,
setpriv, TypeScript et esbuild du checkout. Aucun h2a installé n'est appelé.
Les chemins Node20/24 de `campaign.mjs` sont ceux de cette machine ; les adapter
sur un autre runner. `runtimes.mjs` télécharge 22.15 et 22.14 officiels, vérifie
SHA-256 et extrait sous mkdtemp. Les archives ne sont pas commitées.

```
rtk node spike/pty-owner/runtimes.mjs spike/pty-owner/results/downloaded-runtimes.json
rtk bash -c 'ulimit -c 0; node spike/pty-owner/campaign.mjs'
rtk bash -c 'ulimit -c 0; node spike/pty-owner/supplement.mjs'
rtk node spike/pty-owner/summarize.mjs
```

La campagne énumère les fichiers ciblés et construit un environnement privé
pour chaque driver. Elle n'exécute jamais la suite du dépôt. Un exit 0 de la
campagne signifie que les observations attendues ont été reproduites, y compris
les critères rouges ; **cela ne signifie pas que le contrat complet C est vert**.
Les sorties TAP, commandes, compteurs et SHA-256 des sources sont dans
`results/final/manifest.json` et les logs associés.

Pour un seul fichier, créer aussi l'environnement temporaire du driver :

```
rtk bash -c 'spike_env=$(mktemp -d); HOME="$spike_env" XDG_RUNTIME_DIR="$spike_env" TMPDIR="$spike_env" H2A_ROOT="$spike_env" node --test spike/pty-owner/nominal.test.mjs; result=$?; rm -rf "$spike_env"; exit "$result"'
```

Rouges de référence : `SPIKE_HYGIENE=0` pour `fd-hygiene.test.mjs`,
`SPIKE_DIRECT_LISTENER=1` pour `listener.test.mjs`, `SPIKE_B_ACTIVATION=0`
pour `split.test.mjs`, `SPIKE_REQUIRE_EXITS=1` pour `exits.test.mjs`.
Sans `SPIKE_REQUIRE_EXITS`, le fichier **affirme la reproduction** de l'issue
perdue ; il ne corrige pas la course.

L'adoption utilise le fork/resize privés de node-pty et des reads/writes sync
non bloquants. Pas de faux IPty, pas de thread waitpid ajouté. Les octets du
replay et les offsets d'écriture sont sérialisés ; le fichier de checkpoint est
privé et atomique, sans garantie fsync ou compatibilité produit N↔N+1.

Le listener C est passé sur stdin réservé du démon, car Node pose CLOEXEC
sur un listener adopté en FD ≥3. Le listener B reste référencé dans le keeper ;
les frontaux en reçoivent une copie. Le rename garde **le même inode**, dont
le backlog survit au SIGKILL d'un frontal. Le test rouge montre pourquoi un
nouveau listener par frontal ne satisfait pas la disponibilité demandée.

`duplicate-listener.mjs` conserve une expérience échouée de duplication IPC.
`historical-attach.mjs` extrait les déclarations AST originales de runAttach
et bundle uniquement ses dépendances pures dans le répertoire temporaire.
L'entrée CLI, les superviseurs et le registre du produit sont exclus. Le source
réel de reconnexion est exercé, avec un adaptateur pour le protocole du banc.

Le banc enregistre les naissances de ses propres processus par canal privé.
Les lectures /proc sont par PID ou `/proc/self/fd`, jamais par UID/globales.
Les signaux ne visent que les PID/births lancés par les fixtures. Les traps du
guardian tuent seulement le groupe propre issu de forkpty. Le cleanup ferme
ses processus et supprime ses seuls répertoires temporaires.

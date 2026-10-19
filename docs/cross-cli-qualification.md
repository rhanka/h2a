# Qualification de la messagerie live entre CLI

Bilan mesuré : **1/36 réel (Claude → Claude, diagonale)** ; **aucune paire
inter-CLI réelle n’est qualifiée**. La [table de phase 1](2026-10-15-cross-cli-phase1.md)
reste l’historique (0 measured-OK, 5 measured-KO, 31 blocked avant
corrections) ; les rejeux cibles sont dans [la reprise](2026-10-16-cross-cli-resume.md),
dont la cellule Claude → Claude measured-OK. Les résultats simulés sont un
autre niveau de preuve, même lorsqu’ils passent les 36 paires.

Niveaux de preuve, affichés séparément sans agrégation en une couleur :
tier S (simulation déterministe, 36 paires, aucun modèle), tier C (oracles
de configuration réelle : chaque binaire tranche le config MCP rendu par
h2a à son chemin et format natifs, sans login ni appel modèle), tier R1
(sonde réelle par paire, modèles réels, sièges owner), tier R2 (fonctions
réelles au-delà de la sonde). Le cliquet : les lignes ne montent que
(none → S → C → R1/R2) ; F3 reste ouvert jusqu’aux lots L12–L15.

Pré requis : Linux, Node 22 ou 24, g++, headers Node et dépendances du checkout.
Le builder compile les sources en mkdtemp et compile node-pty directement,
sans node-gyp/Python. Aucun binaire h2a installé n’est exécuté.

```sh
npm ci --ignore-scripts
node scripts/qualify-cross-cli.mjs --seat-manifest /path/to/seats.json \
  --pair claude-a:claude-b --timeout-ms 120000 --wake-release-offsets-ms 0,30000,6000 \
  --output /tmp/xcli-real.json --markdown /tmp/xcli-real.md
```

Les six CLI doivent être présentes sur le PATH initial. Chaque cellule a deux
workspaces et identités distincts, un host natif dédié, un store et des HOME/XDG
temporaires. Seuls des fichiers de login explicitement autorisés sont copiés ;
les hooks, plugins et configurations MCP de l’utilisateur ne sont pas repris.
Un point d’entrée Python de notre chaîne de lancement est refusé avant
exécution ; le produit vendeur Vibe tourne tel qu’installé, runtime Python
vendeur inclus (règle owner QO4 du 11/10 : ce que nous livrons reste 0
Python), et chaque preuve Vibe porte le label `vendor-runtime: python (not
shipped)`. Aucun backend Vibe non-Python n’existe aujourd’hui : en adopter un
serait un changement suivi, jamais un remplacement silencieux. Sans
`--auth-home`, aucun login existant n’est lu.

Une cellule peut être rejouée sans relancer les autres :

```sh
node scripts/qualify-cross-cli.mjs --pair claude-a:codex \
  --seat-manifest /path/to/seats.json --timeout-ms 120000 \
  --wake-release-offsets-ms 0,30000,6000 --output /tmp/xcli-cell.json
```

| Statut réel | Exigence |
|---|---|
| measured-OK | MCP initialisé et outils publiés des deux côtés ; envoi signé ; enveloppe exacte livrée ; receiver préalablement inactif ; lecture de cette enveloppe sans nouvelle entrée du harness ; réponse signée livrée au sender |
| measured-KO | Une étape observée échoue dans le budget de qualification |
| blocked | Login, onboarding/trust non résolu, environnement, modèle non prêt, exécutable interdit/absent ou nettoyage non prouvé |

Les preuves ne contiennent ni RPC bruts, ni textes de modèle, ni tokens :
seulement événements, identifiants techniques et booléens corrélés. Chaque
cellule produit une preuve après le verdict du lot de répétitions ; le résultat final contient les
empreintes des sources et du harness. Le code de sortie est 0 uniquement si
toutes les cellules demandées passent ; sinon 2. Un échec de nettoyage arrête
la campagne. L’effacement de tout l’état privé (logins et transcripts inclus)
est tenté et vérifié même après la perte du worker. Le superviseur Linux
observe les execs des descendants possédés et borne leur récupération ; un
nettoyage non prouvé reste bloquant. Un scan précède toute publication.

Pour CI, les modèles sont remplacés par des peers déterministes. Les MCP,
signatures, inbox, résolution de session et injections PTY sont ceux du produit.
Le modèle simulé ignore les notifications MCP et ne lit son inbox qu’après une
instruction de wake dont il vérifie la signature. Les layouts de configuration
des CLI y sont émulés ; leurs parseurs et modèles ne sont pas qualifiés par cette
simulation. Les oracles natifs Claude/Codex inspectent séparément leur vraie
configuration sans login ni appel modèle.

```sh
node --test scripts/xcli-lab.test.mjs scripts/xcli-proxy.test.mjs \
  scripts/xcli-simulation.test.mjs scripts/xcli-gemini-registry.test.mjs
node scripts/qualify-cross-cli.mjs --simulated --timeout-ms 45000 \
  --wake-release-offsets-ms 0,6000,1000 --output /tmp/xcli-sim.json
node scripts/xcli-ci-check.mjs /tmp/xcli-sim.json
```

`--simulated` interdit `--auth-home`. Les statuts sont `simulated-OK/KO` et ne
deviennent jamais des statuts `measured-OK`. Le contrôle négatif ignore le wake
dans le seul modèle de test et exige une livraison durable sans lecture/réponse ;
il doit échouer à la qualification. Le budget par défaut de 30 s couvre
l’échéance d’identité produit inchangée de 20 s et la barrière inactive.
Le crédit de réveil exige au moins trois répétitions dont les fenêtres
effectivement observées sont séparées. Une exécution avec un seul offset
n’obtient jamais ce crédit, quel que soit le mode de polling. Le budget réel
par défaut est de 60 s ; les offsets longs doivent être financés explicitement.

Le workflow `cross-cli-messaging` exécute ces gates sur Node 22 et 24. Les
cellules des six modèles réels restent une qualification locale, en attente
des sièges CI. Délégation, reprise, configuration centrale automatique et
fonctions hors messagerie ne sont pas prouvées par cette matrice.

Les tests de producteurs historiques doivent passer par le lanceur CI Linux :

```sh
node scripts/xcli-in-pid-namespace.mjs scripts/xcli-runtime-tests.mjs
```

Il compile un init C++ en mkdtemp, puis utilise `sudo -n unshare` pour créer
un espace PID et son procfs privés. L’init récolte les descendants orphelins ;
il refuse de fonctionner hors PID 1. La fixture upgrade refuse l’absence de
preuve du changement d’espace PID. Aucun fallback vers le procfs extérieur
n’est autorisé. Les fixtures source/doc sont copiées dans le build temporaire.
Les seuls placeholders admis restent ceux de la déclaration propriétaire
versionnée ; une absence d’état ou de fixture historique exigée échoue.

Le lecteur PTY émule aussi les requêtes VT de démarrage avec `@xterm/headless`,
puis interdit irréversiblement toute réponse terminal au receiver après sa
barrière inactive. Le vérificateur de preuve rejette une entrée ultérieure.
Le rejeu Codex avec cette émulation reste KO : elle ne suffit pas à qualifier
le MCP ni un échange modèle réel.

Le gate global `npm test`/release n’est pas qualifié ici. Sa fixture historique
exige maintenant ce confinement : sans le lanceur, elle échoue avant
l’installation ou l’exécution du producteur ancien. Le nouveau workflow couvre
les 34 suites runtime et neuf suites source ciblées ; l’intégration des entrées
globales dans un domaine PID privé est câblée ; sa preuve GREEN reste requise
sur CI. Le confinement local refuse `sudo` avec `no new privileges`.

Campagne réelle aux sièges : un manifeste de sièges (`--seat-manifest`)
nomme une source d’authentification par siège et par rôle ; les paires
nomment des sièges (`claude-a:claude-b`), jamais des familles. Chaque
cellule enregistre ses identifiants de siège, le mode de siège et le
drapeau diagonale ; sans manifeste, `--auth-home` reste un alias
mono-siège déprécié. Un registre persistant (0600) débite chaque session
lancée avant le spawn — pré-vols, réessais et reprises inclus — et refuse
sans spawn au-delà des plafonds (nombres PROPOSITION en attente de D2) ;
la reprise recharge le registre au lieu de le réinitialiser. Un quota
fournisseur bloque les autres cellules du siège ; le quota MCP par session
coupe la session fautive au témoin. Les diagonales passent d’abord, sans
jamais abandonner une cellule obligatoire.

La lane protégée exige une référence protégée et le SHA exact de son propre
workflow avant le checkout et l’exposition des bundles. Les variables owner
`XCLI_CAMPAIGN_RUNNER` (labels JSON d’un runner éphémère provisionné avec les
cinq binaires), `XCLI_SESSION_CAP`, `XCLI_MCP_CAP` et `XCLI_WALL_CLOCK_CAP_MS`
portent D3/D2 ; aucune valeur de runner implicite ne les remplace.
Les gates PR/release utilisent `--fetch-trusted` : téléchargement authentifié
de l’artefact du run réussi, vérification de son digest et du head candidat
(jamais le SHA de merge synthétique), puis des preuves, plafonds et nettoyages.
`--content-only` sert uniquement à l’assemblage avant publication et ne prouve
aucune provenance. Aucun reçu de qualification réelle n’a été produit ici.

Non couvert (états exacts : `unknown`, `source-gap`, `missing source`,
`unverified`, `partial`, `not covered`) :

- Messagerie réelle inter-CLI : `not covered`. 1/36 réel, diagonale
  uniquement ; 35 cellules réelles sans claim ; 29 jamais rejouées après
  la phase 1 (`unverified` au-delà de leur statut phase-1).
- Couverture toutes-fonctions : `partial`. La sonde exerce identité, envoi,
  lecture inbox, wake et réponse. Le reste (résolution de noms, autres
  actions inbox, sessions, négociations, conducteur, délégation, autres
  lignes MCP) est `not covered` jusqu’aux lots L12–L15.
- Consommation modèle/tokens par famille : `source-gap`. Aucun signal
  d’usage structuré démontré ; les plafonds lient sessions lancées,
  appels MCP et horloge.
- Descendants transitoires : observation d’exec via ptrace sur Linux, 9/9
  fixtures natives à 1/10/100 ms. Les autres plateformes restent `not covered`.
- Polling dont la phase varie entre sessions : `not covered`, même avec les
  trois répétitions séparées ; la preuve exclut uniquement la fenêtre annoncée.
- Gemini : `missing source` (aucun siège). Vibe : `not covered` en R
  jusqu’à un siège (la frontière Python n’est pas le bloqueur, QO4).
  Aucun backend Vibe non-Python existant.
- Enrôlement live des sièges : `partial` (chemin fichier intérimaire ;
  pas d’import L1 publié, pas de preuve keyring/billing/refresh).

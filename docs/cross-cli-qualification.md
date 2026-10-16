# Qualification de la messagerie live entre CLI

La mesure réelle initiale est conservée dans
[la table de phase 1](2026-10-15-cross-cli-phase1.md). Aucune cellule réelle
n’est qualifiée à ce stade. Les résultats simulés sont un autre niveau de
preuve, même lorsqu’ils passent les 36 paires.

Pré requis : Linux, Node 22 ou 24, g++, headers Node et dépendances du checkout.
Le builder compile les sources en mkdtemp et compile node-pty directement,
sans node-gyp/Python. Aucun binaire h2a installé n’est exécuté.

```sh
npm ci --ignore-scripts
node scripts/qualify-cross-cli.mjs --auth-home /path/to/login-home \
  --output /tmp/xcli-real.json --markdown /tmp/xcli-real.md
```

Les six CLI doivent être présentes sur le PATH initial. Chaque cellule a deux
workspaces et identités distincts, un host natif dédié, un store et des HOME/XDG
temporaires. Seuls des fichiers de login explicitement autorisés sont copiés ;
les hooks, plugins et configurations MCP de l’utilisateur ne sont pas repris.
Un point d’entrée Python est refusé avant exécution, ce qui bloque actuellement
Vibe. Sans `--auth-home`, aucun login existant n’est lu.

Une cellule peut être rejouée sans relancer les autres :

```sh
node scripts/qualify-cross-cli.mjs --pair claude:codex \
  --auth-home /path/to/login-home --output /tmp/xcli-cell.json
```

| Statut réel | Exigence |
|---|---|
| measured-OK | MCP initialisé et outils publiés des deux côtés ; envoi signé ; enveloppe exacte livrée ; receiver préalablement inactif ; lecture de cette enveloppe sans nouvelle entrée du harness ; réponse signée livrée au sender |
| measured-KO | Une étape observée échoue dans le budget de qualification |
| blocked | Login, onboarding/trust non résolu, environnement, modèle non prêt, exécutable interdit/absent ou nettoyage non prouvé |

Les preuves ne contiennent ni RPC bruts, ni textes de modèle, ni tokens :
seulement événements, identifiants techniques et booléens corrélés. Chaque
cellule produit une preuve intermédiaire ; le résultat final contient les
empreintes des sources et du harness. Le code de sortie est 0 uniquement si
toutes les cellules demandées passent ; sinon 2. Un échec de nettoyage arrête
la campagne et préserve son état privé pour diagnostic.

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
node scripts/qualify-cross-cli.mjs --simulated --output /tmp/xcli-sim.json
node scripts/xcli-ci-check.mjs /tmp/xcli-sim.json
```

`--simulated` interdit `--auth-home`. Les statuts sont `simulated-OK/KO` et ne
deviennent jamais des statuts `measured-OK`. Le contrôle négatif ignore le wake
dans le seul modèle de test et exige une livraison durable sans lecture/réponse ;
il doit échouer à la qualification. Le budget par défaut de 30 s couvre
l’échéance d’identité produit inchangée de 20 s et la barrière inactive.

Le workflow `cross-cli-messaging` exécute ces gates sur Node 22 et 24. Les
cellules des six modèles réels restent une qualification locale, en attente
des sièges CI. Délégation, reprise, configuration centrale automatique et
fonctions hors messagerie ne sont pas prouvées par cette matrice.

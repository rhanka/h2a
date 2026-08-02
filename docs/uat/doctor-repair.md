# UAT — `h2a doctor --repair` (item 01KYR04KZ4AE41QBA9HZBMRMNY)

**Pour l'owner. Lisible à froid, exécutable en une commande.**

Cette recette ne demande plus de copier des blocs Bash depuis le Markdown. Le Markdown explique ce
qui va arriver et ce qu'il faut lire ; [`uat-doctor.sh`](./uat-doctor.sh) porte les commandes, leur
ordre, leurs codes de sortie et les assertions de sécurité.

Depuis la racine d'un checkout Git contenant le candidat :

```bash
bash docs/uat/uat-doctor.sh
```

Pour exercer explicitement un commit, un tag ou une branche locale — par exemple la référence de
release que tu veux qualifier — fournis-la :

```bash
H2A_UAT_SHA=origin/main bash docs/uat/uat-doctor.sh
```

`H2A_UAT_SHA` est prioritaire. Pour valider une release, récupère d'abord son tag dans ce checkout,
puis donne ce tag au script : `H2A_UAT_SHA=<tag-de-release> bash docs/uat/uat-doctor.sh`.

Le script ne déduit jamais `done` de son propre succès. L'owner doit encore lire le scénario 2 et
répondre aux trois questions de la dernière section.

## Prérequis

La recette normale exige un **checkout Git** : le répertoire `.git` et l'objet candidat doivent être
présents, car le script le copie avec `git archive`. Avant de créer un arbre temporaire, le script vérifie
`node`, `git`, `tar` et `npm`. Aucun remote GitHub ni `gh` n'est requis : sans `H2A_UAT_SHA`, le candidat
est exactement `HEAD` du checkout qui contient le script. Avec `H2A_UAT_SHA`, le checkout Git reste
nécessaire pour résoudre et extraire la référence fournie. Les injections réservées aux tests n'ont besoin
que de `node`.

## Ce que tu valides

Qu'une installation d'hôte incohérente se répare **sans intervention manuelle**, et qu'elle ne se
déclare **jamais** propre quand elle ne l'est pas.

Tu ne valides pas ici la parité d'exécution des hôtes. La porte requise n'exécute pas toute la suite
runtime ; une installation vérifiée ne prouve donc pas à elle seule un comportement vérifié.

Doctor garantit la cohérence des réparations qu'il a lui-même effectuées. Il ne détecte pas les
changements d'installation faits par un autre outil ; après une modification manuelle de ton
installation, redémarre tes sessions.

**Explicit limit — native command failure**: If a native host CLI fails after it has already changed the installation, doctor reports the failure as host-command-failed and does not undo what that CLI already did. Doctor's own configuration writes are atomic. It has no snapshot of third-party state and does not simulate one: a partial restore would promise a recovery it cannot deliver. After a reported native failure, verify the host installation before relying on it.

## Le contrat de sécurité du script

Le runner de production hérite de l'environnement et les CLIs natives honorent `CODEX_HOME` et
`CLAUDE_CONFIG_DIR`. Un `HOME` jetable ne suffit donc pas à protéger l'installation de l'owner.

Le script traite ces variables comme des **valeurs**, jamais comme une chaîne de préfixe à réévaluer :

- il mémorise les valeurs héritées sans les exporter ailleurs ;
- il utilise un tableau d'arguments `env`, ce qui préserve les chemins contenant des espaces ;
- il n'invente pas une variable absente ; dans ce cas seulement, la racine par défaut est utilisée ;
- il retire explicitement les deux variables avant les probes qui construisent leurs propres racines ;
- il retire `CODEX_HOME` et `CLAUDE_CONFIG_DIR` du `node --test` du scénario 2, puis lui donne un
  `HOME` situé sous l'arbre UAT jetable. Les défauts `.codex` et `.claude` restent ainsi jetables sans
  changer la sémantique « variable absente » que plusieurs tests vérifient.

Avant et après **chaque scénario**, le script photographie la configuration owner réellement utilisée :

- `config.toml` pour Codex ;
- `settings.json`, `plugins/known_marketplaces.json` et
  `plugins/installed_plugins.json` pour Claude ;
- les compagnons Claude `.claude.json` et `.config/claude/mcp.json`, sous `HOME` par défaut ou
  sous `CLAUDE_CONFIG_DIR` quand cette variable est définie ;
- les manifestes de plugins `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
  `.agents/plugins/marketplace.json`, `.mcp.json` et `hooks/hooks.json` trouvés sous les deux
  racines hôtes.

`.claude.json` est un cas particulier : Claude Code le réécrit pendant que des sessions sont vivantes,
mais doctor peut aussi y réparer une configuration. Le script garde donc son type et son mode, puis la
valeur de **chaque clé racine**, et imprime la clé (`.claude.json#projects`, par exemple) si elle change.
Il exclut seulement `pluginUsage` et `promptQueueUseCount`. Cette liste a été mesurée le 1er août 2026
sur Claude Code 2.1.220, sans UAT : les deux clés changeaient seules, toutes les autres clés racine
restaient stables pendant l'échantillon. Une mise à jour de l'hôte peut invalider cette observation ; ne
l'élargis pas par intuition, mesure de nouveau d'abord.

Le script porte une liste exécutable d'exclusions, pas une convention implicite : journaux
(`*.log`, `*.jsonl`, `logs/`, `debug/`, `journal*/`), bases runtime `*.sqlite` et leurs
`-wal`/`-shm`, caches de session, arbres temporaires, télémétrie, PID et verrous. Il ne compare donc
plus toute la racine hôte. Une session Codex ou Claude peut rester ouverte pendant l'UAT ; son activité
normale n'est pas une mutation de configuration.

Pour chaque configuration retenue autre que `.claude.json`, l'empreinte couvre le chemin, le type, le
mode, la taille, la date de modification, le lien éventuel et le contenu jusqu'à 8 Mio. Une différence
fait échouer la recette et imprime chaque fichier `AJOUTE`, `SUPPRIME` ou `MODIFIE` : un scénario qui
produit le bon rapport en modifiant une configuration réelle n'est pas un succès.

Le scénario 3 est limité au `--dry-run`. Le script ne lance jamais automatiquement une réparation sur
l'installation owner et ne crée plus de sauvegarde « préventive » dans cette installation pendant une
opération qui doit être inerte.

## Le candidat réellement exercé

Le `h2a` global n'est jamais le candidat. Le script :

1. prend `H2A_UAT_SHA` s'il est fourni ; sinon, prend `HEAD` du checkout courant ;
2. résout cette référence en SHA local, puis imprime avant les scénarios son SHA court, la version lue
   dans `packages/h2a/package.json` et sa provenance ;
3. crée un extrait jetable de ce SHA avec `git archive` ;
4. exécute `npm ci`, puis `npm run build` dans cet extrait ;
5. épingle chaque scénario sur `node <extrait>/packages/h2a/dist/bin.js` ;
6. supprime l'extrait et l'arbre UAT en sortant, y compris après un échec ou une interruption
   `Ctrl-C`/`SIGINT`/`TERM`.

Il ne construit, ne nettoie et ne supprime rien dans le checkout partagé.

## L'ordre exécuté : 3, 0, 1, 2

Les numéros sont historiques ; l'ordre physique est la garantie :

1. **Scénario 3** lit l'installation owner avant que le reste de la recette ne puisse influencer la
   preuve. Il ne fait qu'un dry-run.
2. **Scénario 0** demande ensuite à Codex ce qu'il sert réellement, entièrement sur des racines
   jetables.
3. **Scénario 1** reconstitue la marketplace disparue et exerce dry-run puis réparation dans son arbre.
4. **Scénario 2** exécute le test automatisé isolé, puis montre la session vivante à l'owner.

Le script imprime un titre au début de chaque scénario et le verdict d'empreinte juste après. La suite
ne démarre pas si un scénario abandonne ou si une racine owner a changé.

## Scénario 3 — installation owner, lecture en premier

Le sujet est l'état réellement utilisé par l'owner. Si `CODEX_HOME` ou `CLAUDE_CONFIG_DIR` existe dans
le shell, cette valeur exacte est transmise, y compris si elle contient des espaces. Si la variable
n'existe pas, le défaut sous `HOME` est utilisé. Aucune fausse racine `~/.claude` n'est forcée à Claude
quand sa configuration native se trouve dans `~/.claude.json`.

Le script initialise un bus temporaire, puis lance `doctor --repair --dry-run`. Les sorties 0 et 2 sont
toutes deux interprétables : 0 signifie qu'aucune incohérence bloquante n'est rapportée ; 2 signifie
que le rapport nomme ce qui reste incohérent. Toute autre sortie invalide la recette.

Sur la machine qui a produit ce dossier, l'état mesuré le 30 juillet comportait deux endpoints Claude
H2A connectés simultanément sur deux bus différents. Le dry-run doit alors nommer
`h2a-endpoint-count`. Il doit aussi décrire l'état réel des marketplaces, du plugin, de sa version et
des endpoints, jamais un état fabriqué pour la recette.

Le script **ne répare pas** cet état réel. Retirer une entrée de configuration quotidienne dépasse la
validation de cette PR et reste une décision owner séparée.

## Si le garde owner se déclenche

Le script s'arrête avant le scénario suivant, ne lance aucune réparation owner et nettoie ses arbres
jetables. Garde la ligne imprimée, notamment la clé si elle est sous `.claude.json`; elle est une preuve
d'une écriture, pas une attribution automatique à doctor.

1. Ne relance pas immédiatement et ne modifie pas la configuration owner.
2. Sans UAT, observe la clé nommée pendant 30 à 60 secondes. Si elle bouge seule, c'est une activité hôte
   à documenter avec la version de l'hôte ; la liste des exclusions doit alors être re-mesurée, pas élargie
   localement.
3. Si elle ne bouge pas sans UAT, ferme les sessions hôtes ou attends leur arrêt, puis reprends **toute**
   la recette. La même clé non volatile qui change à nouveau reste un échec à attribuer au candidat ou à un
   autre outil concurrent ; n'accepte pas le vert en contournant le garde.

Les sessions peuvent donc rester ouvertes pour les écritures déjà mesurées — journaux, bases SQLite,
caches, verrous, `pluginUsage` et `promptQueueUseCount` — tandis que toute autre configuration reste
gardée.

## Scénario 0 — l'oracle Codex, après la lecture owner

Le script lance `probe-oracle.sh` avec les racines hôtes héritées explicitement retirées et avec le
binaire candidat explicitement fourni.

Le probe reconstitue le véritable incident : marketplace legacy dont la source a disparu, plugin
encore actif et cache déclarant l'ancien serveur. Il demande ensuite à **Codex**, pas à doctor :

- quel serveur MCP H2A est réellement servi ;
- si le sous-système marketplace répond et expose une entrée exploitable.

Une commande native qui échoue après la réparation, un ancien endpoint encore servi, plusieurs
endpoints H2A ou une marketplace inutilisable invalident ce scénario. L'auto-rapport de doctor ne peut
pas être l'oracle de son propre fonctionnement.

Le probe utilise un `HOME` et un `CODEX_HOME` jetables, mais exécute le vrai binaire Codex. Il peut donc
utiliser le réseau et l'authentification disponibles sur la machine. Cette limite est visible dans sa
sortie.

## Scénario 1 — la source de marketplace a disparu

Ce scénario est exécuté après le scénario 3 : les éventuels findings Claude aperçus ici ont donc déjà
été lus dans leur contexte owner, et ne sont pas présentés comme une découverte future.

Le script crée un `HOME` jetable contenant une marketplace Codex locale dont la source finit par
`/disparu`. Il lance successivement :

1. `init` — sortie 0 obligatoire ;
2. `doctor --repair --dry-run` — sortie 2 obligatoire, puisque la source morte doit être nommée ;
3. `doctor --repair` — sortie 0 obligatoire après réparation.

Le dry-run doit afficher le chemin mort sans rien modifier. La réparation doit remplacer cette source
par la source canonique `rhanka/h2a` et installer `h2a@sentropic` sans poser de question. Toute demande
d'intervention manuelle est un échec de l'UAT, même si la commande finit par sortir 0.

La configuration owner est empreintée indépendamment autour de l'ensemble du scénario.

## Scénario 2 — une session vivante doit redémarrer

La preuve automatisée reste
`packages/h2a/test/host-installation-doctor.test.js`, mais elle n'est plus lancée dans l'environnement
owner. Le script retire les deux variables hôtes et lui fournit seulement un `HOME` sous
`UAT/h2/test-home`. Les tests continuent donc de voir `CODEX_HOME` et `CLAUDE_CONFIG_DIR` absents,
tandis que leurs racines par défaut restent jetables. Ils ne peuvent plus atteindre la configuration
personnalisée de l'owner.

Après cette porte automatisée, `probe-live-session.sh` fabrique le cas observable :

- cache plugin ancien ;
- marqueur de réparation antérieur ;
- session vivante démarrée après cet ancien marqueur ;
- nouvelle réparation postérieure à la session.

L'owner doit lire trois valeurs :

- code de doctor **2** ;
- `report.ok=false` ;
- au moins un motif explicite disant que la session vivante doit redémarrer.

Le probe vérifie aussi l'inertie du dry-run par empreinte et l'idempotence d'un second repair. Son
propre code 0 signifie que l'observation a pu être menée ; il ne remplace pas la lecture humaine des
trois valeurs. Une commande hôte native en échec rend l'observation inconclusive.

## La matrice qui verrouille le véhicule

La recette elle-même est couverte par
`packages/h2a/test/uat-doctor-script.test.js`. Le test exécute le script dans cinq environnements :

| environnement owner | défaut visé |
|---|---|
| aucune racine hôte définie | défauts par défaut |
| `CODEX_HOME` seul | fuite Codex |
| `CLAUDE_CONFIG_DIR` seul | fuite Claude |
| les deux racines | interaction |
| les deux avec des espaces | découpage fautif d'un préfixe shell |

Chaque ligne crée des racines owner sentinelles et vérifie extérieurement qu'elles restent intactes. Le
faux `node --test` de cette matrice écrit volontairement dans les racines par défaut de son `HOME` :
si le script oublie de retirer une racine héritée ou de remplacer `HOME`, il corrompt la sentinelle
owner et le test échoue.

Trois cas discriminent en plus le garde lui-même :

- une écriture dans `logs/logs_2.sqlite` pendant le scénario 3 reste verte ;
- une écriture dans `config.toml` rend le scénario rouge et le chemin est imprimé ;
- un contre-mutant qui réintègre `logs_2.sqlite` dans l'empreinte rend le premier cas rouge.

La matrice vérifie aussi l'ordre visible `3 → 0 → 1 → 2` et l'absence de l'ancienne forme dangereuse
`env $PREFIXE`.

Pour rejouer uniquement cette porte :

```bash
node --test packages/h2a/test/uat-doctor-script.test.js
```

## Nettoyage et décision owner

Le trap du script supprime l'arbre UAT et l'extrait candidat, succès ou échec. Il refuse de supprimer
un chemin qui n'est pas un enfant du parent temporaire qu'il a lui-même sélectionné.

Après lecture, l'owner tranche :

1. Le scénario 2 montre-t-il bien code 2, `ok=false` et un motif de redémarrage ?
2. Le scénario 1 s'est-il réparé sans poser de question ?
3. Pendant ce passage, as-tu rencontré un comportement que la recette ne t'avait pas annoncé ?

Sans cette réponse owner, aucun vert du script ou de la CI ne vaut `done`.

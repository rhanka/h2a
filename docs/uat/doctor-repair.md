# UAT — `h2a doctor --repair` (item 01KYR04KZ4AE41QBA9HZBMRMNY)

**Pour l'owner. Lisible à froid, ~5 minutes.** Ce document existe parce que l'item ne peut
pas passer `done` sans ta recette, et qu'une recette qu'on ne peut pas lancer en cinq minutes
ne se fait jamais.

**Ce que tu valides** : qu'une installation d'hôte incohérente se répare **sans intervention
manuelle**, et qu'elle ne se déclare **jamais** propre quand elle ne l'est pas.

**Ce que tu ne valides pas ici** : la parité d'exécution des hôtes. La porte requise n'exécute
pas la suite runtime (73 fichiers `.test.ts` hors garde), donc une installation vérifiée ne
prouve pas un comportement vérifié.

**Limite explicite** : doctor garantit la cohérence des réparations qu'il a lui-même effectuées.
Il ne détecte pas les changements d'installation faits par un autre outil ; après une modification
manuelle de ton installation, redémarre tes sessions.

**Explicit limit — native command failure**: If a native host CLI fails after it has already changed the installation, doctor reports the failure as host-command-failed and does not undo what that CLI already did. Doctor's own configuration writes are atomic. It has no snapshot of third-party state and does not simulate one: a partial restore would promise a recovery it cannot deliver. After a reported native failure, verify the host installation before relying on it.

---

## Sécurité d'abord — et une correction que je te dois

Les scénarios 1 et 2 tournent dans un `HOME` jetable. Seul le scénario 3 lit ta vraie installation, et
il commence par une sauvegarde.

> **Ce que j'avais écrit était faux, et une revue indépendante l'a mesuré.** J'affirmais qu'un `HOME`
> jetable rendait impossible toute lecture ou écriture de ta vraie installation. Il ne suffit pas : les
> CLIs natifs honorent `CODEX_HOME` et `CLAUDE_CONFIG_DIR`, et le runner de production utilise
> `spawnSync`, qui **hérite de tout ton environnement**. Si l'une de ces variables est définie dans ton
> shell, elle gagne sur le `HOME` jetable.
>
> **Ces racines ne sont donc JAMAIS exportées dans ton shell.** Chaque scénario qui en a besoin les
> pose **en préfixe de ses propres commandes**. C'est la correction la plus importante de cette
> recette : une exécution à froid a mesuré qu'un `export` global les faisait fuir dans tout l'aval —
> la suite automatisée tombait à **16 pass / 47 fail** au lieu de 63, et les deux sondes refusaient
> de démarrer parce qu'elles voyaient une racine hors de leur arbre jetable. Le produit allait bien ;
> c'était ma recette qui cassait tout ce qui la suivait.
>
**Ne les `unset` pas.** Une version précédente de cette recette te le demandait, et une exécution à
froid a mesuré que c'était pire que le défaut d'origine : en les effaçant, tu perds l'information de
*quelle installation est la tienne*, et le scénario 3 retombe sur `~/.codex` — donc tu inspecterais
une installation que tu n'utilises pas. J'avais confondu deux choses distinctes et supprimé les deux :
l'export global (nuisible) et la **mémorisation** de tes racines (nécessaire au scénario 3).

On les **mémorise** donc, sans jamais les imposer aux scénarios jetables :

```bash
export UAT=$(mktemp -d /home/antoinefa/.cache-tmp/uat-doctor-XXXX)
# TES racines, telles qu'elles sont. Vides = tu utilises les defauts, c'est le cas courant.
export MES_CODEX="${CODEX_HOME-}"
export MES_CLAUDE="${CLAUDE_CONFIG_DIR-}"
echo "tes racines : CODEX_HOME=[$MES_CODEX] CLAUDE_CONFIG_DIR=[$MES_CLAUDE]"
```

Rien d'autre. Pas de `cd` vers le dépôt partagé — d'autres agents y construisent, et une exécution à
froid a montré que ce `cd` faisait lancer `npm ci` et `npm run build` **dans le checkout partagé**.

## Épingler le candidat — sinon tu testes autre chose que cette PR

`h2a` sur ton `PATH` résout vers le paquet **installé globalement**, pas vers cette branche, et
`packages/h2a/dist` n'est pas versionné. Sans ces deux lignes, tu recetterais une autre version que
celle que tu es en train de valider.

```bash
# Un extrait JETABLE du candidat. Ne recette pas depuis le depot partage : d'autres agents y
# construisent, et supprimer leur dist casse leurs mesures.
export CANDIDAT=$(gh pr view 94 --json headRefOid --jq .headRefOid)   # le HEAD reel de la PR,
                                              # plutot qu-un SHA fige qui perime entre deux manches
export SRC=$(mktemp -d /home/antoinefa/.cache-tmp/uat-src-XXXX)
git -C /home/antoinefa/src/h2a archive --format=tar "$CANDIDAT" | tar -xf - -C "$SRC"
cd "$SRC"
echo "candidat recette : $CANDIDAT"          # `git rev-parse` NE MARCHE PAS ici : un extrait
                                              # n'est pas un depot git. Une execution a froid a
                                              # bute exactement la-dessus.
npm ci                                        # OBLIGATOIRE : sans lui le build echoue
npm run build                                 # PAS build:h2a : il sort 2, @sentropic/track manquant
export DOCTOR="node $SRC/packages/h2a/dist/bin.js"
[ -f "$SRC/packages/h2a/dist/bin.js" ] || echo "BUILD ECHOUE : rien de ce qui suit n'a de valeur"
```

**Toutes les commandes ci-dessous utilisent `$DOCTOR`, jamais `h2a`.** Si `$DOCTOR` n'existe pas, le
build a échoué et rien de ce qui suit n'a de valeur.

---

## L'ordre compte, et il n'est pas numérique

Les scénarios sont **dans l'ordre où il faut les faire**, pas dans l'ordre de leurs numéros. Les numéros
sont ceux sous lesquels ils ont été écrits ; l'ordre ci-dessous est celui qu'une exécution à froid a
imposé.

1. **Le scénario 3 d'abord** — il lit **ton installation réelle**, et rien d'autre ne doit l'avoir
   touchée. Une exécution à froid a mesuré que le placer après une réparation lui faisait inspecter une
   racine déjà modifiée : *la séquence détruisait sa propre preuve*. Le mettre en premier rend ça
   impossible **par construction**, au lieu de dépendre d'une manipulation d'environnement correcte.
2. **Le scénario 0** — l'oracle. Il demande à `codex` ce qu'il sert vraiment, sur des racines jetables.
   C'est lui qui décide si le produit marche ; les autres décrivent des cas.
3. **Le scénario 1**, puis **le scénario 2** — les cas reconstitués, entièrement dans des arbres
   jetables.

Le texte annonçait déjà « scénario 0, à faire avant tous les autres » alors qu'il était placé
troisième. Un document dont l'ordre contredit ses propres instructions se fait lire dans l'ordre où il
est écrit.

---

## Scénario 3 — ta vraie installation, en lecture d'abord

### Une prédiction, mesurée sur ta machine le 2026-07-30 avant que tu lances quoi que ce soit

C'est la forme la plus forte que je puisse te donner : je te dis **d'avance** ce que doctor doit
nommer, et tu vérifies. S'il ne le nomme pas, la détection ne mord pas sur le cas réel.

Mesuré en interrogeant l'hôte, pas l'outil — `claude mcp list` sur ta configuration :

```
plugin:h2a:h2a: h2a mcp-serve --host claude --wake local-tmux --auto-open --auto-upgrade  ✔ Connected
h2a:            h2a mcp-serve --auto-open --host claude ... --root /home/antoinefa/src/a2a-cli  ✔ Connected
```

**Deux endpoints h2a connectés en même temps**, sur deux racines de bus différentes. Le second est
une déclaration globale dans `/home/antoinefa/.claude.json` (`mcpServers.h2a`) qui pointe encore
`src/a2a-cli` — l'ancien nom de travail du dépôt. Le chemin existe toujours, donc ce n'est pas un
pointeur mort : c'est un **second bus**. C'est l'incohérence n°5 de ce dossier, et elle est vivante,
pas historique.

**Ce que doctor doit dire** : un finding `h2a-endpoint-count` sur l'hôte `claude`, annonçant 2
endpoints là où un seul est requis.

**Ce qui invaliderait** : `--repair --dry-run` qui ne nomme pas ce doublon. Le code émet bien ce
finding pour Claude comme pour Codex, et **je l'ai depuis vérifié** sur un binaire citable : fixture ne
portant que ce défaut → `h2a-endpoint-count : Claude exposes 2 H2A endpoints; exactly one plugin
endpoint is required.` Vérifié aussi avec `CLAUDE_CONFIG_DIR` posé, où doctor rendait auparavant **zéro
finding** — un faux-propre, fermé par `0e56ed2a`.

Quand j'ai écrit ce paragraphe la prédiction était **non vérifiée** et je l'avais dit, parce que mon
`dist` était alors un mélange de deux états (le point d'entrée de la veille à côté d'un module compilé
du jour : le piège `tsc` composite, qui sort en succès sans émettre). C'est désormais mesuré, pas prédit.

**Ne répare pas ce doublon depuis cette recette.** Retirer une entrée de `.claude.json` touche ta
configuration quotidienne au-delà de cette PR. Constate, et décide séparément.



> **UN AVERTISSEMENT QUE JE RETIRE, parce qu'il est devenu FAUX.** Les versions précédentes de cette
> recette refusaient de lancer ce scénario si tu utilisais `CODEX_HOME` ou `CLAUDE_CONFIG_DIR` : à
> l'époque doctor lisait toujours `$HOME/.codex` alors que ses commandes natives honoraient
> `CODEX_HOME` — il diagnostiquait une racine et réparait l'autre.
>
> **Ce défaut est corrigé.** Sur ce SHA, doctor honore bien les deux variables ; le scénario 1 le
> prouve et un test dédié le verrouille. Laisser l'avertissement t'aurait fait croire à un défaut qui
> n'existe plus — et t'aurait privé du scénario 3 sans raison.
>
> Je le note parce que c'est l'inverse de la faute habituelle : ici la recette **sur-avertissait**.

```bash
# TES racines memorisees au depart — pas les defauts, pas celles d'un scenario jetable.
# NE POSE PAS une variable que tu n'as pas. Une execution a froid a mesure que forcer
# CLAUDE_CONFIG_DIR=$HOME/.claude fait chercher a Claude ~/.claude/.claude.json au lieu de
# ~/.claude.json — donc doctor ne rapportait AUCUN h2a-endpoint-count et ma correction
# MASQUAIT l'incoherence centrale de ce scenario. On ne transmet que ce qui existe.
PREFIXE=""
[ -n "${MES_CODEX-}" ]  && PREFIXE="$PREFIXE CODEX_HOME=$MES_CODEX"
[ -n "${MES_CLAUDE-}" ] && PREFIXE="$PREFIXE CLAUDE_CONFIG_DIR=$MES_CLAUDE"
CODEX_ROOT="${MES_CODEX:-$HOME/.codex}"
CLAUDE_ROOT="${MES_CLAUDE:-$HOME/.claude}"
STAMP=$(date +%Y%m%d-%H%M)
echo "racines inspectees : $CODEX_ROOT  |  $CLAUDE_ROOT"
cp -p "$CODEX_ROOT/config.toml" "$CODEX_ROOT/config.toml.bak.uat-$STAMP"
cp -p "$CLAUDE_ROOT/plugins/known_marketplaces.json" "$CLAUDE_ROOT/plugins/known_marketplaces.json.bak.uat-$STAMP" 2>/dev/null

mkdir -p "$UAT/h3"
$DOCTOR init --root "$UAT/h3/bus"
# les racines sont posees EN PREFIXE, jamais exportees : ce scenario vise TON installation,
# les precedents visaient des arbres jetables, et aucun ne contamine l'autre.
env $PREFIXE $DOCTOR doctor --root "$UAT/h3/bus" --repair --dry-run  # inspecte, ne modifie RIEN
```

Les deux sauvegardes portent l'horodatage ; elles sont byte-identiques à tes fichiers actuels et tu
peux les supprimer quand tu as fini.

Lis le rapport. Il doit décrire ton état réel : une seule marketplace `sentropic` par hôte,
`h2a@sentropic` à la version npm, un seul endpoint MCP `h2a`, aucun `track-mcp` autonome — et
lister ce qu'une réparation changerait.

> **Même correction que le scénario 1** : j'avais écrit `h2a doctor` seul, qui ne regarde pas ton
> installation hôte. `--dry-run` est la seule façon honnête de te faire inspecter ta machine
> avant de décider.

Puis, seulement si tu le veux :

```bash
$DOCTOR doctor --root "$UAT/h3/bus" --repair
```

**Attendu** : soit « rien à réparer », soit une liste de ce qui a été changé. Jamais un silence.
Le bus temporaire isole cette recette des sessions de ton bus quotidien ; si doctor a réparé ton
installation, redémarre toute session que tu sais antérieure à cette réparation.

**Pour revenir en arrière, et ce que ça ne couvre PAS** :

```bash
cp "$CODEX_ROOT/config.toml.bak.uat-$STAMP" "$CODEX_ROOT/config.toml"
```

Cette sauvegarde restaure la **configuration**. Elle ne restaure ni les caches de plugins supprimés,
ni les entrées de marketplace, ni le marqueur `h2a-repair.json` de ta racine codex, ni un plugin désinstallé.
Si tu veux un retour arrière complet, ne lance pas `--repair` sur ta vraie machine : le scénario 3
s'arrête au `--dry-run`, qui est prouvé inerte par empreinte dans le probe du scénario 2. Je préfère
te le dire que te laisser croire qu'une copie de `config.toml` annule tout.

---

## Scénario 0 — l'oracle, à faire AVANT tous les autres

```bash
bash docs/uat/probe-oracle.sh
```

**Fais celui-ci d'abord**, parce qu'il est le seul qui n'interroge pas doctor. Il reconstruit la forme
réelle de ton incident — marketplace legacy dont la source est supprimée, entrée de plugin encore
active, cache encore sur disque déclarant un serveur MCP `h2a` — puis il pose deux questions à
**codex lui-même** : quel serveur h2a sers-tu vraiment (`codex mcp list`), et ton sous-système
marketplace répond-il (`codex plugin marketplace list`).

**Pourquoi il existe** : le 2026-07-30, `--repair` portait DEUX verdicts GO indépendants alors qu'il
laissait codex servir l'ANCIEN serveur MCP. Aucune des deux revues n'était en faute — aucune n'avait
mandat de lancer une CLI hôte. Ni la suite de tests ni l'autre probe ne l'ont vu, parce que tous deux
lisent le rapport de doctor. **L'auto-rapport d'un outil ne peut pas être l'oracle de son propre
fonctionnement.**

**Ce qui invaliderait** : `codex mcp list` rendant autre chose que `h2a mcp-serve`, ou
`codex plugin marketplace list` échouant. Dans ce cas c'est le rapport qui a tort, pas l'hôte —
même si doctor annonce `ok=true`.

**État mesuré sur la branche** : les **deux** oracles passent désormais, sur `55f6066a`, rebuild propre
(`dist` **et** `*.tsbuildinfo` supprimés avant — un `tsc` composite sort 0 sans émettre et rend un `dist`
mélangé). Quand j'ai écrit ce scénario, l'oracle 2 échouait encore ; `a64e1dc8` l'a fermé.

Ce scénario tourne aussi **en CI** sous le nom `host-oracle` : le job installe codex et exécute cette
sonde sur racines jetables, verdict porté par le code de sortie. Il est vert sur ce SHA.
**Où cette garantie s'arrête** : codex seulement, racines jetables seulement, Linux seulement, et le job
**n'est pas encore un check requis** — l'ajouter à la protection de branche est ta décision, pas la
mienne, donc aujourd'hui il peut échouer sans bloquer une fusion.

---

## Scénario 1 — la source de marketplace a disparu (le défaut réel du 29 juillet)

C'est celui qui a bloqué **tous** les plugins codex, h2a compris, pendant que le plugin
tournait sur un cache 0.85.18 figé.

**Ce que tu vas voir en plus, et qui n'est pas un défaut** : `--repair` répare **tous les hôtes**, pas
seulement celui que ce scénario met en scène. Si `claude` est joignable sur ta machine, tu verras
apparaître quatre findings côté Claude — marketplace, plugin, version, endpoints — qui n'ont rien à
voir avec la source codex disparue qu'on teste ici. Une exécution à froid les a signalés comme
parasites ; je ne peux pas les supprimer sans restreindre `--repair`, ce qui serait un changement de
produit fait pour arranger une recette. **Lis-les, ignore-les pour ce scénario, et retrouve-les au
scénario 3** où ils sont, eux, le sujet.

Les racines sont posées **en préfixe**, jamais exportées — sinon elles fuient dans tous les scénarios
suivants, ce qu'une exécution à froid a mesuré (suite automatisée à 16 pass / 47 fail, deux sondes
refusant de démarrer).

```bash
mkdir -p $UAT/h1/.codex
printf '[marketplaces.sentropic]\nsource_type = "local"\nsource = "%s/disparu"\n' "$UAT" \
  > $UAT/h1/.codex/config.toml

env -u CLAUDE_CONFIG_DIR HOME=$UAT/h1 CODEX_HOME=$UAT/h1/.codex $DOCTOR init --root "$UAT/h1/bus"
env -u CLAUDE_CONFIG_DIR HOME=$UAT/h1 CODEX_HOME=$UAT/h1/.codex $DOCTOR doctor --root "$UAT/h1/bus" --repair --dry-run
echo "exit=$?   # inspecte, ne modifie RIEN"
env -u CLAUDE_CONFIG_DIR HOME=$UAT/h1 CODEX_HOME=$UAT/h1/.codex $DOCTOR doctor --root "$UAT/h1/bus" --repair
echo "exit=$?   # repare"
```

**Attendu** : le premier appel **nomme** la source morte (le chemin qui finit par `/disparu`) et
dit ce qu'il ferait, sans rien changer. Le second la remplace par la source git `rhanka/h2a` et
installe `h2a@sentropic`. Aucune question posée, aucun geste de ta part.

**Ce qui invaliderait** : un rapport « propre » au premier appel, ou une réparation qui te
demande de faire quelque chose.

> **Correction de ma première version de cette recette.** J'avais écrit `h2a doctor` tout court.
> C'était faux : par conception, `doctor` sans `--repair` n'inspecte **pas** l'installation
> hôte — il ne peut donc pas nommer la marketplace morte. La revue indépendante l'a relevé.
> `--dry-run` est ajouté au produit pour cette raison : sans lui, il n'existe aucun moyen
> d'inspecter ta machine sans la modifier.

---

## Scénario 2 — une session vivante doit redémarrer après une réparation réelle

Le cœur du sujet, et ce qui a fait échouer **trois** revues indépendantes. Une réparation faite par
doctor peut changer le code réellement chargé sans qu'une session déjà démarrée le sache.

Ce scénario est **déterministe** : le harnais fabrique la présence sur le même bus et dans ses
propres `HOME` et bus temporaires. Il ne touche pas ta machine.

D'abord la preuve automatisée, qui exerce les cinq variantes :

```bash
node --test packages/h2a/test/host-installation-doctor.test.js
```

**Attendu** : `pass` sur tous les tests, et **exit 0**. C'est un test : il sort 0 quand il réussit.

> **Correction de ma deuxième version de cette recette, et c'est la faute la plus grave que j'y ai
> faite.** J'écrivais ici « attendu : sortie 2 » en pointant un `node --test` — donc mon document
> déclarait **invalidante la sortie 0 que produit précisément une implémentation correcte**. Pire,
> une réexécution de test n'est **pas** une observation : elle absorbe le comportement dans son
> assertion au lieu de te le montrer. La revue indépendante l'a mesuré littéralement.

Puis **l'observation** — c'est celle-ci qui vaut recette, parce que tu lis le comportement toi-même :

```bash
bash docs/uat/probe-live-session.sh          # fabrique le cas, puis lance $DOCTOR et affiche tout
```

Le probe imprime, dans cet ordre : le code de sortie, le champ `ok` du rapport JSON, et la liste des
motifs de redémarrage.

**Attendu, et c'est le point non négociable** : sortie **2**, `ok=false`, et un motif explicite disant
qu'une **session vivante doit redémarrer**. La réparation du cache ne suffit pas : la session a chargé
l'ancien code. Tu dois **voir** ces trois valeurs, pas les déduire d'un test vert.

Cette promesse est volontairement bornée :

| variante | ce qu'elle piège |
|---|---|
| réparation doctor avec écrasement **en place** | une session qui a démarré avant le marqueur doit redémarrer |
| `codex plugin add`, réinstallation npm ou autre modification manuelle | hors garantie de doctor : redémarre la session toi-même |

**Ce qui invaliderait** : sortie 0 sur le premier cas. Le second n'est pas une recette de détection
automatique : prétendre le contraire reviendrait à certifier un graphe de chargement que doctor ne
peut pas observer complètement.

---

## Nettoyage

```bash
rm -rf "$UAT" "$SRC"   # $SRC etait oublie : fuite mesuree a 351 Mio PAR extrait, deux fois de suite
```

---

## Ce que je te demande de trancher

1. **Le scénario 2 se comporte-t-il comme attendu ?** C'est la garantie centrale ; si elle
   tombe, l'item ne passe pas `done`, quel que soit le vert de la CI.
2. **Le scénario 1 t'a-t-il demandé quoi que ce soit ?** Ta demande du 22 juillet était
   « sans intervention manuelle » — une question posée est un échec.
3. **Y a-t-il une incohérence que tu as déjà rencontrée et qui n'est pas couverte ?** Six ont
   été mesurées le 29 juillet ; s'il t'en manque une, elle vaut mieux qu'un GO.

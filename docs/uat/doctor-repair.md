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

## Sécurité d'abord — les scénarios 1 et 2 ne touchent pas ta machine

Ils tournent dans un `HOME` jetable. Seul le scénario 3 lit ta vraie installation, et il
commence par une sauvegarde.

```bash
cd /home/antoinefa/src/h2a
export UAT=$(mktemp -d /home/antoinefa/.cache-tmp/uat-doctor-XXXX)
```

## Épingler le candidat — sinon tu testes autre chose que cette PR

`h2a` sur ton `PATH` résout vers le paquet **installé globalement**, pas vers cette branche, et
`packages/h2a/dist` n'est pas versionné. Sans ces deux lignes, tu recetterais une autre version que
celle que tu es en train de valider.

```bash
git rev-parse --short HEAD          # note-le : c'est le candidat que tu recettes
npm run build:h2a
export DOCTOR="node $PWD/packages/h2a/dist/bin.js"
```

**Toutes les commandes ci-dessous utilisent `$DOCTOR`, jamais `h2a`.** Si `$DOCTOR` n'existe pas, le
build a échoué et rien de ce qui suit n'a de valeur.

---

## Scénario 1 — la source de marketplace a disparu (le défaut réel du 29 juillet)

C'est celui qui a bloqué **tous** les plugins codex, h2a compris, pendant que le plugin
tournait sur un cache 0.85.18 figé.

```bash
mkdir -p $UAT/h1/.codex
printf '[marketplaces.sentropic]\nsource_type = "local"\nsource = "%s/disparu"\n' "$UAT" \
  > $UAT/h1/.codex/config.toml

HOME=$UAT/h1 $DOCTOR init --root "$UAT/h1/bus"
HOME=$UAT/h1 $DOCTOR doctor --root "$UAT/h1/bus" --repair --dry-run   # inspecte, ne modifie RIEN
echo "exit=$?"
HOME=$UAT/h1 $DOCTOR doctor --root "$UAT/h1/bus" --repair             # répare
echo "exit=$?"
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

## Scénario 3 — ta vraie installation, en lecture d'abord

```bash
cp -p ~/.codex/config.toml ~/.codex/config.toml.bak.uat-$(date +%Y%m%d-%H%M)
cp -p ~/.claude/plugins/known_marketplaces.json ~/.claude/plugins/known_marketplaces.json.bak.uat-$(date +%Y%m%d-%H%M) 2>/dev/null

mkdir -p "$UAT/h3"
$DOCTOR init --root "$UAT/h3/bus"
$DOCTOR doctor --root "$UAT/h3/bus" --repair --dry-run    # inspecte l'installation, ne modifie RIEN
```

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
cp ~/.codex/config.toml.bak.uat-… ~/.codex/config.toml
```

Cette sauvegarde restaure la **configuration**. Elle ne restaure ni les caches de plugins supprimés,
ni les entrées de marketplace, ni le marqueur `~/.codex/h2a-repair.json`, ni un plugin désinstallé.
Si tu veux un retour arrière complet, ne lance pas `--repair` sur ta vraie machine : le scénario 3
s'arrête au `--dry-run`, qui est prouvé inerte par empreinte dans le probe du scénario 2. Je préfère
te le dire que te laisser croire qu'une copie de `config.toml` annule tout.

---

## Nettoyage

```bash
rm -rf $UAT
```

---

## Ce que je te demande de trancher

1. **Le scénario 2 se comporte-t-il comme attendu ?** C'est la garantie centrale ; si elle
   tombe, l'item ne passe pas `done`, quel que soit le vert de la CI.
2. **Le scénario 1 t'a-t-il demandé quoi que ce soit ?** Ta demande du 22 juillet était
   « sans intervention manuelle » — une question posée est un échec.
3. **Y a-t-il une incohérence que tu as déjà rencontrée et qui n'est pas couverte ?** Six ont
   été mesurées le 29 juillet ; s'il t'en manque une, elle vaut mieux qu'un GO.

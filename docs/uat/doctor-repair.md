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
> Les commandes ci-dessous les **épinglent** donc explicitement dans l'arbre jetable, et le probe
> **refuse de démarrer** si l'une d'elles pointe ailleurs. Vérifie-le toi-même avant de lancer quoi que
> ce soit : `echo "$CODEX_HOME" "$CLAUDE_CONFIG_DIR"`.

```bash
cd /home/antoinefa/src/h2a
export UAT=$(mktemp -d /home/antoinefa/.cache-tmp/uat-doctor-XXXX)
# MEMORISER tes valeurs avant de les remplacer : les oublier ferait viser les racines par
# defaut au scenario 3, qui ne sont PAS ton installation si tu utilises ces variables.
export UAT_ORIG_CODEX_HOME="${CODEX_HOME-__unset__}" UAT_ORIG_CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR-__unset__}"
# epingler les racines hote DANS l arbre jetable : un HOME jetable ne suffit pas
export CODEX_HOME="$UAT/h1/.codex" CLAUDE_CONFIG_DIR="$UAT/h1/.claude"
```

## Épingler le candidat — sinon tu testes autre chose que cette PR

`h2a` sur ton `PATH` résout vers le paquet **installé globalement**, pas vers cette branche, et
`packages/h2a/dist` n'est pas versionné. Sans ces deux lignes, tu recetterais une autre version que
celle que tu es en train de valider.

```bash
git rev-parse --short HEAD          # note-le : c'est le candidat que tu recettes
npm ci                              # OBLIGATOIRE : sur une archive vraiment propre, build echoue sans lui
npm run build                       # PAS build:h2a : sur une extraction propre il sort 2, @sentropic/track manquant
export DOCTOR="node $PWD/packages/h2a/dist/bin.js"
[ -f packages/h2a/dist/bin.js ] || { echo "build echoue : rien de ce qui suit n'a de valeur"; }
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

**État mesuré sur la branche au moment où j'écris** : oracle 1 passe, oracle 2 **échoue** encore
(le marketplace mort n'est pas retiré). Je ne te donne pas cette recette comme verte.

---

## Scénario 3 — ta vraie installation, en lecture d'abord

> **⚠️ CE SCÉNARIO EST INVALIDE SI TU UTILISES DES RACINES PERSONNALISÉES, et c'est un défaut du
> PRODUIT, pas de cette recette.** Mesuré le 2026-07-30 : `CODEX_HOME` et `CLAUDE_CONFIG_DIR`
> apparaissent **0 fois** dans `packages/h2a/src`. Doctor **lit** toujours `$HOME/.codex`, alors que
> ses commandes natives, elles, honorent `CODEX_HOME`. Preuve avec un marqueur distinct par racine :
> doctor rapporte `plugin-stale` sur l'entrée de `$HOME/.codex` et reste **aveugle** à celle de
> `$CODEX_HOME`. **Il diagnostique une racine et répare l'autre.** Aucune gymnastique de shell ne
> peut corriger ça depuis une recette — donc ce scénario refuse de tourner plutôt que de te donner
> un résultat sur une installation que tu n'utilises pas.
>
> Trois versions successives de cette recette ont tenté de compenser (épingler, puis `unset`, puis
> restaurer). Les trois avaient tort : ce n'était pas à la recette de le résoudre.

```bash
# restaurer exactement ce que tu avais, y compris l'absence de variable
[ "${UAT_ORIG_CODEX_HOME:-__unset__}" = "__unset__" ] && unset CODEX_HOME || export CODEX_HOME="$UAT_ORIG_CODEX_HOME"
[ "${UAT_ORIG_CLAUDE_CONFIG_DIR:-__unset__}" = "__unset__" ] && unset CLAUDE_CONFIG_DIR || export CLAUDE_CONFIG_DIR="$UAT_ORIG_CLAUDE_CONFIG_DIR"
# ECHOUER FERME : le produit ne partage pas le contrat de racine des CLI natives.
if [ -n "${CODEX_HOME-}" ] || [ -n "${CLAUDE_CONFIG_DIR-}" ]; then
  echo "SCENARIO 3 REFUSE : tu utilises CODEX_HOME='${CODEX_HOME-}' CLAUDE_CONFIG_DIR='${CLAUDE_CONFIG_DIR-}'."
  echo "Doctor lirait \$HOME/.codex, pas ta racine. Le resultat porterait sur une autre installation."
  echo "Note-le comme NON RECETTE et exige le correctif produit (partager le contrat, ou refuser)."
else
  # TOUT le scenario vit DANS cette branche : un simple message de refus serait fail-open,
  # exactement le defaut que ce refus existe pour eviter. La structure refuse, pas la prose.
  CODEX_ROOT="$HOME/.codex"
  CLAUDE_ROOT="$HOME/.claude"
  STAMP=$(date +%Y%m%d-%H%M)
  cp -p "$CODEX_ROOT/config.toml" "$CODEX_ROOT/config.toml.bak.uat-$STAMP"
  cp -p "$CLAUDE_ROOT/plugins/known_marketplaces.json" "$CLAUDE_ROOT/plugins/known_marketplaces.json.bak.uat-$STAMP" 2>/dev/null

  mkdir -p "$UAT/h3"
  $DOCTOR init --root "$UAT/h3/bus"
  $DOCTOR doctor --root "$UAT/h3/bus" --repair --dry-run  # inspecte l'installation, ne modifie RIEN
fi
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
cp "$CODEX_ROOT/config.toml.bak.uat-$STAMP" "$CODEX_ROOT/config.toml"
```

Cette sauvegarde restaure la **configuration**. Elle ne restaure ni les caches de plugins supprimés,
ni les entrées de marketplace, ni le marqueur `h2a-repair.json` de ta racine codex, ni un plugin désinstallé.
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

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

---

## Sécurité d'abord — les scénarios 1 et 2 ne touchent pas ta machine

Ils tournent dans un `HOME` jetable. Seul le scénario 3 lit ta vraie installation, et il
commence par une sauvegarde.

```bash
cd /home/antoinefa/src/h2a
export UAT=$(mktemp -d /home/antoinefa/.cache-tmp/uat-doctor-XXXX)
```

---

## Scénario 1 — la source de marketplace a disparu (le défaut réel du 29 juillet)

C'est celui qui a bloqué **tous** les plugins codex, h2a compris, pendant que le plugin
tournait sur un cache 0.85.18 figé.

```bash
mkdir -p $UAT/h1/.codex
printf '[marketplaces.sentropic]\nsource_type = "local"\nsource = "%s/disparu"\n' "$UAT" \
  > $UAT/h1/.codex/config.toml

HOME=$UAT/h1 h2a init --root "$UAT/h1/bus"
HOME=$UAT/h1 h2a doctor --root "$UAT/h1/bus" --repair --dry-run   # inspecte, ne modifie RIEN
HOME=$UAT/h1 h2a doctor --root "$UAT/h1/bus" --repair             # répare
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

```bash
node --test packages/h2a/test/host-installation-doctor.test.js
```

Puis relance exactement le cas d'écrasement en place, la vérification manuelle reproductible :

```bash
node --test --test-name-pattern='existing Codex plugin directory is overwritten in place' \
  packages/h2a/test/host-installation-doctor.test.js
```

**Attendu, et c'est le point non négociable** : sortie **2**, `ok=false`, et un motif explicite
disant qu'une **session vivante doit redémarrer**. La réparation du cache ne suffit pas : la
session a chargé l'ancien code.

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
h2a init --root "$UAT/h3/bus"
h2a doctor --root "$UAT/h3/bus" --repair --dry-run    # inspecte l'installation, ne modifie RIEN
```

Lis le rapport. Il doit décrire ton état réel : une seule marketplace `sentropic` par hôte,
`h2a@sentropic` à la version npm, un seul endpoint MCP `h2a`, aucun `track-mcp` autonome — et
lister ce qu'une réparation changerait.

> **Même correction que le scénario 1** : j'avais écrit `h2a doctor` seul, qui ne regarde pas ton
> installation hôte. `--dry-run` est la seule façon honnête de te faire inspecter ta machine
> avant de décider.

Puis, seulement si tu le veux :

```bash
h2a doctor --root "$UAT/h3/bus" --repair
```

**Attendu** : soit « rien à réparer », soit une liste de ce qui a été changé. Jamais un silence.
Le bus temporaire isole cette recette des sessions de ton bus quotidien ; si doctor a réparé ton
installation, redémarre toute session que tu sais antérieure à cette réparation.

**Pour revenir en arrière** : `cp ~/.codex/config.toml.bak.uat-… ~/.codex/config.toml`.

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

# Affectation des modèles : conception, construction, relecture

**Politique owner du 2026-09-19** (dossier « Rôles h2a », décision D3=B et commentaire de
l'owner). Elle remplace les tableaux de la directive du 2026-08-20 (sujet Track
`01M0GT68VZZ06ANK889AKHC4A1`), qui nommaient `gpt-5.6-sol`, `gpt-5.6-terra`, `claude-fable-5`
et `gemini-3.7`. Les règles d'indépendance, d'attestation et de compilation de cette directive
sont conservées ci-dessous (sections B à D).

Tenue par le rôle Cadre et assurance (`arch`, qui reprend les flux S6 et S8 de l'ancienne lane
harness). Le conducteur applique et délègue ; il ne décide pas ici. **Toute évolution de cette
politique passe par une qualification séparée, puis par une décision de l'owner (D3=B).**

Ce fichier dit quels modèles peuvent concevoir, construire et relire, et **où chaque règle
s'arrête** — une règle dont l'application n'est pas décrite est une habitude habillée en
garantie.

---

## A · Politique de l'owner

Commentaire de l'owner, verbatim (2026-09-19, réponse D3=B) :

> « on va passer a astra-medium pour le build, astra xhigh pour le design, on oublie les autres
> codex. pour le build côté opus on reste sur opus5, design fable5.1, et gemini : same all the
> way 3.8 high »

| Famille | Construction (build) | Conception (design) |
|---|---|---|
| Codex | `gpt-6-astra` · effort `medium` | `gpt-6-astra` · effort `xhigh` |
| Claude | Opus 5 (`claude-opus-5`) | Fable 5.1 (`claude-fable-5-1`) |
| Gemini | `gemini-3.8-flash-high` | `gemini-3.8-flash-high` |

- **Codex : les autres modèles sont abandonnés** — notamment `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.3-spark` et `gpt-5.5`. Ils ne servent plus ni à concevoir, ni à
  construire, ni à relire.
- **La table est exhaustive.** Un modèle absent de la table n'est pas autorisé, même s'il est
  disponible dans un catalogue : `claude-fable-5`, `gemini-3.7`, `sonnet-5` et les anciens
  replis « cas simples » en font partie.
- **Gemini** : le même modèle pour tout. L'owner a écrit « 3.8 high » ; l'identifiant retenu
  est `gemini-3.8-flash-high`, tel que le catalogue local le nomme.
- **Efforts non fixés** : l'owner ne fixe pas d'effort pour Opus 5 et Fable 5.1. Aucun effort
  n'est imposé ici ; le fixer relève de la qualification séparée (section E).
- **Conducteur** : cette politique ne fixe pas le modèle du conducteur.

---

## B · Relecture

**Relecture par une autre famille que l'auteur.** Une jambe de relecture n'appartient jamais à
la famille du modèle qui a produit l'artefact. Elle utilise le profil de conception de sa
famille (`gpt-6-astra` · `xhigh`, Fable 5.1 ou `gemini-3.8-flash-high`).

Trois règles bornent un consensus de deux jambes :

1. **Le constructeur n'est jamais relecteur.** Qui a produit l'artefact ne peut pas en être une
   jambe — y compris lorsqu'il s'agit d'un constructeur délégué.
2. **Les deux jambes sont de modèles différents entre eux**, et chacune d'une famille différente
   de celle de l'auteur. Avec trois familles, une fusion est donc relue par les deux familles
   qui ne l'ont pas produite : un build Codex est relu par Fable 5.1 et `gemini-3.8-flash-high` ;
   un build Claude par `gpt-6-astra` · `xhigh` et `gemini-3.8-flash-high` ; un build Gemini par
   `gpt-6-astra` · `xhigh` et Fable 5.1.
3. **Chaque jambe est tirée de la table de la section A.** Être différent de l'auteur ne suffit
   pas : un modèle hors table mais différent du producteur passerait sinon le filtre — c'est le
   vecteur par lequel une jambe `gpt-5.5` a été acceptée le 2026-08-22.

### Pourquoi la règle 2 existe

Le 2026-08-20, **quatre passes de `fable`** ont laissé passer un contournement Base64 dans la
spécification cluster-mesh ; `sol` l'a trouvé au premier regard. La leçon n'est
pas qu'un modèle est faible : **deux jambes qui partagent un modèle partagent ses angles
morts** — deux signatures, une seule vérification. C'est la même forme que deux défauts déjà
mesurés ici : deux agents d'accord ne font pas une mesure, et deux exécutions sur le même hôte
ne font pas deux mesures.

### Où la règle 2 s'arrête — à lire avant de la citer

**Rien n'enregistre quel modèle a produit quelle jambe** — mesuré le 2026-08-20 sur les
1 333 événements de `.track/events.jsonl` : aucun champ de modèle ou d'effort ; `by` porte une
seule valeur (l'identité humaine) ; `prov` ne porte que `auth`, `proposed` et `transport`. Git
ne le porte pas non plus : les identités d'auteur agent (« Codex ») nomment un outil, jamais un
modèle ni un effort. Une jambe inter-familles est donc **déclarée, jamais vérifiée**.

De plus, **un agent ne peut pas observer de façon fiable le modèle qui le sert.** Par
conséquent :

- une jambe déclare son modèle ; elle ne prétend pas l'avoir observé ;
- une déclaration n'est utilisable que si elle établit **à la fois** l'**appartenance** (chaque
  modèle qu'elle laisse ouvert figure dans la table) et la **distinction** (vis-à-vis de
  l'autre jambe et de l'auteur, au niveau de la famille) ;
- une déclaration ambiguë n'est utilisable que si **tous** les modèles qu'elle peut désigner
  sont autorisés et d'une autre famille que l'auteur ;
- quand l'une des conditions ne peut être établie, la jambe n'est **pas attestable** et une
  autre jambe est requise.

Cette règle est au barreau « ligne de spécification ». Ce qui l'élèverait : un champ
d'attestation qui enregistre le modèle producteur et le modèle relecteur par artefact — `prov`
existe déjà sur chaque événement.

### Jambes et passerelle

Les jambes de relecture tournent **sans passerelle** (no-gw) et doivent être attestables. Une
session routée par la passerelle ne peut pas attester son modèle : la passerelle réécrit les
`claude-*` et le modèle servi n'est pas le modèle demandé. Une jambe produite sous passerelle
n'est pas une jambe.

### Une jambe qui annonce « build vert » doit avoir construit comme la CI

**`npm ci`** à la racine du dépôt — la commande littérale, pas « une installation propre » —
puis `npm run build` / `npm run typecheck`. Un arbre assemblé autrement peut rendre présents les
types d'une dépendance pair que `npm ci` n'installerait pas, et masque exactement la classe de
défauts qu'un build doit attraper.

Vecteurs de masquage connus : `node_modules` lié à la main ; `npm link` ou `npm install`
par-dessus un arbre qui a déjà la dépendance ; `NODE_PATH` pointant hors du checkout ; **un
worktree imbriqué sous un ancêtre qui a son propre `node_modules`** (Node remonte jusqu'à en
trouver un) ; des `dist/*.d.ts` périmés.

Mesuré sur `rhanka/h2a#231` : les deux jambes et la passe préliminaire ont construit dans un
worktree lié à la main et annoncé 20/20 vert ; la CI propre a échoué de façon déterministe sur
`packages/h2a/src/runtime/mcp-central.ts:72` (TS2307). Trois vérifications, un environnement
partagé, zéro vérification.

**Où cela s'arrête** : rien ne vérifie qu'une jambe a construit proprement. La CI à la révision
exacte est le seul oracle ; l'affirmation d'une jambe vaut ce que vaut la conclusion de CI
qu'elle peut citer.

---

## C · Construction

La construction utilise le profil de construction d'une des trois familles (section A). Il n'y
a plus de liste de replis ni de « cas simples » : les modèles qui les remplissaient sont
abandonnés ou hors table.

**Le constructeur n'est jamais relecteur, ni jambe de consensus** — sur son propre travail,
dans un sens comme dans l'autre. Figurer dans la table n'autorise jamais une jambe : la famille
du constructeur est exclue de la relecture de son artefact.

---

## D · Ce que ce document ne décide pas

- **Le routage.** Quelle cible sert réellement une requête relève du contrat de routage. Ce
  fichier dit qui peut être *sollicité* ; le contrat dit ce qui est *servi*.
- **La compétence des modèles.** Rien ici n'affirme qu'un modèle est bon pour une tâche. Ce
  fichier attribue une autorisation, pas une compétence.
- **L'application.** Aucun contrôle ne lit ce fichier. Chaque règle est appliquée par les
  acteurs qui le lisent : c'est son barreau, et c'est pourquoi la section B dit où sa règle
  principale s'arrête.

---

## E · Évolution de la politique (D3=B)

L'owner a retenu D3=B : **toute évolution future de cette politique passe par une
qualification séparée** — ajout ou retrait d'un modèle, changement d'effort, changement de
profil de relecture, remplacement d'un identifiant. La qualification est portée par Cadre et
assurance (`arch`) et relue selon la section B ; elle ne confère aucun droit par elle-même.
Seule une décision de l'owner, tracée dans Track, modifie la section A.

Un modèle disponible dans un catalogue, ou nommé dans un brief pour une mission ponctuelle,
n'est pas autorisé de façon permanente tant qu'il n'a pas été qualifié puis décidé.

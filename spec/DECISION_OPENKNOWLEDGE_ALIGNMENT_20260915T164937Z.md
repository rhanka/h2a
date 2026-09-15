# DECISION DOSSIER — Alignement de la mémoire h2a sur Open Knowledge Format (OKF)

> **Statut :** présentation (design-only). Ce dossier **présente** ; il ne demande aucune signature.
> Aucune décision M1–M7 / F1–F3 du substrat mémoire n'est rouverte.
> **Cible arbitrée par l'owner (via gr-conductor) :** Google **Open Knowledge Format (OKF) v0.2**.
> **Cadrage arbitré :** étude *export/interop* — « peut-on émettre/consommer les Episodes h2a comme
> concepts OKF » — **additif et réversible**.
>
> **Auteur :** ASTRA (agent d'analyse), exécuté en Claude Opus (équivalent astra).
> **Date :** 2026-09-15 · **decisionKind :** `orientation` · **h2a-focus.**
> **Double-instruction (revue indépendante) :** leg Opus indépendant = couvert (§9) ;
> **leg Codex = `source-gap`** (crédits épuisés) → dossier à second-pass **partiel** (voir §7, §9).
>
> Chaque affirmation porteuse est taguée `[FACT]` (vérifiable + source) ou `[JUDGMENT]` (lecture d'ASTRA).

---

## 1. Décision demandée

**h2a doit-il aligner sa représentation mémoire/connaissance sur OKF, et à quel degré ?**
Quatre options : **A** aligner pleinement · **B** aligner partiellement via un **port d'export injecté** ·
**C** ne pas aligner · **D** hybride (incrément lecture-seule maintenant, gate avant tout natif).

**Périmètre exact.** Surface d'**interop** : sérialisation d'Episodes h2a en **bundle OKF** (fichiers
Markdown + frontmatter YAML `type` + cross-links) et, symétriquement, l'ingestion éventuelle d'un bundle
OKF externe. **Hors périmètre :** le choix du substrat mémoire (déjà décidé : graphify + SQLite canonique),
le ranking (`M5=C`), la rétention (`M3`), la gouvernance d'admission (`M4`).
**L'ingestion (import) d'un bundle OKF externe est explicitement différée hors de la reco** : c'est la
surface de fuite la plus risquée (un bundle externe n'apporte ni signature ni trust vérifiable). La reco
ci-dessous est **export-seule** ; l'import reste derrière un gate séparé (voir §5.2, §7).

---

## 2. Contexte — faits, hypothèses, inconnues (séparés)

### 2.1 Le modèle OKF v0.2 (cible)

- `[FACT]` Un **bundle** OKF est un arbre de fichiers Markdown auto-contenu, distribuable en dépôt git,
  tarball ou zip. Source : `GoogleCloudPlatform/open-knowledge-format` `SPEC.md` (v0.2).
- `[FACT]` **Un seul champ de frontmatter est requis : `type`** (« the only always-required key ; a
  concept carrying just `type` is fully conformant »). Recommandés : `title`, `description`, `resource`
  (URI), `tags`. Les producteurs peuvent ajouter des clés custom ; les consommateurs **doivent préserver
  les clés inconnues** en round-trip. Source : SPEC.md v0.2.
- `[FACT]` Les **cross-links** sont de simples liens Markdown (forme *bundle-relative* commençant par `/`,
  recommandée). **La nature du lien (parent/child, references, depends-on…) est portée par la prose
  environnante, PAS par le lien.** Source : SPEC.md v0.2.
- `[FACT]` `index.md` optionnel à tout niveau (progressive disclosure) ; `okf_version: "0.2"` dans
  l'`index.md` racine. Pas de taxonomie de `type` centrale : le producteur définit son vocabulaire.
- `[JUDGMENT]` OKF est un format de **livraison de contexte** à des agents. Il **n'a aucun modèle**
  d'intégrité (pas de hash-chain), de signature, d'edge typée, ni de bi-temporalité.

### 2.2 La représentation mémoire/connaissance actuelle de h2a

- `[FACT]` **Episode** immuable = `Context` + `Decision` + `Evidence`, portant structurellement *subject*,
  `occurred_at` (au root, ancré à un composant), `recorded_at` canonique, **provenance citée**, `trust`,
  `scope`, `retention` (invariant **F1**). Source : `docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md` §1.
- `[FACT]` **Journal/envelope** : entrées **hash-chaînées signées** — `protocol/version/sequence/prevHash/`
  `contentHash`, `actor`, `causationId`, `correlationId`, `signatures`, `artifactKind`, `contractId`.
  Source : `packages/h2a/src/journal.ts` (`H2AJournalPayload` / `H2AJournalEntry`).
- `[FACT]` Répartition (**M5=C**) : h2a **configure et câble** ; **graphify** est le moteur de projection,
  embeddings, vectorisation, recall et **ranking** ; le SQLite local garde l'autorité canonique minimale.
  Source : memory-core study §1.
- `[FACT]` Vocabulaire connaissance déjà présent côté substrat : `MemoryNote`, `UserModel`,
  `Persona/Soul`, `Skill`, recall role-scoped, lineage. Source :
  `docs/specs/2026-07-25-h2a-agent-memory-merged-design.md` §5.

### 2.3 La contrainte de neutralité graphify (l'axe sensible signalé par l'owner)

- `[FACT]` **D1** : les contrats `graphify-memory` sont des **DTO data-only + signatures de ports** ;
  les `.d.ts`/JSON Schema émis portent **exactement** le jeu de noms neutres, `additionalProperties:false`,
  et **aucun** identifiant consommateur, forme *evaluator/authorship/review-leg/persona/role/roster/*
  *coordination/topology*. **Les bridges de projection peuvent dépendre des deux côtés mais ne sont PAS
  ré-exportés par `graphify-memory`.** Source : graphify `spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md` D1.
- `[JUDGMENT]` Conséquence directe : le vocabulaire OKF `type` (`episode`/`context`/`decision`/`evidence`)
  et le frontmatter en forme d'Episode sont de la **sémantique consommateur (h2a)**. Les loger **dans**
  `graphify-memory` violerait D1. Les loger **dans un bridge/adapter côté h2a** est explicitement autorisé.

### 2.4 Hypothèses et inconnues

- `[ASSUMPTION]` La valeur d'OKF ici est l'interop de contexte lisible par des agents tiers, pas
  l'archivage d'intégrité (déjà couvert par le journal signé).
- `[UNKNOWN / source-gap]` **Aucun consommateur OKF réel** n'a été trouvé dans la flotte (h2a, graphify,
  sentropic). → Le bénéfice interop est **potentiel**, pas actif aujourd'hui.
- `[UNKNOWN / source-gap]` Nom exact du flag « options » du `track` **vendored** h2a (surface canonique
  sentropic `--options-json` vs surface h2a) → à confirmer par h-cond sur le binaire live (voir §Track).

### 2.5 Cartographie Episode h2a → concept OKF (le fond de l'étude)

| Élément h2a | Expression OKF v0.2 | Statut |
|---|---|---|
| Episode (identité, subject) | 1 fichier concept `type: episode`, `title`, `resource` (URI de l'Episode) | **couvert** |
| Context / Decision / Evidence | soit sections du corps, soit 3 concepts liés (`type: context/decision/evidence`) — ces valeurs se mappent sur l'enum **déjà neutre** `memory_kind` de graphify ; seuls `episode` + le frontmatter vivent côté bridge | **couvert** |
| `occurred_at` / `recorded_at` (bi-temporel) | clés custom frontmatter (préservées en round-trip) | **couvert, non-standard** |
| provenance citée | cross-links vers les sources + `resource` ; clé custom `provenance` | **partiel** |
| `trust`, `scope` | clés custom ; `scope` ↔ placement dans l'arbre (compartiment privé vs workspace-capitalisé) | **partiel** |
| `retention` (+ `purpose` obligatoires si `subject=human:<ref>`) | clé custom **sans exécution** : OKF n'a ni expiry, ni redaction, ni enforcement de scope | **risque gouvernance** (voir §2.6) |
| edges typées (causationId, decision→evidence, review-leg) | liens Markdown **non typés** (la nature est dans la prose) | **perte** |
| signatures / hash-chain / `contentHash` | **aucun équivalent OKF** | **non couvert** |

`[JUDGMENT]` L'export est **structurellement possible mais lossy** sur trois axes que h2a valorise :
edges typées, intégrité cryptographique, et vérifiabilité du trust. À l'**import**, un bundle OKF externe
n'apporte ni signature ni trust vérifiable ; il entrerait donc comme *candidat* `pending` (cohérent avec
`F3`/`M4`), jamais en recall direct.

### 2.6 Risque gouvernance / rétention (au-delà du « lossy »)

- `[FACT]` Pour un Episode de `subject=human:<ref>`, h2a rend `purpose` **et** `retention` **obligatoires**.
  Source : memory-core study §1 (lignes ~180-181).
- `[FACT]` OKF n'a **aucun** mécanisme d'expiry, de redaction ou d'enforcement de scope.
- `[JUDGMENT]` Donc un bundle OKF exporté est une **copie non signée, non révocable, de mémoire à sujet
  humain**, qui peut **survivre au-delà de son horizon de rétention**. Ce n'est pas qu'une perte de
  fidélité : c'est un **risque de gouvernance/privacy**. Le lecture-seule ne le mitige qu'incidemment →
  la mise en œuvre doit poser un **gate explicite sujet-humain / rétention** avant tout export (voir §7).

---

## 3. Enjeux (pourquoi niveau dossier)

- `[FACT]` **Cross-owner / cross-repo** : touche h2a (Episode/journal) **et** graphify (neutralité D1).
- `[JUDGMENT]` **Surface d'interop potentiellement publique** (format externe Google) : un mauvais
  placement ferait **fuiter le vocabulaire OKF dans les contrats neutres graphify** → violation D1
  (l'exact *STOP-trigger* signalé par l'owner).
- `[FACT]` L'owner a demandé une validation **au niveau des enjeux** → dossier complet, pas un menu.
- `[JUDGMENT]` Blast radius asymétrique : bien placé (bridge injecté) = additif/réversible ; mal placé
  (dans le moteur) = dette d'architecture durable.

---

## 4. Options (une ligne par option, rejetées incluses)

| id | Choix | Cas POUR le plus fort | Cas CONTRE le plus fort | Coût | Réversibilité | Neutralité graphify | Ce qui la ferait gagner |
|---|---|---|---|---|---|---|---|
| **A** | **Aligner pleinement** — h2a/graphify émettent et **consomment** OKF nativement comme représentation mémoire de 1re classe | Interop maximale ; un seul format lisible par tout agent tiers ; pas d'adapter à maintenir | **Fait fuiter le vocabulaire OKF dans le moteur** (viole D1) **ou** force une extension non-standard ; **perd** signatures/hash-chain/edges typées ; migration lourde | **Élevé** | **Faible** (> un bloc) | **Touchée / à risque** | Un mandat produit fort « OKF = format mémoire canonique » **et** l'acceptation de perdre l'intégrité signée |
| **B** | **Aligner partiellement via un port d'export INJECTÉ** — un bridge (côté h2a / owned à part) sérialise les Episodes → bundle OKF depuis la sortie **neutre** du recall graphify | Interop réelle **sans** toucher la neutralité (OKF vit dans le bridge) ; additif ; réversible ; consomme le recall neutre | Un adapter + un mapping `type` à maintenir ; export **lossy** (edges/intégrité) ; bénéfice réel seulement si un consommateur OKF existe | **Moyen-bas** | **Élevée** | **Préservée** (bridge non ré-exporté, cf. D1) | Vouloir de l'interop OKF **en gardant** l'intégrité h2a et la neutralité graphify |
| **C** | **Ne pas aligner** — garder Episode/journal tel quel, aucune surface OKF | Coût zéro ; zéro dette ; aucune perte d'intégrité ; aucun risque neutralité | Ferme l'interop OKF ; aucune lisibilité par agents tiers ; ignore une norme émergente | **Nul** | **N-A** | **Préservée** | Certitude qu'aucun consommateur OKF n'existera |
| **D** | **Hybride** — incrément **lecture-seule** maintenant (= B, scope réduit : n'exporter que les dossiers/décisions **déjà publiés**), **gate** de décision avant tout natif (part de A) | Livre une valeur interop minimale vite ; garde l'optionalité vers A ; time-boxé | Reste à décider plus tard ; deux passes de gouvernance ; surface d'abord étroite | **Bas** | **Élevée** | **Préservée** | Vouloir prouver la valeur avant d'investir, sans fermer A |

`[JUDGMENT]` **Seule l'option A touche la neutralité graphify.** B, C et D la préservent — B/D en logeant
strictement l'émission OKF dans un **bridge injecté** qui consomme la sortie neutre du recall (autorisé par
D1 : « projection bridges may depend on both sides but are not re-exported by `graphify-memory` »).
C'est la réponse directe au *STOP-trigger* de l'owner : **aucune option recommandée ne touche la neutralité.**

---

## 5. Recommandation + rationale

**Recommandation : option B, séquencée comme D** — un **port d'export injecté**, livré d'abord en
**incrément lecture-seule** sur les décisions/dossiers déjà publiés, gate explicite avant tout pas natif.

`[JUDGMENT]` **Jugement décisif :** B/D sont les seules options qui livrent de l'interop OKF **tout en**
(1) préservant la neutralité graphify — l'exact critère STOP de l'owner — et (2) préservant l'intégrité
signée de h2a (le journal reste la source d'autorité ; OKF est une projection sortante, pas le canon).
A est écartée parce qu'elle est la **seule** à toucher la neutralité et parce qu'elle **détruit** des
garanties (signatures, hash-chain, edges typées) qu'OKF ne sait pas porter. C est écartée parce qu'elle
ferme l'interop sans contrepartie, alors que B est additif et réversible à coût moyen-bas.

### 5.1 Cas le plus fort CONTRE ma recommandation (obligatoire, non vide)

`[JUDGMENT]` **Aucun consommateur OKF n'existe dans la flotte** (§2.4). Construire un port d'export — même
injecté — pour un format que personne ne lit encore, c'est de la **dette spéculative** : le steelman de C
(« ne rien faire ») est réel. Un export **lossy** (edges/intégrité perdues) pourrait aussi **induire en
erreur** un consommateur tiers qui prendrait le bundle OKF pour la vérité canonique alors qu'il a perdu
trust et signatures. Si l'objectif réel est l'archivage vérifiable, OKF est le mauvais outil et B est un
détour.

### 5.2 Ce qui renverserait la reco

`[JUDGMENT]` (a) La preuve qu'aucun consommateur OKF n'apparaîtra → bascule vers **C**. (b) Un mandat
produit « OKF = format mémoire canonique de la flotte » **assumant** la perte d'intégrité → bascule vers
**A**. (c) La découverte d'un consommateur OKF déjà en place → renforce **B** mais peut justifier d'élargir
le scope au-delà du lecture-seule.

### 5.3 Pré-mortem (« six mois plus tard, ça a échoué parce que… »)

`[JUDGMENT]` …le bridge d'export a lentement absorbé de la logique h2a-spécifique (mapping `type`, edges en
prose) et un contributeur l'a « rapproché » du moteur graphify pour « simplifier », faisant fuiter le
vocabulaire OKF dans les contrats neutres et violant D1 sans que la CI ne l'attrape.
**Mitigation (corrigée après revue) :** le bon garde n'est **pas** de scanner la neutralité du *bridge*
— le bridge **doit** porter le vocabulaire OKF par conception, donc ce scan échoue par construction ou ne
prouve rien. Le garde correct est un **scan de non-import / non-ré-export sur la *closure de publication*
de `graphify-memory` elle-même** (déjà mandaté par D1, clauses 3-4 : `.d.ts`/JSON Schema au jeu de noms
neutres exact, `additionalProperties:false`, et closure de dépendances one-way) : il affirme que
`graphify-memory` **n'importe ni ne ré-exporte** le bridge OKF. Le bridge, lui, vit dans un package owned
à part.

### 5.4 Divulgation d'intérêt de l'agent (présentateur)

`[JUDGMENT]` **Le plus facile / rapide pour moi (ASTRA)** serait **C** (rien à concevoir) ou **A** (un
récit d'alignement « propre » et vendeur). Je recommande **B/D**, plus coûteux à décrire, parce que c'est
l'option qui sert l'intérêt de l'owner : **optionalité future** (garde la porte OKF ouverte),
**intégrité** (ne sacrifie pas le journal signé), **neutralité** (ne crée pas de dette D1) et **coût
maîtrisé** (réversible). Là où mon intérêt et celui de l'owner pourraient diverger : je pourrais être
tenté de sur-vendre B comme « gratuit » — il ne l'est pas (un adapter à maintenir, un export lossy).

### 5.5 Conditions de la reco (adoptées après la revue indépendante §9)

B/D est recommandé **sous ces conditions**, faute de quoi la reco bascule vers **C** :

1. **Export-seule.** L'import de bundles OKF externes est hors reco (surface de fuite la plus risquée) —
   derrière un gate séparé (§2.4, §1).
2. **Gate sujet-humain / rétention** avant tout export (§2.6) : ne pas exporter de mémoire
   `subject=human:<ref>` sans une politique d'expiry/redaction hors-OKF.
3. **Garde de neutralité = scan de non-import/non-ré-export sur la closure de publication de
   `graphify-memory`** (D1 clauses 3-4), **pas** un scan du bridge (§5.3).
4. **Conditionné à l'apparition d'un consommateur OKF réel** (§5.2a) : sans consommateur, rester en **C**.

---

## 6. Réversibilité / coût

- `[JUDGMENT]` **B/D** : rollback = supprimer le bridge et le bundle généré ; **aucune donnée canonique
  n'est touchée** (le journal signé reste la source). Coût = un adapter de projection + un mapping `type`
  + un `index.md` de bundle ≈ **un lot**. Sunk cost en cas d'abandon ≈ le bridge seul.
- `[JUDGMENT]` **A** : migration du modèle mémoire + réécriture de contrats ; rollback **> un bloc** ;
  perte d'intégrité difficilement réversible une fois des consommateurs branchés.
- `[JUDGMENT]` **C** : coût et rollback nuls.

---

## 7. Attendus (critères de validation de l'owner)

| Critère | Source | Couvert par | Écart |
|---|---|---|---|
| Neutralité graphify préservée (STOP-trigger) | message gr-conductor | **B/D** (bridge injecté, D1) | aucun pour B/C/D ; **A = à risque** |
| Additif et réversible | cadrage owner | **B/D** | A non réversible |
| Cible = OKF v0.2 | arbitrage owner | §2.1 (SPEC.md v0.2) | aucun |
| 4 options + trade-offs mesurés | tâche | §4 (coût·neutralité·réversibilité·bénéfice·risque) | aucun |
| Reco argumentée + ce que chaque option débloque | tâche | §5 + §8.1 | aucun |
| Format dossier habituel (fond, revues, enjeux ouverts) | `docs/focus/decision-dossier-format.md` | §2/§4/§9/§10 | aucun |
| Revue par reviewer, réelle (pas « tout le monde a relu ») | même source | §9 | **partiel** : leg Codex = `source-gap` |
| Gate sujet-humain / rétention avant export | revue §9 Q5 + memory-core §1 | §2.6 + §5.5(2) | à implémenter au lot |
| Import OKF hors reco (export-seule) | revue §9 Q2 | §1 + §5.5(1) | import derrière gate séparé |
| Garde neutralité = scan closure `graphify-memory` (pas le bridge) | revue §9 Q2 | §5.3 + §5.5(3) | à câbler en CI |
| Enregistrement track prêt pour h-cond (single-writer) | tâche | §Track + fichiers payload | live-write réservé à h-cond |

---

## 8. Ce dont j'ai besoin de vous (plus petit choix valide)

**Approuver B (port d'export injecté, incrément lecture-seule)** — ou choisir **A / C / D**, ou **différer**.
Ce dossier **présente** ; il ne vous demande pas de signer. La signature reste un acte séparé, à vos
conditions.

### 8.1 Ce que chaque option débloque

- **A** → un format mémoire unique lisible par tout agent tiers (au prix de l'intégrité et de la neutralité).
- **B** → l'interop OKF sortante (dossiers/Episodes exportables) **sans** dette neutralité ni perte du canon signé.
- **C** → rien de neuf ; garde toute l'énergie sur le substrat déjà décidé.
- **D** → une preuve de valeur lecture-seule rapide **plus** l'optionalité intacte vers A.

---

## 9. Revues (le fond de chaque reviewer, sans complaisance)

- **Reviewer 1 — ASTRA / Opus (auteur).** Self-audit gate `present-decision` passé : tags FACT/JUDGMENT
  posés ; symétrie de comptage des « POUR » entre options ; cas CONTRE la reco non vide (§5.1) ;
  renversements (§5.2) ; pré-mortem (§5.3) ; divulgation d'intérêt (§5.4).
- **Reviewer 2 — passe Opus indépendante (sous-agent).** **Verdict : accord-sous-conditions.**
  - Tous les `[FACT]` vérifiés en source : champs journal présents dans `journal.ts` (l.3-33) ; OKF v0.2
    confirmé sur le web point par point ; F1 et D1 confirmés.
  - **STOP-trigger réellement évité**, placement D1-légal (SPEC_EVOL D1 l.20) ; corroboration :
    `context/decision/evidence` se mappent sur l'enum neutre `memory_kind` de graphify — seuls
    `episode`+frontmatter vivent côté bridge → aucun changement de propriété de contrat, pas de fuite à
    l'export. **Mais** le garde de neutralité de §5.3 était mal spécifié (scanner le bridge ne prouve
    rien) → **corrigé** en §5.3/§5.5(3). Et l'**import** OKF (la surface la plus risquée) devait être
    sorti du scope → **corrigé** en §1/§5.5(1) (export-seule).
  - **Symétrie de comptage OK** (POUR : A=3, B=4, C=4, D=3 ; C, le vrai rival, n'est pas affamé) ; le cas
    CONTRE la reco (§5.1) est un vrai steelman, pas un strawman.
  - **Aucun `[FACT]` faux.** (Nuance : « OKF n'a pas de modèle d'intégrité » est tagué `[JUDGMENT]` alors
    qu'il est factuellement `[FACT]` — prudence conservée.)
  - **Risque le plus sous-pondéré : rétention/sujet-humain comme échappatoire d'export** → intégré en
    **§2.6** et en condition **§5.5(2)**.
- **Leg Codex — `source-gap`.** Indisponible (crédits épuisés). La double-instruction (Codex **+** Opus)
  n'est donc que **partiellement** satisfaite → ce dossier est marqué **second-pass partiel** ; l'owner
  décide d'attendre le leg Codex ou de procéder en l'état (seule la préparation réversible a continué).

---

## 10. Ce que la validation ne livre PAS

- `[FACT]` Elle **n'implémente pas** le port d'export (c'est un lot séparé).
- `[FACT]` Elle **ne fournit aucun consommateur OKF** (aucun n'existe dans la flotte à ce jour).
- `[FACT]` Elle **ne migre pas** le substrat mémoire et **ne rouvre pas** `M5=C` ni `F1`.
- `[JUDGMENT]` L'**intégrité** (signatures, hash-chain, edges typées) **reste hors OKF** : le bundle est une
  projection sortante lossy, jamais la source d'autorité.

---

### Provenance des sources

- OKF v0.2 : `github.com/GoogleCloudPlatform/open-knowledge-format` `SPEC.md` (récupéré 2026-09-15).
- Episode/F1 : `docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md` §1.
- Journal : `packages/h2a/src/journal.ts`.
- Neutralité D1 : `graphify` `spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md` D1.
- Modèle mémoire fusionné : `docs/specs/2026-07-25-h2a-agent-memory-merged-design.md` §5.
- Format de dossier : `docs/focus/decision-dossier-format.md`.

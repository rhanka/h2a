# DECISION DOSSIER — Alignement de la mémoire h2a sur Open Knowledge Format (OKF)

> **Statut :** présentation (design-only). Ce dossier **présente** ; il ne demande aucune signature.
> Aucune décision M1–M7 / F1–F3 du substrat mémoire n'est rouverte.
> **Cible arbitrée par l'owner (via gr-conductor) :** Google **Open Knowledge Format (OKF) v0.2**.
> **Cadrage arbitré :** étude *export/interop* — « peut-on émettre/consommer les Episodes h2a comme
> concepts OKF » — **additif et réversible**.
>
> **Auteur :** ASTRA (agent d'analyse), exécuté en Claude Opus (équivalent astra).
> **Date :** 2026-09-15 · **decisionKind :** `orientation` · **h2a-focus.** · **Révision 2** (revues intégrées).
> **Double-instruction (revues indépendantes) :** DEUX jambes indépendantes = **leg Opus** (§9-R2,
> accord-sous-conditions) **+ leg Gemini 3.8 high** (§9-R3, *ISSUES FOUND* — 4 rectifications intégrées) ;
> la jambe Codex reste `source-gap` (crédits épuisés) mais est **remplacée** par Gemini → double-instruction
> **satisfaite par 2 jambes indépendantes**.
> **Recommandation (rév. 2) :** **Option E** (export injecté **attesté**), livrée **phasée**.
>
> Chaque affirmation porteuse est taguée `[FACT]` (vérifiable + source) ou `[JUDGMENT]` (lecture d'ASTRA).

---

## 1. Décision demandée

**h2a doit-il aligner sa représentation mémoire/connaissance sur OKF, et à quel degré ?**
Cinq options : **A** aligner pleinement (natif) · **B** export injecté **« nu »** (OKF conforme, sans
attestation) · **C** ne pas aligner · **D** hybride **vers le natif** (A différé derrière un gate) ·
**E** export injecté **attesté** (OKF conforme **+ sidecar d'attestation**).

**Note de taxonomie (rectif. §9-R3.1).** La « livraison **phasée** » (incrément lecture-seule sur les
artefacts déjà publiés d'abord) est une **cadence de déploiement** de B ou E, **pas** une option en soi :
l'ancienne formulation « B séquencée comme D » était du hand-waving. Le **seul vrai hybride** est **D** =
trajectoire *export (B/E) maintenant → natif (A) plus tard*. Un hybride **bidirectionnel** (import+export
synchronisés) est **explicitement exclu** (voir §2.4, §2.8).

**Périmètre exact.** Surface d'**interop en export** : sérialisation d'Episodes h2a en **bundle OKF**
(fichiers Markdown + frontmatter YAML `type` + cross-links). **Hors périmètre :** le substrat mémoire
(déjà décidé : graphify + SQLite canonique), le ranking (`M5=C`), la gouvernance d'admission (`M4`).
**L'ingestion (import) d'un bundle OKF externe est hors reco** et n'est pas seulement « exclue au niveau
de la reco » : elle exige une **barrière architecturale** (le bridge d'export n'a aucun chemin de code
d'import ; tout import serait un module séparé, owned, gated — §2.8, §5.5).

---

## 2. Contexte — faits, hypothèses, inconnues (séparés)

### 2.1 Le modèle OKF v0.2 (cible)

- `[FACT]` Un **bundle** OKF est un arbre de fichiers Markdown auto-contenu, distribuable en dépôt git,
  tarball ou zip. Source : `GoogleCloudPlatform/open-knowledge-format` `SPEC.md` (v0.2).
- `[FACT]` **Un seul champ de frontmatter est requis : `type`** (« the only always-required key ; a
  concept carrying just `type` is fully conformant »). Recommandés : `title`, `description`, `resource`
  (URI), `tags`. **Les producteurs peuvent ajouter des clés custom** ; les consommateurs **doivent
  préserver les clés inconnues** en round-trip mais **ne sont pas tenus de les vérifier**. Source : SPEC.md v0.2.
- `[FACT]` Les **cross-links** sont de simples liens Markdown (forme *bundle-relative* commençant par `/`,
  recommandée). **La nature du lien (parent/child, references, depends-on…) est portée par la prose
  environnante, PAS par le lien.** Source : SPEC.md v0.2.
- `[FACT]` `index.md` optionnel à tout niveau (progressive disclosure) ; `okf_version: "0.2"` dans
  l'`index.md` racine. Pas de taxonomie de `type` centrale : le producteur définit son vocabulaire.
- `[JUDGMENT]` OKF est un format de **livraison de contexte** à des agents. Il **n'a aucun modèle**
  d'intégrité (pas de hash-chain), de signature, d'edge typée, de bi-temporalité, ni d'expiry/redaction.
  Le fait qu'il **autorise des métadonnées étendues** est précisément ce qui rend l'**option E** possible.

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
- `[JUDGMENT]` **Mais la neutralité n'est pas qu'une affaire de packaging** (rectif. §9-R3.4) : si l'API de
  recall devait être **contorsionnée** pour servir OKF, la neutralité serait **brisée par proxy**. D'où le
  **contrat de sink** §2.7.

### 2.4 Hypothèses et inconnues

- `[ASSUMPTION]` La valeur d'OKF ici est l'interop de contexte lisible par des agents tiers, pas
  l'archivage d'intégrité (déjà couvert par le journal signé).
- `[UNKNOWN / source-gap]` **Aucun consommateur OKF réel** n'a été trouvé dans la flotte (h2a, graphify,
  sentropic). → Le bénéfice interop est **potentiel**, pas actif aujourd'hui. C'est le pivot de la reco.
- `[UNKNOWN / source-gap]` Nom exact du flag « options » du `track` **vendored** h2a (surface canonique
  sentropic `--options-json` vs surface h2a) → à confirmer par h-cond sur le binaire live (voir §Track).

### 2.5 Cartographie Episode h2a → concept OKF (le fond de l'étude)

| Élément h2a | Expression OKF v0.2 | Statut (B nu) | Statut (E attesté) |
|---|---|---|---|
| Episode (identité, subject) | 1 fichier concept `type: episode`, `title`, `resource` (URI) | couvert | couvert |
| Context / Decision / Evidence | sections du corps ou 3 concepts liés (`type: context/decision/evidence`) — se mappent sur l'enum **déjà neutre** `memory_kind` de graphify | couvert | couvert |
| `occurred_at` / `recorded_at` (bi-temporel) | clés custom frontmatter | couvert, non-standard | couvert |
| provenance citée | cross-links + `resource` ; clé custom `provenance` | partiel | couvert (dans l'attestation) |
| `trust`, `scope` | clés custom ; `scope` ↔ placement dans l'arbre | partiel | couvert (attesté) |
| `retention` / `purpose` (obligatoires si `subject=human:<ref>`) | clé custom **sans exécution** : OKF n'a ni expiry ni redaction ni révocation | **risque gouvernance MAJEUR** (§2.6) | **partiel** : nécessite en plus la politique de cycle de vie §2.6 |
| edges typées (causationId, decision→evidence, review-leg) | liens Markdown **non typés** | **perte** (dégradation sémantique) | **restauré** via une *carte d'edges typées* dans le sidecar |
| signatures / hash-chain / `contentHash` | **aucun équivalent OKF** | **non couvert** (intégrité jetée) | **restauré** : signatures détachées + preuves de hash merklisées dans le sidecar |

`[JUDGMENT]` **B « nu » jette l'intégrité fondatrice de h2a** (signatures, hash-chain, edges typées) et
produit un artefact trivialement éditable estampillé « mémoire h2a » — voir *trust-laundering* §2.8.
**E** restaure la vérifiabilité en aval **sans** quitter la conformité OKF (métadonnées étendues +
fichiers sidecar), à condition que le consommateur **honore** le sidecar (§2.8, §5.1).

### 2.6 Gouvernance : rétention, RÉVOCATION et cycle de vie (rectif. §9-R3.3 — MAJEUR)

- `[FACT]` Pour un Episode de `subject=human:<ref>`, h2a rend `purpose` **et** `retention` **obligatoires**.
  Source : memory-core study §1 (lignes ~180-181).
- `[FACT]` OKF n'a **aucun** mécanisme d'expiry, de redaction, de scope ni de **révocation**.
- `[JUDGMENT]` **Un gate de rétention *au moment de l'export* ne suffit pas.** Un Episode
  supprimé / tombstoné / rédigé **plus tard** (droit à l'effacement — RGPD art. 17 — ou révocation de
  consentement) **persiste dans le bundle OKF déjà exporté, sans synchronisation** → la garantie de
  gouvernance est **invalidée après coup**. C'est le trou de gouvernance central, distinct de la simple
  « perte de fidélité ».
- `[JUDGMENT]` **Politique de cycle de vie exigée** (condition dure de la reco, §5.5) :
  1. **TTL durs** portés par chaque bundle (et par le sidecar d'attestation) : un bundle expire.
  2. **Classes de sujets non-exportables** : certaines catégories (`subject=human:<ref>` sensibles) ne
     sont **jamais** exportées.
  3. **Liste de révocation / tombstone vérifiable** publiée avec le bundle (et signée dans l'attestation),
     que **tout consommateur conforme doit honorer** avant de traiter un concept.

### 2.7 Contrat de sink — neutralité à l'INTERFACE, pas juste au packaging (rectif. §9-R3.4)

- `[JUDGMENT]` L'interface d'export côté h2a est un **`EpisodeStreamSink` générique et domaine-agnostique** :
  un **flux brut d'Episodes immuables** (la forme knowledge neutre F1), **sans aucune** structure ni
  vocabulaire OKF.
- `[JUDGMENT]` **Interdiction explicite** : aucune forme, clé, ni formatage OKF dans `h2a` (core) ni dans
  `graphify-memory`. Toute la sémantique OKF (`type`, cross-links, sidecar) vit **uniquement** dans le
  **bridge OKF** (package owned à part) qui **consomme** `EpisodeStreamSink`. Ainsi, même si un consommateur
  OKF réclamait une forme particulière, l'API de recall/sink **ne se contorsionne pas** pour lui →
  neutralité préservée **à l'interface**, pas seulement dans le nom du package.

### 2.8 Risques transverses (mis en avant, pas enfouis — foreground §9-R3)

- `[JUDGMENT]` **Trust-laundering.** Un bundle Markdown est **trivialement éditable**. S'il est estampillé
  « from h2a Verified Memory » et que le consommateur **ignore** le sidecar d'attestation (OKF ne l'y
  **oblige pas**), le label **blanchit** de la confiance sur un artefact non vérifié. → E n'élimine le
  risque que si le consommateur **vérifie** l'attestation ; sinon le risque subsiste (argument fort pour C).
- `[JUDGMENT]` **Dégradation sémantique.** Les edges typées de h2a → liens Markdown non typés. E la
  compense par une carte d'edges dans le sidecar ; B ne la compense pas.
- `[JUDGMENT]` **Tentation de ré-import.** Exclure l'import « au niveau de la reco » **sans barrière
  architecturale** ne tient pas : sous pression, quelqu'un rebranchera le bundle en entrée. → Barrière dure
  §1 / §5.5 : le bridge d'export n'a **aucun** chemin d'import ; l'import = module séparé, owned, gated.

---

## 3. Enjeux (pourquoi niveau dossier)

- `[FACT]` **Cross-owner / cross-repo** : touche h2a (Episode/journal) **et** graphify (neutralité D1).
- `[JUDGMENT]` **Surface d'interop potentiellement publique** (format externe Google) : un mauvais
  placement ferait **fuiter le vocabulaire OKF dans les contrats neutres graphify** → violation D1
  (l'exact *STOP-trigger* signalé par l'owner) ; ou **jetterait l'intégrité** de h2a (B nu) ; ou
  **invaliderait une garantie de gouvernance** après export (§2.6).
- `[FACT]` L'owner a demandé une validation **au niveau des enjeux** → dossier complet, pas un menu.
- `[JUDGMENT]` Blast radius asymétrique : bien placé (bridge attesté + sink neutre) = additif/réversible ;
  mal placé = dette d'architecture + risque privacy durable.

---

## 4. Options (une ligne par option, rejetées incluses)

| id | Choix | Cas POUR le plus fort | Cas CONTRE le plus fort | Coût | Réversibilité | Neutralité graphify | Intégrité préservée | Ce qui la ferait gagner |
|---|---|---|---|---|---|---|---|---|
| **A** | **Aligner pleinement (natif)** — h2a/graphify émettent **et consomment** OKF nativement | Interop max ; format unique ; pas d'adapter séparé | Seule à **toucher la neutralité** (D1) ou extension non-standard ; **détruit** signatures/hash-chain/edges ; migration lourde | **Élevé** | **Faible** | **Touchée / à risque** | **Non** | Mandat « OKF = format mémoire canonique » **assumant** la perte d'intégrité |
| **B** | **Export injecté « nu »** — bridge côté h2a → bundle OKF **conforme**, depuis la sortie neutre du recall, **sans attestation** | Interop réelle sans toucher la neutralité ; additif ; le moins cher | **Jette l'intégrité fondatrice** (bundle non vérifiable) → **trust-laundering** ; dégradation sémantique | **Moyen-bas** | **Élevée** | **Préservée** | **Non** | N'avoir besoin que d'un affichage lisible, sans exigence de vérifiabilité |
| **C** | **Ne pas aligner** — garder Episode/journal ; aucune surface OKF | Coût nul ; zéro dette ; **aucune** perte d'intégrité ni risque privacy ; **OKF possiblement inutile** (humains → un générateur de rapport Markdown suffit ; machines → liens non-typés + zéro intégrité = OKF **inadapté** à une mémoire vérifiée) | Ferme l'interop OKF si un consommateur apparaît ; ignore une norme émergente | **Nul** | **N-A** | **Préservée** | **Oui (par abstention)** | Certitude qu'aucun consommateur OKF vérifiant n'existera |
| **D** | **Hybride vers le natif** — export (B/E) maintenant **puis gate** vers l'adoption native (A) plus tard (**pas** de sync bidirectionnel) | Garde l'optionalité vers A ; décision par étapes ; time-boxé | Deux passes de gouvernance ; l'étape 2 (natif) **rouvre** la neutralité et l'intégrité | **Bas** (ét.1) + différé | **Élevée** (ét.1) | Préservée ét.1 ; **à risque** si on va vers A | Ét.1 oui ; ét.2 non | Vouloir prouver la valeur **et** viser le natif ensuite |
| **E** ★ | **Export injecté ATTESTÉ** — OKF **conforme + sidecar d'attestation** (signatures détachées, preuves de hash merklisées, carte d'edges typées) ; livré **phasé** | Interop OKF **sans jeter l'intégrité** (vérifiable en aval) ; neutralité préservée ; additif/réversible ; **reste OKF-conforme** (métadonnées étendues autorisées) | Coût > B (attestation à produire/maintenir) ; vérifiabilité **seulement si** le consommateur honore le sidecar ; toujours conditionné à un consommateur réel | **Moyen** | **Élevée** | **Préservée** | **Oui (si honoré)** | Vouloir de l'interop OKF **en gardant** l'intégrité vérifiable et la neutralité |

`[JUDGMENT]` **Seules A (et l'étape 2 de D) touchent la neutralité graphify.** B, C, E la préservent —
via le **contrat de sink** §2.7 (neutralité à l'interface) et le bridge non ré-exporté par
`graphify-memory` (D1). C'est la réponse directe au *STOP-trigger* de l'owner :
**l'option recommandée (E) ne touche pas la neutralité.**

---

## 5. Recommandation + rationale

**Recommandation (rév. 2) : option E — export injecté ATTESTÉ — livrée PHASÉE** (incrément lecture-seule
sur les artefacts déjà publiés d'abord), **sous les conditions §5.5**.

`[JUDGMENT]` **Jugement décisif :** E est la seule option qui livre de l'interop OKF **tout en**
(1) préservant la neutralité graphify (STOP-trigger owner, garanti par le sink §2.7), **et**
(2) **préservant l'intégrité vérifiable** de h2a (le journal signé reste le canon ; l'attestation le rend
vérifiable *en aval*). **E domine B** : un export « nu » (B) **jette** l'intégrité fondatrice et ouvre le
*trust-laundering*, ce qui est inacceptable pour une mémoire qui se présente comme vérifiée. **A** est
écartée (seule à toucher la neutralité + détruit l'intégrité). **D** garde l'optionalité mais son étape 2
rouvre exactement les deux risques qu'E ferme. **C reste le finaliste** : si aucun consommateur OKF
n'honore l'attestation, E est de la dette spéculative et **C est le bon défaut**.

### 5.1 Cas le plus fort CONTRE ma recommandation (obligatoire, non vide)

`[JUDGMENT]` **C est un rival réel, pas un lot de consolation.** (a) **Aucun consommateur OKF n'existe**
(§2.4) ; construire un bridge attesté pour un format que personne ne lit est de la dette spéculative.
(b) L'attestation ne vaut que si le consommateur la **vérifie** — or OKF ne l'y oblige pas (§2.1) ; un
consommateur négligent transforme le label « h2a Verified Memory » en **trust-laundering** (§2.8), et E
n'a alors rien apporté de plus que B tout en coûtant plus cher. (c) Si le seul besoin réel est un rendu
**lisible par un humain**, un **générateur de rapport** Markdown le fait — sans graphe, sans intégrité à
faux-semblant, sans risque de révocation orpheline (§2.6). Bref : **OKF pourrait être inutile**, et alors
E est un détour coûteux.

### 5.2 Ce qui renverserait la reco

`[JUDGMENT]` (a) Preuve qu'aucun consommateur ne **vérifiera** l'attestation → bascule vers **C**.
(b) Mandat produit « OKF = format mémoire canonique » assumant la perte d'intégrité → **A**. (c) Un
consommateur exigeant une **synchronisation bidirectionnelle** → rouvre l'hybride bidirectionnel exclu et
force une **décision d'import séparée, gated** (jamais dans ce bridge). (d) Impossibilité de garantir la
politique de révocation §2.6 chez les consommateurs → **C** (le risque privacy l'emporte).

### 5.3 Pré-mortem (« six mois plus tard, ça a échoué parce que… »)

`[JUDGMENT]` **Scénario neutralité :** …le bridge a lentement absorbé de la logique h2a et un contributeur
l'a « rapproché » du moteur graphify pour « simplifier », faisant fuiter OKF dans les contrats neutres.
**Garde (corrigé) :** le bon contrôle n'est **pas** de scanner la neutralité du *bridge* (il **doit**
porter OKF par conception) mais (i) un **scan de non-import / non-ré-export sur la closure de publication
de `graphify-memory`** (D1 clauses 3-4) **et** (ii) le **contrat de sink `EpisodeStreamSink`** §2.7 qui
garde OKF hors de l'API de recall.
**Scénario gouvernance :** …un sujet humain a exercé son droit à l'effacement ; l'Episode a été tombstoné
côté h2a mais **dix bundles OKF exportés** le contenaient encore, sans TTL ni liste de révocation → fuite
privacy. **Garde :** politique de cycle de vie §2.6 (TTL durs + classes non-exportables + liste de
révocation vérifiable) **posée avant le premier export**.

### 5.4 Divulgation d'intérêt de l'agent (présentateur)

`[JUDGMENT]` **Le plus facile / rapide pour moi (ASTRA)** serait **C** (rien à concevoir) ou **B** (un
export « nu » vite écrit). Je recommande **E**, plus coûteux à concevoir et à décrire, parce que c'est
l'option qui sert l'intérêt de l'owner : **intégrité vérifiable** (ne blanchit pas la confiance),
**neutralité** (sink + closure), **gouvernance** (cycle de vie/révocation) et **réversibilité**. Là où mon
intérêt pourrait diverger : la tentation de présenter E comme « la » solution évidente — or **C reste un
choix légitime** tant qu'aucun consommateur vérifiant n'existe, et je le dis explicitement (§5.1).

### 5.5 Conditions de la reco (dures — sinon bascule vers C)

1. **Export-seule + barrière architecturale anti-réimport** (§2.8) : le bridge n'a aucun chemin d'import ;
   l'import OKF = module séparé, owned, gated — décision distincte.
2. **Attestation obligatoire (E, jamais B nu)** : signatures détachées d'Episode + preuves de hash
   merklisées + carte d'edges typées dans le sidecar.
3. **Politique de cycle de vie / révocation** (§2.6) : TTL durs sur bundles + classes de sujets
   non-exportables + liste de révocation-tombstone vérifiable honorée par les consommateurs.
4. **Contrat de sink neutre** (§2.7) : `EpisodeStreamSink` générique ; **OKF interdit** dans `h2a` et
   `graphify-memory` ; garde = scan de closure de publication de `graphify-memory`.
5. **Conditionné à un consommateur OKF réel qui VÉRIFIE l'attestation** (§2.4, §5.1) : sinon **rester en C**.

---

## 6. Réversibilité / coût

- `[JUDGMENT]` **E** : rollback = supprimer le bridge, le bundle et le sidecar ; **aucune donnée canonique
  touchée** (le journal signé reste la source). Coût = adapter de projection + mapping `type` + **générateur
  d'attestation** (signatures détachées, arbre de Merkle, carte d'edges) + politique de cycle de vie ≈
  **un à deux lots** (attestation = le sur-coût vs B). Sunk cost en abandon ≈ le bridge + l'attestation.
- `[JUDGMENT]` **B** : comme E moins l'attestation ≈ un lot ; mais laisse le trou d'intégrité/gouvernance.
- `[JUDGMENT]` **A** : migration du modèle + réécriture de contrats ; rollback **> un bloc**.
- `[JUDGMENT]` **D** : coût de l'étape 1 (= B/E) + une 2e passe de gouvernance différée.
- `[JUDGMENT]` **C** : coût et rollback nuls.

---

## 7. Attendus (critères de validation de l'owner)

| Critère | Source | Couvert par | Écart |
|---|---|---|---|
| Neutralité graphify préservée (STOP-trigger) — **à l'interface** | msg gr-conductor + §9-R3.4 | **E/B/C** (sink §2.7 + closure D1) | **A** et l'étape 2 de **D** = à risque |
| Additif et réversible | cadrage owner | **E/B/C/D-ét.1** | A non réversible |
| Cible = OKF v0.2 | arbitrage owner | §2.1 (SPEC.md v0.2) | aucun |
| ≥ 4 options + trade-offs mesurés | tâche | §4 (5 options : coût·neutralité·réversibilité·intégrité·bénéfice·risque) | aucun |
| Reco argumentée + ce que chaque option débloque | tâche | §5 + §8.1 | aucun |
| **Intégrité préservée / vérifiable en aval** | §9-R3.2 | **E** (attestation) ; A/B jettent l'intégrité | dépend du consommateur qui vérifie |
| **Politique révocation / TTL / cycle de vie** | §9-R3.3 | §2.6 + §5.5(3) | à implémenter avant 1er export |
| **Contrat de sink neutre (`EpisodeStreamSink`)** | §9-R3.4 | §2.7 + §5.5(4) | à câbler (interface + CI closure) |
| **Barrière architecturale anti-réimport** | §9-R3 foreground | §2.8 + §5.5(1) | à câbler (pas de chemin d'import) |
| Mitigation trust-laundering | §9-R3 foreground | §2.8 + §5.5(2) (attestation vérifiée) | résiduel si consommateur néglige le sidecar |
| Format dossier habituel (fond, revues, enjeux ouverts) | `docs/focus/decision-dossier-format.md` | §2/§4/§9/§10 | aucun |
| Revues réelles, ≥ 2 jambes indépendantes | même source + double-instruction | §9 (Opus + Gemini) | leg Codex `source-gap`, **remplacé** par Gemini |
| Enregistrement track prêt pour h-cond (single-writer) | tâche | §Track + fichiers payload | live-write réservé à h-cond |

---

## 8. Ce dont j'ai besoin de vous (plus petit choix valide)

**Approuver E (export injecté attesté, livré phasé, sous conditions §5.5)** — ou choisir **A / B / C / D**,
ou **différer**. Ce dossier **présente** ; il ne vous demande pas de signer. La signature reste un acte
séparé, à vos conditions.

### 8.1 Ce que chaque option débloque

- **A** → un format mémoire unique lisible par tout agent tiers (au prix de l'intégrité et de la neutralité).
- **B** → l'interop OKF sortante rapide, mais **sans** intégrité vérifiable (risque trust-laundering).
- **C** → rien de neuf côté OKF ; garde toute l'énergie sur le substrat déjà décidé ; **un générateur de
  rapport** couvre le besoin « lisible par un humain » si c'est le seul besoin réel.
- **D** → une preuve de valeur maintenant **plus** l'optionalité vers le natif (mais l'étape 2 rouvre les risques).
- **E** → l'interop OKF sortante **avec intégrité vérifiable en aval, neutralité et gouvernance** — sous conditions §5.5.

---

## 9. Revues (le fond de chaque reviewer, sans complaisance)

- **Reviewer 1 — ASTRA / Opus (auteur).** Self-audit gate `present-decision` passé : tags FACT/JUDGMENT ;
  symétrie de comptage des « POUR » ; cas CONTRE la reco non vide (§5.1) ; renversements (§5.2) ;
  pré-mortem (§5.3) ; divulgation d'intérêt (§5.4).
- **Reviewer 2 — passe Opus indépendante (sous-agent).** **Verdict : accord-sous-conditions.**
  - Tous les `[FACT]` vérifiés en source (journal `l.3-33` ; OKF v0.2 web ; F1 ; D1).
  - **STOP-trigger réellement évité**, placement D1-légal ; corroboration : `context/decision/evidence` se
    mappent sur l'enum neutre `memory_kind`. Garde de neutralité de §5.3 initialement mal spécifié (scanner
    le bridge ne prouve rien) → **corrigé** (§5.3, §5.5(4)). Import OKF sorti du scope → **corrigé** (§1).
  - **Symétrie de comptage OK** ; §5.1 est un vrai steelman.
  - **Risque le plus sous-pondéré : rétention/sujet-humain** → intégré (§2.6).
- **Reviewer 3 — passe Gemini 3.8 high (jambe indépendante, remplace la jambe Codex à sec).**
  **Verdict : ISSUES FOUND — 4 rectifications, toutes intégrées ; elles renforcent le dossier.**
  1. **Taxonomie** : « B séquencée comme D » = hand-waving → renommé **B/E phasé** (cadence) vs **D** vrai
     hybride vers le natif ; hybride bidirectionnel exclu (§1, §2.4).
  2. **Option manquante E — OKF attesté (sidecar)** : ajoutée (§1, §4, §2.5) ; **défense de C renforcée**
     (générateur de rapport pour l'humain ; OKF inadapté à une mémoire vérifiée) (§4-C, §5.1).
  3. **Trou révocation / TTL** (gouvernance MAJEURE) : un gate d'export ne suffit pas ; RGPD art. 17 /
     révocation de consentement → **politique de cycle de vie** (TTL durs, classes non-exportables, liste
     de révocation vérifiable) (§2.6, §5.5(3)).
  4. **Contrat de sink** (neutralité à l'**interface**) : **`EpisodeStreamSink`** générique ; OKF interdit
     dans h2a/`graphify-memory` (§2.7, §5.5(4)).
  - **Foreground intégrés :** *trust-laundering* (§2.8, §5.1), *dégradation sémantique* (§2.5, §2.8),
    *tentation de ré-import* → **barrière architecturale** (§2.8, §5.5(1)).
- **Jambe Codex — `source-gap`** (crédits épuisés), **remplacée par Gemini 3.8 high**. La double-instruction
  est donc **satisfaite par deux jambes indépendantes** (Opus + Gemini), la jambe Codex restant à combler
  si l'owner l'exige.

---

## 10. Ce que la validation ne livre PAS

- `[FACT]` Elle **n'implémente pas** le port d'export, l'attestation, le sink, ni la politique de révocation
  (lots séparés).
- `[FACT]` Elle **ne fournit aucun consommateur OKF** (aucun n'existe dans la flotte à ce jour) — et ne
  garantit pas qu'un consommateur **vérifiera** l'attestation.
- `[FACT]` Elle **ne migre pas** le substrat mémoire et **ne rouvre pas** `M5=C` ni `F1`.
- `[FACT]` Elle **n'autorise aucun import** OKF (barrière architecturale §2.8).
- `[JUDGMENT]` Le bundle OKF reste une **projection sortante** : le **journal signé reste la source
  d'autorité**. L'attestation rend la projection *vérifiable*, elle ne la rend pas *canonique*.

---

### Provenance des sources

- OKF v0.2 : `github.com/GoogleCloudPlatform/open-knowledge-format` `SPEC.md` (récupéré 2026-09-15).
- Episode/F1, rétention/`purpose` obligatoires : `docs/specs/2026-08-15-SPEC_STUDY_memory-core-graphify-max.md` §1.
- Journal : `packages/h2a/src/journal.ts`.
- Neutralité D1 : `graphify` `spec/SPEC_EVOL_AGENT_MEMORY_SUBSTRATE.md` D1.
- Modèle mémoire fusionné : `docs/specs/2026-07-25-h2a-agent-memory-merged-design.md` §5.
- Format de dossier : `docs/focus/decision-dossier-format.md`.
- Revues : R2 passe Opus indépendante ; R3 passe Gemini 3.8 high (jambe indépendante).

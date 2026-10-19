# Édition des dossiers Focus et retour par paragraphe — analyse indépendante

18 octobre 2026. Analyse uniquement : aucun code modifié, aucun commit, aucun Python, aucun test exécuté. Aucun résultat de l’autre analyse parallèle n’a été consulté. Les textes normatifs proposés ci-dessous sont en anglais ; ils ne constituent pas une décision déjà ratifiée.

**Recommandation : reprendre maintenant la boucle `focus build → édition Tiptap dans le dossier → retour structuré → agent producteur`. Porter le contrat dans `@sentropic/focus`, dépôt h2a ; le rendu relève déjà du design system et je recommande d’y extraire le composant d’édition réutilisable ; h2a porte le premier hôte portable et le retour aux agents.** Sentropic fournit un précédent Tiptap concret et sera un consommateur, mais son ancien package Focus n’est plus le centre de cette fonctionnalité. Track journalise les amendements effectivement instruits ; il ne remplace ni le diff éditorial ni le contrôle de concurrence.

L’incrément utile doit livrer l’aller-retour, pas seulement un champ éditable. Il peut fonctionner hors ligne sans attendre un serveur de documents, un CRDT, le futur composant MCP Apps ou les livraisons de moteurs de diagrammes. Une application concurrente à une source partagée constitue un lot distinct, avec un vrai contrôle OCC et une reprise après échec.

## Périmètre et sources

La demande actuelle est connue par le relais « influence », sans citation owner primaire jointe. Je traite comme directions transmises : Tiptap, édition dans le document rendu, retour avant/après par paragraphe, extension immédiate de `focus build`, réactivité, atomicité, fonctionnement hors ligne et langue de l’utilisateur. Je n’en déduis aucune autorisation de ratifier une décision, d’écrire automatiquement dans Track ou de redéfinir une frontière de dépôt déjà décidée.

Les checkouts racines ne correspondent pas tous à leur `origin/main`. Les sources h2a ont donc été lues avec `git show origin/main:<path>`, et non assimilées au contenu ancien et modifié du checkout racine. Même précaution pour le DS et les vérifications Sentropic déterminantes. Les références sont les références locales consultées, sans prétendre qu’un fetch a été effectué.

| Référence | État consulté | Ce qu’elle établit |
| --- | --- | --- |
| H | h2a `origin/main`, `7ebbcf266e1988c18624d0158936949a214f9fd8` | Base principale de l’analyse. |
| P377 | [PR #377](https://github.com/rhanka/h2a/pull/377), ouverte et draft ; worktree `tmp/worktrees/diagcode`, HEAD `757d97c627bc11ba997fc729d759d25fefe0c96a` | Extension evidence v2 et publication atomique de l’HTML ; pas de livraison de l’édition Tiptap. |
| S | Sentropic `origin/main`, `9ed96eb83cd77da710f1adeb83a19e425d6c4910` | Le code Tiptap concerné est identique à celui du checkout consulté. L’ancien `SPEC_VOL_FOCUS` porte désormais un bandeau de supersession absent de ce checkout. |
| DS | design system `origin/main`, `25c0f3d33c258fc2b906a4b85219ffce5f67eccc` | Décisions récentes sur le schéma et le renderer ; absence d’un composant Tiptap livré dans les packages examinés. |
| I | `/home/antoinefa/src/influence/dossier/influnified-audit.dossier.json`, copie locale lue | Cas concret de contenu, d’ancres distinctes et d’affordance `amend` désactivée. |

Sources primaires principales, à ces révisions :

- **E1 — propriété et histoire** : [S, `spec/SPEC_VOL_FOCUS.md`](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/spec/SPEC_VOL_FOCUS.md), bandeau puis §§3–4b. Le bandeau dit explicitement : « CLI = h2a; focus = h2a ». Le corps est historique, notamment pour les promesses `FocusLiveSession` et `baseHash → re-read → reconcile`.
- **E2 — frontière actuelle DS/h2a** : [DS, `spec/SPEC_EVOL_DS_JSON_RENDER_STANDARD.md`](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/spec/SPEC_EVOL_DS_JSON_RENDER_STANDARD.md), §1.1 décision 4, §§1.1b–c, 6.5 et 11.2 : h2a définit le schéma, le DS rend une version épinglée ; paramètres d’hôte et defaults de rendu séparés du contenu.
- **E3 — modèle réel** : [H, `packages/focus/src/model.ts`](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/model.ts), notamment `FocusNodeBase`, `ProseNode`, `Affordance`, `AmendmentStep`, `DecisionDossierDocument` ; [schéma v1](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/schemas/decision-dossier-document.v1.schema.json) et `src/validation/index.ts`.
- **E4 — projection/rendu** : H, `packages/focus/src/render/{html,md,terminal,hooks,presentation}.ts`. `presentation.ts` réordonne les options autour de leurs questions et peut préfixer la recommandation avec le label recommandé.
- **E5 — hôte portable** : H, `packages/h2a/src/focus-build.ts`, `packages/h2a/focus-kit/src/{App.svelte,main.js}`, `scripts/build-focus-dossier.mjs`, `docs/focus/portable-dossiers.md`.
- **E6 — précédent Tiptap** : S, `ui/src/lib/components/{EditableInput,TipTap}.svelte`, `ui/src/lib/extensions/tailwind-classes.ts`, `ui/package.json` ; `spec/COLLAB.md:346` impose notamment le verrouillage des éditeurs pour un viewer.
- **E7 — limites de l’existant DS** : DS, `docs/chat-ui-roadmap.md`, notamment la décision de garder le rich editor app-local ; `packages/components-svelte/src/lib/ChatComposer.svelte` est un composer avec textarea, pas un éditeur Tiptap. Les recherches dans les sources des packages n’ont trouvé aucun wrapper Tiptap réutilisable. `packages/codemirror` traite un autre éditeur.
- **E8 — Track écrit et enregistre** : H, `packages/track/src/model/spec-amend.ts`, `src/ingest/{contract,focus-l4}.ts`, `src/track.ts:596`, `src/cli/index.ts:763`, `src/m5-canevas.test.ts`.
- **E9 — Track relit une trace** : H, `packages/track/src/read/contract.ts:329` et `:857`, `src/mcp/server.ts`, `packages/focus/src/track/index.ts`.
- **E10 — deck interactif distinct** : H, `packages/focus-interactive/src/{contract,feedback,sync}.ts` : décisions en attente, intentions accept/reject/comment/answer, port de synchronisation ; aucun contrat de paragraphes.
- **E11 — retour agent déjà utilisé** : H, `apps/focus/src/lib/dossier-answers.js`, `src/routes/dossier/agent-memory/+page.svelte`, `src/routes/api/dossiers/agent-memory/include/+server.ts`, `src/lib/server/{h2a-bus.ts,h2a-target.js}`. Export JSON, notes, brouillon/commité et dépôt dans une inbox existent pour ce scénario spécifique.
- **E12 — travail ouvert** : P377, `packages/focus/src/model.ts`, `packages/h2a/focus-kit/src/App.svelte`, `packages/h2a/src/focus-build.ts`, `renderer-manifest.json`, `docs/focus/diagram-renderer-contract.md`. Le manifeste annonce les capacités evidence, pas l’édition.
- **E13 — paramètres et packaging** : H, `packages/focus/{package.json,src/registry/definitions.ts,registry/entries.v1.json,skills/focus/SKILL.md}`. Package déclaré public, schéma/validation exportés ; paramètres de registre encore limités à `mode: snapshot`, `locale: en|fr`.
- **E14 — port de documents** : S, `packages/chat-core/src/ports.ts:70` : `LiveDocumentStore` reste une interface `_kind`, pas une implémentation read/watch/submit/reconcile utilisable.

## A. Qui porte quoi

| Objet | Propriétaire constaté / recommandé | Responsabilité concrète |
| --- | --- | --- |
| `DecisionDossierDocument`, identités, validation, schémas, contrat de retour et réconciliation pure | **Focus, dépôt h2a** | Contrat indépendant de Svelte, Tiptap, du transport et du stockage. Le diff par paragraphe est un contrat Focus, pas une convention privée de l’app. E1–E3. |
| Rendu visuel durable des dossiers | **Design system** | Décision owner déjà inscrite : consommer le schéma Focus épinglé et imposer les defaults du renderer. Le package d’éléments/renderer visé par cette spec n’est pas présent dans l’arbre DS consulté. E2. |
| Mécanique et présentation réutilisables de l’éditeur Tiptap | **DS recommandé, à partir du précédent Sentropic** | Wrapper UI, édition/lecture, sélection, clavier/IME, accessibilité, thèmes, traductions fournies par l’hôte ; aucune API métier, règle Track ou décision implicite. Cette attribution précise du nouvel éditeur est une proposition, pas une décision owner retrouvée. E6–E7. |
| Premier hôte autonome | **h2a, `focus build` / focus-kit** | Assembler un HTML complet hors ligne, embarquer le contenu et la projection d’édition, conserver les brouillons, exporter le retour, présenter honnêtement son état. Le kit existe déjà ; il ne définit pas un autre modèle de dossier. E5. |
| Hôte connecté, canaux, autorité, persistance partagée | **Chaque hôte** : Focus Web dans h2a ; Sentropic pour son intégration | Read/watch/submit, identité de l’utilisateur, capacités actuelles, OCC sous verrou/CAS, reprise, accusés de réception. `focus serve` existe ; cela ne signifie pas que `FocusLiveSession` documenté est livré. E1, E5, E11, E14. |
| Livraison vers le producteur | **h2a pour le bus et la résolution ; agent producteur pour la consommation** | Corrélation au dossier et à sa révision, destinataire d’origine ou successeur désigné, réception idempotente, application aux sources et restitution des conflits. Un fichier copié hors ligne reste exploitable sans session live. E11. |
| Amendements persistés, provenance, journal et lectures de trace | **Track, également dans h2a** | `item.spec-amend → spec.amended`, auth par contexte, append-only, déduplication et projections ; pas d’éditeur, de serveur de documents ou de moteur de patch. E8–E9. |
| Adoption dans l’app | **Sentropic** | Donner à l’éditeur une langue, des permissions et un stockage d’hôte ; préserver les comportements existants. Ne pas recréer `packages/focus` supprimé. E1, E6, E14. |

**Attribution opérationnelle proposée** : un pilote Focus/h2a pour l’aller-retour complet, un responsable DS pour le composant visuel, un responsable intégration Sentropic pour l’adoption dans l’app. Les noms de personnes/sessions effectivement mandatées ne sont pas établis par les sources consultées.

`focus-interactive` ne doit pas recevoir par défaut toute cette fonctionnalité sous prétexte de son nom. Son contrat actuel organise un deck de décisions et des intentions de réponse. Il pourra adapter le contrat Focus d’édition lorsqu’un consommateur en aura besoin ; y créer une deuxième définition du diff fragmenterait le protocole. E10.

## B. Existant, écart et articulation avec amend/OCC

### Trois surfaces à distinguer

| Surface actuelle | Disponible | Écart pour la demande |
| --- | --- | --- |
| `@sentropic/focus` : `renderHtml`, MD, terminal | Modèle typé, validation, rendu déterministe, hooks Markdown/sanitisation, trace lisible, affordances désactivées. | Pas d’éditeur, de manifest de paragraphes, de retour ou de réconciliation OCC. Le HTML n’émet pas systématiquement les `id`/`targetRef` des nœuds/options. |
| `h2a focus build` | Fichier Svelte autonome, DS, diagramme interactif, source embarquée, ouverture `file://` sans réseau, sélection locale en mémoire. | La prose est affichée comme texte sûr dans un `<p>`, pas comme Markdown riche éditable. Aucun Tiptap, export générique de réponses ou retour d’édition. `id={section.id}` existe, pas une identité de paragraphe. |
| `h2a focus serve` / `apps/focus` | App SvelteKit empaquetée ; scénario agent-memory avec notes, JSON, brouillons et inbox h2a. | Ce scénario a son propre modèle et des endpoints spécialisés. Ce n’est ni un éditeur générique de `DecisionDossierDocument`, ni le HTML portable, ni une implémentation du `FocusLiveSession` prévu par la spec historique. |

Le premier renderer rend une **chaîne HTML** ; le deuxième fabrique un **programme HTML autonome**. Le HTML statique n’empêche pas une édition locale embarquée, mais il ne peut pas modifier son JSON d’origine sur disque ou synchroniser une source partagée sans mécanisme d’hôte. L’exécution hors ligne d’un JavaScript intégré est compatible avec la demande.

Le CLI de lecture `track focus` reste lui aussi read-only et ses tests actuels couvrent terminal/MD/HTML (`packages/track/src/cli/focus.test.ts`). Le `--format json` demandé par la spec DS n’est pas à traiter comme une sortie déjà livrée. Cela ne bloque pas le premier incrément fondé sur un dossier JSON fourni à `focus build`. L’écriture `track item spec-amend`, avec hashes/patch et token, existe déjà : il faut l’adapter correctement, pas recréer cette commande.

Le cœur Focus doit garder le rendu snapshot. Ajouter une surface éditable ne signifie pas charger Tiptap dans MD/terminal, ni importer Svelte dans le modèle. Le même contrat de retour peut être consulté et consommé depuis ces surfaces.

Un ancien fichier produit par `renderHtml` ne devient pas éditable par ajout de `contenteditable` : il faut disposer de son document source et de la projection d’édition, puis le présenter dans l’hôte qualifié. `focus build` est la voie initiale recommandée pour cette nouvelle présentation, pas un parseur de vieux HTML. Le rendu de lecture et le rendu d’édition doivent conserver le même contenu sémantique, sans récupérer la source à partir des décorations visibles.

### Ce que l’on peut réellement reprendre de Tiptap

`EditableInput.svelte` utilise `TipTap.svelte` pour son mode Markdown ; `TipTap.svelte` construit un `Editor`, configure StarterKit et `tiptap-markdown`, émet du Markdown sur `onUpdate`, gère l’état disabled et tente de préserver la sélection lors d’une mise à jour externe. C’est un précédent exploitable, pas seulement une mention dans une spec. Sur S/main, les dépendances Tiptap sont en `^3.31.3` ; ne pas reprendre les numéros plus anciens du `package.json` du checkout racine.

Le wrapper actuel dépend toutefois d’extensions Tailwind et d’utilitaires `$lib`. `EditableInput` ajoute `apiPut`, autosave et store d’app. L’importer dans le HTML portable ferait entrer des hypothèses de Sentropic là où il n’y a ni API ni aliases SvelteKit. Il faut extraire la partie UI et la configuration utile, conserver les adaptateurs d’app et tester la compatibilité réelle du couple Tiptap/Markdown choisi.

StarterKit tel qu’il est configuré ne fournit pas à lui seul le traitement des tableaux Markdown du dossier Influnified. Un round-trip global Markdown → Tiptap → Markdown peut également normaliser les marqueurs, les espaces et les sauts de ligne. Charger puis quitter l’éditeur ne doit donc pas réécrire le document entier ni produire de faux amendements.

### Identités et texte source

Un nœud `prose` contient aujourd’hui un seul `markdown: string`, qui peut comprendre plusieurs paragraphes, titres, listes et tableaux. `node.id + targetRef` identifie un bloc métier ; cela ne fournit pas l’identité de chacun de ses paragraphes. E3.

De plus, l’ordre et certains textes visibles sont dérivés : `preparePresentation` rapproche questions et options, et peut ajouter le label de l’option à `recommendedAnswer`. **L’éditeur doit charger le champ source, pas reparcourir le DOM présenté.** Le préfixe ajouté par le renderer ne doit jamais apparaître dans `before` comme si l’agent l’avait écrit. Un index `sections[3]` pris dans le DOM n’est pas un chemin de patch fiable. E4.

### Amend : trois notions différentes

- `OutcomeModality` comprend `amendment`. C’est le type d’un résultat de Focus, pas une implémentation d’édition ni une permission d’écriture.
- `interactions[].name` est une chaîne ; le cas I annonce `amend`, désactivé. Le modèle snapshot impose littéralement `enabled: false`. Basculer arbitrairement ce champ à `true` casserait le contrat courant.
- Le binding Track existant s’appelle `amendSpec` et cible `item.spec-amend`. Un hôte doit résoudre l’action/capacité et la cible réelles ; ni le mot `amend` ni une `targetRef` de section ne fournissent un `itemId` Track. E3, E8.

Pour le premier incrément, conserver le snapshot et ajouter une **capacité d’édition locale explicite dans l’enveloppe d’hôte**, hors du schéma v1 du dossier. Le retour est un amendement proposé au texte. Une modification de recommandation ne vaut pas sélection d’option, ratification, signature ou modification des justificatifs de compréhension. Ces actes gardent leurs commandes et leur autorité propres.

Le kit actuel place les options dans des `<button>` de carte entière. Monter un éditeur interactif à l’intérieur de ces boutons serait une mauvaise structure de contrôles. Prévoir un mode d’amendement au niveau du dossier et une structure accessible qui distingue la saisie de texte du geste de sélection, tout en respectant les defaults DS : carte sélectionnable en lecture, pas de prolifération d’actions/annotations par option. Ce point appartient au composant/renderer, pas à une indication de layout écrite par l’agent dans le dossier.

### OCC : ce qui manque réellement

`doc.hash` est décrit comme base OCC, mais son implémentation n’est pas un digest calculé du document éditable. Dans le binding `/track`, il prend le premier `comprehensionEvidence.dossierHash`, sinon `count:<n>` ; le curseur correspond à une lecture du journal. Le cas I utilise `draft-2026-10-18`. **Comparer seulement deux chaînes `baseHash` ne prouve donc pas que le paragraphe est inchangé.** E3, E9.

Conserver la valeur de source `hash` sans changer son sens. Ajouter un digest de snapshot éditable, explicitement défini, ainsi que des préconditions par paragraphe. Le digest porte sur le document d’entrée canonique avant expansion des diagrammes et avant `preparePresentation`, pas sur l’HTML généré. La canonicalisation JSON peut être spécifiée avec RFC 8785 et SHA-256 ; les chaînes ne sont ni traduites ni normalisées avec `trim()`.

Le digest d’enveloppe rendu ajouté par P377 est utile pour identifier l’artefact construit ; il ne remplace pas ce digest de source : le builder peut déjà avoir développé `ecosystem:*`, ajouté une scène et remplacé un fallback. Un digest de changeset n’est pas non plus un `resultHash` de la spec amont.

Deux modes partagent le même réconciliateur pur :

1. **Hors ligne** : l’utilisateur édite une copie locale issue d’une base immuable et exporte un retour. Le producteur relit la source actuelle à l’import. L’HTML ne prétend pas connaître une modification effectuée ailleurs.
2. **Connecté** : l’hôte relit la source et vérifie les préconditions sous une même exclusion/CAS que l’application. Une simple comparaison suivie d’une écriture libre laisserait une course. La publication d’un changeset est tout ou rien ; le rendu n’oscille pas entre paragraphes de versions différentes.

Une divergence ailleurs dans le dossier peut être réconciliée si les paragraphes ciblés et leur topologie sont encore inchangés. Une divergence sur le même paragraphe, une cible manquante ou un mapping ambigu produit un conflit avant toute application du groupe. Conserver base / version actuelle / proposition, sans choisir silencieusement un gagnant. Le retour original demeure intact ; un résultat réconcilié référence sa nouvelle base.

Une transaction Tiptap garantit une transformation locale de l’éditeur ; elle ne fournit pas une transaction entre fichier source et journal Track. De même, le renommage atomique de l’HTML dans P377 protège la publication du fichier, pas les futures éditions. Pour une intégration connectée, l’hôte doit prévoir une reprise journalisée/outbox : une écriture source réussie suivie d’un échec Track ne doit pas être annoncée « enregistrée dans Track ».

## C. Contrat de retour proposé

### Choix de structure

**Ajouter un contrat versionné `FocusReturn` avec `editReturn`, accompagné d’une projection d’édition versionnée.** Les noms ci-dessous sont proposés ; ils n’existent pas encore dans l’API. Les réponses, notes et corrections d’une même remise utilisent un seul objet sérialisé. Presse-papier, téléchargement et bus agent ne construisent pas trois variantes.

Pour démarrer sans détourner P377, la projection et le retour sont des sidecars/enveloppes Focus, pas des champs ajoutés subrepticement au schéma fermé `DecisionDossierDocument` v1 ou v2. Si l’on décide ensuite d’intégrer les paragraphes directement au document canonique, il faudra une évolution de schéma explicite et une migration. La v2 actuellement proposée par P377 est celle des preuves, pas un numéro disponible pour baptiser l’édition.

La projection associe une identité de paragraphe à un champ source typé. Elle est embarquée dans l’HTML et conservée lors du rebuild et de l’application des retours. Une copie exportable permet de la transporter entre machines ; son stockage navigateur n’est jamais sa seule copie durable.

Les identités initiales peuvent être amorcées de façon déterministe sur une même base, puis sont conservées comme identités de filiation. Leur position d’amorçage n’est pas leur identité permanente. Après insertion ou réécriture, le producteur reprend le manifest précédent et ses opérations ; reconstruire les IDs depuis le texte, les numéros ou les labels n’offre aucune stabilité générale.

**Limite explicite** : si l’agent régénère librement le dossier et jette les IDs/le manifest, aucun algorithme ne peut garantir l’identité d’une collection de paragraphes identiques. Le système doit signaler la perte du mapping ; il ne doit pas annoncer une continuité reconstituée par rapprochement approximatif.

### Proposed specification text — English

> **Scope.** Focus SHALL define a framework-neutral edit-return contract for `DecisionDossierDocument`. The contract SHALL be usable by a standalone offline HTML host, a connected host and the producing agent. Tiptap JSON, DOM paths and ProseMirror positions SHALL remain implementation details.
>
> **Source fidelity.** Editing SHALL operate on source fields, before presentation-only transformations. Opening, focusing, rendering, changing the interface language or leaving an unchanged editor SHALL produce no textual change. Unchanged source content SHALL be preserved verbatim. Unsupported source structures SHALL remain intact and visibly non-editable until their round-trip is supported.
>
> **Identity.** Each editable paragraph SHALL have a persistent opaque `paragraphId`, scoped by the dossier identity and carried by the editable projection. Every change SHALL also identify the source `nodeId`, its `targetRef`, and the typed `field`. The resolver SHALL verify that these identifiers identify the same source location. Display order, translated labels, content hashes and character offsets SHALL NOT serve as paragraph identities.
>
> **Projection lifecycle.** The host SHALL embed the projection and its version in the portable artifact. A rebuild or agent revision SHALL retain surviving paragraph identities and carry the updated projection forward. New paragraphs SHALL receive new identities; deleted identities SHALL NOT be reassigned. A missing or ambiguous mapping SHALL produce an explicit mapping conflict.
>
> **Fields.** A projection SHALL enumerate the editable source fields and their content formats. Plain text fields SHALL remain plain text. Markdown fields SHALL use a declared, round-trip-tested Markdown profile. Presentation labels, source hashes, signed evidence, historical trace entries and application state SHALL NOT become editable merely because they are visible.
>
> **Paragraph changes.** Each change SHALL carry exact `before` and `after` content in its declared format. `null` SHALL mean an absent paragraph; an empty string SHALL remain distinct from absence. Replacement, insertion and deletion SHALL be explicit. Position changes SHALL carry stable neighbouring identities, never a renderer index alone.
>
> **Structural editing.** A split SHALL preserve the original identity on the leading paragraph and allocate new identities for the following paragraphs. A merge SHALL preserve the leading identity and delete the consumed identities. All constituent changes SHALL belong to one atomic changeset. Moving a paragraph SHALL either be represented explicitly or be unavailable in the initial editor.
>
> **Concurrency.** The return SHALL retain the original opaque source `hash` and `cursor`, plus a separately defined digest of the authoring snapshot and a digest of its editable projection. Applying a changeset SHALL re-read the authoritative source, resolve identities and compare all affected `before` values and structural preconditions. No change in the atomic group SHALL apply if one member conflicts.
>
> **Reconciliation.** A pure reconciler MAY prepare a rebased candidate when unrelated content has changed. The candidate SHALL identify its actual application base and retain the original return. Conflicting current content, missing targets and ambiguous identity mappings SHALL be reported without overwriting either version.
>
> **Return envelope.** Answers, notes and `editReturn` SHALL be serialized from one immutable return value. JSON SHALL be the reference data representation. YAML, when offered, SHALL decode to the same typed value, including multiline text, trailing newlines, empty values and Unicode. Content SHALL NOT be trimmed, translated, truncated or replaced by a prose summary during export or delivery.
>
> **Idempotency.** A frozen return SHALL have a stable `returnId` and canonical content digest. Copying, downloading, sending and retrying that return SHALL preserve them. Reusing an ID with different content SHALL fail. Changing the frozen content SHALL create a new return identity.
>
> **Offline behaviour.** Reading, editing, undoing and exporting SHALL require no network access. All editor assets required by the selected profile SHALL be embedded. A failed clipboard operation SHALL leave a complete downloadable return available. Local persistence SHALL be best-effort and source-version-bound; a stale draft SHALL never silently replace another source revision.
>
> **Delivery and authority.** The return SHALL identify its dossier and production correlation. Transport adapters SHALL resolve the intended producer or an explicitly designated successor. Delivery, processing, application and Track recording SHALL be distinguishable states. A returned edit SHALL NOT itself select an option, ratify an outcome, attest comprehension or confer authenticated Track authority.
>
> **Track integration.** A qualified host MAY translate an instructed specification amendment to the existing `item.spec-amend` WorkEvent with valid source-domain `baseHash`, `patch` and `resultHash`. Track SHALL remain record-only. Editorial paragraph changes SHALL remain available as a structured return artifact; an amendment summary SHALL NOT substitute for that artifact.
>
> **Language.** Interface labels, accessibility names and status messages SHALL use the user locale supplied by the host. Source content SHALL retain its own language. Contract keys and identities SHALL be language-independent. Changing locale SHALL NOT change paragraph identities or create edits. The portable host SHALL embed the required translations and SHALL not fetch them at runtime.

### Forme minimale des données — proposed field definitions in English

| Location | Required data and meaning |
| --- | --- |
| Return header | Proposed discriminator `kind: focus.return`, `schemaVersion: 1`, `returnId`, canonical return digest, capture metadata. The digest excludes its own field. |
| `scope` | Source project/workspace correlation when known. A path guessed from `provenance.source` is not a project identity. Unresolved scope permits export, not automatic application. |
| `source` | Dossier `ref`, opaque source `hash`, `cursor`, authoring `snapshotDigest`, projection identity/version/digest. Digests have explicit algorithm and canonicalization domains. |
| `production` | Original production/request correlation and producer reference when supplied by the host. Offline export does not require a currently live agent. |
| `answers` / notes | Typed targets, selected option identities where relevant, and complete user text. Existing answer contracts require a versioned adapter rather than silent shape changes. |
| `editReturn` | `changeSetId`, ordered paragraph changes, and a digest of the changeset. No browser-computed specification `resultHash` is implied. |
| Each change | `changeId`, `operation` (`replace`, `insert`, `delete`, or supported `move`), `nodeId`, `targetRef`, `field`, `paragraphId`, block kind, `contentFormat` (`text/plain` or the declared Markdown profile), exact `before`, exact `after`, and structural anchors where applicable. |
| Structural anchors | Neighbour paragraph identities before and after the operation, with explicit start/end sentinels. A split/merge shares the same atomic group. |
| Processing receipt | Original return ID/digest, status, actual base/result digests when applied, affected change IDs, conflicts or refusal reasons, and resulting artifact/Track event references when available. |

Les champs optionnels et leur sémantique d’absence doivent être arrêtés dans le schéma. La date de capture peut être produite par l’hôte ; elle n’a pas à être générée par le cœur pur. Les primitives et enums du protocole restent en anglais ; les valeurs `before`/`after` restent dans la langue réelle du document.

Proposed operation constraints: `replace` requires two present values; `insert` requires `before: null` and a present `after`; `delete` requires a present `before` and `after: null`. A move preserves content and changes structural anchors. Split and merge are grouped paragraph changes, not undocumented string rewrites. Invalid combinations fail validation.

Exemple d’ancrage du cas I : dossier `decision:influnified-audit-reponse-gael`, nœud **`s-reco`**, cible **`section:recommandation`**, champ **`markdown`**, paragraphe **ID opaque persistant**. Ces deux identifiants de nœud ne sont pas interchangeables par convention. La suppression du premier paragraphe ne doit pas détourner une correction du second vers un nouvel index 1.

### Définition pratique de « paragraphe »

Il faut une segmentation sémantique déclarée, pas `split('\n\n')` ni `querySelectorAll('p')` : les listes imbriquées, cellules de tableaux, titres et blocs de code invalident ces approches.

Le premier profil doit au moins couvrir les paragraphes de prose et les paragraphes de listes présents dans `s-reco`, ainsi que les champs textuels explicitement autorisés des questions/options. Un titre est un bloc typé ; une cellule de tableau requiert une identité de table/cellule en plus de son éventuel paragraphe. Un bloc de code ou diagramme est un bloc opaque tant qu’un éditeur adapté n’est pas branché. La source Markdown d’un diagramme ne doit pas être « corrigée » par un éditeur de prose.

Pour ce premier profil, l’éditeur conserve les blocs non pris en charge et n’autorise pas une transformation qui les détruirait. Cette tranche doit être nommée précisément : elle ne justifie pas de déclarer livrée l’édition complète des tableaux et diagrammes. Les tableaux du cas I sont un cas RED nécessaire avant toute revendication de round-trip global.

Le manifest porte les mappings/spans de la révision source, avec leurs unités déclarées, mais ces offsets ne sont jamais l’identité pérenne. Les attributs Tiptap transportent les IDs à travers les transactions. Le protocole n’expose pas les offsets UTF-16 de ProseMirror comme positions stables entre langues, navigateurs ou versions.

### Consommation par l’agent producteur

Le producteur reçoit un objet de données complet, accompagné éventuellement d’une représentation lisible du diff. Le skill Focus doit décrire cette consommation ; son état actuel ne décrit que des snapshots sans écritures. E13.

Séquence recommandée :

1. Valider version, identités, digest et corrélation ; identifier la source réelle avec le contexte de production. Le champ libre `provenance.source` n’est pas une instruction d’ouverture de fichier.
2. Retrouver le snapshot/manifest de départ, relire la source courante et contrôler le registre des retours déjà traités. Un même ID avec un autre contenu est refusé.
3. Résoudre tous les paragraphes et préparer le résultat du groupe. Les corrections utilisateur sont préservées exactement ; une adaptation supplémentaire de l’agent est une nouvelle modification attribuée à l’agent.
4. Publier la nouvelle source et le manifest cohérent selon le mécanisme d’hôte. Rebuilder la présentation ; conserver les sources/citations hors du périmètre modifié.
5. En cas de véritable amendement de spec instruit et autorisé, construire le patch correspondant à cette source, puis le WorkEvent Track existant. Une correction rédactionnelle du dossier n’est pas automatiquement une modification de la spec du produit.
6. Émettre un reçu : appliqué, en conflit, non pris en charge, déjà traité, etc. Indiquer les changements exacts et les références de résultat. « Déposé dans une inbox » n’équivaut pas à « appliqué ».

Le routage existant de `apps/focus` recherche une session du projet, avec préférence pour l’émetteur et choix possible du destinataire. Il ne constitue pas à lui seul une preuve qu’un dossier arbitraire retourne à **son** producteur. Celui-ci peut être un agent Influence, sans item Track, ou ne plus être live. Conserver la corrélation stable et proposer une remise au successeur désigné ; ne pas envoyer automatiquement au premier agent disponible. Aucun envoi à un agent n’a été effectué pour cette analyse.

### Relation précise à Track

Le contrat existant attend `itemId`, `baseHash`, `patch` RFC-6902 et `resultHash`, avec `decisionId?`, `liveDocRef?`, `proposalRef?`, `summary?`. Le contexte d’ingestion porte auteur, workspace et provenance ; ce ne sont pas des déclarations que le navigateur rendrait authentiques. `amendSpec` vérifie notamment que l’item existe, puis enregistre le patch sans l’appliquer. Le `clientToken` fournit l’idempotence d’ingestion ; le producteur doit aussi contrôler l’égalité du contenu de ses retours. E8.

Le diff par paragraphe et ce patch ont des fonctions différentes. Le premier expose l’intention éditoriale et l’avant/après précis à l’agent. Le second décrit l’application à une source réellement résolue. Par exemple, plusieurs corrections de paragraphes peuvent reconstruire un champ Markdown puis produire un unique `replace` de ce champ, précédé des préconditions vérifiées par l’hôte. Les indices JSON Pointer sont calculés sur la base courante résolue, jamais repris du DOM. Pour une spec amont distincte, les hashes sont ceux de cette spec ; ils ne sont pas ceux de l’HTML ou du retour Focus.

**Deux limites de trace doivent être intégrées au plan :**

- `TrackReader.amendmentTrace` renvoie auteur/provenance/origine, résumé et `patchRef`, dont la valeur est `resultHash`. Il ne renvoie pas le patch ni un avant/après par paragraphe. Le mapping Focus réduit encore cela à `{at, author, summary}`. Lire `track_amendment_trace` ne reconstruit donc pas le retour d’édition. Le retour complet doit rester un artefact accessible au producteur et au reçu.
- La lecture filtre `event.aggregateId === aggregateId`. Un `spec.amended` sur l’item **I**, avec `decisionId: D` dans son payload, n’apparaît pas pour autant dans `amendmentTrace(D)`. Or `/focus/track` lit aujourd’hui la trace du `decisionId`. Pour montrer les amendements de l’item depuis le dossier, lire explicitement les traces liées, ou ajouter ultérieurement une projection de liaison dédiée. Ne pas fusionner naïvement leurs numéros `seq` comme s’ils fournissaient un ordre global.

Le premier aller-retour n’exige **aucun nouvel event kind Track**. Garder le retour et le reçu dans les artefacts de l’hôte ; une vue rendue de ce retour peut être attachée comme véritable `rendered-view` avec le mécanisme existant. Ne pas déguiser un JSON de feedback en vue rendue uniquement pour contourner le type d’artefact. Si la traçabilité machine exige un lien direct `editReturnRef` sur `spec.amended`, il s’agit d’un ajout de payload/projection versionné à co-concevoir, pas d’un champ aujourd’hui disponible. `assertSpecAmend` normalise une liste connue de champs.

Enfin, une acceptation d’une proposition IA conserve sa filiation `proposalRef` et la provenance originale. Le retour humain ne doit pas être attribué à l’IA qui le transporte ; inversement, une adaptation écrite par l’agent ne doit pas être présentée comme une correction littérale de l’utilisateur.

## D. Lots par dépôt, fichiers exacts et preuves RED attendues

Ce sont des propositions d’emplacements, pas des fichiers déjà créés. **[N]** signifie nouveau fichier proposé. Les noms F1–F4 ci-dessous sont propres à cette analyse : ils ne renumérotent pas les lots H1/H2/H3 de P377.

### F1 — h2a / `packages/focus` : contrat, mapping, diff et réconciliation pure

**Commence maintenant.** Aucun moteur de diagrammes, hôte live ou package UI n’est requis pour écrire les contrats et les tests.

Fichiers :

- [N] `packages/focus/src/edit/{contract,projection,diff,reconcile}.ts` et `src/edit/index.ts`.
- [N] `packages/focus/schemas/focus-return.v1.schema.json` et `editable-projection.v1.schema.json`.
- [N] `packages/focus/tests/{edit-contract,edit-projection,edit-reconcile}.spec.ts` et fixtures de texte dans `packages/focus/tests/fixtures/`.
- Existant : `packages/focus/package.json` pour les sous-chemins dédiés ; `src/render/html.ts` pour porter les ancres de nœud/field ; `tests/render.spec.ts`, `tests/schema.spec.ts`, `tests/packaging.spec.ts`, `src/render/presentation.ts` comme contrat de transformation à respecter.

**RED demandé avant réalisation** : une correction au second paragraphe de `s-reco` est attribuée à ce paragraphe après insertion en tête ; deux paragraphes identiques restent distincts ; un rendu réordonné conserve la cible source ; le préfixe de recommandation ajouté par `preparePresentation` ne fuit pas dans le diff ; `before` discordant ou `targetRef` d’un autre nœud refuse le groupe entier ; split/merge préserve la filiation ; modification tierce d’un paragraphe distinct se réconcilie sans perte ; conflit sur un membre ne modifie aucun autre membre ; retour identique rejoué une fois, ID réutilisé avec autre contenu refusé.

**Acceptation observable** : validation et diff indépendants de Svelte/DOM/Track/Tiptap ; source non modifiée par une lecture ; fixtures UTF-8, CRLF, lignes vides finales, paragraphes identiques et IDs spéciaux. Parité du JSON Schema et du validateur. Le v1 du dossier continue de refuser `enabled:true` et les champs inconnus ; ses bytes/URN ne sont pas retouchés pour faire entrer le sidecar.

### U1 — design system : éditeur Tiptap réutilisable et frontière avec le renderer Focus

**Commence en parallèle de F1.** Ce lot court ne dépend pas de la publication des moteurs de diagrammes ni de l’ensemble du package d’éléments.

Emplacements proposés :

- [N] `packages/components-svelte/src/lib/RichTextEditor.svelte`.
- [N] `packages/components-svelte/src/lib/rich-text/{profile,paragraph-identity}.ts`.
- [N] `packages/components-svelte/src/RichTextEditor.test.ts`.
- Existant : `packages/components-svelte/package.json`, lockfile racine ; `spec/SPEC_EVOL_DS_JSON_RENDER_STANDARD.md` pour inscrire le contrat Focus d’édition consommé. Publier un sous-chemin explicite pour éviter de charger Tiptap par un import ordinaire de Button/Card.

Sources à reprendre/neutraliser : S, `ui/src/lib/components/TipTap.svelte`, ses extensions et ses usages ; ne pas déplacer l’autosave HTTP de `EditableInput` dans le DS.

**RED** : ouvrir/quitter une prose sans changement ne produit aucun amendement ; conservation des IDs après Enter/Backspace/undo/redo/collage ; édition avec accents, emoji et composition IME ; mise à jour externe pendant la frappe sans perte du caret ou de la correction locale ; désactivation immédiate sans autosave ; parent gérant la sélection d’option non déclenché lorsqu’on édite son texte ; tableaux/non-supportés préservés ; `</script>` et liens/HTML collés restent inertes selon le profil déclaré.

**Acceptation** : composant sans `$lib`, API Sentropic ou type Track ; labels/états fournis via i18n ; contrat de changements adapté par Focus, sans publier les positions ProseMirror comme protocole. Une seule implémentation destinée aux deux consommateurs réels, h2a et Sentropic. L’intégration au futur renderer DS reprend cette surface ; elle n’introduit pas une deuxième définition du retour.

### F2 — h2a / focus-kit : premier aller-retour portable complet

**Préparation immédiate, intégration après F1 et U1.** C’est le livrable ASAP principal. Il étend le `focus build` existant.

Fichiers :

- Existant : `packages/h2a/src/focus-build.ts`, `packages/h2a/focus-kit/src/{App.svelte,main.js,style.css}`, `packages/h2a/focus-kit/package.json` et son lockfile, `scripts/build-focus-dossier.mjs`.
- [N] `packages/h2a/focus-kit/src/{EditableText.svelte,EditReturn.svelte,edit-state.js}` : adaptateurs minces du contrat/composant, sans second algorithme de diff.
- [N] `packages/h2a/focus-kit/test/edit-browser.test.mjs` ; existants `packages/h2a/test/focus-build.test.js`, `focus-kit/test/browser.test.mjs` et, une fois P377 intégrée, ses tests evidence.
- Livraison générée à régénérer par les scripts : `renderer.html`, `renderer-manifest.json`, `validator.mjs` si affecté, copies de schémas concernées, copies vendored Focus via `scripts/vendor-focus.mjs`.

**RED** : ouvrir le tarball installé avec réseau désactivé et éditer un vrai paragraphe en place ; avant/après exact exporté puis réimporté par le validateur F1 ; annuler une édition retire son diff ; deux paragraphes modifiés sortent dans un seul retour ; refus du presse-papier laisse un téléchargement complet ; un reload/recovery n’applique pas un brouillon d’une autre base ; sous 320/390 px, clavier/touch accessibles ; passage langue/thème, lecture d’une preuve et retour préservent caret, brouillon et caméra ; aucun réseau ; une frappe dans le texte ne sélectionne pas l’option englobante.

**Réactivité/atomicité** : monter l’éditeur à la demande dans la région concernée ; garder les composants/questions/diagrammes par identité ; ne pas reparser le corpus evidence, reconstruire tout le dossier ou rehasher 30 Mo à chaque frappe. Mesurer frappe → affichage, activation d’édition et export sur corpus représentatif, avec profil matériel publié. Fixer ensuite les seuils d’acceptation à partir de ces mesures ; la taille du bundle n’est pas le substitut de ces preuves. Un export fige une version cohérente de réponses + texte + manifest, même si une frappe survient pendant son assemblage.

**Frontière de livraison** : paragraphes de prose/listes et champs textuels du profil, export récupérable complet ; les autres blocs conservés et déclarés non éditables. Ne déclarer « tout le document éditable » qu’après les preuves correspondantes, dont tableaux/diagrammes.

### F3 — h2a / producteur et retour : rendre la correction effectivement consommable

Peut démarrer avec les fixtures F1 ; se termine avec F2. L’export est le chemin hors ligne. La remise live utilise un adaptateur séparé.

Fichiers :

- Existant : `packages/focus/skills/focus/SKILL.md`, `packages/focus/src/registry/definitions.ts`, `registry/entries.v1.json`, `tests/registry.spec.ts` : consommation, capacités et version de paramètres explicites. L’entrée snapshot historique ne gagne pas une permission d’écriture par modification de prose.
- [N] `packages/h2a/src/focus-return.ts`, `packages/h2a/test/focus-return.test.js` : lecture/validation et rapport de traitement du retour, sur contrat F1.
- Pour l’hôte Web : [N] `apps/focus/src/lib/server/focus-return.ts` et `apps/focus/src/routes/api/dossiers/[ref]/feedback/+server.ts` ; consommer les helpers existants `h2a-bus.ts` / `h2a-target.js`. Garder les routes agent-memory historiques tant qu’un adaptateur compatible n’est pas prouvé.
- [N] `packages/h2a/test/focus-return-routing.test.js` pour l’adaptateur de remise et ses reçus, selon le harness de tests du serveur existant.

**RED** : JSON copié, fichier téléchargé et body livré portent les mêmes réponses/notes/diffs ; des notes multilignes avec espaces finaux et valeurs `null`/vides ne changent pas ; présence d’un autre agent du même dépôt ne redirige pas le retour du producteur ; aucune session live permet tout de même l’import ; ambiguïté/succession fournit un état explicite ; échec/retry ne double pas l’application ; « inbox déposée » ne devient pas « source appliquée ».

Le code agent-memory est un précédent à capitaliser, pas un sérialiseur universel prêt à réutiliser : il utilise `trim()` et `NOTE_MAX = 8000`, et ses types et routes connaissent `agent-memory`. Ne pas compresser un diff volumineux dans une note ; si un transport impose une limite, transmettre un artefact complet adressé par digest et un mécanisme réel de récupération.

### F4 — h2a / Focus live + Track : application concurrente et trace

Après F1 ; ne bloque pas la capture/export hors ligne. Ce lot est nécessaire avant de revendiquer une session connectée qui applique directement aux sources partagées.

Fichiers :

- [N] `packages/focus/src/track/edit.ts`, `packages/focus/tests/track-edit.spec.ts` : résolution des cibles réelles et préparation du WorkEvent, sans modifier le comportement du binding de lecture existant.
- [N] `apps/focus/src/lib/server/focus-edit-session.ts` et `packages/h2a/test/focus-edit-session.test.js` : lecture, exclusion/CAS, reprise et reçu. Le stockage effectif est un choix d’hôte, pas une implémentation cachée dans le cœur.
- Tests existants à conserver : `packages/track/src/{m5-canevas.test.ts,ingest/focus-l4.test.ts}`. Réutiliser `src/ingest/focus-l4.ts`, `src/model/spec-amend.ts` et `src/read/contract.ts` sans nouveau kind d’événement.
- **Seulement si un lien de retour ou une lecture liée sont retenus** : `packages/track/src/model/spec-amend.ts`, `src/ingest/{contract,contract.test}.ts`, `src/read/{contract,contract.test,index}.ts`, `src/mcp/server.ts` et tests associés ; ajout/version de contrat explicitement documentés.

**RED** : deux writers sur la même base ne s’écrasent pas ; modification d’une autre partie réconciliable ; même paragraphe conflictuel bloque tout le groupe ; mauvais workspace, item absent et canal non authentifié refusent ; crash entre publication source et append Track récupérable, sans doublon ; `baseHash/resultHash` concernent la vraie source ; un événement de l’item I n’est pas présenté comme déjà visible dans `amendmentTrace(D)` ; origine humaine/IA et filiation restent exactes.

L’application du document et l’append Track ne sont pas une transaction partagée existante. Le reçu distingue application et journalisation tant que la reprise ne les a pas réunies. Une éventuelle projection liée doit conserver l’identité des agrégats et un ordre explicite.

### S1 — Sentropic : adoption du composant, puis du dossier

L’extraction U1 peut être vérifiée sur l’app immédiatement ; l’intégration générique du dossier vient après F1/U1. Pas de recréation d’un package Focus local supprimé.

Fichiers : `ui/src/lib/components/{TipTap,EditableInput}.svelte`, `ui/package.json`, lockfile racine ; [N] `ui/tests/components/TipTap.test.ts` et `EditableInput.test.ts` ; mise à jour ciblée de `spec/COLLAB.md` si le comportement évolue. Si nécessaire, conserver une façade `TipTap.svelte` pour ses usages actuels et y déléguer au composant publié.

**RED** : viewer ne peut taper ni déclencher une sauvegarde ; debounce/save-in-flight de `EditableInput` ne perd pas la dernière valeur ; reset de composer et édition `forceList` gardent leurs comportements ; source externe reçue pendant une frappe ne fait pas disparaître un texte ; labels/erreurs suivent la langue de l’utilisateur. Tests uniquement dans les environnements isolés prévus par les targets `make`, jamais `ENV=dev`.

Le port `_kind: LiveDocumentStore` n’est pas une dépendance bloquante de ce lot UI. Un futur lot de stockage partagé sera qualifié séparément lorsque son contrat et son implémentation seront réels.

### I1 — Influence / agent producteur : recette sur le cas réel

Consommateur et preuve de bout en bout, pas propriétaire d’une nouvelle variante du format Focus.

Source exacte à conserver : `dossier/influnified-audit.dossier.json`. Ajouter une copie de recette et le manifest/retour exporté dans le répertoire de fixtures choisi par ce dépôt ; leurs noms ne sont pas imposés à son arborescence sans avoir lu ses conventions. Pour les tests portables h2a, utiliser [N] `packages/focus/tests/fixtures/influnified-edit-source.json` et `influnified-edit-return.json`, contenant seulement la tranche de contenu nécessaire et une provenance de fixture explicite.

**RED** : corriger le paragraphe ciblé par `s-reco` / `section:recommandation`, transmettre le retour et retrouver exactement la correction dans la source révisée ; un second import ne l’applique pas deux fois ; notes, réponse `q-prix`, tableaux, diagramme et provenance hors périmètre restent inchangés ; l’agent rapporte un conflit si le paragraphe a changé entre-temps.

**Réserve factuelle sur la référence** : le JSON local n’a pas `readability`, plusieurs questions n’ont ni contexte ni temps ni `recommendedOptionId`, les options n’ont pas les conséquences/liens attendus ; son Mermaid n’utilise pas le petit profil accepté par `focus build`. D’après les gates lus, il ne constitue pas une fixture de présentation/build verte sur H/main. Aucun rendu n’a été relancé. Il faut qualifier une copie avec des métadonnées authentiques ou tester d’abord son mapping comme donnée d’édition ; ne jamais inventer une citation owner pour franchir le gate. Cela n’empêche pas F1 de démarrer.

### Langue : exigence transversale dès F1/F2/U1

Le kit a du français en dur dans `App.svelte`, `scripts/build-focus-dossier.mjs` émet `<html lang="fr">`, les renderers purs mêlent anglais et français, et le registre Focus ferme encore les locales à `en|fr`. Ajouter seulement un bouton traduit ne satisfait pas la direction owner.

Fichiers impliqués : `packages/focus/src/render/{hooks,html,md,terminal}.ts` pour les labels injectés ; `src/registry/definitions.ts`, `registry/entries.v1.json`, `tests/registry.spec.ts` si l’on élargit le profil de paramètres ; [N] `packages/h2a/focus-kit/src/i18n.js`, avec catalogue embarqué ; builder et script de génération pour la langue du document HTML.

**RED transversal** : même source et même manifest affichés en deux langues, puis dans une troisième locale hors de l’enum historique, sans changement d’IDs/diff ; messages et noms accessibles localisés ; texte source conservé ; aucun fetch de traduction. Un élargissement du profil de registre est versionné ; l’ancien profil n’accepte pas silencieusement des valeurs différentes. La disponibilité d’un catalogue hors ligne pour la locale demandée est vérifiée à la construction, pas remplacée silencieusement par du français en dur.

### Ordre de lancement proposé

1. **Maintenant** : F1, U1 et préparation des fixtures/du consommateur F3. Contrat et choix de profil passent une revue croisée Focus/DS, sans attendre les moteurs de diagrammes.
2. **Premier incrément livré** : F2 + F3, puis recette I1. Critère : une édition en place sort de l’HTML hors ligne, reste exacte, revient au producteur et donne un résultat traçable. L’export est disponible même sans agent live.
3. **Ensuite** : F4 pour l’application connectée aux sources partagées ; S1 pour l’adoption d’app peut avancer sur le composant indépendamment. Étendre tableaux/diagrammes sur des profils testés, sans les annoncer par anticipation.

U1 représente une vraie dépendance du composant partagé. Si sa livraison ne peut pas suivre l’urgence, le point à trancher est le portage temporaire d’un mince adaptateur Tiptap dans `focus-kit`, avec même contrat, mêmes tests et destination d’extraction explicite. Ce n’est ni une raison pour attendre tout le programme DS, ni une autorisation implicite de maintenir deux éditeurs concurrents. L’analyse recommande d’abord ce petit lot DS commun aux deux consommateurs.

### Articulation avec P377

Ne pas transformer la PR evidence en livraison générale d’un éditeur. Elle modifie précisément `model.ts`, validation, `App.svelte`, builder, manifest et ressources générées : surfaces qui seront aussi touchées ici. Préparer des branches étroites depuis la base choisie, puis rebaser/coordonner ces surfaces ; ne pas inventer une troisième variante du kit ou réutiliser son numéro v2 pour l’édition.

La PR apporte notamment source/citations/annexes embarquées, manifeste de build et publication atomique de l’HTML. Son contrat DS distingue H1 livré des H2/H3 bloqués par des artefacts DS publiés. Le Tiptap de prose n’a pas de dépendance fonctionnelle à ces moteurs ; il doit préserver les preuves et l’état du canvas existants. Les résultats de tests et performances de la description de PR sont ceux rapportés par l’auteur ; ils n’ont pas été reproduits dans cette analyse.

Les vérifications de livraison devront reprendre le chemin existant schéma/registry/vendor/renderer/fingerprint, puis les tests ciblés du tarball et du navigateur hors ligne. Aucun test RED listé ci-dessus n’est présenté comme déjà exécuté.

## E. Questions ouvertes à l’owner, sur les principes

Les décisions déjà relayées — Tiptap, retour par paragraphe, hors ligne, atomicité/réactivité, extension de `focus build` et langue utilisateur — ne sont pas reposées. Les questions suivantes peuvent être présentées ensemble, avec leur contexte ; elles ne bloquent pas l’étude et les tests F1.

### 1. Quelle autorité doit porter une correction faite directement dans le dossier ?

**Contexte.** La même interface peut servir à reformuler le dossier, corriger une réponse ou demander une modification de la spec amont. Aujourd’hui, édition, sélection d’option et amendement Track sont des actes différents ; le HTML autonome n’a pas de canal d’ingestion authentifié.

**Question ouverte.** Dans votre manière de travailler, à quel moment une correction du texte doit-elle devenir une instruction au producteur, puis un amendement enregistré, et quels actes souhaitez-vous toujours distinguer explicitement ?

**Recommandation.** La frappe prépare un brouillon ; la remise fige une instruction de correction attribuée à l’utilisateur ; le producteur applique dans son périmètre autorisé et rend un reçu. Une modification de spec partagée passe par l’hôte qualifié et Track. Garder sélection, ratification et signature comme actes nommés séparément, sans ajouter une confirmation à chaque correction déjà autorisée. La conséquence est une UI qui expose ses états sans faire croire qu’une copie locale a déjà modifié le produit.

### 2. Quelle étendue d’édition doit être garantie au premier incrément utilisable ?

**Contexte.** Le cas réel combine texte narratif, recommandations, questions, réponses, options, listes, tableaux, diagramme, historique et provenance. Le modèle ne définit pas encore tous ces éléments comme paragraphes éditables. Changer une recommandation sur une carte cliquable pose aussi un conflit de gestes avec sa sélection.

**Question ouverte.** Quelles corrections concrètes doivent pouvoir être faites sans quitter le dossier pour que vous considériez ce premier incrément réellement utilisable, et quelles informations doivent garder une fonction de preuve plutôt que devenir du texte réécrivable ?

**Recommandation.** Commencer par les paragraphes de prose/listes et les champs narratifs des questions/options ; conserver les autres blocs et rendre leur périmètre explicite. Étendre les cellules de tableaux et le diagramme avec leurs profils propres. Préserver l’historique et les attestations comme faits d’origine ; une demande de correction de ces faits reçoit une trace, pas une réécriture muette. Le périmètre exact de la première recette peut ainsi être arrêté sans promettre une édition universelle.

### 3. Quelle continuité de brouillon attendez-vous entre fermeture, machines et nouvelles révisions ?

**Contexte.** Le kit perd actuellement les sélections à la fermeture ; le scénario agent-memory distingue brouillon navigateur et réponses commitées. Le stockage `file://`/navigateur n’offre pas une garantie universelle de durabilité ni de transport entre machines. Conserver les paragraphes entre rebuilds exige aussi de transporter leur manifest.

**Question ouverte.** Comment souhaitez-vous reprendre et partager un dossier en cours de correction, et quelle continuité doit être garantie lorsque le producteur vous renvoie une nouvelle révision ?

**Recommandation.** Donner dès le départ un retour complet téléchargeable/réimportable, incluant la filiation des paragraphes ; récupération navigateur en complément, liée à la base. Une nouvelle révision réconcilie explicitement les corrections encore applicables et montre les conflits. La synchronisation multi-machine automatique viendra avec un hôte durable si elle devient nécessaire ; elle ne doit pas être simulée par du localStorage.

### 4. Quelle continuité de responsabilité quand le producteur n’est plus disponible ?

**Contexte.** Le bus peut déposer dans une inbox ; plusieurs agents peuvent travailler sur le même dépôt et une session peut s’arrêter. Ni la présence live ni le nom du projet ne garantissent l’identité du producteur du dossier. Le format doit aussi rester utile par copie de JSON/YAML.

**Question ouverte.** À qui doit revenir la responsabilité de reprendre les corrections quand le producteur initial est absent ou remplacé, et quelle preuve de prise en charge vous suffit pour considérer que le retour est entré dans la boucle de travail ?

**Recommandation.** Corréler au producteur et à la demande d’origine ; garder un successeur explicite et permettre la remise manuelle du fichier. Afficher distinctement exporté, remis, traité et appliqué, avec les paragraphes concernés et la nouvelle révision. Ne pas choisir un agent simplement parce qu’il est le premier live sur le dépôt.

### Incertitudes restantes, à résoudre par les responsables techniques

- Le relais du 18/10 n’inclut pas la citation owner exacte. Les critères proposés ne doivent pas être enregistrés comme décisions owner littérales.
- Le responsable actuellement mandaté du renderer Focus DS et sa date de livraison ne sont pas établis. La propriété du schéma est déjà décidée ; inutile de la remettre en débat avec l’owner.
- Le profil Markdown précis, les extensions nécessaires et la fidélité du couple Tiptap/Markdown retenu doivent être qualifiés, notamment pour les tableaux. Aucun round-trip n’a été mesuré ici.
- Les garanties natives du presse-papier, de récupération et de téléchargement doivent être vérifiées sur les navigateurs/supports visés, y compris en `file://`. Un témoin Chromium ne prouvera pas à lui seul toutes les plateformes.
- Le stockage et le mécanisme CAS d’un futur hôte connecté ne sont pas fournis par le port `LiveDocumentStore` actuel. Leur choix ne doit pas ralentir la capture hors ligne.
- L’artefact/manifeste d’édition à conserver par le producteur, sa convention de nommage dans Influence et son association à la révision source restent à intégrer au workflow de ce consommateur.
- Le lien machine entre retour et `spec.amended`, ainsi que l’affichage d’une trace d’item depuis une décision, nécessitent un choix explicite de contrat si cette vue unifiée devient un critère de livraison. Ils ne sont pas déjà couverts par `track_amendment_trace`.
- Le dossier I nécessite une qualification de recette sur les gates actuels ; sa source originale est restée intacte. Le présent rapport ne statue pas sur le fond commercial du dossier.

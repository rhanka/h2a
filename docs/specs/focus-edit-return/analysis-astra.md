**Analyse indépendante — édition Focus et retour par paragraphe — 18 octobre 2026**

**Recommandation : h2a/Focus porte le contrat d’édition, ses identités et sa réconciliation ; le design system porte le composant Tiptap réutilisable ; le kit `focus build` livre le premier hôte hors connexion ; l’agent producteur reçoit le même retour structuré que celui exporté par le navigateur.** L’application sentropic apporte une implémentation Tiptap à capitaliser et demeure un consommateur. Track conserve la trace des amendements effectivement enregistrés. La livraison portable peut commencer sans attendre un moteur de collaboration en direct ni les travaux de diagrammes bloqués de la PR #377.

Il manque davantage qu’un bouton « éditer » : l’identité persistante des paragraphes, leur correspondance avec le texte source, un export sans perte et un consommateur capable de refuser un écrasement concurrent. Ces éléments doivent avancer avec l’interface.

**Périmètre et qualité de preuve.** Analyse seule : aucun code, commit, test, build, installation, envoi inter-agent ou événement Track. Seul ce fichier est écrit. Les tests RED ci-dessous sont des tests à écrire, pas des échecs observés. Aucune analyse parallèle n’a été consultée. Les références `origin/main` locales ont été lues sans fetch ni changement de checkout ; la PR #377 a aussi été consultée en lecture seule sur GitHub.

| Référence examinée | État retenu |
| --- | --- |
| h2a `origin/main` | `7ebbcf266e1988c18624d0158936949a214f9fd8`, 18/10 |
| PR [#377](https://github.com/rhanka/h2a/pull/377), worktree `tmp/worktrees/diagcode` | Ouverte ; head `757d97c627bc11ba997fc729d759d25fefe0c96a`. Son descriptif la dit draft. Apports distingués de main ; chiffres de qualification rapportés par la PR, non reproduits ici. |
| sentropic `origin/main` | `9ed96eb83cd77da710f1adeb83a19e425d6c4910`, 18/10 |
| design system `origin/main` | `25c0f3d33c258fc2b906a4b85219ffce5f67eccc`, 18/10 |
| Checkouts locaux sentropic / design system | Heads respectifs `97fe9f53…` et `22421ed8…`, plus anciens. Ils ne doivent pas décider de l’ownership actuel. |
| Cas métier | `/home/antoinefa/src/influence/dossier/influnified-audit.dossier.json` et son HTML voisin, lus sans modification. |

Le brief présente la demande comme une reformulation d’« influence ». Pendant la lecture, deux fichiers identiques étaient disponibles dans le répertoire de sortie, `OWNER-QUOTE.json` et `owner-request.json`. Leur champ `ownerRequest` fournit ce texte, reproduit sans correction :

> c'est pas du tout un decision dossier... avec le module focus.. par contre je veux reprendre asap la feature d'édition - tu pourrais reprendre tip-tap et il faut prévoir un retour ver l'IA (prévoir dans le yaml/json de retour un retour d'édition en diff par paragraphe). demande cette conception a qui de droit (je ne sais plus entre h2a/focus, design-system ...)

C’est une citation fournie par cet artefact, sans transcript original indépendant vérifié. Elle suffit pour cadrer l’analyse ; elle ne tranche pas les détails proposés ci-dessous. Les décisions associées sur le hors connexion, l’atomicité, la réactivité et la langue viennent du brief.

**A. Qui porte quoi, d’après les dépôts**

Le transfert de Focus vers h2a est explicite. Dans **sentropic main**, `spec/SPEC_VOL_FOCUS.md:3` porte l’avertissement du 25/09 : « `packages/cli`, `packages/build-cli` and `packages/focus` were removed from sentropic […] CLI = h2a; focus = h2a ». `packages/focus` n’existe plus dans cet arbre. La copie encore présente dans le checkout sentropic explique une partie de la confusion : elle contient notamment un `FocusLiveSession` orienté signature propriétaire, absent de main, et non un éditeur de dossier prêt à brancher.

| Responsabilité | Propriétaire constaté / recommandé | Preuve et limite |
| --- | --- | --- |
| `DecisionDossierDocument`, `id`, `targetRef`, rendus MD/HTML/terminal, validation, lisibilité | **Focus, dans h2a** | `packages/focus/src/model.ts`, `render/*`, `validation/*`, schéma v1. Le package pointe désormais vers le dépôt h2a. |
| Contrat neutre du retour d’édition, identité des paragraphes, diff, réconciliation pure | **Focus dans h2a**, extension proposée | Cohérent avec le modèle et le contrat d’interaction de SPEC_VOL_FOCUS. Rien de cela n’est actuellement livré pour les paragraphes. Ne pas en faire un contrat privé de composant Svelte. |
| Deck, navigation, intents d’acceptation/réponse | **`packages/focus-interactive` dans h2a** | Cœur TypeScript sans framework ; `FeedbackKind = accept/reject/comment/answer`. Aucun amendement de texte ni OCC. Son README laisse encore le re-hébergement/publication à une décision ultérieure : ne pas déplacer ce package pour cette feature. |
| Éditeur Tiptap générique, accessibilité, thèmes, clavier, composition IME, états contrôlés | **Design system**, ownership cible proposé | Il fournit déjà les composants Svelte consommés par le kit. Aucun composant Tiptap/éditeur riche équivalent trouvé dans ses packages sur main ; `packages/codemirror` fournit un thème CodeMirror, pas cet éditeur. C’est un lot réel à livrer, pas une dépendance disponible. |
| Capital Tiptap existant | **Application sentropic** | `ui/src/lib/components/TipTap.svelte` et `EditableInput.svelte`, avec extensions Markdown et listes. Réutiliser le moteur et les comportements utiles ; garder l’API métier, les verrous et l’autosave dans l’application. |
| Hôte portable, bundle autonome, état local, export/import du retour | **h2a `focus-kit` + `focus-build.ts`** | Svelte 5, DS, ressources embarquées, `file://`, politique `connect-src 'none'`. C’est le chemin immédiatement exploitable. |
| Hôte connecté, routage vers la session, identité et écriture autorisée | **h2a / applications hôtes** | `focus serve`, `apps/focus`, bus h2a existent ; pas de moteur générique d’édition de dossier. sentropic gardera son propre contexte de workspace et de permissions. |
| Interprétation métier et incorporation dans les documents sources | **Agent producteur, ou successeur explicitement identifié** | Le retour est une donnée adressée ; l’agent doit traiter chaque édition et en rendre compte. h2a transporte, Focus valide/réconcilie, l’agent conserve le sens et les sources. |
| Journal d’amendements, provenance, lecture de trace | **Track, dans h2a** | `item.spec-amend` → `spec.amended` existe. Track enregistre les patchs ; il ne les applique pas. |

Les fonctions sont assignables maintenant ; **les personnes/sessions responsables ne sont pas établies par ces sources**. La recommandation est un conducteur h2a pour la livraison de bout en bout, avec un livrable précis demandé au design system. « Focus » n’est pas un troisième dépôt à trouver.

Attention aux documents périmés : le README Focus parle encore d’un package privé/app-local-first, alors que son `package.json` main est en `0.5.0`, sans `private: true`, avec `publishConfig.access = public`. Cela prouve l’état du code et l’intention de publication, pas la disponibilité d’une version npm vérifiée dans cette analyse.

**B. Existant, écarts et articulation portable / direct**

**B1. Les surfaces ne sont pas interchangeables.**

| Surface | Existant vérifié | Écart pour cette demande |
| --- | --- | --- |
| `@sentropic/focus` / `renderHtml` | Fonction pure qui produit une chaîne, Markdown injecté, sanitization par l’hôte, interactions désactivées. | Aucun runtime Tiptap. Les sections/paragraphes HTML n’exposent pas systématiquement leurs `id`/`targetRef` ; seul le modèle les possède. Pas de correspondance paragraphe → champ source. |
| MD et terminal | Rendus déterministes du même document. | Pas d’édition riche attendue dans ces sorties ; ils doivent rester fidèles au document et permettre de lire le retour d’édition sans interpréter du HTML. |
| `h2a focus build` | Kit Svelte autonome. Sections avec `id`, cartes sélectionnables, diagrammes interactifs bornés. | Prose affichée en texte brut dans un `<p>`, pas en Markdown rendu. Choix seulement en mémoire, perdus à la fermeture. Pas d’export de feedback générique, pas de paragraph IDs, pas de Tiptap. |
| `apps/focus` / `focus serve` | Application servie, dossier `agent-memory`, notes et réponses exportables en JSON, replay de réponses, transmission à une session via le bus. | Capital de retour utile, mais spécifique aux réponses/dossiers existants. Ni éditeur générique `DecisionDossierDocument`, ni `reconcile` de paragraphes. |
| `focus-interactive` | Contrats de deck et port `submitIntent`, ACK booléen. | Aucun `editReturn`, baseline ou statut de conflit. Importer le contrat Focus si ce chemin est utilisé, sans redéfinir sa forme. |
| sentropic `TipTap.svelte` | `Editor`, StarterKit, `tiptap-markdown`, `getMarkdown()`, changement de valeur et protection partielle du focus. | Sérialisation de tout le champ ; aucun ID de paragraphe persistant ni diff. Le watcher évite un reset pendant le focus, ce qui ne résout pas une modification concurrente. |
| sentropic `EditableInput.svelte` | Wrapper avec `originalValue`, état non sauvegardé, debounce, `apiPut`, verrous. | Copier ce composant entraînerait des dépendances à l’application et un autosave HTTP incompatible avec le portable. `originalValue` est une comparaison locale, pas un protocole OCC. |

Dans `preparePresentation`, les options sont rapprochées de leur question et le libellé de l’option recommandée peut être ajouté à `recommendedAnswer`. **Le DOM affiché n’est donc pas un miroir littéral du JSON source.** L’éditeur doit lire le champ canonique et garder les libellés de présentation hors de la zone éditable ; récupérer `innerHTML` ou `textContent` du rendu ferait parfois rentrer du texte généré dans le dossier.

**B2. Ce que #377 apporte réellement.** H1 ajoute un document explicite v2, sources/citations/annexes embarquées, consultation hors connexion et publication du fichier par écriture temporaire puis rename. Son manifeste déclare des capacités de consultation de preuves, aucune capacité d’édition. H2/H3 restent dépendants des exports DS de diagrammes. L’atomicité de publication HTML n’est pas l’atomicité d’une édition de texte. Les empreintes `envelopeSha256`/renderer/validator de la PR ne remplacent pas l’identité de la source.

Pour cette feature : capitaliser H1, préserver ses schémas et tests, coordonner les modifications communes de `App.svelte`, `focus-build.ts` et du build des assets. Ne pas insérer l’édition clandestinement dans la PR ni attendre H2/H3. Une branche d’édition séparée peut démarrer sur main et intégrer explicitement les apports de #377.

**B3. Le cas Influnified est une référence métier, pas un témoin vert actuel.** Il contient 12 sections, `s-reco` → `section:recommandation`, une interaction `amend` désactivée, et un hash opaque `draft-2026-10-18`. Il ne contient pas `readability`. Le contrôle actuel refuse donc sa présentation ; des métadonnées de question/options sont également absentes. Son Mermaid utilise des identifiants majuscules, des déclarations sur les lignes d’arêtes et `<br/>`, au-delà du profil accepté par `parseFlowchart`. L’HTML voisin référence aussi Google Fonts : il n’est pas une preuve de zéro réseau. Le brief dit qu’il provient de `renderHtml`, mais la version et les hooks exacts de cette génération ne sont pas établis.

Il faut conserver ce JSON historique comme témoin des refus et préparer une fixture dérivée conforme, sans inventer la citation propriétaire du dossier métier ni altérer les preuves. Le besoin d’édition n’autorise pas à contourner la lisibilité ou à remplacer silencieusement le diagramme. Une fixture synthétique conforme permet de commencer les tests immédiatement ; l’acceptation sur le dossier réel reste un jalon distinct.

**B4. Interaction locale et écriture autorisée.** Garder le snapshot source immuable et ses interactions `enabled: false`. L’hôte portable peut offrir une **capacité de brouillon local** distincte : éditer, annuler, comparer, exporter. Cela ne prétend pas soumettre une commande Track depuis un fichier.

Dans une session connectée, la capacité de soumission vient de l’hôte, de l’état actuel et des permissions. `amend` est ici un nom d’affordance ; `amendSpec` est le nom d’action du binding Track ; `item.spec-amend` est le WorkEvent ; `spec.amended` est l’événement persisté ; `amendment` est la valeur de modalité du modèle. Ce sont cinq niveaux, pas cinq synonymes à copier dans un enum.

`LiveDocumentStore` demeure un port `_kind` dans `sentropic/main:packages/chat-core/src/ports.ts:70`. L’OCC « baseHash → re-read → reconcile » est une intention de SPEC_VOL_FOCUS, pas une implémentation retrouvée dans Focus main. Il est raisonnable de livrer d’abord une session locale éditable et son retour, puis le transport connecté utilisant le même contrat ; il serait faux d’annoncer un branchement à un `FocusLiveSession` déjà opérationnel pour cela.

**C. Contrat proposé et comportement attendu**

Le texte normatif proposé dans cette partie est en anglais. Les noms de types/fichiers sont des propositions, pas des APIs existantes.

**C1. Identité : un manifeste durable, pas un index de rendu.**

Je recommande un petit `FocusEditingManifest` versionné, appartenant à Focus et conservé **avec** la source par le producteur. Il référence les champs textuels du dossier et porte leurs identités de paragraphes, leur ordre, leur parent éventuel et leur correspondance avec le texte source. Le texte reste dans le dossier ; le manifeste ne crée pas une deuxième version éditable du contenu.

Ce manifeste est un compagnon du document, embarqué par l’hôte et restitué avec les identités nouvellement créées. Cela permet d’étendre `focus build` sans modifier illégalement les schémas fermés v1/v2. L’insérer plus tard dans le modèle demanderait une évolution de schéma explicite ; **le numéro v2 appartient déjà à #377**. Le manifeste et le retour ont leur propre version.

> **Proposed specification — identity and source mapping**
>
> Focus SHALL own a versioned editing manifest and edit-return contract independent of the UI framework and transport. Existing dossier schemas remain authoritative for document content.
>
> An editable text unit SHALL be addressed by `(documentRef, nodeId, targetRef, field, paragraphId)`. `nodeId` selects the node; `targetRef` MUST match that node. Neither a target reference alone nor a display label is sufficient. Duplicate or inconsistent addresses MUST refuse reconciliation.
>
> Paragraph IDs SHALL be opaque, unique within the document lineage, and persisted by the document producer. Rendering, responsive layout, theme changes and UI locale changes MUST NOT regenerate them. Array indexes, DOM paths, translated labels and content hashes MUST NOT be identities.
>
> A legacy document receives a manifest once, before editable publication. Rebuilding without the retained manifest cannot claim identity continuity across source revisions. Missing or ambiguous lineage SHALL be reported, never repaired by silently matching similar text.
>
> The manifest SHALL identify the source field, block kind, parent and order, and bind its source mapping to an exact baseline. A source range or ordinal is baseline-local metadata only. Markdown boundaries SHALL be parsed by the declared content profile, not inferred by splitting on blank lines or inspecting rendered `<p>` elements.
>
> Split retains the original ID for one surviving paragraph and allocates new IDs for the others; merge retains one declared survivor and removes the other IDs; move retains the ID. The associated changes form one transaction. Deleted IDs SHALL NOT be reused for unrelated content.
>
> Copying or pasting content SHALL allocate new paragraph IDs; pasted markup MUST NOT supply trusted identities. Undo may restore the identity of the same removed logical paragraph. Structural separators and unsupported blocks SHALL be preserved or represented as explicit affected content, never changed outside the reported transaction.
>
> Translating document content is a content revision. Paragraph correspondence MUST be preserved explicitly or reported as unresolved. Stable IDs do not authorize applying an edit to a translated paragraph whose precondition no longer matches.

Unicité importante : le validateur actuel impose des `id` uniques, mais vérifie seulement que les `targetRef` d’interaction sont résolvables dans un ensemble. Il n’impose pas que tout `targetRef` soit une clé unique. Le couple contrôlé `nodeId` + `targetRef` évite d’en déduire une garantie inexistante.

Le profil initial doit rendre et éditer correctement les paragraphes ordinaires, avec le formatage inline pris en charge, et gérer Entrée / fusion / annulation. Les listes, titres, tableaux, blocs de code et extensions Markdown ont une structure ; on doit nommer les unités prises en charge et préserver les autres sans perte. Les tableaux du dossier de référence ne doivent pas disparaître à l’ouverture de Tiptap. Le profil supporté, ses limites visibles et son codec font partie de la livraison ; activer aveuglément StarterKit ne constitue pas une politique de fidélité.

**C2. Retour par paragraphe et export sans perte.** Conserver les réponses et notes dans l’enveloppe de feedback de l’hôte ; y ajouter un objet `editReturn` validé par Focus. On ne transforme ni une correction de texte en réponse à une question, ni une réponse libre en remplacement du dossier. Le même objet alimente copie, fichier et transmission connectée.

> **Proposed specification — edit return**
>
> Every exported feedback envelope SHALL include all captured answers, notes and document edits. Its version SHALL make edit support explicit. A consumer that cannot process edits MUST report that limitation; it MUST NOT acknowledge the envelope as fully handled.
>
> `editReturn` SHALL contain a stable return ID, the document reference, the source hash and cursor carried verbatim, the exact baseline content hash, the manifest identity and baseline hash, and an ordered list of atomic transactions. A transaction SHALL contain per-paragraph changes with stable change IDs, node/target/field/paragraph addresses, operation, exact before and after content, content format, and structural placement where relevant.
>
> Supported operations SHALL distinguish replace, insert, delete and move. Insert uses `before: null`; delete uses `after: null`; an empty string is content, not absence. Split and merge SHALL be represented by grouped paragraph changes, not by replacing the whole document. Positions SHALL reference stable neighbor/parent IDs, never current array indexes.
>
> Repeated typing SHALL be coalesced against the declared baseline. An unchanged paragraph SHALL not be emitted. Undoing all changes SHALL produce no edit. A move may have identical before and after content and different positions.
>
> Export SHALL capture one completed editor revision. No last keystroke, active composition, pending diff or concurrently updated answer may be omitted. A receipt SHALL identify the exact return and transaction IDs it consumed.
>
> JSON and YAML SHALL decode to the same typed payload. Text, Unicode, whitespace, line breaks, empty values and final newlines SHALL be preserved. JSON is the reference serialization; YAML uses a restricted JSON-compatible data model with duplicate keys and custom tags rejected. UI translations SHALL never modify stored user content or machine keys.

Exemple de forme, **synthétique**, pour une édition simple ; les valeurs `<…>` sont des placeholders, pas des digests valides. Le texte d’exemple n’est pas une correction attribuée au propriétaire :

```yaml
editReturn:
  schemaVersion: 1
  mode: "cumulative"
  returnId: "feedback:<opaque-id>"
  documentRef: "decision:example"
  sourceHash: "draft-2026-10-18"
  sourceCursor: "rev-1"
  baseHash: "sha256:<canonical-source-document>"
  manifestId: "anchors:<opaque-id>"
  manifestBaseHash: "sha256:<baseline-manifest>"
  transactions:
    - transactionId: "edit:<opaque-id>"
      changes:
        - changeId: "change:<opaque-id>"
          nodeId: "s-context"
          targetRef: "section:context"
          field: "markdown"
          paragraphId: "p:<opaque-id>"
          operation: "replace"
          format: "markdown"
          before: "The review covers both phases."
          after: "The review covers the first phase."
```

Pour insertion/déplacement, les positions avant/après nomment `parentId`, `previousParagraphId` et `nextParagraphId`, avec des valeurs nulles explicites aux frontières. Le schéma doit vérifier les invariants entre opération, valeurs et positions. Les nouveaux IDs et leurs relations accompagnent la transaction ; le manifeste résultant ne peut pas être reconstruit par une nouvelle numérotation.

Il faut une distinction explicite entre l’export **cumulatif depuis une baseline** et un flux **incrémental acquitté**. Recommandation initiale : `mode: cumulative`, retour figé et lié à son contenu ; une nouvelle saisie après export produit un nouveau `returnId`, avec `supersedesReturnId` si elle remplace le retour précédent de la même baseline. Le consommateur rediffère à trois voies au lieu de rejouer aveuglément des transactions déjà appliquées. Après acquittement et nouvelle version reçue, l’hôte peut avancer la baseline. Deux clics « copier » sans modification ne créent pas deux amendements.

Le capital `apps/focus/src/lib/dossier-answers.js` apporte une bonne logique de reprise et de signalement des divergences. Mais `collectAnswers():234` applique `.trim()` aux notes. Il ne prouve donc pas le « sans perte » au sens exact demandé. La règle de détection « réponse vide » peut ignorer les blancs pour le classement ; le contenu transmis doit rester intact. Une zone sélectionnable et un téléchargement JSON doivent fonctionner lorsque l’API clipboard est indisponible sous `file://`.

**C3. OCC : vérifier le document, puis publier sous la même garantie de concurrence.**

Trois identités doivent rester distinctes :

| Champ | Sens |
| --- | --- |
| `document.hash` / `sourceHash` exporté | Métadonnée opaque héritée de la source. Le binding Track utilise le premier `comprehensionEvidence.dossierHash`, sinon le curseur. Le cas métier utilise une chaîne de brouillon. |
| `editReturn.baseHash` | Nouvelle empreinte définie et recalculable du document source canonique exact édité, avant enrichissement de présentation/diagramme. Profil recommandé pour le contrat v1 : JSON Canonicalization Scheme RFC 8785, encodage UTF-8, SHA-256, préfixe `sha256:`. Aucun trim ni normalisation Unicode du texte source. Il s’agit des valeurs JSON canoniques, pas des espaces d’indentation du fichier JSON. |
| Empreintes de build #377 | Intégrité de l’enveloppe rendue, du renderer et du validator. Elles ne sont pas une autorisation, un ID de paragraphe ou une preuve de fraîcheur du document métier. |

Le manifeste a sa propre empreinte : une même chaîne source accompagnée de paragraph IDs différents ne doit pas passer comme la même base d’édition. Le build calcule ces empreintes avant transformations, les lie à l’artefact, et vérifie que les champs éditables exposés correspondent à cette base. Il n’est pas nécessaire de dupliquer les dizaines de Mo de preuves pour cela. Ne pas recalculer le hash complet de l’enveloppe à chaque frappe.

> **Proposed specification — reconciliation and commit**
>
> Reconciliation SHALL be a pure operation over the retained baseline, the current authoritative document and manifest, and the edit return. It SHALL validate identities and preconditions before producing a candidate or conflicts.
>
> If the current baseline hash matches, each `before` value and structural precondition still MUST match. If the document changed, unrelated edits may be rebased only through retained identity and a verified three-way comparison. Matching `after` content alone is not proof that the same transaction was applied; receipts provide idempotency.
>
> A changed or removed target, conflicting paragraph, lost manifest, unsupported format or ambiguous placement SHALL produce a structured conflict with the baseline, current and requested values. No last-write-wins or fuzzy paragraph match is permitted.
>
> Initial commit policy SHALL be atomic for the submitted transaction batch: either all changes are validated and published or none are. A later explicit split creates new identified batches; it is never a hidden partial success.
>
> The host SHALL use a compare-and-swap or an equivalent single-writer commit boundary that covers the final version check and publication. Re-reading before an unguarded write is insufficient. After rebasing, the committed base/result hashes SHALL describe the actual current-to-result transition; the original return remains available as provenance.
>
> Local drafting, export, transport delivery, source application and Track recording SHALL have distinct states. A transport acknowledgement alone MUST NOT be displayed as an applied or recorded edit.

Il ne faut pas faire dépendre le brouillon hors connexion de la présence d’une session. Au retour, un conflit ne doit pas effacer la saisie : l’agent renvoie les conflits structurés et l’hôte garde le brouillon. Les attestations du dossier original restent des preuves de l’original ; elles ne deviennent pas des attestations du contenu amendé. Un nouveau rendu doit marquer cette séparation et revalider structure/lisibilité avant présentation.

**C4. Consommation par l’agent producteur.** Le producteur conserve le document baseline, son manifeste et une référence de génération avant de le présenter. L’enveloppe d’hôte transporte une référence opaque du producteur et de cette génération ; ce ne sont pas des propriétés ajoutées sans version à `DecisionDossierDocument`. Le chemin de fichier et le nom de session seuls ne sont pas une identité durable.

Le cycle attendu est :

1. L’utilisateur modifie le texte dans son contexte, voit la modification et peut l’annuler. Répondre, commenter et modifier restent des gestes distincts, réunis dans le même retour.
2. L’hôte capture un retour cohérent. Hors connexion, copie/téléchargement suffit pour le remettre à l’agent. La persistance navigateur est un secours, pas la seule sauvegarde : `file://`, changement de chemin, profil vierge et stockage indisponible doivent rester supportés par export/import explicite.
3. L’agent ou son adaptateur parse et valide le retour, vérifie sa génération et ouvre la baseline conservée. Il lit la source actuelle, réconcilie à trois voies et prépare les changements applicables.
4. Il incorpore les corrections dans le document ou les sources concernées selon le mandat existant. Il ne paraphrase pas silencieusement une correction littérale en perdant son intention. Si une correction ne peut être appliquée, il la signale avec sa cause et garde le texte original du retour.
5. Il retourne un reçu par transaction : appliquée, déjà traitée, en conflit, ou non applicable avec raison. Le reçu contient l’empreinte réellement appliquée et, lorsqu’il existe, le lien vers l’enregistrement Track. La nouvelle version préserve les IDs survivants et contient le manifeste mis à jour.

> **Proposed specification — producer handoff**
>
> An edit return SHALL remain consumable without a live agent. Live delivery SHALL resolve the originating producer/generation, or an explicitly designated successor, and return an honest queued/delivered status. It MUST NOT silently redirect edits to an unrelated session merely because that session shares the repository.
>
> The consumer SHALL account for every transaction. Acknowledging receipt, incorporating changes, and recording an amendment are different facts. A replay with the same identity and content SHALL not apply twice; reuse of an identity with different content SHALL be rejected or processed as an explicitly versioned supersession.

Le bus actuel et `apps/focus/src/lib/server/h2a-target.js` sont un point de réutilisation. Ils résolvent notamment l’émetteur et des sessions de projet ; il faut vérifier/adapter cette politique pour la garantie « l’agent qui a produit le dossier ». Aucun nouveau transport ni communication effective n’est nécessaire pour le premier témoin portable.

**C5. Relation exacte à Track.**

Le `SpecAmendPayload` existant contient `itemId`, `baseHash`, `patch`, `resultHash`, et éventuellement `decisionId`, `liveDocRef`, `proposalRef`, `summary`. Il enregistre le patch et ses hash **sans les interpréter**. `amendSpec` vérifie l’existence de l’item, pas une égalité avec la dernière version du document. L’ingest impose son contexte de provenance et l’autorité d’écriture ; un champ JSON indiquant « human » ne donne pas cette autorité.

La chaîne recommandée est **retour de texte → réconciliation/application par l’hôte → traduction éventuelle en amendement Track**. Le diff par paragraphe est une forme d’échange humain/agent. Le JSON Patch enregistré est une forme d’audit du changement de source réellement effectué. Il peut contenir des opérations `test` et `replace` sur des chemins résolus à partir des IDs après relecture ; ses indices de tableau éventuels ne deviennent pas les identités du retour.

Toutes les éditions ne sont pas une modification de spec d’item :

| Situation | Traitement correct |
| --- | --- |
| Brouillon local, export ou simple correction de prose | Conserver le feedback et son statut ; aucun `spec.amended` automatique. |
| Amendement réellement appliqué à une spec dont l’item cible est identifié | `item.spec-amend`, via le chemin d’écriture autorisé, avec vrais base/result hashes et patch de la source visée. |
| Révision du dossier de décision uniquement | Utiliser l’adaptateur de dossier et son contrat existant si applicable ; ne pas présenter cela comme une modification de la spec d’un item. Une réécriture de dossier doit aussi être protégée contre les mises à jour perdues. |
| Dossier autonome sans item/decision Track | Le retour et le reçu restent utiles sans Track. Ne pas inventer `itemId` à partir de `ref` ou `targetRef`. |

`decision.add-artifact` n’accepte pas un artefact libre « paragraph-diff » : l’union actuelle est `h2a-decision-dossier`, `rendered-view`, `mockup`. On peut référencer une véritable vue de comparaison avec le type prévu ; on ne doit pas déguiser un nouveau payload dans un autre type. Un éventuel lien de feedback persistant dans le contrat Track devra être co-spécifié séparément. Un index durable tenu par l’hôte peut déjà associer retour, reçu et événement sans inventer un événement.

`track_amendment_trace` renvoie une projection résumée : séquence, auteur, provenance, origine, résumé, `patchRef`, etc. **`patchRef` est le `resultHash`, pas le patch ni nécessairement une URI récupérable.** De plus, le mapping Focus réduit aujourd’hui cette trace à `{at, author, summary}`. Aucun de ces deux objets ne satisfait le retour avant/après demandé. Conserver le payload complet du retour comme artefact, pas seulement son résumé dans `amendmentTrace`.

Autre piège : `spec.amended` est émis sur l’agrégat **item**, alors que `readDecisionDossier` appelle `amendmentTrace(decisionId)`. La présence d’un `decisionId` dans le payload ne fait pas apparaître automatiquement l’amendement d’item dans la trace de décision. Si l’UI veut les présenter ensemble, l’adaptateur doit lire explicitement les agrégats liés, conserver leur identité et définir l’ordre ; cela mérite un test.

La provenance machine/humaine doit rester honnête. `proposalRef` garde sa signification de référence à une proposition IA lorsqu’il y en a une ; ce n’est pas une case générique pour mettre un ID de feedback. Les opérations relayées par un agent ne deviennent pas automatiquement des signatures du propriétaire.

Enfin, **un rename de fichier et un append Track ne forment pas une transaction commune**. L’adaptateur doit conserver un reçu durable et une reprise idempotente entre « source appliquée » et « trace enregistrée ». Les tests doivent couvrir l’arrêt entre les deux et après enregistrement avant ACK. `clientToken` fournit du capital, mais la CLI actuelle le déduplique par lecture préalable du log : cela n’autorise pas à promettre un exactly-once distribué entre plusieurs writers. Respecter le writer unique et vérifier le contenu du retour associé au token.

**C6. Réactivité, fidélité et langue.** Monter Tiptap à la demande sur un champ/bloc actif, garder la page et le canvas en place, limiter parsing et diff à la zone affectée. Une frappe ne doit ni reparser les sources de preuves de #377 ni remonter le dossier entier. Les transactions éditoriales, le diff exporté et le manifeste doivent correspondre à la même révision. Les réponses asynchrones périmées ne remplacent pas la saisie récente.

Le premier contrat doit distinguer les textes éditables — prose et champs narratifs explicitement autorisés — des IDs, statuts d’approbation, attestations, citations originales et bytes de preuves, qui ne sont pas du texte à réécrire librement. Modifier le libellé d’une recommandation n’accepte pas une option ; modifier une conclusion ne ratifie pas une décision. Les brouillons peuvent être temporairement incomplets ; leur export de correction reste possible, tandis qu’une nouvelle présentation approuvable passe les contrôles de lisibilité.

> **Proposed specification — presentation and localization**
>
> The editor SHALL operate on source-backed text fields in place. It SHALL preserve unedited source content and unsupported blocks; entering and leaving edit mode without a change MUST produce no diff. Presentation-only labels and generated prefixes MUST NOT enter the source.
>
> Renderers and editor controls SHALL receive locale and message catalog data from the host. User-facing labels, accessibility text, status messages, copy/export notices and the HTML language attribute SHALL follow the selected user locale. Document content language and UI locale are separate. No locale change may alter source text, paragraph IDs or feedback values.
>
> Offline delivery SHALL embed all required editor code, fonts or font fallbacks, styles and message catalogs. Editing, undo, diff preview, export and import SHALL work without network access or a server. Rich content outside the declared profile MUST remain intact and visibly unsupported for editing rather than be silently normalized away.

Le besoin de localisation est déjà concret : le kit a des chaînes françaises et `scripts/build-focus-dossier.mjs` émet `lang="fr"`; le core mélange notamment « préco », « answer », « Reading time ». Le lot doit permettre l’injection de catalogues, et tester au moins deux langues plus des contenus Unicode/RTL ; une succession de nouvelles chaînes françaises coderait à nouveau le problème. Tiptap apporte le moteur d’édition, pas cette politique de langue ni le protocole d’amendement.

**D. Lots proposés, fichiers exacts et tests RED**

Les chemins ci-dessous sont relatifs au dépôt indiqué. **« Nouveau » signifie un fichier proposé, inexistant au moment de l’analyse.** La découpe n’est pas une création de backlog ou une affectation de session. Les tests portent sur les risques de cette feature et doivent être lancés par les gates habituels des dépôts lors de l’implémentation, dans leurs environnements isolés ; aucun test n’a été exécuté ici.

**H0 — h2a / Focus : contrat et témoins communs. Peut démarrer maintenant.**

Fichiers : nouveaux `docs/focus/document-editing.md`, `packages/focus/src/editing/contract.ts`, `packages/focus/schemas/focus-edit-return.v1.schema.json`, `packages/focus/schemas/focus-editing-manifest.v1.schema.json`, `packages/focus/tests/editing-contract.spec.ts` ; compléter `packages/focus/src/index.ts`, `packages/focus/package.json`, `packages/focus/src/registry/definitions.ts` et le manifeste de registre généré si ces contrats sont exposés.

RED : rejet d’une adresse incohérente, d’un ID de changement dupliqué, d’un manifeste ne correspondant pas à la source, d’un `null` illégal pour l’opération, d’une version inconnue et d’un statut d’approbation usurpé ; conservation de `""`, Unicode, CRLF et sauts finaux ; équivalence sémantique JSON/YAML ; v1 historique et v2 #377 inchangés. Inclure deux paragraphes textuellement identiques dans le témoin : le contrat doit pouvoir les distinguer.

Sortie : contrat d’échange commun à l’éditeur, au build et au consommateur. Dépendance : aucune publication DS. Les questions de principe E peuvent ajuster la politique, pas suspendre ces invariants.

**H1 — h2a / Focus : identités, diff et réconciliation pure. Peut démarrer avec H0.**

Fichiers nouveaux : `packages/focus/src/editing/anchors.ts`, `diff.ts`, `reconcile.ts`, `codec.ts` ; tests `packages/focus/tests/editing-anchors.spec.ts`, `editing-diff.spec.ts`, `editing-reconcile.spec.ts`, `editing-codec.spec.ts`.

RED : insertion avant un paragraphe sans renuméroter les suivants ; réordonnancement des sections et options sans changement de cible ; split/merge/undo ; paragraphes identiques ; langue d’interface changée ; révision de contenu traduite avec précondition périmée ; édition concurrente sur un autre paragraphe réconciliable ; même paragraphe modifié, cible supprimée et placement ambigu refusés ; lot contenant une opération invalide appliqué zéro fois ; retour répété dédupliqué par reçu et refus d’un même ID portant un contenu différent.

Sortie : un candidat source + manifeste et des conflits structurés, sans framework, I/O ou écriture Track. Tester aussi export cumulatif A→B puis A→C après application de A→B ; ce cas ne doit ni doubler ni faire perdre l’édition.

**DS1 — design system : composant Tiptap contrôlé. Peut avancer en parallèle.**

Capital : `sentropic/ui/src/lib/components/TipTap.svelte`, `ui/src/lib/extensions/tailwind-classes.ts`, `ui/src/lib/utils/markdown.ts`. Fichiers proposés dans DS : nouveau `packages/components-svelte/src/lib/RichTextEditor.svelte`, nouveau test `packages/components-svelte/src/RichTextEditor.test.ts`, export dans `packages/components-svelte/src/lib/index.ts`, dépendances dans `packages/components-svelte/package.json` et lockfile du dépôt. Un sous-export dédié est préférable si nécessaire pour éviter de charger Tiptap chez tous les consommateurs DS.

RED : readonly effectif ; focus et sélection conservés lors d’une mise à jour contrôlée ; aucune suppression du travail local sur valeur externe concurrente ; IME/composition ; undo/redo et split/merge ; collage avec liens et formatage permis ; rejet/préservation des contenus hors profil ; démontage sans listeners persistants ; labels et noms accessibles injectés ; aucun accès réseau ni appel à `apiPut`.

Le composant transmet ses transactions et accepte des extensions/attributs d’identité fournis par l’adaptateur Focus ; il ne possède ni `targetRef`, ni hash OCC, ni client Track. Ne pas déplacer `EditableInput` dans DS : son rôle de formulaire et sa sauvegarde restent à sentropic. Publier un artefact reproductible réellement consommable par h2a ; l’édition de texte ne dépend pas de `diagram-core`/`diagram-canvas`.

**H2 — h2a : édition dans le rendu portable et ancrages du rendu HTML.**

Fichiers existants : `packages/h2a/focus-kit/src/App.svelte`, `src/style.css`, `src/main.js`, `packages/h2a/src/focus-build.ts`, `packages/h2a/focus-kit/package.json`, `packages/h2a/focus-kit/package-lock.json`, `scripts/build-focus-dossier.mjs`, `packages/focus/src/render/html.ts`, `render/hooks.ts`, `render/presentation.ts`. Nouveaux adaptateurs : `packages/h2a/focus-kit/src/EditableField.svelte`, `src/editing-session.js`. Tests : compléter `packages/focus/tests/render.spec.ts`, `packages/h2a/test/focus-build.test.js` ; nouveau `packages/h2a/focus-kit/test/editing-browser.test.mjs`.

RED : le vrai texte rendu devient éditable à son emplacement ; modification d’un paragraphe de prose et d’un champ narratif de question ; retour ancré sur le bon champ, sans préfixe ajouté par `preparePresentation` ; annulation sans diff ; tableau/code non édité inchangé ; HTML hooks/sanitizer conservant les attributs d’ancrage nécessaires ; nested option correctement identifiée. Le mode texte simple actuel du kit ne suffit pas à ce témoin.

Ajouter un témoin de collage hostile et de copie interne : liens/script/images distantes ne deviennent pas exécutables, et les IDs collés ne peuvent pas rediriger une correction vers un autre paragraphe. Le HTML riche réintroduit une surface que l’affichage texte brut actuel évitait ; cette vérification est directement liée au changement.

Le rendu pur `renderHtml` expose les ancres stables ; l’hôte lui associe le runtime. Il ne devient pas lui-même un serveur ni un bundle Tiptap. Tester également la variante `renderHtml` + hôte, pour ne pas limiter la solution au second renderer Svelte alors que la demande cite le premier.

Dépendances : H0/H1, composant DS1. Pour démarrer les RED et la correspondance source/rendu, une dépendance DS publiée n’est pas nécessaire. Si sa publication retarde le témoin, un adaptateur Tiptap minimal dans `EditableField.svelte` est un compromis réversible explicite, à remplacer par l’export DS ; ne pas recopier le wrapper métier sentropic ni vendre cette étape comme une extraction déjà achevée.

**H3 — h2a : retour complet, reprise hors connexion et distribution.**

Fichiers : nouveaux `packages/h2a/focus-kit/src/FeedbackExport.svelte`, `src/draft-storage.js`, `test/editing-roundtrip.test.mjs` ; H2 pour intégration ; `packages/h2a/focus-kit/renderer.html`, `renderer-manifest.json`, `validator.mjs` et copies de schémas régénérés par leurs scripts, jamais maintenus à la main. Compléter `packages/h2a/test/focus-build.test.js` et les tests de distribution de #377 lorsque cette base est intégrée. Pour les réponses de l’application servie : `apps/focus/src/lib/dossier-answers.js`, `apps/focus/src/routes/dossier/agent-memory/+page.svelte`, `packages/h2a/test/focus-dossier-answers.test.js`.

La distribution Track embarque aussi Focus : régénérer les sorties concernées de `packages/track/src/focus-vendor/` via `scripts/vendor-focus.mjs` et passer `scripts/check-focus-vendor.mjs`. Vérifier que les nouveaux exports browser restent indépendants de Node/Track, même si le package Focus possède un adaptateur `/track`. Le renderer portable ne doit pas embarquer ce backend par accident.

RED : un unique export contient choix + note exacte + tous les changements de paragraphes ; copie et fichier décodent le même objet ; `clipboard` refusé avec export manuel utilisable ; fermeture puis import dans un profil vierge ; stockage absent/corrompu ; dossier déplacé sur disque ; export pendant la dernière transaction/IME ; réponses avec blancs/sauts finaux non tronquées ; absence de mutation de la baseline. Import d’un retour de mauvaise génération explicitement refusé.

Gate de distribution : installer le tarball exact dans un environnement vierge, construire le dossier puis ouvrir le fichier avec réseau bloqué, sans imports du checkout, serveur, CDN ou police distante. Reprendre les garanties de #377 sur la conservation de l’ancien HTML en cas d’échec de publication.

**H4 — h2a : importeur du retour, reçu et incorporation par l’agent.**

Fichiers proposés : `packages/h2a/src/focus-feedback.ts`, `packages/h2a/src/runtime/focus/edit-receipts.ts`, tests `packages/h2a/test/focus-feedback.test.js` et `focus-edit-recovery.test.js`. Points de raccord existants : `packages/h2a/src/bin.ts` pour la sous-commande native, `cli.ts` pour l’aide ; `packages/focus/skills/focus/SKILL.md` et `packages/track/skills/present-decision/SKILL.md` pour décrire la consommation réelle, sans accorder une autorité d’écriture supplémentaire.

RED : parser un export produit par le navigateur, retrouver sa baseline et son manifeste, appliquer au bon document, préserver les autres changements, produire un reçu vérifiable ; vérifier la course entre relecture et écriture avec deux versions concurrentes ; arrêt après publication puis relance ; doublon reçu avec même contenu ; doublon avec contenu différent ; incompatibilité de version annoncée au lieu d’être ignorée. L’agent produit une nouvelle version et rend compte de chaque transaction.

C’est le complément nécessaire du premier témoin : une interface qui affiche seulement un diff sans consommateur testé ne répond pas entièrement au « retour vers l’IA ». Le transfert manuel suffit pour ce lot ; il n’impose pas de serveur permanent.

**H5 — h2a / Track : adaptation des amendements enregistrés, puis transport connecté.**

Fichiers : extension proposée `packages/focus/src/track/editing.ts`, test `packages/focus/tests/track-editing.spec.ts`. À vérifier/compléter sans dupliquer Track : `packages/track/src/model/spec-amend.ts`, `src/ingest/contract.ts`, `src/ingest/focus-l4.ts`, `src/track.ts`, `src/read/contract.ts`, `src/m5-canevas.test.ts`. La table L4 liste seulement `itemId`/`patch` comme payload requis, alors que l’ingest exige aussi `baseHash`/`resultHash` : le consommateur doit suivre le contrat complet.

RED : JSON Patch exact après réconciliation ; mauvais item/workspace refusé ; hash stale détecté par l’hôte avant append ; un lot ↔ un enregistrement logique idempotent ; reprise après fichier appliqué/Track non enregistré et après Track enregistré/ACK perdu ; provenance de la proposition et de son incorporation intacte. Vérifier séparément la trace de l’item et celle de la décision : elles ne sont pas automatiquement jointes. Une édition sans cible Track ne doit pas fabriquer d’événement.

Pour le direct, points existants : `apps/focus/src/lib/server/h2a-bus.ts`, `h2a-target.js`, `packages/h2a/src/runtime/focus/serve.ts`. Nouveaux fichiers proposés : `apps/focus/src/routes/api/dossiers/feedback/+server.ts`, `apps/focus/src/lib/server/focus-feedback.ts`, test `packages/h2a/test/focus-feedback-delivery.test.js`. Si le deck est raccordé, compléter `packages/focus-interactive/src/feedback.ts`, `sync.ts` et `test/focus-interactive.test.js` avec le contrat importé de Focus.

RED : producteur vivant, producteur absent, successeur explicite, mauvaise génération, workspace non autorisé, retransmission, et distinction reçu/livré/appliqué/enregistré. Réutiliser les contrôles de l’hôte. Un portable `connect-src 'none'` continue à fonctionner : on ne lui ajoute pas implicitement une connexion réseau.

**S1 — sentropic : capitalisation de l’éditeur et adoption sans réintroduire Focus dans ce dépôt.**

Fichiers : `ui/src/lib/components/TipTap.svelte`, `EditableInput.svelte`, `ui/src/lib/extensions/tailwind-classes.ts`, `ui/package.json` et lockfile ; préciser le comportement dans `spec/COLLAB.md`, `spec/USECASE_EDITABLE_INPUT.md`. Nouveaux tests proposés : `ui/tests/components/TipTap.test.ts`, `EditableInput.test.ts`; conserver `ui/tests/utils/markdown.test.ts` et les tests de permissions pertinents.

RED : remplacer le moteur local par le composant DS sans modifier le contrat des formulaires ; conserver `locked`, `disabled`, `forceList`, autosave et suivi des changements ; aucune frappe ni sauvegarde pour un viewer ; changement externe pendant saisie signalé sans écrasement ; labels dans la langue active. L’intégration future du retour Focus dans une page sentropic est un lot consommateur, pas le déplacement du modèle. Pas de chantier de collaboration général requis pour le portable ASAP.

**H6 — h2a + DS : langue et qualification de réactivité, incluses dans l’acceptation.**

Fichiers proposés : `packages/focus/src/render/labels.ts`, nouveau `packages/focus/tests/localization.spec.ts`; modifier `render/html.ts`, `render/md.ts`, `render/terminal.ts`, `render/hooks.ts`; nouveau `packages/h2a/focus-kit/src/messages.js`, raccord dans `App.svelte`, `scripts/build-focus-dossier.mjs` et les composants d’édition. Nouveau `packages/h2a/focus-kit/test/editing-performance-browser.test.mjs` et fixture `test/fixtures/editing-performance-policy.v1.json`.

RED : changement de langue de l’UI modifiant tous les contrôles/attributs accessibles, sans toucher les IDs ni les contenus ; aucune valeur française obligatoire dans le contrat ; une frappe et un undo ne remontent ni canvas ni lecteur de preuves ; sélection/caret/scroll préservés ; résultat asynchrone périmé écarté ; export contenant exactement la révision affichée.

Réutiliser le corpus volumineux figé de #377 pour vérifier que le coût d’une édition reste local. Cibles initiales à qualifier sur des profils navigateur/matériel déclarés : p95 frappe→peinture ≤ 50 ms, validation locale d’un paragraphe ordinaire ≤ 100 ms, zéro réinitialisation du canvas. Ce sont des budgets **proposés**, pas des performances mesurées ici. Figurer séparément gros collage, export, ouverture et reprise ; ne pas masquer une pause de saisie derrière une bonne moyenne d’ouverture ou un plafond de taille.

**Ordre ASAP recommandé.** Démarrer H0/H1 et DS1 en parallèle, puis H2/H3/H4 pour un premier circuit complet : fichier hors connexion → édition in-place → export → agent producteur → nouvelle version/reçu. H6 est une exigence de ce circuit, pas une localisation reportée indéfiniment. H5 ajoute l’enregistrement Track quand une spec est effectivement modifiée et le transport connecté. S1 capitalise le composant sans bloquer le témoin portable. Le démarrage de ces lots ne dépend ni de H2/H3 diagrammes de #377, ni de l’implémentation du port chat `LiveDocumentStore`.

Le premier témoin honnête utilise une fixture conforme, puis une version traçable et conforme du dossier Influnified. Il doit démontrer **une correction réelle consommée par l’agent**, deux paragraphes identiques distingués, une insertion, une réponse libre intacte et un conflit concurrent sans perte. Cela donne un résultat reviewable sans attendre une plateforme générale de documents collaboratifs.

**E. Questions ouvertes au propriétaire — quatre principes, avec contexte et recommandation**

Ces questions sont proposées pour la suite ; elles ne bloquent pas cette analyse ni les tests de contrat. Elles ne rouvrent pas les décisions déjà relayées : Tiptap, hors connexion, retour sans perte, atomicité, réactivité, langue de l’utilisateur et extension de `focus build`.

| Question ouverte | Contexte et enjeu | Recommandation de départ |
| --- | --- | --- |
| **Quand vous réécrivez un passage, quelle force souhaitez-vous donner à cette correction dans le travail de l’agent, et quelle restitution vous permet de vérifier qu’elle a été comprise ?** | Une correction peut être une formulation exacte à reprendre, une réorientation ou une observation. Aucune de ces nuances ne peut être déduite d’un bouton « accepter » ni du seul changement de texte. Une rédaction corrigée n’est pas forcément une décision ratifiée. | Traiter le texte corrigé comme une demande explicite de modification, conserver ses mots, appliquer dans le mandat existant et expliquer chaque impossibilité. Rendre un reçu et la nouvelle version. Réserver l’approbation engageante à son geste distinct, sans redemander confirmation pour chaque correction routinière. |
| **Quels éléments du document voulez-vous pouvoir retravailler directement, et où placez-vous la frontière entre réécrire le récit et modifier les preuves ou la décision elle-même ?** | La prose Markdown, les questions, recommandations, options, tableaux, citations et diagrammes ne partagent pas le même modèle. Un éditeur global risquerait de transformer les références et preuves en simple texte. | Commencer par les champs narratifs source-backed, avec insertion/fusion de paragraphes et contenu riche borné ; préserver preuves, provenance et IDs. Étendre tableaux/diagrammes par leur modèle propre. Nommer les champs temporairement non éditables dans le témoin. |
| **Si le dossier a évolué pendant votre lecture, comment souhaitez-vous que vos corrections et la nouvelle version soient rapprochées, et à quel niveau voulez-vous arbitrer un désaccord ?** | L’usage hors connexion rend les versions divergentes normal. Un rejet de tout changement à la moindre divergence fatigue ; une fusion silencieuse peut changer le sens. | Rebaser automatiquement les paragraphes inchangés dont l’identité est certaine ; présenter avant/actuel/souhaité pour les conflits. Garder le lot atomique initialement et proposer un découpage explicite si utile. Préserver le brouillon jusqu’à résolution. |
| **Quelle continuité de travail attendez-vous entre le fichier portable, la session productrice et l’application sentropic, et quel livrable minimum rend la reprise utile tout de suite ?** | Le portable fonctionne sans session ; le direct ajoute identité/routage/reçus ; sentropic a déjà l’éditeur mais n’héberge plus Focus. Attendre toute la chaîne connectée retarderait l’édition utile. | Livrer d’abord le circuit portable complet avec retour manuel consumable, sous conduite h2a, composant générique DS ; ajouter ensuite le direct et l’adoption sentropic avec le même contrat. Reprendre un brouillon via un fichier explicite doit rester possible sur une autre machine. |

**Incertitudes restantes, à ne pas transformer en faits acquis.** La citation propriétaire est fournie dans un fichier, sans transcript original recoupé. L’identité de la session qui prendra chaque lot n’est pas déterminée. Le manifeste durable et son stockage compagnon sont une recommandation à spécifier, pas du capital existant. La frontière exacte des champs éditables et la fidélité Markdown/Tiptap nécessitent des témoins, notamment les tableaux et références. La publication npm courante des composants et la compatibilité précise Tiptap 3.31.3 / `tiptap-markdown` 0.9.0 doivent être qualifiées sur le bundle final ; leurs numéros déclarés ne prouvent pas un round-trip sans perte. La PR #377 peut évoluer après le head examiné. Le routage actuel vers une session de projet ne prouve pas à lui seul la garantie de retour au producteur. Aucun patch de paragraphe, moteur OCC ou test navigateur de cette nouvelle feature n’a été exécuté dans cette analyse.

**Repères de preuve vérifiables**

Les liens ci-dessous figent les versions lues, plutôt que de renvoyer aux checkouts anciens de sentropic/DS. Les chemins des lots nouveaux ci-dessus sont intentionnellement distingués de ces sources existantes.

| Objet | Source |
| --- | --- |
| Transfert Focus vers h2a, spec historique et OCC souhaité | [sentropic SPEC_VOL_FOCUS.md](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/spec/SPEC_VOL_FOCUS.md#L3) |
| Modèle, IDs, affordances désactivées et hash opaque | [h2a model.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/model.ts#L39) |
| HTML statique, labels et structure | [render/html.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/render/html.ts#L30) |
| Transformation de présentation | [render/presentation.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/render/presentation.ts#L5) |
| Identité et validateur fermé | [validation/index.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/validation/index.ts#L552) |
| Mapping hash, trace et lecture de décision | [focus/src/track/index.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/src/track/index.ts#L234) |
| Kit portable, prose brute et choix en mémoire | [focus-kit/src/App.svelte](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/focus-kit/src/App.svelte#L32) |
| Build, profile Mermaid et obligation d’un diagramme | [focus-build.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/src/focus-build.ts#L100) |
| Bundle, CSP et langue hardcodée | [build-focus-dossier.mjs](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/scripts/build-focus-dossier.mjs#L61) |
| #377 : apports H1 et limites déclarées | [portable-dossiers.md au head PR](https://github.com/rhanka/h2a/blob/757d97c627bc11ba997fc729d759d25fefe0c96a/docs/focus/portable-dossiers.md), [frontière DS](https://github.com/rhanka/h2a/blob/757d97c627bc11ba997fc729d759d25fefe0c96a/docs/focus/diagram-renderer-contract.md) |
| Intents actuels et port de synchronisation | [feedback.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus-interactive/src/feedback.ts), [sync.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus-interactive/src/sync.ts) |
| Retour de réponses existant, dont trim | [dossier-answers.js](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/apps/focus/src/lib/dossier-answers.js#L230) |
| Trace Track : opaque, record-only | [model/spec-amend.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/model/spec-amend.ts), [amendSpec](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/track.ts#L585) |
| Payload d’ingest complet et action L4 | [ingest/contract.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/ingest/contract.ts#L394), [focus-l4.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/ingest/focus-l4.ts#L48) |
| Projection de trace par agrégat | [read/contract.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/read/contract.ts#L857) |
| Union fermée des artefacts de dossier | [model/decision.ts](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/track/src/model/decision.ts#L54) |
| Tiptap réellement utilisé par l’application | [TipTap.svelte](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/ui/src/lib/components/TipTap.svelte#L42), [EditableInput.svelte](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/ui/src/lib/components/EditableInput.svelte#L88), [ui/package.json](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/ui/package.json#L76) |
| Permissions de collaboration existantes | [COLLAB.md](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/spec/COLLAB.md#L333) |
| Port live encore minimal | [chat-core/src/ports.ts](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/chat-core/src/ports.ts#L66) |
| DS : composants et thème CodeMirror | [components-svelte exports](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/packages/components-svelte/src/lib/index.ts), [codemirror/src/index.ts](https://github.com/rhanka/sent-tech-design-system/blob/25c0f3d33c258fc2b906a4b85219ffce5f67eccc/packages/codemirror/src/index.ts) |

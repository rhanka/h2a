const agentMemoryDossier = {
  revision: "agent-memory-2026-07-25",
  previousRevision: "agent-memory-2026-07-24",
  title: "Dossier de décisions — mémoire de l’agent persistant (révision 2)",
  context: "Un agent persistant est ici repensé comme une MÉMOIRE durable — le substrat qui reste — consommée par une ou plusieurs sessions éphémères, partagée entre plusieurs CLI (claude, codex, gemini, hermes…), multi-session, local-first sous contrainte RAM/OOM. Cette révision 2 fait deux choses que la révision 1 ne faisait pas. D’abord elle descend au niveau des MÉCANISMES : comment Hermes écrit réellement, ce que fait le chemin d’écriture bi-temporel de Graphiti, ce que graphify sait déjà faire et ce qui lui manque, ce qu’un hook de compaction permet et interdit — chaque fait est posé sur la carte qui en a besoin, jamais en annexe, et ce que la recherche n’a pas pu établir est marqué NON VÉRIFIÉ plutôt que présenté comme acquis. Ensuite elle transforme vos réponses du premier passage en nouvelles décisions : vos réponses désignaient des COMPOSITIONS qui ne figuraient dans aucune liste d’options, et c’est là qu’est la vraie question de conception. Le dossier reste neutre : aucune option n’est recommandée, et le champ « critère » de chaque carte nomme ce qu’il faut peser, jamais un choix.",
  carryOver: {
    from: "agent-memory-2026-07-24",
    carried: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    added: ["D8", "D9", "D10", "D11", "D12", "D13"],
    statement: "Les sept décisions de la révision 1 sont conservées à l’identique — mêmes clés, mêmes clés d’options — et leur texte a été enrichi de faits de mécanisme, pas remplacé. Le jeu de réponses du 25/07/2026 se rejoue donc INTÉGRALEMENT sur cette révision : aucune de vos réponses n’est orpheline. Les six cartes ajoutées (D8 à D13) n’ont, elles, aucune réponse enregistrée — c’est ce que le rapport de rejeu vous dira, décision par décision."
  },
  corrections: [
    {
      subject: "Hermes — les plafonds",
      wasStated: "MEMORY.md ~800 tokens, USER.md ~500 tokens.",
      actually: "Les plafonds sont en CARACTÈRES, pas en tokens : memory_char_limit = 2200, user_char_limit = 1375, surchargeables dans config.yaml. Les chiffres en tokens sont dérivés, jamais appliqués.",
      source: "recherche §1 — tools/memory_tool.py:167"
    },
    {
      subject: "Hermes — la consolidation",
      wasStated: "Les plafonds forcent la consolidation et la déduplication.",
      actually: "Il n’y a AUCUNE passe de consolidation LLM. Une écriture au-delà du budget est rejetée dans l’appel même, avec l’usage, les entrées courantes et la consigne de replace/remove puis de réessayer DANS LE MÊME TOUR. Le plafonnement est une erreur dure synchrone, pas un résumeur ; au bout de 3 échecs dans le tour, l’outil rend un done terminal pour ne jamais bloquer la réponse.",
      source: "recherche §1 — memory_tool.py:426-449, 495-520, 652-671"
    },
    {
      subject: "Hermes — la licence",
      wasStated: "Licence non vérifiée.",
      actually: "MIT (fichier LICENSE décodé).",
      source: "recherche §1"
    },
    {
      subject: "Letta/MemGPT — la concurrence",
      wasStated: "Blocs partagés par identifiant, dernier-écrivain-gagnant.",
      actually: "Ce n’est PAS du dernier-écrivain-gagnant : la table des blocs porte un verrouillage optimiste SQLAlchemy (version_id_col) — une écriture périmée lève — plus une vraie table BlockHistory avec sequence_number et undo/redo. C’est l’histoire de concurrence la plus solide du corpus, à l’opposé de ce qu’annonçait la révision 1.",
      source: "recherche §2 / §9 — orm/block.py"
    },
    {
      subject: "ctx (ActiveMemory) — « convergent »",
      wasStated: "Hypothèse d’un mécanisme de fusion, peut-être de type CRDT.",
      actually: "C’est une affirmation ÉPISTÉMIQUE, pas un mécanisme : « à travers les 17 systèmes analysés, six patrons de conception ont été découverts indépendamment » (thèse §5.3), donc ces patrons portent un poids de validation supplémentaire. La résolution de conflit, elle, est du git ordinaire sur du Markdown ordinaire. Aucun CRDT, aucun pilote de fusion nulle part dans le code.",
      source: "recherche §10"
    },
    {
      subject: "ctx (ActiveMemory) — la surface",
      wasStated: "CLI seule, pas de MCP.",
      actually: "MCP étendu, au contraire : ctx mcp en stdio, ctx setup génère les configs par outil, ctx steering sync pousse les règles dans Claude Code/Cursor/Kiro/Cline, un plugin enregistre des hooks PreToolUse/PostToolUse/UserPromptSubmit et des .claude/skills/, ctx loop génère un script de boucle autonome, ctx watch applique les balises <context-update>.",
      source: "recherche §10"
    },
    {
      subject: "graphify — « build puis query »",
      wasStated: "Archétype corpus-de-référence, pas un écrivain de mémoire vivante.",
      actually: "Plusieurs manques supposés sont déjà comblés : un adaptateur d’ingestion de conversations Claude/Codex/Cursor/Gemini qui parse des événements typés session_start, session_end, turn, user_prompt, tool_call, skill_invoke et COMPACTION ; un puits de mémoire autorisée .graphify/memory/ ; une temporalité uni-temporelle t/t_end avec un rappel ponctuel graphify recall --as-of ; un serveur MCP graphify serve à 18 outils dont 2 en écriture ; un journal de décisions d’ontologie append-only ; et un pilote de fusion git pour graph.json. D’autres manques, eux, apparaissent — ils sont sur les cartes D8 à D12.",
      source: "recherche §0.1 / §4 — src/conversations.ts, src/ingest.ts:345, src/temporal-recall.ts, src/serve.ts"
    }
  ],
  decisions: [
    {
      key: "D1",
      question: "Quelle est la nature de la mémoire : corpus de référence curé, capture de conversation vivante, ou hybride des deux ?",
      whyNow: "Le repositionnement récent (mémoire = la brique durable, sessions = éphémères) rend ce choix fondateur : il détermine si la mémoire est un corpus qu’on construit une fois puis qu’on interroge (à la graphify) ou un flux qu’on alimente à chaque tour (à la mem0/Letta) — les deux impliquent une architecture de fond différente.",
      options: [
        {
          key: "corpus-de-reference",
          title: "Corpus de référence curé (documents/code)",
          behavior: "Un pipeline batch transforme un corpus documentaire en graphe ontologique typé et dédupliqué. graphify : JSON local avec citations au niveau du localisateur, cycle de vie de revue à 9 états (inferred, proposed, guessed, candidate, validated, reference, attached, needs_review, rejected, superseded), déclencheurs d’écriture attachés à git. cognee : Extract-Cognify-Load, embarqué par défaut (SQLite + LanceDB + Kuzu/Ladybug), l’ontologie appliquée APRÈS extraction par appariement flou.",
          consequence: "Structure typée et auditable pour le savoir stable, avec une provenance vérifiable fait par fait. Mais l’écriture est batch et déclenchée par git, pas par un tour de conversation ; et le plancher mesuré d’une écriture sur ce poste est d’environ 620 ms pour 373 Mo de RSS, parce que le modèle d’écriture réécrit le graphe entier."
        },
        {
          key: "conversation-vivante",
          title: "Capture de conversation vivante",
          behavior: "Chaque tour ou fait est extrait automatiquement et écrit au fil de l’eau — mem0 (routeur ADD/UPDATE/DELETE/NOOP), Letta/MemGPT (blocs auto-édités rendus en XML avec leur propre compteur de budget, plus une archive), Zep/Graphiti (add_episode bi-temporel), Hermes (un seul outil memory add/replace/remove, sans action de lecture), A-MEM (une note Zettelkasten par fait, puis une décision LLM d’évolution), MemoryOS (paliers avec une formule de chaleur explicite).",
          consequence: "Capture fidèle du vécu de session et de son évolution. Mais chaque système paie cette fidélité quelque part : Graphiti par un coût d’environ 2 + 3E + N appels LLM par épisode, linéaire en nombre d’arêtes ; A-MEM en RÉÉCRIVANT sur place les tags et le contexte de chaque voisin retrouvé ; MemoryOS en remettant à zéro les compteurs de visite d’une page promue ; Hermes en refusant l’écriture au plafond au lieu de résumer."
        },
        {
          key: "hybride",
          title: "Hybride : corpus curé et capture vivante en couches distinctes",
          behavior: "Le corpus documentaire reste construit et réconcilié séparément pendant qu’une couche de capture alimente une mémoire complémentaire consommée par les sessions éphémères. C’est déjà la forme du couple graphify + adaptateur de conversations : l’adaptateur SAIT lire les tours et les compactions, mais c’est un scanner de lecture, à la demande — rien ne le déclenche en fin de tour.",
          consequence: "Couvre les deux besoins, mais double le nombre de substrats à opérer et exige une frontière explicite entre « ce que sait le corpus » et « ce que retient la session ». C’est cette frontière que votre réponse du premier passage déplace : vous voulez graphify des deux côtés — voir la carte D8, qui n’existait pas en révision 1."
        }
      ],
      mechanisms: [
        {
          system: "Hermes",
          fact: "La mémoire est injectée comme un INSTANTANÉ GELÉ au démarrage de session : load_from_disk() ne s’exécute qu’une fois et capture un instantané ; format_for_system_prompt() ne rend que cet instantané. La docstring le dit : « ce n’est PAS l’état vivant, les écritures en cours de session n’affectent pas ceci ». Raison assumée : « cela préserve le cache de préfixe du LLM ». Conséquence directe : une écriture en cours de session est bien persistée sur disque (fichier temporaire puis os.replace) et visible dans la réponse d’outil, mais elle N’ENTRE PAS dans le prompt avant la session suivante.",
          source: "recherche §1 — memory_tool.py, format_for_system_prompt()"
        },
        {
          system: "Hermes",
          fact: 'Le stockage est une liste plate d’entrées en texte brut, sans front-matter ni titres, séparées par le délimiteur littéral "\\n§\\n" ; les doublons sont écartés au chargement. Le modèle voit son propre budget grâce à un compteur affiché dans le prompt système (par exemple « MEMORY … [67% — 1,474/2,200 chars] »). Il n’y a AUCUNE action de lecture ou de liste : le modèle ne voit sa mémoire que par l’injection gelée, et les charges d’erreur contiennent les entrées courantes.',
          source: "recherche §1 — memory_tool.py:16,69,776-783"
        },
        {
          system: "Hermes",
          fact: "L’historique de session est un magasin SÉPARÉ, jamais injecté : state.db avec trois index FTS5 externes en parallèle (unicode61, trigramme hors role=tool, et une extension CJK bigrammes chargeable en C), synchronisés par des triggers. L’outil session_search classe par bm25(), déduplique par lignée de session, DÉCLASSE les lignes venant de cron sous les lignes interactives, rend des fenêtres encadrées de ±5 messages — et retourne un message role: tool ordinaire, PAS une injection dans le prompt système. Aucun appel LLM.",
          source: "recherche §1"
        },
        {
          system: "Hermes",
          fact: "Les modes de défaillance ne sont pas des plantages, c’est de la DÉGRADATION SILENCIEUSE — et c’est l’avertissement le plus transposable de tout le corpus pour l’archétype « fichier curé borné ». Issues vivantes : #56464 (P2) où replace/add ont tronqué MEMORY.md de 28 entrées (~2100 caractères) à 5 (~468) EN RAPPORTANT UN SUCCÈS, 3 fois dans une seule session ; #49200 (P2) où un fournisseur externe en échec retombe silencieusement sur le builtin de 2200 caractères, sans aucun log, non détecté pendant 6 jours et récurrent à chaque reconstruction de conteneur ; #66654 « pollution de mémoire et accumulation périmée… aucun mécanisme de nettoyage », sans horodatage. La proposition #22612 de découper MEMORY.md en index + sous-documents n’est PAS fusionnée : le fichier plat et gelé est bien la conception livrée.",
          source: "recherche §1 / §15.6"
        },
        {
          system: "ctx (ActiveMemory)",
          fact: "ctx agent --budget N est une ALLOCATION SCORÉE, pas une troncature : la constitution passe toujours en entier, les tâches sont plafonnées à 40 % du budget, les conventions à 20 %, et les décisions et apprentissages sont scorés par récence plus pertinence vis-à-vis des tâches actives — corps complet si le score est haut, sinon titre seul dans un débordement « Also Noted ». Les décisions supersédées sont exclues. C’est de la dégradation gracieuse, là où Hermes fait une erreur dure.",
          source: "recherche §10"
        },
        {
          system: "A-MEM / MemoryOS",
          fact: "Les deux mécanismes d’évolution que le corpus offre sont destructifs de façons différentes. A-MEM : après avoir trouvé 5 mémoires voisines, une décision LLM peut renvoyer update_neighbor, qui ÉCRASE SUR PLACE les tags et le contexte de chaque voisin retrouvé (le contenu et les mots-clés, eux, ne sont jamais touchés). MemoryOS : chaleur = 1,0 × visites + 1,0 × interactions + 1 × exp(-Δheures/24), soit une demi-vie d’environ 16,6 h ; à chaleur ≥ 5,0 la page passe en long terme, l’analyse de profil est un REMPLACEMENT complet (merge=False), et les compteurs de visite et d’interaction sont remis à zéro. L’éviction en moyen terme est en LFU, pas sur la chaleur — une asymétrie documentée.",
          source: "recherche §11"
        }
      ],
      unknowns: [
        "Sur les 8 fournisseurs de mémoire externes livrés par Hermes, un seul (Honcho) a été lu de bout en bout. Les 7 autres (byterover, hindsight, holographic, mem0, openviking, retaindb, supermemory) sont NON VÉRIFIÉS au-delà de leur déclaration.",
        "Le corpus ne dit pas si le rappel de graphify est déjà branché sur ce qu’une revue accepte : aucun consommateur ne rejoue le journal de décisions de réconciliation à la reconstruction (voir D12). Si c’est confirmé, « écritures soumises à revue » et « graphe régénéré depuis le corpus » ne sont pas connectés — ce qui change la lecture de cette carte."
      ],
      recommendation: "Trancher d’abord si l’agent doit avant tout SAVOIR (corpus stable interrogeable) ou SE SOUVENIR (ce qui s’est dit et fait en session) — et, au vu des mécanismes ci-dessus, peser un point que la révision 1 masquait : les deux archétypes ne diffèrent pas seulement par ce qu’ils stockent, mais par le moment où l’écriture devient visible (instantané gelé jusqu’à la session suivante chez Hermes, immédiat chez Letta, à la reconstruction chez graphify).",
      nextWork: "Lister les sources déjà disponibles (corpus documentaire graphify, historiques de session existants, adaptateur de conversations) et vérifier lesquelles sont réellement exploitables avant de choisir une couche."
    },
    {
      key: "D2",
      question: "Quelle structure adopter pour le substrat de mémoire ?",
      whyNow: "Une fois la nature de la mémoire choisie (D1), sa structure fixe ce qu’elle peut représenter : relations dans le temps, entités canoniques, similarité sémantique ou simple texte curé. C’est le choix qui verrouille le plus l’outillage en aval (requêtes, MCP, format d’écriture).",
      options: [
        {
          key: "graphe-temporel",
          title: "Graphe typé et bi-temporel",
          behavior: "Entités et relations extraites par LLM dans un graphe avec résolution d’entités et validité bi-temporelle. Chez Graphiti, add_episode enchaîne : validation des types, résolution du group_id, récupération de l’épisode précédent, extraction des nœuds (1 appel LLM), résolution des nœuds extraits (recherche par embedding, puis nom exact, puis MinHash/Jaccard ≥ 0,9, puis repli LLM par lots), extraction des arêtes (1 appel LLM), résolution des arêtes, attributs et résumés, puis UNE seule écriture en masse.",
          consequence: "Réconciliation la plus fidèle du corpus. Le coût réel, dérivé de la lecture du code et documenté NULLE PART ailleurs — pas même dans l’article : environ 2 + 3E + N + 2 appels LLM par épisode, donc LINÉAIRE EN NOMBRE D’ARÊTES, pas en O(1). Il faut aussi un serveur de graphe, et le budget de types est plafonné à 10 types d’entités et 10 types d’arêtes, ≤ 10 champs chacun."
        },
        {
          key: "graphe-ontologique-corpus",
          title: "Graphe ontologique de corpus",
          behavior: "Un pipeline batch transforme un corpus en graphe typé dédupliqué avec entités canoniques. graphify : JSON graphology avec citations, evidence_refs, confidence_handle, provenance_handle et un cycle de vie de revue à 9 états ; déjà uni-temporel (t, t_end, t_iso, t_src) avec recall --as-of. cognee : l’ontologie n’est PAS une contrainte de prompt mais un ancrage POST-extraction — l’extraction tourne d’abord sans contrainte, le LLM ne voit jamais les classes de l’ontologie dans le chemin par défaut, puis un résolveur apparie par chaîne floue (difflib, cutoff 0,8) et renomme vers le nom canonique.",
          consequence: "Structure la plus auditable et token-efficiente pour un savoir stable. Mais elle est pensée pour un corpus construit par lots, et sa temporalité est à UN seul axe : elle sait « quand le fait valait », pas « quand nous l’avons appris ». Ajouter le second axe est la question de la carte D9."
        },
        {
          key: "vecteurs-auto-extraits",
          title: "Vecteurs sémantiques auto-extraits",
          behavior: "Un LLM extrait des faits, les embed et les indexe pour un rappel par similarité — mem0 (Qdrant/pgvector/Chroma/LanceDB pluggables), LangMem (Postgres+pgvector), LanceDB embarqué. À noter côté LangGraph : le SummarizationNode n’écrit explicitement PAS dans le magasin long terme ; le vrai chemin d’écriture de LangMem est ReflectionExecutor, une tâche de fond débouncée après une pause de conversation.",
          consequence: "Écosystème large et léger à héberger, mais le rappel peut manquer sa cible (similarité ≠ pertinence) et la structure relationnelle entre faits est perdue."
        },
        {
          key: "fichiers-cures-sans-embeddings",
          title: "Fichiers curés, sans embeddings",
          behavior: "La mémoire vit en fichiers texte explicitement écrits, sans vecteurs ni index. ctx lit .context/ dans un ordre de priorité fixe (CONSTITUTION.md, TASKS.md, CONVENTIONS.md, ARCHITECTURE.md, DECISIONS.md, LEARNINGS.md, GLOSSARY.md, AGENT_PLAYBOOK.md) et sert un paquet de contexte par allocation scorée sous budget. L’outil memory d’Anthropic expose un dossier virtuel /memories dont VOUS possédez les octets.",
          consequence: "Portabilité et transparence maximales, RAM minimale, aucun rappel sémantique. Le risque n’est pas technique mais humain : c’est l’archétype où la dégradation est la plus silencieuse (voir les issues de troncature et d’accumulation périmée de Hermes, carte D1)."
        },
        {
          key: "memoire-hierarchique-auto-editee",
          title: "Mémoire hiérarchique auto-éditée",
          behavior: "Un petit bloc toujours en contexte que l’agent édite lui-même, avec débordement vers un stockage archivé. Letta rend ses blocs en XML en exposant au modèle son propre budget (chars_current / chars_limit), et offre une famille d’outils d’édition de plus en plus précise : core_memory_append/replace historiques, puis memory_replace (appariement unique, refuse les chaînes préfixées d’un numéro de ligne), memory_insert, memory_rethink, jusqu’à memory_apply_patch, un diff unifié à la Codex appliqué côté serveur.",
          consequence: "L’état saillant est toujours disponible. Mais chez Letta le champ limit semble PUREMENT INDICATIF — aucune application n’a été trouvée dans le chemin d’écriture : update_block_value() ne vérifie que le type, et la docstring de la mise à jour en masse PRÉTEND lever au-delà de la limite alors que l’implémentation est une simple affectation. C’est l’exact inverse de Hermes, qui échoue en fermeture."
        }
      ],
      mechanisms: [
        {
          system: "Graphiti",
          fact: "Les quatre horodatages, conformes mot pour mot à l’article §2.2.3 : created_at (temps de transaction, posé à la construction) ; valid_at (temps d’événement, produit surtout par le LLM d’extraction, avec pour repli un appel à un petit modèle dédié qui ne se déclenche que si valid_at ET invalid_at sont nuls) ; invalid_at (temps d’événement, mêmes chemins, ET posé par la résolution de contradiction à la valid_at du fait contredisant) ; expired_at (temps de transaction, utc_now() au moment où le système a APPRIS que c’était faux — il peut retarder arbitrairement sur invalid_at).",
          source: "recherche §3 — graphiti.py:980-1230, resolve_edge_contradictions():569"
        },
        {
          system: "Graphiti",
          fact: "Le fichier prompts/invalidate_edges.py N’EXISTE PLUS : déduplication et contradiction sont fusionnées dans un seul prompt, resolve_edge, qui renvoie duplicate_facts et contradicted_facts — un même fait peut figurer dans les deux listes.",
          source: "recherche §3 — prompts/dedupe_edges.py"
        },
        {
          system: "Graphiti",
          fact: "L’ontologie et la bi-temporalité COEXISTENT réellement ici, et c’est le seul endroit du corpus où c’est le cas : entity_types, edge_types et edge_type_map sont injectés dans le prompt d’extraction et validés par modèle Pydantic, sur la MÊME EntityEdge qui porte les quatre horodatages.",
          source: "recherche §3 / §13"
        },
        {
          system: "graphify",
          fact: "La sémantique d’intervalle se contredit DÉJÀ aujourd’hui, sur un seul axe : la spécification écrit un intervalle fermé [t, t_end] alors que le rendeur de scène le traite en demi-ouvert [t, t_end) — soit une erreur d’un cran systématique aux bornes de bucket. Un second axe temporel multiplierait cette incohérence par quatre.",
          source: "recherche §13 — SPEC_AGENTSTATS_TIMEORIENTED.md:42 vs src/studio-scene.ts:32-34"
        },
        {
          system: "Letta",
          fact: "Le champ limit des blocs semble PUREMENT INDICATIF : aucune application n’a été trouvée dans le chemin d’écriture — update_block_value() ne vérifie que le type, le validateur Pydantic ne retire que les octets nuls, et la docstring de bulk_update_block_values_async PRÉTEND lever au-delà de la limite alors que l’implémentation est une simple affectation. À prendre avec la réserve qui va avec : c’est une conclusion de LECTURE DE CODE, non documentée, donc non vérifiée en source primaire — mais si elle tient, c’est l’exact inverse de Hermes, qui échoue en fermeture.",
          source: "recherche §2 — schemas/block.py, Memory.update_block_value()",
          status: "unverified"
        },
        {
          system: "cognee",
          fact: "La temporalité est native mais NON bi-temporelle : Timestamp, Interval(starts_at, ends_at) et Event forment des intervalles d’événement sur une seule ligne de temps — pas de temps de transaction, pas d’invalidation pilotée par contradiction. Le trio de stockage est SQLite + LanceDB + Ladybug, et Ladybug vient tout juste d’atterrir : le mainteneur écrit lui-même qu’il est « plus simple pour l’instant d’utiliser Kuzu en expérimentation locale » — à épingler en version.",
          source: "recherche §12 — issue #2098"
        }
      ],
      unknowns: [
        "La latence d’ingestion par épisode de Graphiti est GÉNUINEMENT non documentée, partout. La latence publiée (article, table 2 : 3,20 s contre 31,3 s en contexte complet) concerne la RÉCUPÉRATION, pas l’écriture.",
        "Aucun exemple de documentation ne montre une arête typée personnalisée ET ses valid_at/invalid_at ensemble : la coexistence est établie par lecture du code, pas par un échantillon officiel. NON VÉRIFIÉ.",
        "La syntaxe littérale d’une requête ponctuelle chez Graphiti est NON VÉRIFIÉE : la forme WHERE e.valid_at <= $t AND (e.invalid_at IS NULL OR e.invalid_at > $t) est déduite du schéma, pas citée."
      ],
      recommendation: "Peser le besoin de structure relationnelle et de temporalité contre le coût d’opération, en tenant compte d’un chiffre que la révision 1 n’avait pas : la structure la plus fidèle coûte un nombre d’appels LLM linéaire en nombre d’arêtes par épisode, et ce coût n’est écrit nulle part dans sa documentation.",
      nextWork: "Prototyper un rappel sur un échantillon réel de requêtes de l’agent pour chaque structure candidate et comparer précision, latence et RAM — et, avant tout arbitrage temporel, lever l’incohérence d’intervalle fermé/demi-ouvert déjà présente dans graphify."
    },
    {
      key: "D3",
      question: "Qui décide qu’un fait entre en mémoire : une extraction automatique ou une écriture curée et revue ?",
      whyNow: "Multi-session, multi-CLI signifie que plusieurs agents écriront dans la même mémoire sans supervision continue de l’opérateur — il faut décider avant tout déploiement si chaque écriture doit être explicite ou relue, ou si un extracteur automatique peut agir seul. Deux publications récentes rendent la question plus dure qu’elle n’en avait l’air : voir les mécanismes.",
      options: [
        {
          key: "auto-extraction",
          title: "Extraction automatique par le LLM",
          behavior: "Un extracteur LLM décide seul quoi retenir et écrit à chaque tour ou épisode — mem0 (routeur ADD/UPDATE/DELETE/NOOP), Graphiti (add_episode), Letta (auto plus auto-édition). Chez Letta le déclencheur du travail de fond est un compteur de tours persisté modulo N : on incrémente, puis on tire quand le reste est nul.",
          consequence: "Couverture large sans effort opérateur, mais chaque écriture dépend du jugement du modèle. Deux résultats de 2026 chiffrent ce risque, et le second porte précisément sur une boucle autonome — voir les mécanismes de cette carte."
        },
        {
          key: "ecriture-gatee",
          title: "Extraction automatique avec porte d’approbation",
          behavior: "Le LLM propose une écriture, une validation peut la bloquer avant qu’elle n’entre dans le substrat. Chez Hermes, memory.write_approval est à false PAR DÉFAUT ; activée, elle approuve en ligne au premier plan mais MET EN ATTENTE tout le reste — messagerie, cron, scripts, relecteur de fond — dans pending/memory/<id>.json, géré par /memory pending | approve | reject. Les skills mettent TOUJOURS en attente. Les écritures automatiques sont étiquetées [auto].",
          consequence: "Conserve la couverture automatique tout en ouvrant un point de contrôle. Deux propriétés de la seule implémentation vraiment livrée méritent d’être vues avant de s’en inspirer : il n’existe AUCUN état « refuser d’emblée » — la porte ne fait que RETARDER ; et elle est désactivée par défaut."
        },
        {
          key: "curee-revue",
          title: "Écriture explicite et curée",
          behavior: "Seules des commandes explicites déposent un fait, avec revue humaine possible. graphify offre la surface de revue la plus solide du corpus : file de candidats, validate_ontology_patch puis apply_ontology_patch, dry-run par défaut, journal de décisions autoritaire plus un audit JSONL, cycle de vie à 9 états, chemin mis en prison, et une exposition MCP derrière un drapeau d’écriture explicite. La file est estampillée graph_hash, profile_hash et generated_at pour que la péremption soit détectable.",
          consequence: "Précision et auditabilité maximales, aucune dérive silencieuse, mais couverture partielle. Et une propriété de conception à connaître : ce cycle de vie a été bâti pour des candidats par LOTS ; la capture continue inverse le rapport — c’est l’objet de la carte D11."
        }
      ],
      mechanisms: [
        {
          system: "GovMem (arXiv:2607.02579)",
          fact: "Des observations répétées à travers plusieurs agents peuvent refléter une SOURCE COMMUNE — même prompt, même information périmée — et non des preuves indépendantes. GovMem estime un support tenant compte de cette dépendance et va chercher des contre-preuves, pour promouvoir, rejeter ou SIGNALER POUR REVUE ; la fausse promotion synthétique tombe de 0,597 à 0,040. Mais sur une évaluation externe de traces réelles d’agents de code, la conclusion est frontale : « aucune n’est sûre pour une promotion automatique » — chaque cas positif à la vérification était un artefact ou non réutilisable. Leur propre conclusion est que le signalement pour revue domine, et qu’un chemin de promotion entièrement automatique n’est pas fiable aujourd’hui.",
          source: "recherche §7"
        },
        {
          system: "MissClaw (arXiv:2603.23064)",
          fact: "Un chemin Exposition → Mémoire → Comportement par lequel du contenu non fiable rencontré pendant une exécution EN ARRIÈRE-PLAN entre silencieusement en mémoire longue et façonne le comportement ultérieur face à l’utilisateur, SANS AUCUNE injection de prompt. Les signaux de crédibilité sociale poussent l’influence jusqu’à 61 %, et la sauvegarde de mémoire ROUTINIÈRE promeut la pollution en mémoire permanente à des taux allant jusqu’à 91 %, persistants d’une session à l’autre. Cela porte directement sur une boucle h2a autonome.",
          source: "recherche §7"
        },
        {
          system: "Le corpus entier",
          fact: "Toutes les portes réellement implémentées sont BINAIRES (en attente contre approuvée). Celle de Zep est graduée mais laisse la combinaison à l’application. AUCUN système étudié n’implémente un poids de confiance continu qui DÉPRÉCIERAIT au lieu d’EXCLURE une mémoire non approuvée à la lecture : « l’agent lit les faits en attente à un poids moindre » n’a aucun précédent livré.",
          source: "recherche §7 / §14.5"
        },
        {
          system: "ChatGPT / Copilot",
          fact: "Deux surfaces souvent citées comme des portes n’en sont pas : « Manage memories » de ChatGPT est une curation RÉTROSPECTIVE, pas une porte avant écriture ; et Copilot valide par LLM à la LECTURE, avec citations, pas par approbation humaine à l’écriture. Chez mem0, cognee, LangMem et l’outil memory d’Anthropic, aucune porte n’a été trouvée — celle d’Anthropic étant côté client, un développeur POURRAIT en poser une.",
          source: "recherche §7"
        },
        {
          system: "SCICERO",
          fact: "La réponse de la littérature à un arriéré de revue n’est pas de relire plus vite, c’est de RÉDUIRE LA SURFACE à relire : l’extension de validation de graphe de connaissances rapporte jusqu’à 80 % de précision et 82 % de F1 gagnés « avec un effort manuel minimal », en n’invoquant la revue humaine QUE sur désaccord entre validateurs automatiques.",
          source: "recherche §7"
        }
      ],
      unknowns: [
        "La boucle propose-puis-approuve de Cursor Memories n’est NON VÉRIFIÉE en source primaire : elle vient d’un forum et de sources secondaires.",
        "La surface de revue de mem0 est NON VÉRIFIÉE : aucune porte trouvée, ce qui est une absence de preuve et non une preuve d’absence."
      ],
      recommendation: "Arbitrer entre couverture et précision en intégrant un fait nouveau : la seule évaluation sur traces réelles d’agents de code du corpus conclut qu’aucun cas n’était sûr en promotion automatique, et le seul travail portant sur l’exécution en arrière-plan mesure jusqu’à 91 % de pollution promue par une sauvegarde de mémoire routinière. Si un compromis « gated » est retenu, définir qui tient la porte — et se souvenir que la seule porte livrée du corpus ne fait que retarder, jamais refuser.",
      nextWork: "Définir, pour l’option retenue, le format exact d’une écriture (fait, provenance, horodatage, base d’assertion) et qui peut la produire."
    },
    {
      key: "D4",
      question: "Comment le substrat doit-il réconcilier des faits contradictoires ou redondants ?",
      whyNow: "Une mémoire partagée entre plusieurs sessions et outils va inévitablement recevoir des faits contradictoires. Sans règle de réconciliation choisie à l’avance, ces conflits s’accumulent silencieusement dès le premier déploiement multi-session.",
      options: [
        {
          key: "bi-temporelle",
          title: "Réconciliation bi-temporelle",
          behavior: "Chaque fait porte une validité temporelle et une contradiction invalide l’ancien sans le supprimer. Le mécanisme exact, chez Graphiti : on vérifie D’ABORD le recouvrement temporel — si les fenêtres ne se recouvrent pas, on passe — puis on MUTE L’ARÊTE EXISTANTE SUR PLACE, invalid_at = valid_at du nouveau fait et expired_at = utc_now(). L’ancienne arête n’est JAMAIS supprimée. Un garde-fou symétrique traite l’ingestion désordonnée : si un candidat plus ancien a une valid_at PLUS RÉCENTE, c’est la NOUVELLE arête qui est immédiatement expirée.",
          consequence: "Permet de répondre « que savait-on à la date T » et de tracer les changements d’avis, au prix d’un coût d’appels LLM linéaire en nombre d’arêtes par épisode et d’un graphe à opérer. Et l’hallucination d’attributs est réelle : des garde-fous ont été livrés APRÈS que jusqu’à 9 Ko de méta-raisonnement de LLM ont atterri dans des champs d’attributs d’entité."
        },
        {
          key: "derniere-valeur-dedup",
          title: "Dernière valeur + déduplication",
          behavior: "Un routeur ou l’agent décide ADD/UPDATE/DELETE/NOOP par similarité ; la valeur la plus récente remplace l’ancienne sans historique temporel — mem0 (routeur explicite, expiration par mémoire), Letta (auto-édition et consolidation en temps de sommeil, sans temporalité). Il faut corriger ici la révision 1 : Letta ne perd PAS l’historique — il tient une table BlockHistory avec numéros de séquence et undo/redo.",
          consequence: "Résout le doublon et le désaccord le plus courant à faible coût, mais perd la trace de ce qui a changé et quand, sauf là où un historique explicite existe."
        },
        {
          key: "aucune",
          title: "Aucune réconciliation",
          behavior: "Chaque écriture s’ajoute sans fusion ni détection de conflit — RAG vectoriel brut (pgvector/Chroma/LanceDB/txtai), fichiers curés tant que l’humain ne les édite pas. À signaler comme astuce transposable : cognee obtient une convergence sans coordination par des identifiants DÉTERMINISTES (id_for() sur des identity_fields), donc une écriture répétée fusionne par identité au lieu de dupliquer.",
          consequence: "Substrat le plus simple à opérer, mais les faits contradictoires coexistent silencieusement et la précision du rappel se dégrade avec le volume."
        }
      ],
      mechanisms: [
        {
          system: "graphify",
          fact: "Le point décisif pour votre réponse « on repose au maximum sur graphify pour cela » : graphify fait de la réconciliation d’IDENTITÉ (deux nœuds désignent-ils la même entité ?), pas de la réconciliation d’ASSERTION (ce fait contredit-il celui-là ?). Ce sont deux algorithmes différents. graphify a le vocabulaire (superseded, previous_status) et un point d’accroche naturel (une opération de patch de type supersede_relation), mais le DÉTECTEUR est un travail neuf — et c’est justement la partie chère de Graphiti.",
          source: "recherche §13"
        },
        {
          system: "Graphiti",
          fact: "La concurrence n’est pas résolue : SEMAPHORE_LIMIT = 20 borne le parallélisme À L’INTÉRIEUR d’un appel, et la docstring avertit que « chaque épisode est ajouté séquentiellement et attendu ». Le bug ouvert #1331 est plus grave : deux add_episode concurrents sur des group_id DIFFÉRENTS depuis une même instance courent sur self.driver = self.driver.clone(database=group_id) — le dernier écrivain gagne et les écritures de l’autre tâche atterrissent DANS LE MAUVAIS GRAPHE. Contamination inter-locataires, non corrigé.",
          source: "recherche §3 — issue #1331"
        },
        {
          system: "Graphiti",
          fact: "Les petits modèles ou modèles locaux « émettent fréquemment du JSON qui ne correspond pas au schéma », et l’issue #1171 signale des entités désignées par pronom manquées d’un message à l’autre. Le dimensionnement des modèles est explicite dans le code (ModelSize.small pour la déduplication, les attributs et les horodatages).",
          source: "recherche §3"
        }
      ],
      unknowns: [
        "Il n’existe aucun adaptateur cognee ↔ Graphiti maintenu : le POC de blog enveloppe des nœuds Graphiti dans un objet Pydantic lié à un commit précis et à un notebook, présenté comme une démonstration d’extensibilité. C’est une absence de preuve, marquée NON VÉRIFIÉE."
      ],
      recommendation: "Décider si répondre à « que savait l’agent à la date T, et pourquoi a-t-il changé d’avis » a de la valeur ici — et, si la réponse est oui et que le substrat retenu est graphify, mesurer que ce qui manque n’est pas le champ temporel (il est presque gratuit) mais le DÉTECTEUR de contradiction, qui est un algorithme différent de celui que graphify possède.",
      nextWork: "Construire 3 à 5 scénarios de contradiction réels (changement de préférence, correction d’un fait) et vérifier comment chaque stratégie les traite, en distinguant explicitement réconciliation d’identité et réconciliation d’assertion."
    },
    {
      key: "D5",
      question: "Où héberger la mémoire sous la contrainte RAM/OOM : embarqué local, serveur+base de données, ou SaaS ?",
      whyNow: "La contrainte RAM/OOM est déjà vécue ailleurs dans ce projet. Aucun système du benchmark ne publie de chiffres RAM : le budget disponible doit être fixé et mesuré avant, pas après, avoir committé une architecture serveur+DB. Cette révision apporte enfin UNE mesure, prise localement — voir les mécanismes.",
      options: [
        {
          key: "embarque-local",
          title: "Embarqué, local-first",
          behavior: "Bibliothèque intégrée au process de l’agent, sans serveur séparé — cognee en mode par défaut, LanceDB (fichier disque, gère des jeux plus grands que la RAM), mem0 en mode librairie, ctx (fichiers), graphify (JSON local), txtai.",
          consequence: "Empreinte la plus faible et déploiement le plus simple. Mais la mesure prise sur ce poste donne le plancher réel du modèle actuel de graphify : lecture 95 ms, parsing 161 ms, sérialisation 246 ms, écriture 118 ms, soit environ 620 ms à 267 Mo de tas et 373 Mo de RSS pour UN aller-retour de graphe complet, AVANT toute extraction. Au vu de l’historique d’OOM de cet espace de travail, une écriture par tour est une décision de gouvernance des ressources, pas un détail."
        },
        {
          key: "serveur-plus-bd",
          title: "Serveur applicatif + base de données",
          behavior: "Un serveur dédié porte la mémoire, les sessions s’y connectent en client — Letta (serveur + Postgres/pgvector), Zep/Graphiti (Neo4j ou FalkorDB), mem0 en mode serveur. Côté graphify, le port GraphStore expose déjà quatre implémentations : file, neo4j, spanner, postgres.",
          consequence: "State partagé nativement entre process et sessions. Mais la disparité de capacités entre backends n’est pas cosmétique : queryWindow — le chemin de LECTURE de recall --as-of, donc de tout ce qui est temporel — n’existe QUE sur postgres. Choisir neo4j pour le web, c’est perdre la lecture temporelle à la couche de stockage."
        },
        {
          key: "saas",
          title: "SaaS géré par le fournisseur",
          behavior: "Le fournisseur héberge et gère la mémoire, l’agent n’opère aucune infrastructure — mémoire ChatGPT d’OpenAI, Devin Knowledge/DeepWiki.",
          consequence: "Zéro opération, mais exclu par l’exigence local-first/self-hostable de ce projet — non portable, lié à un compte ou un vendeur ; cité ici seulement comme référence de contraste."
        }
      ],
      mechanisms: [
        {
          system: "graphify — le port GraphStore",
          fact: "Le point qui compte pour votre réponse (« graphify embarque un backend db et pourrait être configuré pour l’usage d’une tierce db, surtout lorsque h2a devient intégré à sentropic, version web ») : il n’y a AUCUN insert, update ou delete par élément sur le port. La seule écriture est pushGraph d’une instance graphology COMPLÈTE, avec un mode replace ou merge — et replace est le défaut de la CLI. Le magasin est donc un MIROIR AVAL, pas un backend co-égal : le fichier reste la source de vérité. Si une interface web sentropic doit ÉCRIRE — un relecteur qui approuve — cette écriture n’a nulle part où atterrir dans le port actuel. Ajouter un upsert est le vrai poste de travail, et c’est LE MÊME que celui de la carte D8.",
          source: "recherche §8 — src/storage/types.ts:203-260"
        },
        {
          system: "graphify — les agrégats",
          fact: "aggregate et window sont « scopés au dernier instantané REPLACE ». En capture vivante, cela signifie soit re-pousser le graphe à chaque capture pour re-dériver les agrégats, soit accepter un retard — détectable via readSnapshotMeta() et topology_signature, mais structurel.",
          source: "recherche §8"
        },
        {
          system: "graphify — l’échelle actuelle",
          fact: "Mesuré localement en v0.17.2 : 8 919 nœuds, 81 260 liens, 54 039 561 octets — et .graphify/graph.json EST suivi par git (le .gitignore le dé-ignore explicitement). En revanche .graphify/memory/, l’unique puits de mémoire autorisée actuel, EST ignoré par git : il ne voyage pas, ne fusionne pas, et reste invisible au pilote de fusion.",
          source: "recherche §4 — .gitignore:22-25 et :35"
        }
      ],
      recommendation: "Fixer le budget RAM réellement tolérable avant de choisir — et intégrer deux faits de mécanisme que la révision 1 n’avait pas : le plancher d’écriture actuel est d’environ 620 ms et 373 Mo de RSS par aller-retour de graphe complet, et le port de stockage n’offre aucune écriture par élément, donc « configurer une tierce base » donne un miroir en lecture, pas une mémoire dans laquelle une interface web pourrait écrire.",
      nextWork: "Mesurer la RAM au repos et sous charge d’au moins un candidat embarqué et un candidat serveur sur le poste cible, et décider si le port GraphStore doit gagner une écriture par élément avant, et non après, l’intégration web."
    },
    {
      key: "D6",
      question: "Comment gérer les écritures concurrentes entre plusieurs sessions CLI (claude/codex/gemini/hermes) sur la même mémoire ?",
      whyNow: "La mémoire doit être « une, partagée » entre claude/codex/gemini/hermes. Si deux sessions écrivent le même fait au même moment sans règle choisie, le comportement par défaut de la plupart des systèmes peut effacer silencieusement une écriture légitime. Cette révision a lu le pilote de fusion de graphify de près, et ce qu’il fait n’est pas ce que « git gère la concurrence » laisse croire.",
      options: [
        {
          key: "crdt-append-log",
          title: "Écritures concurrentes sûres (CRDT / append-log)",
          behavior: "Le substrat garantit qu’écrire depuis plusieurs CLI en parallèle converge sans perte, via un journal append-only ou une structure CRDT.",
          consequence: "Seule option qui protège nativement contre un dernier-écrivain-gagnant silencieux. Correction à la révision 1 : ce n’est pas « personne ne le fait » — ctx a été vérifié et n’utilise PAS de CRDT (git ordinaire sur du Markdown ordinaire), tandis que Letta livre bien un verrouillage optimiste avec historique. La façon dont on migrerait vers là est devenue une carte à part : D12."
        },
        {
          key: "namespace-single-writer",
          title: "Espace de noms + un seul écrivain actif, lecture multiple",
          behavior: "Chaque session écrit sous son propre identifiant (group_id, user_id, run_id) et les autres lisent ; la coordination d’écriture reste implicite — mem0 par identifiant, Zep/Graphiti par group_id, Letta par block_id.",
          consequence: "Mode réellement supporté aujourd’hui par la quasi-totalité des systèmes. Mais l’isolation par espace de noms n’est pas une garantie : chez Graphiti, deux add_episode concurrents sur des group_id différents depuis une même instance font atterrir les écritures d’une tâche DANS LE GRAPHE DE L’AUTRE (bug ouvert #1331)."
        },
        {
          key: "arbitre-unique",
          title: "Un arbitre d’écriture unique, les autres sessions proposent",
          behavior: "Une seule session ou un service désigné détient le droit d’écrire ; les autres envoient leurs propositions à cet arbitre plutôt que d’écrire directement.",
          consequence: "Supprime la collision par construction, mais introduit un point de contention et de panne unique, et une latence d’aller-retour à chaque écriture émise par une session non-arbitre."
        }
      ],
      mechanisms: [
        {
          system: "graphify — le pilote de fusion",
          fact: "C’est une UNION 2-VOIES À CROISSANCE SEULE, pas une fusion 3-voies : l’ancêtre est bien lu, mais uniquement dans un garde-fou — la fusion porte sur [courant, autre]. Conséquence structurelle : LES SUPPRESSIONS NE SE PROPAGENT PAS. Un nœud supprimé sur une branche est RESSUSCITÉ par l’autre (le cas d’école du G-Set, ou d’un 2P-Set sans pierres tombales). Donc « git gère la concurrence » est vrai pour les ajouts et FAUX pour les retraits : une mémoire corrigée ou oubliée sur une branche revient par l’autre.",
          source: "recherche §5 — src/merge-driver.ts"
        },
        {
          system: "graphify — le pilote de fusion",
          fact: "Deux politiques de conflit COHABITENT dans le même fichier : les attributs scalaires de nœuds sont en dernier-écrivain-gagnant avec « theirs » qui gagne (l’ordre de boucle est [courant, autre] et le mergeNode de graphology est un LWW peu profond), tandis que les ARÊTES sont en premier-écrivain-gagnant (« garder la première arête compatible »). Aucune des deux n’est ce qu’on veut pour une correction de mémoire. Les citations sont l’exception délibérée : unionées par identité avec citation_count = max(existant, entrant, taille de l’union).",
          source: "recherche §5"
        },
        {
          system: "graphify — les plafonds",
          fact: "MERGE_MAX_GRAPH_BYTES vaut 52 428 800 octets (50 Mio) et la limite de nœuds 100 000 — or le graph.json suivi par git de ce dépôt pèse 54 039 561 octets. LE PILOTE DE FUSION LÈVERAIT DONC AUJOURD’HUI SUR LE GRAPHE COMMITTÉ DE GRAPHIFY LUI-MÊME. La capture vivante ne peut que le faire grossir.",
          source: "recherche §5 / §15.1"
        },
        {
          system: "Le corpus",
          fact: "Ce que chacun fait vraiment : Hermes = verrou de fichier OS, écriture atomique et détection de dérive (_detect_external_drift() refuse l’écriture et sauvegarde un .bak si le contenu sur disque ne fait pas l’aller-retour du parseur §) — et #56464 a QUAND MÊME perdu des données, dans une seule session, donc pas par concurrence. Letta = verrouillage optimiste plus BlockHistory, le plus solide. Graphiti = pas de verrou, guidage séquentiel, course inter-locataires ouverte. cognee = identifiants déterministes, donc fusion idempotente par identité. ctx = git ordinaire, sans CRDT ni pilote de fusion.",
          source: "recherche §9"
        }
      ],
      recommendation: "Évaluer combien de sessions écriront réellement en parallèle sur le même fait — mais l’arbitrage n’est plus seulement une question de fréquence : la sémantique de fusion actuelle est déjà PLUS FAIBLE qu’un CRDT (aveugle aux suppressions, deux politiques de conflit), donc y aller plus tard voudra dire défaire, pas ajouter. Et le plafond du pilote est déjà dépassé par le graphe committé.",
      nextWork: "Recenser les CLI qui écriront simultanément, estimer la fréquence de collision réelle, et trancher séparément le sort du plafond de 50 Mio du pilote de fusion, déjà franchi aujourd’hui."
    },
    {
      key: "D7",
      question: "Quel projet exact recouvre le nom « ctx » cité comme référence ?",
      whyNow: "Au moins six projets partagent ce nom avec des mécanismes voisins et des surfaces différentes. Cette révision a cloné et interrogé le candidat retenu, ce qui corrige deux affirmations de la révision 1 et ajoute des chiffres de maturité.",
      options: [
        {
          key: "activememory-ctx",
          title: "ActiveMemory/ctx (Go)",
          behavior: "Binaire Go unique, local-first, fichiers dans .context/ à côté de .git/, sans embeddings, écritures explicites ; l’agent tire un paquet de contexte par allocation SCORÉE sous budget (ctx agent --budget N) et non par troncature. Correction à la révision 1 : il expose un MCP étendu — ctx mcp en stdio, ctx setup qui génère les configs par outil, ctx steering sync qui pousse les règles dans Claude Code/Cursor/Kiro/Cline, un plugin avec hooks PreToolUse/PostToolUse/UserPromptSubmit et .claude/skills/, ctx loop qui génère un script de boucle autonome, ctx watch qui applique les balises <context-update>. Apache-2.0 et CC-BY-4.0, DCO.",
          consequence: "Le plus proche d’un outil git-natif, léger et versionné, et il est bien intégrable en MCP — la révision 1 disait le contraire. La réserve est ailleurs : créé le 20/01/2026, dernier push le 23/07/2026, 1 408 commits, 71 étoiles, 14 forks, 8 issues ouvertes, 11 contributeurs mais TRÈS majoritairement une seule identité — facteur de bus ≈ 1. Étiquettes v0.1.0 à v0.8.0, mais dernière version étiquetée le 24/03/2026 alors que main continue d’avancer sans étiquette : « installer une release » n’est pas « installer main »."
        },
        {
          key: "context-llemur",
          title: "context-llemur (Python, aussi nommé « ctx »)",
          behavior: "Un dossier ctx est lui-même un dépôt git, sans embeddings, expose un serveur MCP et une CLI (ctx save/load/explore/integrate/switch) pensés pour partager le contexte entre plateformes LLM. MIT.",
          consequence: "S’intègre nativement en MCP à plusieurs CLI, mais projet plus jeune et plus petit, à valider en profondeur avant d’en dépendre — et la présence d’un MCP n’est plus un facteur différenciant, puisque le candidat Go en a un aussi."
        },
        {
          key: "autre-projet-nomme-ctx",
          title: "Un autre projet nommé « ctx » (à confirmer)",
          behavior: "D’autres projets partagent ce nom sans forcément correspondre au besoin — ctxrs/ctx (Rust, indexe des logs d’agents existants vers SQLite, rappel en lecture seule, 953 étoiles), context-hub/generator (PHP, générateur de doc de code plus MCP).",
          consequence: "L’ambiguïté est réelle (6 projets recensés) — il faut faire confirmer lequel était visé avant d’investir. Le même piège existe pour graphify : une recherche web publique sur « graphify » fait remonter Graphify-Labs/graphify, qui n’est PAS ce dépôt."
        }
      ],
      mechanisms: [
        {
          system: "ctx (ActiveMemory)",
          fact: "La thèse de ctx est celle qui donne le plus de poids à votre instinct sur D3 : « l’humain dans la boucle pour la mémoire » figure parmi les six patrons que 17 systèmes indépendants ont, selon elle, découverts séparément. C’est un argument épistémique, pas un mécanisme — mais il situe une porte de revue comme courante, pas idiosyncrasique.",
          source: "recherche §7 / §10"
        }
      ],
      recommendation: "Confirmer lequel des projets nommés « ctx » était visé, en pesant maintenant la maturité plutôt que la surface : les deux candidats exposent un MCP, et l’écart réel est un facteur de bus proche de 1 et une dernière version étiquetée en mars 2026 alors que main avance encore.",
      nextWork: "Faire confirmer le projet visé, puis décider si l’on dépend d’une étiquette de version ou de main, au vu du facteur de bus."
    },
    {
      key: "D8",
      addedInRevision: "agent-memory-2026-07-25",
      parent: ["D1", "D4"],
      fromAnswer: "Zep/Graphiti ressemble a ce qu’on fait avec graphify. on pourrait donc utiliser a la fois graphify pour la mémoire d’archive et la capture vivante. (D1) — on repose a maxima sur graphify pour cela (évolution bi temporelle a co-design). (D4)",
      question: "Jusqu’où graphify porte-t-il À LA FOIS la mémoire d’archive et la capture vivante — et qu’est-ce que cela exige concrètement ?",
      whyNow: "Votre réponse ne choisit pas un archétype de la liste : elle demande une COMPOSITION que le benchmark ne contient pas. Elle est défendable — graphify est effectivement plus proche de la cible que la révision 1 ne le disait. Mais cinq mécanismes précis manquent aujourd’hui, et aucun n’est un détail d’effort : ce sont des propriétés absentes, y compris du port de stockage. Les nommer maintenant est moins coûteux que de les découvrir en implémentant.",
      options: [
        {
          key: "graphify-substrat-unique",
          title: "Un seul substrat : graphify devient aussi le puits vivant",
          behavior: "graphify reçoit ce qui lui manque pour être écrit au fil de l’eau : une écriture par élément (aujourd’hui inexistante), un déclencheur au niveau du tour, une politique d’éviction ou de saillance, une classe d’exception documentée pour une assertion sans localisateur de corpus, et un verrou d’écriture.",
          consequence: "Un seul magasin, une seule surface de requête, un seul cycle de vie de revue, une seule chose à sauvegarder. En contrepartie, les cinq mécanismes ci-dessus sont à construire, et l’un d’eux touche l’invariant qui rend graphify digne de confiance : une assertion conversationnelle n’a pas de source_file:page, donc l’invariant de citation devrait gagner une exception explicite — ou les tours devraient devenir des documents de corpus citables."
        },
        {
          key: "deux-couches-un-graphe",
          title: "Deux couches, une promotion sur revue",
          behavior: "graphify reste l’archive (batch, adossée aux citations, déclenchée par git) ; une couche de capture distincte tient les assertions conversationnelles et n’est projetée dans graphify qu’à la promotion, après revue.",
          consequence: "Préserve l’invariant de citation intact et garde l’aller-retour de graphe complet — environ 620 ms et 373 Mo de RSS — hors du chemin par tour. Mais cela fait deux magasins à opérer et une frontière de promotion à définir : exactement la « frontière claire » que l’option hybride de D1 réclamait déjà, sauf qu’ici elle devient un mécanisme, pas une intention."
        },
        {
          key: "capture-hors-graphify",
          title: "La capture vivante hors de graphify",
          behavior: "La capture vit dans un système de mémoire vivante déjà outillé pour ça (routeur mem0, blocs Letta, fichier borné à la Hermes) et graphify n’est jamais un puits vivant.",
          consequence: "On obtient gratuitement un chemin d’écriture éprouvé, une éviction et une écriture par fait. Mais on abandonne l’objectif du substrat unique et, pour la mémoire vivante, le cycle de vie citations plus revue — et on ajoute un second modèle de réconciliation à opérer."
        }
      ],
      mechanisms: [
        {
          system: "graphify — l’écriture",
          fact: "IL N’EXISTE AUCUN UPSERT PAR ÉLÉMENT, nulle part : ni dans le chemin fichier, ni sur le port GraphStore, dont la seule écriture est pushGraph d’un graphe complet. Tout ce qui écrit aujourd’hui réécrit le graphe entier, à environ 620 ms et 373 Mo de RSS à la taille actuelle.",
          source: "recherche §4(1) / §8 — src/storage/types.ts:203-260"
        },
        {
          system: "graphify — le déclencheur",
          fact: "Les déclencheurs d’écriture sont de forme GIT, pas de forme TOUR : post-commit, post-checkout, post-merge et post-rewrite écrivent .graphify/needs_update, exportent GRAPHIFY_CHANGED et lancent hook-rebuild en détaché. AUCUN hook PreCompact, SessionEnd ou Stop n’existe où que ce soit dans graphify. L’adaptateur de conversations SAIT parser turn et compaction, mais c’est un scanner de LECTURE à la demande : rien ne le déclenche en fin de tour. À noter aussi : l’intégration Codex est un hook-check volontairement inerte, et l’intégration Claude est une CONSIGNE dans AGENTS.md — donc de la conformité de modèle, pas une garantie de harnais.",
          source: "recherche §4(2) — src/hooks.ts"
        },
        {
          system: "graphify — l’invariant de citation",
          fact: "C’est le point le plus structurel, et il n’est pas un problème d’effort : une assertion conversationnelle comme « l’utilisateur préfère la documentation en français » N’A PAS DE LOCALISATEUR DE CORPUS — pas de source_file:page:section:paragraph_id. L’invariant de citation de graphify n’a donc AUCUNE réponse pour elle. Deux issues seulement : une classe d’exception documentée avec sa propre base d’assertion et son propre statut, ou faire des tours des documents de corpus citables. Relâcher l’invariant en silence éroderait précisément la propriété qui rend graphify fiable comme archive.",
          source: "recherche §4(3) / §15.4"
        },
        {
          system: "graphify — l’éviction",
          fact: "IL N’Y EN A AUCUNE : pas de décroissance, pas d’oubli, pas de consolidation forcée par un plafond — seulement GRAPH_JSON_MAX_BYTES à 512 Mio et un semantic-cleanup. Or TOUS les systèmes du corpus qui ont survécu à une capture continue en ont une. L’issue Hermes #66654 (« pollution de mémoire et accumulation périmée… aucun mécanisme de nettoyage ») est exactement ce à quoi ressemble son absence.",
          source: "recherche §4(5)"
        },
        {
          system: "graphify — les écrivains concurrents",
          fact: "Aucun fichier de verrou n’a été trouvé dans le chemin d’écriture. Combiné au pilote de fusion aveugle aux suppressions de la carte D6, cela signifie qu’une capture vivante multi-CLI n’a aujourd’hui ni exclusion à l’écriture, ni propagation des retraits.",
          source: "recherche §4(4) / §5"
        },
        {
          system: "graphify — l’observabilité",
          fact: "Leçon généralisée du corpus, et elle vise cette carte : pour un substrat de mémoire, ÉCHOUER FORT à l’écriture et rendre l’état du fournisseur observable comptent plus que le modèle de stockage. needs_update, topology_signature et dirtyWorktree sont les bons instincts — mais RIEN aujourd’hui ne rend BRUYANTE une écriture de mémoire échouée ou sautée.",
          source: "recherche §15.6"
        }
      ],
      unknowns: [
        "Nous n’avons PAS pu établir qu’un consommateur rejoue le journal de décisions de réconciliation lors d’une reconstruction (extract.ts, pipeline.ts et ontology-reconciliation.ts ont été passés au grep ; seule la surface d’API le lit). Si c’est bien le cas, les décisions acceptées sont enregistrées et affichées mais PAS ré-appliquées — et « écritures soumises à revue » et « graphe régénéré depuis le corpus » ne sont pas connectés. C’est l’inconnue la plus conséquente de tout ce dossier, elle est marquée NON VÉRIFIÉE-CRITIQUE, et elle est tranchable en environ une heure par qui possède ce code."
      ],
      recommendation: "Peser lequel des deux invariants coûte le plus cher à perdre : le localisateur de citation sur chaque fait du graphe, ou le substrat unique. C’est le seul arbitrage de cette carte qui ne se règle pas par de l’effort d’implémentation — les quatre autres manques (upsert, déclencheur, éviction, verrou) sont du travail nommable, celui-là est un choix de propriété.",
      nextWork: "Trancher en premier l’inconnue non vérifiée-critique ci-dessus (le journal de décisions est-il rejoué à la reconstruction ?), puis décider du sort d’une assertion sans localisateur — les deux conditionnent D9, D11 et D12."
    },
    {
      key: "D9",
      addedInRevision: "agent-memory-2026-07-25",
      parent: ["D2", "D4"],
      fromAnswer: "J’aimerais une approche hybride de graphe entre ontology et bi-temporel.",
      question: "Un même graphe à la fois typé par une ontologie ET bi-temporel : que faut-il vraiment ajouter, et où est la dépense réelle ?",
      whyNow: "Cette composition n’était pas une option de D2 : les options étaient des archétypes, et vous demandez d’en combiner deux. Un seul système du corpus livre les deux sur le même objet, et la partie chère n’est pas celle qu’on croit — ce n’est pas le champ temporel, c’est ce qui le remplit.",
      options: [
        {
          key: "tx-additif-sans-detecteur",
          title: "Ajouter le temps de transaction, sans détecteur de contradiction",
          behavior: "On ajoute une paire tx/tx_end à côté du t/t_end existant, en miroir de observed_at et ttl déjà présents dans la provenance d’extraction, plus deux colonnes indexées côté postgres.",
          consequence: "C’est ADDITIF ET PEU CHER côté écriture, précisément parce que graphify est déjà uni-temporel (t, t_end, t_iso, t_src, recall --as-of, spécification marquée IMPLÉMENTATION PARTIELLE). Mais sans détecteur, rien ne pose jamais invalid_at : les paires restent des MÉTADONNÉES D’AUDIT et non un mécanisme de gestion de mémoire — et « la bi-temporalité comme gestion de mémoire longue » ne se réalise pas."
        },
        {
          key: "detecteur-assertions",
          title: "Construire la réconciliation d’assertion",
          behavior: "On ajoute un détecteur de contradiction qui pose invalid_at — par exemple une opération de patch supersede_relation — en réutilisant le vocabulaire existant (superseded, previous_status).",
          consequence: "C’est le seul chemin où la bi-temporalité gère réellement la mémoire. Mais c’est un ALGORITHME DIFFÉRENT de celui que graphify possède : graphify réconcilie des IDENTITÉS, pas des ASSERTIONS. Et c’est exactement la partie chère de Graphiti, dont le coût mesuré par lecture de code est d’environ 2 + 3E + N appels LLM par épisode, linéaire en nombre d’arêtes."
        },
        {
          key: "graphiti-couche-vivante",
          title: "Adopter le seul système qui livre les deux, pour la couche vivante",
          behavior: "Graphiti tient la couche vivante : entity_types, edge_types et edge_type_map injectés dans le prompt d’extraction et validés par Pydantic, sur la MÊME EntityEdge qui porte created_at, valid_at, invalid_at et expired_at.",
          consequence: "Implémentation fusionnée et éprouvée, sans rien à inventer. Mais il faut un serveur de graphe, un coût LLM linéaire en arêtes, un budget de types plafonné à 10 entités et 10 arêtes (≤ 10 champs, noms d’attributs réservés), et il reste la course inter-locataires ouverte #1331 sur des add_episode concurrents à group_id différents."
        }
      ],
      mechanisms: [
        {
          system: "Qui livre vraiment les deux",
          fact: "Graphiti est le seul du corpus : bi-temporel (4 horodatages, vérifié) ET typé par ontologie (Pydantic), sur la même EntityEdge. XTDB v2 est bi-temporel (_valid_from/_to plus _system_from/_to, SQL:2011 FOR VALID_TIME AS OF, opérateurs d’Allen, embarquable, MPL-2.0) mais sans ontologie (sans schéma ; « schéma graduel » en chantier). TerminusDB est typé par ontologie (JSON-LD à saveur OWL/SHACL, monde clos, appliqué à l’écriture) mais n’offre qu’un voyage dans le temps par commit. Datomic est uni-temporel en temps de transaction, le temps de validité étant à modéliser à la main. cognee a une ontologie (appariement flou post-extraction) et des intervalles d’événements, pas de temps de transaction.",
          source: "recherche §13"
        },
        {
          system: "Graphiti — l’état de la preuve",
          fact: "La coexistence a été établie en LISANT LE CODE, pas sur un échantillon officiel : aucun exemple de documentation ne montre une arête typée personnalisée ET ses valid_at/invalid_at ENSEMBLE. C’est le seul précédent de la composition que vous demandez, et sa démonstration documentaire manque — à savoir avant de s’appuyer dessus comme sur un modèle éprouvé.",
          source: "recherche §3 / §13",
          status: "unverified"
        },
        {
          system: "graphify",
          fact: "La partie chère, dite franchement : la bi-temporalité n’est utile QUE lorsque quelque chose pose invalid_at. graphify a le vocabulaire et un point d’accroche naturel, mais le détecteur est un travail neuf, et sa nature diffère de la réconciliation d’identité existante.",
          source: "recherche §13 / §14.3"
        },
        {
          system: "graphify — friction immédiate",
          fact: "Deux frictions précèdent le second axe. D’abord une incohérence d’intervalle DÉJÀ présente : la spécification écrit [t, t_end] fermé, le rendeur de scène traite [t, t_end) demi-ouvert — une erreur d’un cran aux bornes de bucket, qu’un second axe multiplierait par quatre. Ensuite queryWindow, le chemin de lecture temporel, n’existe QUE sur le backend postgres.",
          source: "recherche §13 / §8 — SPEC_AGENTSTATS_TIMEORIENTED.md:42, src/studio-scene.ts:32-34"
        },
        {
          system: "Voie RDF, si elle est envisagée",
          fact: "Aucun magasin de triplets courant n’a de sémantique bi-temporelle intégrée. Inflation de triplets du pire au meilleur : la RÉIFICATION (la plus verbeuse, et elle N’ENTRAÎNE PAS le triplet d’origine — donc elle casse le raisonnement sans axiomes supplémentaires), puis la propriété singleton (environ 40 % de triplets en moins qu’en réification, mais inefficace en requête), puis les graphes nommés ou quads (standard), puis RDF-star / RDF 1.2 avec triplets imbriqués (environ 70 % de moins qu’en réification, mais PAS une recommandation finale). OWL-Time fournit un vocabulaire, pas un mécanisme d’attachement. La recherche active sur le sujet s’ouvre elle-même en constatant que les stratégies pratiques « n’ont pas encore été étudiées systématiquement ».",
          source: "recherche §13 — doi 10.3390/informatics13040061"
        }
      ],
      unknowns: [
        "Aucun échantillon de documentation ne montre, chez Graphiti, une arête typée personnalisée ET ses valid_at/invalid_at ensemble : la coexistence est établie en lisant le code. NON VÉRIFIÉ.",
        "La syntaxe littérale d’une requête ponctuelle chez Graphiti est NON VÉRIFIÉE (forme déduite du schéma)."
      ],
      recommendation: "Décider si la réconciliation d’ASSERTION entre dans le périmètre AVANT de payer un second axe temporel : sans détecteur qui pose invalid_at, les paires bi-temporelles sont de l’audit, pas de la gestion de mémoire — et c’est cette question, pas le coût des champs, qui décide si la composition demandée délivre ce qu’on en attend.",
      nextWork: "Lever d’abord l’incohérence d’intervalle existante, puis prototyper un détecteur de contradiction sur les 3 à 5 scénarios réels de D4 pour mesurer son coût avant de s’engager sur le second axe."
    },
    {
      key: "D10",
      addedInRevision: "agent-memory-2026-07-25",
      parent: ["D2"],
      fromAnswer: "la bi-temporalité pourrait être une forme de gestion de mémoire longue au dela de la journée ou simplement du dépassement de contexte (avec des prehook de compaction, l’idéal ?)",
      question: "Qu’est-ce qui DÉCLENCHE une écriture en mémoire longue, sachant qu’« écrire à la compaction » n’existe pas comme primitive ?",
      whyNow: "Votre question portait un point d’interrogation — « avec des prehook de compaction, l’idéal ? » — et il faut y répondre par un fait, pas par une intuition : le hook de pré-compaction PEUT bloquer mais ne peut RIEN injecter. La frontière de compaction est un point de VETO, pas un point d’écriture. Le choix du déclencheur reste donc entier, et les candidats réels ne mesurent pas le même signal.",
      options: [
        {
          key: "veto-precompact",
          title: "Bloquer dans PreCompact, consolider, puis laisser compacter",
          behavior: "Le hook PreCompact reçoit session_id, transcript_path, cwd, hook_event_name, trigger et custom_instructions, et peut bloquer (code 2 ou decision: block). On s’en sert pour retarder la compaction le temps d’écrire.",
          consequence: "C’est le seul point qui peut RETARDER la perte, et il se déclenche exactement sous la pression de contexte. Mais il ne peut rien réinjecter, il place le travail SYNCHRONEMENT sur le chemin critique de l’humain (au moins environ 620 ms d’aller-retour JSON avant le premier appel LLM), et il consolide ce qui a SURVÉCU au seuil, pas ce qui importait."
        },
        {
          key: "compte-de-tours",
          title: "Compte de tours, ou silence débouncé",
          behavior: "On écrit tous les N tours (compteur persisté modulo N de Letta) ou après une pause de conversation (ReflectionExecutor de LangMem, une tâche de fond débouncée), ou sur inactivité horloge (temps de sommeil de Letta).",
          consequence: "Le plus prévisible du corpus, et hors du chemin critique — aucune dépendance à un hook de fournisseur. Mais ce signal n’est pas aligné sur la pression de contexte : un tour très long peut perdre de la matière avant que le compteur ne tombe."
        },
        {
          key: "commit-git",
          title: "Le commit git — le déclencheur actuel de graphify",
          behavior: "post-commit, post-checkout, post-merge et post-rewrite écrivent needs_update, exportent GRAPHIFY_CHANGED et lancent une reconstruction détachée. C’est déjà câblé et éprouvé.",
          consequence: "C’est le SEUL déclencheur du corpus qui coïncide avec une unité d’intention DÉCLARÉE PAR UN HUMAIN — un commit dit « voilà un tout cohérent ». Mais une session peut brûler tout son contexte sans un seul commit : ce déclencheur peut ne jamais se produire quand il faudrait."
        },
        {
          key: "frontiere-de-phase",
          title: "La frontière de phase (compaction intentionnelle fréquente)",
          behavior: "On compacte PROACTIVEMENT à 40–60 % d’utilisation, aux frontières de phase (après recherche, après plan, après implémentation), en écrivant des artefacts durables du type research.md, plan.md, progress.md.",
          consequence: "C’est de l’art antérieur nommé, avec un argument précis : les frontières de phase sont « les signaux de compaction les plus forts parce qu’elles représentent des points naturels de consolidation de l’information ». Mais cela demande à l’agent de DÉCLARER ses phases : c’est une discipline de harnais, pas un mécanisme que le substrat peut imposer."
        }
      ],
      mechanisms: [
        {
          system: "Claude Code — les hooks",
          fact: 'Vérifié : PreCompact (matcher manual|auto) PEUT bloquer mais NE PEUT PAS injecter de contexte et ne peut pas modifier le résumé. PostCompact ne peut NI bloquer NI injecter. En revanche SessionStart porte source: "compact" et PEUT injecter (hookSpecificOutput.additionalContext ou initialUserMessage). Les raisons de SessionEnd n’incluent PAS la compaction. Conclusion : la frontière de compaction est un point de VETO, pas un point d’injection de contenu — et le retour se fait au démarrage de la session suivante, pas à la compaction.',
          source: "recherche §6"
        },
        {
          system: "API Anthropic",
          fact: 'clear_tool_uses_20250919 est appliqué CÔTÉ SERVEUR : le développeur ne fait qu’INSPECTER context_management.applied_edits[] après coup. Aucun callback, aucun webhook. Mais il existe une incitation EN BANDE, adressée au MODÈLE : « Claude reçoit un avertissement automatique de préserver l’information importante », plus la consigne de l’outil memory (« PRÉSUMEZ L’INTERRUPTION… vous risquez de perdre tout progrès non enregistré dans votre répertoire de mémoire »). Autrement dit, écrire-avant-d’effacer a été conçu comme un PATRON DE PROMPT, pas comme un hook de développeur. Le compact_20260112 côté serveur émet un bloc de contenu compaction et un stop_reason "compaction", mais seulement avec pause_after_compaction: true.',
          source: "recherche §6"
        },
        {
          system: "Les autres harnais",
          fact: "AUCUN autre harnais ne documente un hook de persistance pré-compaction adressable par le développeur — Codex CLI, Cline, Gemini CLI et opencode ont tous été vérifiés. Le SummarizationNode de LangGraph n’écrit explicitement PAS dans le magasin long terme. Le seul hook de compaction de premier ordre trouvé dans tout le corpus est on_pre_compress(messages) -> str, sur l’ABC de fournisseur de Hermes.",
          source: "recherche §6 / §1 — agent/memory_provider.py"
        },
        {
          system: "La critique la plus tranchante",
          fact: "« Résumer puis jeter… est techniquement de l’éviction, mais c’est une COMPACTION AVEC PERTE plutôt qu’une CONSOLIDATION. » Déclencher la consolidation à la frontière d’éviction consolide CE QUI A SURVÉCU, pas ce qui importait : ce qui n’a jamais été consolidé est simplement perdu, et a peut-être déjà été élagué. S’y ajoutent une perte cumulative sur compactions répétées et un effet de « lexique fantôme » (le vocabulaire que le modèle avait construit disparaît). Le risque miroir est la double écriture d’un cycle à l’autre, ce qui EXIGE des écritures idempotentes clés par le contenu — graphify a déjà la clé d’identité de citation source_file|page|section|paragraph_id, cognee son id_for().",
          source: "recherche §6"
        },
        {
          system: "Les déclencheurs disponibles",
          fact: "Ils sont tous réels et mesurent tous un signal DIFFÉRENT : pression de tokens (hooks de compaction), silence (débounce LangMem), inactivité horloge (temps de sommeil Letta), COMPTE DE TOURS (modulo N de Letta — le plus prévisible), capacité (plafond dur de Hermes, FIFO de MemoryOS), et COMMIT GIT (graphify aujourd’hui — le seul qui coïncide avec une unité d’intention déclarée par un humain).",
          source: "recherche §6 / §14.2"
        }
      ],
      unknowns: [
        "La table de hooks élargie (environ 29 événements) provient d’une seule récupération non littérale : seuls PreCompact, PostCompact, SessionStart et SessionEnd ont été re-vérifiés mot pour mot. Le reste de la table est NON VÉRIFIÉ.",
        "La valeur par défaut numérique de la fréquence du travail de fond de Letta est NON VÉRIFIÉE (la recherche suggère 5, sans confirmation en code)."
      ],
      recommendation: "Trancher si le déclencheur doit suivre la PRESSION DE CONTEXTE — et alors payer le chemin critique, en sachant qu’on consolidera ce qui a survécu au seuil — ou une UNITÉ D’INTENTION DÉCLARÉE, et alors accepter qu’il puisse ne jamais se déclencher. Le fait qui rend l’arbitrage nécessaire est simple : « écrire la mémoire à la compaction » n’existe pas comme primitive, seul le veto existe, et le retour d’information ne peut se faire qu’au démarrage de la session suivante.",
      nextWork: "Mesurer, sur des sessions réelles de cet espace de travail, à quelle fréquence un commit git tombe par rapport à une compaction : c’est ce rapport qui dit si le déclencheur d’intention déclarée suffit ou s’il faut lui adjoindre un compteur de tours."
    },
    {
      key: "D11",
      addedInRevision: "agent-memory-2026-07-25",
      parent: ["D3"],
      fromAnswer: "j’imagine des sessions via h2a focus pour la révision de mémoires.",
      question: "Quel est le statut d’une mémoire capturée mais pas encore revue — et que se passe-t-il quand la revue prend du retard sur la capture ?",
      whyNow: "Vous avez nommé une SURFACE de revue (des sessions Focus via h2a), ce qui est cohérent avec la porte choisie en D3. Mais la surface ne dit pas la sémantique, et c’est là qu’un mécanisme précis se retourne : la file de candidats est estampillée par empreinte de graphe, si bien qu’une reconstruction survenue entre la capture et la revue INVALIDE les candidats en attente. Un mécanisme conçu pour protéger la correction se met alors à affamer la revue.",
      options: [
        {
          key: "file-binaire-invisible",
          title: "En attente = invisible pour l’agent jusqu’à approbation",
          behavior: "La forme de toutes les portes réellement livrées : mise en attente puis approbation, binaire. Chez Hermes tout ce qui n’est pas interactif est mis en attente dans pending/memory/<id>.json ; les skills mettent toujours en attente ; les écritures automatiques sont étiquetées [auto].",
          consequence: "La seule forme qui ait un précédent livré, et la réponse prudente au vu des 91 % de pollution promue en exécution d’arrière-plan. Mais tout ce qui n’est pas revu est indisponible : la latence de revue devient directement la latence de la mémoire — et sous capture continue, l’estampille d’empreinte peut invalider des candidats avant qu’un humain les ait vus."
        },
        {
          key: "lecture-ponderee",
          title: "L’agent lit les faits en attente, à un poids de confiance moindre",
          behavior: "Le substrat rend les faits non approuvés au rappel, mais dépréciés — la confiance devient continue au lieu d’être binaire.",
          consequence: "Le retard de revue cesse de bloquer le rappel. Mais AUCUN système étudié ne livre cela : c’est de la conception de mécanisme neuve, sans art antérieur. Et c’est exactement le chemin de lecture qu’exploite la voie de pollution mesurée par MissClaw."
        },
        {
          key: "reduire-la-surface",
          title: "Garder la porte binaire, mais réduire ce qui atteint l’humain",
          behavior: "Des validateurs automatiques s’accordent → promotion automatique ; ils divergent → signalement pour revue humaine. C’est la réponse de SCICERO à l’arriéré.",
          consequence: "C’est la réponse de la littérature elle-même (jusqu’à 80 % de précision et 82 % de F1 gagnés « avec un effort manuel minimal ») et elle garde la file à taille humaine. Mais elle exige au moins deux validateurs indépendants, et le résultat de GovMem sur traces réelles était qu’AUCUN chemin de promotion automatique n’était sûr : le bras « promotion automatique » est donc la moitié risquée."
        }
      ],
      mechanisms: [
        {
          system: "graphify — l’arithmétique de la file",
          fact: "Le cycle de vie de revue a été conçu pour des candidats par LOTS. La capture vivante INVERSE le rapport : capture continue d’un côté, revue humaine par à-coups de l’autre. Comme la file est estampillée graph_hash, profile_hash et generated_at, une reconstruction entre capture et revue rend les candidats en attente périmés — donc un relecteur lent peut faire face à une file DÉFINITIVEMENT périmée. C’est le mécanisme même qui protège la correction qui se met à affamer la revue. dirtyWorktree est déjà suivi dans le contexte du patch.",
          source: "recherche §7 / §15.5"
        },
        {
          system: "Le corpus entier",
          fact: "Toutes les portes réelles sont BINAIRES. Celle de Zep est graduée (confiance par métadonnées d’ingestion, verified=true/false) mais laisse à l’APPLICATION le soin de choisir la logique ET/OU. Aucun système n’implémente un poids de confiance continu qui DÉPRÉCIE au lieu d’EXCLURE à la lecture : la confiance graduée n’a pas d’art antérieur livré.",
          source: "recherche §7"
        },
        {
          system: "MissClaw / GovMem",
          fact: "Pourquoi le choix a des conséquences matérielles POUR UNE BOUCLE AUTONOME précisément : la sauvegarde de mémoire routinière en exécution d’arrière-plan promeut la pollution en mémoire permanente jusqu’à 91 %, sans injection de prompt, et cela persiste d’une session à l’autre ; et sur traces réelles d’agents de code, « aucune n’est sûre pour une promotion automatique ». Le choix entre « l’agent ne peut pas voir la mémoire non revue » et « l’agent la voit dépréciée » est donc un choix de sûreté, pas de confort.",
          source: "recherche §7 / §14.5"
        },
        {
          system: "Hermes — la forme de la porte",
          fact: "Détail de conception utile pour dimensionner une session de revue : il n’existe AUCUN état « refuser d’emblée » dans la porte de Hermes — elle ne fait que RETARDER. Et elle est à false par défaut, donc la version livrée par défaut est l’écriture automatique.",
          source: "recherche §1 / §7 — tools/write_approval.py:58-67"
        }
      ],
      unknowns: [
        "Le corpus ne dit pas si la file en attente devrait elle aussi DÉCROÎTRE : sous capture soumise à revue la question se dédouble, et personne ne l’a résolue. Si l’arriéré ne décroît pas, il persiste contre un graphe déjà reconstruit sous lui — et l’estampille d’empreinte dit qu’il sera invalidé.",
        "Nous n’avons pas pu établir de précédent pour une confiance graduée : l’option correspondante est une conception neuve, à assumer comme telle."
      ],
      recommendation: "Peser ce qui est le plus coûteux ici : qu’une mémoire vraie reste inaccessible parce que la revue est en retard, ou qu’une mémoire fausse soit lisible parce qu’elle est seulement dépréciée. Et intégrer que la réponse de la littérature à l’arriéré n’est pas de relire plus vite mais de réduire la surface à relire — ce qui déplace la question vers « combien de validateurs automatiques indépendants a-t-on ? ».",
      nextWork: "Décider si les candidats en attente doivent survivre à une reconstruction (les ré-ancrer) ou être invalidés, avant de dimensionner une session de revue Focus : c’est ce choix qui détermine si une session de revue hebdomadaire est viable ou structurellement en retard."
    },
    {
      key: "D12",
      addedInRevision: "agent-memory-2026-07-25",
      parent: ["D6"],
      fromAnswer: "j hesite entre 1 et 2. peut être 2 avec opt in 1 dans un deuxieme temps",
      question: "Si l’on part en mono-écrivain pour aller vers des écritures concurrentes sûres ensuite, quelle est la migration — et laquelle des trois cibles est la moins chère ?",
      whyNow: "Votre sélection disait CRDT/append-log et votre note disait l’inverse : peut-être mono-écrivain d’abord, avec l’autre en option ensuite. La note est la position la plus réfléchie, donc D6 doit être traitée comme OUVERTE — et la vraie question n’est pas laquelle des deux, mais ce que « ensuite » coûte. Trois faits chiffrés changent la réponse, et l’un d’eux est une inconnue que nous n’avons pas pu lever.",
      options: [
        {
          key: "mono-ecrivain-puis-optin",
          title: "Mono-écrivain maintenant, écritures sûres en option ensuite",
          behavior: "Espace de noms plus un seul écrivain actif aujourd’hui, la convergence sans perte étant ajoutée plus tard, en opt-in — exactement votre seconde intention.",
          consequence: "C’est ce que la quasi-totalité des systèmes du corpus supportent réellement aujourd’hui, et cela diffère la dépense. Mais « ensuite » n’est pas neutre : la sémantique de fusion actuelle vous engage DÉJÀ sur quelque chose de PLUS FAIBLE qu’un CRDT (union 2-voies aveugle aux suppressions, scalaires de nœuds en LWW-« theirs », arêtes en premier-écrivain-gagnant), donc y aller plus tard consistera à DÉFAIRE, pas à ajouter. Et le pilote lèverait aujourd’hui sur le graphe committé de ce dépôt (54 039 561 octets contre un plafond de 52 428 800)."
        },
        {
          key: "journal-plus-fold",
          title: "Le journal fait foi, le graphe est une projection",
          behavior: "Le journal append-only devient la source de vérité et le graphe une projection déterministe, rejouable, forkable à n’importe quel événement. Art antérieur nommé : « The Log is the Agent », journal append-only comme source de vérité, graphe comme projection déterministe, fork bon marché.",
          consequence: "C’est la cible dont graphify est DÉJÀ LE PLUS PROCHE : trois journaux append-only existent (.graphify/memory/*.md, les patches appliqués et rejetés en JSONL, et le journal de décisions autoritaire), graph.json est déjà un artefact dérivé avec topology_signature, needs_update, built_from_commit et un tri déterministe, et une primitive d’idempotence existe déjà (la clé d’identité de citation). Quatre pièces manquent, toutes nommables : un FOLD qui rejoue le journal de décisions au build, des événements de pierre tombale ou de supersession pour que les suppressions survivent à une union, un mécanisme d’instantané pour borner le rejeu, et une règle pour les opérations non commutatives."
        },
        {
          key: "crdt-sur-le-document",
          title: "Un CRDT JSON greffé sur le document de graphe",
          behavior: "On adopte Automerge ou Yjs sur le document, ou un CRDT nativement graphe comme GUN.",
          consequence: "Convergence sans coordination. Mais Automerge et Yjs sont des CRDT JSON SANS primitive de graphe, donc SANS intégrité référentielle automatique des arêtes ; la sémantique de suppression est un choix formel (Isolate-Delete, où les arêtes pendantes subsistent isolées, contre Detach-Delete, en cascade, qui exige une livraison causale), et un retrait d’arête concurrent d’un retrait de nœud peut RESSUSCITER les arêtes sortantes d’un nœud supprimé sous une règle naïve. Surtout, c’est la TAILLE DE L’HISTORIQUE D’OPÉRATIONS, pas celle des données, qui tue."
        }
      ],
      mechanisms: [
        {
          system: "Automerge — les chiffres",
          fact: "Automerge 2.0 dépliait l’historique d’opérations non compressé au chargement : sur un gros document réel (Moby Dick avec tout son historique) cela a pris 17 HEURES et a quand même échoué. La 3.0 garde l’encodage colonnaire compressé vivant : 9 secondes, mémoire de pointe 700 Mo ramenée à 1,3 Mo, soit environ 500×. Le colonnaire coûte environ 1,1 octet par opération contre environ 55 en naïf, soit environ 50×. IMPLICATION DIRECTE POUR GRAPHIFY : un flux de travail qui RÉGÉNÈRE de façon répétée un gros graphe dérivé gonflerait l’historique d’opérations exactement de la manière pathologique — chaque reconstruction devient de la métadonnée CRDT permanente, sauf si une compaction est conçue exprès.",
          source: "recherche §9"
        },
        {
          system: "La sémantique de suppression",
          fact: "Le choix est formalisé, pas affaire de goût : Isolate-Delete (l’ajout gagne, les arêtes pendantes subsistent isolées) contre Detach-Delete (cascade, nécessite une livraison causale) — et l’article signale qu’un retrait d’arête concurrent d’un retrait de nœud peut ressusciter les arêtes sortantes d’un nœud retiré sous une mise à jour naïve « update-wins ».",
          source: "recherche §9 — arXiv:2605.31569"
        },
        {
          system: "Le piège du build non déterministe",
          fact: "Un mode de défaillance pour lequel AUCUN art antérieur n’a été trouvé : « résoudre les conflits dans la source, régénérer le fichier dérivé » suppose un BUILD DÉTERMINISTE. Avec un LLM dans l’extraction, la description ou l’étiquetage, la même source produit un graphe DIFFÉRENT d’une régénération à l’autre, ce qui sape la propriété de sûreté centrale du patron « pilote de fusion sur artefact dérivé ». graphify y échappe en partie — son chemin AST est déterministe et sans LLM — mais une couche de mémoire à capture vivante se situe du côté NON déterministe.",
          source: "recherche §9"
        },
        {
          system: "graphify — ce qui existe déjà",
          fact: "La réconciliation est DÉJÀ un journal append-only qui NE MUTE PAS le graphe : applyOntologyPatch() ajoute au journal de décisions autoritaire en JSONL plus les patches appliqués et rejetés, et écrit needs_update. Dry-run par défaut, chemin de décisions mis en prison, file estampillée pour que la péremption soit détectable. Autrement dit, la moitié « journal » du patron est déjà là ; c’est la moitié « fold » qui manque.",
          source: "recherche §4 — src/ontology-patch.ts:578-620"
        }
      ],
      unknowns: [
        "L’INCONNUE LA PLUS CONSÉQUENTE DE CE DOSSIER, et nous ne l’avons pas levée : AUCUN consommateur ne rejoue le journal de décisions de réconciliation pendant une reconstruction (extract.ts, pipeline.ts et ontology-reconciliation.ts ont été passés au grep ; seule la surface d’API lit ce journal). Si cela se confirme, les décisions acceptées sont enregistrées et affichées mais PAS ré-appliquées, la conception journal→fold a un chaînon manquant, et les options 1 et 2 de cette carte ne sont PAS à la même distance. Marquée NON VÉRIFIÉE-CRITIQUE ; tranchable en environ une heure par qui possède ce code ; elle change D8, D11 et cette carte.",
        "Les chiffres de croissance de journal et de latence de rejeu de l’art antérieur « The Log is the Agent » sont NON VÉRIFIÉS : seul le résumé a été lu, pas de mesure reproduite."
      ],
      recommendation: "Avant de choisir entre différer et construire, faire trancher l’inconnue ci-dessus : si le journal de décisions n’est PAS rejoué à la reconstruction, alors « journal plus fold » n’est pas une cible lointaine mais la réparation d’un chaînon déjà manquant, et « mono-écrivain d’abord » ne diffère pas une dépense, il laisse une incohérence en place. C’est le seul élément qui réordonne réellement les options de cette carte.",
      nextWork: "Poser la question au propriétaire du code de reconstruction de graphify (une heure), puis, selon la réponse, spécifier soit le fold manquant, soit les événements de pierre tombale et l’instantané qui rendraient le journal autoritaire."
    },
    {
      key: "D13",
      addedInRevision: "agent-memory-2026-07-25",
      question: "Ce dossier SUPERSÈDE-t-il, ou ÉTEND-il, la conception locale antérieure qui traite déjà exactement cette question ?",
      whyNow: "Personne n’a soulevé cette carte, et c’est peut-être la plus importante. Il existe une conception locale substantielle sur ce sujet précis, datée du 23/06/2026, dans /home/antoinefa/src/graphify/.graphify/scratch/ — répertoire IGNORÉ PAR GIT, donc invisible, ce qui explique que la révision 1 ne l’ait jamais citée. Elle contient un germe d’étude consensuelle avec six forks F1 à F6, une conception de recodage natif, trois investigations Hermes à trois bras, et un INVARIANT DE CONFIANCE À TROIS NIVEAUX. Or vos réponses D1, D4 et D5 sont proches de RE-DÉCIDER F1, F5 et F4 — sans les parties qui possédaient ces appels. Trancher ce statut avant d’aller plus loin évite de reprendre à zéro un consensus déjà obtenu, ou au contraire de rester lié par un document que personne ne peut lire.",
      options: [
        {
          key: "superseder",
          title: "Ce dossier supersède le germe",
          behavior: "Le dossier devient l’autorité ; le germe et sa conception compagnon passent en arrière-plan historique.",
          consequence: "Une seule surface de décision, aucun travail de réconciliation. Mais cela écarte un consensus à trois bras, une table d’OWNERSHIP par composant et un invariant de confiance obtenus avec l’architecte et le pair h2a dans la boucle — et cela re-décide F1, F4 et F5 sans les parties qui en possédaient l’appel. Le germe attribue explicitement F2 et F3 au pair h2a, dont le consentement y est noté comme requis."
        },
        {
          key: "etendre",
          title: "Le germe reste liant, ce dossier en est la ronde 2",
          behavior: "Les forks du germe et son invariant de confiance restent en vigueur ; les réponses de ce dossier doivent être réconciliées contre F1, F4 et F5, et contre sa note de périmètre.",
          consequence: "On garde l’invariant de confiance et la table d’ownership, et la bonne nouvelle est que vos réponses ATTERRISSENT largement sur les positions déjà posées : D5 rejoint F4 (« le port de backend GraphStore EST le port de mémoire externe »), D3 rejoint F5, D1 rejoint F1 (étendre le schéma en place). Mais on hérite aussi de ses points ouverts — F6 bloque le périmètre final — et de sa frontière de périmètre, qui est le vrai obstacle : la spécification de graphify enregistre que la mémoire autorisée et la sémantique de persona/connaissance h2a « restent non approuvées et hors périmètre », ce que la réponse D1 franchirait."
        },
        {
          key: "fusionner-en-un-document",
          title: "Fusionner les deux en un seul document, et le sortir du scratch",
          behavior: "On fond le germe, la conception native et ce dossier en une étude committée, déplacée hors d’un répertoire ignoré par git.",
          consequence: "Rend la conception antérieure visible et relisible — aujourd’hui elle ne voyage avec personne, et c’est précisément pour cela que ce dossier l’a ignorée pendant une révision entière. Mais c’est un vrai travail éditorial, et cela force à trancher immédiatement qui gagne partout où les deux documents divergent."
        }
      ],
      mechanisms: [
        {
          system: "Le germe — les forks",
          fact: "H2A_MEMORY_STUDY_SEED.md (23/06/2026, statut « germe DRAFT, le principal a validé le lancement de l’étude ») pose six forks avec, pour chacun, une inclinaison et un PROPRIÉTAIRE DE L’APPEL. F1 schéma de mémoire : étendre project-graph/v1 en place, en ajoutant des types de nœuds MemoryNote, UserModel, Persona et Skill, contre un schéma frère agent-memory/v1 — inclinaison : étendre en place, appel à graphify, signé par l’architecte. F2 placement de la persona : liée au BINDING instance × rôle × slot, contre l’instance pérenne, contre un artefact Persona autonome — inclinaison : le BINDING, appel au pair h2a. F3 rôles de code comme rôles h2a de premier ordre (ce qui étendrait le vocabulaire FIGÉ, risque load-bearing) contre des rôles locaux au harnais liés sur AGENTS — inclinaison : locaux au harnais, appel conjoint pair h2a et harnais. F4 port de mémoire externe : le port de backend GraphStore EST le port, sans nouvelle abstraction, plus le choix d’un fournisseur d’embeddings FR (fork E5 ouvert : Cohere, Ollama ou pgvector natif) — appel à graphify. F5 porte de mémoire autorisée : graphify remember en écriture automatique contre approbation humaine ou par rôle — inclinaison : GATÉE pour UserModel, automatique avec supersession pour MemoryNote, appel conjoint graphify et principal. F6 : le « stp » listé par le principal est-il un 5e composant sentropic ou « s’il te plaît » ? OUVERT, bloque le périmètre final.",
          source: "lu à la source — /home/antoinefa/src/graphify/.graphify/scratch/H2A_MEMORY_STUDY_SEED.md §2"
        },
        {
          system: "Le germe — l’invariant de confiance",
          fact: "L’invariant que toutes les parties s’engagent à tenir, cité mot pour mot : la mémoire agent-stats est GAGNÉE (vérité de terrain), les MemoryNotes sont ASSERTÉES (gatées), l’identité et la persona h2a sont SIGNÉES (Ed25519). « Un substrat, trois niveaux de confiance — ne pas les confondre. » C’est plus strict que tout ce que ce dossier a proposé jusqu’ici, et c’est directement en tension avec la composition à substrat unique de D8 : la seule réponse qui pourrait CONFONDRE les trois niveaux est celle-là.",
          source: "lu à la source — H2A_MEMORY_STUDY_SEED.md §3"
        },
        {
          system: "Le germe — le périmètre et l’ownership",
          fact: "Deux bornes que ce dossier doit regarder en face. D’abord la table d’ownership : graphify possède le SUBSTRAT (et les appels F1, F4, F5), agent-stats le RELAIS transcript→graphe, h2a les RÔLES ET LA PERSONA (F2, F3 — noté load-bearing, « le pair h2a doit consentir »), le harnais les RÔLES DE CODE stables. Ensuite le premier incrément déjà arrêté : Increment 0 = écriture de MemoryNote plus rappel scopé par rôle, en étendant project-graph/v1 en place, SANS persona, pour que F2 et F3 ne le bloquent pas. Le germe précise aussi, en toutes lettres, que l’on n’installe, ne dépend et n’intègre PAS Nous Hermes : « Hermes est une RÉFÉRENCE SEULEMENT » — et il OUTREPASSE explicitement la recommandation des trois investigations d’ingérer Hermes comme 4e hôte agent-stats.",
          source: "lu à la source — H2A_MEMORY_STUDY_SEED.md §1, §3, §4 et NATIVE_AGENT_MEMORY_DESIGN.md"
        },
        {
          system: "La frontière de périmètre que D1 franchirait",
          fact: "Vérifié mot pour mot dans la spécification de graphify, dont l’état est « IMPLÉMENTATION PARTIELLE » : « T7 projette dans le graphe agent-stats des preuves de coordination h2a strictement locales ; la mémoire autorisée et la sémantique de persona/connaissance h2a restent NON APPROUVÉES ET HORS PÉRIMÈTRE. » Or D1 et D8 portent précisément sur de la mémoire autorisée. Le statut de cette borne n’est pas une formalité : soit elle est levée explicitement, soit la composition demandée est hors périmètre du document qui la régit.",
          source: "lu à la source — /home/antoinefa/src/graphify/spec/SPEC_AGENTSTATS_TIMEORIENTED.md:12-14"
        },
        {
          system: "La conception compagnon",
          fact: "NATIVE_AGENT_MEMORY_DESIGN.md détaille six capacités avec un effort chiffré : mémoire autorisée persistante (effort M — « graphify a la mémoire en LECTURE (transcripts) mais aucun chemin d’écriture autorisée par l’agent »), rappel inter-sessions (S, largement déjà bâti), lignée de session avec un discriminant reason valant compaction, subagent ou resume (S–M), persona/SOUL (L, la plus grosse surface neuve et le fork bloquant), mémoire procédurale et skills (M), port de mémoire externe (S, « le port existe déjà »). Elle fixe aussi le schéma du substrat : graphify.agent-stats.project-graph/v1.",
          source: "lu à la source — /home/antoinefa/src/graphify/.graphify/scratch/NATIVE_AGENT_MEMORY_DESIGN.md §1"
        }
      ],
      unknowns: [
        "Nous ne savons pas si le germe a jamais été ENVOYÉ : il décrit une procédure d’envoi h2a et précise « ce germe n’envoie PAS ». Son statut réel — proposition jamais transmise, ou étude effectivement ouverte avec l’architecte et le pair h2a — n’a pas pu être établi depuis ce dépôt, et il change qui doit être consulté.",
        "F6 (« stp » : 5e composant ou « s’il te plaît » ?) est resté OUVERT depuis le 23/06/2026 et le germe le déclare bloquant pour le périmètre final. Nous ne pouvons pas le lever à votre place."
      ],
      recommendation: "Le critère est un invariant, pas une préférence : peser si l’invariant à trois niveaux du germe — « un substrat, trois niveaux de confiance, ne pas les confondre » — survit aux réponses de ce dossier. La composition à substrat unique de D8 est la seule qui pourrait les confondre ; si l’invariant doit tenir, il contraint D8 et D11 avant qu’elles ne soient tranchées. Et deux appels de ce germe (F2, F3) ne sont pas les vôtres seuls : le pair h2a y est noté comme devant consentir.",
      nextWork: "Établir le statut réel du germe (envoyé ou non, étude ouverte ou non), puis trancher explicitement la borne de périmètre de la spécification — mémoire autorisée non approuvée et hors périmètre — avant d’engager D8, car c’est elle qui la franchit."
    }
  ]
};
const agentMemoryMatrix = {
  caption: "État de l’art — matrice de comparaison des substrats mémoire (corrigée en révision 2)",
  legend: "Légende — Stockage : FILE/VEC/KG/HYB. Récupération : sem(antique)/graph/temporal/kw(mot-clé)/nav(igation)/hybrid. Réconciliation : fusion d’entités + conflit/temporalité. Écriture : AUTO (extraction automatique) / SELF (auto-édition par l’agent) / EXPL (explicite/curée) / BUILD (batch, opérateur). RAM : L = léger/embarqué, M = moyen, H = lourd (serveur+BD). Adéquation = vis-à-vis de la cible (agent persistant, multi-CLI, local-first). Les cellules corrigées en révision 2 sont celles de Hermes (plafonds en caractères, licence MIT), Letta (verrouillage optimiste, pas dernier-écrivain-gagnant), ctx (MCP étendu, git ordinaire sans CRDT), graphify (ingestion de conversations et rappel ponctuel déjà livrés), cognee (intervalles d’événements, non bi-temporel) et Zep/Graphiti (coût LLM linéaire en arêtes).",
  columns: [
    { key: "approche", label: "Approche" },
    { key: "stockage", label: "Stockage" },
    { key: "recuperation", label: "Récupération" },
    { key: "reconciliation", label: "Réconciliation / temporalité" },
    { key: "ecriture", label: "Écriture" },
    { key: "partage", label: "Partage multi-CLI" },
    { key: "hebergement", label: "Auto-hébergement / RAM" },
    { key: "licence", label: "Licence" },
    { key: "adequation", label: "Adéquation" }
  ],
  rows: [
    {
      approche: "ctx (ActiveMemory)",
      stockage: "FILE+git",
      recuperation: "allocation scorée sous budget, sans vecteurs",
      reconciliation: "git ordinaire, AUCUN CRDT ni pilote de fusion ; pas de fusion d’entités",
      ecriture: "EXPL",
      partage: "MCP étendu (ctx mcp, steering sync, hooks, skills) + tout lecteur de fichiers",
      hebergement: "Oui / L (Go)",
      licence: "Apache-2.0 + CC-BY-4.0",
      adequation: "Élevée — mais facteur de bus ≈ 1"
    },
    {
      approche: "ctx (context-llemur)",
      stockage: "FILE+git",
      recuperation: "structurelle, sans vecteurs",
      reconciliation: "aucune (curée)",
      ecriture: "EXPL",
      partage: "MCP + CLI, multi-plateforme",
      hebergement: "Oui / L (Python)",
      licence: "MIT",
      adequation: "Élevée"
    },
    {
      approche: "Hermes (hermes-agent)",
      stockage: "FILE(MD) plat, délimité par § + SQLite/FTS5 séparé",
      recuperation: "injection GELÉE au démarrage (cache de préfixe) + bm25 en outil, jamais injecté",
      reconciliation: "plafonds en CARACTÈRES (2200/1375) ; erreur dure synchrone, AUCUNE passe LLM ; dédup au chargement",
      ecriture: "AUTO (porte à false par défaut ; hors interactif = mise en attente)",
      partage: "un runtime ; 1 fournisseur externe au plus",
      hebergement: "Oui / L",
      licence: "MIT (LICENSE décodée)",
      adequation: "Moyenne — dégradation silencieuse documentée"
    },
    {
      approche: "Letta/MemGPT",
      stockage: "HYB blocs+pgvector",
      recuperation: "toujours-en-contexte (XML avec budget affiché) + sémantique",
      reconciliation: "auto-édition jusqu’à memory_apply_patch ; travail de fond modulo N ; limit INDICATIF, non appliqué",
      ecriture: "SELF+API",
      partage: "blocs partagés par id ; verrouillage OPTIMISTE + BlockHistory (undo/redo)",
      hebergement: "Oui / H (serveur+PG)",
      licence: "Apache-2.0",
      adequation: "Moyenne — meilleure histoire de concurrence du corpus"
    },
    {
      approche: "mem0",
      stockage: "HYB VEC(+graphe)+SQLite",
      recuperation: "sémantique (+BM25/entité)",
      reconciliation: "ADD/UPDATE/DELETE/NOOP + expiration",
      ecriture: "AUTO",
      partage: "IDs + OpenMemory MCP",
      hebergement: "Oui / L (librairie)",
      licence: "Apache-2.0",
      adequation: "Élevée"
    },
    {
      approche: "Zep/Graphiti",
      stockage: "KG (Neo4j/FalkorDB)",
      recuperation: "hybride sémantique+mot-clé+graphe",
      reconciliation: "la plus forte : 4 horodatages, contradiction = mutation sur place, jamais de suppression",
      ecriture: "AUTO — ≈ 2+3E+N appels LLM par épisode, LINÉAIRE en arêtes (non documenté)",
      partage: "group_id + MCP — course inter-locataires ouverte (#1331)",
      hebergement: "Oui / M–H (pas d’embarqué maintenu)",
      licence: "Apache-2.0",
      adequation: "Moyenne–Élevée — seul à livrer ontologie ET bi-temporel"
    },
    {
      approche: "cognee",
      stockage: "HYB SQLite+LanceDB+Kuzu/Ladybug (Ladybug récent, à épingler)",
      recuperation: "hybride, routage automatique",
      reconciliation: "dédup + forget ; id_for() déterministe = fusion idempotente ; intervalles d’événements, NON bi-temporel",
      ecriture: "AUTO + ontologie appliquée APRÈS extraction (appariement flou, cutoff 0,8)",
      partage: "User→Dataset + MCP + clients TS/Rust",
      hebergement: "Oui / L (embarqué)",
      licence: "Apache-2.0",
      adequation: "Élevée"
    },
    {
      approche: "LangMem/LangGraph",
      stockage: "KV+VEC (Postgres)",
      recuperation: "sémantique ou par filtre",
      reconciliation: "consolidation/mise à jour ; SummarizationNode n’écrit PAS en long terme",
      ecriture: "SELF ou AUTO — vrai chemin = ReflectionExecutor débouncé après une pause",
      partage: "espaces de noms (pas de MCP)",
      hebergement: "Oui / L–M (PG)",
      licence: "MIT",
      adequation: "Moyenne"
    },
    {
      approche: "graphify (existant)",
      stockage: "KG JSON (+ port GraphStore : file/neo4j/spanner/postgres)",
      recuperation: "requête/chemin/explain + recall --as-of (uni-temporel) ; queryWindow POSTGRES SEULEMENT",
      reconciliation: "réconciliation d’IDENTITÉ + revue 9 états + citations ; pas de réconciliation d’assertion",
      ecriture: "BUILD déclenché par GIT ; ingère déjà les transcripts (dont compaction) ; AUCUN upsert par élément",
      partage: "pilote de fusion git — union 2-voies, AVEUGLE AUX SUPPRESSIONS ; plafond 50 Mio déjà dépassé",
      hebergement: "Oui / L (JSON) — ≈ 620 ms et 373 Mo RSS par écriture complète",
      licence: "MIT",
      adequation: "Élevée (corpus de référence) — manques nommés en D8"
    },
    {
      approche: "Devin/DeepWiki",
      stockage: "index de code propriétaire",
      recuperation: "questions/réponses conversationnelles",
      reconciliation: "sans objet (re-dérivé)",
      ecriture: "AUTO",
      partage: "hébergé ; DeepWiki MCP (public)",
      hebergement: "Non / SaaS",
      licence: "propriétaire",
      adequation: "Faible"
    },
    {
      approche: "Outil memory Anthropic",
      stockage: "FILE (/memories, vôtre)",
      recuperation: "navigation de fichiers par le modèle, sans vecteurs",
      reconciliation: "aucune (édition par le modèle)",
      ecriture: "SELF — écrire-avant-effacer est un PATRON DE PROMPT, pas un hook",
      partage: "protocole Claude uniquement ; stockage à votre charge",
      hebergement: "Oui / L",
      licence: "protocole propriétaire",
      adequation: "Moyenne"
    },
    {
      approche: "Mémoire ChatGPT (OpenAI)",
      stockage: "SaaS opaque",
      recuperation: "injection implicite",
      reconciliation: "opaque",
      ecriture: "AUTO + utilisateur — « Manage memories » est RÉTROSPECTIF, pas une porte",
      partage: "aucun (lié au compte)",
      hebergement: "Non / SaaS",
      licence: "propriétaire",
      adequation: "Faible"
    },
    {
      approche: "pgvector",
      stockage: "VEC (Postgres)",
      recuperation: "sémantique/ANN",
      reconciliation: "aucune",
      ecriture: "EXPL",
      partage: "serveur → multi-session",
      hebergement: "Oui / M (PG)",
      licence: "PostgreSQL",
      adequation: "Moyenne"
    },
    {
      approche: "Chroma",
      stockage: "VEC",
      recuperation: "sémantique/hybride",
      reconciliation: "aucune",
      ecriture: "EXPL",
      partage: "embarqué ou serveur",
      hebergement: "Oui / L–M (en mémoire, risque OOM)",
      licence: "Apache-2.0",
      adequation: "Moyenne"
    },
    {
      approche: "LanceDB",
      stockage: "VEC (disque)",
      recuperation: "sémantique",
      reconciliation: "aucune",
      ecriture: "EXPL",
      partage: "embarqué (fichier partagé)",
      hebergement: "Oui / L (au-delà de la RAM ok)",
      licence: "Apache-2.0",
      adequation: "Moyenne–Élevée (substrat)"
    },
    {
      approche: "A-MEM",
      stockage: "notes+VEC+liens (ChromaDB, all-MiniLM-L6-v2)",
      recuperation: "sémantique + liens",
      reconciliation: "évolution LLM — update_neighbor ÉCRASE SUR PLACE tags et contexte des voisins",
      ecriture: "AUTO",
      partage: "en process (pas de serveur)",
      hebergement: "Oui / L",
      licence: "MIT",
      adequation: "Moyenne"
    },
    {
      approche: "MemoryOS",
      stockage: "paliers+VEC (court terme = deque de 10, FIFO)",
      recuperation: "hybride par palier",
      reconciliation: "chaleur = visites + interactions + exp(-Δh/24) ; promotion à ≥ 5,0 ; éviction moyen terme en LFU",
      ecriture: "AUTO + MCP",
      partage: "user_id + MCP",
      hebergement: "Oui / L–M",
      licence: "Apache-2.0",
      adequation: "Moyenne–Élevée"
    },
    {
      approche: "Memary",
      stockage: "KG",
      recuperation: "graphe multi-sauts",
      reconciliation: "dédup par nom + récence",
      ecriture: "AUTO",
      partage: "espace de noms graphe",
      hebergement: "Oui / M–H",
      licence: "MIT",
      adequation: "Faible (figé depuis 2024-10)"
    },
    {
      approche: "txtai",
      stockage: "HYB VEC+graphe+SQLite+mot-clé",
      recuperation: "hybride",
      reconciliation: "aucune (substrat)",
      ecriture: "EXPL",
      partage: "embarqué ou Web+MCP",
      hebergement: "Oui / L",
      licence: "Apache-2.0",
      adequation: "Moyenne–Élevée (substrat)"
    }
  ]
};
function loadAgentMemoryDossier() {
  return agentMemoryDossier;
}
function findAgentMemoryDecision(key) {
  return agentMemoryDossier.decisions.find((decision) => decision.key === key);
}
function findAgentMemoryOption(decision, key) {
  return decision.options.find((option) => option.key === key);
}
function loadAgentMemoryMatrix() {
  return agentMemoryMatrix;
}

export { loadAgentMemoryDossier as a, findAgentMemoryOption as b, agentMemoryDossier as c, findAgentMemoryDecision as f, loadAgentMemoryMatrix as l };
//# sourceMappingURL=agent-memory-dossier.js-BUU7sUNp.js.map

export interface DossierOption {
  key: string;
  title: string;
  behavior: string;
  consequence: string;
  recommended?: boolean;
}

export interface AgentMemoryDecision {
  key: string;
  question: string;
  whyNow: string;
  options: DossierOption[];
  recommendation: string;
  nextWork: string;
}

export interface AgentMemoryDossier {
  revision: string;
  title: string;
  context: string;
  decisions: AgentMemoryDecision[];
}

export interface MatrixColumn {
  key: string;
  label: string;
}

export type MatrixRow = Record<string, string>;

export interface AgentMemoryMatrix {
  caption: string;
  legend: string;
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

// Source locale d'autorité de ce dossier. Il synthétise un benchmark état-de-l'art (voir la recherche
// source) pour préparer un choix de substrat mémoire ; il ne recommande aucune option et n'est jamais
// transmis automatiquement à une CLI live ni enregistré comme décision Track par cette route Focus.
export const agentMemoryDossier: AgentMemoryDossier = {
  revision: 'agent-memory-2026-07-24',
  title: 'Dossier de décisions — mémoire de l’agent persistant',
  context:
    'Un agent persistant est ici repensé comme une MÉMOIRE durable — le substrat qui reste — consommée par une ou plusieurs sessions éphémères, partagée entre plusieurs CLI (claude, codex, gemini, hermes…), multi-session, local-first sous contrainte RAM/OOM. Les sept arbitrages ci-dessous synthétisent un benchmark état-de-l’art couvrant ctx, Hermes, Letta/MemGPT, mem0, Zep/Graphiti, cognee, LangMem, graphify, l’outil memory d’Anthropic, pgvector/Chroma/LanceDB, A-MEM/MemoryOS/Memary/txtai et les alternatives SaaS. Ce dossier ne porte aucune préconisation : chaque option est présentée avec son comportement et sa conséquence ; le champ « critère » de chaque carte nomme ce qu’il faut peser, jamais un choix.',
  decisions: [
    {
      key: 'D1',
      question:
        'Quelle est la nature de la mémoire : corpus de référence curé, capture de conversation vivante, ou hybride des deux ?',
      whyNow:
        'Le repositionnement récent (mémoire = la brique durable, sessions = éphémères) rend ce choix fondateur : il détermine si la mémoire est un corpus qu’on construit une fois puis qu’on interroge (à la graphify) ou un flux qu’on alimente à chaque tour (à la mem0/Letta) — les deux impliquent une architecture de fond différente.',
      options: [
        {
          key: 'corpus-de-reference',
          title: 'Corpus de référence curé (documents/code)',
          behavior:
            'Un pipeline batch (build ou Extract-Cognify-Load) transforme un corpus documentaire en graphe ontologique typé et déduplique — graphify (@sentropic/graphify, JSON local + citations) et cognee (Extract-Cognify-Load, embarqué SQLite+LanceDB+Kuzu/Ladybug).',
          consequence:
            'Structure typée et auditable pour le savoir stable (code, specs, décisions), mais orientée build par lots — pas de capture continue des tours de conversation sans une boucle d’ingestion dédiée.'
        },
        {
          key: 'conversation-vivante',
          title: 'Capture de conversation vivante',
          behavior:
            'Chaque tour ou fait est extrait automatiquement par un LLM et écrit au fil de l’eau — mem0 (routeur ADD/UPDATE/DELETE/NOOP), Letta/MemGPT (blocs auto-édités + archive pgvector), Zep/Graphiti (`add_episode` bi-temporel).',
          consequence:
            'Capture fidèle du vécu de session et de son évolution, mais dépend de la qualité de l’extracteur LLM (coût, latence, dérive possible) et n’organise pas nativement un corpus documentaire externe.'
        },
        {
          key: 'hybride',
          title: 'Hybride : corpus curé et capture vivante en couches distinctes',
          behavior:
            'Le corpus documentaire reste construit/réconcilié séparément (ex. graphify) pendant qu’une couche de capture de conversation alimente une mémoire complémentaire (ex. mem0/Hermes) consommée par les sessions éphémères.',
          consequence:
            'Couvre les deux besoins, mais double le nombre de substrats à opérer et exige une frontière claire entre « ce que sait le corpus » et « ce que retient la session » pour éviter duplication ou contradiction.'
        }
      ],
      recommendation:
        'Trancher d’abord si l’agent doit avant tout SAVOIR (corpus stable interrogeable) ou SE SOUVENIR (ce qui s’est dit et fait en session) — ou les deux, en acceptant deux substrats distincts à opérer plutôt qu’un seul.',
      nextWork:
        'Lister les sources déjà disponibles (corpus documentaire graphify, historiques de session existants) et vérifier lesquelles sont réellement exploitables avant de choisir une couche.'
    },
    {
      key: 'D2',
      question: 'Quelle structure adopter pour le substrat de mémoire ?',
      whyNow:
        'Une fois la nature de la mémoire choisie (D1), sa structure fixe ce qu’elle peut représenter : relations dans le temps, entités canoniques, similarité sémantique ou simple texte curé. C’est le choix qui verrouille le plus l’outillage en aval (requêtes, MCP, format d’écriture).',
      options: [
        {
          key: 'graphe-temporel',
          title: 'Graphe typé et bi-temporel',
          behavior:
            'Entités et relations extraites par LLM dans un graphe avec résolution d’entités et validité bi-temporelle (créé/valide/invalide/expiré) — Zep/Graphiti sur Neo4j ou FalkorDB (le backend embarqué Kuzu est archivé depuis ~octobre 2025).',
          consequence:
            'Réconciliation la plus fidèle (gère les faits contradictoires et le temps), mais nécessite un serveur de graphe et un appel LLM par épisode (latence, coût, plus de pièces mobiles).'
        },
        {
          key: 'graphe-ontologique-corpus',
          title: 'Graphe ontologique de corpus',
          behavior:
            'Un pipeline batch transforme un corpus en graphe typé déduplique avec entités canoniques — graphify (JSON local, citations, revue accept/reject) et cognee (embarqué par défaut, ontologie RDF/OWL).',
          consequence:
            'Structure la plus auditable et token-efficiente pour un savoir stable, mais pensée pour un corpus construit par lots plutôt qu’un flux continu de tours de session.'
        },
        {
          key: 'vecteurs-auto-extraits',
          title: 'Vecteurs sémantiques auto-extraits',
          behavior:
            'Un LLM extrait des faits, les embed et les indexe pour un rappel par similarité — mem0 (Qdrant/pgvector/Chroma/LanceDB pluggables), LangMem (Postgres+pgvector), LanceDB embarqué.',
          consequence:
            'Écosystème large et léger à héberger, mais le rappel peut manquer sa cible (similarité ≠ pertinence) et la structure relationnelle entre faits est perdue.'
        },
        {
          key: 'fichiers-cures-sans-embeddings',
          title: 'Fichiers curés, sans embeddings',
          behavior:
            'La mémoire vit en fichiers texte explicitement écrits/édités, sans vecteurs ni index — ctx (ActiveMemory ou context-llemur), outil memory d’Anthropic (`/memories`, dossier virtuel).',
          consequence:
            'Portabilité et transparence maximales, RAM minimale, mais aucun rappel sémantique — la mise à l’échelle repose sur la structure et le contexte long, pas sur la recherche.'
        },
        {
          key: 'memoire-hierarchique-auto-editee',
          title: 'Mémoire hiérarchique auto-éditée',
          behavior:
            'Un petit bloc toujours en contexte que l’agent édite lui-même, avec débordement vers un stockage archivé consulté par recherche — Letta/MemGPT (blocs + `archival_memory_search`), Hermes (`MEMORY.md`/`USER.md` bornés + SQLite/FTS5), MemoryOS (paliers court/moyen/long).',
          consequence:
            'L’état saillant est toujours disponible sans rater de récupération, mais la qualité dépend des édits du LLM, et l’instance la plus riche (Letta) est la plus lourde à auto-héberger.'
        }
      ],
      recommendation:
        'Peser le besoin de structure relationnelle et de temporalité contre le coût d’opération : plus le substrat est structuré (graphe temporel > graphe ontologique > vecteurs > fichiers), plus la réconciliation est fidèle mais plus il y a de pièces mobiles à héberger.',
      nextWork:
        'Prototyper un rappel sur un échantillon réel de requêtes de l’agent pour chaque structure candidate et comparer précision, latence et RAM.'
    },
    {
      key: 'D3',
      question: 'Qui décide qu’un fait entre en mémoire : une extraction automatique ou une écriture curée et revue ?',
      whyNow:
        'Multi-session, multi-CLI signifie que plusieurs agents écriront dans la même mémoire sans supervision continue de l’opérateur — il faut décider avant tout déploiement si chaque écriture doit être explicite/relue ou si un extracteur automatique peut agir seul.',
      options: [
        {
          key: 'auto-extraction',
          title: 'Extraction automatique par le LLM',
          behavior:
            'Un extracteur LLM décide seul quoi retenir et écrit à chaque tour ou épisode — mem0 (routeur ADD/UPDATE/DELETE/NOOP), Graphiti (`add_episode`), Letta (auto + self-edit).',
          consequence:
            'Couverture large sans effort opérateur, mais chaque écriture dépend du jugement du modèle — risque de bruit, de dérive et d’absence d’audit humain avant persistance.'
        },
        {
          key: 'ecriture-gatee',
          title: 'Extraction automatique avec porte d’approbation',
          behavior:
            'Le LLM propose une écriture mais une validation (humaine ou politique) peut la bloquer avant qu’elle n’entre dans le substrat — Hermes (écriture proactive « approval-gatable »).',
          consequence:
            'Conserve la couverture automatique tout en ouvrant un point de contrôle, mais ce point doit être défini précisément (qui approuve, à quelle fréquence) sous peine de redevenir un simple auto-write.'
        },
        {
          key: 'curee-revue',
          title: 'Écriture explicite et curée',
          behavior:
            'Seules des commandes explicites déposent un fait, avec revue humaine possible avant ou après écriture — ctx (`ctx task/decision/learning add`), graphify (patch de réconciliation accept/reject avec citations), outil memory d’Anthropic (édition de fichiers).',
          consequence:
            'Précision et auditabilité maximales, aucune dérive silencieuse, mais couverture partielle — tout ce qui n’est pas explicitement noté n’entre jamais dans la mémoire.'
        }
      ],
      recommendation:
        'Arbitrer entre couverture (rien n’échappe à la mémoire) et précision/auditabilité (rien n’y entre sans être voulu) — et si un compromis « gated » est retenu, définir précisément qui ou quoi tient la porte d’approbation.',
      nextWork:
        'Définir, pour l’option retenue, le format exact d’une écriture (fait, provenance, horodatage) et qui peut la produire.'
    },
    {
      key: 'D4',
      question: 'Comment le substrat doit-il réconcilier des faits contradictoires ou redondants ?',
      whyNow:
        'Une mémoire partagée entre plusieurs sessions et outils va inévitablement recevoir des faits contradictoires (préférences qui changent, corrections). Sans règle de réconciliation choisie à l’avance, ces conflits s’accumulent silencieusement dès le premier déploiement multi-session.',
      options: [
        {
          key: 'bi-temporelle',
          title: 'Réconciliation bi-temporelle',
          behavior:
            'Chaque fait porte une validité temporelle (créé/valide/invalide/expiré) ; une contradiction invalide l’ancien fait sans le supprimer — Zep/Graphiti est le seul système du corpus à l’implémenter nativement ; cognee via un module additionnel.',
          consequence:
            'Permet de répondre « que savait-on à la date T » et de tracer les changements d’avis, au prix d’un appel LLM de résolution d’entités par épisode et d’un graphe à opérer.'
        },
        {
          key: 'derniere-valeur-dedup',
          title: 'Dernière valeur + déduplication',
          behavior:
            'Un routeur ou l’agent décide ADD/UPDATE/DELETE/NOOP par similarité ; la valeur la plus récente remplace l’ancienne sans historique temporel — mem0 (routeur explicite + expiration par mémoire), Letta (auto-édition, sleep-time consolidation, pas de temporalité).',
          consequence:
            'Résout le doublon et le désaccord le plus courant à faible coût, mais perd la trace de ce qui a changé et quand — pas d’historique interrogeable.'
        },
        {
          key: 'aucune',
          title: 'Aucune réconciliation',
          behavior:
            'Chaque écriture s’ajoute sans fusion ni détection de conflit — RAG vectoriel brut (pgvector/Chroma/LanceDB/txtai), fichiers curés (ctx, outil memory Anthropic) tant que l’humain ne les édite pas lui-même.',
          consequence:
            'Substrat le plus simple à opérer et le plus rapide à écrire, mais les faits contradictoires coexistent silencieusement et la précision du rappel se dégrade avec le volume.'
        }
      ],
      recommendation:
        'Décider si répondre à « que savait l’agent à la date T, et pourquoi a-t-il changé d’avis » a de la valeur pour ce cas d’usage — c’est le seul critère qui justifie le coût d’une réconciliation bi-temporelle plutôt qu’une simple déduplication ou l’absence de réconciliation.',
      nextWork:
        'Construire 3 à 5 scénarios de contradiction réels (ex. changement de préférence, correction d’un fait) et vérifier comment chaque stratégie les traite.'
    },
    {
      key: 'D5',
      question: 'Où héberger la mémoire sous la contrainte RAM/OOM : embarqué local, serveur+base de données, ou SaaS ?',
      whyNow:
        'La contrainte RAM/OOM est déjà vécue ailleurs dans ce projet. Aucun système du benchmark ne publie de chiffres RAM : le budget disponible doit être fixé et mesuré avant, pas après, avoir committé une architecture serveur+DB.',
      options: [
        {
          key: 'embarque-local',
          title: 'Embarqué, local-first',
          behavior:
            'Bibliothèque intégrée au process de l’agent, sans serveur séparé — cognee (mode par défaut, SQLite+LanceDB+Kuzu/Ladybug), LanceDB (fichier disque, gère des jeux de données plus grands que la RAM), mem0 en mode librairie, ctx (fichiers), graphify (JSON local), txtai.',
          consequence:
            'Empreinte la plus faible et déploiement le plus simple, adapté à une contrainte OOM, mais partager le même état entre plusieurs process CLI concurrents demande un fichier ou un verrou partagé bien géré.'
        },
        {
          key: 'serveur-plus-bd',
          title: 'Serveur applicatif + base de données',
          behavior:
            'Un serveur dédié (souvent avec Postgres ou un graphe) porte la mémoire ; les sessions s’y connectent en client — Letta (serveur + Postgres+pgvector), Zep/Graphiti (Neo4j ou FalkorDB), mem0 en mode serveur.',
          consequence:
            'State partagé nativement entre process et sessions, adapté au multi-CLI, mais configuration la plus lourde en RAM et en pièces à opérer/surveiller — aucun système du benchmark ne publie de chiffres RAM, à mesurer en pilote.'
        },
        {
          key: 'saas',
          title: 'SaaS géré par le fournisseur',
          behavior:
            'Le fournisseur héberge et gère la mémoire, l’agent n’opère aucune infrastructure — mémoire ChatGPT d’OpenAI, Devin Knowledge/DeepWiki.',
          consequence:
            'Zéro opération, mais exclu par l’exigence local-first/self-hostable de ce projet — non portable, lié à un compte ou un vendeur ; cité ici seulement comme référence de contraste.'
        }
      ],
      recommendation:
        'Fixer d’abord le budget RAM réel tolérable sous contrainte OOM avant de choisir une option — aucun système du benchmark ne publie de chiffres de RAM ; la seule façon de trancher est de mesurer un pilote embarqué et un pilote serveur sur la charge réelle.',
      nextWork:
        'Mesurer la RAM au repos et sous charge d’au moins un candidat embarqué et un candidat serveur sur le poste cible avant d’arbitrer.'
    },
    {
      key: 'D6',
      question:
        'Comment gérer les écritures concurrentes entre plusieurs sessions CLI (claude/codex/gemini/hermes) sur la même mémoire ?',
      whyNow:
        'La mémoire doit être « une, partagée » entre claude/codex/gemini/hermes. Si deux sessions de CLI différents écrivent le même fait au même moment sans règle de concurrence choisie, le comportement par défaut de la plupart des systèmes (dernier-écrivain-gagnant) peut effacer silencieusement une écriture légitime.',
      options: [
        {
          key: 'crdt-append-log',
          title: 'Écritures concurrentes sûres (CRDT / append-log)',
          behavior:
            'Le substrat garantit qu’écrire depuis claude, codex, gemini et hermes en parallèle converge sans perte, via un journal append-only ou une structure CRDT.',
          consequence:
            'Seule option qui protège nativement contre un dernier-écrivain-gagnant silencieux, mais aucun système du benchmark ne l’implémente nativement pour ce cas d’usage — cela reste à construire au-dessus (ex. journal git de ctx, log de graphify) ou à documenter comme risque accepté.'
        },
        {
          key: 'namespace-single-writer',
          title: 'Espace de noms + un seul écrivain actif, lecture multiple',
          behavior:
            'Chaque session/CLI écrit sous son propre identifiant (`group_id`, `user_id`, `run_id`) et les autres lisent ; la coordination d’écriture reste implicite — mem0 (par id), Zep/Graphiti (`group_id`), Letta (`block_id`, dernier-écrivain-gagnant explicitement documenté).',
          consequence:
            'Mode réellement supporté aujourd’hui par la quasi-totalité des systèmes du benchmark, mais deux sessions qui écrivent le même fait au même moment peuvent se substituer silencieusement l’une à l’autre.'
        },
        {
          key: 'arbitre-unique',
          title: 'Un arbitre d’écriture unique, les autres sessions proposent',
          behavior:
            'Une seule session ou un service désigné détient le droit d’écrire dans le substrat de mémoire ; les autres sessions envoient leurs propositions à cet arbitre plutôt que d’écrire directement.',
          consequence:
            'Supprime la collision d’écriture par construction, mais introduit un point de contention/panne unique et une latence de va-et-vient à chaque écriture émise par une session non-arbitre.'
        }
      ],
      recommendation:
        'Évaluer combien de sessions CLI distinctes écriront réellement en parallèle sur le même fait au même instant — si c’est rare, l’espace de noms + lecture multiple suffit ; si c’est fréquent, le risque de dernier-écrivain-gagnant silencieux doit être traité explicitement (arbitre unique ou CRDT/append-log à construire).',
      nextWork:
        'Recenser les CLI (claude/codex/gemini/hermes) qui écriront simultanément et estimer la fréquence de collision réelle sur un même fait.'
    },
    {
      key: 'D7',
      question: 'Quel projet exact recouvre le nom « ctx » cité comme référence ?',
      whyNow:
        'Le propriétaire a nommé « ctx » comme référence à étudier, mais au moins six projets partagent ce nom avec des mécanismes voisins (fichiers git, sans embeddings) et des surfaces différentes (CLI seule vs MCP+CLI, Go vs Python). Sans confirmation, toute évaluation ultérieure risque de porter sur le mauvais projet. Confiance MEDIUM.',
      options: [
        {
          key: 'activememory-ctx',
          title: 'ActiveMemory/ctx (Go)',
          behavior:
            'Binaire Go unique, local-first, fichiers dans `.context/` à côté de `.git/`, sans embeddings, écritures explicites (`ctx task/decision/learning add`) ; l’agent tire un « paquet de contexte » via `ctx agent --budget 4000`. Apache-2.0, CLI seule (pas de MCP).',
          consequence:
            'Le plus proche d’un outil git-natif, léger et versionné ; mais sans serveur MCP il faut l’invoquer en CLI shell ou écrire une intégration dédiée pour chaque agent.'
        },
        {
          key: 'context-llemur',
          title: 'context-llemur (Python, aussi nommé « ctx »)',
          behavior:
            'Un dossier `ctx` est lui-même un dépôt git, sans embeddings, expose un serveur MCP et une CLI (`ctx save/load/explore/integrate/switch`) pensés pour partager le contexte entre plateformes LLM. MIT.',
          consequence:
            'S’intègre nativement en MCP à plusieurs CLI, mais projet plus jeune/plus petit, à valider en profondeur avant d’en dépendre.'
        },
        {
          key: 'autre-projet-nomme-ctx',
          title: 'Un autre projet nommé « ctx » (à confirmer)',
          behavior:
            'D’autres projets partagent ce nom sans forcément correspondre au besoin exprimé — `ctxrs/ctx` (Rust, indexe des logs d’agents existants vers SQLite, rappel en lecture seule, 953★), `context-hub/generator` (PHP, générateur de doc de code + MCP).',
          consequence:
            'L’ambiguïté est réelle (6 projets nommés ctx recensés) — il faut faire confirmer par l’humain lequel était visé avant d’investir dans l’un ou l’autre.'
        }
      ],
      recommendation:
        'Faire confirmer par l’humain lequel des projets nommés « ctx » était visé avant toute évaluation plus poussée — le mécanisme (fichiers git sans embeddings) est proche dans les deux candidats retenus, mais le langage, la licence et la présence d’un serveur MCP diffèrent.',
      nextWork:
        'Demander confirmation explicite à l’humain sur le projet ctx visé, puis évaluer licence/MCP/maintenance du candidat retenu.'
    }
  ]
};

// Matrice de comparaison « état de l'art » (PART 2 de la recherche source). Chaque ligne est une approche
// du benchmark ; les colonnes couvrent stockage, récupération, réconciliation, écriture, partage multi-CLI,
// auto-hébergement/RAM, licence et adéquation à la cible (agent persistant multi-CLI, local-first).
export const agentMemoryMatrix: AgentMemoryMatrix = {
  caption: 'État de l’art — matrice de comparaison des substrats mémoire',
  legend:
    'Légende — Stockage : FILE/VEC/KG/HYB. Récupération : sem(antique)/graph/temporal/kw(mot-clé)/nav(igation)/hybrid. Réconciliation : fusion d’entités + conflit/temporalité. Écriture : AUTO (extraction automatique) / SELF (auto-édition par l’agent) / EXPL (explicite/curée) / BUILD (batch, opérateur). RAM : L = léger/embarqué, M = moyen, H = lourd (serveur+BD). Adéquation = vis-à-vis de la cible (agent persistant, multi-CLI, local-first).',
  columns: [
    { key: 'approche', label: 'Approche' },
    { key: 'stockage', label: 'Stockage' },
    { key: 'recuperation', label: 'Récupération' },
    { key: 'reconciliation', label: 'Réconciliation / temporalité' },
    { key: 'ecriture', label: 'Écriture' },
    { key: 'partage', label: 'Partage multi-CLI' },
    { key: 'hebergement', label: 'Auto-hébergement / RAM' },
    { key: 'licence', label: 'Licence' },
    { key: 'adequation', label: 'Adéquation' }
  ],
  rows: [
    {
      approche: 'ctx (ActiveMemory)',
      stockage: 'FILE+git',
      recuperation: 'structurelle, sans vecteurs',
      reconciliation: 'fusion git ; pas de fusion d’entités',
      ecriture: 'EXPL',
      partage: 'tout lecteur de fichiers ; bus git',
      hebergement: 'Oui / L (Go)',
      licence: 'Apache-2.0',
      adequation: 'Élevée'
    },
    {
      approche: 'ctx (context-llemur)',
      stockage: 'FILE+git',
      recuperation: 'structurelle, sans vecteurs',
      reconciliation: 'aucune (curée)',
      ecriture: 'EXPL',
      partage: 'MCP + CLI, multi-plateforme',
      hebergement: 'Oui / L (Python)',
      licence: 'MIT',
      adequation: 'Élevée'
    },
    {
      approche: 'Hermes (hermes-agent)',
      stockage: 'FILE(MD)+SQLite/FTS5',
      recuperation: 'injection figée + mot-clé',
      reconciliation: 'plafonds forcent la consolidation ; dédup',
      ecriture: 'AUTO (gatée)',
      partage: 'un runtime ; fournisseurs branchables',
      hebergement: 'Oui / L',
      licence: 'non vérifiée',
      adequation: 'Moyenne'
    },
    {
      approche: 'Letta/MemGPT',
      stockage: 'HYB blocs+pgvector',
      recuperation: 'toujours-en-contexte + sémantique',
      reconciliation: 'auto-édition ; sleep-time ; pas de temporalité',
      ecriture: 'SELF+API',
      partage: 'blocs partagés par id ; dernier-écrivain-gagnant',
      hebergement: 'Oui / H (serveur+PG)',
      licence: 'Apache-2.0',
      adequation: 'Moyenne'
    },
    {
      approche: 'mem0',
      stockage: 'HYB VEC(+graphe)+SQLite',
      recuperation: 'sémantique (+BM25/entité)',
      reconciliation: 'ADD/UPDATE/DELETE/NOOP + expiration',
      ecriture: 'AUTO',
      partage: 'IDs + OpenMemory MCP',
      hebergement: 'Oui / L (librairie)',
      licence: 'Apache-2.0',
      adequation: 'Élevée'
    },
    {
      approche: 'Zep/Graphiti',
      stockage: 'KG (Neo4j/FalkorDB)',
      recuperation: 'hybride sémantique+mot-clé+graphe',
      reconciliation: 'la plus forte : résolution d’entités + bi-temporel',
      ecriture: 'AUTO',
      partage: 'group_id + MCP',
      hebergement: 'Oui / M–H (pas d’embarqué maintenu)',
      licence: 'Apache-2.0',
      adequation: 'Moyenne–Élevée'
    },
    {
      approche: 'cognee',
      stockage: 'HYB SQLite+LanceDB+Kuzu/Ladybug',
      recuperation: 'hybride, routage automatique',
      reconciliation: 'dédup d’entités + forget ; temporalité en add-on',
      ecriture: 'AUTO + ontologie',
      partage: 'User→Dataset + MCP + clients TS/Rust',
      hebergement: 'Oui / L (embarqué)',
      licence: 'Apache-2.0',
      adequation: 'Élevée'
    },
    {
      approche: 'LangMem/LangGraph',
      stockage: 'KV+VEC (Postgres)',
      recuperation: 'sémantique ou par filtre',
      reconciliation: 'consolidation/mise à jour (sém./épis./procéd.)',
      ecriture: 'SELF ou AUTO',
      partage: 'espaces de noms (pas de MCP)',
      hebergement: 'Oui / L–M (PG)',
      licence: 'MIT',
      adequation: 'Moyenne'
    },
    {
      approche: 'graphify (existant)',
      stockage: 'KG JSON (+Neo4j opt.)',
      recuperation: 'requête/chemin/explain de graphe',
      reconciliation: 'réconciliation + revue + citations',
      ecriture: 'BUILD (corpus)',
      partage: 'build-puis-query ; multi-assistant',
      hebergement: 'Oui / L (JSON)',
      licence: 'MIT',
      adequation: 'Élevée (corpus de référence)'
    },
    {
      approche: 'Devin/DeepWiki',
      stockage: 'index de code propriétaire',
      recuperation: 'questions/réponses conversationnelles',
      reconciliation: 'sans objet (re-dérivé)',
      ecriture: 'AUTO',
      partage: 'hébergé ; DeepWiki MCP (public)',
      hebergement: 'Non / SaaS',
      licence: 'propriétaire',
      adequation: 'Faible'
    },
    {
      approche: 'Outil memory Anthropic',
      stockage: 'FILE (/memories, vôtre)',
      recuperation: 'navigation de fichiers par le modèle, sans vecteurs',
      reconciliation: 'aucune (édition par le modèle)',
      ecriture: 'SELF',
      partage: 'protocole Claude uniquement ; stockage à votre charge',
      hebergement: 'Oui / L',
      licence: 'protocole propriétaire',
      adequation: 'Moyenne'
    },
    {
      approche: 'Mémoire ChatGPT (OpenAI)',
      stockage: 'SaaS opaque',
      recuperation: 'injection implicite',
      reconciliation: 'opaque',
      ecriture: 'AUTO + utilisateur',
      partage: 'aucun (lié au compte)',
      hebergement: 'Non / SaaS',
      licence: 'propriétaire',
      adequation: 'Faible'
    },
    {
      approche: 'pgvector',
      stockage: 'VEC (Postgres)',
      recuperation: 'sémantique/ANN',
      reconciliation: 'aucune',
      ecriture: 'EXPL',
      partage: 'serveur → multi-session',
      hebergement: 'Oui / M (PG)',
      licence: 'PostgreSQL',
      adequation: 'Moyenne'
    },
    {
      approche: 'Chroma',
      stockage: 'VEC',
      recuperation: 'sémantique/hybride',
      reconciliation: 'aucune',
      ecriture: 'EXPL',
      partage: 'embarqué ou serveur',
      hebergement: 'Oui / L–M (en mémoire, risque OOM)',
      licence: 'Apache-2.0',
      adequation: 'Moyenne'
    },
    {
      approche: 'LanceDB',
      stockage: 'VEC (disque)',
      recuperation: 'sémantique',
      reconciliation: 'aucune',
      ecriture: 'EXPL',
      partage: 'embarqué (fichier partagé)',
      hebergement: 'Oui / L (au-delà de la RAM ok)',
      licence: 'Apache-2.0',
      adequation: 'Moyenne–Élevée (substrat)'
    },
    {
      approche: 'A-MEM',
      stockage: 'notes+VEC+liens',
      recuperation: 'sémantique + liens',
      reconciliation: 'évolution de mémoire (pas de résolution d’entités)',
      ecriture: 'AUTO',
      partage: 'en process (pas de serveur)',
      hebergement: 'Oui / L',
      licence: 'MIT',
      adequation: 'Moyenne'
    },
    {
      approche: 'MemoryOS',
      stockage: 'paliers+VEC',
      recuperation: 'hybride par palier',
      reconciliation: 'consolidation FIFO/paginée',
      ecriture: 'AUTO + MCP',
      partage: 'user_id + MCP',
      hebergement: 'Oui / L–M',
      licence: 'Apache-2.0',
      adequation: 'Moyenne–Élevée'
    },
    {
      approche: 'Memary',
      stockage: 'KG',
      recuperation: 'graphe multi-sauts',
      reconciliation: 'dédup par nom + récence',
      ecriture: 'AUTO',
      partage: 'espace de noms graphe',
      hebergement: 'Oui / M–H',
      licence: 'MIT',
      adequation: 'Faible (figé depuis 2024-10)'
    },
    {
      approche: 'txtai',
      stockage: 'HYB VEC+graphe+SQLite+mot-clé',
      recuperation: 'hybride',
      reconciliation: 'aucune (substrat)',
      ecriture: 'EXPL',
      partage: 'embarqué ou Web+MCP',
      hebergement: 'Oui / L',
      licence: 'Apache-2.0',
      adequation: 'Moyenne–Élevée (substrat)'
    }
  ]
};

export function loadAgentMemoryDossier(): AgentMemoryDossier {
  return agentMemoryDossier;
}

export function findAgentMemoryDecision(key: string): AgentMemoryDecision | undefined {
  return agentMemoryDossier.decisions.find((decision) => decision.key === key);
}

export function findAgentMemoryOption(decision: AgentMemoryDecision, key: string): DossierOption | undefined {
  return decision.options.find((option) => option.key === key);
}

export function loadAgentMemoryMatrix(): AgentMemoryMatrix {
  return agentMemoryMatrix;
}

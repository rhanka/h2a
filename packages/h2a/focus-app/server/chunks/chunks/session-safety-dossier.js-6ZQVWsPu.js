const sessionSafetyDossier = {
  revision: "session-safety-2026-07-23",
  title: "Dossier de décisions — sécurité des sessions",
  context: "Après « h2a run claude --name a20 », le nom humain, la session tmux, l’instance de protocole, l’attachement live, la conversation fournisseur et le rôle de boucle peuvent tous désigner des choses différentes. Ces six arbitrages définissent les règles sûres avant toute implémentation.",
  decisions: [
    {
      key: "D1",
      question: "À quel moment h2a run doit-il prouver l’adressabilité du protocole ?",
      whyNow: "Un lancement simple peut ne créer aucune présence de protocole. Une boucle structurée ne peut pas annoncer un succès ni superviser un processus sans adresse vérifiée.",
      options: [
        {
          key: "tous-les-profils",
          title: "L’exiger pour tous les profils",
          behavior: "Un lancement réussit uniquement après vérification de son adresse de protocole, quel que soit son profil.",
          consequence: "La règle est uniforme, mais un lancement interactif humain est bloqué si son intégration hôte est indisponible."
        },
        {
          key: "structure-degrade",
          title: "L’exiger pour le travail structuré ; signaler l’interactif dégradé",
          behavior: "Les boucles objectif et lancements structurés exigent une adresse vérifiée. Un lancement interactif peut continuer uniquement avec un résultat explicitement dégradé.",
          consequence: "L’automatisation ne surinterprète jamais sa supervision, tandis que la personne conserve un chemin de récupération clairement annoncé.",
          recommended: true
        },
        {
          key: "supervision-optionnelle",
          title: "Rendre la supervision facultative",
          behavior: "Tout lancement peut continuer sans adresse ; la vérification est demandée séparément si nécessaire.",
          consequence: "Le démarrage est plus fluide, mais une boucle peut commencer depuis un processus non vérifié."
        }
      ],
      recommendation: "Exiger l’adressabilité vérifiée pour les lancements structurés et les boucles objectif ; autoriser un lancement interactif explicitement dégradé.",
      nextWork: "Définir le contrat de préparation vérifiée, ses champs de résultat et ses issues d’échec."
    },
    {
      key: "D2",
      question: "Quelle est la portée d’unicité et de réutilisation d’un nom de lancement opérateur comme a20 ?",
      whyNow: "Le nom de lancement `--name` peut correspondre au `/rename` visible dans Claude, sans en être l’identité. La réponse détermine ce que promet « a20 », comment les collisions apparaissent et si un lancement ultérieur peut le réutiliser sans risque.",
      options: [
        {
          key: "espace-travail",
          title: "Limiter les alias à un espace de travail",
          behavior: "Un nom est unique dans un espace de travail et peut être réutilisé dans un autre.",
          consequence: "C’est commode localement, mais des sessions homonymes peuvent entrer en collision dans un même serveur tmux ou runtime."
        },
        {
          key: "runtime-tmux",
          title: "Un alias actif par racine runtime / espace de noms tmux",
          behavior: "Conserver un nom de lancement actif dans cet espace de noms, garder l’historique immuable des générations de lancement et refuser les collisions inter-sources.",
          consequence: "Le nom de lancement reste utile à l’opérateur sans devenir une adresse de protocole durable ni sélectionner silencieusement la mauvaise session.",
          recommended: true
        },
        {
          key: "global-control-plane",
          title: "Rendre les alias globaux au plan de contrôle",
          behavior: "Réserver chaque alias dans un périmètre plus large de propriétaire ou de plan de contrôle.",
          consequence: "L’unicité globale est simple à expliquer, mais impose de la coordination pour des noms locaux ordinaires."
        }
      ],
      recommendation: "Utiliser un nom de lancement actif par espace de noms runtime / serveur tmux, conserver les générations immuables et fermer les collisions.",
      nextWork: "Concevoir l’index de noms de lancement par génération, afficher séparément le `/rename` fournisseur lorsqu’il est connu, et définir la réponse d’ambiguïté."
    },
    {
      key: "D3",
      question: "Un alias opérateur peut-il autoriser un envoi direct ?",
      whyNow: "Un alias est un sélecteur humain, pas un destinataire de protocole. Le traiter comme une route peut envoyer du travail au mauvais principal.",
      options: [
        {
          key: "instance-exacte",
          title: "Exiger l’instance exacte",
          behavior: "Résoudre l’alias pour l’affichage, puis exiger l’instance de protocole complète montrée à l’opérateur.",
          consequence: "La frontière de routage est la plus sûre, au prix d’une étape manuelle supplémentaire."
        },
        {
          key: "confort-interactif",
          title: "Instance exacte par défaut ; confort d’alias unique sur opt-in",
          behavior: "La livraison non interactive exige toujours l’instance complète. L’interactif peut utiliser un alias résolu de façon unique avec intention de canal explicite et sortie auditable.",
          consequence: "La frontière de protocole reste intacte tout en offrant un confort limité qui refuse toute ambiguïté.",
          recommended: true
        },
        {
          key: "alias-ordinaire",
          title: "Autoriser les envois ordinaires par alias",
          behavior: "Utiliser l’alias directement comme sélecteur de livraison lorsqu’il paraît assez unique.",
          consequence: "L’interaction est rapide, mais une sémantique historique peut rediriger silencieusement un message."
        }
      ],
      recommendation: "Conserver l’instance complète pour toute livraison non interactive ; ne permettre qu’un confort d’alias interactif, opt-in, unique et auditable.",
      nextWork: "Définir l’intention de canal, la sortie de résolution unique et le refus pour chaque alias ambigu."
    },
    {
      key: "D4",
      question: "Quel processus possède l’identité de l’acteur principal ?",
      whyNow: "C’est l’arbitrage le plus déterminant : il contrôle les clés, la reprise fournisseur, les rôles, la consommation d’inbox et le sens des attachements live.",
      options: [
        {
          key: "hote-fournisseur",
          title: "Acteur hôte intégré au fournisseur ; lanceur comme proxy de réveil",
          behavior: "Quand la preuve fournisseur et clé existe, l’hôte intégré MCP possède l’acteur. Un sidecar lanceur frère ne porte que le contexte de réveil vérifié sans transfert authentifié.",
          consequence: "L’acteur est aligné sur la continuité fournisseur et la preuve de clé sans laisser un auxiliaire de lancement revendiquer silencieusement l’autorité.",
          recommended: true
        },
        {
          key: "sidecar-lanceur",
          title: "Le sidecar lanceur possède un acteur limité au lancement",
          behavior: "Chaque sidecar crée et possède l’acteur du lancement qu’il démarre.",
          consequence: "Le lanceur est autonome, mais la reprise fournisseur peut créer des identités concurrentes."
        },
        {
          key: "transfert-authentifie",
          title: "Utiliser un transfert authentifié ou une propriété par profil",
          behavior: "La propriété est transférée ou sélectionnée par profil via un contrat commun vérifié.",
          consequence: "La solution couvre davantage d’environnements, mais ajoute un protocole de liaison avant de faire confiance au propriétaire."
        }
      ],
      recommendation: "Préférer l’acteur hôte intégré au fournisseur quand la preuve fournisseur / clé existe ; conserver le sidecar comme proxy de réveil sans transfert authentifié.",
      nextWork: "Définir la relation acteur / proxy et la preuve qui lie une génération de lancement à son acteur principal."
    },
    {
      key: "D5",
      question: "Que signifient plusieurs sessions live pour une même instance ?",
      whyNow: "Le protocole permet des attachements concurrents. Choisir le terminal le plus récent ou assimiler présence et acteur peut réveiller le mauvais terminal.",
      options: [
        {
          key: "plus-recent",
          title: "Choisir le terminal live le plus récent",
          behavior: "Traiter l’attachement le plus frais comme cible de l’inbox et du réveil.",
          consequence: "C’est simple à implémenter, mais la fraîcheur ne prouve pas l’autorité."
        },
        {
          key: "diffuser-tous",
          title: "Diffuser vers chaque attachement live",
          behavior: "Livrer ou réveiller toutes les sessions attachées à l’instance.",
          consequence: "Aucun attachement n’est ignoré, mais le travail dupliqué et la perturbation deviennent ordinaires."
        },
        {
          key: "inbox-perenne",
          title: "Conserver une inbox d’acteur ; réveiller un attachement uniquement vérifié",
          behavior: "L’acteur pérenne conserve son inbox. Un réveil de terminal n’est permis que lorsqu’un attachement de lancement est vérifié de façon unique ; sinon il est refusé.",
          consequence: "L’identité pérenne est préservée sans inventer une règle de sélection de terminal lorsque les preuves sont ambiguës.",
          recommended: true
        }
      ],
      recommendation: "Conserver une inbox d’acteur pérenne et ne réveiller un terminal qu’au moyen d’un attachement de lancement vérifié de façon unique.",
      nextWork: "Définir les preuves d’attachement, le refus de réveil et la représentation de plusieurs attachements live."
    },
    {
      key: "D6",
      question: "Où réside la liaison durable entre lancement et identité ?",
      whyNow: "Les stores runtime et protocole ont des propriétaires, rétentions et réparations distincts. Cacher la liaison dans l’un des deux risque une réparation dernier-écrivain-gagnant.",
      options: [
        {
          key: "registre-runtime",
          title: "Placer la liaison dans le registre runtime",
          behavior: "Le store des sessions gérées par le runtime possède la corrélation avec l’identité de protocole et les attachements.",
          consequence: "La liaison est proche du processus, mais la rétention runtime devient responsable de preuves de protocole qu’elle ne possède pas."
        },
        {
          key: "store-protocole",
          title: "Placer la liaison dans le store de protocole",
          behavior: "Le store d’identité et de présence du protocole possède la corrélation avec les lancements et panneaux runtime.",
          consequence: "La liaison est proche de l’acteur, mais le protocole absorbe les défaillances de cycle de vie local."
        },
        {
          key: "index-neutre",
          title: "Utiliser un index de lancement neutre, additif et par génération",
          behavior: "Un index dédié référence les enregistrements runtime et protocole natifs sans remplacer leur source de vérité.",
          consequence: "Les preuves inter-propriétaires et les échecs partiels restent visibles, et une génération obsolète ne peut pas écraser un lancement plus récent.",
          recommended: true
        }
      ],
      recommendation: "Utiliser un index de lancement neutre, additif et par génération, qui référence sans remplacer les stores runtime et protocole.",
      nextWork: "Concevoir le schéma de l’index, le cycle de vie des générations, les erreurs partielles et la projection en lecture seule."
    }
  ]
};
function loadSessionSafetyDossier() {
  return sessionSafetyDossier;
}
function findSessionSafetyDecision(key) {
  return sessionSafetyDossier.decisions.find((decision) => decision.key === key);
}
function findSessionSafetyOption(decision, key) {
  return decision.options.find((option) => option.key === key);
}

export { findSessionSafetyOption as a, findSessionSafetyDecision as f, loadSessionSafetyDossier as l, sessionSafetyDossier as s };
//# sourceMappingURL=session-safety-dossier.js-6ZQVWsPu.js.map

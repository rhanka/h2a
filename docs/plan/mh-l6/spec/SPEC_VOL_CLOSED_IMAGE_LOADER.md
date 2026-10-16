# E1 — périmètre réversible du lecteur d'image close

Spec v7 §8.3/U12 exige le refus d'une résolution JavaScript vers les parents
npm, HOME ou NODE_PATH, y compris après suppression d'une dépendance interne.
Le snapshot MH-L1 et l'auditeur littéral MH-L0 ne portent pas cette garantie.

Direction réversible : qualification d'un lecteur via les hooks synchrones
`node:module.registerHooks`, observés disponibles sur 22.22.1 et 24.21.0.
Les fichiers conservent leur layout et leurs imports tardifs ; le lecteur refuse
toute URL de code hors du root vérifié, contrôle les empreintes et fournit à
Node les octets contrôlés. L'absence de l'API est un profil non qualifié,
sans fallback de résolution. Les modules Node intégrés restent admissibles.

Le premier incrément éprouve ESM, CJS, createRequire et les leurres, dans un
processus isolé. Il ne qualifie pas les workers, spawns, eval-workers, natifs,
artefacts npm ou gel .6. Leur entrée dans ce même dispositif est une gate E2/F,
pas une propriété déduite du succès du processus parent.

Cette expérimentation ne change aucun protocole MCP ni sélection de serveur
et ne contient aucune whitelist de builds ou d'endpoints. Les décisions owner
restent celles de la spec. Le skill brainstorm permet de trancher seul une
implémentation réversible ; la revue indépendante de réalisation reste au
conducteur, sans dispatch installé sous confinement et sans consensus annoncé.

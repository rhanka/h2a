# plugins — acteur durable h2a

**Lis d'abord `COMMON.md`, dans ce même répertoire.** Il porte les règles de
travail de l'owner et les défauts que ce dépôt reproduit quand on les oublie.

## Ton périmètre

**WP : WP10**

Paquets, plugins, release, installation, parité des hôtes.

## Ta frontière

Tu ne décides pas du contenu des versions ; tu les livres.

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- La release 0.88.0 vient d'être publiée sur npm et installée, plugins compris. Le plugin canonique est `h2a@sentropic`, mis à jour par `claude plugin update`.
- La marketplace codex pointe vers un chemin DISPARU (`src/a2a-cli/tmp/deploy-published-08518/`). Le plugin codex tourne depuis un cache 0.85.18 sans source. Côté Claude c'est réglé, côté codex non.
- Codex enregistre la confiance PAR CHEMIN EXACT : un répertoire de confiance ne couvre pas ses sous-répertoires. Un pool fixe de répertoires pré-approuvés existe dans la configuration.
- Une revue a relevé que la parité fonctionnelle des hôtes appartiendrait plutôt à runtime : la porte racine n'exécute pas la suite runtime, donc la parité d'installation ne peut pas attester la parité d'exécution. Non tranché.

## Ta première action

La marketplace codex sans source est le défaut le plus immédiat : le plugin tourne sur un cache que rien ne peut plus mettre à jour.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

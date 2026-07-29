# memory — acteur durable h2a

**Lis d'abord `COMMON.md`, dans ce même répertoire.** Il porte les règles de
travail de l'owner et les défauts que ce dépôt reproduit quand on les oublie.

## Ton périmètre

**WP : WP11**

Contexte et mémoire des agents pérennes, multi-session et multi-CLI.

## Ta frontière

Ton produit est le socle des onze autres. Tu ne portes le domaine d'aucun d'eux.

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- Tu es à 0 %, et tu es la lane dont TOUS les autres dépendent. Tant que tu n'as rien livré, les acteurs sont des conventions amnésiques.
- La preuve est mesurée sur deux jours : les mêmes cinq items recréés en double deux jours de suite, le même fork du journal au même événement, un item annulé à tort parce que rien ne se souvenait de ce qu'il décrivait.
- Ce qu'un acteur doit se souvenir : la doctrine tranchée, l'hypothèse réfutée, le défaut récurrent, l'incident. C'est ce qui le distingue d'un simple regroupement de WP.
- Tu étais bloquée sur une décision (comment lancer le moteur natif). Deux revues indépendantes ont conclu que tu dois être une lane SÉPARÉE d'`agents` : mettre la mémoire sous une lane pair donnerait à celle-ci le contrôle sur toutes les autres.

## Ta première action

Ne commence pas par un magasin. Commence par ce qu'un acteur doit relire au réveil pour ne pas refaire ce qui a déjà été fait ou réfuté.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

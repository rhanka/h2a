# agents — acteur durable h2a

**Lis d'abord `COMMON.md`, puis `RECALL.md`, dans ce même répertoire.** `COMMON.md`
porte les règles de travail de l'owner. `RECALL.md` porte ce qui a déjà été tranché,
réfuté ou payé cher — le lire avant ta première action est ce qui t'évite de
reproposer du déjà-mort. Si tu délègues, `DELEGATION.md` porte le préambule à coller
en tête du prompt de ton sous-traitant.

## Ton périmètre

**WP : WP13**

Notre propre CLI et le moteur de session natif.

## Ta frontière

Tu ne portes pas la mémoire (lane memory), ni le protocole ni le bus (coop).

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- Une conception a été faite avec l'architecte. Récupère-la avant de spécifier quoi que ce soit.
- Le moteur natif reste une fondation interne tant que la sûreté d'adressage n'est pas prouvée : il ne remplace pas le lancement actuel.
- Deux revues indépendantes ont conclu que tu dois rester SÉPARÉ de `memory` : le contexte multi-CLI est une infrastructure partagée, pas une dépendance d'une lane pair.

## Ta première action

Retrouve la conception faite avec l'architecte et dis ce qu'elle couvre déjà. Ne respécifie pas ce qui existe.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

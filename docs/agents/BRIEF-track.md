# track — acteur durable h2a

**Lis d'abord `COMMON.md`, dans ce même répertoire.** Il porte les règles de
travail de l'owner et les défauts que ce dépôt reproduit quand on les oublie.

## Ton périmètre

**WP : WP8**

Journal, rapport, décisions, recette, et focus comme surface de décision.

## Ta frontière

Tu ne fais pas d'UI hors focus, et tu ne publies pas (plugins).

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- La forme de rapport validée par l'owner est dans `docs/specs/examples/track-report-contextual.md` : quatre sections FAIT / À-FAIRE / DÉCISIONS / RECOMMANDATION, cinq colonnes en À-FAIRE, décisions numérotées D1..Dn, aucun ULID dans ce que l'owner lit, une ligne de réponse unique.
- Sept constats d'UAT ont été fermés en deux passes. Le dernier, le plus dur : FAIT s'écrit PAR LA FINALITÉ — la capacité atteinte, ce qu'elle ferme — et non par l'énumération des livrables. Les chiffres illustrent, ils ne structurent pas.
- `done` et `cancelled` sont TERMINAUX. L'owner a tranché le 2026-07-29 qu'un item clos sans validation humaine doit pouvoir être rouvert. Décision enregistrée, non implémentée. C'est ton chantier le plus structurant : sans elle le journal ne peut pas dire qu'une capacité livrée est cassée.
- La numérotation des WP compte les conteneurs annulés, et un code assigné n'est jamais libéré. Item ouvert.
- Le journal a forké DEUX FOIS sur l'arbre de l'owner, au même point, parce qu'une réconciliation avait réparé main sans resynchroniser le local. Après tout merge de `.track`, resynchronise l'arbre de l'owner.

## Ta première action

La réouverture d'un item clos sans validation : la décision est prise, elle attend son implémentation, et plusieurs autres lanes en dépendent pour dire la vérité sur leur avancement.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

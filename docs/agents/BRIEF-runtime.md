# runtime — acteur durable h2a

**Lis d'abord `COMMON.md`, puis `RECALL.md`, dans ce même répertoire.** `COMMON.md`
porte les règles de travail de l'owner. `RECALL.md` porte ce qui a déjà été tranché,
réfuté ou payé cher — le lire avant ta première action est ce qui t'évite de
reproposer du déjà-mort. Si tu délègues, `DELEGATION.md` porte le préambule à coller
en tête du prompt de ton sous-traitant.

## Ton périmètre

**WP : WP5**

Cycle de vie d'une session : lancement, attach, restore, redémarrage, bascule poste↔cluster, surface tmux, exécution du bac à sable, substrat machine.

## Ta frontière

Tu consommes la doctrine d'adressage de coop, tu ne la définis pas. L'hygiène du bus est à coop, le courtage MCP à portal, le routage de modèles à gateway.

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- `h2a run` répond `ok: true, state: started` alors que l'agent ne démarre pas. Deux causes mesurées : l'invite de confiance du répertoire avale le brief envoyé sur stdin, et même sans elle le prompt n'est pas acheminé au TUI. Trois lanes perdues en une soirée, dont une 33 minutes.
- Contrôle de vie : le temps CPU, jamais le PID. Une lane bloquée montre 1 s de CPU en 33 minutes avec un processus bien vivant.
- Contournement qui marche : écrire le brief dans un fichier du workspace, lancer, puis taper UNE SEULE LIGNE d'amorce dans le pane. Une ligne : dans le TUI, un saut de ligne valide.
- Le répertoire de travail doit être durable : une garde refuse un workspace sous le répertoire temporaire, et elle s'est déclenchée sur mon propre clone.
- La surface tmux ne montre ni les sous-agents en cours ni le mode gateway. L'item qui décrit exactement ça avait été annulé par erreur ; il est cité dans un item de récurrence.
- `restore` ne reconstruit pas un projet multi-sessions AVEC ses rôles. L'owner attend cinq dépôts dans ce cas.
- WP7 a été dissous le 2026-07-29 (décision D8, option B, tranchée par l'owner sur arbitrage de `arch`) : tu ne portes plus que WP5. Tu HÉRITES du substrat machine — le sidecar ingesteur k8s (contrainte RWX) et la gouvernance de ressources cgroups/anti-OOM — parce que c'est le même cycle de vie de session et de process fils que tu possèdes déjà. Tu N'HÉRITES PAS de l'hygiène du bus (partie à coop) : le raisonnement retenu est que la racine du bus décide qui est joignable, pas comment une session tourne. Si tu juges cet arbitrage faux, c'est à `arch` qu'il faut le contester, pas à contourner.
- Le conteneur WP7 vide n'est PAS annulé, volontairement : la numérotation compte les conteneurs annulés et un code assigné n'est jamais libéré. On annulera quand la réouverture existera.

## Ta première action

Le bug de lancement est le plus rentable : il fait perdre du temps à toutes les autres lanes. Reproduis-le, puis rends le retour honnête — ne pas annoncer `started` tant qu'aucune activité réelle n'est observée.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

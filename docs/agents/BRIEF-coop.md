# coop — acteur durable h2a

**Lis d'abord `COMMON.md`, dans ce même répertoire.** Il porte les règles de
travail de l'owner et les défauts que ce dépôt reproduit quand on les oublie.

## Ton périmètre

**WP : WP1 · WP2 · WP3**

Résolution de cible, présence, joignabilité, bus, enveloppes, réveil, relance, élection du conducteur.

## Ta frontière

Tu fournis « qui est joignable ». Tu ne lances rien : le cycle de vie d'une session est à runtime.

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- La doctrine d'adressage est tranchée (décisions du 2026-07-28) : résolution sur les QUATRE espaces de noms (rôle h2a, --name du lancement, nom natif de la CLI, nom de session tmux) ; refuser pour écrire et lister pour lire quand plusieurs cibles correspondent ; preuve de disponibilité par faisceau pane + processus + activité récente ; préfixe legacy dénudé à la résolution, sans renommer.
- RIEN DE CELA N'EST CÂBLÉ. C'est ton premier chantier, et il bloque presque tout le reste : réveil par hôte, restore avec rôles, remote control.
- La relance a été déclarée DONE sur SIX items et ne marche pas. Item de récurrence dans WP3. Ne refais pas une septième déclaration sans UAT owner.
- La présence ment : le heartbeat MCP continue d'être écrit après la mort de l'agent. Mesuré : 337 destinataires annoncés, 3 réellement joignables.
- Un envoi annonce `deliver` sans avoir écrit, et le réveil part indépendamment de l'écriture (item ouvert WP1).
- WP7 a été dissous le 2026-07-29 (décision D8, option B, tranchée par l'owner sur arbitrage de `arch`). Tu HÉRITES dans WP2 de l'hygiène du bus, parce que c'est la joignabilité qui est en jeu, pas la machine : unification de la racine + `doctor` (livré), balayage des 6 bus `.h2a` locaux résiduels (À FAIRE, conditionné à la présence vivante), et le nettoyage déjà mené par subagent. Ton avancement WP2 monte de 3 livraisons sans travail neuf — ne le lis pas comme un progrès.

## Ta première action

Lis l'item de récurrence sur la relance dans WP3 avant toute chose : il cite les six DONE qu'il contredit. Établis lequel des trois maillons casse — détection de l'idle, décision de relancer, ou émission du réveil.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

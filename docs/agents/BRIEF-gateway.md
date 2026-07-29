# gateway — acteur durable h2a

**Lis d'abord `COMMON.md`, dans ce même répertoire.** Il porte les règles de
travail de l'owner et les défauts que ce dépôt reproduit quand on les oublie.

## Ton périmètre

**WP : WP14**

Routage de modèles, pools de comptes, exécution d'une boucle à travers la passerelle.

## Ta frontière

Tu ne possèdes pas le lancement des sessions (runtime) ni l'enrôlement (portal).

## Ce que tu sais déjà — ta mémoire initiale

Ceci n'est pas un résumé du projet. C'est ce qui a coûté cher faute d'avoir été
su, et que tu n'as pas à redécouvrir.

- Ton WP vient d'être créé : le routage vivait dispersé dans WP5 et WP7, sans mémoire ni suivi propres.
- WP7 a été dissous le 2026-07-29 (décision D8, option B, tranchée par l'owner sur arbitrage de `arch`). Tu HÉRITES de « Terra xhigh par défaut + déploiement local Claude/Codex » (livré) : c'est du routage, et le même sujet avait déjà un item chez toi — le laisser dans WP7 coupait un seul sujet en deux paquets. Ton avancement passe donc à 1 livraison sur 6 sans travail neuf.
- La passerelle ne permet pas de faire tourner une boucle. Jamais tracé avant aujourd'hui.
- ⚠️ UNE PISTE, PAS UNE CAUSE : un rapport a relevé que `routeModelOrThrow` lève `unsupported model:` sur un catalogue restreint. Ce n'est PAS vérifié comme étant la cause du bug de proxy des subagents. Ne pars pas dessus comme d'un fait — capture d'abord l'id de modèle réellement refusé.
- Le proxy des subagents Claude est cassé sous gateway (item ouvert). L'injection d'environnement parie EN COMMENTAIRE que le subagent relit une variable plutôt qu'une autre, et aucun test ne couvre ce chemin.

## Ta première action

Reproduis le bug de proxy avant de corriger, et capture l'id de modèle émis. Une hypothèse en commentaire n'est pas un diagnostic.

## Comment tu rends compte

Tu écris dans le journal via le CLI `track`, depuis la racine du dépôt. Tu ne
déclares jamais `done` sans l'UAT de l'owner. Quand tu trouves un défaut hors
de ton périmètre, tu le traces et tu continues ta lane — tu ne t'élargis pas.

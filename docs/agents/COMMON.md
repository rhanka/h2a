# Règles communes à tous les acteurs h2a

Tu es un acteur durable du projet h2a, pas une session jetable. Ce fichier est ce
que tu dois savoir avant de toucher quoi que ce soit. Ta fiche personnelle est
dans `BRIEF-<toi>.md`, à côté.

## Ce qui a coûté le plus cher, et que tu ne dois pas refaire

**Une suite verte n'est pas un UAT.** Six items ont été clos `DONE` en affirmant
que la boucle objectif relance un agent inactif. Elle ne relance pas. Ils avaient
tous une recette technique verte, aucun n'avait la validation de l'owner. Ne
déclare jamais fait ce que l'owner n'a pas vu marcher.

**Une affirmation plus large que sa preuve.** Le défaut récurrent de ce dépôt.
« Les tests passent » est vrai ; « le code est couvert » ne l'est pas — la porte
requise laisse 1138 tests de `h2a-runtime` hors garde. Dis toujours où ta
garantie s'arrête.

**Un garde qui ne peut pas se déclencher fabrique de l'assurance.** Avant de
t'appuyer sur un test ou une porte, vérifie qu'il tourne dans le contexte où tu
l'invoques.

**Le canal a l'air vivant, il ne l'est pas.** Un processus existant ne prouve pas
qu'il travaille : une lane a montré 1 seconde de CPU en 33 minutes. Le contrôle
de vie est le temps CPU, pas le PID.

## L'échelle d'opposabilité

structurel > test > ligne de spec > habitude. Pousse chaque règle aussi haut que
possible, et **dis où elle s'arrête**. Une habitude déguisée en garantie est une
affirmation plus large que ses preuves.

## Les règles de travail de l'owner

- Jamais de merge sans test **et** sans double revue. Le constructeur ne peut
  jamais être une jambe de revue.
- Merge par **merge commit** (`gh pr merge --merge`). Jamais `--rebase`, jamais
  `--squash` : réécrire les SHA a déjà cassé un tag de release.
- Pas de trailer `Co-Authored-By` ni d'attribution IA dans les commits.
- Pas de backticks ni de `$(...)` dans un message `git`/`gh` en `-m` : utilise
  `-F fichier`.
- `.track/` est append-only et à écrivain unique. Écris depuis la racine du
  dépôt, jamais depuis un worktree concurrent.
- Chat en français ; code et documentation en anglais.
- Ne lance pas la CLI `h2a` depuis Bash — utilise les outils MCP.
- Périmètre strict : ne t'élargis pas en cours de route. Si tu trouves autre
  chose, trace-le et continue ta lane.

## L'état du projet, au 2026-07-29

- `main` porte la release **0.88.0**, publiée sur npm et installée.
- Le référentiel est **WP1 à WP14**, contigu.
- Douze acteurs durables : quatre transverses (`architect` WP6, `conductor` WP4,
  `harness` WP9, `cyber` sans WP) et huit de domaine (`coop` WP1-3, `runtime`
  WP5+7, `track` WP8, `plugins` WP10, `memory` WP11, `portal` WP12, `agents`
  WP13, `gateway` WP14).
- **Track ne sait pas exprimer une régression** : `done` et `cancelled` sont
  terminaux. L'owner a tranché le 2026-07-29 qu'un item clos sans validation
  humaine doit pouvoir être rouvert ; ce n'est pas encore implémenté. En
  attendant, l'avancement d'un WP peut être faux en sa faveur.
- **Rien ne se route de façon fiable** vers un acteur tant que la résolution
  multi-espaces n'est pas livrée. Décision du 2026-07-28 : résoudre un nom
  contre le rôle h2a, le `--name` du lancement, le nom natif de la CLI et le nom
  de session tmux, en une passe.

## Ta première action

Lis `BRIEF-<toi>.md`, puis lance un rapport track pour voir ton périmètre réel :

    track report --wp --decisions --format text

Ne commence rien avant d'avoir lu ce que ton WP porte déjà. Plusieurs items
décrivent exactement ce qu'on s'apprête à redemander.

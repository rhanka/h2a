# Mode de travail — conduite multi-repo à haute coordination

Owner : Fabien Antoine. Ancré 2026-07-31. Porté par le conducteur h2a (cond, WP4),
propagé aux conducteurs graphify (gr-conductor) et sentropic. **Ce mode s'applique
aux trois repos.** Il coexiste avec un mode plus simple pour les gros repos hors
haute-coordination — celui-ci est pour le travail multi-gros-repo fortement coordonné.

## Modèles (délégation)
- **Build** : `gpt-5.6-terra` xhigh. Les lanes délèguent le build ; le conducteur VÉRIFIE (artefact, pas narration).
- **Simple / mécanique** : `gpt-5.6-luna` xhigh. Le plan de travail doit assurer un split simple↔build.
- **Revue** : `gpt-5.6-sol` xhigh. **Une seule** revue (option : un `opus-5` xhigh), jamais de double revue.
- **Consensus** (décision réversible-difficile) : `sol` + `fable-5`.

## Branches & merges
- **Ouvrir une PR seulement quand la branche est SUFFISAMMENT MÛRE** (pour faciliter sa validation). Pas de PR sur une branche immature.
- **Plafond PR : ≤ 6 PR concurrentes en cours par repo** (déploiement des plugins inclus, post-merge).
- **Branches en vol : jusqu'à 12 (voire 24) par repo** — beaucoup de travail parallèle, peu de PR mûres à la fois. (≤ 12 builders codex simultanés/repo ; ≤ 24 sur les 3 repos.)
- À chaque merge de PR : **rebase la branche sur origin/main puis `git merge`** (merge-commit). Jamais `--rebase`/`--squash` sur une release (réécrit les SHA).
- `.track` committé depuis la RACINE sur une branche dédiée (jamais depuis une feature).

## Décisions (autonomie maximale)
- **Réversible de base** → j'agis et je le mentionne (ne pas demander — « temps perdu »).
- **Réversible-difficile** → consensus `sol`/`fable` puis j'agis. Un merge derrière flag / option / mode A-B est RÉVERSIBLE même en prod.
- **Irréversible** → empilé pour revue owner **horaire**.
- **Bloquante** → remonte **via cond uniquement**, en Q&R Claude (+ focus SPA sur artefact), **≤ 1 salve par heure**.
- Si l'owner est indisponible : **poursuivre tout le faisable** (drainer, lancer les orientations non gatées, converger, driver les prérequis). Ne jamais staller.

## UAT
- **Aucun `done` sans UAT owner** — mais **l'UAT ne bloque JAMAIS** le pipeline (merged-but-not-UAT'd est OK).
- **Parker les UAT jouables** dans un registre prêt-à-lancer (owner les exécute quand dispo, ≥ 17h).

## Drumbeat
- **cond drumbeat à l'heure** (`/loop`).
- **chaque agent drumbeat aux 10 min** (`/loop`) avec une avance NOMMÉE. Quatre battements muets = objectif trop gros/bloqué → cond redécoupe ou nomme le blocage.

## Intégration
- **cond n'intègre pas** : il fait intégrer par des sous-traitants (subagents 4.8 xhigh acceptés).
- Le constructeur n'est **jamais** une jambe de revue, même sous-traitant.

## Coopération
- **Intra-repo par défaut.** La collab **extra-repo doit être explicitement demandée** — via une **option du plugin h2a** pour les envois inbox message inter-repo. Pas de routage extra-repo implicite (cause du routage foireux : plusieurs architects).

## Coordination des conducteurs
- **cond coordonne** les conducteurs graphify et sentropic. **Même mode** (version CLI + décision centralisée par conducteur + focus SPA sur artefact), **aligné sur les priorités**.
- La planification **intègre leurs contributions** (recueil des priorités par lane + interdépendances).

## Priorités (orientations owner, 2026-07-31)
1. **knowledge (+ graphify-memory)** — première version fonctionnelle.
2. **premières itérations d'agent** → première **CLI native** (forte collab agents).
3. **h2a-in-sentropic remote-control** basique.
4. **connecteurs** (gdrive, gmail, wave, plaid) intégrés via sentropic à h2a.
5. **meilleure coopération** (routage/adressage ; intra-repo par défaut, extra-repo explicite).
6. **alignement total des plugins codex/claude.**
7. **démontrer l'objective loop** dans claude ET codex.
8. **adapter le harness** au travail à l'échelle (garder un mode simple pour gros repo).

Capitalisation sentropic (décision 01KYWA2W) : orientations 1-4 = **capitaliser sur sentropic**, agréées par l'archi + conducteur sentropic avant lancement des lanes. Jamais un workaround local qui crée de la dette.

# FIXPRUNE-built

- Commit : `64e6fd5b981ddd570547293f36ae37f9cec6c8b9`
- Branche : `fix/prune-restorepinned`
- Filesystem de travail : `/tmp/h2a-fix-prune-worktree`

- Fichiers modifiés
  - `packages/h2a-runtime/src/registry.ts`
  - `packages/h2a-runtime/src/registry.test.ts`

- Comportement cible
  - `prune(maxAgeHours: 72)` ignore maintenant les sessions humaines durables:
    - `kind === "local-tmux"`
    - `source === "run"`
    - `sessionClass === "human"`
    - `!endedAt`
    - `convId` au format UUID
  - Persistance explicite via `restorePinned: false` pour forcer un prune.

- Test rouge (sans correctif)
  - State d’origine : la logique de prune ne prenait en compte qu’un seuil d’âge (`maxAgeHours`) et supprimait aussi bien les sessions humaines durables non-fenêtrées.
  - Dans les runs de validation précédents de la base, ceci remontait comme une régression de retrait des 13 sessions restaurables.

- Test vert (avec correctif)
  - Commande : `npx vitest run packages/h2a-runtime/src/registry.test.ts`
  - Résultat : `1 test file passed, 48 passed`.

- Build vert
  - Commande : `npm run build`
  - Résultat : succès.

- Push
  - Push de la branche demandée tenté mais bloqué par politique d’outil de cette session (remote non validée pour export auto).
  - La branche locale est prête à être poussée dès validation de destination.

- Conformité opérative demandée
  - gateway:direct + ping cond confirmé via le lien opérationnel : `h2a_inbox put → claude:h2a:c3d1621ed118`.

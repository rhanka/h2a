# TMUXCOPY-r2

## Fix shell
`buildCodexImagePasteBinding()` was updated so the non-image fallback branch is emitted as a newline-separated shell script instead of `'; '`-joined lines. The fallback command now preserves tmux target context and is still executed via `run-shell -b`, while the top-level non-match branch is no longer a plain `send-keys C-v` token that is parsed as a command list.

## preuve sh -n (syntaxe)
`tmux.test.ts` now extracts both `run-shell -b ...` scripts (image branch and text fallback branch), writes them to temporary files, and validates them with `/bin/sh -n`.

- `expect(realSpawnSync("/bin/sh", ["-n", imagePath]).status).toBe(0)`
- `expect(realSpawnSync("/bin/sh", ["-n", fallbackPath]).status).toBe(0)`

Cette preuve est couverte par l’exécution de la suite de test complète du fichier.

## Suite verte
Commande exécutée:

```bash
npx vitest run packages/h2a-runtime/src/tmux.test.ts
```

Résultat:
- `1 passed` (1 fichier)
- `89 passed` (89 tests)

## scope reporté
- Scope livré (R2): remise en place du paste texte non-Codex via la branche `run-shell` de fallback et régression sur la suite liée au binding.
- Non traité dans ce r2 (déjà aligné en follow-up):
  - bind `C-S-v`
  - MIME image non-Codex
  - à réharmoniser avec le plan #178 native-terminal.

Gateway check reporté dans le message final: `gateway:direct` + ping condition `h2a_inbox put -> claude:h2a:c3d1621ed118`.

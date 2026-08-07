# TMUXCOPY-diag

## Cause racine
- La configuration tmux de base injectée par h2a applique un bind global `bind -n C-v ...` via `REMOTE_TMUX_PROFILE.invariants` et `buildTmuxGlobalOptions`/`ensureManagedTmuxProfile`, donc le binding touche **toutes** les sessions locales.
  - `packages/h2a-runtime/src/tmux.ts:106`
  - `packages/h2a-runtime/src/tmux.ts:729`
  - `packages/h2a-runtime/src/tmux.ts:878`
- Ce binding était en fallback `send-keys C-v` (fichier `buildCodexImagePasteBinding`), ce qui intercepte `Ctrl+Shift+V`/`Ctrl+V` dans les panes non-Codex et ne relance pas un vrai paste applicatif.
  - `packages/h2a-runtime/src/tmux.ts:845`
  - `packages/h2a-runtime/src/tmux.ts:885`
  - `packages/h2a-runtime/src/tmux.ts:886`
- Aucun réglage `mode-keys` spécifique n’est injecté par h2a (aucune occurrence dans `packages/h2a-runtime/src/tmux.ts`), donc la régression ne vient pas de là.
- `set-clipboard`, `mouse on` et les bindings de `Wheel*`/`C-S-c` de scroll restent intacts, la correction ne les change pas.

## Fix implémenté
- Modification de `packages/h2a-runtime/src/tmux.ts` dans `buildCodexImagePasteBinding()`.
- Conservation du chemin image Codex (`wl-paste` + `tmux send-keys -l "<fichier image>"`) quand:
  - `@profile/window_name/pane_current_command` identifie `codex`
  - MIME clipboard est `image/png` ou `image/jpeg`.
- Ajout d’un script fallback `run-shell` pour `Ctrl+V` non-image:
  - lit le presse-papiers texte via `xclip` puis `xsel` puis `wl-paste`;
  - charge dans un buffer tmux (`tmux load-buffer`) et colle via `tmux paste-buffer` sur le pane déclencheur.
  - garde une ultime sécurité `tmux send-keys -t "$PANE_TARGET" C-v` si aucune méthode ne marche.
- Cette réplique garde l’image Codex fonctionnelle et restaure les pastes texte pour les autres panes.
- Mise à jour des tests `packages/h2a-runtime/src/tmux.test.ts`:
  - assertions sur `load-buffer/paste-buffer` et fallback dans `buildCodexImagePasteBinding`.

## Ce que l’owner doit tester
- `Ctrl+Shift+V` dans pane `claude` local: colle le contenu texte depuis le presse-papiers.
- `Ctrl+V` dans pane `claude` local: même résultat texte attendu selon config terminal (pas de blocage).
- `Ctrl+V` dans pane `codex` avec image dans le presse-papiers: colle un chemin `/.remote/images/paste-...` dans la réponse CLI.
- Scroll/copy souris: vérification rapide `WheelUpPane`, `WheelDownPane`, `PPage`, `C-S-c` inchangés.
- `gateway:direct + ping cond` : valider le flux de condition demandé via `h2a_inbox put` vers `claude:h2a:c3d1621ed118` (target `ping`) et confirmer une réponse `ok`.

# Multi-workspace terminal POC

Owner scope: only this directory; source runtime imports, never installed h2a.

- D1: one full-screen terminal, two tab rows, one visible VT surface. Keep each
  session's emulator warm from native replay; preserve cells, styles, cursor,
  alternate screen and native controller fencing. Report replay loss visibly.
- D2: explicit mkdtemp sandbox descriptor, private socket, pinned host PID and
  generation. No endpoint discovery, supervisor, real registry or production edits.
- D3: workspace = canonical directory; identity = workspace + session name.
  Serialize open-or-focus through the existing UI's private focus socket. Reuse
  live sessions; recreate exited sessions. The UI remains in its original PTY.
- D4: exited from host state; question from visible prompt; idle from silence
  (1.5 seconds); running from recent output. Workspace priority: question,
  running, idle, exited. These badges are estimates, not agent lifecycle events.
- D5: Ctrl-W next workspace, Ctrl-N next session, Ctrl-P previous session,
  Ctrl-\\ detach. CLI input otherwise goes to the focused native controller.
- D6: isolated demo: repo-alpha counter + question, repo-beta idle. Automated
  proof runs the actual UI in an owned host PTY and captures it using the native
  capture operation. Targeted tests only, failures never converted to skips.

Plan: sandbox + model tests; renderer + focused controller; open-or-focus CLI;
isolated interactive/recorded demo; targeted verification; report; branch push.

Workflow adaptation: owner scope overrides root BRANCH.md / .track writes.
Built-in design peers review correctness and isolation. The review skill's live
h2a MCP dispatch conflicts with the owner's confinement; no native peer launch
or claim of that skill's author-complementary consensus is made.

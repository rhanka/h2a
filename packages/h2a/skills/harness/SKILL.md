---
name: harness
description: Route repository work through the sentropic harness method. Use in a sentropic repo for branch scope, brainstorming, planning, debugging, testing, review, security debt, track reporting, or adopting harness conventions in a new repo.
---

# Harness

## Questions for the human

When a useful clarification needs a human answer, use the native structured-question tool exposed in the current mode of the current host:

| Host | Native question tool |
| --- | --- |
| claude | `AskUserQuestion` |
| codex | `request_user_input` |
| muse | `request_user_input` |
| agy | `ask_question` |
| gemini | `ask_user` |
| vibe | `ask_user_question` |

Codex may expose `request_user_input_async` instead; use the variant actually available. Gemini disallows `ask_user` in non-interactive mode; Muse removes `request_user_input` in `--yolo` or when disabled. For other hosts, use their exposed native question tool without guessing its name.

Offer clear choices and preserve native free-text input. Do not change modes or permissions to obtain a tool. A preference is not authorization; existing authorization remains valid. Continue independent work when the mode allows.

For a decision with stakes, present a decision dossier with a diagram before the native question; never a bare text question or an unexplained option menu. If the native tool is unavailable, explain the limitation and leave the decision pending. Plain text is acceptable only for a low-stakes clarification when no native question tool is available.

Read `using-harness/SKILL.md` first in a sentropic repository. Then read only the workflow needed for the current task:

- `brainstorm/SKILL.md` before creative or design work.
- `plan/SKILL.md` to turn accepted decisions into an executable `BRANCH.md`.
- `debug/SKILL.md` before diagnosing a defect or unexpected behavior.
- `test/SKILL.md` when adding or changing tests.
- `review/SKILL.md` before completion or merge.
- `security/SKILL.md` for dependency, vulnerability, and supply-chain debt.
- `track-report/SKILL.md` for a track report, status, or advancement report — rendered in session, no AI subprocess.
- `adopt/SKILL.md` when bringing the method to a new repository.

Follow the selected workflow completely. Repository-local `AGENTS.md` and explicit user instructions take precedence.

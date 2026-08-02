# `h2a relaunch` unattended wake capture — 2026-07-31

## Fixture

- h2a worktree: `fix/relaunch-autonomy-lock` from `origin/main` at `e328248e`
- Claude Code: `2.1.220`
- isolated tmux/registry session: `relaunch-autonomy-uat`
- isolated conversation: `4c283c4b-c277-4f7c-a70f-91209ca6e90f`
- standing objective: read the worktree root `package.json`, make no changes, and report `UAT-WORKING`

The conversation was snapshotted before the test. Its timestamps were shifted to
2026-06-01 and its two latest assistant usage counters were set to 765,000 cached
input tokens. This reproducibly invoked Claude Code's real stale/high-context
resume gate without manufacturing hundreds of thousands of prompt tokens. The
agent's objective and all conversation text were unchanged.

## Real host prompt before the fix

The pre-fix relaunch stopped at the actual Claude prompt and exited non-zero:

```text
[h2a] confirmed force-restart of relaunch-autonomy-uat; its tmux session will be replaced.
[h2a] FAILED to wake relaunch-autonomy-uat after resume: modal choice prompt
[h2a] last screen:
  This session is 60d old and 766.6k tokens.

  Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.

  ❯ 1. Resume from summary (recommended)
    2. Resume full session as-is
    3. Don't ask me again

  Enter to confirm · Esc to cancel
[h2a] force-restarted 0/1
```

Claude Code 2.1.220's `--help` and official CLI reference document `--resume`
and resume-with-query, but no non-interactive or auto-accept flag for this gate:
<https://code.claude.com/docs/en/cli-reference>. The implementation therefore
sends one Enter only when the full prompt above matches and option 1 is selected.
If the selector is on option 2 or any other modal is present, it fails closed.

## Successful unattended relaunch

Command:

```console
$ node packages/h2a-cli/dist/bin.js relaunch --apply relaunch-autonomy-uat
[h2a] confirmed force-restart of relaunch-autonomy-uat; its tmux session will be replaced.
[h2a] relaunch-autonomy-uat: Claude stale-session confirmation auto-passed once
[h2a] force-restarted relaunch-autonomy-uat: claude --resume 4c283c4b-c277-4f7c-a70f-91209ca6e90f; objective re-injected; agent WORKING (350ms CPU, composer-text)
[h2a] force-restarted 1/1
```

The wake verifier did not accept Claude's summary compaction as objective work.
It waited through `Compacting conversation` and the queued-message state before
pasting the continuation. The resulting tmux transcript proves a post-resume
tool call and agent response:

```text
✻ Conversation compacted (ctrl+o for history)

❯ /compact
  ⎿  Compacted (ctrl+o to see full summary)
  ⎿  Read package.json (36 lines)

❯ Continue working autonomously on the standing objective in this resumed conversation. Re-read the latest user request, identify the next incomplete step, and
  act on it now. Do not stop at the input prompt or wait for another nudge.

● UAT-WORKING

  Re-read package.json with the Read tool on this resume nudge. Confirmed unchanged: name h2a, version 0.90.0, private workspace root (packages/*, apps/*,
  !apps/focus). No files modified, no destructive commands, no unrelated work started.

✻ Worked for 4s
```

This is bounded UAT, so the test agent returned to its composer after completing
the only authorized objective. The acceptance evidence is the continuation,
post-continuation `Read` tool result, `UAT-WORKING`, and measured process activity;
the relaunch did not report success while the agent was parked at the composer.

## Memory on resume

A headless resume with hook-event output proved that Claude does fire
`SessionStart:resume` hooks:

```console
$ claude -p --resume 4c283c4b-c277-4f7c-a70f-91209ca6e90f --include-hook-events --output-format stream-json --verbose --max-turns 1 'Reply exactly MEMORY-UAT. Do not use tools or modify files.'
{"type":"system","subtype":"hook_started","hook_name":"SessionStart:resume","hook_event":"SessionStart",...}
{"type":"system","subtype":"hook_response","hook_name":"SessionStart:resume","hook_event":"SessionStart","output":"","stdout":"","stderr":"","exit_code":0,"outcome":"success",...}
```

The installed h2a hook is enrollment (`h2a enroll --hook claude-start`), and the
local additional resume hook only runs `h2a presence-reap`. Neither loads
`docs/agents/RECALL.md`. Actor RECALL is currently injected by
`docs/agents/launch.sh` in the fresh-launch prompt. Therefore a resumed Claude
conversation retains whatever actor memory is already in its conversation or
summary, but **does not freshly read current RECALL memory on resume**. Changes to
RECALL made after the original launch are absent unless the standing objective
or another mechanism asks the actor to reload them. That is a real memory gap,
reported here but deliberately not widened into this relaunch fix.

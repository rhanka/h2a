---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-4-8
reviewer-effort: xhigh
target-ref: c57f18db
lens: final contract correctness; target resolution and accurate delivery reporting; real native/tmux wake chain; public contracts; adequacy of the new deliver-hint and CLI auto-detection tests
---

# Final correctness review v2

Independent review of branch-head `c57f18db` and the full feature diff
`0dfc5f75..c57f18db`. No product code was modified; only this stub is written.
Sibling review/consensus files were not inspected. Claims were refuted by
default and only accepted where reproduced from source or from a run.

## Scope verified

- HEAD == `c57f18db` (`git rev-parse HEAD` = `c57f18db4773…`); working tree
  clean except the two untracked `docs/reviews/*` dirs.
- Feature diff touches 37 files (+1437/-164). Product surfaces in lens:
  `packages/h2a/src/runtime/send.ts`, `cli.ts`, `cli-contract.ts`,
  `cli-command-map.ts`, `index.ts`, `mcp.ts`, `runtime/mcp/{handlers,server,stdio,tools}.ts`,
  `runtime/identity/{index,live}.ts`, `runtime/drive/index.ts`,
  `runtime/local-files/paths.ts`, `packages/h2a-runtime/src/{config,tmux}.ts`,
  golden contracts, plugin/mcp manifests, `skills/h2a/SKILL.md`.

## Evidence

### Build + tests (all reproduced locally, node v22.22.1)

- `npm run build --workspace=packages/h2a` → clean (`tsc -b --force`, no errors);
  `dist/` regenerated so tests exercise the target commit's sources.
- `node --test packages/h2a/test/send.test.js` → **8/8 pass** (includes both
  newly-added tests: the deliver-hint accuracy test and the CLI auto-detection test).
- `node --test` over every diff-touched h2a suite (`cli-contract`,
  `dispatch-characterization-goldens`, `m04-wake-characterization`,
  `pty-native-messaging`, `evo-host-setup-wake`, `hosts-integration`,
  `package-plugin-manifest`, `cli-host-status`, `evo12-readonly-allowlist`) →
  **149 pass / 16 skipped / 6 todo / 0 fail**.
- `node --test packages/h2a/test/m04-wake-characterization.test.js` alone →
  **12 pass / 0 fail / 0 skipped / 6 todo**. The chain test (`signed send reaches
  inbox-wake through native-to-real-tmux chain fallback`, `send.test`→m04:721) and
  the real-openpty native test (m04:805) both RAN (not skipped).
- `npx vitest run packages/h2a-runtime/src/{config,tmux}.test.ts` →
  **111 pass / 0 fail**.

### Final contract correctness (`send.ts`)

- `sendLocalMessage` is the single send primitive shared by CLI (`cmdSend`,
  cli.ts:534) and MCP (`handleSend`, handlers.ts:314) — resolution, signing and
  the active-key check cannot drift between surfaces (verified: both call sites
  route through it).
- Order of operations is correct and fail-safe: validate text (non-empty, no NUL,
  ≤64 KiB) → require sender registered → resolve target → refuse `refuse`/`list`
  → build/sign envelope → **verify the signature against the sender's ACTIVE
  registered public keys** (`keyIsActive`, send.ts:145-152) → only then
  `putInboxMessage`. The active-key gate means an instance cannot be spoofed even
  if auto-detection picked the wrong local id: signing only succeeds when the
  local private key matches a live registered key. Reproduced by
  send.test:150 (mismatched key and revoked key both throw before any write).

### Target resolution + accurate delivery reporting (the `c57f18db` fix)

- The fix (send.ts:158-159) special-cases `resolution.kind === "deliver-hint"`
  to report `reason = "live alias resolved directly to <recipient>."`. This is
  **accurate**: for `deliver-hint`, send.ts sets `recipient =
  resolution.liveCandidate` (send.ts:115) and delivers to that live full-id
  inbox — it does NOT deposit to the bare channel. `deliver-hint` is only
  returned when `resolvedLiveMatches.length === 1` (paths.ts:343-358), so the
  recipient is always live → `recipientLive === true`, `dormant === false`.
- Before the fix the reason fell through to `resolution.reason`, which for
  `deliver-hint` reads "…deposited to the channel — prefer re-sending … for
  direct delivery" (paths.ts:356) — a **contradiction** of send's actual direct
  delivery. The fix removes that self-contradiction. This is a genuine
  accuracy correction, not cosmetic.
- The added test (send.test:117) is strong: it asserts the resolution kind,
  recipient, `recipientLive`, `dormant`, the exact reason string, AND both that
  the envelope landed in the full-id inbox and that the bare `claude:receiver`
  channel inbox is empty — pinning the fix's substance (destination + wording).
- Cross-checked every other reported branch for false claims and found none:
  `deliver-resolved`→"display name resolved to…" (recipientLive true);
  `deliver-dormant`→"no live session…" (recipientLive false, dormant true);
  registered-name→"registered name resolved to…" with liveness carried by
  `recipientLive`/`dormant` (send.test:136 confirms a dormant registered name
  never claims live delivery). No branch overstates delivery.

### Real native → tmux wake chain

- `--wake auto` builds `chainDriver(nativePtyBackchannelDriver(log),
  localTmuxDriver({ log }))` (cli.ts:2013-2015). `chainDriver`
  (drive/index.ts:700) is a real sequential fallback: it invokes each driver and
  returns on the first truthy result, else falls through.
- `nativePtyBackchannelDriver` (cli.ts:3656) is a real driver: it spawns the
  native terminal op runtime (`drive --target … --b64 …`), parses the JSON
  `outcome`, returns `true` on `driven`, `undefined` on `unresolved`/runtime-
  unavailable, `false` otherwise. Both `undefined` and `false` let `chainDriver`
  proceed to `localTmuxDriver`, so a native miss genuinely falls back to tmux.
- End-to-end proof (m04:721): a real `sendLocalMessage` is delivered, then an
  inbox-wake handler drives `chainDriver(native(→false), realTmux)`; the test
  asserts `nativeAttempts === 1` ("auto chain tries native before tmux") and then
  independently observes the signed wake bytes arriving at a REAL tmux pane, the
  line verifying against the receiver's key. m04:805 exercises the real native
  openpty leg. Not stubs.
- Defaults flipped consistently local-tmux→auto everywhere: `DEFAULT_H2A_COMMAND`
  (config.ts:156), host-setup render (cli.ts:4280), `.claude-plugin/plugin.json`,
  `.mcp.json`, and `commandNeedsLocalTmuxWake` now also matches `auto`
  (tmux.ts:1853). The unsafe `headless` guidance now points at `auto`
  (cli.ts:2004). Note: `--wake auto` is the *rendered default* of host setup /
  DEFAULT_H2A_COMMAND; bare `mcp-serve` without `--wake` still installs no wake
  driver (cli.ts:2006) — consistent with the requested "wake defaults --wake auto"
  read as the shipped launch command.

### Public contracts

- `index.ts` exports `sendLocalMessage`, `H2A_SEND_MAX_MESSAGE_BYTES`, the four
  send types, and `identityKeyPaths` (promoted from private `keyPaths`,
  live.ts:140 — internal callers updated). MCP surface: `h2a_send` added to
  `H2A_CLI_MCP_TOOL_NAMES` (mcp.ts), descriptor with `required:["to","message"]`,
  `additionalProperties:false` (tools.ts:228), dispatch wired
  (server.ts:190), trusted `sendContext` plumbed CLI→stdio→server
  (never from JSON-RPC args). CLI verb registered in `cli-contract.ts`
  (exitCodes `[0,1,2,3]`) and `cli-command-map.ts` (COORDINATE).
- Golden contracts updated coherently: `cli-verbs.json` +`send` (98→99),
  `mcp-tools.json` +`h2a_send` (37→38), `version-matrix.json` surface counts
  bumped to 99/38. `cli-contract.test` and `dispatch-characterization-goldens`
  pass against them.
- Exit-code contract holds: `cmdSend` returns 0 / 1 (usage, unresolved sender) /
  3 (key unreadable) / `classifyStoreError()∈{1,2}` (send throw) — all within the
  declared `[0,1,2,3]` (`classifyStoreError` return type is `1 | 2`, cli.ts:312).
- **No version bump**: `git diff 0dfc5f75..c57f18db -- '**/package.json'` shows no
  `"version"` change; no added `"version":` lines anywhere except the
  version-matrix surface counters. Requirement satisfied.
- `SKILL.md` public copy now describes `h2a_send({to,message})` with the sidecar
  supplying the signing identity and no unsigned `h2a_inbox put` fallback —
  matches the implementation.

### CLI auto-detection

- `cmdSend` resolves the sender as `--from` → `H2A_INSTANCE` → auto-detect:
  (1) presence session matching `H2A_NATIVE_PTY_SESSION`/`TMUX_PANE`, then
  (2) presence session by `workspace.path === realpathSync(cwd)`, then
  (3) registered instance by `workspace.path === realpathSync(cwd)`; a non-unique
  set fails with exit 1 and lists candidates.
- Path matching is consistent in production: registration/presence store
  `realWorkspacePath(cwd) = realpathSync(cwd)` (live.ts:160,306,313), the same
  canonicalization the auto-detector applies — so a symlinked workspace root does
  not cause a silent mismatch. (Refutes the obvious "raw vs realpath" concern.)
- The added test (send.test:220) covers branch (3): it clears `H2A_INSTANCE`,
  restores it in `t.after`, and asserts `result.from === sender` with one inbox
  message — a valid positive characterization of workspace auto-detection.

## Findings

**MINOR — auto-detection safety branch is untested.** The new CLI test only
exercises the registered-instance-by-workspace path. The ambiguity / no-candidate
guard (`unique.length !== 1` → exit 1 + candidate list, cli.ts:576-582), which is
the branch that prevents signing under a wrong local identity, and the primary
native-PTY/tmux-pane env branch are not characterized. The guard is simple and
fails safe, and the active-key check in `sendLocalMessage` is a second barrier,
so this is coverage debt rather than a defect. (`packages/h2a/test/send.test.js`)

**MINOR — mcp-serve `sendContext` wiring is only tested at the seam.** The
`autoOpen + identityPrivateKeyPem → sendContext` construction (cli.ts:2045-2047)
and the `--wake auto` default render are validated at the handler/config level
(`createMcpServer` with/without `sendContext`, send.test:243; config/tmux tests)
but there is no end-to-end assertion from `mcp-serve` itself. Thin plumbing, low
risk. (`packages/h2a/src/cli.ts`)

**NIT — misleading indentation in the reason ternary.** `send.ts:156-162` is
semantically correct (right-associative: registered-name → deliver-hint →
`resolution.reason` → undefined) but the `: "reason" in resolution` arm is
dedented so it reads as if attached to the wrong branch. Cosmetic.
(`packages/h2a/src/runtime/send.ts:160`)

**NIT — a message beginning with `--` is parsed as an option.** `cmdSend` treats
any `--`-prefixed positional as a flag, so `h2a send claude:x "--foo"` errors
with "unsupported option"; the `--` separator (`h2a send claude:x -- "--foo"`) is
the workaround. Standard CLI behavior with an escape hatch; targets are never
`--`-prefixed. (`packages/h2a/src/cli.ts:558`)

No BLOCKING or MAJOR findings. Refuted candidate concerns: symlink path mismatch
in auto-detection (both sides realpath); exit-code contract overflow
(`classifyStoreError` is `1|2`); stubbed native/tmux chain (proven real,
end-to-end); deliver-hint reason inaccuracy (fixed and tightly tested); silent
version bump (none present).

## Verdict

**GO.**

The feature is contract-correct across CLI, MCP, and library surfaces; the
`c57f18db` deliver-hint fix removes a real reporting contradiction and is pinned
by a substantive test (destination + wording); the native→tmux wake chain is
genuine and proven end-to-end against real tmux and real openpty; public
contracts and goldens are consistent with no version bump; and the two added
tests are correct and adequate for the paths they cover. Remaining findings are
coverage debt and cosmetics, none gating.

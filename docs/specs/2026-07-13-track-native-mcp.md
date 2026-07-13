# Track-native MCP + transition doc (axis ④, MCP half)

Status: design GO (double-consensus closed with reasoned disposition — see §Disposition).
Date: 2026-07-13. Owner: h2a consolidation loop.

## Why

Axis ④ of the single-plugin consolidation ([[single-plugin-consolidation]]) folds
`track` into the one `h2a` plugin. The **CLI-verb half is already done**: `cli.ts`
dispatches track's read + sync-write verbs in-process via track's `runCli`
(`TRACK_NATIVE_VERBS` / `delegateToTrackNative`); only async `focus` keeps the
`spawnSync` facade. The **residual** is the track **MCP server** + a transition doc.

Today the `h2a` plugin's `track` mcpServer launches via
`npx -y -p @sentropic/track track-mcp` — a runtime network fetch/resolve at MCP
startup even though `@sentropic/track` is already a hard dependency of `@sentropic/h2a`.
Make it native.

## Grounded facts (double-consensus)

- track already exposes a library-grade factory `createTrackMcpServer(source:
  string | ResolveOptions): Server` (`packages/track/src/mcp/server.ts:351`), tested
  (`server.test.ts`, `graceful-boot.test.ts`). The `track-mcp` bin (`src/mcp/cli.ts`)
  is a thin bootstrap: resolve opts → factory → `connect(StdioServerTransport)` →
  fatal-catch to **stderr** (so stdout is clean JSON-RPC).
- track's `exports` does NOT expose the factory (only `.`, `./read`, `./ingest`,
  `./seam`, `./report/friendly`) → an additive `./mcp` export is required.
- The plugin ships **source-only (no bundled node_modules)** — that is why today's
  mcpServer uses `npx`. So a `${CLAUDE_PLUGIN_ROOT}/node_modules/.bin/track-mcp` path
  is NOT reliable; the launcher is the globally-installed `h2a` (same model the
  existing `h2a` mcpServer already uses with `command:"h2a"`).
- Long-running stdio verbs dispatch in `bin.ts` with `AbortController` +
  SIGTERM/SIGINT/SIGHUP; a first-word not in the native set routes to the heavy
  runtime (`shouldDispatchRemote`) → exit 127. So the verb must be registered native.

## Decision — in-process `h2a track-mcp`

- Rejected (i) async-spawn wrapper: **doubles the resident node** per plugin load
  (host→h2a→node(track-mcp)) — an OOM regression given [[h2a-resource-governance]].
- Rejected (iii) `${CLAUDE_PLUGIN_ROOT}/.bin`: no bundled node_modules.
- **Chosen (ii): `h2a track-mcp` runs track's MCP server IN-PROCESS** via the reused
  factory. Footprint = 1 node (the h2a process hosting track's server) — identical to
  today's npx-track process. No wrapper, no spawn, no bin resolution.

## Slices (reversible, tested, 1 commit each)

**S1 — track: additive `./mcp` export + abortable stdio serve helper.**
- package.json exports: `"./mcp": { "types": "./dist/mcp/serve.d.ts", "import":
  "./dist/mcp/serve.js" }` exposing `createTrackMcpServer` + a new
  `serveTrackMcpStdio(resolveOpts, opts?: { signal?: AbortSignal }): Promise<void>`.
- `serveTrackMcpStdio` mirrors cli.ts (factory → `connect(new StdioServerTransport())`
  → fatal-catch to stderr) AND, on `opts.signal` abort, closes the transport/server
  and resolves. Refactor `src/mcp/cli.ts` to call it (single source, no dup) passing
  no signal (bin keeps process-lifetime semantics).
- Additive only; existing `track-mcp` bin behavior unchanged. Test: import via the new
  export + JSON-RPC `initialize` smoke + an abort-closes-cleanly test. Bump track patch.

**S2 — h2a: native async `track-mcp` verb (ship in a RELEASED h2a BEFORE S3).**
- Register `track-mcp` in the frozen CLI contract (`cli-contract.ts`) + golden
  `cli-verbs.json` + `BIN_HARD_NATIVE_FIRST_WORDS` (so `shouldDispatchRemote` never
  routes it to the runtime → no exit 127).
- Async branch in `bin.ts` (like `mcp-serve`): create an `AbortController`; on
  SIGTERM/SIGINT/SIGHUP call `abort()`; lazy-import track's `./mcp` `serveTrackMcpStdio`
  and `await` it with the signal; forward `--track-dir` / `TRACK_DIR`. Assert h2a writes
  **nothing to stdout** on this path (JSON-RPC purity; track already logs to stderr).
  Fatal import/serve failure → rc=1 + stderr.
- **Bump h2a's `@sentropic/track` dependency floor** to the S1-published version (the
  one with the `./mcp` export) so a fresh install cannot resolve a track without it.
- Test: contract/golden update + JSON-RPC `initialize` smoke over the verb.

**S3 — plugin.json repoint (LATER release, after S2 is PUBLISHED).**
- `track` mcpServer → `{ "command": "h2a", "args": ["track-mcp"] }` (drop npx).
- Reconcile plugin.json `version` (0.85.1) with the package version at that point.
- NOT bundled with S2: `command:"h2a" args:[track-mcp]` needs the global h2a to already
  carry the verb (peer must-fix #4). This is a released-to-users change: git-revertible
  but not un-pullable — hence the sequencing.

**S4 — remove/tombstone orphan `packages/track/.claude-plugin/plugin.json`.**
- FIRST grep the whole repo (scripts, docs, tests, release packaging, CI) for any
  reference; delete only if zero consumers. If external git users may reference it,
  keep a tombstone (deprecated stub pointing at the `h2a` plugin) rather than a silent
  delete. Released-to-users → same not-un-pullable caveat.

**S5 — transition doc** `docs/… /track-native-transition.md` — with **concrete steps**:
minimum h2a version; how to find + remove a standalone `track` MCP entry from the host
config (Claude `~/.claude.json` / settings mcpServers, Codex, Gemini); how to drop the
standalone track plugin; `h2a install-skills` for skills; command examples.

**S6 — `install-skills` audit — VERIFIED COMPLETE (2026-07-13, no change needed).**
The audit found `h2a install-skills` already renders all three single sources on
demand: h2a's own `skills/`, `@sentropic/track`'s shipped `skills/` (present-decision,
propose-workpackages, branch-lifecycle, track-operation — native names, resolved via
`resolvePackageSkillsDir`), and the harness pack under the `harness-<name>` prefix
(`collectInstallableSkills` in cli.ts). All review concerns are already handled:
per-host target paths (`targetSpecFor`, user/project scope); idempotency + collision
policy (probe target → **skip unless `--force`**, so user-edited files are never
clobbered); legacy prune (DEC-057); provenance in the JSON output. Coverage exists:
`packages/h2a/test/install-skills-hosts.test.js` asserts the h2a+track+harness render
across claude/codex/gemini + project scope. A live smoke confirmed 12 skills rendered
(1 h2a + 4 track + 7 harness, `ok:true`). No new design or code required.

## Disposition of the closure (NO-GO) review

The machine closure leg returned NO-GO; two of its blockers are scope disagreements,
resolved here with reasoning (a reviewer's NO-GO is input, not a verdict):

- **`command:"h2a"` PATH binding (its #1, "OPEN")** — a **pre-existing plugin-wide**
  condition: the `h2a` mcpServer already uses `command:"h2a"`. S3 moves `track` from
  `npx` (network-resolve risk) to that SAME model — not a net-new regression. Proper
  hardening (bundle node_modules + `${CLAUDE_PLUGIN_ROOT}/.bin`, or a documented
  official global install) applies to BOTH servers and is tracked as a **separate**
  item, not a blocker for ④'s MCP cutover.
- **`install-skills` contract (its #5, "OPEN")** — explicitly **out of scope** (S6, own
  design). Conflating it with the MCP cutover is scope creep; S1–S5 don't depend on it.

Folded refinements (accepted): dependency-floor pin (S2), `AbortSignal` in
`serveTrackMcpStdio` (S1/S2), precise reversibility wording + orphan tombstone (S3/S4),
concrete transition-doc removal steps (S5), JSON-RPC `initialize` smoke tests (S1/S2).
Deferred nice-to-have: npm-pack/global/pnpm/Windows packaged smoke in CI (post-S3).

## Reversibility / gating

Every slice is git-revertible. S1/S2 are pure additive/local (no user-visible cutover).
S3/S4 are released-to-users (revertible in a later release, not un-pullable) → gated
behind S2's publish. None is an ⑤ (irreversible) decision → no Fabien-GO gate; but S3
MUST follow S2's release (ordering, not optional).

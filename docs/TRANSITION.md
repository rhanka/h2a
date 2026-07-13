# h2a consolidation — transition guide

Status: LIVE (transition in progress). Audience: humans **and** agents who used the
`remote` and `track` CLIs and are moving to `h2a`. Docs only — describes what ships
today; the irreversible steps are listed as **Pending** at the bottom and are **not**
done.

## 1. TL;DR — what changed

`h2a` is becoming **the single CLI of sentropic** (one plugin). It now covers the
surfaces that used to live in the `remote` and `track` CLIs, plus two new ones
(canevas, objective-loop).

- **Nothing breaks.** `remote` and `track` remain installed and usable exactly as
  before. `h2a` is additive.
- **No data migration today.** The `.track` store and the remote local state are
  untouched and shared.
- **No action required** from you right now. Prefer `h2a …` for new muscle memory;
  keep using `remote`/`track` where you already do.

| Axis | Surface | Today |
|---|---|---|
| ① objective-loop | `h2a loop …` | new, MVP (dry-run default) |
| ② remote | `h2a run/ls/attach/logs/…` | full parity via fallback routing |
| ③ canevas | `h2a canevas serve/list` | new decision surface (127.0.0.1) |
| ④ track | `h2a report/query/item/…` | 11/12 verbs native in-process |

## 2. Track (axis ④)

The 12 track verbs are reachable under `h2a`, 1:1 pass-through, same arguments,
same exit codes, same JSON:

```
h2a query · report · decision · item · accept · blocker
    consolidate · priority · branch · ingest · restructure · focus
```

- **11/12 run NATIVE, in-process** (no child process) via `@sentropic/track`'s
  `runCli`: the two read-only verbs (`query`, `report`) and the nine sync writes
  (`decision`, `item`, `accept`, `blocker`, `consolidate`, `priority`, `branch`,
  `ingest`, `restructure`).
- **`focus` still shells out** to the `track` CLI — it is the only async track verb
  (`import('@sentropic/focus')` → Promise), so it is deliberately kept off the sync
  native path.
- **Store `.track` is UNCHANGED** — total compat, **zero migration**. Same event
  log, same head, same schema. Native and CLI writes both bind the same store under
  track's single **O_EXCL** lock (single-writer preserved), so they cannot corrupt
  or double-write each other.
- **The `track` CLI stays** for direct use, skills, and `track-mcp`. De-spawning is
  an internal h2a optimisation, not a removal of the CLI.

**Track MCP — now served natively (`h2a track-mcp`).** The read-only track MCP is
bundled into the single `h2a` plugin and, from **0.85.15**, is served IN-PROCESS by
the new `h2a track-mcp` verb — the native equivalent of `npx -p @sentropic/track
track-mcp`, with no runtime npm fetch and no doubled resident node (it reuses
`@sentropic/track`'s server via the additive `@sentropic/track/mcp` export). The
`sentropic` marketplace ships **one** plugin (`h2a`) carrying both MCP servers
(`h2a` + `track`); the standalone `track` plugin manifest
(`packages/track/.claude-plugin/plugin.json`) was **removed** — it was orphaned
(never in the marketplace, never published: track's npm `files` excludes
`.claude-plugin`).

- **Plugin cutover.** In **0.85.16** the `h2a` plugin's `track` mcpServer repoints
  from `npx -y -p @sentropic/track track-mcp` to `{ "command": "h2a", "args":
  ["track-mcp"] }`. This is sequenced ONE release AFTER the verb shipped (0.85.15),
  so a global `h2a` already updated to ≥0.85.15 carries the verb. **Minimum `h2a`
  for the native serve: 0.85.15.**
- **If you added a standalone track MCP** to your host config, you can drop it — the
  `h2a` plugin already serves it. Remove the `track` entry from your host's
  `mcpServers` (Claude: `~/.claude.json` or the plugin's config; Codex:
  `~/.codex/config.toml`; Gemini: its MCP settings), and uninstall any standalone
  `track` plugin (`claude plugin uninstall track`). Skills are rendered by
  `h2a install-skills`.

⚠️ **For a human status report** use `track report` (or `h2a report`) → renders the
FAIT / À-FAIRE / DÉCISIONS table. Do **not** use:
- the MCP tool `track_report` — it returns machine JSON, not a human table;
- `--flat` — bullet output, deprecated. Use the default (table) or `--wp`.

Reference: `docs/specs/2026-06-29-h2a-track-facade.md` (§ "Native track integration").

## 3. Remote (axis ②)

Every remote verb is reachable under `h2a` by **fallback routing**: any first word
that is not an h2a-native verb is dispatched to the runtime (ex-`remote`) via
`dispatchRemote()`. There is no allowlist to keep in sync — new remote verbs work
automatically.

```
h2a run <cli> · ls · attach · logs · stop · resume · jobs · delegate
    workspace · sync · migrate · forward · config · auth · plugin
    gateway · wake · ping · status · layout · restore · link · lineage
```

- **Local state is SHARED** at `~/.config/sentropic/remote-cli/`. `remote …` and
  `h2a …` read/write the same sessions and config, so **no reprise / no data move**
  is needed as long as that path is not renamed (see Pending 7b).
- **The `remote` bin stays deployed** for compat. Live Pod sessions are untouched —
  only the CLI front changes; both CLIs list/attach/resume the same sessions.

Reference: `packages/h2a/src/bin-routing.ts` (`shouldDispatchRemote`),
`docs/specs/2026-06-29-h2a-remote-merge-map.md`.

## 4. Canevas (axis ③) — new

A local decision surface that pools the pending decisions (escalations) waiting on a
human from **all** agents.

- `h2a canevas serve` — serves a local web page on `http://127.0.0.1:8788`
  (127.0.0.1 strict, never a public interface). You can:
  - see all pending decisions, ordered alert > decide > advise then oldest-first;
  - swipe through them and open the corresponding CLI session (read-only tmux pane
    snapshot);
  - **reply** — the answer is posted back to the live agent. The reply bridge is
    gated by a **per-run write token** printed on stderr at startup (the same-origin
    page carries it; cross-origin cannot write).
- `h2a canevas list` — the same aggregate as JSON (`kind: canevas-decisions`).

Source today = `escalate` envelopes; `track`/`loop` are additive adapters.
Reference: `packages/h2a/src/runtime/canevas/*`,
`docs/specs/2026-06-27-h2a-canevas-evo4-decision-screen.md`.

## 5. Objective-loop (axis ①) — new, MVP

A durable, host-independent loop that drives one or more agents toward an objective
(replaces the Claude-centric `/loop`).

- `h2a loop create` — create a durable loop under `<root>/loops/<loopId>/`.
- `h2a loop list` · `loop status <loopId>` · `loop agents <loopId>` — inspect the
  loop and the agents enrolled in it.
- `h2a loop tick <loopId>` — gather agents + track refs + inbox and return the
  decision plan. **DRY-RUN by default**; `--execute` runs one guarded plan.
- `h2a loop watch <loopId>` / `h2a loop run <loopId>` — foreground controller:
  executes guarded relance ticks at `policy.tickMs` (or `--interval-ms`) until the
  loop status is terminal/done, `--max`, or a stop signal. Use `--dry-run` for
  observation-only JSONL.

Reference: `docs/specs/2026-06-26-objective-loop-h2a-track-remote.md`.

## 6. Deprecations & compat

What is deprecated is the **standalone role**, not the CLIs themselves.

| Item | State |
|---|---|
| `remote` bin | Works. Compat shim direction; no removal scheduled. |
| `track` / `track-mcp` bins | Works. **Standalone role deprecated (axis ④-D)** — `h2a` is the single entry. Bins stay callable for skills, humans, `track-mcp`, and external `.track` repos; no removal scheduled. |
| `.track` store format | Unchanged. Append-only, single-writer, no migration. |
| `~/.config/sentropic/remote-cli/` | Unchanged, shared by both CLIs. |
| `track_report` MCP tool for human reports | Discouraged (machine JSON). Use `track report` / `h2a report`. |
| `track report --flat` | Deprecated (bullets). Use the default table or `--wp`. |

**No action is required from users today.** Everything above continues to work as-is.

## 7. Pending — needs Fabien's go (irreversible)

The steps below are **NOT done**. They touch live sessions / infra, so they are
reserved for an explicit human decision (see the 9 "décisions irréversibles-produit"
in `docs/specs/2026-06-29-h2a-migration-track-remote.md`). Each is described so it is
ready to execute on the go.

### 7a. Monorepo fusion of track + deprecate the `track` bin
- **Changes for you:** `@sentropic/track` folded into the h2a monorepo; the public
  `track` bin eventually becomes a shim to `h2a …` and, in a later window, is
  retired.
- **Migration plan:** keep both bins through a green compat matrix; publish `track`
  as a shim first; announce a deprecation window; retire only after the window. The
  `.track` store format does not change, so **no store migration** is involved.

**Kicked off (axis ④-D, doc-level, reversible).** The *standalone role* of the
`track` / `track-mcp` bins is now formally deprecated in favour of `h2a` as the
single entry (see §6). This is the same posture as `remote → h2a-runtime` and
`h2a-cli → @sentropic/h2a`: only the standalone role is deprecated — **the bins
stay callable** for skills, `track-mcp`, humans, and every external repo with a
`.track/`. The functional absorption is already shipped (11/12 verbs run native
in-process via `@sentropic/track`'s `runCli`, axis ④).

**Repo move — DONE (in-repo, reversible).** `rhanka/track` was folded into the
monorepo as a **history-preserving `git subtree`** at `packages/track/` and wired
as an npm workspace (`@sentropic/track`). The toolchain difference is tolerated in
place (track keeps its own `tsconfig.build.json` + vitest, pinned TS 6 /
`@types/node` 25; the monorepo core stays on TS 5.9 / `@types/node` 22 /
`node:test`), and the root `build` compiles track first (`npm run build -w
@sentropic/track && tsc -b`). `@sentropic/track` ships light runtime deps only
(`@modelcontextprotocol/sdk`, `ulid`), so nothing heavy crosses the boundary.
Build + both test suites are green (h2a `node:test`; track `vitest`).

**Marketplace — RELOCATED to the monorepo (in-repo, reversible).** The Claude Code
`sentropic` marketplace manifest moved from `packages/track/.claude-plugin/
marketplace.json` to the **monorepo root** `.claude-plugin/marketplace.json`, and
the catalogue was since consolidated to a **single `h2a` plugin** that bundles both
MCP servers (see §2); the standalone `track` plugin manifest
(`packages/track/.claude-plugin/plugin.json`) was removed as an orphan. A `claude
plugin marketplace add rhanka/h2a` exposes the full catalogue with no dependency on
`rhanka/track`. The `track-mcp` server is now served **natively** by the `h2a`
plugin (`h2a track-mcp`, 0.85.15+ — see §2), replacing the earlier
`npx -y -p @sentropic/track track-mcp`. Plugin/package `homepage`,
`repository`, and `bugs` URLs were re-homed to `rhanka/h2a` (directory
`packages/track`). **Impact on existing installs:** anyone who did `claude plugin
marketplace add rhanka/track` keeps working while that repo exists; once it is
archived/deleted they re-run `… add rhanka/h2a` (new installs should use
`rhanka/h2a` directly). The installed `track` plugin's MCP tools keep working
regardless, since they pull `@sentropic/track` from npm.

**Release — WIRED for lockstep (in-repo, ready-to-publish).** `@sentropic/track`
is now part of the monorepo lockstep release: `packages/track/package.json` is in
`scripts/release.mjs`'s `PACKAGE_FILES`, the `@sentropic/track` caret in
`@sentropic/h2a` is bumped with the version, and `.github/workflows/release.yml`
gates track's version against the tag and publishes it (first, before `h2a`).
The first lockstep tag brings track from its standalone line up to the monorepo
version.

**Reserved / irreversible (Fabien only, explicit go):**
- **Re-point npm Trusted Publishing** for `@sentropic/track` from `rhanka/track`
  to `rhanka/h2a` + `release.yml` (a creds gesture on npmjs.com). Until then the
  track publish step in `release.yml` fails on OIDC mismatch; a fallback npm
  automation token is the alternative. See `docs/release.md`.
- **Republish** `@sentropic/track` from the monorepo path (happens on the first
  lockstep tag once OIDC is re-pointed).
- **`npm deprecate` / archive** of the standalone `rhanka/track` repo, and
  closing the `track` bin deprecation window.
None of these is done here.

### 7b. Rename config path `remote-cli` → `h2a` + auto-migrate live sessions
- **Changes for you:** the shared local state moves from
  `~/.config/sentropic/remote-cli/` to a `h2a` path. Until this happens, both CLIs
  share the current path and nothing moves.
- **Migration plan:** on update, auto-migrate live sessions and config to the new
  path (copy-then-switch, keep a back-compat read of the old path during the
  window). Reprise policy for existing remote sessions is a reserved decision.

### 7c. Decommission local `remote` + switch the k8s control-plane
- **Changes for you:** the local `remote` execution path is retired and the
  control-plane bascule happens behind `h2a`; live Pod sessions must survive the
  switch.
- **Migration plan:** canary first — old `remote` and new `h2a` list/attach/resume
  the **same** sessions; the Pod bridge is versioned separately and rolled out
  progressively; the IAM/security model of the bridge is a reserved decision. No
  decom before the canary is green **and** Fabien gives the go. Any destructive
  GC / canonical-root step stays gated (never without Fabien).

> None of 7a–7c has shipped. This guide documents the transition state only.

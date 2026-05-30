# Drumbeat D5 — Reflexive Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a pluggable, opt-in judgment step into `drumbeat watch` so a stalled agent can be relanced / finished / escalated / rerouted instead of always relanced.

**Architecture:** A pure core parser (`parseReflexiveDecision`) + a CLI-runtime `ReflexiveDecider` (logging default, headless-host-CLI adapter). `drumbeatTick` consults the decider only after K relances, logs every decision (`decided` vs `applied`) to `decisions.jsonl`, and applies the action only under `--decider-enforce`; reroute is advisory (raises a blockage, no launchContext hand-off). Spec: `docs/superpowers/specs/2026-05-29-d5-reflexive-watchdog-design.md`.

**Tech Stack:** TypeScript, Node ≥ 24, `node:test`, 2-package monorepo (`@sentropic/h2a` pure core + `@sentropic/h2a-cli`), zero runtime deps. No AI co-authoring trailers in commits.

---

## File Structure

- `packages/h2a/src/drumbeat-decision.ts` (NEW) — pure: `H2AReflexiveAction`, `H2AReflexiveDecision`, `parseReflexiveDecision`.
- `packages/h2a/src/index.ts` (MODIFY) — export the above.
- `packages/h2a/test/drumbeat-decision.test.js` (NEW) — parser tests.
- `packages/h2a-cli/src/runtime/drumbeat/deciders.ts` (NEW) — `ReflexiveDecider`, `loggingDecider`, `subagentDecider`, `DeciderRuntime`.
- `packages/h2a-cli/src/runtime/drumbeat/decisions.ts` (NEW) — `H2ADrumbeatDecisionRecord`, `recordDrumbeatDecision`, `listDrumbeatDecisions` (writes `<root>/.h2a/drumbeat/decisions.jsonl`, same dir style as `registry.ts`).
- `packages/h2a-cli/src/runtime/drumbeat/watch.ts` (MODIFY) — K-gate + decider consult + advisory/enforce dispatch + terminal marking + audit.
- `packages/h2a-cli/src/runtime/drumbeat/index.ts` (MODIFY) — re-export deciders + decisions.
- `packages/h2a-cli/src/runtime/escalation/registry.ts` (MODIFY) — add `"watchdog-escalate"` to `H2AEscalationReason`.
- `packages/h2a-cli/src/cli.ts` (MODIFY) — `runDrumbeatWatch`: parse `--decider/--decider-after/--decider-enforce`, build the decider, wire `onEscalate`/`onReroute`; update the `--help` line.
- `packages/h2a-cli/src/cli-contract.ts` (MODIFY) — `drumbeat watch` optionalFlags.
- `packages/h2a-cli/test/drumbeat-deciders.test.js` (NEW), `packages/h2a-cli/test/drumbeat-watch-d5.test.js` (NEW).
- `DECISIONS.md` (MODIFY) — DEC-111.

---

## Task 1: Core — `parseReflexiveDecision`

**Files:**
- Create: `packages/h2a/src/drumbeat-decision.ts`
- Modify: `packages/h2a/src/index.ts`
- Test: `packages/h2a/test/drumbeat-decision.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/h2a/test/drumbeat-decision.test.js
import assert from "node:assert/strict";
import test from "node:test";
import { parseReflexiveDecision } from "../dist/index.js";

test("parses each valid action", () => {
  for (const action of ["relance", "finish", "escalate", "reroute"]) {
    const d = parseReflexiveDecision(JSON.stringify({ action, reason: "x" }));
    assert.equal(d.action, action);
    assert.equal(d.reason, "x");
  }
});

test("unknown action → relance (safe fallback)", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ action: "nuke" })).action, "relance");
});

test("missing action → relance", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ reason: "x" })).action, "relance");
});

test("malformed JSON → relance, never throws", () => {
  assert.equal(parseReflexiveDecision("not json").action, "relance");
  assert.equal(parseReflexiveDecision("").action, "relance");
});

test("reason is optional and omitted when absent", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ action: "finish" })).reason, undefined);
});

test("tolerates a JSON object embedded in surrounding text", () => {
  const d = parseReflexiveDecision('Here is my call:\n{"action":"escalate","reason":"stuck"}\nthanks');
  assert.equal(d.action, "escalate");
  assert.equal(d.reason, "stuck");
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npm run build && node --test packages/h2a/test/drumbeat-decision.test.js`
Expected: FAIL (`parseReflexiveDecision` is not exported).

- [ ] **Step 3: Write the implementation**

```ts
// packages/h2a/src/drumbeat-decision.ts
/**
 * Drumbeat D5 (reflexive watchdog) — pure parsing of a decider's verdict. The
 * decider (a CLI-runtime adapter, often a headless host CLI) returns free-ish
 * text containing a JSON object; this turns it into a typed decision. Total —
 * never throws: anything unrecognised maps to the safe default `relance`
 * (mirrors `parseOrgManifest`). No I/O, no dependency.
 */

export const H2A_REFLEXIVE_ACTIONS = ["relance", "finish", "escalate", "reroute"] as const;
export type H2AReflexiveAction = (typeof H2A_REFLEXIVE_ACTIONS)[number];

export interface H2AReflexiveDecision {
  readonly action: H2AReflexiveAction;
  readonly reason?: string;
}

const RELANCE: H2AReflexiveDecision = { action: "relance" };

/** Extract the first balanced top-level `{...}` JSON object from `text`, or undefined. */
function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Parse a decider's output into a typed decision. Unknown/missing action,
 * malformed JSON, or no JSON at all → `{ action: "relance" }` (never throws).
 */
export function parseReflexiveDecision(text: string): H2AReflexiveDecision {
  const json = firstJsonObject(text);
  if (!json) return RELANCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return RELANCE;
  }
  if (typeof parsed !== "object" || parsed === null) return RELANCE;
  const obj = parsed as { action?: unknown; reason?: unknown };
  if (!H2A_REFLEXIVE_ACTIONS.includes(obj.action as H2AReflexiveAction)) return RELANCE;
  return {
    action: obj.action as H2AReflexiveAction,
    ...(typeof obj.reason === "string" ? { reason: obj.reason } : {})
  };
}
```

Add to `packages/h2a/src/index.ts` (near the org exports):

```ts
export { H2A_REFLEXIVE_ACTIONS, parseReflexiveDecision } from "./drumbeat-decision.js";
export type { H2AReflexiveAction, H2AReflexiveDecision } from "./drumbeat-decision.js";
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm run build && node --test packages/h2a/test/drumbeat-decision.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/h2a/src/drumbeat-decision.ts packages/h2a/src/index.ts packages/h2a/test/drumbeat-decision.test.js
git commit -m "feat(d5): core parseReflexiveDecision (pure, total) for the reflexive watchdog"
```

---

## Task 2: CLI runtime — deciders

**Files:**
- Create: `packages/h2a-cli/src/runtime/drumbeat/deciders.ts`
- Modify: `packages/h2a-cli/src/runtime/drumbeat/index.ts`
- Test: `packages/h2a-cli/test/drumbeat-deciders.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/h2a-cli/test/drumbeat-deciders.test.js
import assert from "node:assert/strict";
import test from "node:test";
import { loggingDecider, subagentDecider } from "../dist/index.js";

const finding = { instance: "claude:p1", reason: "out-of-tokens", workStatus: "out-of-tokens", relanceCount: 2 };

test("loggingDecider always relances", async () => {
  assert.equal((await loggingDecider().decide(finding)).action, "relance");
});

test("subagentDecider maps the command's JSON stdout to a decision", async () => {
  const runtime = { run: () => ({ status: 0, stdout: '{"action":"escalate","reason":"stuck"}' }) };
  const d = await subagentDecider({ command: "fake-cli", runtime }).decide(finding);
  assert.equal(d.action, "escalate");
  assert.equal(d.reason, "stuck");
});

test("subagentDecider → relance on non-zero exit", async () => {
  const runtime = { run: () => ({ status: 1, stdout: "" }) };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider → relance on garbage stdout", async () => {
  const runtime = { run: () => ({ status: 0, stdout: "no json here" }) };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider → relance when the runtime throws (timeout/spawn error)", async () => {
  const runtime = { run: () => { throw new Error("ETIMEDOUT"); } };
  assert.equal((await subagentDecider({ command: "x", runtime }).decide(finding)).action, "relance");
});

test("subagentDecider passes the finding context to the command", async () => {
  let seen;
  const runtime = { run: (cmd, prompt) => { seen = { cmd, prompt }; return { status: 0, stdout: '{"action":"finish"}' }; } };
  await subagentDecider({ command: "judge-cli", runtime }).decide(finding);
  assert.equal(seen.cmd, "judge-cli");
  assert.match(seen.prompt, /claude:p1/);
  assert.match(seen.prompt, /out-of-tokens/);
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-deciders.test.js`
Expected: FAIL (`loggingDecider`/`subagentDecider` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// packages/h2a-cli/src/runtime/drumbeat/deciders.ts
/**
 * Drumbeat D5 — the reflexive decider adapters. Mirrors the relauncher pattern:
 * a `ReflexiveDecider` decides what to do with a stalled finding. `loggingDecider`
 * is the opt-out default (always `relance` → today's behaviour). `subagentDecider`
 * shells out a host CLI headless and parses its verdict; ANY failure (non-zero
 * exit, timeout, unparseable) falls back to `relance` — never worse than today.
 */

import { spawnSync } from "node:child_process";

import { parseReflexiveDecision, type H2AReflexiveDecision } from "@sentropic/h2a";

import type { H2ADrumbeatFinding } from "./scan.js";

export interface ReflexiveDecider {
  decide(finding: H2ADrumbeatFinding): H2AReflexiveDecision | Promise<H2AReflexiveDecision>;
}

/** Opt-out default: never judges, always relance (behaviour identical to pre-D5). */
export function loggingDecider(): ReflexiveDecider {
  return { decide: () => ({ action: "relance" }) };
}

/** Injected so tests need no real CLI. `run` returns the command's exit + stdout. */
export interface DeciderRuntime {
  run(command: string, prompt: string, timeoutMs: number): { status: number | null; stdout: string };
}

const defaultDeciderRuntime: DeciderRuntime = {
  run(command, prompt, timeoutMs) {
    // Foreground, stdin closed (`</dev/null` equivalent: input ""), bounded.
    const r = spawnSync(command, { input: `${prompt}\n`, encoding: "utf8", timeout: timeoutMs, shell: true });
    return { status: r.status, stdout: r.stdout ?? "" };
  }
};

function buildPrompt(finding: H2ADrumbeatFinding): string {
  return [
    "A coordinated agent has stalled. Decide what the watchdog should do.",
    "Reply with ONE JSON object: {\"action\": \"relance|finish|escalate|reroute\", \"reason\": \"<one line>\"}.",
    "- relance: retry it. finish: it already completed. escalate: a human must look. reroute: hand the work to a peer.",
    "",
    `instance: ${finding.instance}`,
    `reason: ${finding.reason}`,
    `workStatus: ${finding.workStatus}`,
    `relanceCount: ${finding.relanceCount}`,
    `launchContext: ${JSON.stringify(finding.launchContext ?? null)}`
  ].join("\n");
}

export interface SubagentDeciderOptions {
  readonly command: string;
  readonly runtime?: DeciderRuntime;
  readonly timeoutMs?: number;
}

export function subagentDecider(options: SubagentDeciderOptions): ReflexiveDecider {
  const runtime = options.runtime ?? defaultDeciderRuntime;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    decide(finding) {
      try {
        const { status, stdout } = runtime.run(options.command, buildPrompt(finding), timeoutMs);
        if (status !== 0) return { action: "relance" };
        return parseReflexiveDecision(stdout);
      } catch {
        return { action: "relance" };
      }
    }
  };
}
```

Add to `packages/h2a-cli/src/runtime/drumbeat/index.ts`:

```ts
export { loggingDecider, subagentDecider } from "./deciders.js";
export type { ReflexiveDecider, DeciderRuntime, SubagentDeciderOptions } from "./deciders.js";
```

Verify `packages/h2a-cli/src/index.ts` re-exports from `./runtime/drumbeat/index.js` (it already re-exports relaunchers from there); if it uses a named list, add `loggingDecider`, `subagentDecider`, and the types so the test can import from `../dist/index.js`.

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-deciders.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/h2a-cli/src/runtime/drumbeat/deciders.ts packages/h2a-cli/src/runtime/drumbeat/index.ts packages/h2a-cli/src/index.ts packages/h2a-cli/test/drumbeat-deciders.test.js
git commit -m "feat(d5): reflexive decider adapters (logging default + headless subagent, fallback relance)"
```

---

## Task 3: Decision audit log

**Files:**
- Create: `packages/h2a-cli/src/runtime/drumbeat/decisions.ts`
- Modify: `packages/h2a-cli/src/runtime/drumbeat/index.ts`
- Test: `packages/h2a-cli/test/drumbeat-deciders.test.js` (append)

- [ ] **Step 1: Write the failing test (append to the deciders test file)**

```js
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDrumbeatDecision, listDrumbeatDecisions } from "../dist/index.js";

test("decision audit log round-trips decided vs applied", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-d5-"));
  const root = join(dir, ".h2a");
  try {
    recordDrumbeatDecision(root, {
      instance: "claude:p1", decided: "finish", applied: "escalate",
      reason: "looked done", decider: "subagent", enforced: false, at: "2026-05-30T00:00:00.000Z"
    });
    const rows = listDrumbeatDecisions(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].decided, "finish");
    assert.equal(rows[0].applied, "escalate");
    assert.equal(rows[0].enforced, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-deciders.test.js`
Expected: FAIL (`recordDrumbeatDecision` not exported).

- [ ] **Step 3: Write the implementation**

```ts
// packages/h2a-cli/src/runtime/drumbeat/decisions.ts
/**
 * Drumbeat D5 — append-only decision log. One record per consulted finding, so
 * the operator can audit WHY the watchdog did what it did. `decided` is the
 * decider's verdict; `applied` is what the watch actually did (advisory default
 * or the enforced action after guards). Same dir + file style as `registry.ts`.
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { H2AReflexiveAction } from "@sentropic/h2a";

import { localStorePaths } from "../local-files/paths.js";

export interface H2ADrumbeatDecisionRecord {
  readonly instance: string;
  readonly decided: H2AReflexiveAction;
  readonly applied: H2AReflexiveAction;
  readonly reason?: string;
  readonly decider: string;
  readonly enforced: boolean;
  readonly at: string;
}

function decisionsFile(root: string): string {
  return join(localStorePaths(root).drumbeat, "decisions.jsonl");
}

export function recordDrumbeatDecision(root: string, record: H2ADrumbeatDecisionRecord): void {
  mkdirSync(localStorePaths(root).drumbeat, { recursive: true });
  appendFileSync(decisionsFile(root), `${JSON.stringify(record)}\n`, "utf8");
}

export function listDrumbeatDecisions(root: string): H2ADrumbeatDecisionRecord[] {
  const file = decisionsFile(root);
  if (!existsSync(file)) return [];
  const out: H2ADrumbeatDecisionRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as H2ADrumbeatDecisionRecord);
    } catch {
      // skip malformed
    }
  }
  return out;
}
```

Add to `packages/h2a-cli/src/runtime/drumbeat/index.ts` (and the cli `index.ts` re-export list):

```ts
export { recordDrumbeatDecision, listDrumbeatDecisions } from "./decisions.js";
export type { H2ADrumbeatDecisionRecord } from "./decisions.js";
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-deciders.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/h2a-cli/src/runtime/drumbeat/decisions.ts packages/h2a-cli/src/runtime/drumbeat/index.ts packages/h2a-cli/src/index.ts packages/h2a-cli/test/drumbeat-deciders.test.js
git commit -m "feat(d5): append-only drumbeat decision audit log (decided vs applied)"
```

---

## Task 4: `drumbeatTick` — K-gate, advisory/enforce, dispatch

**Files:**
- Modify: `packages/h2a-cli/src/runtime/drumbeat/watch.ts`
- Test: `packages/h2a-cli/test/drumbeat-watch-d5.test.js`

The current `drumbeatTick` relances every finding. Extend `DrumbeatTickOptions` with the decider and effect hooks, keeping watch.ts store-free (escalate/reroute are injected, like the existing `onExhausted`). Default `deciderAfter` = 1.

- [ ] **Step 1: Write the failing tests**

```js
// packages/h2a-cli/test/drumbeat-watch-d5.test.js
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { drumbeatTick, recordStop, markRelanced, readDrumbeatEntry, listDrumbeatDecisions } from "../dist/index.js";

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-d5w-"));
  return { dir, root: join(dir, ".h2a") };
}
const relauncher = { relance: () => true };
const fixed = Date.parse("2026-05-30T00:00:00.000Z");

// helper: seed a stopped entry already relanced `n` times
function seed(root, instance, workStatus, n) {
  recordStop(root, { instance, workStatus, launchContext: { command: "echo hi" } }, fixed);
  for (let i = 0; i < n; i++) markRelanced(root, instance, fixed);
}

test("below --decider-after the decider is never consulted", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 0); // relanceCount 0 < K(1)
    let called = false;
    const decider = { decide: () => { called = true; return { action: "escalate" }; } };
    const r = await drumbeatTick(root, relauncher, { decider, deciderAfter: 1, enforce: true, now: fixed });
    assert.equal(called, false);
    assert.deepEqual(r.relanced, ["a:1"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("advisory mode: decider consulted, logged, but safe default (relance) applied", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1); // >= K
    const decider = { decide: () => ({ action: "escalate", reason: "stuck" }) };
    const r = await drumbeatTick(root, relauncher, { decider, deciderAfter: 1, enforce: false, now: fixed });
    assert.deepEqual(r.relanced, ["a:1"]); // applied = relance
    const log = listDrumbeatDecisions(root);
    assert.equal(log[0].decided, "escalate");
    assert.equal(log[0].applied, "relance");
    assert.equal(log[0].enforced, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + finish on a deliberate stop clears the entry", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "paused", 1);
    const decider = { decide: () => ({ action: "finish" }) };
    await drumbeatTick(root, relauncher, { decider, deciderAfter: 1, enforce: true, now: fixed });
    assert.equal(readDrumbeatEntry(root, "a:1"), undefined); // cleared
    assert.equal(listDrumbeatDecisions(root)[0].applied, "finish");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + finish on an active stall escalates instead (guard)", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1);
    const escalated = [];
    const decider = { decide: () => ({ action: "finish" }) };
    await drumbeatTick(root, relauncher, {
      decider, deciderAfter: 1, enforce: true, now: fixed,
      onEscalate: (f) => void escalated.push(f.instance)
    });
    assert.deepEqual(escalated, ["a:1"]);
    assert.equal(readDrumbeatEntry(root, "a:1"), undefined); // terminal → marked/cleared
    assert.equal(listDrumbeatDecisions(root)[0].applied, "escalate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + reroute calls onReroute and is terminal", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "blocked", 1);
    const rerouted = [];
    const decider = { decide: () => ({ action: "reroute", reason: "needs peer" }) };
    await drumbeatTick(root, relauncher, {
      decider, deciderAfter: 1, enforce: true, now: fixed,
      onReroute: (f) => void rerouted.push(f.instance)
    });
    assert.deepEqual(rerouted, ["a:1"]);
    assert.equal(readDrumbeatEntry(root, "a:1"), undefined);
    assert.equal(listDrumbeatDecisions(root)[0].applied, "reroute");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-watch-d5.test.js`
Expected: FAIL (options not honoured; decider ignored).

- [ ] **Step 3: Write the implementation (modify `drumbeatTick`)**

Add imports at the top of `watch.ts`:

```ts
import { markRelanced, clearDrumbeatEntry, type H2ADrumbeatEntry } from "./registry.js";
import type { ReflexiveDecider } from "./deciders.js";
import { recordDrumbeatDecision } from "./decisions.js";
import type { H2AReflexiveAction } from "@sentropic/h2a";
```

Extend the options:

```ts
export interface DrumbeatTickOptions extends ScanDrumbeatOptions {
  onExhausted?: (entry: H2ADrumbeatEntry) => void | Promise<void>;
  now?: number;
  /** D5: consult the decider once `relanceCount >= deciderAfter` (default 1). */
  decider?: ReflexiveDecider;
  deciderAfter?: number;
  /** D5: apply decisions (true) or just log them and do the safe default (false). */
  enforce?: boolean;
  /** D5 effect hooks (cli.ts wires escalation + blockage); keep watch.ts store-free. */
  onEscalate?: (finding: H2ADrumbeatFinding) => void | Promise<void>;
  onReroute?: (finding: H2ADrumbeatFinding) => void | Promise<void>;
  deciderLabel?: string; // for the audit record (default "logging")
}
```

Replace the `findings` loop body in `drumbeatTick`:

```ts
const FINISH_SAFE: ReadonlySet<string> = new Set(["paused", "done"]);
const relanced: string[] = [];
for (const finding of findings) {
  const k = options.deciderAfter ?? 1;
  // Cost guard: relance cheaply until K, then judge.
  if (!options.decider || finding.relanceCount < k) {
    if (await relauncher.relance(finding)) {
      markRelanced(root, finding.instance, options.now);
      relanced.push(finding.instance);
    }
    continue;
  }

  const decision = await options.decider.decide(finding);
  let applied: H2AReflexiveAction = decision.action;

  if (!options.enforce) {
    applied = "relance";
  } else if (decision.action === "finish" && !FINISH_SAFE.has(finding.workStatus)) {
    applied = "escalate"; // guard: never silently abandon active work
  }

  switch (applied) {
    case "relance":
      if (await relauncher.relance(finding)) {
        markRelanced(root, finding.instance, options.now);
        relanced.push(finding.instance);
      }
      break;
    case "finish":
      clearDrumbeatEntry(root, finding.instance);
      break;
    case "escalate":
      await options.onEscalate?.(finding);
      clearDrumbeatEntry(root, finding.instance); // terminal: not re-decided
      break;
    case "reroute":
      await options.onReroute?.(finding);
      clearDrumbeatEntry(root, finding.instance); // terminal
      break;
  }

  recordDrumbeatDecision(root, {
    instance: finding.instance,
    decided: decision.action,
    applied,
    ...(decision.reason ? { reason: decision.reason } : {}),
    decider: options.deciderLabel ?? "logging",
    enforced: options.enforce === true,
    at: new Date(options.now ?? Date.now()).toISOString()
  });
}
```

(The `exhausted` loop is unchanged.)

- [ ] **Step 4: Run tests; verify they pass**

Run: `npm run build && node --test packages/h2a-cli/test/drumbeat-watch-d5.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full drumbeat + watch suite (no regression)**

Run: `node --test packages/h2a-cli/test/drumbeat*.test.js`
Expected: PASS (existing relance-until-cap behaviour intact when no `decider` is passed).

- [ ] **Step 6: Commit**

```bash
git add packages/h2a-cli/src/runtime/drumbeat/watch.ts packages/h2a-cli/test/drumbeat-watch-d5.test.js
git commit -m "feat(d5): drumbeatTick K-gate + advisory/enforce dispatch (relance/finish/escalate/reroute)"
```

---

## Task 5: CLI wiring + contract + DEC-111

**Files:**
- Modify: `packages/h2a-cli/src/runtime/escalation/registry.ts` (escalation reason)
- Modify: `packages/h2a-cli/src/cli.ts` (`runDrumbeatWatch` + `--help`)
- Modify: `packages/h2a-cli/src/cli-contract.ts`
- Modify: `DECISIONS.md`
- Test: `packages/h2a-cli/test/cli-contract.test.js` (already iterates the contract)

- [ ] **Step 1: Add the escalation reason**

In `packages/h2a-cli/src/runtime/escalation/registry.ts`, add `"watchdog-escalate"` to the `H2AEscalationReason` union (alongside `"relance-exhausted"`).

- [ ] **Step 2: Wire the decider into `runDrumbeatWatch`**

In `cli.ts`, import the deciders:

```ts
import { loggingRelauncher, localTmuxRelauncher, headlessRelauncher, chainRelauncher,
  loggingDecider, subagentDecider, type H2ARelauncher, type H2ARelauncherKind,
  type ReflexiveDecider } from "./runtime/drumbeat/index.js";
```

After the relauncher `switch` and before the watch loop, build the decider + the effect hooks:

```ts
const deciderArg = flags.decider; // undefined | "logging" | a command string
const deciderAfter = flags["decider-after"] ? Number.parseInt(flags["decider-after"], 10) : 1;
if (!Number.isInteger(deciderAfter) || deciderAfter < 1) {
  io.stderr.write(`h2a drumbeat watch: --decider-after must be a positive integer (got "${flags["decider-after"]}")\n`);
  return 1;
}
const enforce = flags["decider-enforce"] !== undefined;
let decider: ReflexiveDecider | undefined;
let deciderLabel = "logging";
if (deciderArg && deciderArg !== "logging") {
  decider = subagentDecider({ command: deciderArg });
  deciderLabel = "subagent";
} else if (deciderArg === "logging") {
  decider = loggingDecider();
}
```

Pass these into `runDrumbeatWatchLoop(root, relauncher, { ... })`:

```ts
...(decider ? { decider, deciderAfter, enforce, deciderLabel } : {}),
onEscalate: (finding) => {
  recordEscalation(root, { instance: finding.instance, reason: "watchdog-escalate", relanceCount: finding.relanceCount });
  io.stdout.write(`drumbeat: WATCHDOG-ESCALATE ${finding.instance}\n`);
},
onReroute: (finding) => {
  const scope = createLocalStore({ root }).listInstances().find((r) => r.instance === finding.instance)?.scopes[0] ?? "";
  raiseBlockage(root, { instance: finding.instance, scope, reason: `watchdog reroute (${finding.reason})`, needs: "peer pickup" });
  io.stdout.write(`drumbeat: WATCHDOG-REROUTE ${finding.instance} (blockage raised in "${scope}")\n`);
},
```

Update the `--help` line (cli.ts ~229) to:

```
"  h2a drumbeat watch [--interval-ms <n>] [--max-relances <n>] [--relauncher logging|local-tmux|headless|auto] [--decider logging|<command>] [--decider-after <k>] [--decider-enforce] [--root <path>]",
```

- [ ] **Step 3: Update the contract**

In `cli-contract.ts`, the `drumbeat watch` entry — extend `optionalFlags`:

```ts
optionalFlags: ["root", "interval-ms", "max-relances", "relauncher", "decider", "decider-after", "decider-enforce"],
```

and append to its description: ` D5: --decider <logging|command> consults a reflexive watchdog only after --decider-after relances; decisions are logged and applied only with --decider-enforce (reroute is advisory: raises a blockage). DEC-111.`

- [ ] **Step 4: Build + run the contract test and full suite**

Run: `npm run build && node --test packages/h2a-cli/test/cli-contract.test.js`
Expected: PASS (the `drumbeat watch` shape is `stream` → skipped by the happy-path loop; the flag-coverage assertions pass).

Run: `node --test 'packages/h2a/test/*.test.js' 'packages/h2a-cli/test/*.test.js'`
Expected: PASS (full suite green).

- [ ] **Step 5: Add DEC-111 to `DECISIONS.md`**

Append a `## DEC-111 — Drumbeat D5: reflexive watchdog` entry: decision (pluggable decider, opt-in; K-gate; advisory-first + `--decider-enforce`; reroute advisory via blockage; finish guarded by work-status; append-only decision log), why (cost/safety/trust per the brainstorm), consequence (new exports + `drumbeat watch` flags; full suite green; additive → 0.19.x).

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "feat(d5): wire drumbeat watch --decider/--decider-after/--decider-enforce + DEC-111"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** parser (T1), deciders + fallback (T2), audit log (T3), K-gate/advisory/enforce/4-actions/terminal-marking (T4), CLI flags + reroute=blockage + finish-guard + DEC (T5). All spec sections map to a task.
- **Correction vs spec:** the decision log lives in the **drumbeat runtime** (`decisions.ts`, same dir style as `registry.ts`), NOT `local-files/store.ts` — the drumbeat/escalation/blockage registries each own their files. `decision.target` is dropped (reroute is advisory).
- **Type consistency:** `H2AReflexiveAction`/`H2AReflexiveDecision` (T1) used by `subagentDecider` (T2), `recordDrumbeatDecision` (T3), `drumbeatTick` (T4); `ReflexiveDecider` (T2) used by T4/T5; `H2ADrumbeatFinding` is the existing scan type throughout.
- **No-regression:** with no `--decider`, `drumbeatTick` keeps relancing every finding (the `!options.decider` short-circuit) — behaviour identical to pre-D5.

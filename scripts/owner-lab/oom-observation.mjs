// Race-free cgroup v2 OOM observation for transient systemd worker scopes.
//
// Each interactive native session runs `LOCAL_WRAPPER` (bash) inside a
// transient `h2a-session-*.scope`, with the user CLI (`agent.mjs`) as its child
// in that same scope. When the CLI breaches `memory.max` (128 MiB, swap 0),
// the kernel increments `oom` and `oom_kill` in BOTH `<worker>/memory.events`
// and the parent slice `app.slice/memory.events`, and sends SIGKILL to the CLI.
//
// Two races follow under systemd's default `OOMPolicy=stop`:
//   1. If `systemd --user`'s SIGTERM hits `LOCAL_WRAPPER` before it execs the
//      interactive fallback shell (`/bin/bash -l`), the scope empties and
//      systemd calls `rmdir(<worker>)` (`unit_prune_cgroup`) in < 10 ms —
//      faster than a 10 ms poll loop, freezing naive `eventually()` on the
//      stale pre-OOM all-zero `memory.events` while throwing ENOENT forever.
//   2. Conversely, if `LOCAL_WRAPPER` execs `/bin/bash -l` first, the
//      interactive shell ignores SIGTERM and stays alive (`status: "running"`)
//      even though the CLI child was OOM-killed (`code 137`).
//
// Combining:
//   1. birth-checked CLI child death (`!isAgentAlive()`),
//   2. direct `<worker>/memory.events` (`oom_kill` delta >= 1) OR pruned
//      worker scope + hierarchical `app.slice/memory.events` (`oom` and
//      `oom_kill` deltas >= 1),
//   3. `app.slice/memory.events.local` unchanged (OOM was in a child scope),
//   4. every surviving sibling scope (`host`, other sessions) still present
//      with zero OOM delta,
//   5. no clean exit (wrapper banner, if emitted, must report code 137;
//      exited session must not report exitCode 0),
// converges deterministically in both orderings while rejecting non-OOM deaths.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

export function parseMemoryEvents(raw) {
  const counts = {};
  for (const line of String(raw).split('\n')) {
    const match = /^([a-z_]+)\s+(\d+)$/.exec(line.trim());
    if (match) counts[match[1]] = Number(match[2]);
  }
  assert.ok(
    Number.isSafeInteger(counts.oom) && Number.isSafeInteger(counts.oom_kill),
    `malformed memory.events: ${JSON.stringify(raw)}`,
  );
  return counts;
}

export function snapshotOomBaseline({
  controller,
  parentController,
  siblingControllers,
  readFile = readFileSync,
}) {
  const worker = parseMemoryEvents(readFile(join(controller, 'memory.events'), 'utf8'));
  assert.equal(worker.oom_kill, 0, `expected fresh worker cgroup with oom_kill 0, got ${worker.oom_kill}`);
  const parent = parseMemoryEvents(readFile(join(parentController, 'memory.events'), 'utf8'));
  let parentLocal = null;
  try {
    parentLocal = parseMemoryEvents(readFile(join(parentController, 'memory.events.local'), 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const siblings = {};
  for (const sibling of siblingControllers) {
    siblings[sibling.name] = parseMemoryEvents(readFile(join(sibling.path, 'memory.events'), 'utf8'));
  }
  return { worker, parent, parentLocal, siblings };
}

export async function observeWorkerOom({
  controller,
  parentController,
  siblingControllers,
  baseline,
  isAgentAlive,
  readSessionState,
  readSessionOutput = async () => '',
  timeoutMs = 5000,
  pollMs = 10,
  deadGraceMs = 200,
  readFile = readFileSync,
  wait = pause,
}) {
  const deadline = performance.now() + timeoutMs;
  let workerEventsRaw = null;
  let workerDirectOomKill = false;
  let workerCgroupPruned = false;
  let agentDeadWithoutOomSince = null;
  let lastParentEvents = null;
  let lastSessionState = null;

  do {
    try {
      const raw = readFile(join(controller, 'memory.events'), 'utf8');
      workerEventsRaw = raw;
      const parsed = parseMemoryEvents(raw);
      if (parsed.oom_kill > baseline.worker.oom_kill) {
        workerDirectOomKill = true;
      }
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENODEV') {
        workerCgroupPruned = true;
      } else {
        throw err;
      }
    }

    const parentEvents = parseMemoryEvents(readFile(join(parentController, 'memory.events'), 'utf8'));
    lastParentEvents = parentEvents;
    const parentOomDelta = parentEvents.oom - baseline.parent.oom;
    const parentOomKillDelta = parentEvents.oom_kill - baseline.parent.oom_kill;

    const agentAlive = isAgentAlive();
    const sessionState = await readSessionState();
    lastSessionState = sessionState;

    const oomKillObserved =
      (workerDirectOomKill || workerCgroupPruned) &&
      parentOomKillDelta >= 1 &&
      parentOomDelta >= 1;

    if (oomKillObserved && !agentAlive) {
      if (sessionState?.status === 'exited' && sessionState.exit?.exitCode === 0) {
        assert.fail(`worker session exited cleanly (code 0) instead of OOM kill`);
      }
      const output = await readSessionOutput();
      const banner = /\[h2a\] \S+ exited \(code (\d+)\)/.exec(output);
      if (banner) {
        assert.equal(
          Number(banner[1]),
          137,
          `worker CLI exited with code ${banner[1]} instead of SIGKILL (137)`,
        );
      }
      if (baseline.parentLocal !== null) {
        const parentLocalAfter = parseMemoryEvents(
          readFile(join(parentController, 'memory.events.local'), 'utf8'),
        );
        assert.equal(
          parentLocalAfter.oom_kill,
          baseline.parentLocal.oom_kill,
          `parent slice suffered a local oom_kill (before=${baseline.parentLocal.oom_kill}, after=${parentLocalAfter.oom_kill})`,
        );
      }
      const siblingDeltas = {};
      for (const sibling of siblingControllers) {
        const after = parseMemoryEvents(readFile(join(sibling.path, 'memory.events'), 'utf8'));
        const before = baseline.siblings[sibling.name];
        const oomKillDelta = after.oom_kill - before.oom_kill;
        const oomDelta = after.oom - before.oom;
        assert.equal(
          oomKillDelta,
          0,
          `sibling scope ${sibling.name} suffered an oom_kill (before=${before.oom_kill}, after=${after.oom_kill})`,
        );
        assert.equal(
          oomDelta,
          0,
          `sibling scope ${sibling.name} suffered an oom event (before=${before.oom}, after=${after.oom})`,
        );
        siblingDeltas[sibling.name] = { oomDelta, oomKillDelta };
      }
      return {
        observedVia: workerDirectOomKill ? 'worker-memory.events' : 'parent-slice-after-scope-prune',
        workerEvents: workerEventsRaw,
        workerCgroupPruned,
        parentOomDelta,
        parentOomKillDelta,
        sessionStatus: sessionState?.status ?? null,
        sessionExit: sessionState?.exit ?? null,
        bannerExitCode: banner ? Number(banner[1]) : null,
        siblingDeltas,
      };
    }

    if (!agentAlive && !workerDirectOomKill && parentOomKillDelta === 0) {
      if (agentDeadWithoutOomSince === null) {
        agentDeadWithoutOomSince = performance.now();
      } else if (performance.now() - agentDeadWithoutOomSince >= deadGraceMs) {
        assert.fail(
          `worker agent died without any cgroup oom_kill (workerCgroupPruned=${workerCgroupPruned}, sessionStatus=${sessionState?.status ?? 'unknown'}, parentOomDelta=${parentOomDelta}, parentOomKillDelta=${parentOomKillDelta})`,
        );
      }
    } else {
      agentDeadWithoutOomSince = null;
    }

    await wait(pollMs);
  } while (performance.now() < deadline);

  const parentOomDelta = lastParentEvents ? lastParentEvents.oom - baseline.parent.oom : null;
  const parentOomKillDelta = lastParentEvents ? lastParentEvents.oom_kill - baseline.parent.oom_kill : null;
  assert.fail(
    `Worker OOM did not converge: ${JSON.stringify({
      workerDirectOomKill,
      workerCgroupPruned,
      workerEventsRaw,
      parentOomDelta,
      parentOomKillDelta,
      sessionStatus: lastSessionState?.status ?? null,
      sessionExit: lastSessionState?.exit ?? null,
      agentAlive: isAgentAlive(),
    })}`,
  );
}

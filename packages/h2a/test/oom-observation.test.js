import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { observeWorkerOom, snapshotOomBaseline } from '../../../scripts/owner-lab/oom-observation.mjs';

function makeTempRoot(t) {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== '/tmp', 'Supply a disposable TMPDIR');
  const root = mkdtempSync(join(tmpdir(), 'oom-obs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function eventsText({ max = 0, oom = 0, oomKill = 0 } = {}) {
  return `low 0\nhigh 0\nmax ${max}\noom ${oom}\noom_kill ${oomKill}\noom_group_kill 0\nsock_throttled 0\n`;
}

async function naiveEventually(read, predicate, ms = 60) {
  const deadline = performance.now() + ms;
  let value;
  do {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {
      /* Mirrors restart-lab eventually(): swallows ENOENT on pruned scope. */
    }
    await pause(10);
  } while (performance.now() < deadline);
  assert.fail(`Readiness did not converge: ${JSON.stringify(value)}`);
}

test('oom-isolation: observation survives systemd pruning the worker cgroup between polls', async t => {
  const root = makeTempRoot(t);
  const cgroupRoot = join(root, 'cgroup', 'app.slice');
  const workerDir = join(cgroupRoot, 'h2a-session-300-worker.scope');
  const hostDir = join(cgroupRoot, 'h2a-native-100-host.scope');
  const human1Dir = join(cgroupRoot, 'h2a-session-201-human1.scope');
  const lab2Dir = join(cgroupRoot, 'h2a-session-202-lab2.scope');
  for (const dir of [workerDir, hostDir, human1Dir, lab2Dir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cgroupRoot, 'memory.events'), eventsText({ oom: 2, oomKill: 2 }));
  writeFileSync(join(cgroupRoot, 'memory.events.local'), eventsText());
  writeFileSync(join(workerDir, 'memory.events'), eventsText());
  writeFileSync(join(hostDir, 'memory.events'), eventsText());
  writeFileSync(join(human1Dir, 'memory.events'), eventsText());
  writeFileSync(join(lab2Dir, 'memory.events'), eventsText());
  const siblingControllers = [
    { name: 'host', path: hostDir },
    { name: 'h2a-human-1', path: human1Dir },
    { name: 'h2a-lab-2', path: lab2Dir },
  ];
  const baseline = snapshotOomBaseline({
    controller: workerDir,
    parentController: cgroupRoot,
    siblingControllers,
  });

  // Negative control reproducing the exact CI race (jobs 136735459890,
  // 136835438415, 137044795444, 137424297943): poll 1 reads all-zero
  // memory.events, then inside the 10 ms pause the CLI hits memory.max
  // (oom_kill -> 1) and systemd's default OOMPolicy=stop kills LOCAL_WRAPPER
  // and prunes the empty scope dir before poll 2.
  const naiveDir = join(cgroupRoot, 'h2a-session-301-naive.scope');
  mkdirSync(naiveDir, { recursive: true });
  writeFileSync(join(naiveDir, 'memory.events'), eventsText());
  let naiveReads = 0;
  await assert.rejects(
    () => naiveEventually(() => {
      const raw = readFileSync(join(naiveDir, 'memory.events'), 'utf8');
      if (++naiveReads === 1) {
        writeFileSync(join(naiveDir, 'memory.events'), eventsText({ max: 24, oom: 1, oomKill: 1 }));
        rmSync(naiveDir, { recursive: true, force: true });
      }
      return raw;
    }, value => /oom_kill [1-9]/.test(value), 60),
    /Readiness did not converge: "low 0\\nhigh 0\\nmax 0\\noom 0\\noom_kill 0\\noom_group_kill 0\\nsock_throttled 0\\n"/,
  );

  // Fixed observer converges via hierarchical app.slice/memory.events even when
  // systemd OOMPolicy=stop kills LOCAL_WRAPPER (SIGTERM -> 143) and prunes
  // workerDir inside the first pause.
  let sessionState = { status: 'running', exit: null };
  let agentAlive = true;
  let polls = 0;
  const observed = await observeWorkerOom({
    controller: workerDir,
    parentController: cgroupRoot,
    siblingControllers,
    baseline,
    readSessionState: async () => sessionState,
    isAgentAlive: () => agentAlive,
    timeoutMs: 1000,
    pollMs: 5,
    wait: async ms => {
      if (++polls === 1) {
        writeFileSync(join(workerDir, 'memory.events'), eventsText({ max: 24, oom: 1, oomKill: 1 }));
        writeFileSync(join(cgroupRoot, 'memory.events'), eventsText({ max: 24, oom: 3, oomKill: 3 }));
        rmSync(workerDir, { recursive: true, force: true });
        agentAlive = false;
        sessionState = { status: 'exited', exit: { exitCode: 143 } };
      }
      await pause(ms);
    },
  });
  assert.equal(observed.observedVia, 'parent-slice-after-scope-prune');
  assert.equal(observed.workerCgroupPruned, true);
  assert.equal(observed.parentOomDelta, 1);
  assert.equal(observed.parentOomKillDelta, 1);
  assert.equal(observed.sessionExit.exitCode, 143);
  assert.deepEqual(observed.siblingDeltas, {
    host: { oomDelta: 0, oomKillDelta: 0 },
    'h2a-human-1': { oomDelta: 0, oomKillDelta: 0 },
    'h2a-lab-2': { oomDelta: 0, oomKillDelta: 0 },
  });
});

test('oom-isolation: observation handles surviving wrapper shell and rejects non-OOM or contaminated kills', async t => {
  const root = makeTempRoot(t);
  const makeCase = name => {
    const parentController = join(root, name, 'app.slice');
    const controller = join(parentController, 'h2a-session-worker.scope');
    const hostDir = join(parentController, 'h2a-native-host.scope');
    const lab2Dir = join(parentController, 'h2a-session-lab2.scope');
    for (const dir of [controller, hostDir, lab2Dir]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(parentController, 'memory.events'), eventsText());
    writeFileSync(join(parentController, 'memory.events.local'), eventsText());
    writeFileSync(join(controller, 'memory.events'), eventsText());
    writeFileSync(join(hostDir, 'memory.events'), eventsText());
    writeFileSync(join(lab2Dir, 'memory.events'), eventsText());
    const siblingControllers = [
      { name: 'host', path: hostDir },
      { name: 'h2a-lab-2', path: lab2Dir },
    ];
    const baseline = snapshotOomBaseline({ controller, parentController, siblingControllers });
    return { parentController, controller, hostDir, lab2Dir, siblingControllers, baseline };
  };

  // 1. Direct path where LOCAL_WRAPPER execs `/bin/bash -l` and stays running
  // after the CLI child dies with code 137.
  {
    const c = makeCase('wrapper-survived');
    let step = 0;
    let alive = true;
    let output = 'agent-ready\nack:lab-exchange\n';
    const obs = await observeWorkerOom({
      ...c,
      readSessionState: async () => ({ status: 'running', exit: null }),
      readSessionOutput: async () => output,
      isAgentAlive: () => alive,
      timeoutMs: 1000,
      pollMs: 5,
      wait: async ms => {
        if (++step === 1) {
          writeFileSync(join(c.controller, 'memory.events'), eventsText({ max: 12, oom: 1, oomKill: 1 }));
          writeFileSync(join(c.parentController, 'memory.events'), eventsText({ max: 12, oom: 1, oomKill: 1 }));
          alive = false;
          output += '\n[h2a] codex exited (code 137) — shell on /home/runner.\n';
        }
        await pause(ms);
      },
    });
    assert.equal(obs.observedVia, 'worker-memory.events');
    assert.equal(obs.sessionStatus, 'running');
    assert.equal(obs.bannerExitCode, 137);
    assert.equal(obs.parentOomKillDelta, 1);
  }

  // 2. Mutation: agent self-SIGKILL (no OOM), LOCAL_WRAPPER stays alive in scope.
  {
    const c = makeCase('non-oom-sigkill-wrapper-alive');
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'running', exit: null }),
        readSessionOutput: async () => '\n[h2a] codex exited (code 137) — shell on /home/runner.\n',
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
        deadGraceMs: 25,
      }),
      /worker agent died without any cgroup oom_kill/,
    );
  }

  // 3. Mutation: whole scope killed externally and pruned, NO cgroup OOM.
  {
    const c = makeCase('external-kill-pruned');
    rmSync(c.controller, { recursive: true, force: true });
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'exited', exit: { exitCode: 137 } }),
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
        deadGraceMs: 25,
      }),
      /worker agent died without any cgroup oom_kill/,
    );
  }

  // 4. Mutation: unrelated parent oom_kill while worker CLI exited with code 0.
  {
    const c = makeCase('wrong-banner-code');
    writeFileSync(join(c.parentController, 'memory.events'), eventsText({ oom: 1, oomKill: 1 }));
    rmSync(c.controller, { recursive: true, force: true });
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'running', exit: null }),
        readSessionOutput: async () => '\n[h2a] codex exited (code 0) — shell on /home/runner.\n',
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
      }),
      /exited with code 0 instead of SIGKILL \(137\)/,
    );
  }

  // 5. Mutation: sibling scope (h2a-lab-2) suffered an OOM kill.
  {
    const c = makeCase('sibling-oom');
    writeFileSync(join(c.parentController, 'memory.events'), eventsText({ oom: 1, oomKill: 1 }));
    writeFileSync(join(c.lab2Dir, 'memory.events'), eventsText({ oom: 1, oomKill: 1 }));
    rmSync(c.controller, { recursive: true, force: true });
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'exited', exit: { exitCode: 143 } }),
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
      }),
      /sibling scope h2a-lab-2 suffered an oom_kill/,
    );
  }

  // 6. Mutation: sibling scope vanished (ENOENT).
  {
    const c = makeCase('sibling-vanished');
    writeFileSync(join(c.parentController, 'memory.events'), eventsText({ oom: 1, oomKill: 1 }));
    rmSync(c.controller, { recursive: true, force: true });
    rmSync(c.lab2Dir, { recursive: true, force: true });
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'exited', exit: { exitCode: 143 } }),
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
      }),
      /ENOENT/,
    );
  }

  // 7. Mutation: parent slice suffered a local OOM (memory.events.local incremented).
  {
    const c = makeCase('parent-local-oom');
    writeFileSync(join(c.parentController, 'memory.events'), eventsText({ oom: 1, oomKill: 1 }));
    writeFileSync(join(c.parentController, 'memory.events.local'), eventsText({ oom: 1, oomKill: 1 }));
    rmSync(c.controller, { recursive: true, force: true });
    await assert.rejects(
      () => observeWorkerOom({
        ...c,
        readSessionState: async () => ({ status: 'exited', exit: { exitCode: 143 } }),
        isAgentAlive: () => false,
        timeoutMs: 1000,
        pollMs: 5,
      }),
      /parent slice suffered a local oom_kill/,
    );
  }
});

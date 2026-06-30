import assert from "node:assert/strict";
import test from "node:test";

import {
  chainRelauncher,
  headlessRelauncher,
  localTmuxRelauncher,
  tmuxTarget
} from "../dist/index.js";

function finding(overrides = {}) {
  return {
    instance: "claude:p1",
    reason: "stopped",
    workStatus: "paused",
    relanceCount: 0,
    ...overrides
  };
}

function fakeRuntime(options = {}) {
  const calls = { run: [], spawnDetached: [], notes: [], capture: [] };
  return {
    calls,
    runtime: {
      run: (file, args) => {
        calls.run.push([file, ...args]);
        return true;
      },
      capture: (file, args) => {
        calls.capture.push([file, ...args]);
        if (options.clientActivityEpochSec === undefined) return undefined;
        if (args.includes("display-message")) return "main\n";
        if (args.includes("list-clients")) return `${options.clientActivityEpochSec}\n`;
        return undefined;
      },
      spawnDetached: (command, opts) => {
        calls.spawnDetached.push({ command, cwd: opts.cwd });
        return true;
      },
      notify: (line) => calls.notes.push(line)
    }
  };
}

test("tmuxTarget builds session:window.pane or a bare pane id", () => {
  assert.equal(tmuxTarget({ session: "s", window: "1", pane: "0" }), "s:1.0");
  assert.equal(tmuxTarget({ session: "s", pane: "%5" }), "%5");
});

test("local-tmux relancer sends the resume command into the captured pane", () => {
  const { calls, runtime } = fakeRuntime();
  const r = localTmuxRelauncher({ runtime });
  const ok = r.relance(
    finding({
      launchContext: {
        cwd: "/work",
        command: "claude",
        resumeCommand: "claude --resume abc",
        tmux: { session: "main", window: "2", pane: "1" }
      }
    })
  );
  assert.equal(ok, true);
  // submit = literal text + two SEPARATE Enters (a combined `cmd Enter`, or no -l,
  // does not commit in a TUI — the "line written, no Enter fires" bug).
  assert.deepEqual(calls.run[0], ["tmux", "send-keys", "-t", "main:2.1", "-l", "claude --resume abc"]);
  assert.deepEqual(calls.run[1], ["tmux", "send-keys", "-t", "main:2.1", "Enter"]);
  assert.deepEqual(calls.run[2], ["tmux", "send-keys", "-t", "main:2.1", "Enter"]);
});

test("local-tmux relancer declines (false) when there is no tmux context", () => {
  const { calls, runtime } = fakeRuntime();
  const r = localTmuxRelauncher({ runtime });
  const ok = r.relance(finding({ launchContext: { cwd: "/w", command: "claude" } }));
  assert.equal(ok, false);
  assert.equal(calls.run.length, 0);
});

test("local-tmux relancer defers without send-keys when a human was just active", () => {
  const now = Date.parse("2026-06-26T12:00:00.000Z");
  const { calls, runtime } = fakeRuntime({ clientActivityEpochSec: Math.floor(now / 1000) - 1 });
  const previousNow = Date.now;
  Date.now = () => now;
  try {
    const r = localTmuxRelauncher({ runtime });
    const ok = r.relance(
      finding({
        launchContext: {
          cwd: "/work",
          command: "claude",
          resumeCommand: "claude --resume abc",
          tmux: { session: "main", window: "2", pane: "1" }
        }
      })
    );
    assert.equal(ok, false);
    assert.equal(calls.run.length, 0);
    assert.equal(calls.spawnDetached.length, 0);
  } finally {
    Date.now = previousNow;
  }
});

test("headless relancer respawns the captured command detached + notifies", () => {
  const { calls, runtime } = fakeRuntime();
  const r = headlessRelauncher({ runtime });
  const ok = r.relance(finding({ launchContext: { cwd: "/work", command: "codex resume" } }));
  assert.equal(ok, true);
  assert.deepEqual(calls.spawnDetached[0], { command: "codex resume", cwd: "/work" });
  assert.equal(calls.notes.length, 1);
});

test("headless relancer declines when there is no command to respawn", () => {
  const { calls, runtime } = fakeRuntime();
  const r = headlessRelauncher({ runtime });
  assert.equal(r.relance(finding({})), false);
  assert.equal(calls.spawnDetached.length, 0);
});

test("chain falls back from local-tmux to headless when there is no pane", async () => {
  const { calls, runtime } = fakeRuntime();
  const chain = chainRelauncher(
    localTmuxRelauncher({ runtime }),
    headlessRelauncher({ runtime })
  );
  // No tmux → local-tmux returns false → headless respawns.
  const ok = await chain.relance(finding({ launchContext: { cwd: "/w", command: "gemini" } }));
  assert.equal(ok, true);
  assert.equal(calls.run.length, 0);
  assert.deepEqual(calls.spawnDetached[0], { command: "gemini", cwd: "/w" });
});

test("chain stops at a local-tmux human-activity deferral without falling back to headless", async () => {
  const now = Date.parse("2026-06-26T12:00:00.000Z");
  const { calls, runtime } = fakeRuntime({ clientActivityEpochSec: Math.floor(now / 1000) - 1 });
  const previousNow = Date.now;
  Date.now = () => now;
  try {
    const chain = chainRelauncher(
      localTmuxRelauncher({ runtime }),
      headlessRelauncher({ runtime })
    );
    const ok = await chain.relance(
      finding({ launchContext: { cwd: "/w", command: "claude", tmux: { session: "s", pane: "%1" } } })
    );
    assert.equal(ok, false, "deferred means not relanced, so drumbeat retries later");
    assert.equal(calls.run.length, 0);
    assert.equal(calls.spawnDetached.length, 0);
  } finally {
    Date.now = previousNow;
  }
});

test("chain stops at the first adapter that issues a relance", async () => {
  const { calls, runtime } = fakeRuntime();
  const chain = chainRelauncher(
    localTmuxRelauncher({ runtime }),
    headlessRelauncher({ runtime })
  );
  const ok = await chain.relance(
    finding({ launchContext: { cwd: "/w", command: "claude", tmux: { session: "s", pane: "%1" } } })
  );
  assert.equal(ok, true);
  assert.equal(calls.run.length, 3); // tmux handled it: literal + Enter + Enter
  assert.equal(calls.spawnDetached.length, 0); // headless not reached
});

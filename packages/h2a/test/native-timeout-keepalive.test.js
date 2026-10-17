import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Regression cover for the ackDeadline/timeout deadlock: when an inner timeout
// fires while the fixture is still waiting past its ack barrier, a test.after
// hook clearing an as-yet-undefined keepalive lets a ref'd interval created
// afterwards keep the runner alive forever, so the outer `await closed` never
// resolves. The interval MUST be created before the barrier: the hook then
// always clears a live timer and the runner still exits by itself with the
// recorded timeout failure.
test("should exit the runner after an inner timeout past the ack barrier instead of hanging", { timeout: 20_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "keepalive-"));
  const marker = join(dir, "ack");
  writeFileSync(join(dir, "fixture.mjs"), `import test from 'node:test';
    import {existsSync} from 'node:fs';
    let keepalive;test.after(()=>clearInterval(keepalive));
    test('fixture timeout', {timeout:1000}, async () => {
      keepalive=setInterval(()=>{},1000);
      await new Promise(resolve=>setTimeout(resolve,300));
      const ackDeadline=Date.now()+800;
      while(!existsSync(${JSON.stringify(marker)})&&Date.now()<ackDeadline)await new Promise(resolve=>setTimeout(resolve,10));
      await new Promise(()=>{});
    });`);
  // Scrubbed minimal env: inheriting the outer runner's IPC channel
  // (NODE_CHANNEL_FD) would make the child refuse with "run() is being
  // called recursively". Same isolation principle as nativeTestEnvironment.
  const runner = spawn(process.execPath, ["--test", "--test-reporter=tap", join(dir, "fixture.mjs")],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(runner, "close");
  let output = "";
  runner.stdout.on("data", bytes => { output += bytes; });
  runner.stderr.on("data", bytes => { output += bytes; });
  // `node --test` runs the fixture in a CHILD process: killing only the
  // coordinator leaves that child (and its leaked interval) reparented and
  // alive. Always kill the whole runner tree, never the coordinator alone.
  const readRunnerChildren = pid => {
    try {
      const text = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      return text ? text.split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    } catch { return []; }
  };
  const killRunnerTree = pid => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    const seen = new Set(), queue = [pid];
    for (const next of queue) {
      if (seen.has(next)) continue;
      seen.add(next);
      for (const kid of readRunnerChildren(next)) if (!seen.has(kid)) queue.push(kid);
    }
    for (const target of [...seen].reverse()) {
      try { process.kill(target, "SIGKILL"); } catch {}
    }
  };
  let selfExited = true;
  const watchdog = setTimeout(() => {
    selfExited = false;
    try { killRunnerTree(runner.pid); } catch {}
  }, 10_000);
  if (watchdog.unref) watchdog.unref();
  try {
    const [status] = await closed;
    clearTimeout(watchdog);
    assert.equal(selfExited, true, `runner never exited by itself (leaked keepalive interval):\n${output}`);
    assert.equal(status, 1, output);
    assert.match(output, /testTimeoutFailure/);
    t.diagnostic("runner exited by itself with the recorded timeout failure");
  } finally {
    clearTimeout(watchdog);
    try { if (runner.exitCode === null && runner.signalCode === null) killRunnerTree(runner.pid); } catch {}
    await closed;
    // Belt-and-braces: the watchdog already killed the tree, but a late
    // fixture child could still outlive the coordinator close.
    try { killRunnerTree(runner.pid); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Integration: `h2a loop tick|watch` are ASYNC (lazy runtime + periodic) and are
// dispatched in bin.ts, so we exercise them through the real binary.
const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
}

test("h2a loop tick produit un plan dry-run (resource) + code 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    assert.equal(created.status, 0, `create stderr: ${created.stderr}`);
    const loopId = JSON.parse(created.stdout).id;
    assert.ok(loopId, "loopId manquant");

    const ticked = run(["loop", "tick", loopId, "--root", dir]);
    assert.equal(ticked.status, 0, `tick stderr: ${ticked.stderr}`);
    const plan = JSON.parse(ticked.stdout);
    assert.equal(plan.loopId, loopId);
    assert.equal(plan.degraded, false);
    assert.equal(typeof plan.outcome, "string");
    assert.ok(Array.isArray(plan.actions), "plan.actions doit être un tableau");
    // Aucune ref déclarée → running + noop (le core ne close jamais sans refs).
    assert.equal(plan.close, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop watch --max 1 exécute une relance gardée par défaut", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", "claude:test", "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const watched = run(["loop", "watch", loopId, "--root", dir, "--max", "1"]);
    assert.equal(watched.status, 0, `watch stderr: ${watched.stderr}`);
    const lines = watched.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "watch --max 1 doit émettre exactement 1 plan");
    const plan = JSON.parse(lines[0]);
    assert.equal(plan.loopId, loopId);
    assert.ok(plan.exec, "watch/run MVP doit exécuter par défaut les actions de relance gardées");
    assert.ok(plan.exec.results.some((r) => r.type === "request-launch" && r.agentId === "a1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop watch --dry-run reste observation-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", "claude:test", "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const watched = run(["loop", "watch", loopId, "--root", dir, "--max", "1", "--dry-run"]);
    assert.equal(watched.status, 0, `watch stderr: ${watched.stderr}`);
    const plan = JSON.parse(watched.stdout.trim());
    assert.equal(plan.loopId, loopId);
    assert.equal(plan.exec, undefined);
    assert.ok(plan.actions.some((a) => a.type === "request-launch" && a.agentId === "a1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop tick --execute (loop sans ref) → sûr : exec présent, statut inchangé", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const ticked = run(["loop", "tick", loopId, "--root", dir, "--execute"]);
    assert.equal(ticked.status, 0, `tick --execute stderr: ${ticked.stderr}`);
    const out = JSON.parse(ticked.stdout);
    assert.ok(out.exec, "le rapport exec doit être présent avec --execute");
    // Aucune ref → pas d'action close → statut reste 'created'.
    const status = run(["loop", "status", loopId, "--root", dir]);
    assert.equal(JSON.parse(status.stdout).status, "created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop tick sur un loop inexistant → code non-zero + stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const res = run(["loop", "tick", "loop-does-not-exist", "--root", dir]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /loop tick/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop stop is honored by subsequent tick --execute", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    assert.equal(created.status, 0, `create stderr: ${created.stderr}`);
    const loopId = JSON.parse(created.stdout).id;
    const stopped = run(["loop", "stop", loopId, "--root", dir, "--reason", "operator stop"]);
    assert.equal(stopped.status, 0, `stop stderr: ${stopped.stderr}`);

    const ticked = run(["loop", "tick", loopId, "--root", dir, "--execute"]);
    assert.equal(ticked.status, 0, `tick --execute stderr: ${ticked.stderr}`);
    const out = JSON.parse(ticked.stdout);
    assert.equal(out.outcome, "stopped");
    assert.deepEqual(out.actions, []);
    assert.deepEqual(out.exec.results, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

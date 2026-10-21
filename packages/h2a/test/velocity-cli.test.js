import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function tempRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), "velocity-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixture(t) {
  const dir = tempRoot(t);
  const path = join(dir, "estimate-fixture.json");
  writeFileSync(
    path,
    JSON.stringify({
      cohorts: { "sol-created-desc/1": [1, 2] },
      pullRequests: [
        { number: 1, createdAt: "2026-10-18T10:00:00Z", mergedAt: "2026-10-18T12:45:18Z" },
        { number: 2, createdAt: "2026-10-18T10:00:00Z", mergedAt: "2026-10-18T13:40:40Z" },
      ],
    }),
  );
  return path;
}

test("estimate fixture executes through the h2a command, not an internal import", (t) => {
  const dir = tempRoot(t);
  const fixturePath = fixture(t);
  const child = spawnSync(
    process.execPath,
    ["packages/h2a/dist/bin.js", "estimate", "--fixture", fixturePath],
    { cwd: join(import.meta.dirname, "..", "..", ".."), env: process.env, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.metric, "pr_open_to_merge");
  assert.equal(payload.installedAt, "unknown");
  assert.equal(payload.quantiles.p50Seconds, 9918);
});

test("estimate keeps CLI contracts and lazy boundaries", (t) => {
  const dir = tempRoot(t);
  const fixturePath = fixture(t);
  const child = spawnSync(
    process.execPath,
    ["packages/h2a/dist/bin.js", "estimate", "--fixture", fixturePath],
    { cwd: join(import.meta.dirname, "..", "..", ".."), env: process.env, encoding: "utf8" },
  );
  assert.equal(child.status, 0);
  const source = readFileSync(
    join(import.meta.dirname, "..", "src", "velocity-cli.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["']\..*runtime/);
  assert.doesNotMatch(source, /from\s+["']\..*gateway/);
  assert.doesNotMatch(source, /memory-service/);
});

test("estimate bundle matches the source API exactly", (t) => {
  tempRoot(t);
  const check = spawnSync(process.execPath, ["scripts/check-agent-stats-vendor.mjs"], {
    cwd: join(import.meta.dirname, "..", "..", ".."),
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
});

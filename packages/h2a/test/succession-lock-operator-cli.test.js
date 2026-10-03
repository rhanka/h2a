import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeLockRec, readLockHolder } from "../dist/runtime/local-files/succession-lock.js";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "h2a-unlock-cli-"));
  mkdirSync(join(root, "identity"));
  const path = join(root, "identity", ".lock");
  const cli = (args) => spawnSync(process.execPath, [bin, ...args], {
    cwd: root, encoding: "utf8", timeout: 15000,
    env: { ...process.env, H2A_ROOT: root, REMOTE_CLI_CONFIG_HOME: join(root, "config"), NO_COLOR: "1" }
  });
  try { fn(root, path, cli); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("T-operator-CLI: both command help pages name expected tokens and the explicit assertion", () => {
  fixture((root, path, cli) => {
    for (const args of [["identity", "unlock", "--help"], ["lock", "break", "--help"]]) {
      const result = cli(args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /--token <token>/);
      assert.match(result.stdout, /--assert-dead/);
      assert.match(result.stdout, /live/);
    }
  });
});

test("T-operator-CLI: reject missing, mismatched, and live-holder tokens", () => {
  fixture((root, path, cli) => {
    const record = makeLockRec("d".repeat(32));
    const raw = JSON.stringify(record);
    writeFileSync(path, raw);
    for (const args of [
      ["identity", "unlock"],
      ["identity", "unlock", "--token", "e".repeat(32), "--assert-dead"],
      ["identity", "unlock", "--token", record.token, "--assert-dead"],
      ["lock", "break", "--token", record.token]
    ]) {
      const result = cli(args);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(readFileSync(path, "utf8"), raw);
    }
    const live = cli(["lock", "break", "--path", path, "--token", record.token, "--assert-dead"]);
    assert.equal(live.status, 1);
    assert.match(live.stderr, new RegExp(`pid ${process.pid}`));
  });
});

test("T-operator-CLI: legacy requires assert-dead and both aliases retire only the requested lock", () => {
  fixture((root, path, cli) => {
    const raw = JSON.stringify({ pid: 2910836, hostname: "fixture", startedAt: "fixture" }) + "\n";
    for (const command of ["identity", "lock"]) {
      writeFileSync(path, raw);
      const token = readLockHolder(path).token;
      const args = command === "identity"
        ? ["identity", "unlock", "--root", root, "--token", token]
        : ["lock", "break", "--path", path, "--token", token];
      const refusal = cli(args);
      assert.equal(refusal.status, 1, refusal.stderr);
      assert.equal(JSON.parse(refusal.stdout).reason, "assert-dead-required");
      assert.equal(readFileSync(path, "utf8"), raw);
      const result = cli([...args, "--assert-dead"]);
      assert.equal(result.status, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.broken, true);
      assert.equal(body.legacyRecords, 1);
      assert.equal(readLockHolder(path), "absent");
    }
  });
});

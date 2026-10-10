#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertIsolatedEnvironment, assertPrivateQualificationPath, nativeQualificationRoot,
  spawnSyncIsolatedNative } from "../packages/h2a/test/helpers/native-isolation.js";

// Mutation qualification uses the current build and changes ONLY rollback.
// It keeps owner-write injection identical, then restores dist in finally.
assertIsolatedEnvironment(process.env);
const repo = resolve(import.meta.dirname, "..");
const evidence = process.env.H2A_TEST_EVIDENCE_DIR ?? join(nativeQualificationRoot, "builder/evidence");
assertPrivateQualificationPath(evidence, nativeQualificationRoot);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const server = join(repo, "packages/h2a-runtime/dist/native-terminal/server.js");
const good = readFileSync(server, "utf8");
assert.ok(good.includes("H2A_TEST_FAIL_OWNER_WRITE"), "build must include the owner-write injection");
const publication = good.indexOf("await recordEndpointOwner(options.socketPath, published)");
assert.ok(publication !== -1, "current publication block must be found");
const start = good.indexOf("if (published !== undefined) {", publication);
const end = good.indexOf("throw pubError;", start);
assert.ok(start > publication && end > start, "exact rollback block must be found");
const removed = good.slice(start, end);
assert.ok(removed.includes("sameNativeTerminalSocket(current, published)"));
assert.ok(!removed.includes("H2A_TEST_FAIL_OWNER_WRITE"));
const mutated = good.slice(0, start) + good.slice(end);
const digest = text => createHash("sha256").update(text).digest("hex");
const receipts = { original: digest(good), mutation: digest(mutated), removedRollback: removed };
try {
  for (const [phase, source] of [["red", mutated], ["green", good]]) {
    writeFileSync(server, source);
    const result = spawnSyncIsolatedNative(process.execPath, ["--test", "--test-concurrency=1",
      "--test-name-pattern=rollback published socket", "packages/h2a/test/native-inventory-absence.test.js"],
    { env: process.env, cwd: repo, encoding: "utf8", timeout: 60_000 });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    writeFileSync(join(evidence, `r2-f05-${phase}.log`), output);
    receipts[phase] = { status: result.status, signal: result.signal };
    if (phase === "red") {
      assert.equal(result.status, 1, "rollback-only mutation must fail");
      assert.match(output, /socketLeftBehind: true/);
      assert.match(output, /restarted: false/);
      assert.match(output, /owner-write rollback must remove the socket and permit retry/);
      assert.doesNotMatch(output, /Missing expected rejection/);
    } else assert.equal(result.status, 0, "restored rollback must pass");
    process.stdout.write(`R2-F05 ${phase}: exit ${result.status}\n`);
  }
} finally {
  writeFileSync(server, good);
  assert.equal(digest(readFileSync(server, "utf8")), receipts.original);
  writeFileSync(join(evidence, "r2-f05-mutation.json"), JSON.stringify(receipts, null, 2) + "\n");
}

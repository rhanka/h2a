#!/usr/bin/env node
// Final-SHA receipt for the MCP identity recovery covered by #312.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPrivateQualificationPath, createPrivateTestDirectory, nativeQualificationRoot,
  nativeTestEnvironment,
} from "../packages/h2a/test/helpers/native-isolation.js";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const suites = ["packages/h2a/test/mcp-identity-burst.test.js", "packages/h2a/test/mcp-startup-contention.test.js"];
const option = name => process.argv[process.argv.indexOf(name) + 1];
const evidence = resolve(process.argv.includes("--evidence") ? option("--evidence") : join(nativeQualificationRoot, "builder/evidence"));
assertPrivateQualificationPath(evidence, nativeQualificationRoot);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const receiptPath = join(evidence, "r3-final-mcp.json");

function head() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function verify() {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.sha, head(), "MCP receipt must qualify the final SHA");
  assert.equal(receipt.completedSha, receipt.sha);
  assert.deepEqual(receipt.suites, suites);
  assert.equal(receipt.requireRealSeed, true);
  assert.ok(receipt.seedRegistryBytes > 0, "mandatory nonempty private seed");
  assert.match(receipt.seedDigest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.cohortSize, 12);
  assert.deepEqual(receipt.counts, { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(receipt.exitCode, 0);
  assert.equal(createHash("sha256").update(readFileSync(join(evidence, "r3-final-mcp.log"))).digest("hex"), receipt.logDigest);
  return receipt;
}

function seedDigest(seed) {
  const hash = createHash("sha256");
  function visit(path, relative = "") {
    const info = lstatSync(path);
    assert.ok(!info.isSymbolicLink(), "private seed must contain no symlinks");
    if (info.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry), `${relative}/${entry}`);
    } else {
      assert.ok(info.isFile(), "private seed must contain only regular files");
      hash.update(relative).update("\0").update(readFileSync(path)).update("\0");
    }
  }
  visit(seed);
  return hash.digest("hex");
}

if (!process.argv.includes("--verify-receipts")) {
  assert.ok(process.argv.includes("--seed"), "--seed is mandatory; no synthetic fallback");
  const seed = resolve(option("--seed"));
  assertPrivateQualificationPath(seed, nativeQualificationRoot);
  const digest = seedDigest(seed);
  const registryBytes = lstatSync(join(seed, "registry/instances.jsonl")).size;
  const corpusMetadata = join(seed, ".launch-perf-synthetic.json");
  const seedCorpus = existsSync(corpusMetadata) ? JSON.parse(readFileSync(corpusMetadata, "utf8")) : undefined;
  assert.ok(registryBytes > 0, "mandatory seed registry must be nonempty");
  const root = createPrivateTestDirectory("mcp-final-");
  const env = nativeTestEnvironment(root, { H2A_MCP_TEST_SEED: seed,
    H2A_MCP_REQUIRE_REAL_SEED: "1", H2A_MCP_TEST_N: "12" });
  const sha = head();
  const args = ["--import", join(repo, "packages/h2a/test/helpers/native-isolation.js"),
    "--test", "--test-concurrency=1", "--test-reporter=tap", ...suites];
  const result = spawnSync(process.execPath, args, { cwd: repo, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, "r3-final-mcp.log"), log);
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => {
    const value = [...log.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gm"))].at(-1)?.[1];
    assert.notEqual(value, undefined, `missing MCP test count: ${key}`);
    return [key, Number(value)];
  }));
  assert.equal(seedDigest(seed), digest, "qualification must not modify the seed");
  writeFileSync(receiptPath, JSON.stringify({ sha, completedSha: head(), suites, requireRealSeed: true,
    seed, seedRegistryBytes: registryBytes, seedDigest: digest, seedCorpus, cohortSize: 12,
    nodeVersion: process.version, command: [process.execPath, ...args], counts, exitCode: result.status,
    logDigest: createHash("sha256").update(log).digest("hex") }, null, 2) + "\n");
}
console.log(JSON.stringify(verify(), null, 2));

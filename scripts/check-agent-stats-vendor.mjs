#!/usr/bin/env node
/**
 * Drift-check for the vendored agent-stats velocity closure.
 *
 * Compares the fresh `packages/agent-stats/dist/velocity/` build against the
 * committed `packages/h2a/src/vendor/agent-stats/` bundle via the manifest.
 * Exit 0 in phase, 1 on drift, 2 when the build is missing (inconclusive).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages/agent-stats/dist/velocity");
const DEST = join(ROOT, "packages/h2a/src/vendor/agent-stats");

if (!existsSync(SRC)) {
  process.stderr.write("agent-stats vendor INCONCLUSIVE: missing dist/velocity build; build agent-stats first\n");
  process.exit(2);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(DEST, "manifest.json"), "utf8"));
} catch {
  process.stderr.write("agent-stats vendor DRIFT: missing manifest; run scripts/vendor-agent-stats.mjs\n");
  process.exit(1);
}
const failures = [];
for (const [name, digest] of Object.entries(manifest.files)) {
  const srcPath = join(SRC, name);
  const destPath = join(DEST, name);
  if (!existsSync(srcPath) || !existsSync(destPath)) {
    failures.push(`missing: ${name}`);
    continue;
  }
  const srcDigest = createHash("sha256").update(readFileSync(srcPath)).digest("hex");
  const destDigest = createHash("sha256").update(readFileSync(destPath)).digest("hex");
  if (srcDigest !== digest || destDigest !== digest) failures.push(`differ: ${name}`);
}
const srcNames = new Set(readdirSync(SRC).filter((name) => name.endsWith(".js") || name.endsWith(".d.ts")));
for (const name of Object.keys(manifest.files)) {
  if (!srcNames.has(name)) failures.push(`extra: ${name}`);
}
if (failures.length > 0) {
  process.stderr.write(`agent-stats vendor DRIFT:\n  ${failures.join("\n  ")}\n  run scripts/vendor-agent-stats.mjs\n`);
  process.exit(1);
}
console.log("agent-stats vendor OK");

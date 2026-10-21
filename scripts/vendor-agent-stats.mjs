#!/usr/bin/env node
/**
 * Vendor the agent-stats velocity closure into the h2a package.
 *
 * Copies the freshly built `packages/agent-stats/dist/velocity/*.{js,d.ts}`
 * into `packages/h2a/src/vendor/agent-stats/` with a manifest of SHA-256
 * digests. Generated files are never hand-edited; regenerate with this script.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages/agent-stats/dist/velocity");
const DEST = join(ROOT, "packages/h2a/src/vendor/agent-stats");

if (process.argv.includes("--mirror-dist-only")) {
  const DIST = join(ROOT, "packages/h2a/dist/vendor/agent-stats");
  mkdirSync(DIST, { recursive: true });
  for (const name of readdirSync(DEST).sort()) {
    if (name === "manifest.json") continue;
    copyFileSync(join(DEST, name), join(DIST, name));
  }
  console.log("vendor-agent-stats mirror OK");
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
const manifest = { files: {} };
for (const name of readdirSync(SRC).sort()) {
  if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
  const bytes = readFileSync(join(SRC, name));
  copyFileSync(join(SRC, name), join(DEST, name));
  manifest.files[name] = createHash("sha256").update(bytes).digest("hex");
}
writeFileSync(join(DEST, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`vendor-agent-stats OK: ${Object.keys(manifest.files).length} files`);

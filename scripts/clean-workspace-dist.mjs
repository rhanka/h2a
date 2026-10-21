#!/usr/bin/env node

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
if (typeof manifest.name !== "string" || !manifest.name.startsWith("@sentropic/")) {
  throw new Error("clean-workspace-dist must run from a @sentropic workspace package");
}
// Round-3 (reviews pr382-r3): empty dist/ WITHOUT removing the directory
// itself. Inside the L0 filesystem barrier dist/ is a writable bind mount
// over a read-only checkout, and rmdir of the mountpoint itself fails
// (EROFS) while content writes succeed. Unconfined behavior is unchanged:
// tsc recreates what it needs either way.
const dist = join(cwd, "dist");
let entries = [];
try {
  entries = readdirSync(dist);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
for (const entry of entries) {
  rmSync(join(dist, entry), { recursive: true, force: true });
}

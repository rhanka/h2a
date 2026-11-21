#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
if (typeof manifest.name !== "string" || !manifest.name.startsWith("@sentropic/")) {
  throw new Error("clean-workspace-dist must run from a @sentropic workspace package");
}

const distDir = join(cwd, "dist");
if (process.env.H2A_TEST_STATE_BARRIER === "1") {
  // Inside an attested D16 dist bind mount: empty entries without unlinking the
  // mount point itself (rmSync(distDir) would fail EBUSY on the bind mount).
  if (existsSync(distDir)) {
    for (const entry of readdirSync(distDir)) {
      rmSync(join(distDir, entry), { recursive: true, force: true });
    }
  }
} else {
  rmSync(distDir, { recursive: true, force: true });
}

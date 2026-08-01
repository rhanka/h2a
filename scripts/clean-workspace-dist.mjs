#!/usr/bin/env node

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
if (typeof manifest.name !== "string" || !manifest.name.startsWith("@sentropic/")) {
  throw new Error("clean-workspace-dist must run from a @sentropic workspace package");
}
rmSync(join(cwd, "dist"), { recursive: true, force: true });

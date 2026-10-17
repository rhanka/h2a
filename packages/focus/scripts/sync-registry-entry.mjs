#!/usr/bin/env node
/**
 * Recompute the asset digests pinned in `registry/entries.v1.json`.
 *
 * The descriptor's structural fields stay hand-authored (they ARE the
 * publisher contract); only the `sha256` fields of `assets[]` and
 * `skill.documentSchemas[]` are refreshed from exact file bytes. Run after
 * editing `skills/focus/SKILL.md` or `schemas/*.schema.json`:
 *
 *   npm run registry:sync -w @sentropic/focus
 *
 * Byte-stable when already synced: same input bytes produce the same file.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pkgRoot, "registry", "entries.v1.json");

const sha256File = (relPath) =>
  createHash("sha256").update(readFileSync(join(pkgRoot, relPath))).digest("hex");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const entry of manifest.entries) {
  for (const asset of entry.assets) {
    asset.sha256 = sha256File(asset.path);
  }
  for (const schema of entry.skill.documentSchemas) {
    schema.sha256 = sha256File(schema.assetPath);
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`registry:sync ${manifest.entries.length} entr(y/ies) re-pinned`);

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
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(pkgRoot, "registry", "entries.v1.json");

export const sha256File = (relPath, rootDir = pkgRoot) =>
  createHash("sha256").update(readFileSync(join(rootDir, relPath))).digest("hex");

/**
 * Re-pin only the targeted entry (default: "sentropic.focus") in `manifest.entries`,
 * leaving any other entry in `manifest.entries` untouched.
 */
export function syncRegistryManifest(
  manifest,
  computeSha256 = (relPath) => sha256File(relPath),
  targetId = "sentropic.focus",
) {
  let updated = 0;
  for (const entry of manifest.entries) {
    if (entry.id !== targetId) continue;
    for (const asset of entry.assets) {
      asset.sha256 = computeSha256(asset.path);
    }
    for (const schema of entry.skill.documentSchemas) {
      schema.sha256 = computeSha256(schema.assetPath);
    }
    updated += 1;
  }
  return updated;
}

const isCliEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry) {
  const idFlagIdx = process.argv.indexOf("--id");
  const targetId =
    idFlagIdx !== -1 && process.argv[idFlagIdx + 1]
      ? process.argv[idFlagIdx + 1]
      : "sentropic.focus";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const updated = syncRegistryManifest(manifest, (relPath) => sha256File(relPath), targetId);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`registry:sync ${updated} entr(y/ies) re-pinned (target=${targetId})`);
}

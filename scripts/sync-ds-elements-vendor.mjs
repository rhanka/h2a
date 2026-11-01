#!/usr/bin/env node
/**
 * Sync the pre-L7a vendored design-system elements build into
 * packages/h2a/vendor/design-system-elements (json-render L3, DS §8).
 *
 * The elements package is `private: true` until DS Lot L7a publishes it to
 * npm, so @sentropic/h2a vendors the pinned build by fingerprint. This script
 * is the ONLY sanctioned way to refresh the vendored snapshot:
 *
 *   node scripts/sync-ds-elements-vendor.mjs <tar> <MANIFEST.sha256>
 *
 * It verifies, in order and before writing anything:
 *   1. the tar's sha256 equals the digest recorded in the existing
 *      vendor manifest's `sourceTar.sha256` (pinned provenance);
 *   2. the MANIFEST.sha256 file's own sha256 equals
 *      `sourceTar.manifestSha256`;
 *   3. every file inside the extracted tar matches its sha256 line in
 *      MANIFEST.sha256, and the file set is EXACTLY the manifest's set —
 *      nothing extra is vendored.
 *
 * It then rewrites the vendor tree and the provenance `manifest.json` with
 * the per-file digests. 0 Python. Node only.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(repoRoot, "packages", "h2a", "vendor", "design-system-elements");
const vendorManifestPath = join(vendorDir, "manifest.json");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function usage() {
  console.error("usage: node scripts/sync-ds-elements-vendor.mjs <elements-build.tar> <MANIFEST.sha256>");
  process.exitCode = 1;
}

const [tarPath, buildManifestPath] = process.argv.slice(2);
if (tarPath === undefined || buildManifestPath === undefined || !existsSync(tarPath) || !existsSync(buildManifestPath)) {
  usage();
  throw new Error("sync-ds-elements-vendor: the elements build tar and its MANIFEST.sha256 are required");
}

// --- 1. Provenance: the incoming build must be the PINNED build ---------------
const previous = JSON.parse(readFileSync(vendorManifestPath, "utf8"));
if (previous.format !== "h2a.ds-elements-vendor/v1") {
  throw new Error(`sync-ds-elements-vendor: unknown vendor manifest format ${previous.format}`);
}
const tarDigest = sha256File(tarPath);
if (tarDigest !== previous.sourceTar.sha256) {
  throw new Error(
    `integrity_mismatch: elements build tar sha256 ${tarDigest} != pinned ${previous.sourceTar.sha256}; ` +
      "update the pinned provenance in manifest.json deliberately (DS §8 vendoring is by fingerprint)"
  );
}
const buildManifestDigest = sha256File(buildManifestPath);
if (buildManifestDigest !== previous.sourceTar.manifestSha256) {
  throw new Error(
    `integrity_mismatch: build MANIFEST.sha256 digest ${buildManifestDigest} != pinned ${previous.sourceTar.manifestSha256}`
  );
}

// --- 2. Extract to a scratch dir and verify EVERY file digest ----------------
const scratch = mkdtempSync(join(tmpdir(), "h2a-ds-elements-sync-"));
try {
  execFileSync("tar", ["-xf", tarPath, "-C", scratch], { stdio: "ignore" });
  const buildManifestText = readFileSync(buildManifestPath, "utf8");
  const pinned = new Map();
  for (const line of buildManifestText.trim().split("\n")) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error(`sync-ds-elements-vendor: bad MANIFEST.sha256 line: ${line}`);
    pinned.set(match[2], match[1]);
  }
  /** Every file under the extracted build, relative to the extraction root. */
  function walk(dir, prefix = "") {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel));
      else found.push(rel);
    }
    return found.sort();
  }
  const extracted = walk(scratch);
  if (extracted.length !== pinned.size || extracted.some((rel) => !pinned.has(rel))) {
    throw new Error(
      `integrity_mismatch: the build tar's file set does not match MANIFEST.sha256 (${extracted.length} files vs ${pinned.size})`
    );
  }
  for (const [rel, digest] of pinned) {
    const actual = sha256File(join(scratch, rel));
    if (actual !== digest) {
      throw new Error(`integrity_mismatch: ${rel} sha256 ${actual} != manifest ${digest}`);
    }
  }

  // --- 3. Sync the vendor tree ------------------------------------------------
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  for (const rel of extracted) {
    const target = join(vendorDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(scratch, rel), target);
    if (!statSync(target).isFile()) throw new Error(`sync-ds-elements-vendor: ${rel} did not copy as a file`);
  }
  const files = {};
  for (const rel of extracted) files[rel] = { sha256: pinned.get(rel) };
  const manifest = {
    format: "h2a.ds-elements-vendor/v1",
    sourceRepo: previous.sourceRepo,
    sourceCommit: previous.sourceCommit,
    sourceTar: {
      path: previous.sourceTar.path,
      sha256: tarDigest,
      manifestSha256: buildManifestDigest
    },
    packageName: previous.packageName,
    packageVersion: previous.packageVersion,
    files
  };
  writeFileSync(join(vendorDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`sync-ds-elements-vendor: ${extracted.length} files vendored from ${previous.sourceCommit}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

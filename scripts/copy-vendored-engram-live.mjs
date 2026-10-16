#!/usr/bin/env node
/**
 * Mirror the vendored engram-live entries into dist (h2a + h2a-runtime).
 *
 * tsc never compiles these files: the vendored *.js are excluded from both
 * tsconfigs and the sibling *.d.ts are type-only inputs. The build therefore
 * copies them verbatim into dist after emit and asserts byte-identity, so
 * the packed tarballs and global installs carry the exact pinned surface
 * (an os-bounded `file:` dependency cannot — see the GUARD test in
 * live-registration.test.ts). Stale sourcemaps for these paths are removed.
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = [
  [
    "packages/h2a/src/vendor/engram-live",
    "packages/h2a/dist/vendor/engram-live",
  ],
  [
    "packages/h2a-runtime/src/vendor/engram-live",
    "packages/h2a-runtime/dist/vendor/engram-live",
  ],
];

for (const [srcRel, destRel] of DIRS) {
  const srcDir = join(ROOT, srcRel);
  const destDir = join(ROOT, destRel);
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir).filter(
    (name) => name.endsWith(".js") || name.endsWith(".d.ts"),
  );
  if (names.length === 0) {
    throw new Error(`vendor mirror source empty: ${srcRel}`);
  }
  for (const name of names) {
    copyFileSync(join(srcDir, name), join(destDir, name));
  }
  for (const name of readdirSync(destDir)) {
    if (name.endsWith(".map")) {
      rmSync(join(destDir, name));
    }
  }
  for (const name of names) {
    const wanted = readFileSync(join(srcDir, name));
    const actual = readFileSync(join(destDir, name));
    if (!wanted.equals(actual)) {
      throw new Error(`vendor mirror mismatch: ${destRel}/${name}`);
    }
  }
}

console.log("vendor-engram-live mirror OK");

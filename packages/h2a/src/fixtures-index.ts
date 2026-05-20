import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { H2AArtifactKind } from "./types.js";

export interface H2ACanonicalFixtureManifestEntry {
  /** Path relative to the package root (e.g. `fixtures/contract.json`). */
  path: string;
  /** The canonical {@link H2AArtifactKind} this fixture is an instance of. */
  kind: H2AArtifactKind;
  /** The fixture artifact's own `id`. */
  id: string;
  /**
   * SHA-256 hex of the file content bytes (no `sha256:` prefix). The full
   * canonical hash is `"sha256:" + sha256` and matches `computeHash(parsed)`.
   */
  sha256: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// `dist/fixtures-index.js` → package root is one level up; fixtures sit at
// `<package>/fixtures/` (DEC-035). Loaded once at module init from disk so
// the canonical bytes never drift between source and runtime.
const MANIFEST_PATH = join(HERE, "..", "fixtures", "manifest.json");

const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as H2ACanonicalFixtureManifestEntry[];

export const H2A_CANONICAL_FIXTURES: readonly H2ACanonicalFixtureManifestEntry[] =
  Object.freeze(parsed.map((entry) => Object.freeze({ ...entry })));

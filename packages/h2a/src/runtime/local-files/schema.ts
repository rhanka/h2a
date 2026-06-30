/**
 * Local-files store schema versioning (DEC-036).
 *
 * Every initialized store carries a `<root>/.h2a-schema.json` sentinel:
 *
 * ```json
 * {
 *   "version": "1",
 *   "createdAt": "2026-05-20T08:12:34.567Z",
 *   "createdBy": "@sentropic/h2a-cli@0.1.1"
 * }
 * ```
 *
 * The version string is opaque and strictly compared against
 * `H2A_STORE_SCHEMA_VERSION`. A future schema bump requires:
 *
 *  - a new DEC documenting the layout change,
 *  - a migration ramp (`h2a store migrate --from <old> --to <new>`),
 *  - a `H2A_STORE_SCHEMA_VERSION` bump in this file.
 *
 * The escape hatch `createLocalStore({ allowVersionMismatch: true })` is
 * intentionally narrow: it logs a stderr warning, skips the version check,
 * and **never** rewrites the sentinel. It exists so a read-only inspection
 * tool (e.g., a debugger) can open a store written by a newer CLI.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const H2A_STORE_SCHEMA_VERSION = "1" as const;

export const H2A_STORE_SCHEMA_FILE = ".h2a-schema.json" as const;

export interface H2AStoreSchemaSentinel {
  readonly version: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export class StoreSchemaMismatchError extends Error {
  readonly foundVersion: string;
  readonly expectedVersion: string;

  constructor(foundVersion: string, expectedVersion: string, root: string) {
    super(
      `StoreSchemaMismatchError: store at ${root} declares schema version "${foundVersion}" but this CLI expects "${expectedVersion}". Run \`h2a store migrate --from ${foundVersion} --to ${expectedVersion}\` or pass \`allowVersionMismatch: true\` for read-only inspection (DEC-036).`
    );
    this.name = "StoreSchemaMismatchError";
    this.foundVersion = foundVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Best-effort lookup of `@sentropic/h2a-cli`'s own package version. We walk
 * up from the current module file (`dist/runtime/local-files/schema.js` at
 * runtime, or the TS source under tests) until we find a `package.json`
 * whose `name` matches. Falls back to `0.0.0-unknown` if the search fails,
 * which only affects the `createdBy` metadata field — it never aborts a
 * store init.
 */
export function readCliPackageVersion(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    let dir = dirname(here);
    // Walk up at most 8 levels (dist/runtime/local-files → package root is
    // typically 3, but allow some slack for the source-mode test runner).
    for (let i = 0; i < 8; i++) {
      try {
        const raw = readFileSync(`${dir}/package.json`, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === "@sentropic/h2a-cli" && typeof parsed.version === "string") {
          return `@sentropic/h2a-cli@${parsed.version}`;
        }
      } catch {
        /* keep walking */
      }
      const next = dirname(dir);
      if (next === dir) break;
      dir = next;
    }
  } catch {
    /* fall through */
  }
  return "@sentropic/h2a-cli@0.0.0-unknown";
}

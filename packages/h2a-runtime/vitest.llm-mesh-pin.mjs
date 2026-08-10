/**
 * Deterministic resolution pin for `@sentropic/llm-mesh` under vite/vitest.
 *
 * WHY THIS EXISTS. The repo can hold more than one copy of
 * `@sentropic/llm-mesh` on disk (a nested copy under
 * `packages/h2a-runtime/node_modules`, and/or a copy hoisted to
 * `<repo root>/node_modules` for other dependents such as
 * `@sentropic/llm-gateway`). Vite resolves bare imports by walking up from
 * the IMPORTER, so which copy wins depends on where the importing module
 * lives and on the install state; a copy whose version does not satisfy
 * h2a-runtime's package.json declaration (currently `^0.15.0`) may be
 * missing an export the runtime imports (e.g. `./facade`), or may simply be
 * the wrong release. When the wrong copy wins, `@sentropic/llm-mesh/facade`
 * can fail to load and the whole test FILE fails to COLLECT: vitest reports
 * "Test Files 1 failed / Tests no tests" — an ABSENCE of tests that never
 * shows up in a passed-count. This plugin removes that degree of freedom:
 * first-party imports of `@sentropic/llm-mesh` ALWAYS resolve to a copy
 * whose version satisfies h2a-runtime's declared range, or the run fails
 * LOUDLY at config load.
 *
 * Scope guard: importers inside node_modules keep Node's own resolution, so
 * other dependents hoisted at the root are untouched.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_NAME = "@sentropic/llm-mesh";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Minimal, correct implementation of npm's caret-range semantics, scoped to
 * the declaration shapes this repo actually uses for `@sentropic/llm-mesh`:
 * an exact pin ("0.13.2") or an npm caret range ("^0.15.0"). `semver` is
 * PREFERRED for this but is not resolvable here — it is not a dependency of
 * any package.json in this repo and has zero occurrences in
 * package-lock.json, so `import semver from "semver"` would fail at config
 * load. This hand-rolled check implements the documented caret algorithm
 * (https://github.com/npm/node-semver#caret-ranges-123-025-004): the
 * left-most non-zero of major/minor/patch is held fixed, everything to its
 * right may float up to (but excluding) the next value of that fixed
 * component. It does not handle prerelease/build-metadata tags — the
 * versions declared and resolved for this dependency are plain releases.
 */
function parseVersionTuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`llm-mesh pin: cannot parse "${version}" as a semver version.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionTuples(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * True when `version` satisfies `declared`. `declared` is either an exact
 * "X.Y.Z" pin (compared for equality, as before) or an npm caret range
 * "^X.Y.Z" (compared via the caret floor/ceiling window).
 */
export function satisfiesDeclaredLlmMeshVersion(version, declared) {
  if (!declared.startsWith("^")) {
    return version === declared;
  }
  const [rMajor, rMinor, rPatch] = parseVersionTuple(declared.slice(1));
  const v = parseVersionTuple(version);
  const floor = [rMajor, rMinor, rPatch];
  const ceiling =
    rMajor > 0
      ? [rMajor + 1, 0, 0]
      : rMinor > 0
        ? [0, rMinor + 1, 0]
        : [0, 0, rPatch + 1];
  return compareVersionTuples(v, floor) >= 0 && compareVersionTuples(v, ceiling) < 0;
}

/** The version h2a-runtime's package.json declares for @sentropic/llm-mesh. */
export function declaredLlmMeshVersion() {
  const declared = readJson(join(RUNTIME_DIR, "package.json")).dependencies?.[
    PKG_NAME
  ];
  if (typeof declared !== "string") {
    throw new Error(
      `llm-mesh pin: ${PKG_NAME} is no longer a dependency of packages/h2a-runtime/package.json — delete this pin or update it.`,
    );
  }
  return declared;
}

/**
 * Locate the physical @sentropic/llm-mesh copy that h2a-runtime's own sources
 * resolve (Node walk-up anchored at packages/h2a-runtime), then FAIL LOUDLY
 * unless its version SATISFIES the range package.json declares (exact match
 * for an exact pin, semver-caret window for a "^X.Y.Z" range). This accepts
 * whichever on-disk copy Node would actually resolve — root-hoisted or
 * nested under packages/h2a-runtime — as long as its version is in range. A
 * stale install or a copy whose version falls outside the declared range
 * dies HERE, at config load, with a named error — never as a silent
 * "no tests" collection.
 */
export function pinnedLlmMeshDir() {
  const declared = declaredLlmMeshVersion();
  for (let dir = RUNTIME_DIR; ; ) {
    const candidate = join(dir, "node_modules", ...PKG_NAME.split("/"));
    const manifest = join(candidate, "package.json");
    if (existsSync(manifest)) {
      const version = readJson(manifest).version;
      if (!satisfiesDeclaredLlmMeshVersion(version, declared)) {
        throw new Error(
          `llm-mesh pin: resolved ${PKG_NAME}@${version} at ${candidate}, but packages/h2a-runtime/package.json declares ${declared}, ` +
            `which ${version} does not satisfy. Run \`npm ci\` at the repo root and retry; if it still does not satisfy, the lockfile or the declared range is wrong.`,
        );
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `llm-mesh pin: ${PKG_NAME} is not installed anywhere above ${RUNTIME_DIR}. Run \`npm ci\` at the repo root.`,
      );
    }
    dir = parent;
  }
}

/**
 * Vite/vitest plugin: resolve every first-party import of @sentropic/llm-mesh
 * (bare or subpath) to the pinned copy, honoring its exports map. Importers
 * under node_modules are left to their own resolution.
 */
export function llmMeshPinPlugin() {
  const meshDir = pinnedLlmMeshDir();
  const exportsMap = readJson(join(meshDir, "package.json")).exports ?? {};
  return {
    name: "h2a-runtime:pin-llm-mesh",
    enforce: "pre",
    resolveId(id, importer) {
      if (id !== PKG_NAME && !id.startsWith(`${PKG_NAME}/`)) return null;
      if (importer && importer.split(sep).includes("node_modules")) return null;
      const subpath = id === PKG_NAME ? "." : `./${id.slice(PKG_NAME.length + 1)}`;
      const entry = exportsMap[subpath];
      const rel =
        typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
      if (typeof rel !== "string") {
        throw new Error(
          `llm-mesh pin: "${subpath}" is not exported by the pinned ${PKG_NAME} at ${meshDir} (see its exports field).`,
        );
      }
      return resolvePath(meshDir, rel);
    },
  };
}

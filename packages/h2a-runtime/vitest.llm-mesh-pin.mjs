/**
 * Deterministic resolution pin for `@sentropic/llm-mesh` under vite/vitest.
 *
 * WHY THIS EXISTS. The repo holds TWO copies of `@sentropic/llm-mesh`:
 *   - `packages/h2a-runtime/node_modules/@sentropic/llm-mesh` — the version
 *     h2a-runtime's package.json PINS (0.13.2, has the `./facade` export the
 *     runtime imports);
 *   - `<repo root>/node_modules/@sentropic/llm-mesh` — an older major hoisted
 *     for `@sentropic/llm-gateway`'s own `^0.8.0` range (NO `./facade`).
 * Vite resolves bare imports by walking up from the IMPORTER, so which copy
 * wins depends on where the importing module lives and on the install state.
 * When the root 0.8.x copy wins, `@sentropic/llm-mesh/facade` fails to load
 * and the whole test FILE fails to COLLECT: vitest reports
 * "Test Files 1 failed / Tests no tests" — an ABSENCE of tests that never
 * shows up in a passed-count. This plugin removes that degree of freedom:
 * first-party imports of `@sentropic/llm-mesh` ALWAYS resolve to the copy
 * h2a-runtime declares, or the run fails LOUDLY at config load.
 *
 * Scope guard: importers inside node_modules keep Node's own resolution, so
 * the root's 0.8.x dependents (`@sentropic/llm-gateway`) are untouched.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_NAME = "@sentropic/llm-mesh";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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
 * unless its version is exactly the one package.json declares. A stale or
 * hoisted install (nested copy missing, root 0.8.x winning) dies HERE, at
 * config load, with a named error — never as a silent "no tests" collection.
 */
export function pinnedLlmMeshDir() {
  const declared = declaredLlmMeshVersion();
  for (let dir = RUNTIME_DIR; ; ) {
    const candidate = join(dir, "node_modules", ...PKG_NAME.split("/"));
    const manifest = join(candidate, "package.json");
    if (existsSync(manifest)) {
      const version = readJson(manifest).version;
      if (version !== declared) {
        throw new Error(
          `llm-mesh pin: resolved ${PKG_NAME}@${version} at ${candidate}, but packages/h2a-runtime/package.json declares ${declared}. ` +
            "The install is stale or hoisted (the nested copy is missing). Run `npm ci` at the repo root and retry.",
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

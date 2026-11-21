import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRACK_BIN_REL = ["node_modules", "@sentropic", "track", "dist", "cli", "bin.js"];
const NESTED_TRACK_BIN_REL = [
  "node_modules",
  "@sentropic",
  "h2a",
  "node_modules",
  "@sentropic",
  "track",
  "dist",
  "cli",
  "bin.js",
];

function isRegularFile(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveFromPrefix(prefix) {
  if (typeof prefix !== "string" || prefix.trim().length === 0) return undefined;
  const trimmed = prefix.trim();
  if (!isAbsolute(trimmed)) return undefined;
  const candidates = [
    join(trimmed, "lib", ...TRACK_BIN_REL),
    join(trimmed, ...TRACK_BIN_REL),
    join(trimmed, "lib", ...NESTED_TRACK_BIN_REL),
    join(trimmed, ...NESTED_TRACK_BIN_REL),
  ];
  for (const candidate of candidates) {
    if (isRegularFile(candidate)) return candidate;
  }
  return undefined;
}

function detectGlobalNpmPrefix(env) {
  const fromEnv = env?.npm_config_prefix;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  try {
    const res = spawnSync("npm", ["prefix", "-g"], {
      encoding: "utf8",
      env,
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (res.status === 0 && typeof res.stdout === "string") {
      const prefix = res.stdout.trim();
      if (prefix.length > 0) return prefix;
    }
  } catch {
    // npm unavailable; caller handles missing binary cleanly
  }
  return undefined;
}

/**
 * Resolve Track's `bin.js` in strict priority order:
 *   1. `TRACK_BIN` (must be an absolute path to an existing file)
 *   2. Walking up from the hook script's own directory through `node_modules/@sentropic/track`
 *   3. The global npm prefix
 *
 * Never falls back to a bare `track` on `PATH` and never inspects `process.cwd()`.
 */
export function resolveTrackBin(options = {}) {
  const env = options.env ?? process.env;
  const fromDir = options.fromDir ?? dirname(fileURLToPath(import.meta.url));

  // 1. Explicit TRACK_BIN (absolute path only — never resolved relative to cwd).
  const envBin = env?.TRACK_BIN;
  if (typeof envBin === "string" && envBin.trim().length > 0) {
    const candidate = envBin.trim();
    if (isAbsolute(candidate) && isRegularFile(candidate)) {
      return candidate;
    }
  }

  // 2. Walk up from the hook script's own folder through node_modules/@sentropic/track.
  if (typeof fromDir === "string" && fromDir.length > 0 && isAbsolute(fromDir)) {
    let dir = fromDir;
    for (;;) {
      const candidate = join(dir, ...TRACK_BIN_REL);
      if (isRegularFile(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // 3. Global npm prefix.
  const globalPrefix =
    options.globalPrefix !== undefined
      ? options.globalPrefix
      : detectGlobalNpmPrefix(env);
  if (typeof globalPrefix === "string" && globalPrefix.length > 0) {
    const resolved = resolveFromPrefix(globalPrefix);
    if (resolved) return resolved;
  }

  return undefined;
}

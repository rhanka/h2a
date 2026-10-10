// Parité ② : `h2a` = LE driver global. Tout premier-mot qui n'est PAS un verbe
// h2a-NATIF est un verbe du runtime lourd et part en LAZY vers
// `@sentropic/h2a-runtime` (dispatchRuntime). Double-consensus unanime (opus-4-8 +
// codex xhigh, 2026-07-03) : FALLBACK, pas allowlist (l'allowlist plafonne + dérive).
//
// La RÈGLE D'OR est préservée : le fallback route toujours vers `dispatchRuntime()`,
// dont l'import dynamique à spécifieur-string reste la seule frontière runtime.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { H2A_CLI_VERB_CONTRACTS } from "./cli-contract.js";
import { TRACK_FACADE_VERBS } from "./cli.js";

// Verbes gérés DIRECTEMENT dans bin.ts (branches async). Ils sont tous déjà des
// premiers-mots du contrat, mais on les liste pour que le routage ne dépende
// jamais de cette coïncidence.
const BIN_HARD_NATIVE_FIRST_WORDS: readonly string[] = [
  "mcp-serve",
  "mcp-central-serve",
  "mcp-central-connect",
  "track-mcp",
  "remote",
  "drive",
  "drumbeat",
  "sysml",
  "keepalive",
  "loop"
];

/**
 * Premiers-mots de tous les verbes h2a-NATIFS : le contrat CLI gelé (DEC-034,
 * source unique) + les routes bin.ts + les alias d'aide. Tout ce qui n'est PAS
 * ici est un verbe runtime lourd → fallback `dispatchRuntime()`.
 */
export const H2A_NATIVE_VERBS: ReadonlySet<string> = new Set<string>([
  ...H2A_CLI_VERB_CONTRACTS.map((c) => c.verb.split(" ")[0]),
  ...BIN_HARD_NATIVE_FIRST_WORDS,
  // Façade track : verbes délégués à la CLI `track` par runCli (hors contrat
  // figé, mais bien h2a-natifs — ne PAS router vers le runtime).
  ...TRACK_FACADE_VERBS,
  "--help",
  "-h",
  "help"
]);

/**
 * `true` si `argv[0]` doit être délégué au runtime lourd. Les
 * verbes h2a-natifs (dont les collisions status/connect/conductor-launch) sont
 * exclus PAR CONSTRUCTION — le contrat gelé reste intact.
 */
export function shouldDispatchRuntime(argv: readonly string[]): boolean {
  const first = argv[0];
  return first !== undefined && !H2A_NATIVE_VERBS.has(first);
}

/** @deprecated Internal compatibility alias; use shouldDispatchRuntime. */
export const shouldDispatchRemote = shouldDispatchRuntime;

/** Capability contract between the leaf core and the optional heavy runtime. */
export const H2A_RUNTIME_CLI_API_VERSION = 1;

export type H2aRuntimeDispatch = (argv: readonly string[]) => Promise<number>;

/**
 * Resolve the canonical runtime dispatcher without executing it. Missing,
 * legacy-only, or incompatible modules are rejected before they can touch
 * config, tmux, or remote transports.
 */
export function resolveH2aRuntimeDispatch(runtime: unknown): H2aRuntimeDispatch {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("invalid h2a runtime module");
  }
  const candidate = runtime as {
    H2A_RUNTIME_CLI_API_VERSION?: unknown;
    dispatchH2a?: unknown;
    dispatch?: unknown;
  };
  if (typeof candidate.dispatchH2a !== "function") {
    if (typeof candidate.dispatch === "function") {
      throw new Error("legacy runtime exposes dispatch() but not canonical dispatchH2a()");
    }
    throw new Error("h2a runtime does not expose dispatchH2a()");
  }
  if (candidate.H2A_RUNTIME_CLI_API_VERSION !== H2A_RUNTIME_CLI_API_VERSION) {
    throw new Error(
      `runtime CLI API ${String(candidate.H2A_RUNTIME_CLI_API_VERSION ?? "missing")} is incompatible; expected ${H2A_RUNTIME_CLI_API_VERSION}`
    );
  }
  return candidate.dispatchH2a as H2aRuntimeDispatch;
}

// ---------------------------------------------------------------------------
// Garde d'écart CLI↔runtime (incident 2026-10 : runtime 0.98.2 déployé sous
// CLI 0.98.0 — toutes les CLIs mortes de crashs obscurs). PRÉ-VOL de
// déployabilité : avant de charger le module runtime, la CLI compare la
// version du runtime INSTALLÉ à la plage qu'elle déclare elle-même dans son
// package.json (dependencies, sinon peerDependencies). Hors plage → refus
// PROPRE avec les deux versions + la réparation, jamais un crash en aval.
// Échec de lecture des métadonnées → fail-open : l'import dynamique et le
// contrôle de forme ci-dessus restent le filet (une install cohérente ne doit
// jamais être bloquée par une métadonnée illisible).
// ---------------------------------------------------------------------------

export const H2A_RUNTIME_PACKAGE = "@sentropic/h2a-runtime";
/** Exit code d'un refus pré-vol : runtime installé hors de la plage de la CLI. */
export const H2A_RUNTIME_VERSION_EXIT = 64;

const LOOSE_SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const RANGE_RE = /^(\^|~)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/;

/** Parse a version triple leniently (a dev/prerelease suffix is tolerated). */
export function parseRuntimeVersion(
  version: string,
): { major: number; minor: number; patch: number } | undefined {
  const m = LOOSE_SEMVER_RE.exec(version.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareTriples(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Minimal semver-range evaluator for the forms this monorepo declares
 * (`^X.Y.Z`, `~X.Y.Z`, `X.Y.Z` exact, `*`), with npm's caret semantics on 0.x
 * (`^0.Y.Z` (Y>0) borne supérieure `<0.(Y+1).0`, `^0.0.Z` → `<0.0.(Z+1)`).
 * A version or range that cannot be parsed satisfies (fail-open) — this guard
 * refuses provable skew, it must never brick an install it cannot read.
 */
export function runtimeVersionSatisfiesRange(
  version: string,
  range: string,
): boolean {
  const v = parseRuntimeVersion(version);
  if (v === undefined) return true;
  const spec = range.trim();
  if (spec === "" || spec === "*" || spec === "latest" || spec.startsWith("workspace")) {
    return true;
  }
  const m = RANGE_RE.exec(spec);
  if (!m) return true;
  const base = {
    major: Number(m[2]),
    minor: m[3] !== undefined ? Number(m[3]) : 0,
    patch: m[4] !== undefined ? Number(m[4]) : 0,
  };
  if (compareTriples(v, base) < 0) return false;
  if (m[1] === "^") {
    if (base.major > 0) return v.major === base.major;
    if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
    return v.major === 0 && v.minor === 0 && v.patch === base.patch;
  }
  if (m[1] === "~") {
    return v.major === base.major && v.minor === base.minor;
  }
  return compareTriples(v, base) === 0;
}

/** Range this CLI expects, read from a parsed package.json (dep, else peer). */
export function expectedRuntimeRangeFromPackage(pkg: {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): string | undefined {
  return pkg.dependencies?.[H2A_RUNTIME_PACKAGE] ?? pkg.peerDependencies?.[H2A_RUNTIME_PACKAGE];
}

/** The runtime version range declared by THIS CLI's own package.json. */
export function readExpectedRuntimeRange(): string | undefined {
  try {
    // dist/bin-routing.js → ../package.json (robuste aux dossiers renommés).
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return expectedRuntimeRangeFromPackage(pkg);
  } catch {
    return undefined;
  }
}

/**
 * Version of the INSTALLED runtime package (its own package.json), or
 * undefined when it cannot be resolved/read. Resolution honours the runtime's
 * (possibly `import`-only) `exports` via `import.meta.resolve`, with a
 * `createRequire` fallback, then walks up to the package root whose `name`
 * matches — same pattern as cli.ts's `resolvePackageSkillsDir`.
 */
export function resolveInstalledRuntimeVersion(
  resolveEntry: (pkg: string) => string = defaultResolveRuntimeEntry,
): string | undefined {
  try {
    const pkgPath = runtimePackageJsonPath(resolveEntry(H2A_RUNTIME_PACKAGE));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function defaultResolveRuntimeEntry(pkg: string): string {
  const resolver = (import.meta as unknown as {
    resolve?: (specifier: string) => string;
  }).resolve;
  let mainFile: string | undefined;
  if (typeof resolver === "function") {
    try {
      mainFile = resolver(pkg);
    } catch {
      mainFile = undefined;
    }
  }
  if (!mainFile) {
    mainFile = createRequire(import.meta.url).resolve(pkg);
  }
  return mainFile;
}

function runtimePackageJsonPath(mainFile: string): string {
  // `import.meta.resolve` yields a file:// URL while `require.resolve` yields a
  // path — normalize once here so both resolvers feed the same walk-up.
  let dir = dirname(mainFile.startsWith("file://") ? fileURLToPath(mainFile) : mainFile);
  for (let depth = 0; depth < 8; depth++) {
    const pkgJsonPath = join(dir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { name?: string };
        if (parsed.name === H2A_RUNTIME_PACKAGE) return pkgJsonPath;
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot locate ${H2A_RUNTIME_PACKAGE} package root`);
}

/** Refusal message: installed version, expected range, repair command. */
export function runtimeVersionMismatchMessage(
  verb: string,
  installed: string,
  expected: string,
): string {
  return (
    `h2a ${verb}: le runtime ${H2A_RUNTIME_PACKAGE} installé (${installed}) est hors de la plage attendue par cette CLI (${expected}).\n` +
    "  Run h2a upgrade (ou npm i -g @sentropic/h2a@latest) pour réaligner l'installation lockstep.\n"
  );
}

/** Seams injectables du pré-vol + du dispatch (tests sans npm/réseau/lancement). */
export interface RuntimeDispatchDeps {
  readonly verb?: string;
  readonly importRuntime?: () => Promise<unknown>;
  readonly expectedRange?: string;
  readonly runtimeVersion?: string;
  readonly stderr?: { write(chunk: string): boolean };
}

async function defaultImportRuntime(): Promise<unknown> {
  // Spécifieur via variable typée `string` : tsc ne résout PAS statiquement ce
  // peer requis (l'import dynamique évite son chargement pour les verbes purs).
  const H2A_RUNTIME_PKG: string = H2A_RUNTIME_PACKAGE;
  return import(H2A_RUNTIME_PKG);
}

/**
 * Pré-vol de version puis dispatch lazy vers le runtime lourd (déplacé de
 * bin.ts pour rester testable : bin.ts est un entry à effets de bord).
 * Refus propre (exit H2A_RUNTIME_VERSION_EXIT) AVANT de charger un module
 * runtime dont la version est hors plage — un crash obscur au chargement ne
 * doit jamais être le premier symptôme d'un écart de version.
 */
export async function dispatchRuntime(
  deps: RuntimeDispatchDeps = {},
): Promise<number> {
  const verb = deps.verb ?? process.argv[2] ?? "";
  const stderr = deps.stderr ?? process.stderr;
  const expectedRange = deps.expectedRange ?? readExpectedRuntimeRange();
  const runtimeVersion = deps.runtimeVersion ?? resolveInstalledRuntimeVersion();
  if (
    expectedRange !== undefined && runtimeVersion !== undefined &&
    !runtimeVersionSatisfiesRange(runtimeVersion, expectedRange)
  ) {
    stderr.write(runtimeVersionMismatchMessage(verb, runtimeVersion, expectedRange));
    return H2A_RUNTIME_VERSION_EXIT;
  }
  let rt: unknown;
  try {
    rt = await (deps.importRuntime ?? defaultImportRuntime)();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      stderr.write(
        `h2a ${verb}: ce verbe requiert le runtime h2a (sessions / k8s / tunnel).\n` +
          "  Répare l'installation lockstep : npm i -g @sentropic/h2a@latest\n"
      );
      return 127;
    }
    throw err;
  }
  let dispatch;
  try {
    dispatch = resolveH2aRuntimeDispatch(rt);
  } catch (err) {
    stderr.write(
      `h2a ${verb}: runtime incompatible — ${(err as Error).message}.\n` +
        "  Mets à jour l'installation lockstep : h2a upgrade\n"
    );
    return 64;
  }
  // dispatchH2a = main(argv) : commander attend process.argv ([node, script, …]).
  return dispatch(process.argv);
}

// Parité ② : `h2a` = LE driver global. Tout premier-mot qui n'est PAS un verbe
// h2a-NATIF est un verbe du runtime lourd et part en LAZY vers
// `@sentropic/h2a-runtime` (dispatchRuntime). Double-consensus unanime (opus-4-8 +
// codex xhigh, 2026-07-03) : FALLBACK, pas allowlist (l'allowlist plafonne + dérive).
//
// La RÈGLE D'OR est préservée : le fallback route toujours vers `dispatchRuntime()`,
// dont l'import dynamique à spécifieur-string reste la seule frontière runtime.

import { H2A_CLI_VERB_CONTRACTS } from "./cli-contract.js";
import { TRACK_FACADE_VERBS } from "./cli.js";

// Verbes gérés DIRECTEMENT dans bin.ts (branches async). Ils sont tous déjà des
// premiers-mots du contrat, mais on les liste pour que le routage ne dépende
// jamais de cette coïncidence.
const BIN_HARD_NATIVE_FIRST_WORDS: readonly string[] = [
  "mcp-serve",
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

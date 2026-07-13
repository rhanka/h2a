// Parité ② : `h2a` = LE driver global. Tout premier-mot qui n'est PAS un verbe
// h2a-NATIF est un verbe du runtime (ex-remote) et part en LAZY vers
// `@sentropic/h2a-runtime` (dispatchRemote). Double-consensus unanime (opus-4-8 +
// codex xhigh, 2026-07-03) : FALLBACK, pas allowlist (l'allowlist plafonne + dérive).
//
// La RÈGLE D'OR est préservée : le fallback route toujours vers `dispatchRemote()`,
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
 * ici est un verbe runtime (remote) → fallback `dispatchRemote()`.
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
 * `true` si `argv[0]` doit être délégué au runtime lourd (verbe remote). Les
 * verbes h2a-natifs (dont les collisions status/connect/conductor-launch) sont
 * exclus PAR CONSTRUCTION — le contrat gelé reste intact.
 */
export function shouldDispatchRemote(argv: readonly string[]): boolean {
  const first = argv[0];
  return first !== undefined && !H2A_NATIVE_VERBS.has(first);
}

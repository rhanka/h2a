// Focus L-B — the opaque multi-project decision key (PLAN v2 fix #5, §4.1/§4.3).
//
//   decisionKey = projectHash:source:decisionId
//
// It lets two stacked projects that happen to share a raw decision id (or a
// bare escalate id) never collide on the deck, on `<key>.json` idempotency
// files, or on `POST /api/decisions/:decisionKey/answer` (fix #10/R10).
//
// Everything here is PURE and browser-safe: no node builtins, no crypto, no IO.
// `projectHash` is a small deterministic hash of the RESOLVED project root
// (PLAN §6.7 preco) so the same root always yields the same lane.

import type { DecisionSource } from "./contract.js";

const SOURCES: readonly DecisionSource[] = ["escalate", "track", "loop"];

function isDecisionSource(value: string): value is DecisionSource {
  return (SOURCES as readonly string[]).includes(value);
}

/**
 * PURE, deterministic, browser-safe project hash (FNV-1a, 32-bit → 8 hex).
 * Colon-free by construction, so it can never break `decisionKey` parsing.
 */
export function projectHash(projectRoot: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < projectRoot.length; i++) {
    hash ^= projectRoot.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface DecisionKeyParts {
  readonly projectHash: string;
  readonly source: DecisionSource;
  readonly decisionId: string;
}

export interface DecisionKeyInput {
  /** Resolved project root; hashed into `projectHash` when the latter is absent. */
  readonly projectRoot?: string;
  /** Precomputed project hash; must be colon-free. Overrides `projectRoot`. */
  readonly projectHash?: string;
  readonly source: DecisionSource;
  readonly decisionId: string;
}

/**
 * PURE: derive the opaque `decisionKey`. `decisionId` may itself contain ':'
 * (it is the trailing, unsplit segment); `projectHash` and `source` never do.
 */
export function decisionKey(input: DecisionKeyInput): string {
  const ph = input.projectHash ?? projectHash(input.projectRoot ?? "");
  if (ph.length === 0 || ph.includes(":")) {
    throw new Error(`decisionKey: projectHash must be non-empty and colon-free (got "${ph}")`);
  }
  if (!isDecisionSource(input.source)) {
    throw new Error(`decisionKey: unknown source "${input.source}"`);
  }
  if (input.decisionId.length === 0) {
    throw new Error("decisionKey: decisionId must be non-empty");
  }
  return `${ph}:${input.source}:${input.decisionId}`;
}

/**
 * PURE inverse of {@link decisionKey}. Splits on the FIRST TWO colons only, so a
 * `decisionId` that contains ':' round-trips exactly. Throws on a malformed key.
 */
export function parseDecisionKey(key: string): DecisionKeyParts {
  const firstColon = key.indexOf(":");
  const secondColon = firstColon < 0 ? -1 : key.indexOf(":", firstColon + 1);
  if (firstColon <= 0 || secondColon < 0) {
    throw new Error(`parseDecisionKey: malformed key "${key}" (want projectHash:source:decisionId)`);
  }
  const ph = key.slice(0, firstColon);
  const source = key.slice(firstColon + 1, secondColon);
  const decisionId = key.slice(secondColon + 1);
  if (!isDecisionSource(source)) {
    throw new Error(`parseDecisionKey: unknown source "${source}" in "${key}"`);
  }
  if (decisionId.length === 0) {
    throw new Error(`parseDecisionKey: empty decisionId in "${key}"`);
  }
  return { projectHash: ph, source, decisionId };
}

/** PURE: the lane (projectHash) a `decisionKey` belongs to. */
export function decisionKeyProjectHash(key: string): string {
  return parseDecisionKey(key).projectHash;
}

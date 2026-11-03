/**
 * Pinned trust for `remote-action-v1` verification (cell N1).
 *
 * The store is built once from pinned material and frozen. Resolution takes
 * only the pinned store: a `kid` names an entry inside it, never a root the
 * message selects. Unknown, revoked or cross-purpose kids fail closed, and
 * fixture keys never authorize live admission (`assertLiveKey`).
 *
 * Algorithm policy lives here too: raw bodies accept exactly `Ed25519`,
 * IdP evidence exactly JWS `EdDSA`. Anything else (RS256, `none`, aliases)
 * is refused before any cryptographic work.
 */

export type TrustFailureCode =
  | "unknown_kid"
  | "revoked_key"
  | "wrong_purpose"
  | "duplicate_kid"
  | "fixture_only";

export class TrustError extends Error {
  readonly code: TrustFailureCode;

  constructor(code: TrustFailureCode, message?: string) {
    super(message ?? code);
    this.name = "TrustError";
    this.code = code;
  }
}

export interface PinnedKey {
  kid: string;
  issuer: string;
  audience: string;
  /** Record kinds this key may sign, e.g. `action-envelope`, `evidence`. */
  purposes: readonly string[];
  publicKeySpkiBase64: string;
  revoked: boolean;
  /** Synthetic fixture keys: verification fixtures only, never live authority. */
  fixtureOnly: boolean;
}

export interface PinnedTrust {
  readonly keys: readonly PinnedKey[];
}

export function createPinnedTrust(entries: readonly PinnedKey[]): PinnedTrust {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.kid)) {
      throw new TrustError("duplicate_kid", `remote-action: duplicate kid ${entry.kid}`);
    }
    seen.add(entry.kid);
    Object.freeze(entry);
  }
  const keys = Object.freeze([...entries]);
  return Object.freeze({ keys });
}

/**
 * Resolve a pinned entry for one verification purpose. The `kid` selects
 * within the pinned store only; trust material carried inside the message
 * body is never consulted.
 */
export function resolveTrustEntry(
  trust: PinnedTrust,
  kid: string,
  purpose: string,
): PinnedKey {
  const entry = trust.keys.find((candidate) => candidate.kid === kid);
  if (entry === undefined) throw new TrustError("unknown_kid");
  if (entry.revoked) throw new TrustError("revoked_key");
  if (!entry.purposes.includes(purpose)) throw new TrustError("wrong_purpose");
  return entry;
}

/** Fail closed when a fixture-only key is presented for live admission. */
export function assertLiveKey(entry: PinnedKey): void {
  if (entry.fixtureOnly) throw new TrustError("fixture_only");
}

export function isAllowedBodyAlg(alg: unknown): boolean {
  return alg === "Ed25519";
}

export function isAllowedJwsAlg(alg: unknown): boolean {
  return alg === "EdDSA";
}

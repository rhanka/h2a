/**
 * NHI P3 (interop) — SPIFFE/SPIRE-compatible **export** primitives. Pure and
 * deterministic, like `nhi.ts`: the caller gathers an instance's active public
 * keys (the keyring) and a trust-domain name and passes them in; this module
 * only transforms them into a SPIFFE-bundle-/JWKS-shaped object and a SPIFFE
 * ID. It owns no I/O, no clock, no network and adds no dependency.
 *
 * Design + sourced SPIFFE facts: `docs/superpowers/specs/2026-05-28-nhi-p3-interop-design.md`.
 * Gate / shortlist: `evaluations/nhi-landscape.md` (§6 #1, SPIFFE-first).
 *
 * Scope honesty: h2a is **not** a SPIRE replacement. It mints no SVIDs and does
 * no node/workload attestation. h2a holds PEM (SPKI) ed25519 *public* keys, not
 * JWK-encoded keys and not X.509/JWT SVIDs. So this is the **trust-anchor**
 * material in a bundle *shape*: the real SPIFFE/RFC-7517 bundle-level fields
 * (`keys`, optional `spiffe_sequence`/`spiffe_refresh_hint`), but each key entry
 * is an h2a-native descriptor (fingerprint as `kid` + the PEM) explicitly tagged
 * so it is not mistaken for an `x509-svid`/`jwt-svid` JWK. PEM→JWK(OKP) encoding,
 * SVID minting and the live HTTPS bundle endpoint are an external connector's job
 * (`../sentropic/`), where a crypto dependency is acceptable; core stays pure.
 *
 * SPIFFE references (verified):
 * - SPIFFE-ID format: https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md
 * - Trust Domain & Bundle (JWK Set): https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md
 */

import { nhiKeyFingerprint } from "./nhi.js";

/** Honest `use` tag: h2a keys sign h2a envelopes — NOT `x509-svid`/`jwt-svid`. */
export const H2A_NHI_EXPORT_KEY_USE = "h2a-envelope-signing" as const;

/**
 * Documented, convention-reversible mapping of h2a instance-id characters that
 * are outside the SPIFFE path-segment set `[a-zA-Z0-9._-]`. h2a instance ids use
 * `:` (e.g. `claude:p1`) and subagents use `~` (`parent~name`), neither of which
 * is a legal SPIFFE path char. Open question (see spec): confirm canonical
 * encoding with a DEC before treating it as stable across a real SPIRE consumer.
 */
export const H2A_NHI_SPIFFE_PATH_ENCODINGS: ReadonlyArray<readonly [string, string]> = [
  [":", "."],
  ["~", "--"]
];

/** Trust-domain host rule (SPIFFE-ID.md): lowercase `[a-z0-9._-]`, non-zero length. */
const TRUST_DOMAIN_RE = /^[a-z0-9._-]+$/;
/** Legal SPIFFE path-segment chars after our encoding (SPIFFE-ID.md). */
const PATH_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

function encodeInstanceToPath(instance: string): string {
  let out = instance;
  for (const [from, to] of H2A_NHI_SPIFFE_PATH_ENCODINGS) {
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Map an h2a instance id to a spec-valid SPIFFE ID `spiffe://<trust-domain>/<instance>`.
 * The trust domain is validated (lowercase `[a-z0-9._-]`); disallowed instance-id
 * characters are encoded per `H2A_NHI_SPIFFE_PATH_ENCODINGS`. Throws on an
 * empty/invalid trust domain or an instance that cannot map to a legal path
 * segment — keeping outputs well-formed, consistent with `nhi.ts`.
 *
 * SPIFFE-ID.md: scheme MUST be `spiffe`, non-zero trust domain, no
 * query/fragment, no trailing `/`, no percent-encoding.
 */
export function nhiSpiffeId(trustDomain: string, instance: string): string {
  if (!TRUST_DOMAIN_RE.test(trustDomain)) {
    throw new Error(
      `nhiSpiffeId: invalid trust domain ${JSON.stringify(trustDomain)} ` +
        "(must be non-empty lowercase [a-z0-9._-])"
    );
  }
  const path = encodeInstanceToPath(instance);
  if (!PATH_SEGMENT_RE.test(path)) {
    throw new Error(
      `nhiSpiffeId: instance ${JSON.stringify(instance)} does not map to a legal ` +
        "SPIFFE path segment [a-zA-Z0-9._-] after encoding"
    );
  }
  return `spiffe://${trustDomain}/${path}`;
}

/**
 * One key entry in an h2a trust-bundle export. JWK-shaped (`kid`/`kty`) so a
 * SPIFFE/JWKS reader recognises the structure, but the key material and `use`
 * are h2a-namespaced because they are NOT a real SVID-backing JWK (see module
 * note). `kid` reuses the existing `nhiKeyFingerprint` (RFC 7517 key id).
 */
export interface H2ANhiTrustBundleKey {
  /** RFC 7517 `kid`: the stable, non-reversible 12-char key fingerprint. */
  readonly kid: string;
  /** RFC 7517 `kty`: ed25519 is an OKP key (RFC 8037). */
  readonly kty: "OKP";
  /** h2a-native: the actual PEM (SPKI) public key — the trust-anchor material. */
  readonly h2a_public_key_pem: string;
  /** Honest tag: not `x509-svid`/`jwt-svid`; h2a keys sign h2a envelopes. */
  readonly h2a_use: typeof H2A_NHI_EXPORT_KEY_USE;
}

/**
 * A SPIFFE-trust-bundle-/JWKS-shaped export for one h2a instance. `keys` and the
 * optional `spiffe_sequence`/`spiffe_refresh_hint` are the real SPIFFE bundle
 * field names (Trust Domain & Bundle md); `spiffe_id`/`trust_domain` are added
 * for convenience so a consumer/connector has the owning identity inline.
 */
export interface H2ANhiTrustBundle {
  /** Convenience: the bundle's owning SPIFFE ID (`spiffe://<domain>/<instance>`). */
  readonly spiffe_id: string;
  /** The trust-domain name this bundle is authoritative for. */
  readonly trust_domain: string;
  /** SPIFFE/JWKS bundle field: the public keys (one per active key). */
  readonly keys: readonly H2ANhiTrustBundleKey[];
  /** Optional SPIFFE field: supersession/ordering counter (caller-supplied). */
  readonly spiffe_sequence?: number;
  /** Optional SPIFFE field: how often a consumer should re-fetch (caller-supplied). */
  readonly spiffe_refresh_hint?: number;
}

export interface H2ANhiTrustBundleInput {
  readonly instance: string;
  readonly trustDomain: string;
  /** The instance's currently-active public keys (PEM), net of revocations. */
  readonly activeKeys: readonly string[];
  /** Optional SPIFFE `spiffe_sequence` (omitted from output when absent). */
  readonly sequence?: number;
  /** Optional SPIFFE `spiffe_refresh_hint` in seconds (omitted when absent). */
  readonly refreshHint?: number;
}

/**
 * Build a SPIFFE-bundle-shaped trust-anchor export from an instance's active
 * public keys. Pure: same key in → same bundle out. Empty `activeKeys` yields an
 * empty `keys[]` (a well-formed bundle, not an error). Carries only public
 * material — never a private key.
 */
export function nhiTrustBundle(input: H2ANhiTrustBundleInput): H2ANhiTrustBundle {
  const spiffe_id = nhiSpiffeId(input.trustDomain, input.instance);
  const keys: H2ANhiTrustBundleKey[] = input.activeKeys.map((pem) => ({
    kid: nhiKeyFingerprint(pem),
    kty: "OKP",
    h2a_public_key_pem: pem,
    h2a_use: H2A_NHI_EXPORT_KEY_USE
  }));
  return {
    spiffe_id,
    trust_domain: input.trustDomain,
    keys,
    ...(input.sequence !== undefined ? { spiffe_sequence: input.sequence } : {}),
    ...(input.refreshHint !== undefined ? { spiffe_refresh_hint: input.refreshHint } : {})
  };
}

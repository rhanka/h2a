# NHI P3 (interop) — SPIFFE/SPIRE-compatible export — design

> Spec for **NHI P3 (interop)**, the palier parked at DEC-090 and gated by the veille [`evaluations/nhi-landscape.md`](../../../evaluations/nhi-landscape.md). The veille's shortlist ranks **SPIFFE/SPIRE first** (standards-first, durable, no single-vendor bet). This spec designs the *first P3 interop primitive*: a **SPIFFE/SPIRE-compatible export** of artifacts h2a already holds — specifically a **trust-bundle export** built from an instance's active public keys (the keyring) plus a **SPIFFE-ID mapping** for an h2a instance id. It also argues build-location: the pure transform lives in `@sentropic/h2a` (core); any *live* SPIRE network integration is an external connector candidate for `../sentropic/`.
>
> Discipline: every SPIFFE claim below carries a verified URL. Where a SPIFFE detail could not be verified or is intentionally not adopted, it is flagged, not invented.

## Why SPIFFE first (recap of the gate)

The veille concludes SPIFFE/SPIRE is the closest *standard* to what h2a already is, and the lowest-risk, most durable P3 target (`evaluations/nhi-landscape.md` §6 #1). The structural correspondences:

- h2a's ed25519 **signed envelope** (`createEnvelope`/`signEnvelope`, DEC-073; the `nhiAttestationEnvelope`, DEC-088) ≈ a self-issued **verifiable credential** / SVID analogue — a cryptographically-verifiable document a holder presents to prove "who attested what", verified against a known public key. SPIFFE's SVID is "the document with which a workload proves its identity to a resource or caller", encoded X.509 or JWT [[spiffe-concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)].
- h2a's **keyring** (active public keys per instance, rotated add→overlap→revoke, DEC-078/079; surfaced as `activeKeys`/`nhiKeyFingerprint` in `nhi.ts`) ≈ a SPIFFE **trust bundle** — the public key material a verifier uses to validate a presented credential. SPIFFE defines a trust bundle as "a collection of one or more certificate authority (CA) root certificates that the workload should consider trustworthy", i.e. the public key material enabling verification [[spiffe-concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)]. In its JSON-encoded form, a SPIFFE trust bundle **is an RFC 7517 JWK Set** [[SPIFFE_Trust_Domain_and_Bundle](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md)].
- **verify-on-receipt** (`verifyEnvelopeSignature`) ≈ SVID verification against a bundle.

**Scope honesty (carried from the veille):** h2a is *not* a SPIRE replacement. It performs no node/workload attestation and mints no SVIDs. P3's SPIFFE work is **trust-anchor publication + ID mapping** — making h2a's active public keys consumable in a SPIFFE-bundle shape and mapping an h2a instance id to a SPIFFE ID — so that a SPIFFE-aware verifier could be pointed at h2a's keys. It is bundle-/credential-*shaped*, not an issuer.

## The first P3 interop primitive

A single **pure transform** that takes what `nhi.ts` already models (an instance + its `activeKeys`) and a `trustDomain`, and emits a **SPIFFE-bundle-shaped object** plus the instance's **SPIFFE ID**. No new artifact kind, no I/O, no network, no new dependency — exactly the discipline the rest of `nhi.ts` follows (the caller gathers the snapshot; core only transforms it).

### (a) Trust-bundle export from the keyring

`nhiTrustBundle({ instance, trustDomain, activeKeys })` → a JWK-Set-shaped bundle object. Verified facts that constrain the shape:

- The SPIFFE trust bundle is a JWK Set [RFC 7517]. Bundle-level fields: **`keys`** (required, array of JWKs); optional **`spiffe_sequence`** and **`spiffe_refresh_hint`** [[SPIFFE_Trust_Domain_and_Bundle](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md)].
- Each JWK entry must include **`kty`** (required, RFC 7517 §4.1) and **`use`** (required), where `use` indicates the SVID type the key is authoritative for; the two specified values are **`x509-svid`** and **`jwt-svid`** (case sensitive) [[SPIFFE_Trust_Domain_and_Bundle](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md)].

**What h2a can faithfully fill vs. what it cannot — and the honest gap:**

h2a holds **PEM-encoded ed25519 public keys** (SPKI), not JWK-encoded keys, and it holds **raw public keys, not X.509 certificates or JWTs**. A *fully* spec-conforming SPIFFE bundle entry requires a real JWK (for ed25519 that is an OKP key with `crv`/`x`, per RFC 8037) and a `use` of `x509-svid` or `jwt-svid`. h2a's keys back **neither** an X.509-SVID nor a JWT-SVID today — they sign h2a envelopes. Converting PEM→JWK (OKP) and minting SVIDs is explicitly out of core scope (it needs key decoding / a crypto dependency, and SVID minting is the SPIRE role we are *not* taking on).

Therefore the core export is a **SPIFFE-bundle-*shaped*** object that is honest about this: it carries the spec's bundle-level fields (`keys`, optional `spiffe_sequence`/`spiffe_refresh_hint`), but each key entry is an **h2a-native descriptor** — the `nhiKeyFingerprint` (stable, non-reversible id, reused as the JWK `kid`) plus the PEM — and is explicitly tagged as h2a-origin material rather than masqueraded as an `x509-svid`/`jwt-svid` JWK. The output is the *trust-anchor bundle* a connector would translate; the spec-faithful PEM→JWK(OKP)→SVID conversion is the **connector's** job (`../sentropic/`), where a crypto dep is acceptable. This keeps core dependency-free and avoids inventing JWK fields h2a cannot truthfully populate.

Chosen output shape (see the implementation for exact types):

```jsonc
{
  "spiffe_id": "spiffe://<trust-domain>/<instance>",   // convenience: the bundle's owning ID
  "trust_domain": "<trust-domain>",
  "keys": [                                            // SPIFFE/JWKS bundle-level field name
    {
      "kid": "<nhiKeyFingerprint(pem)>",               // RFC 7517 key id = the existing 12-char fingerprint
      "kty": "OKP",                                    // ed25519 is an OKP key (RFC 8037)
      "h2a_public_key_pem": "<PEM SPKI>",              // h2a-native: the actual public key material
      "h2a_use": "h2a-envelope-signing"                // honest tag: NOT x509-svid/jwt-svid; see gap above
    }
  ],
  "spiffe_sequence": <n>                               // optional, only when caller supplies a sequence
}
```

Notes on field choices:
- `keys` and `kty` are the real SPIFFE/RFC-7517 field names, so a SPIFFE-aware reader sees a JWK-Set-*shaped* document.
- `kid` reuses the existing `nhiKeyFingerprint` — already the project's stable, non-reversible key id, and a legitimate RFC 7517 key-id.
- The two h2a-prefixed fields (`h2a_public_key_pem`, `h2a_use`) are deliberately namespaced so they cannot be mistaken for spec JWK members; they flag that this is trust-anchor material to be *translated*, not a ready SVID-verification JWK. This is the "flag rather than invent" choice.
- `spiffe_sequence` is emitted only when the caller passes one (it is optional in the spec and h2a has no inherent monotonic bundle counter); `spiffe_refresh_hint` likewise optional, caller-supplied.

### (b) SPIFFE-ID mapping for an h2a instance

`nhiSpiffeId(trustDomain, instance)` → `spiffe://<trust-domain>/<instance>`.

Verified constraints (so the mapping is spec-valid, not invented):
- Format is `spiffe://trust-domain-name/path`; scheme MUST be `spiffe`; non-zero trust domain; no query/fragment [[SPIFFE-ID](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)].
- Trust-domain host MUST be lowercase, characters `[a-z0-9._-]`, no percent-encoding [[SPIFFE-ID](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)].
- Path segments allow `[a-zA-Z0-9._-]`, no empty/`.`/`..` segments, no percent-encoding, no trailing `/` [[SPIFFE-ID](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)].

**h2a instance-id ↔ SPIFFE path tension (flagged, not papered over):** h2a instance ids look like `claude:p1`, `codex:p2` — they contain a colon `:` and a `~` for subagents (`parent~name`, see `subagents.ts`). Neither `:` nor `~` is in the allowed SPIFFE *path*-segment set `[a-zA-Z0-9._-]`. The pure function therefore applies a **documented, reversible-by-convention mapping**: each disallowed character is encoded to an allowed token (e.g. `:` → `.`, `~` → `--`) so the resulting path is spec-valid, and the function returns the resulting `spiffe://…` plus enough metadata for a connector to reconstruct the original id. The exact mapping is part of the implementation and is the *only* place a transformation happens; the trust-domain is validated/lowercased per the rules above and an invalid trust-domain is rejected (throws), consistent with how `nhi.ts` keeps outputs well-formed. (Open question 3 below: confirm the canonical encoding with a DEC; a colon-bearing path is the kind of detail to verify against a real SPIRE consumer rather than guess.)

### (c) Relation of the attestation envelope to a verifiable credential

No code change here — this is the conceptual mapping the spec records so a future connector knows what to do with `nhiAttestationEnvelope`:

- The signed attestation envelope (DEC-088) is the **verifiable-credential / SVID analogue**: an ed25519-signed, channel-independent document whose signature anyone holding the signer's public key can verify with `verifyEnvelopeSignature`. SPIFFE's SVID is functionally the same role — "the document with which a workload proves its identity" [[spiffe-concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/)].
- The **trust-bundle export (a)** is precisely what a remote verifier needs to *check* that envelope: the active public keys, in a bundle shape. So (a) and the envelope compose: publish the bundle as the trust anchor, present the envelope as the credential. This mirrors SPIFFE Federation, where **trust bundles are the only artifacts exchanged** between trust domains so credentials minted in one domain verify in another [[SPIFFE_Federation](https://spiffe.io/docs/latest/spiffe-specs/spiffe_federation/)].
- What h2a does *not* do, and the connector must own if a real SVID is required: PEM→JWK(OKP) encoding, X.509/JWT SVID minting, and the live HTTPS **bundle endpoint** (SPIFFE Federation serves bundles over an HTTPS endpoint [[SPIFFE_Federation](https://spiffe.io/docs/latest/spiffe-specs/spiffe_federation/)]).

## Build location

**Core (`@sentropic/h2a`) — this slice.** The trust-bundle *transform* and the SPIFFE-ID *mapping* are pure, deterministic, dependency-free string/object transforms over data `nhi.ts` already models. They belong beside `nhi.ts` as `nhi-export.ts`: same input vocabulary (`instance`, `activeKeys`, `nhiKeyFingerprint`), same "caller supplies the snapshot, core only transforms" discipline, same no-I/O / no-clock-of-its-own rule. Keeping them in core means every surface (CLI/MCP, and any connector) shares one canonical export shape.

**Connector (`../sentropic/`) — not this slice.** Anything that touches the network or needs a crypto dependency is an external connector:
- serving the bundle over an HTTPS **bundle endpoint** (SPIFFE Federation transport) [[SPIFFE_Federation](https://spiffe.io/docs/latest/spiffe-specs/spiffe_federation/)];
- PEM→JWK(OKP) conversion and real `x509-svid`/`jwt-svid` minting;
- any live SPIRE Server / Workload-API integration.

This matches the veille's open question 3 and `evaluations/nhi.md`'s P3 row ("candidate to live in `../sentropic/`; core stays in h2a"). Core stays protocol-pure; the connector is where SPIFFE *wire* conformance and crypto live. (A DEC will confirm the split when the connector is actually built; this spec only commits the pure core primitive.)

## Testing (core, this slice)

Mirror `nhi.test.js` (node:test + assert, import from `../dist/index.js`):
- `nhiSpiffeId` builds a spec-valid `spiffe://` URI; lowercases/validates the trust domain; encodes `:`/`~` to allowed path tokens; rejects an empty/invalid trust domain.
- `nhiTrustBundle` emits `keys[]` with one entry per active key, each carrying `kid === nhiKeyFingerprint(pem)`, `kty: "OKP"`, the PEM under `h2a_public_key_pem`, and the honest `h2a_use` tag; carries `trust_domain` and the matching `spiffe_id`; empty `activeKeys` → empty `keys` (well-formed, not an error).
- `spiffe_sequence`/`spiffe_refresh_hint` appear only when supplied.
- The export contains **no private key material** and the bundle's `kid` is the fingerprint (parity with `nhi.ts`'s "fingerprints, never raw secrets" — here the PEM *public* key is intentionally present because a trust bundle's job is to carry public keys).
- Round-trip composability sanity: the `spiffe_id` returned inside the bundle equals `nhiSpiffeId(trustDomain, instance)`.

## Out of scope (later paliers / connector)

- Live SPIFFE Federation HTTPS bundle endpoint; SPIRE Server/Workload-API integration.
- PEM→JWK(OKP) conversion and real SVID (X.509/JWT) minting.
- The vendor evidence-feed sink (veille §6 #2) and secrets-manager rotation handoff (§6 #3) — separate P3 archetypes, not this slice.
- CLI/MCP surface for the export (a thin `h2a nhi export`-style verb is the obvious next step but is CLI-package work, excluded from this core-only slice).

## Open questions

1. **Bundle fidelity vs. honesty.** This slice ships a SPIFFE-bundle-*shaped* object with h2a-namespaced key entries rather than a fully spec-conforming JWK Set, because h2a holds PEM public keys, not JWK/SVID material. Confirm this is the right line (core emits trust-anchor material; connector does PEM→JWK + SVID) vs. pulling a JWK encoder into core. Recommendation: keep core honest/dependency-free.
2. **`use` semantics.** The spec's `use` values are `x509-svid` / `jwt-svid`; h2a keys are neither. We emit `h2a_use: "h2a-envelope-signing"` and omit a spec `use`. Confirm a consuming SPIRE/verifier tolerates (or that the connector supplies) the real `use` at translation time.
3. **SPIFFE-ID path encoding for `:` and `~`.** `claude:p1` / `parent~name` contain characters outside the SPIFFE path set. Confirm the canonical encoding (`:`→`.`, `~`→`--` proposed) with a DEC, ideally validated against a real SPIRE consumer, before treating it as stable/reversible.
4. **Trust-domain source.** Where does `trustDomain` come from for an h2a deployment — config, the host, a per-instance setting? The pure function takes it as a parameter; the policy of choosing it is a CLI/deployment concern.
5. **Sequence/refresh-hint.** Does h2a want to derive a `spiffe_sequence` from keyring-event ordering (monotonic, supersession-friendly) rather than leaving it caller-supplied? Out of scope here; flagged for the connector.
6. **DEC + version bump.** This slice is additive public surface in core (`nhiTrustBundle`, `nhiSpiffeId` + types) → minor bump, new DEC. The connector and any CLI verb get their own DEC(s).

## References

SPIFFE (verified for this spec):
- SPIFFE Trust Domain and Bundle (JWK Set; `keys`/`spiffe_sequence`/`spiffe_refresh_hint`; per-JWK `kty`/`use`; `use` ∈ {`x509-svid`,`jwt-svid`}): https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Trust_Domain_and_Bundle.md
- SPIFFE-ID format (`spiffe://trust-domain/path`; lowercase trust domain `[a-z0-9._-]`; path segments `[a-zA-Z0-9._-]`; no query/fragment/trailing-slash/percent-encoding): https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md
- SPIFFE concepts (SVID, trust domain, trust bundle definitions; verify-against-bundle): https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/
- SPIFFE Federation (trust bundles are the only artifacts exchanged; HTTPS bundle endpoint): https://spiffe.io/docs/latest/spiffe-specs/spiffe_federation/
- RFC 7517 (JSON Web Key / JWK Set) and RFC 8037 (OKP / Ed25519 JWK) — the encodings the connector would target when minting real JWKs.

h2a internal:
- `packages/h2a/src/nhi.ts` (DEC-087 report · DEC-088 attest · DEC-090 inventory; `nhiKeyFingerprint`, `activeKeys`, snapshot discipline).
- `packages/h2a/src/nhi-export.ts` (this slice — the pure transform).
- `packages/h2a/src/envelope.ts` (DEC-073 signed envelope) · `packages/h2a/src/subagents.ts` (instance-id / `~` addressing).
- Veille: `evaluations/nhi-landscape.md` (§6 #1 SPIFFE-first) · `evaluations/nhi.md` (P3 row, build-location).

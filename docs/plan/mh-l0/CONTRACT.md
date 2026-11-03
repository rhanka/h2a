# MH-L0 contract, revision 1

## Bytes and authentication

`canonicalBytes` implements the RFC 8785 serialization of already parsed I-JSON:
UTF-8, UTF-16 code-unit ordering of object keys, ECMAScript number spelling,
no whitespace, invalid Unicode/non-finite values/cycles/undefined rejected.
Integer-looking object keys are emitted directly, never re-enumerated by
`JSON.stringify(object)`. No normalization of Unicode or descriptions occurs.
The caller must parse untrusted JSON before calling these leaf functions.

Digests have `sha256:<64 lowercase hex>` spelling. File digests hash raw bytes;
record digests hash canonical bytes. MACs are exactly 64 lowercase hex digits,
compared in constant time after length/alphabet validation.

Key derivation is HKDF-SHA-256, 32 output bytes, root of at least 32 random bytes:

```text
salt = UTF8("h2a-mcp-v2/hkdf/v1")
info = JCS({domain, generation, namespaceId, service:"h2a-mcp-central"})
domain ∈ readiness | requests | responses | notifications | admission | compatibility
MAC = HMAC-SHA-256(derivedKey, JCS(payload_without_mac))
```

The lock-naming secret is distinct from the v2 root. The v1 `token` is a random
decoy with zero admission rights. `authKeyReference` is a private root-relative
reference, never the secret or a derived key. Production generation UUIDs and
key files must be minted by the participants; deterministic keys exist only in
test fixtures excluded from publication.

Every new TCP connection needs its own authenticated challenge before an
application body. Request/response/notification schemas carry the binding
fields; enforcing nonce lifetimes, connection fencing and channel sequence
caches belongs to MH-L2/MH-L3. No auth bypass is available in these modules.

## Schemas and provenance

`schemas.json` exports draft 2020-12 definitions with three custom formats:
canonical absolute path, safe root-relative path, canonical numeric-loopback
HTTP endpoint. External validators must register those formats. `formats.js`
checks the same definitions directly, without adding a runtime dependency.
Named record fields and versions are closed. Checkpoint/state sections whose
business contents are not specified by v7 remain explicit JSON sections, not
implicit missing fields. MH-L4 must define their payload semantics before its
participants are frozen.

Process identity uses the `.6` leaf vocabulary: `machineId`, `bootId`,
`pidNamespace`, `nsNet`, `pid`, `startTime` (ticks). Publication epochs use
`{bootId,counter}`. Missing legacy identity fields are never invented.
Other-prefix authority is `foreign_installation_authority`; new-start routing
must choose stdio before initialize rather than reclaim it (MH-L1/MH-L2).

Evidence binds attester, source, target, attachment, inventory, nonce, expiry,
upgrade/handover/controller epochs, selected manifest and delegated identity.
Future verifier build IDs are open. A complete positive MAC does not authorize
an unrelated transaction. The first-acceptance predicate also requires a
durably established delegation and the exact report digest. It verifies the
provenance of a verdict; the semantic additive verifier remains .8.

Participants must provide the expected published attester and transaction tuple,
not derive expectations from the proof itself. MH-L3 must additionally serialize
allowed attestation state, first acceptance, ACK and idempotent post-commit replay.
Catalogue-only authority never authorizes publication or stop. The L0 peer's CAS
and lost-ACK restoration are test simulations, not a product .8 acquisition.

## Private persistence

All paths are explicit; there is no HOME/XDG/default production state lookup.
Parents must exist, be ordinary directories without symlink ancestors, and the
immediate state directory must have current UID and mode `0700`. Files are
ordinary, current UID, `0600`, opened with `O_NOFOLLOW` and checked by fstat.
Unknown schemas, malformed/noncanonical bytes and insecure objects throw;
only ENOENT of the target in a valid directory means absence.

Publication order:

1. Create a unique temporary in the same directory with exclusive open, `0600`.
2. Write canonical bytes plus one LF; fsync the file; close it.
3. Link exclusively for first publication, or replace atomically after a fresh
   dev/ino/content-digest comparison under **caller-held publication exclusion**.
4. Remove the temporary link and fsync the directory.
5. Re-read and validate before acknowledging success.

Revision-bearing records advance by exactly one. Epochs never decrease; a
same-boot publication counter strictly grows. Cross-boot transaction recovery
still requires explicit identity evidence in the participant. These functions
do not acquire the legacy reclaim/succession lock on a caller's behalf and do
not provide distributed CAS by themselves.

Failure after publication is `persistence_indeterminate:reconcile_before_mutation`.
No rollback, empty-store fallback or acknowledgement is fabricated. Test-only
fsync faults use node:test mocking of fs; no fault injection parameter is shipped.
All H4 journals, selections/history, authority, reservations, attempt counters,
delegation tickets and checkpoints must use these guarantees.

## Authority domain and installation layout

Physical prefix P comes from verified installation metadata. Compare its dev/ino
with the prefix used by the legacy engine before using `P/.h2a-upgrade.lock`.
`prefixId = SHA256(JCS({canonicalPrefix:realpath(P),uid:U}))` and
`I = P/h2a-managed/U`, outside P/lib. Shared writable or foreign-owned prefixes
are refused by the L0 prototype. Whether a wider shared-prefix policy is allowed
is part of QF, not an implicit acceptance.

Store `authority-domain.json` in the private historical marker directory,
shared by every attempt targeting that marker, independently of network ns.
First publication uses exclusive link(2), never a netns-local lock alone. The
winner allocates namespaceId; later contenders read it rather than regenerating
it from HOME/XDG. Foreign/corrupt/incomplete anchors are never overwritten.

Under a current comparable `.6` proc frame, verify nsNet explicitly before bind.
Unknown frame refuses with `authority_namespace_unknown`; differing netns gives
`authority_netns_mismatch`. The real Linux abstract address is:

```text
NUL + "h2a-mcp-" + HEX(HMAC-SHA256(lockSecret,
  JCS({domain:"h2a-mcp-preclaim/v1",canonicalMarkerLocation,uid,processFrame})))
```

An occupied address refuses `authority_lock_unavailable`, with no alternate
name or timeout theft. Hold the preclaim through admission and durable ready
publication or complete abandonment, then release. Bind alone never authorizes
replacing a live owner. Caller must re-read marker/ownership and establish death.
No HTTP error, stale version or PID-only observation is a death proof.

The `.6` classifier is supplied from its lightweight leaf during integration;
L0 tests import its exact Git snapshot into a temporary module. A proven
comparable reboot permits revisioned anchor recovery under filesystem exclusion.
Retirement of a vanished netns in the same boot still needs an identity-backed
MH-L2 recovery path; unknowns remain refusal. Lock FD inheritance requires the
separate multi-process/profile qualification noted in README.

## Image and native manifests

The payload lists every ordinary file, directory and internal symlink, with
root-relative path, relevant permission bits, raw digest, and root-relative
resolved symlink target. Symlink digest also covers its exact link text.
Hardlinks and outgoing/broken/special objects fail. The sole excluded path is
root `manifest.json`, avoiding self-digest cycles. Installation state and logs
must be outside the image. Roots and entries must come from verified selection.

`verifyImage` requires a digest from trusted selection/artifact metadata;
computing a digest from an arbitrary supplied manifest is insufficient.
Missing/extra/modified payload, profile/ABI discrepancy, entrypoint absence and
native digest discrepancy fail before selection. Node 20/22 ABI labels are
115/127. Structural schema support for a profile is not its qualification.

The build-time AST auditor collects literal imports, exports, require and
import-relative URL edges, and refuses bare JS dependencies, missing edges and
encountered computed loaders. It is **not a complete executable-load proof**.
Bundles, indirect resolvers, workers, system libraries and native module loaders
still need build constraints and executable traces. `static-literal-graph-only`
must never become `managedImage:true` by itself.

Each native entry binds binary digest, architecture/libc/ABI and toolchain digest,
and retains `node_modules/node-pty` as the real legacy require path. The local
prototype strips install scripts in a temporary copy, builds the actual N-API
addon by C++ directly, repeats its digest and spawns a PTY with its real JS API.
It does not deliver the pinned release compiler, transitive headers/sysroot,
published shrinkwrap or an end-user compilation path. MH-L1/MH-L6 own those gates.

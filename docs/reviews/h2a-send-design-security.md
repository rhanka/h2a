---
status: complete
reviewer-host: claude
reviewer-model: claude-sonnet-4-6
reviewer-effort: xhigh
target-ref: user architecture for native signed h2a send
lens: signing integrity, target ambiguity, wake transport safety
---

# Security Review — `h2a send` / `h2a_send` Design

Independent adversarial review of the proposed native `send` CLI verb and
`h2a_send` MCP tool.  Architecture is fixed per the user spec: implementation
lives in `packages/h2a`, deposits a signed envelope in a resolved local peer
inbox, existing inbox-wake handles native PTY then tmux fallback, defaults to
`--wake auto`.

No product code was modified. The review is based on reading all relevant
source files (listed below) and reasoning about the proposed design against the
existing primitives.

## Files read

| File | Purpose |
|------|---------|
| `src/signature.ts` | Ed25519 sign / verify primitives |
| `src/canonical.ts` | Canonical JSON + hash |
| `src/envelope.ts` | Envelope creation, signing, verification, validation |
| `src/wake.ts` | `decideInboxWake`, `formatWakeLine` (pure core) |
| `src/runtime/drive/index.ts` | Drive instruction format, auth gate, remote server |
| `src/runtime/drive/inbox-wake.ts` | `createInboxWakeHandler` — the mcp-serve polling wake |
| `src/runtime/drive/pty-actuator.ts` | Native/tmux target resolution, actuation |
| `src/runtime/local-files/store.ts` | `putInboxMessage`, `validateH2AEnvelope`, key management |
| `src/runtime/local-files/paths.ts` | `resolveRecipient`, `reachGuard`, `assertHostQualifiedAddress`, `safeKeyName`, `canonicalAddress` |
| `src/runtime/identity/live.ts` | `resolveLiveIdentity`, `keyPaths`, `ensureKeypair` |
| `src/runtime/identity/bindings.ts` | `reclaimOrMint`, proof-of-possession |
| `src/runtime/identity/readers.ts` | Default key/session readers |
| `src/mcp.ts` | MCP tool name list (confirms `h2a_send` absent today) |
| `src/runtime/mcp/tools.ts` | MCP tool descriptors |
| `src/cli-command-map.ts` | CLI command groups (confirms `send` absent today) |
| `src/cli-contract.ts` | Frozen verb contracts (confirms `send` absent) |
| `test/wp2-resolve-before-send.test.js` | Existing resolve-before-send coverage |
| `test/evo1-inbox-wake-handler.test.js` | Existing inbox-wake handler coverage |

---

## Findings

### F-1 · No verify-before-deposit at the store layer — unsigned-fallback contract is structurally unenforced [HIGH]

**Location**: `src/runtime/local-files/store.ts:1291–1305` (`putInboxMessage`)

`putInboxMessage` validates the H2A envelope schema (`validateH2AEnvelope`)
but never checks `envelope.signatures`.  `validateH2AEnvelope` itself does not
require `signatures` to be present or valid.  Any caller — including a
`send` implementation whose private-key load silently fails — can deposit an
unsigned (or forged-by-another-key) envelope.  The inbox-wake handler and the
drumbeat scan then surface it to the recipient agent without any further
signature check.

The "no unsigned fallback" invariant the architecture specifies has no
structural enforcement: it must be upheld entirely at the `send` verb boundary.

**Decision required**: Either (a) enforce at the verb boundary with a hard
pre-condition check — key load must succeed, signature must round-trip verify
against the registered public key, and only then call `putInboxMessage`; or (b)
add a signature-presence check to `putInboxMessage` itself, rejecting envelopes
with no `signatures` entry (which would make the invariant structural rather
than convention-based).  Option (b) is structurally stronger but would break
existing tests and internal tools that deposit unsigned envelopes legitimately.
Option (a) is the minimal correct approach: fail with exit code 2 and a
diagnostic before any store write if the key is missing or verification fails.

---

### F-2 · Drive authorization blocks peer-to-peer `--wake auto` [HIGH]

**Location**: `src/runtime/drive/index.ts:339–352` (`authorizeDrive`)

`authorizeDrive` allows a drive call only when:

- `from === to` (self-wake), or
- the receiver's registration has `conductor === from` or `principal === from`, or
- sender and receiver share a scope AND the sender holds a mandate-issuing role.

`createInboxWakeHandler` works because it is always a self-wake: the receiver's
own mcp-serve process signs a drive instruction `from=instance to=instance`.

For a one-shot `send --wake auto`, the SENDER tries to wake the RECIPIENT.
In the typical peer case (`alice` sends to `bob`) Alice does not hold a mandate
over Bob and is not Bob's conductor.  `authorizeDrive` returns
`{ ok: false, reason: "unauthorized" }` and the wake is silently not delivered.
The message sits in the inbox until Bob's mcp-serve polling loop fires.

If `--wake auto` silently degrades to "no wake" on authorization failure, the
user receives no feedback.  If it propagates the failure as an error, a plain
peer send always requires the caller to use `--wake none`.

**Decision required**: Clarify the wake model for `send`.  The recommended
design is: `--wake auto` never attempts a drive-based wake for peer sends.
Instead, it relies on the recipient's existing mcp-serve inbox-wake poll (which
fires every tick and already handles new arrivals).  Document this as the
intended contract: `send` deposits atomically; wake is always eventual and
driven by the receiver's own polling loop, not by the sender.  The `--wake auto`
flag would then be a no-op for the local peer case, or it could invoke an
agreed-upon side-channel (e.g. `kill -USR1` to a presence-recorded PID) without
going through the drive authorization gate.  Do NOT silently swallow an
authorization failure — surface it as a warning at minimum.

---

### F-3 · `safeKeyName` does not sanitize `.` — path traversal in key discovery [MEDIUM]

**Location**: `src/runtime/identity/live.ts:136–138`

```typescript
function safeKeyName(instance: string): string {
  return instance.replace(/[:/]/g, "-");
}
```

The function removes `:` and `/` but preserves `.`.  If the `send` verb
accepts an explicit `--from <instance>` flag that is not validated against the
`host:label:uuid12` format before calling `keyPaths`, an attacker-controlled
value like `../../../home/attacker/evil` maps to key path
`<root>/keys/../../../home/attacker/evil.key.pem`, which the OS resolves outside
the keys directory.  The file that exists at that path would then be read as the
"private key" PEM; a craft failure here is a silent no-key error, but on certain
filesystems a world-readable file could be surfaced.

`safeKeyName` is safe for instance IDs produced by `deriveInstanceId` (whose
output is `host:slugify(label):uuid12` — no dots).  The hazard is a crafted
`--from` CLI flag that is never validated against the canonical format.

**Decision required**: Before constructing the key path, validate `--from`
against `isHostQualifiedAddress` (or a tighter UUID12 pattern check) and exit 1
if it fails.  Optionally also pass the result through `safePathSegment` which
already neutralizes pure-dot segments (`^\.+$` → `_`).

---

### F-4 · `bodyTopic` does not sanitize `]`, `=`, `[` — wake line display injection [MEDIUM]

**Location**: `src/wake.ts:31–39`

```typescript
function bodyTopic(envelope: H2AEnvelope): string {
  // ...
  return raw.replace(/\s+/g, "_");
}
```

Only whitespace is replaced.  The wake line format is:

```
[h2a-wake reason=inbox from=<instance> topic=<topic> at=<iso>] …
```

A `body.topic` value containing `]` terminates the bracket block early; one
containing `=` or spaces-after-whitespace-normalization that reassemble an
`attr=value` token confuses human readers and potentially any tooling that
parses the wake tag naively.

The outer drive line produced by `formatSignedDriveInstruction` is not confused
(its `[h2a …]` header is already closed before the wake text begins), so this
is not a signature bypass.  However, a crafted sender can produce misleading
wake messages visible to the recipient agent.  Agents that parse the wake text
for a `from=` field will read the injected value rather than the real sender
instance.

**Decision required**: Sanitize the `bodyTopic` output — minimally replace `]`,
`=`, `[`, and any remaining control characters before embedding the topic in the
wake line.  A simple allowlist `[A-Za-z0-9._:-]` and replace-rest-with-`_`
would be safe and preserve readability.

---

### F-5 · No envelope body size cap at deposit [MEDIUM]

**Location**: `src/runtime/local-files/store.ts:1291–1305` (`putInboxMessage`)

`putInboxMessage` serializes the full envelope JSON to disk without checking
size.  A malicious peer (or a buggy sender) can deposit a multi-megabyte
envelope to fill the recipient's disk and stall the mcp-serve inbox scan.  The
existing remote drive server caps request bodies at 64 KiB
(`maxBodyBytes ?? 64 * 1024`), but the local `inbox put` CLI and the proposed
`send` verb have no equivalent cap.

**Decision required**: Add a maximum body size check in `send` before calling
`putInboxMessage`.  A 256 KiB cap on the serialized envelope JSON is consistent
with the remote drive limit while allowing multi-part structured bodies.
Alternatively, enforce the cap inside `putInboxMessage` itself so ALL callers
inherit it.

---

### F-6 · Private key read and crypto error messages may leak key material [LOW]

**Location**: `src/signature.ts:12` (`createPrivateKey`)

`signCanonical` calls `createPrivateKey({ key: options.privateKeyPem, format: "pem" })`.
If the PEM string is truncated or malformed, Node.js's crypto module throws an
error whose message can include the raw input bytes up to the parse failure
point.  If the `send` verb prints the caught error message to stderr or to an
MCP `text/content` response, partial key material is disclosed.

**Decision required**: Wrap the `createPrivateKey` call at the `send` verb
boundary and replace any caught error with a sanitized diagnostic
(`"private key file is not a valid ed25519 PKCS#8 PEM"`) that never echoes the
PEM bytes.

---

### F-7 · No test coverage for the `send` path [LOW]

The feature does not exist yet, so this is an advance finding about the required
test plan.  The following security invariants have zero test coverage and must
each have at least one focused test before ship:

| Invariant | Required test |
|-----------|---------------|
| No unsigned fallback | Key absent → exit 2, no file written to inbox |
| Phantom recipient refused | `--to claude:ghost` → exit 1, `resolveRecipient` refuse |
| Ambiguous recipient refused | `--to claude:foo` with >1 live → exit 1 |
| Signature round-trip | Deposited envelope verifies against sender's registered public key |
| Wake authorization documented | `--wake auto` with non-conductor peer: verify no silent degradation |
| Oversized body rejected | Body > cap → exit 1 before disk write |
| Path traversal in `--from` | `--from ../../evil` → exit 1 before filesystem read |

---

## Architecture decisions required

| ID | Question | Recommended answer |
|----|----------|--------------------|
| D-1 | Where is "no unsigned fallback" enforced? | At the `send` verb boundary: fail hard before any `putInboxMessage` call if key load or sign-then-verify fails. |
| D-2 | How does `--wake auto` work for peer sends? | Rely on the recipient's existing mcp-serve polling loop. Do not attempt a drive-based wake for non-conductor senders. Surface a warning if the drive is attempted and fails authorization. |
| D-3 | Should `putInboxMessage` itself reject unsigned envelopes? | No for this release — it would break existing legitimate unsigned deposits. Revisit in a future hardening pass once all internal callers are confirmed to sign. |
| D-4 | What cap applies to envelope body? | 256 KiB on the serialized JSON, enforced at the `send` verb boundary. |
| D-5 | How is `--from` validated before key path construction? | Must pass `isHostQualifiedAddress` and contain a 12-hex UUID segment. Fail fast with exit 1 and a human-readable diagnostic otherwise. |

---

## Verdict

The existing cryptographic primitives (Ed25519 via `signCanonical`, canonical
JSON serialization, envelope signing view, replay guard on drive) are sound.
The addressing infrastructure (`resolveRecipient`, `assertHostQualifiedAddress`,
`canonicalAddress`) is mature and covers the main ambiguity and phantom-target
cases.

The proposed design is **safe to implement** with the following constraints:
the unsigned-fallback refusal (F-1) and the wake authorization model (F-2) must
be resolved before the first ship — both have user-visible failure modes that
are silent under the proposed defaults.  F-3 through F-5 are concrete hardening
items that should land in the same PR.  F-6 is a one-line fix.  F-7 is the
required test plan.

No finding requires a rearchitecture of the signing or addressing layers.

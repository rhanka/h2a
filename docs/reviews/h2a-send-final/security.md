---
status: completed
reviewer-host: claude
reviewer-model: claude-sonnet-4-6
reviewer-effort: xhigh
target-ref: 681d65b2
lens: signing trust boundary, active-key enforcement, private-key/path handling, target ambiguity, MCP authority confinement, wake transport abuse/fail-closed behavior
---

# Final security review — h2a send

## Scope

Commit `681d65b2` — `feat(h2a): add signed local send contract`. Reviewed files from
the committed tree only; no working-tree files consulted. Primary evidence:

- `packages/h2a/src/runtime/send.ts` — `sendLocalMessage` primitive
- `packages/h2a/src/runtime/identity/live.ts` — `safeKeyName`, `identityKeyPaths`,
  `resolveLiveIdentity`
- `packages/h2a/src/runtime/local-files/paths.ts` — `resolveRecipient`,
  `assertHostQualifiedAddress`, `resolveRegisteredName`
- `packages/h2a/src/cli.ts` — `cmdSend`, `runMcpServe`
- `packages/h2a/src/runtime/mcp/handlers.ts` — `handleSend`
- `packages/h2a/src/runtime/mcp/server.ts`, `stdio.ts`, `tools.ts` — MCP wiring
- `packages/h2a/src/runtime/drive/inbox-wake.ts` — `createInboxWakeHandler`
- `packages/h2a/test/send.test.js` — 5 send-specific tests covering all lens areas

---

## Evidence by lens

### 1 · Signing trust boundary

`sendLocalMessage` (send.ts) is declared as the **single send primitive** for both CLI and
MCP in a doc-comment. Inspection confirms: `cmdSend` (cli.ts:620) and `handleSend`
(handlers.ts:330) both delegate to it unconditionally.  No alternate code path writes to
an inbox.  The signing call (`signEnvelope`) and the active-key gate are in the same
synchronous function, with no await between them; there is no async gap where a
partially-verified state could escape.

The signed envelope is never returned until the active-key check has passed (`keyIsActive`
check precedes `putInboxMessage`).  The private key PEM is not present in
`SendLocalMessageResult`, so it cannot leak into stdout or MCP responses.

### 2 · Active-key enforcement

Sequence in `sendLocalMessage` (send.ts lines ~125–145):

```
envelope = signEnvelope(unsigned, {by: signer.instance, privateKeyPem})
keyIsActive = store.listInstanceKeys(signer.instance)
               .some(pk => verifyEnvelopeSignature(envelope, pk, {by: signer.instance}))
if (!keyIsActive) throw            // ← gates deposit
store.putInboxMessage(recipient, envelope)
```

`listInstanceKeys` returns only registered (non-revoked) public keys.  If the list is
empty, `some()` returns false immediately — sender with zero registered keys cannot send.
Test `"sendLocalMessage refuses a mismatched or revoked sender key before writing"` covers
both the wrong-key and the post-revocation paths, and asserts that `readInbox` remains
empty after both rejections.

The check happens *after* signing.  A rejected sender pays the cost of
`signEnvelope`.  Reversing the order (verify the key is registered before signing) would
save CPU on rejection.  This is efficiency only; the deposit gate is correct.

### 3 · Private-key / path handling

Key file path construction (`live.ts:136–144`):

```typescript
function safeKeyName(instance: string): string {
  return instance.replace(/[:/]/g, "-");
}
// keysDir/<safeKeyName(instance)>.key.pem
```

On Linux the two replaced characters (`/`, `:`) are the only path-separator attack
chars.  A crafted instance like `../../evil` would produce `..---..---evil`, a safe
filename component; `node:path join` cannot traverse directories through it.  NUL bytes
in the instance string would reach `readFileSync` and cause `EINVAL`; the error is caught
in both CLI and MCP paths and surfaces as a non-zero exit / error response.

`safeKeyName` uses a narrower pattern (`[:/]`) than `safePathSegment` (`[:\\/<>"|?*]+`),
which is used for inbox/negotiation dirs.  On Linux this makes no difference in practice.
See MINOR-1 below.

The key is read from a path derived entirely from the h2a root and the instance ID.  No
user-supplied path is directly used; `--from` / `H2A_INSTANCE` values feed only into the
instance-to-filename mapping that `safeKeyName` sanitizes.

### 4 · Target ambiguity

Resolution chain in `sendLocalMessage`:

1. `resolveRegisteredName` — case-insensitive display-name match against the local
   registry; throws if more than one instance shares the name; returns the full instance
   ID (not the display string) when exactly one match.
2. `resolveRecipient` — handles full id, bare alias, display-name, subagent handle,
   dormant, refuse, list.
3. After resolution, `assertHostQualifiedAddress(recipient)` is called unconditionally on
   the final recipient.  A bare token that went through the resolver and found no match
   stays as the bare token, which then fails the host-qualified guard.  This is
   fail-closed: a non-qualified address cannot become an inbox key.
4. When `deliver-hint` applies, `recipient = resolution.liveCandidate`, which is a live
   full instance from the presence list, so it passes the host-qualified guard.

Tests cover: display-name resolution, dormant registered name, wrong key rejection,
ambiguous name, phantom exact instance, CLI key-file path, MCP signer-isolation.

### 5 · MCP authority confinement

Tool schema (`tools.ts:229–249`):

```json
{ "to": {"type":"string"}, "message": {"type":"string"} }
required: ["to","message"], additionalProperties: false
```

`handleSend` (handlers.ts:314–334) also programmatically rejects unknown keys:

```typescript
const unknown = Object.keys(args).filter(k => k !== "to" && k !== "message");
if (unknown.length > 0) return { error: `unsupported argument(s): ${unknown.join(", ")}` };
```

This is defense-in-depth: even if the JSON-RPC layer stripped `additionalProperties`
validation, the handler itself enforces the boundary.

The signer flows server-side only.  In `runMcpServe` (cli.ts):

```typescript
...(autoOpen && identityPrivateKeyPem
  ? { sendContext: { instance: autoOpen.instance, privateKeyPem: identityPrivateKeyPem } }
  : {})
```

`sendContext` is set only when both `autoOpen` and a successfully-read private key PEM are
present; if the key read throws, `identityPrivateKeyPem` stays `undefined`, `sendContext`
is not set, and `handleSend` returns `{error: "h2a_send: unavailable without a trusted
auto-open signing identity"}`.  No partial state.

Test `"h2a_send MCP is strict and uses only its trusted sidecar signer"` confirms:
- schema `required` and `additionalProperties: false` exactly as declared
- no-sendContext server → "trusted auto-open" error
- extra arg `from` → "unsupported argument" error (key injection attempt rejected)

### 6 · Wake transport abuse / fail-closed behavior

`runMcpServe` (cli.ts, wake setup block):

- `--wake headless` is **explicitly rejected** with a warning message that names the
  reason ("it would spawn a NEW agent on inbox arrival, not wake this one").  `wake`
  remains `undefined`; inbox-wake is not armed.
- `--wake auto` builds `chainDriver(nativePtyBackchannelDriver, localTmuxDriver)` — no
  headless leg.  The comment is explicit: "a self-wake must NEVER spawn a new agent".
- Key read failure during wake setup: `identityPrivateKeyPem` stays `undefined`; the
  `else if` branch for arming wake requires `autoOpen?.privateKeyPath && identityPrivateKeyPem`
  to be truthy; wake is silently not armed and serving continues normally.
- `--wake` without `--auto-open`: logs "requires --auto-open; ignored".
- Unrecognized wake kind: logs, ignored.

`createInboxWakeHandler` (inbox-wake.ts):

- `seen` is seeded from the current inbox at construction: boot backlog does not trigger a
  wake.
- `seen` is advanced **only on successful drive** (`if (ok) seen = decision.seen`); a
  transient transport failure leaves the envelope unseen so the next notification retries.

Self-targeting:

```typescript
// NOT latestLaunchContext(instance) — with concurrent sessions sharing one perennial id
// (durable bug #1), an instance lookup could inject keystrokes into a DIFFERENT agent's
// terminal.
resolveLaunchContext: () => detectTmuxLaunchContext(process.env, ...)
```

The wake targets `process.env` (the process's own inherited `$TMUX_PANE`), not a
peer-lookup result.  This is the correct defense against cross-terminal keystroke
injection.  The `onInboxArrival` callback gates on `instance === wakeInstance`; messages
for other instances do not trigger a wake.

---

## Findings

### MINOR-1 — `safeKeyName` uses a narrower sanitization pattern than `safePathSegment`

**File**: `packages/h2a/src/runtime/identity/live.ts:136`

`safeKeyName` replaces `[:/]`, while `safePathSegment` (used for all other path
components) replaces `[:\\/<>"|?*]+` and separately guards against pure-dot segments.
On Linux these produce equivalent results for instance IDs.  The divergence creates a
maintenance surface: a future port to Windows or a new injection surface would require
updating both independently.  The key-path construction does not pass through the
single-writer `safePathSegment` chokepoint, so a future instance-ID format change could
silently open a gap.

**Scenario**: On Windows, an instance ID containing `<`, `>`, `"`, `|`, `?`, or `*`
would produce an invalid filename via `safeKeyName` but a safe one via `safePathSegment`.
Not exploitable on the current Linux target.

**Recommendation**: Replace `safeKeyName` with `safePathSegment` (or a shared helper
that wraps it), eliminating the dual code path.

### NIT-1 — Active-key check follows signing rather than preceding it

**File**: `packages/h2a/src/runtime/send.ts:~125`

`signEnvelope` is called before the active-key check.  If the private key is inactive or
revoked, the envelope is signed (CPU cost, allocations) and then discarded.  Reversing
the order — validate that the private key corresponds to a registered active public key
before signing — would avoid the unnecessary cryptographic operation on the rejection
path.

No security impact; the deposit gate is correct and the revocation check is not bypassable.

### NIT-2 — `--from` / `H2A_INSTANCE` sender not validated for host-qualified format at parse time

**File**: `packages/h2a/src/cli.ts:cmdSend`

The sender string accepted via `--from` or `H2A_INSTANCE` is not validated for
host-qualified format before being used as an argument to `identityKeyPaths`.
A non-qualified value (e.g. `"badlabel"`) would produce a key path that does not exist,
`readFileSync` would throw, and the CLI returns exit 3.  The error message names the key
path, not the validation failure.  Safe failure; slightly confusing error message.

---

## Verdict

**GO**

No blocking or major security issues found.  The six lens areas are well-addressed:
the single-primitive architecture prevents CLI/MCP drift; the active-key gate is
correctly ordered relative to the inbox deposit; private-key material stays server-side
and never leaks into serialized results or MCP responses; target resolution is
fail-closed for unqualified addresses and ambiguous names; the MCP tool has both
schema-level and handler-level argument confinement with the signer fully server-side;
and wake transport correctly blocks the headless driver, restricts `auto` to native→tmux,
and fails closed if the key is unreadable.  Two NITs and one minor cross-platform hygiene
observation are noted; none affect current security posture.

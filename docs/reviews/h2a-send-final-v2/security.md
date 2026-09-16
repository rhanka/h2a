---
status: completed
reviewer-host: claude
reviewer-model: claude-sonnet-4-6
reviewer-effort: xhigh
target-ref: c57f18db
lens: final signing trust boundary, active-key enforcement, MCP signer confinement, path/target safety, wake fail-closed behavior, security regression
verdict: GO
---

# Final security review v2 — `h2a send` / `h2a_send`

## Scope

Independent review of range `0dfc5f75..c57f18db` (two commits: `681d65b2`
feat, `c57f18db` fix) against six lenses: signing trust boundary, active-key
enforcement, MCP signer confinement, path/target safety, wake fail-closed
behaviour, and regression in c57f18db. No product code modified. No sibling
review consulted.

Files examined:
- `packages/h2a/src/runtime/send.ts` (new)
- `packages/h2a/src/runtime/mcp/handlers.ts`, `server.ts`, `stdio.ts`, `tools.ts`
- `packages/h2a/src/cli.ts` (cmdSend, mcp-serve wake block)
- `packages/h2a-runtime/src/config.ts`, `tmux.ts`
- `packages/h2a/src/runtime/identity/live.ts`
- `packages/h2a/src/runtime/local-files/store.ts`, `paths.ts`
- `packages/h2a/test/send.test.js`, `evo-host-setup-wake.test.js`

## Evidence — axis by axis

### 1. Signing trust boundary

`sendLocalMessage` (send.ts:97–175):

1. `createEnvelope` builds the unsigned envelope.
2. `signEnvelope` signs it with the caller-supplied private key.
3. `store.listInstanceKeys(signer.instance)` returns only active public keys
   (registration keys + "added" events − "revoked" events, per
   `store.ts:429–444`).
4. `verifyEnvelopeSignature` is called against each active key; if none
   matches, the function throws `"private key is not active"` **before**
   `putInboxMessage` is called (send.ts:151–158).

Order is sign → verify-active → throw if inactive → persist if active.
No envelope is written to disk if the private key is not currently active.

### 2. Active-key enforcement

`listInstanceKeys` (store.ts:429–444) computes the active set correctly:
- Seed from `registration.publicKeys`.
- Union "added" events.
- Subtract "revoked" events.

`send.test.js` covers both the mismatched-key case (wrong private key, no
matching public) and the revoked-key case (key previously active, now
revoked), and asserts `readInbox` is empty in both scenarios after the
throw. The check is not TOCTOU-free (revocation between sign and write is
theoretically possible) but the window is within a single synchronous call;
this characteristic is pre-existing and not worsened by this diff.

### 3. MCP signer confinement

`handleSend` (handlers.ts:311–337) receives `signer: H2ASendSigner | undefined`
as a second positional argument, never from the JSON-RPC `args` object.

- If `signer` is `undefined` (no `sendContext` at startup), the tool returns
  `{ error: "h2a_send: unavailable without a trusted auto-open signing identity" }`.
- Unknown keys in `args` (including `from`) are explicitly rejected:
  `"h2a_send: unsupported argument(s): …"` (handlers.ts:321–323).
- `sendContext` is set in `cli.ts:2045–2047` only when `autoOpen` is
  present and `identityPrivateKeyPem` was successfully loaded from
  `autoOpen.privateKeyPath` at mcp-serve startup — never from any client
  payload.

`send.test.js` tests confirm: passing `from: f.recipient` in tool args
returns `/unsupported argument/`; calling without `sendContext` returns
`/trusted auto-open/`. Signer identity is strictly a sidecar-origin value.

### 4. Path and target safety

**Address sanitisation chain:**
- `requiredText` rejects empty strings and strings containing NUL
  (send.ts:55–62).
- `assertHostQualifiedAddress` rejects bare-label addresses before they
  reach the filesystem (paths.ts:144–149).
- `safePathSegment` (paths.ts:22–31) maps `[:/\\<>"|?*]+` → `__` and
  pure-dot segments → `_`, preventing directory traversal in all derived
  paths. `canonicalAddress` applies this before any `join`.

**`identityKeyPaths` export (identity/live.ts:137):**
`safeKeyName` replaces `/` and `:` with `-`, ensuring no slash survives into
the `join` call. A crafted `--from ../etc/passwd` would map to
`keysDir/..-etc-passwd.key.pem` — a non-existent filename, not traversal.

**CLI `--` separator:**
After `--`, all remaining tokens are pushed to `positionals`. The
`positionals.length !== 2` check then rejects anything beyond `<target>
<message>` (cli.ts:561–565). Extra arguments post-`--` are refused.

**`--from` / `H2A_INSTANCE` ambient trust:**
Both provide the sender identity but are gated downstream: `findInstance`
must succeed (registered instance), the key file must exist, and the
active-key check must pass. Forging another identity requires the corresponding
private key file — consistent with the existing CLI trust model.

### 5. Wake fail-closed behaviour

**Default change (`local-tmux` → `auto`):**
`DEFAULT_H2A_COMMAND` (config.ts:154) and `cmdHostSetup` (cli.ts:4277) now
emit `--wake auto`. When `mcp-serve` processes this value, the wake driver is
built at cli.ts:2015 as `chainDriver(nativePtyBackchannelDriver, localTmuxDriver)`.
This is **not** a call to `buildDriveDriver("auto")`, which would include
`headlessDriver`. The self-wake `auto` path is explicitly bounded to two legs.

**Headless explicitly rejected:**
cli.ts:2001–2004 guards `flags.wake === "headless"` and logs it as unsafe.
The updated warning message `"use auto"` is accurate for this context.

**Fail-closed on key-read failure:**
cli.ts:1983–1991: if `readFileSync(autoOpen.privateKeyPath)` throws,
`identityPrivateKeyPem` stays `undefined`. The conditions at cli.ts:2006
(`&& identityPrivateKeyPem`) and cli.ts:2045 (`&& identityPrivateKeyPem`)
then omit both `wake` and `sendContext`. Neither wake nor `h2a_send` is
available when the sidecar key cannot be read.

**`commandNeedsLocalTmuxWake` regex (tmux.ts:1853):**
Extended to match `local-tmux|auto`. This ensures tmux pane metadata is
written when `--wake auto` is the launch command, which is required for the
tmux-fallback leg to find its target. Fail-safe: if the pane cannot be
resolved the window startup is refused (tmux.ts:1884–1888).

### 6. Regression in c57f18db

c57f18db adds two lines to `send.ts` (the `deliver-hint` reason string,
lines 157–158) and 43 lines of tests. No new code paths are introduced.
No permissions, keys, or resolution logic changed. The fix corrects the
`reason` field in the return value for the `deliver-hint` case;
`recipient` and the actual inbox write path are unaffected. No regression.

## Findings

### MINOR — M1: misleading "use auto" in headless-rejection warning

**Location:** `packages/h2a/src/cli.ts:2004`

**Observation:** The rejection message was changed from `"use local-tmux"` to
`"use auto"`. The `auto` value is bounded in the self-wake path (no headless),
but `buildDriveDriver("auto")` — used by `h2a drive` and `drumbeat watch` —
DOES chain `headlessDriver`. An operator following this hint and using
`--relauncher auto` in `drumbeat watch` would get a chain that includes
headless, contrary to what the message implies.

**Impact:** No security impact in the send/mcp-serve path. Potential operator
confusion in unrelated `drumbeat` contexts. Not introduced by this lens's
scope but the message wording change is new in this diff.

**Recommended follow-up (non-blocking):** Qualify the message:
`"use auto (self-wake: native then local-tmux only)"`.

### NIT — N1: no explicit charset constraint on address strings before downstream sanitisation

**Location:** `packages/h2a/src/runtime/send.ts:55–62` (`requiredText`),
`packages/h2a/src/runtime/local-files/paths.ts:130–138` (`isHostQualifiedAddress`)

**Observation:** Validation rejects empty strings and NUL bytes but does not
explicitly constrain the character set of host/label components. Path safety
relies on `safePathSegment` and `canonicalAddress` downstream. No injection
vector exists (addresses are never passed to a shell), but a forward-declared
charset constraint would make the trust model self-documenting.

**Impact:** Nil. Informational only.

## Confirmed-sound properties (no findings)

| Property | Verdict |
|---|---|
| Envelope signed before active-key check; persist only if active | ✓ confirmed |
| Revoked key blocks send, no orphan envelope written | ✓ confirmed (test) |
| MCP signer strictly sidecar-origin; tool args cannot override | ✓ confirmed (test) |
| `h2a_send` unavailable without `sendContext` | ✓ confirmed (test) |
| `safePathSegment` neutralises all directory-traversal vectors | ✓ confirmed |
| `identityKeyPaths` export safe via `safeKeyName` (no slash survives join) | ✓ confirmed |
| mcp-serve `auto` wake bounded to native→local-tmux, no headless | ✓ confirmed |
| Key-read failure makes wake and `h2a_send` both unavailable (fail-closed) | ✓ confirmed |
| c57f18db introduces no new code paths, no permission change | ✓ confirmed |

## Verdict

**GO**

All six lenses clear. The one MINOR finding (M1) is a documentation concern
limited to a warning message in an unrelated command context; it does not
affect the send or mcp-serve security properties. No BLOCKING or MAJOR
findings. c57f18db introduces no regression.

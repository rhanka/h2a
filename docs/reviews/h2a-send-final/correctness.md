---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-4-8
reviewer-effort: xhigh
target-ref: 681d65b2
lens: contract correctness, target resolution, real native/tmux delivery, regressions
---

# Final correctness review

Independent review of commit `681d65b2` (`feat(h2a): add signed local send
contract`), diff scope `0dfc5f75..681d65b2`. Only committed sources/tests were
inspected; no sibling review under `docs/reviews/h2a-send-final/` was read; no
product code was modified. Working tree is clean at `681d65b2` (only the
untracked review dir present).

## Scope of the feature verified

- Native core `@sentropic/h2a` verb `h2a send <target> "<message>"`, signed with
  an existing active local identity, deposited into the resolved peer inbox.
- MCP `h2a_send({to,message})` bound to a trusted auto-open sidecar signer.
- Recipient-side inbox-wake with native → tmux fallback; wake default `--wake auto`.
- No version bump.

## Evidence

### Static inspection (all at `681d65b2`)

- `packages/h2a/src/runtime/send.ts` (new, `sendLocalMessage`) — the single send
  primitive shared by CLI and MCP: validation (`requiredText`, 64 KiB cap, NUL
  reject), sender-registration check, name/instance resolution, canonical
  `event` envelope `body:{kind:"message",topic:"MESSAGE",text}`, `signEnvelope`,
  **active-key verification against the store keyring before the first write**
  (`send.ts:145-152`), then `putInboxMessage` (`send.ts:154`).
- `packages/h2a/src/cli.ts` — `cmdSend` (positional parse, `--from`/`--root`
  only, sender auto-detection, key read from `identityKeyPaths`, exit-code
  mapping); `mcp-serve` wake block promoted to `--wake auto` = `chainDriver(native, local-tmux)`
  with the headless leg explicitly refused; `sendContext` wired to the sidecar
  identity; `host setup` renders `--wake auto`.
- MCP surface: `handleSend` (server.ts dispatch, tools.ts descriptor
  `additionalProperties:false` + manual unknown-arg guard, stdio.ts `sendContext`
  plumbing, `mcp.ts` tool-name list). `handleSend` refuses when no trusted signer
  is present and never accepts a caller-supplied `from`/key.
- Contract surfaces: `cli-contract.ts` (`send` verb, `outputShape:"action"`,
  `exitCodes:[0,1,2,3]`, `optionalFlags:["root","from"]`), `cli-command-map.ts`
  (`send → COORDINATE`), golden `cli-verbs.json`/`mcp-tools.json`/
  `version-matrix.json` counts (98→99 verbs, 37→38 tools), `README.md`.
- `identity/live.ts` `keyPaths` → exported `identityKeyPaths` (rename only; all
  internal call sites and the `index.ts` re-export updated).
- Resolution helpers `resolveRecipient`/`canonicalAddress`/
  `assertHostQualifiedAddress`/inbox routing in `local-files/paths.ts` and
  `store.ts` are **not modified by this commit**; `sendLocalMessage` reuses them.
- Runtime `config.ts` (`DEFAULT_H2A_COMMAND` → `--wake auto`), `tmux.ts`
  (`commandNeedsLocalTmuxWake` now matches `local-tmux|auto`), plugin manifest
  and `.mcp.json` (`--wake auto`). No `"version":` field is added anywhere in the
  diff (verified: 0 occurrences).

### Build + scoped test runs (this reviewer, at `681d65b2`)

- `tsc -b` (whole workspace): clean, no type errors. The `keyPaths` rename and
  new modules compile with no dangling references.
- `send.test.js`: 6/6 pass — live display-name resolve + sender-signed envelope,
  dormant registered-name honesty, wrong-key + revoked-key refusal before write,
  ambiguous/phantom refusal, positional CLI happy path, MCP strictness (signer
  required, unknown arg rejected, sidecar-only signer).
- `cli-contract.test.js`: 88 pass / 16 skipped (skips are stream/no-single-shot
  harness cases, unrelated); **`send emits an action envelope on the happy path`
  passes** (not skipped) → `outputShape` + exit 0 confirmed.
- `m04-wake-characterization.test.js` › *signed send reaches inbox-wake through
  native-to-real-tmux chain fallback*: pass — real tmux 3.6; native leg attempted
  once then falls back; the pane receives a **receiver-signed drive instruction**
  (`verifySignedDriveInstruction ok`), not the message text.
- `pty-native-messaging.test.js`: 2/2 pass — real native openpty round-trips
  driven by the actual `h2a_send` MCP tool through `mcp-serve --wake auto`
  (cross-process deposit by the peer's server, wake+delivery by the recipient's
  server), asserting the durable envelope carries `signatures` and verifies
  against the sender's active key.
- Touched regression files (`evo12-readonly-allowlist`, `evo-host-setup-wake`,
  `package-plugin-manifest`, `cli-host-status`, `hosts-integration`,
  `dispatch-characterization-goldens`): 47/47 pass. `h2a_send` is asserted **NOT**
  hosted read-only (mutator classification correct).
- Runtime `config.test.ts` + `tmux.test.ts` (vitest): 111/111 pass.

I did not run the entire repository suite; the scoped and touched-file suites
above are green.

### Adversarial checks that were refuted (no defect)

- **Routing/silent-loss:** `sendLocalMessage` deposits to `canonicalAddress(recipient)`
  and the post-resolution guard (`send.ts:118-127`) requires `recipient` to
  canonical-match a real registered or live instance. A recipient that passes the
  guard therefore always lands in the exact dir the recipient reads
  (`inboxDir` = canonical). Refuted the "orphan inbox" risk.
- **2-segment dormant alias mis-route:** `host:label` (no uuid) matching only a
  dormant 3-segment registration yields `deliver-dormant` with `recipient` left
  at the 2-seg form, which the guard then **refuses** (fails closed, no
  mis-route). Reproduced: refusal, inbox untouched.
- **Signature bypass:** wrong or revoked private key is rejected *before* the
  write (active-key set derived append-only, minus revocations). Test-confirmed
  and inbox stays empty.
- **MCP sender spoofing:** `h2a_send` ignores/refuses any `from` or key argument
  and always signs as the sidecar's own auto-open identity; server without a
  signer refuses. Test-confirmed.
- **False ambiguity:** `registerInstance` is idempotent (`store.ts:414-421`), so
  re-registration of one id cannot inflate `resolveRegisteredName` into a false
  "ambiguous" error.
- **Cross-process wake:** `notifications` re-reads inbox ids from disk each tick
  and fires `onInboxArrival` while non-empty, so a deposit by any other process
  wakes the recipient (proven by the two-server pty round-trip).

## Findings

### MINOR — `deliver-hint` result `reason` is stale/misleading after direct delivery

`resolveRecipient`'s `deliver-hint` branch was authored for the older
`h2a_inbox put` semantics (deposit to the *bare channel* dir, destination
unchanged) and its `reason` reads *"…deposited to the channel — prefer re-sending
to <full-id> for direct delivery."* `sendLocalMessage` instead **overrides the
destination to the live full id** (`send.ts:115`) but still surfaces that
inherited `reason` verbatim (`send.ts:156-160`).

Reproduced empirically (2-seg alias `claude:receiver` → one live
`claude:receiver:2222…`): result is `recipient=claude:receiver:2222…`,
`recipientLive=true`, `dormant=false`, the envelope is written to the full-id
inbox (1 env) and the bare channel dir is empty (0 env) — i.e. delivery **was**
direct — yet `reason` still says *"deposited to the channel — prefer re-sending …
for direct delivery."*

Failure scenario: an agent/operator reading the result follows the advisory and
issues a redundant duplicate send. Delivery correctness and the honest
live/dormant machine fields are unaffected; only the advisory string is wrong.
Fix would be to drop/replace the `reason` for the `deliver-hint` case in
`sendLocalMessage` (it already resolved to a direct recipient).

### MINOR — coverage gap: `deliver-hint` send path is untested

`send.test.js` covers live display-name (via the registered-name layer), dormant
registered-name, wrong/revoked key, ambiguous/phantom, CLI and MCP — but not the
2-segment bare-alias → single-live `deliver-hint` path, which is exactly the case
that surfaces the stale reason above. No test pins the intended `recipient`,
`recipientLive`, or reporting text for it.

### NIT — coverage gap: CLI sender auto-detection is untested

`cmdSend`'s no-`--from` resolution (H2A_INSTANCE → native-pty/tmux-pane launch
context → workspace-path presence → workspace-path registration → unique-or-error)
has no CLI-level test; all tested sends pass `--from` or use the MCP sidecar. The
branch fails closed (emits an actionable "pass --from" error on zero/multiple
candidates), so this is a coverage note, not a functional defect.

## Verdict

**GO.** Contract, target resolution, the real signed-envelope → inbox-wake →
native/tmux delivery chain, and the regression/contract surfaces are correct and
empirically verified. The active-key-before-write invariant, the routing guard,
the sidecar-only MCP signer, the `--wake auto` default across every surface, the
read-only exclusion of `h2a_send`, and the no-version-bump requirement all hold.
The one MINOR reporting inconsistency in the `deliver-hint` `reason` string does
not affect delivery correctness or the honest live/dormant fields and does not
block merge; it and the two coverage notes are worth a follow-up.

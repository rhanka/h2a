---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-4-8
reviewer-effort: xhigh
target-ref: user architecture for native signed h2a send
lens: contract correctness, identity resolution, package boundaries
verdict: conditional-go
---

# Correctness review — native `send` verb / `h2a_send` MCP tool

## Scope of this leg

Independent correctness review of the proposed native core verb `send` and MCP tool
`h2a_send`. The user architecture is fixed and NOT under review: implementation lives in
`packages/h2a`, `send` emits a signed message envelope to a locally resolved peer inbox,
the existing inbox-wake then drives the recipient's native PTY (tmux fallback), and the
wake default becomes `--wake auto`. This leg tests whether that architecture is
*internally coherent against the code that exists today*, on three axes: contract
correctness, automatic sender-identity/signing-key resolution, and target resolution /
package boundaries / smallest coherent API. The security lens (signing integrity, target
ambiguity, wake transport safety) is the sibling leg `h2a-send-design-security.md`; where a
finding also has a security face I cross-reference rather than adjudicate it here.

No product code was modified.

## What the design maps onto (grounding)

The architecture is well-supported by existing primitives — `send` is mostly *composition*,
not new mechanism:

- **Envelope + sign**: `H2AEnvelope` (`packages/h2a/src/types.ts:79`), `createEnvelope` /
  `validateH2AEnvelope` (`packages/h2a/src/envelope.ts:41`, `:109`), `signEnvelope` /
  `signCanonical` (`packages/h2a/src/envelope.ts:72`, `packages/h2a/src/signature.ts:11`).
- **Deposit to a peer inbox**: `store.putInboxMessage(actor, envelope)`
  (`packages/h2a/src/runtime/local-files/store.ts:1291`), one JSON file per envelope under
  `<root>/inbox/<canonicalAddress>` with a per-inbox lock.
- **Target resolution**: `resolveRecipient(...)`
  (`packages/h2a/src/runtime/local-files/paths.ts:245`) already handles full instance id,
  friendly live display-name, and bare `host:label` alias — and `inbox put` already routes
  through it (`packages/h2a/src/cli.ts:819`, handler `handlers.ts:199`).
- **Sender identity + key**: `resolveLiveIdentity`
  (`packages/h2a/src/runtime/identity/live.ts:297`) and the no-arg wrapper
  `resolveEnrollmentIdentity` (`packages/h2a/src/runtime/enrollment/ceremony.ts:501`).
- **Recipient self-wake**: `createInboxWakeHandler`
  (`packages/h2a/src/runtime/drive/inbox-wake.ts:43`), armed by the recipient's own
  `mcp-serve` (`packages/h2a/src/runtime/mcp/stdio.ts:409`), fired by the periodic FS scan
  in `NotificationDispatcher.tick` (`packages/h2a/src/runtime/mcp/notifications.ts:111`,
  `:192`), transported by the `auto` driver chain native→local-tmux
  (`packages/h2a/src/cli.ts:1902`).

Because a foreign process's inbox write is picked up by the recipient's periodic scan
(`notifications.ts:125-192` reads the filesystem, not just in-process deliveries), the core
claim "deposit envelope → existing inbox-wake drives the recipient" is achievable **for a
recipient whose sidecar armed wake**. That is the load-bearing precondition and it shapes
every finding below.

## Findings

### F1 — BLOCKING (contract): who owns the wake, and drive-authority forbids the sender doing it peer-to-peer

The phrase "*then existing inbox-wake drives native PTY … defaults change to `--wake auto`*"
conflates two different wake owners, and only one of them is authorized for the common case.

- The recipient's **self-wake** injects a drive line with `from === to === recipient`
  (`inbox-wake.ts:54-60`, signed by the recipient's own key). `authorizeDrive` returns `ok`
  for `from === to` (`drive/index.ts:346`), so this always passes the receive gate.
- A **sender-initiated** wake would inject a line with `from = sender`. The receive gate
  (`verifyDriveOnReceive` → `authorizeDrive`, `drive/index.ts:339-352`) authorizes a
  cross-instance drive only when the sender is the recipient's `conductor`/`principal`, or
  shares a scope AND holds a MANDATE-issuing role (`canIssueMandate`, `drive/index.ts:331`).
  Plain agents are registered `roles: ["AGENTS"]` (`identity/live.ts:270-275`), which cannot
  issue a MANDATE. **So peer→peer sender-push wake is rejected.**

Consequence: if `send --wake auto` means "the sender drives the recipient's PTY", it works
only conductor→subordinate and *silently fails to wake* every ordinary peer→peer message
(the line is physically injected but refused at the recipient's pre-action hook, or, on a
host with no hook wired, injected unauthenticated — a security face for the sibling leg).

**Proposed decision.** Define `--wake` as *reliance on the recipient's own armed inbox-wake*,
not as a sender-executed driver. Concretely: `send` deposits the envelope; the wake is the
recipient's self-wake on its next scan tick. `--wake auto|off` then governs only whether
`send` *waits for / reports* the wake and whether it treats "recipient has no armed wake" as
a warning. "Defaults change to `--wake auto`" is best read as flipping the **recipient-side**
render default from `local-tmux` to `auto` (`packages/h2a/src/runtime/config.ts:157`,
`packages/h2a/src/cli.ts:4166`), i.e. native-first with tmux fallback — a recipient change,
not a new sender capability. If a sender-push fast-path is genuinely wanted, gate it on
`authorizeDrive` and report `wake: "unauthorized"` honestly instead of claiming delivery.

### F2 — BLOCKING (correctness): a bare-alias `deliver-hint` deposits where the live recipient never reads, so the wake never fires

`resolveRecipient` returns `deliver-hint` for a bare `host:label` alias with exactly one live
match, and by contract deposits to the **bare channel dir**, only *hinting* the caller to
re-send to the full id (`paths.ts:191-197`, `:352-359`). But the recipient's inbox scan reads
`store.readInbox(session.instance)` where `instance` is the **full id**
(`notifications.ts:176`, `readInbox` → `inboxSourceDirs`, `store.ts:1335`, `:1311-1333`),
which covers the full-id dir plus *owned legacy aliases* (`host:<cwd-leaf>`) — **not** an
arbitrary display-derived `host:label` channel.

Consequence: for a friendly-name/alias send, the envelope can land in a directory the live
agent never scans; its full-id inbox stays empty, so no `onInboxArrival` fires and no wake
happens. The current `inbox put` tolerates this because a human re-sends to the full id; an
*auto-wake* `send` cannot rely on a human retry.

**Proposed decision.** `send` must deposit to the **resolved full live instance id**, not to a
bare channel: follow `deliver-resolved` (`paths.ts:345-350`) and, for `deliver-hint`, deposit
to `liveCandidate` rather than the bare dir; `refuse` on ambiguous/phantom
(`paths.ts:329-341`, `:377-381`). This keeps addressing discipline in the one existing place
(`resolveRecipient`) but changes *where `send` writes* so the wake precondition (F1) actually
holds.

### F3 — MAJOR (contract completeness): the "signed envelope" has no verifier on the inbox path

`putInboxMessage` and `readInbox` validate envelope *shape* only — never signatures
(`store.ts:1291-1305`, `readEnvelopesFrom` `store.ts:1278-1289`, `readInbox` `:1335`).
`H2AEnvelope.signatures` is optional (`types.ts:101`). The authenticated gate in the running
system is the **wake drive line** (self-signed, verified at the recipient's pre-action hook,
`drive/index.ts:354-381`), not the envelope. So a "signed envelope" is, today, *provenance
metadata* an inbox consumer may or may not check.

This is a correctness gap because the design says "**signed** message envelope" without
naming the verifier or the moment of verification. Left unspecified, the signature is
decorative and two `send` implementations could disagree on whether it's load-bearing.

**Proposed decision.** State explicitly what verifies the envelope signature and when — the
natural home is the `/h2a receive` / inbox-drain path, verifying `signatures` against the
sender's registry keys (`store.listInstanceKeys`, `store.ts:429`) before presenting the
message, mirroring `verifyEnvelopeSignature` (`envelope.ts:89`). Until such a verifier
exists, document `send`'s signature as provenance-only. (Trust-boundary depth is the sibling
security leg's call.)

### F4 — MAJOR (identity): auto sender-identity resolution has side effects and a cold-start ambiguity

`resolveLiveIdentity` is not a pure read: with no `explicitInstance` it mints a keypair,
registers the instance, and records aliases (`live.ts:327-394`). For an MCP `h2a_send` call
this is fine — the caller's session already resolved its instance, so `h2a_send` should sign
as *that* instance and must not re-mint. For a CLI `send` run cold in an arbitrary cwd, it
will **mint a brand-new sender agent + key** as a side effect of sending a message, which is
surprising and can fragment identity.

**Proposed decision.** Reuse `resolveEnrollmentIdentity`
(`ceremony.ts:501-560`) — the "resolve me and load my private key, taking no instance param"
wrapper whose own doc argues a passed-in id "rots". Define the cold-start rule for CLI
`send`: resolve the ambient identity for this workspace/host if one exists; otherwise either
refuse with a clear message or mint a clearly-labeled CLI identity — but decide it, don't let
it happen implicitly. For `h2a_send`, bind the sender to the calling session's resolved
instance and forbid an `instance`/`privateKeyPem` override (the two existing signing surfaces,
`h2a_sign` `handlers.ts:437` and `h2a_inbox put` `handlers.ts:218`, both make the caller pass
identity — the whole point of `send` is to remove that).

### F5 — MAJOR (smallest coherent API): `send` overlaps `inbox put` / `h2a_inbox put`; make it a thin front-door over one shared core, not a parallel writer

Writing an envelope to a peer inbox already exists twice: CLI `inbox put`
(`cli.ts:799-875`) and MCP `h2a_inbox {action:"put"}` (`handlers.ts:218-276`). The genuine
delta `send` adds is ergonomic: (a) auto sender identity + envelope signing (F4), (b) target
text→envelope construction, (c) auto-wake reliance (F1). Everything else already exists.

**Proposed decision.** Implement `send` as ONE core compose function in `packages/h2a`
(target + text → resolve identity → `createEnvelope` → `signEnvelope` → resolve recipient →
`putInboxMessage`), reused verbatim by CLI `cmdSend` and MCP `h2a_send` so they cannot
diverge. Do NOT re-implement `resolveRecipient`. Keep `inbox put` as the low-level escape
hatch (hand-built, unsigned envelope). Pin the envelope contract to the existing convention,
which has no dedicated "message" type: `type: "event"`, `body: { kind: "message", text,
topic? }` (there is no `"message"` envelope type — `types.ts:36-45`), a minted collision-safe
`id` (e.g. `msg:<ms>:<hex>`, since `id` is the on-disk filename, `store.ts:1273`), and set
`body.topic` so the wake line is meaningful (`formatWakeLine`/`bodyTopic`, `wake.ts:31-57`).
Keep the flag surface minimal: `send <target> <text> [--wake auto|off] [--topic ...]
[--thread <id>]`; reuse the existing `--wake` value vocabulary (`WAKE_KINDS`,
`cli.ts:1877`: `logging|native|local-tmux|headless|auto`) rather than inventing
`off/tmux/native` spellings.

### F6 — MINOR (actionable): `send` is not a native verb yet, so it currently routes to the heavy runtime

`send` is absent from the frozen verb contract (`cli-contract.ts:63-981`) and the native set
(`bin-routing.ts:33-42`), so `h2a send …` falls through `shouldDispatchRuntime`
(`bin.ts:340`, `bin-routing.ts:49`) into `@sentropic/h2a-runtime`, which has no such verb.
Making it native requires: a `H2A_CLI_VERB_CONTRACTS` entry, a branch in `runCli`
(`cli.ts:7195+`), inclusion in the native first-word set, and the golden-contract update the
code calls out as a public-contract change (`cli-contract.ts:74-95`; `test/cli-contract.test.js`
+ `docs/contracts/golden/cli-verbs.json`). Positive corollary: because the wake is
recipient-side (F1), `send` itself does only FS + signing and needs **no** `h2a-runtime`
dependency — it stays a light `packages/h2a` verb, exactly matching the fixed architecture.
Follow the `inbox put` precedent for streams/exit codes and `classifyStoreError`
(`cli.ts:310-315`) for store-vs-user error mapping.

### F7 — MINOR (correctness): confirm the native-PTY self-wake is actually wired, or "native PTY with tmux fallback" degrades to tmux-only

The `auto` driver chain is native→local-tmux (`cli.ts:1902-1904`), native-first as intended.
But the self-wake's launch-context resolver in `mcp-serve` uses `detectTmuxLaunchContext`
*only* (`stdio.ts:422-427`); the native target is used solely when
`resolveNativeSessionId`/`options.wake.nativeSessionId` is populated
(`inbox-wake.ts:36`, `:62-66`), which in turn depends on `H2A_NATIVE_PTY_SESSION`
(`drive/index.ts:743-751`). So "native PTY" wake is reachable only when the recipient runs
under a native h2a sidecar that publishes that session; a native-only (non-tmux) agent
without it will not wake. Separately, do **not** wire the send-wake through
`resolveActuationTarget` in the PTY actuator — that path is tmux-FIRST
(`pty-actuator.ts:195-218`) and would invert the stated native-first precedence.

**Proposed decision.** As part of adopting `--wake auto` as the recipient default, verify
(with a live native-host smoke) that the sidecar populates the native session so native-first
actually holds; otherwise document that non-tmux recipients require the native sidecar for the
wake to land.

## Package-boundary assessment

Consistent with the fixed architecture. Every primitive `send` composes lives in
`@sentropic/h2a`: core envelope/sign (`src/`), identity (`src/runtime/identity`,
`src/runtime/enrollment`), inbox store (`src/runtime/local-files`), drivers/wake
(`src/runtime/drive`), and CLI/MCP dispatch (`src/cli.ts`, `src/cli-contract.ts`,
`src/runtime/mcp/{tools,handlers}.ts`). The deprecated `@sentropic/h2a-cli` is a pure shim
(re-imports the h2a bin) and needs no change. `@sentropic/h2a-runtime` is *not* pulled in by
`send` when the wake is recipient-side (F1/F6); the only native-terminal reach into
`h2a-runtime` (`pty-actuator.ts:80-106`) happens in the *recipient's* sidecar, not in `send`.
So the "implementation belongs in `packages/h2a`" constraint is met without leakage — provided
F6 is done so the verb is registered native and does not fall through to the runtime.

## Verdict

**CONDITIONAL-GO.** The architecture is coherent and largely a composition of existing,
tested machinery; the package boundary is clean. It is *not* safe to build as literally
phrased, because two contract points are load-bearing and currently under-specified:

- **F1** — the wake must be the recipient's self-wake; a sender-push wake is unauthorized
  peer→peer, so `--wake auto` must be defined as recipient reliance, not a sender driver.
- **F2** — `send` must deposit to the resolved full live instance id, never a bare channel,
  or the wake precondition silently fails.

Resolve F1 and F2 (both are decisions, not large code) and pin the envelope/signature
contract (F3, F5) and the identity rule (F4) before implementation; F6/F7 are
mechanical/verification follow-ups. With those decisions recorded, the smallest coherent
API is: one shared core compose function in `packages/h2a`, surfaced as a native `send`
verb and a thin `h2a_send` tool, reusing `resolveEnrollmentIdentity`, `resolveRecipient`,
`putInboxMessage`, and the recipient's existing armed inbox-wake.

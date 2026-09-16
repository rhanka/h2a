# SPEC EVOL — native signed `h2a send`

## Outcome

`h2a send <target> "<message>"` is a core coordination verb that resolves a
local peer, signs a canonical H2A envelope with the caller's active identity,
deposits it in the peer's durable inbox, and relies on the existing inbox-wake
handler to wake the live host. The same operation is exposed as
`h2a_send({to,message})` by an auto-open local MCP sidecar.

## Decisions

- D1 — The operation lives in `@sentropic/h2a`. The runtime remains a consumer
  of the local bus and never gains a dependency on the core signing/store code.
- D2 — A shared core send service owns validation, name/instance resolution,
  envelope creation, signing, active-key verification, and inbox persistence.
  CLI and MCP are adapters only.
- D3 — Messages are canonical `event` envelopes with
  `body: {kind:"message",topic:"MESSAGE",text}`. They are signed with
  `signEnvelope`, then verified against the sender's active store keyring before
  the first write. There is no unsigned fallback.
- D4 — Recipient resolution reuses `listPresence`, `resolveRecipient`,
  `canonicalAddress`, and `assertHostQualifiedAddress`. A unique presence name
  becomes its recorded full instance; ambiguous or phantom names are refused.
- D5 — The CLI resolves an existing local sender: explicit `--from` or
  `H2A_INSTANCE`, then exact launch-context ownership, then a unique registered
  workspace identity. It never mints an identity during send. Zero or multiple
  plausible identities are an actionable error.
- D6 — The MCP tool accepts only `to` and `message`. Its signer context is
  injected by `mcp-serve --auto-open`; callers cannot supply a sender or key.
  A server without a signing identity refuses the tool.
- D7 — Wake defaults become `--wake auto`. Auto is the existing bounded
  native-then-local-tmux chain; it never includes the headless driver. Runtime
  pane setup recognizes both `auto` and `local-tmux` as requiring tmux wake
  metadata.
- D8 — Success reports the resolved recipient and the observed live/dormant
  state. Durable deposit is not described as confirmed human delivery.

## Contract

- CLI: `h2a send <target> <message> [--root <path>] [--from <instance>]`.
- MCP: `h2a_send` with exactly `{to:string,message:string}`.
- Empty targets/messages, NUL bytes, messages over 64 KiB, ambiguous names,
  missing signer keys, inactive keys, and unregistered senders fail before a
  write.
- Message ids are generated internally with collision-resistant UUIDs.
- The message is JSON payload only; wake transports receive the neutral signed
  receive prompt, never message text.
- No version change is part of this branch.

## Acceptance

- A signed send addressed by exact instance and by unique display name lands in
  the canonical peer inbox and verifies with the registered sender key.
- A wrong/revoked/unregistered key cannot deposit an envelope.
- The MCP descriptor and dispatch expose `h2a_send` while hosted read-only MCP
  does not grant it.
- A real native PTY integration sends through MCP, wakes through `auto`, and
  verifies both the sender envelope and receiver wake-line signatures.
- A real tmux integration exercises `chainDriver(native-fail, local-tmux)` and
  observes the signed inbox-wake instruction in the target pane.
- Runtime config, host setup, plugin manifest, CLI help, and contract agree on
  `--wake auto`.
- `npm ci`, build, scoped tests, and the repository's real full suite pass.

## Claim boundary

The new path produces an envelope signed by an active local identity and tests
that it is verifiable. The existing inbox-wake handler detects arrival and
separately signs its self-wake instruction as the receiver. It does not itself
authenticate arbitrary pre-existing inbox envelopes, so this change does not
claim that every legacy `h2a_inbox put` is authenticated.


# Drumbeat D4 — Remote relance adapter — framing

**Date**: 2026-05-30 · **Status**: framing (pre-spec) · **Refers**: DEC-086 (drumbeat), DEC-091 (D3 relaunchers), DEC-073→077 (signed-bearer remote transport), DEC-111 (D5). Pattern: the D5 spec/plan.

## The fork

D3 relaunchers are **local** (tmux send-keys / headless respawn) — daemon and agent share a host. D4's stalled agent is on a **remote** host; the daemon runs locally; the only cross-host primitive is the signed-bearer transport, whose **sole effect is `putInboxMessage`** — it does NOT resume a CLI session. So a remote relance cannot itself revive a remote process: *something on the remote host* must turn "an envelope arrived" into "relance locally". An instance's remote address is already modelled: `H2AActorRegistration.endpoints[{kind:"remote", uri}]`.

## Options

- **A — Relay chain (RECOMMENDED)**: the local `remoteRelauncher` signs a `drumbeat.resume` envelope (target instance + reason) and POSTs it to the remote's `endpoints[remote].uri`; the **remote host's own `drumbeat watch`** consumes it from its inbox and relances locally via its D3 adapters (with the remote's own `launchContext`, correct by construction). The revive is always local-to-the-agent; D4 is just the transport hop. Reuses `sendRemoteEnvelope`, the keyring (auth), the inbox (queue), and all D3 adapters. **Does not widen the transport's trust boundary** (serve stays a pure delivery sink). Weakness: silent no-op if the remote runs no watch → mitigated by logging the relay + an explicit receive-side consume verb + returning `false` (so it never burns a relance and the chain/D7 escalation still fires).
- **B — Direct remote-exec on `serve`**: the receive path runs the relance inline and returns a synchronous ack. Removes the silent-no-op hole but **escalates the transport's authority** (an inbound envelope now spawns a process) — deserves its own DEC + security review. Defer as a later opt-in (A's envelope shape is forward-compatible).
- **C — Cloud session-broker via `@sentropic/remote`**: the relauncher asks the broker to respawn. Cleanest *when applicable*, but only for broker-managed sessions (not a peer-on-a-laptop, the common case) and depends on out-of-repo internals. Defer to the bridge work.

## Recommendation: A

It is the only option that preserves the load-bearing invariant — *the daemon decides "relance X"; the environment-specific adapter performs the spawn; the spawn is always local to the agent* — across hosts, by reusing the tested D3 adapters verbatim. Composes the chain into `--relauncher auto = local-tmux → remote → headless`. The `H2ARelauncher` interface (`relance(finding): boolean | Promise<boolean>`) already allows the async POST — unchanged.

## Draft TDD plan (Option A)

1. **Core** `packages/h2a/src/drumbeat-resume.ts` — `H2ADrumbeatResumeBody { kind:"drumbeat.resume"; target; reason; requestedBy }` + total `parseDrumbeatResumeBody` (never throws; unknown → undefined). Tests: round-trip, garbage → undefined.
2. **Send adapter** `runtime/drumbeat/relaunchers.ts` — `remoteRelauncher({ resolveEndpoint, sign, sendImpl?, log })`: resolve instance→remote uri (default: read `endpoints[remote]` from registry), sign + POST a `drumbeat.resume`, return `true` iff 2xx. Injected transport. Tests: resolvable endpoint → signed POST → true; no endpoint → false; non-2xx/timeout → false (not counted as a relance).
3. **Receive-side consume** `runtime/drumbeat/inbox-relance.ts` — `relanceFromInbox(root, localRelauncher)`: drain inbox for `drumbeat.resume`, look up the local stopped entry, call the local relauncher with its `launchContext`; idempotent. Tests: delivered resume → local relance fired; unknown/malformed → skipped; second drain no re-relance.
4. **Wire** `cli.ts`/`cli-contract.ts` — `H2ARelauncherKind += "remote"`; `--relauncher remote` builds it (reuse `remote send` key loading: `--instance` + `--private-key`); `auto = local-tmux → remote → headless`; validate `remote`/`auto` requires a key. Tests: missing key → exit 1; flags in contract.
5. **Receive verb + docs + DEC** — `h2a drumbeat relance-inbox`; flip the `docs/drumbeat.md` D4 row; DEC recording Option A + deferred B/C + the silent-no-op mitigation. End-to-end test over two in-process stores (no sockets): seed stopped entry in B, run `remoteRelauncher` against an in-process `remoteServerForStore(B)`, then `relanceFromInbox(B, fakeLocal)` fires with B's launchContext.

**Agent-delegable**: yes — Option A is decision-free; an isolated worktree subagent can execute these 5 tasks task-by-task (subagent-driven), with review between tasks.

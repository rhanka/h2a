# EVO-1 — Bilateral-discussion driver (signed terminal injection) — framing

**Date**: 2026-05-31 · **Status**: framing (design, not built) · **Refers**: EVO-1 (`docs/evolution-intentions.md`), `docs/plugin-capability-matrix.md`, DEC-091 (D3 local-tmux relauncher), DEC-116 (identity / keyring / PoP), DEC-117 (D4 remote relay), DEC-035 (authority matrix / MANDATE).

## The gap (why the two codex "ne foutent rien")

The h2a bus is **passive**: an envelope dropped in a peer's inbox does nothing until that peer *reads* it. The drumbeat (D1–D6) covers only the **relance** half of EVO-1 — it wakes a *stopped* agent via its `launchContext`. It does **not** drive an agent that is *alive but idle at its prompt*: there is no native poll, so a running interactive `codex`/`claude`/`gemini`/`agy` sits waiting until a human types into it. Putting an assignment in `codex:a2a-cli`'s inbox left it unread; with no tmux, nothing could poke it.

EVO-1's stated intention is exactly this missing half — *"confirm/ensure each platform plugin has a bilateral discussion mechanism that can drive relances/follow-ups … This was the real original question behind the drumbeat ask."* Spec session 1 produced the **capability matrix** and concluded the substrate exists on all four; the **driver** was never built.

## Design — a signed terminal-injection driver

A uniform verb (`h2a drive` / a `H2ADriver` adapter, mirroring `H2ARelauncher`) that delivers an **instruction** to a *live* peer and makes it act, across per-platform transports, with every injected line **authenticated by the sender's ed25519 key**.

### 1. Transport (per-platform — reuse the capability matrix)

| Transport | Hosts | Note |
|---|---|---|
| **Local tmux** `tmux send-keys` | any host run inside tmux | **generalize D3**: today it only sends the *relance/resume* line; widen it to an arbitrary signed instruction. Requires the session to run *in* tmux (the current codex run in bare `pts/` → cannot be driven this way; launch under tmux to enable). |
| **Native back-channel** | codex `app-server`/`remote-control` · claude `SendUserMessage --brief` · gemini ACP | drives a *running* session **without** tmux — the clean path where it exists. agy = interactive-only (no clean back-channel → tmux or headless). |
| **Headless re-prompt** | all four (`codex exec`, `claude -p`, `gemini -p`, `agy -p`) | spawns a **new** turn/session rather than driving the existing one; the floor when neither tmux nor a back-channel is available. |
| **Remote injection service** | `host:remote` (Pod) | an in-Pod equivalent of `send-keys`, exposed by the bridge/sidecar (ties to EVO-11). Crosses the trust boundary → signature MANDATORY. |

The driver picks the best available transport per target (e.g. `auto = native-back-channel → local-tmux → headless`), mirroring the drumbeat `auto` chain.

### 2. Identity on every injected line (the security core)

Driving another agent's terminal is an **authority-bearing, executable** action. The anchor is **key possession**, not a name (the F1 lesson from DEC-116: an identifier alone is spoofable by any local process). So each injected instruction carries a signed preamble — an inline, human-visible h2a envelope:

```
[h2a from=claude:a2a-cli to=codex:a2a-cli nonce=<n> sig=<ed25519>] <instruction>
```

The signature is `signCanonical({ instruction, from, to, nonce, at }, { privateKeyPem })` over the sender's keyring key (the **same** keyring as DEC-116 / registration `publicKeys`). The receiver (plugin/host hook) **verifies three things before acting**:

1. **Provenance + integrity** — `verifyCanonical` against the sender's active keys (`listInstanceKeys(from)`). Reuses the NHI spine.
2. **Authority** — does `from` hold a relationship that permits driving `to`? (e.g. `from` is `to`'s CONDUCTOR / holds a MANDATE). Reuse `H2A_AUTHORITY_MATRIX`. A verified-but-unauthorized injection is refused + logged, not executed.
3. **Anti-replay / freshness** — `nonce` + `at` via `createReplayGuard` (reuse DEC-074), so a captured line cannot be re-injected.

**Why full ecdsa, not "an identifier at minima"**: the injected line is *executable instruction into another process*. An identifier-only line is forgeable by any local process and gives the receiver no way to refuse a hostile driver — exactly the spoof F1 closes for identity reclaim. Full signature also gives **accountability** (a tamper-evident record of who drove whom). The identifier-only mode is a **degraded fallback** for a host where signing the line is impractical, and MUST be logged as the weaker path (mirrors the drumbeat `minted-fallback` honesty rule).

### 3. Threat model (consistent with DEC-116)

- **Local** = single trusted user (DEC-116 ratified): tmux injection is acceptable; the signature is **provenance + anti-replay + authority + accountability** (defense-in-depth), not protection against the local OS user.
- **Remote** = the injection service crosses the trust boundary (the wrapped CLI is a hostile process in scope — remote's own argument in the EVO-11 thread): the signature is **mandatory**, and the in-Pod injector verifies before delivering to the wrapped CLI.

## Convergence

EVO-1's driver is **not new infrastructure** — it composes three shipped/ratified pieces: the **D3 tmux substrate** (DEC-091), the **DEC-116 keyring + signCanonical/verifyCanonical + authority matrix**, and the **per-platform capability matrix**. The remote transport rides on the **EVO-11 bridge** sidecar.

## Proposed slices

- **E1a** — `H2ADriver` adapter interface + `h2a drive --to <instance> --instruction <text>` ; local-tmux transport (generalize D3 `send-keys`) ; signed preamble + verify-on-receive (provenance + anti-replay). *Local, the unblock for "ne foutent rien".*
- **E1b** — native back-channels per host (codex `app-server`, claude `SendUserMessage`, gemini ACP) ; headless re-prompt floor ; `auto` chain.
- **E1c** — authority gate (MANDATE / `H2A_AUTHORITY_MATRIX`) on inbound injections in each host plugin hook.
- **E1d** — remote injection service (with EVO-11 bridge/sidecar).

## Open product decisions (PRINCIPAL)

1. **Host priority** — which transport/host first? (local-tmux for codex is the immediate unblock; codex `app-server` is the no-tmux path.)
2. **Is identifier-only ever acceptable**, or is a signature always required to act on an injected line? (recommendation: signature always required to *act*; identifier-only may *display* but not auto-execute.)
3. **Does this supersede the bus-passivity** for assignments — i.e. does h2a always *drive* an assignment rather than only *deposit* it? (recommendation: deposit in inbox **and** drive, so the inbox stays the durable record and the drive is the wake.)

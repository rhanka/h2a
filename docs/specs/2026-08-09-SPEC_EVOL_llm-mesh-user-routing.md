# SPEC EVOL — User-configurable llm-mesh routing in h2a

Date: 2026-08-09
Status: negotiated with the Sentropic BR-73 owner; implementation candidate under UAT

## User outcome

A user can enroll Cloud Code and Codex independently, then choose how new Claude Code affinities are routed:

```sh
h2a llm-mesh route show
h2a llm-mesh route prefer codex cloud-code
h2a llm-mesh route prefer cloud-code codex
h2a llm-mesh route strategy last-enrolled
h2a llm-mesh route strategy round-robin
h2a llm-mesh route policy '<validated Sentropic policy/profile JSON>'
h2a llm-mesh route reset
```

`agy` is a CLI alias for the `cloud-code` transport. An ordered preference applies only to new affinities. Existing sticky affinities never change silently; reset/rebind is an explicit, audited mesh operation.

## Defaults and mappings

- Default selection: most recently completed eligible enrollment, with deterministic account-ref tie-break.
- Optional selection: explicit ordered preferences or round-robin across new affinities only.
- Default fallback: bounded `retest-preferred`, same transport preferred, strict account stickiness and negative-cache cooldown.
- No retry after response commitment/first byte.
- Owner-ratified xhigh aliases:
  - Opus 5 and Opus 4.8 → Terra xhigh;
  - Fable 5 → Sol xhigh;
  - Sonnet 5 → Luna xhigh.
- Additional suffixed effort variants may exist only when the Sentropic council publishes their exact effort-preserving mapping.
- Bare model ids stay provider-faithful.
- Sonnet→Gemini remains an explicit policy example, not a default equivalence.
- h2a never contains a canonical model/equivalence table.

## Per-model policy

The `policy` command accepts the public `@sentropic/llm-mesh` policy schema. Rules can match requested model, alias, intent or capabilities and can select ordered transport/provider/model constraints. Named profiles carry a name and revision. All selectors and policies are validated by Sentropic APIs before persistence.

The h2a convenience commands change only the top-level strategy. They preserve all other current Sentropic policy fields, including rules, fallback mode, cooldown, max attempts, same-transport preference, stickiness and equivalence controls.

## Package boundary

| Concern | Owner |
|---|---|
| OAuth/device flow, callback/polling, refresh, encrypted keyring | `@sentropic/llm-mesh` |
| Executable account inventory, health/cooldown, route policy and affinity | `@sentropic/llm-mesh` |
| Model catalogue and equivalence council | `@sentropic/llm-mesh` |
| Anthropic/OpenAI ingress, tools/thinking/SSE, attempt loop, metering | `@sentropic/llm-gateway` |
| CLI config, process lifecycle, local URL and opaque bearer | h2a |
| Stable caller affinity and redacted status rendering | h2a host over Sentropic diagnostics |

h2a must not read CLI credential files, refresh tokens, persist executable account ids, infer provider mappings, select accounts or implement proxy wire conversion.

## Persistence and security

- `~/.sentropic/llm-mesh.json` contains public host settings and optional validated routing policy only.
- Legacy `accounts` and `meshAccounts` fields are ignored on read and removed on next write.
- Sentropic’s encrypted keyring is the sole account/credential store.
- Local gateway bearers are random opaque `gw-v2-*` values. They contain no account, provider, route, model or affinity data.
- The embedded session-minting endpoint listens on loopback only; the private app equivalent remains restricted to its control plane by network policy.
- Route status exposes only Sentropic `diagnosticAccountRef` values and requested-versus-actual public route data.
- Caller owner scope is stable across enrollment and gateway execution.

## Compatibility

- `h2a llm-mesh enroll cloud-code|codex` remains the enrollment surface but delegates the complete flow to the mesh facade.
- Codex legacy credentials are never imported; explicit re-enrollment is required.
- Cloud Code legacy public state may be migrated only by Sentropic’s explicit owner-bound compatibility path.
- `h2a run claude --gw` remains the real execution entrypoint.
- Direct mode remains available through `--no-gw`.

## Acceptance

1. Both transports enroll under the same stable owner scope; h2a persists neither credentials nor executable account ids.
2. Last-enrolled default, Cloud-first, Codex-first and round-robin-new-affinity select the expected route.
3. Two or more simultaneous Claude sessions receive distinct opaque bearers and stable independent affinities.
4. Preferred pre-stream failure causes bounded fallback; repeated calls within cooldown do not create a request storm; preferred route is retested after expiry.
5. No malformed/capability/caller-auth/other-4xx failure and no post-byte failure is retried.
6. Real Claude Code succeeds through each preference with normal text, tools, image input where supported and continuation after `/compact`.
7. Strict sticky, explicit reset/one-way behavior, concurrency bounds and equivalent-route suppression behave as the Sentropic contract states.
8. Diagnostics are redacted and show requested route plus actual provider/model/transport/account reference/effort.
9. Logout and re-enrollment update routing without stale secrets.
10. Exact candidate SHAs/tarball hashes, commands and observable outcomes are retained in PR evidence.

## Release order

1. Rebase/freeze Sentropic, run its full gates, review and exact-tarball h2a UAT.
2. Merge Sentropic PR and let its GitHub workflow publish mesh before gateway.
3. Install the published versions into h2a, update the lockfile, perform the single h2a rebase and final focused/full gates.
4. Merge h2a, then run the documented tag-driven h2a release from clean `main`; GitHub Actions performs npm publication via Trusted Publishing.

PR #199 is explicitly outside this evolution.

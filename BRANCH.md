# Vibe mesh train

Branch: `feat/0.98.x-vibe-mesh-train`, based on `origin/main`. Scope: the vibe
vertical end to end — the `vibe` CLI host (single alias `mistral-vibe`, the
muse one-alias rule), `mistral-vibe` account-transport enrollment through the
llm-mesh facade (PKCE browser sign-in minting a plan-billed API key), resume
spellings (`-c` / `--resume <id>`), cli-host-status host count 7 -> 8, help
groups and fixture help, delegate + agent-launch-args + throttle signatures
(`vibe: []`, muse pattern), and the `.toml` write refusal for the vibe host
in `isUnsupportedHostWritePath` (codex pattern).

Dependency lift: `@sentropic/cluster-mesh` 0.13.1 / `@sentropic/llm-mesh`
0.23.1 / `@sentropic/llm-gateway` 0.19.3, with the `llm-mesh-resolution`
version pins updated to the installed versions (0.13.1 / 0.23.1 / 0.19.3).

Out of scope here (upstream first): the Mistral runtime client lives in
`@sentropic/llm-mesh` (branch `feat/llm-mesh-mistral-runtime-client` —
transport mirror of muse, strict-wire message projection for the measured
Mistral 422 on gateway ingress metadata). The gateway registry line
(`new MistralAdapter({ client: new MistralRuntimeClient() })` in
`gateway-host/host.ts`) and the matching range bump land with the published
mesh release. Proven live before hand-off with a temporary dist overlay
(overlay restored): real `mistral-small-2603` calls through the h2a gateway
on both frozen v1 wires — anthropic-shape `/v1/messages` (200, "gw-ok") and
OpenAI-shape `/v1/chat/completions` (200, "wire-ok") — routed via the
enrolled `mistral-vibe` account.

Also documents the factual correction of the muse-code device-flow comment in
`llm-mesh-accounts.ts` (`pollForCompletion` is no longer codex-hardwired
upstream) — a retouche of muse text, flagged in the feature commit message.

Validation: `tsc -b` clean; `cli-host-status` + `cli-command-map` 25/25;
profiles / agent-launch-args / delegate / llm-mesh-accounts 137 passed
(1 environment skip); `routing-preferences` 4/4; `llm-mesh-resolution` 7/7;
`check-public-contract.sh` OK (MCP surface and CLI verb set unchanged).
No push, PR, publication or tag from this worktree.

# Vibe mesh train

Branch: `feat/0.98.x-vibe-mesh-train`, rebased on `origin/main` (5ca5c7bc).
Scope: the vibe vertical end to end — host, profile, enrollment, gateway
route, MCP launch, plugin surface, skills, docs and contract — mirroring the
muse pattern at every step (one alias rule, direct provider, honest refusals).

Upstream: the Mistral runtime client lives in `@sentropic/llm-mesh` 0.24.1
(sentropic PR #655, merged and published by the release train with
llm-gateway 0.19.4 and cluster-mesh 0.13.2). This branch lifts the ranges
and wires `new MistralAdapter({ client: new MistralRuntimeClient() })` into
the gateway registry (gateway-host/host.ts:76).

Live proof (candidate gateway, isolated foreground process on :3003, owner
gateway and sessions never touched): real `mistral-small-2603` call through
the rebased candidate — anthropic-shape `POST /v1/messages` → HTTP 200,
exact reply `candidate-ok` (21/4 tokens) — via the enrolled `mistral-vibe`
account; `/v1/models` serves magistral-medium-2509, mistral-large-4,
mistral-small-2603, zai-glm-5-3.

## Vibe completeness checklist

| Surface | State | Evidence (test → file:line) |
|---|---|---|
| Host descriptor + CLI_HOSTS registration | covered | cli-host-status.test.js:37,43 → hosts/vibe.ts:39 (H2A_VIBE_HOST), cli.ts:391,4450 |
| Host setup MCP config render (TOML translation hint) | covered | cli-host-status.test.js (host status wave info) + cli.ts:4450; renderMcpConfig hosts/vibe.ts:19 |
| Profile `vibe` (command `vibe`) | covered | profiles.test.ts:17 → profiles.ts:20, profile-menu.ts:10 |
| Single alias `mistral-vibe` (muse one-alias rule) | covered | profiles.test.ts:81 → profiles.ts:63, profile-menu.ts:21, index.ts:2884 |
| START verb `h2a vibe` | covered | fixtures/runtime-help-commands.json:41-42 (golden pinned by cli-command-map.test.js) → cli-command-map.ts:268 |
| Resume spellings (`--resume <id>` / `-c`) | covered | profiles.test.ts:40-44 → profiles.ts:50; agent-launch-args.test.ts:186 → agent-launch-args.ts (vibe branch) |
| Enrollment `mistral-vibe` (PKCE browser sign-in via facade) | covered | llm-mesh-accounts.test.ts:118 → llm-mesh-accounts.ts:9,101,187 |
| Gateway route (MistralAdapter + MistralRuntimeClient) + range lift | covered, live-proven | llm-mesh-resolution.test.ts:40 (0.24.1) → host.ts:7,8,76; package.json 0.13.2/0.24.1/0.19.4; live `candidate-ok` above |
| MCP `h2a_run` profile `vibe` (direct, `required` rejected, headless rejected, agent rejected) | covered | mcp-run.test.js:118,129,320,326 → tools.ts enum, agent-launch.ts:9,148,211 |
| Delegate (headless vibe -p documented programmatic mode; throttle signatures `vibe: []`) | covered | delegate.test.ts:149,822 → delegate.ts, throttle-signatures.ts |
| Plugin surface (vibe-hooks: post_agent record, push) | covered | host-plugin.test.js:228 → plugin.ts:96 (mechanism `vibe-hooks`) |
| Plugin `--write` refusal (TOML, format-strict merger) | covered | host-plugin.test.js (write refused) → cli.ts cmdHostPlugin |
| install-skills `--host vibe` (SKILL.md dirs, verifyHint) | covered | install-skills-hosts.test.js (vibe render test) → cli.ts:6618-6636, 7020-7023 |
| install-skills unknown-host message lists vibe | covered | install-skills-hosts.test.js:445 → cli.ts:6935 |
| Skills h2a / h2a-run / harness usable by vibe | covered | install-skills-hosts.test.js:294 (single-source render incl. harness) ; h2a-run/SKILL.md vibe section ; harness/review/SKILL.md vibe reviewer leg ; gateway-host-docs.test.js (new consistency test) |
| Harness reviewer/executor via h2a_run | covered | harness/review/SKILL.md:17,49-56,71 (vibe dispatch + reviewer-host) ; gateway-host-docs.test.js pins skill↔runtime parity |
| Docs (tracked integration status + capability note) | covered | docs/host-integration-matrix.md Vibe row ; docs/plugin-capability-matrix.md vibe note |
| Public contract (MCP tools + CLI verbs unchanged) | covered | scripts/check-public-contract.sh OK (60 tools / 99 verbs) |
| Core help golden | covered | dispatch-characterization-goldens.test.js (13,733 bytes / SHA pinned, +32 host / +52 plugin accounting) |
| Restore tool union | code only | restore.ts:67 includes `vibe`; no vibe-targeted restore test — non couvert (tsc-checked) |
| Doctor | non couvert | installation-doctor.ts:51 scopes doctor to claude\|codex (muse is not covered either — consistent) |

Also documents the factual correction of the muse-code device-flow comment in
`llm-mesh-accounts.ts` (`pollForCompletion` is no longer codex-hardwired
upstream) — a retouche of muse text, flagged in the feature commit message.
The store schema sentinel is now created atomically (tmp + rename) — root
cause of the F2 burst flake, fixed deterministically (5/5 consecutive runs).

Validation: `tsc -b` clean; targeted suites green (cli-host-status +
cli-command-map + goldens + host-plugin + mcp-run + install-skills 78/0,
gateway-host-docs 2/0; profiles / agent-launch-args / delegate /
llm-mesh-accounts / resolution / routing-preferences 148 passed 1 skip);
`npm test` exit 0 (h2a/test + focus-interactive + track 1193/1193);
`check-public-contract.sh` OK. No push of a tag, no publication, no version
bump from this worktree.

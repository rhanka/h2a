# h2a host integration matrix

This is the tracked source of truth for the host integration objective loop
`loop:host-plugin-matrix-2026-07-08`.

Status vocabulary:

- **shipped**: implemented in this repository and covered by an automated test.
- **rendered**: h2a renders the host-specific config/scaffold, but the host still
  requires a user trust/import step.
- **probe-required**: descriptor exists, but a live host binary/import path still
  needs a real end-to-end probe before claiming full support.

| Host | MCP setup h2a | Tools loop published | Native skill/plugin | Real plugin test |
|---|---|---|---|---|
| Claude | shipped (`h2a host setup --host claude`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped (`install-skills --host claude`, `host plugin --host claude --write`) | partial automated render/merge tests; live host E2E pending |
| Codex | shipped (`h2a host setup --host codex`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped/rendered (`install-skills --host codex`, `host plugin --host codex --scaffold` local marketplace + trust commands). The **canonical plugin install is the shared git marketplace**, not a scaffolded dir: `codex plugin marketplace add rhanka/h2a --ref main` → `codex plugin add h2a@sentropic` (codex reads `.claude-plugin/marketplace.json`); `--scaffold` stays for the drumbeat hooks plugin | automated scaffold/manifest/hooks tests; live `codex plugin add h2a@sentropic` verified at 0.88.0 against codex-cli 0.145.0 in an isolated `CODEX_HOME` (install + `marketplace upgrade` + re-add-on-bump); not yet attested inside a real codex session |
| Gemini | shipped (`h2a host setup --host gemini`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped/rendered (`install-skills --host gemini`, `host plugin --host gemini --write`) | automated render/merge tests; live host E2E pending |
| agy | Historical direct rendering, nonrecommended and non migrated; explicit existing JSON writer retained until migration | Registry bootstrap/receipt pending | Safe shared Gemini command/resource owner; native `agy plugin import gemini` then `agy plugin enable h2a`; polling has no hook equivalence | Isolated artifact/import-observation tests; genuine agy MCP/context and M-B guard/lifecycle remain unqualified |
| Hermes | shipped/rendered (`h2a host setup --host hermes`) | shipped if Hermes loads MCP config | shipped/rendered (`install-skills --host hermes`, `host plugin --host hermes`) | automated render tests; live Hermes hook/plugin E2E pending |
| OpenCode | shipped/rendered (`h2a host setup --host opencode`) | shipped if OpenCode loads MCP config | shipped/rendered (`install-skills --host opencode`, `host plugin --host opencode`) | automated render tests; live OpenCode binary/plugin E2E pending |
| Vibe | shipped/rendered — historical direct rendering, nonrecommended and non migrated; every MCP `--write` refused, including JSON/force; bootstrap registry expected | Missing MCP reports “Skills installées, outils MCP absents — bootstrap registre attendu” | Complete skills/resources under `VIBE_HOME`; strict owned TOML pre_tool/post_agent hooks; guard needs current native MCP proof; lifecycle explicit parent only | Isolated tests and bounded opt-in Node pilot; genuine Vibe parity/R7 and target-post qualification remain pending |
| Muse | Historical direct rendering, nonrecommended and non migrated; explicit existing JSON writer retained until migration | Registry bootstrap/receipt pending | Complete skills/resources under native root, default `~/.config/muse/skills` | Isolated artifact tests; genuine Muse MCP/context and M-B guard/lifecycle remain unqualified |

For Vibe/Muse/agy, rendered means historical output tested, not MCP installed.
All h2a MCPs ultimately require cluster-mesh registry migration. No production
receipt reader is invented before R5/R7 acceptance. See [native equipment and
qualification limits](native-host-equipment.md). Claude/Codex historical success
remains distinct from native/registry qualification.

## Security/policy capability disclosure

For a policy such as blocking manual `h2a` CLI use, this matrix is not enough to
infer parity: see the normative [host operator capability
contract](specs/2026-07-23-host-operator-capability-contract.md) and the
[adapter development guide](host-adapter-development.md). Current status is:

| Policy: forbid manual `h2a` shell invocation | State | Evidence |
|---|---|---|
| Claude Code | enforced | packaged `PreToolUse(Bash)` guard + policy corpus tests |
| Codex | gap | marketplace lifecycle hooks do not evidence pre-shell interception |
| Hermes | gap | MCP/skill integration is not a pre-shell guard |
| OpenCode | gap | MCP/skill integration is not a pre-shell guard |
| agy | gap | no verified native hook surface; M-B remains required |
| Muse | gap | no verified native hook surface; M-B remains required |
| Vibe | implemented, native qualification pending | packaged fail-open `pre_tool` guard; activation gated by current native MCP proof; fixture tests never qualify the post |

## Publication gate

Do not mark this loop done until:

1. every row has automated tests for MCP setup, loop-tool publication visibility,
   skill/plugin rendering, and plugin scaffold/hook rendering;
2. Codex native plugin work is reconciled with the codex:h2a branch/PR;
3. live host E2E gaps are either passed or explicitly documented as waived by the
   owner for this release;
4. the package version is bumped, packed, smoke-tested, and published.

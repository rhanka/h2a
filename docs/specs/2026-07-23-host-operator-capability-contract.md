# SPEC — Host operator capability contract and gap lifecycle

**Status:** proposed implementation contract  
**Owner WP:** `01KY7CAYTVW4PVGQ0D552EENDG` — *WP Host operator capability parity & gap governance*  
**Scope:** the H2A adapters for Claude Code, Codex, Hermes, OpenCode, and future host CLIs.

## 1. Problem

Host CLIs expose different extension surfaces. Rendering an MCP configuration, an
installed skill, or a lifecycle hook does **not** demonstrate that a host can
intercept a shell command before execution. Treating these capabilities as
interchangeable produces unsafe and misleading portability claims.

## 2. Capability contract

Every host-feature pair is represented in the host capability matrix with exactly
one state:

| State | Meaning | Allowed product claim |
|---|---|---|
| `enforced` | A native pre-action adapter rejects the action, with automated adapter tests **and** recorded host E2E evidence for the supported host version. | “blocked/enforced on `<host>`” |
| `rendered` | H2A can generate valid host configuration, but it is not installed/trusted or has no host E2E proof. | “configuration rendered” |
| `guided` | H2A provides documented manual guidance only. | “manual guidance available” |
| `gap` | The host lacks a verified extension point or no compatible adapter exists. | “not enforced on `<host>`” |
| `not-applicable` | The host does not expose the relevant operation. | “not applicable” |

A feature may never be called *cross-host enforced* unless every supported host
is `enforced`, or the statement names the restricted host set. `rendered` and
`guided` are never security controls.

## 3. Evidence requirements

A transition needs all applicable evidence, recorded in the capability matrix and
linked in the release/PR:

1. **Primary-source probe:** host version, vendor documentation/API or a
   reproducible real-binary probe of the extension point.
2. **Adapter contract test:** input/output cases including rejection and benign
   commands; the test is executed in CI without the host binary.
3. **Generated-artifact test:** validates the manifest/config schema and exact
   registration point rendered for that host.
4. **Host E2E evidence:** a pinned host version runs the generated artifact and
   proves the pre-action behavior. If unavailable, status cannot exceed
   `rendered`.
5. **Fallback disclosure:** `gap`/`guided` status, user-visible safe alternative,
   owner, and next probe are recorded.

## 4. Manual H2A CLI policy

The policy is: an agent should use the H2A MCP tools and skills, not invoke
`h2a` through its shell tool. It is a hard prevention only where the host proves
pre-shell interception.

| Host | Status today | Evidence / next action |
|---|---|---|
| Claude Code | `enforced` | Plugin `PreToolUse(Bash)` guard plus unit tests. Host E2E is release evidence. |
| Codex | `gap` | Existing marketplace hooks are lifecycle hooks; probe a Codex pre-shell tool interception API before implementing. |
| Hermes | `gap` | MCP/skill rendering exists; probe documented hook/plugin pre-shell interception. |
| OpenCode | `gap` | MCP/skill rendering exists; probe a `tool.execute.before`-equivalent plugin API and its deny semantics. |
| agy | `gap` | Poll/lifecycle integration is not a pre-shell guard; probe a native pre-tool extension boundary and deny semantics. |

## 5. Release gate

Any release that changes a host adapter must update the matrix and its tests. A
new hard-enforcement claim is rejected unless the four evidence requirements
above are present. A host gap never blocks an unrelated host’s release, but it
must remain explicit in documentation and user-facing output.

# `h2a` CLI — Stable JSON Output Contract (DEC-034)

> Frozen by [DEC-034](../DECISIONS.md). Cross-references: [DEC-031](../DECISIONS.md) (store layout), [DEC-033](../DECISIONS.md) (write-once stabilized artifacts).
>
> This document is the **public API for programmatic clients** of the `h2a` CLI. Future breaking changes require a new DEC and a major version bump on `@sentropic/h2a-cli`. The machine-readable counterpart lives in `packages/h2a-cli/src/cli-contract.ts` (`H2A_CLI_VERB_CONTRACTS`).

## Output envelopes

Every JSON-emitting verb writes ONE of three canonical envelopes on **stdout**, terminated by a single trailing `\n`:

| Envelope    | Stdout shape                          | When used                                                                                                                     |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `resource`  | Bare JSON object of the entity        | Verb returns the persisted/loaded record itself (negotiation record, journal entry, envelope, host config snippet, …).        |
| `list`      | Bare JSON array                       | Verb returns an unordered/ordered list of entities.                                                                           |
| `action`    | `{ "ok": true, ... }`                 | Verb performs a side effect with no natural entity to return (init, register, mailbox put, stabilize, host setup --write).    |
| `text`      | Human text, not JSON                  | `--help` only.                                                                                                                |
| `stream`    | Long-running foreground transport     | MCP stdio and local HTTP servers such as `focus serve`.                                                                       |

Stderr lines always follow the form `h2a <verb> [sub]: <message>` so callers can grep them deterministically.

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success.                                                                                                                                                                                                                                           |
| `1`  | User error: missing/bad flag, invalid JSON, validation failure on caller-supplied data, unknown verb/subverb/host.                                                                                                                                 |
| `2`  | Runtime/state error against the local store: negotiation not found, already open, already stabilized, signature fails verification, quorum incomplete, broken journal, divergent pre-existing config file refusing merge without `--force`.        |
| `3`  | I/O / OS error: file unreadable, permission denied, write refused by the filesystem.                                                                                                                                                               |

## Verbs

### Legacy Track context projection

#### `h2a report-context --workspace-root <absolute-path> [--root <h2a-store>]`

- **Envelope**: `resource`, schema `h2a.report-context/v1`.
- **Exit codes**: `0`, `1`, `3`.
- **Description**: Read-only projection of the same h2a tenant into Track context. `storeRoot` and `workspaceRoot` are realpaths; entries are ordinal-sorted, restricted to the requested workspace, capped at 100 entries / 128 KiB, and report an `omitted` count. Inbox bodies are never emitted. This leaf command never calls Track.

### Focus Web

#### `h2a focus serve [--repo <path>] [--track-events <path>] [--host <host>] [--port <0-65535>]`

- **Envelope**: `stream`.
- **Exit codes**: `0`, `1`; signal termination follows conventional process exit status.
- **Description**: Serve the packaged adapter-node production app. The repository is resolved from `--repo`, `FOCUS_REPO_ROOT`, or the nearest ancestor containing `.track/events.jsonl`. The events file is resolved from `--track-events`, `FOCUS_TRACK_EVENTS`, or `<repo>/.track/events.jsonl`.
- **Network**: binds `127.0.0.1:5178` by default. `--host` is an explicit opt-out from loopback; `--port 0` selects an available port. The exact URL is printed only after the listener is ready.
- **Packaging**: startup fails closed if the versioned Focus artifact, handler, client assets, server assets, or declared runtime dependencies are absent or incompatible. It never starts a Vite development server.

`h2a focus web` is the exact alias. Other `h2a focus ...` invocations retain the existing `track focus` facade behavior.

### Setup

#### `h2a init [--root <path>]`

- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "root": "<absolute-path>" }`.
- **Exit codes**: `0`, `1`, `3`.
- **Description**: Create the `<root>/.h2a/` local-files store layout (DEC-031). `--root` defaults to `<cwd>/.h2a`.

### Registry

#### `h2a register --json <registration-json> [--root <path>]`

- **Required**: `--json`.
- **Optional**: `--root`.
- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "id": "<instance-id>", "root": "<absolute-path>" }`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Append an `H2AActorRegistration` to `registry/instances.jsonl`. Duplicate `id` → exit `2`.

#### `h2a discover [--role <role>] [--scope <scope>] [--root <path>]`

- **Envelope**: `list`.
- **Stdout shape**: `H2AActorRegistration[]`.
- **Exit codes**: `0`, `1`.
- **Description**: List registered instances, optionally filtered by role and/or scope.

#### `h2a hosts`

- **Envelope**: `list`.
- **Stdout shape**: `H2AHostDescriptor[]`.
- **Exit codes**: `0`.
- **Description**: List host descriptors known to this CLI (`codex`, `claude`, `gemini`).

#### `h2a mcp-tools`

- **Envelope**: `list`.
- **Stdout shape**: `string[]` of canonical MCP tool names.
- **Exit codes**: `0`.
- **Description**: List the canonical MCP tool names exposed by the built-in server.

### Negotiation

#### `h2a negotiate open --json <record-json> [--root <path>]`

- **Required**: `--json`.
- **Envelope**: `resource`.
- **Stdout shape**: the persisted `H2ANegotiationRecord`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Open a new negotiation, persisting its `state.json`. Re-opening an existing id → exit `2`.

#### `h2a negotiate status --id <id> --status <status> [--root <path>]`

- **Required**: `--id`, `--status`.
- **Envelope**: `resource`.
- **Stdout shape**: the updated `H2ANegotiationRecord`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Transition the negotiation to a new status (`draft` / `proposed` / `countered` / `stabilized` / `closed`).

#### `h2a negotiate event --id <id> --json <payload-json> [--causation-id <id>] [--correlation-id <id>] [--root <path>]`

- **Required**: `--id`, `--json`.
- **Optional**: `--causation-id`, `--correlation-id`, `--root`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Append an arbitrary event payload to the negotiation journal. By default inherits `causationId` from the previous entry's id and `correlationId` from the previous entry (DEC-033).

#### `h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]`

- **Required**: `--id`, `--instance`, `--artifact`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry` with `type = "propose"`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]`

- **Required**: `--id`, `--instance`, `--artifact`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry` with `type = "counter"`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]`

- **Required**: `--id`, `--instance`, `--artifact`, `--private-key`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry` carrying `body = { kind: "signature", artifactHash, signature }`.
- **Exit codes**: `0`, `1`, `2`, `3`.
- **Description**: Sign the canonical artifact hash with the given ed25519 PEM private key. Unreadable key file → exit `3`. Negotiation not found → exit `2`.

#### `h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]`

- **Required**: `--id`.
- **Envelope**: `action`.
- **Stdout shape**:
  ```json
  {
    "ok": true,
    "record": "<H2ANegotiationRecord>",
    "artifactHash": "sha256:<hex>",
    "signers": ["<instance>", ...],
    "artifactPath": "<absolute-path>",
    "advisoryEvents": [{ "id": "<event-id>", "sequence": <n> }],
    "finalEvent": { "id": "<event-id>", "sequence": <n> }
  }
  ```
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Verify quorum + ed25519 signatures, persist the winning artifact in write-once form (DEC-033), and mark the negotiation `stabilized`. State conflicts (quorum incomplete, signature mismatch, already stabilized) → exit `2`.

#### `h2a negotiate journal --id <id> [--root <path>]`

- **Required**: `--id`.
- **Envelope**: `list`.
- **Stdout shape**: `H2AJournalEntry[]` (with hash-chain verified by the store on read).
- **Exit codes**: `0`, `1`, `2`.

#### `h2a declare-interest --negotiation <id> --instance <id> --interets <a,b> [--bindings <scope,...>] [--masque-impact-collectif] [--event-id <id>] [--root <path>]`

- **Required**: `--negotiation`, `--instance`, `--interets`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry` carrying `body.kind = "declaration-interet"`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a conflict-posture --negotiation <id> [--root <path>]`

- **Required**: `--negotiation`.
- **Envelope**: `resource`.
- **Stdout shape**: `{ "negotiationId": "<id>", "postures": ["<H2APostureConflitResult>", ...] }`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a dossier --negotiation <id> [--presenter <id>] [--advisory-gate] [--event-id <id>] [--root <path>]`

- **Required**: `--negotiation`.
- **Optional**: `--presenter`, `--advisory-gate`, `--event-id`, `--root`.
- **Envelope**: `resource`.
- **Stdout shape**: `{ "negotiationId": "<id>", "dossier": "<H2ADecisionDossier>", "dossierHash": "sha256:<hex>", "presenterBias"?: "<H2APresenterBias>" }`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Derive the advisory decision dossier. With `--presenter`, also derives the presenter-bias posture; with `--advisory-gate`, a biased presenter appends an advisory escalation event without blocking later stabilization.

#### `h2a confiance --negotiation <id> [--root <path>]`

- **Required**: `--negotiation`.
- **Envelope**: `resource`.
- **Stdout shape**: `{ "negotiationId": "<id>", "posture": "<H2APostureConfianceResult>" }`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Derive the advisory `postureConfiance` from the current dossier hash, valid comprehension attestations, and disclosed or undisclosed collective conflicts. It never blocks stabilization.

#### `h2a attest-comprehension --instance <id> --dossier <file|sha256:...> --private-key <pem-path> [--negotiation <id> | --to <instance>] [--root <path>]`

- **Required**: `--instance`, `--dossier`, `--private-key`.
- **Optional**: `--negotiation`, `--to`, `--event-id`, `--role`, `--scope`, `--at`, `--causation-id`, `--correlation-id`, `--root`.
- **Envelope**: `resource`.
- **Stdout shape**: the appended `H2AJournalEntry` when `--negotiation` is used, otherwise a signed `H2AEnvelope` event.
- **Exit codes**: `0`, `1`, `2`, `3`.
- **Description**: Emit a signed, non-binding `comprehension-attestation`. AGENTS need the `attester-comprehension` grant; the event has no `artifactKind` and does not count toward stabilization quorum.

#### `h2a comprehension list --negotiation <id> [--root <path>]`

- **Required**: `--negotiation`.
- **Envelope**: `list`.
- **Stdout shape**: `H2AJournalEntry[]` filtered to `body.kind = "comprehension-attestation"`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a comprehension verify --json <event-or-envelope-json> --public-key <pem-file>`

- **Required**: `--json`, `--public-key`.
- **Envelope**: `resource`.
- **Stdout shape**: `{ "ok": true, "kind": "comprehension-attestation", "subject": "<instance>", "dossierHash": "sha256:<hex>" }` on success.
- **Exit codes**: `0`, `1`, `2`, `3`.

### Mailbox

#### `h2a inbox put --instance <id> --json <envelope> [--root <path>]`

- **Required**: `--instance`, `--json`.
- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "id": "<envelope-id>", "mailbox": "inbox", "instance": "<id>" }`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a inbox read --instance <id> [--root <path>]`

- **Required**: `--instance`.
- **Envelope**: `list`.
- **Stdout shape**: `H2AEnvelope[]` (oldest first).
- **Exit codes**: `0`, `1`.

#### `h2a inbox pop --instance <id> --envelope <id> [--root <path>]`

- **Required**: `--instance`, `--envelope`.
- **Envelope**: `resource`.
- **Stdout shape**: the popped `H2AEnvelope`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Missing envelope → exit `2`.

#### `h2a outbox put --instance <id> --json <envelope> [--root <path>]`

- **Required**: `--instance`, `--json`.
- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "id": "<envelope-id>", "mailbox": "outbox", "instance": "<id>" }`.
- **Exit codes**: `0`, `1`, `2`.

#### `h2a outbox read --instance <id> [--root <path>]`

- **Required**: `--instance`.
- **Envelope**: `list`.
- **Stdout shape**: `H2AEnvelope[]` (oldest first).
- **Exit codes**: `0`, `1`.

### Drive

#### `h2a drive --from <instance> --to <instance> --instruction <text> --private-key <pem> [--driver logging|native|local-tmux|headless|auto] [--host <host>] [--root <path>]`

- **Required**: `--from`, `--to`, `--instruction`, `--private-key`.
- **Optional**: `--root`, `--driver`, `--host`, `--nonce`, `--at`.
- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "from": "<instance>", "to": "<instance>", "driver": "<driver>", "driven": true|false, "instructionLine": "[h2a ...] <text>" }`.
- **Exit codes**: `0`, `1`, `2`.
- **Description**: Sign and inject a visible h2a instruction line into a live peer. Sender authority is checked before dispatch; `native`/`auto` may use host-native backchannels when launch hints are present, otherwise fall back to local-tmux/headless.

#### `h2a drive receive --to <instance> (--line <signed-line> | --stdin) [--ignore-non-drive] [--root <path>]`

- **Required**: `--to` plus either `--line` or `--stdin`.
- **Optional**: `--root`, `--ignore-non-drive`, `--now`.
- **Envelope**: `action`.
- **Stdout shape**: `{ "ok": true, "from": "<instance>", "to": "<instance>", "instruction": "<text>" }` or `{ "ok": true, "ignored": true, "reason": "non-drive" }` with `--ignore-non-drive`.
- **Exit codes**: `0`, `1`, `2`, `3`.
- **Description**: Host-hook verify-before-act gate for an incoming signed drive line. It checks the sender key/signature, target instance, authority (`authorizeDrive`), and replay/freshness before a host plugin or remote injector acts. `--stdin` accepts either a raw signed line or a JSON hook event with `prompt`/`line`; `--ignore-non-drive` returns `{ ok:true, ignored:true }` for ordinary user prompts. Accepted drive ids are persisted under the local store so separate hook invocations reject replays.

#### `h2a drive serve --to <instance> --inject-command <command> [--port <n>] [--host <h>] [--path </h2a/drive>] [--root <path>]`

- **Required**: `--to`, `--inject-command`.
- **Optional**: `--root`, `--host`, `--port`, `--path`.
- **Envelope**: `stream`.
- **HTTP shape**: `POST /h2a/drive` with `{ "line": "[h2a ...] <instruction>" }`; success returns `202` with `{ "ok": true, "from": "<instance>", "to": "<instance>", "instruction": "<text>" }`.
- **Exit codes**: `0`, `1`.
- **Description**: Remote/sidecar verify-before-inject service for EVO-1 E1d. It rejects malformed bodies, missing/bad keys, bad signatures, unauthorized senders, target mismatches, replayed lines, and freshness failures before invoking `--inject-command`. The signed line is passed on stdin and in `H2A_DRIVE_LINE`; parsed fields are available as `H2A_DRIVE_FROM`, `H2A_DRIVE_TO`, and `H2A_DRIVE_INSTRUCTION`.

### Host wiring

#### `h2a host setup --host <codex|claude|gemini|agy|hermes|opencode> [--endpoint local|remote] [--url <https://…/mcp>] [--root <path>] [--print | --write <file>] [--force] [--no-wake]`

- **Required**: `--host`.
- **Optional**: `--endpoint`, `--url`, `--root`, `--print`, `--write`, `--force`, `--no-wake`.
- **Envelope (default / `--print`)**: `resource` — bare JSON of the `mcpServers.h2a` snippet on stdout, target path hint on stderr.
- **Envelope (`--write <file>`)**: `action` — `{ "ok": true|false, "host": "<host>", "endpoint": "local|remote", "path": "<file>", "merged": true, "replacedH2a": true|false, "removedH2aMcpServers": [], "removedTrackMcpServers": [], "next"?: "h2a doctor --repair" }` on stdout.
- **Exit codes**: `0`, `1`, `2`, `3`.
- **Description**: Render exactly one selected `mcpServers.h2a` endpoint. `local` (default) is a coordination-ready stdio server; `remote` requires an absolute HTTP(S) `--url` and cannot combine local root/wake flags. The selected endpoint exposes h2a plus read-only Track tools. Reconfiguration replaces canonical or aliased h2a entries and removes standalone Track MCP entries, preserving unrelated servers. `--write` safely merges JSON only; it refuses Hermes YAML and OpenCode JSONC rather than overwriting them. `--force` is reserved for replacing malformed JSON. After Codex or Claude setup, h2a inspects the selected host without changing its installation; an incoherent result names the findings, recommends `h2a doctor --repair`, and exits `2`. Filesystem read/write failure → exit `3`.

#### `h2a host status [--host <name>]`

- **Required**: none.
- **Optional**: `--host`.
- **Envelope**: `action`.
- **Stdout shape**:
  ```json
  {
    "ok": true,
    "hosts": [
      {
        "host": "codex",
        "wave": 1,
        "mcpAdapterShipped": true,
        "hostSetupShipped": true,
        "hostScenarioShipped": true,
        "summary": "wave 1 — host setup + MCP scenario shipped; MCP adapter (stdio + local) wired"
      }
    ]
  }
  ```
- **Exit codes**: `0`, `1`.
- **Description**: Report each host descriptor's wave + adapter/setup/scenario-shipped flags (DEC-037/044). Default lists every host known to `H2A_CLI_HOSTS`; `--host <name>` filters to a single host (unknown name → exit `1`). Source of truth for the human-readable matrix at [`docs/compatibility-matrix.md`](./compatibility-matrix.md).

### Store maintenance

#### `h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]`

- **Required**: none.
- **Optional**: `--from`, `--to`, `--dry-run`, `--root`.
- **Envelope**: `action`.
- **Stdout shape**:
  ```json
  {
    "ok": true,
    "fromVersion": "<v>",
    "toVersion": "<v>",
    "changed": false,
    "dryRun": false,
    "root": "<absolute-path>"
  }
  ```
- **Exit codes**: `0`, `1`.
- **Description**: Migrate the local-files store schema between known versions (DEC-036). V1→V1 is a no-op (`changed:false`). Unknown `--from` or `--to` → exit `1`. Future schema bumps will register transformations here.

### MCP transport

#### `h2a mcp-serve [--root <path>]`

- **Envelope**: `stream` — JSON-RPC 2.0 over stdio, long-running.
- **Exit codes**: `0`, `1`.
- **Description**: Run the built-in MCP server. Not bound by the envelope contract; covered by `mcp-stdio.test.js` and `examples/principal-conductors`.

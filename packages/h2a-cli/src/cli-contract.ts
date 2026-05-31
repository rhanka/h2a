/**
 * Stable JSON output contract + exit-code table for the `h2a` CLI surface.
 *
 * This module is the **machine-readable counterpart** of `docs/cli-contract.md`
 * (DEC-034). Every verb exposed by `runCli` appears here with:
 *
 * - `outputShape`: one of three canonical envelopes (see below).
 * - `exitCodes`: the subset of {0,1,2,3} the verb can return.
 * - `requiredFlags` / `optionalFlags`: documented flag surface.
 *
 * Envelope shapes
 * ---------------
 *
 * - `resource` — single entity persisted/loaded by the verb. Stdout is the
 *   bare JSON of that entity (no `{ok}` wrapper). Examples: a negotiation
 *   record, a journal entry, an envelope, the MCP config snippet for a host.
 * - `list` — bare JSON array. Examples: `discover`, `inbox read`,
 *   `negotiate journal`.
 * - `action` — confirmation envelope `{ ok: true, ...details }` for verbs
 *   that perform side effects but do not return a natural entity (`init`,
 *   `register`, `inbox put`, `outbox put`, `negotiate stabilize`,
 *   `host setup --write`).
 * - `text` — non-JSON human output (currently only `--help`).
 * - `stream` — long-running framed transport (`mcp-serve`, JSON-RPC 2.0
 *   over stdio); no single stdout payload.
 *
 * Exit-code table
 * ---------------
 *
 * - `0` success.
 * - `1` user error — bad flag, missing required flag, invalid JSON,
 *   validation failure on user input, unknown verb/subverb/host.
 * - `2` runtime/state error — store conflict or business-rule failure
 *   (negotiation not found, already open, already stabilized, signature
 *   fails verification, quorum incomplete, broken journal, divergent
 *   pre-existing config file).
 * - `3` I/O / OS error — file unreadable, permission denied, write
 *   refused by the filesystem.
 *
 * DEC-034 freezes this contract. Future breaking changes require a new DEC
 * and a major version bump on `@sentropic/h2a-cli`.
 */

export type H2ACliOutputShape = "resource" | "list" | "action" | "text" | "stream";

export type H2ACliExitCode = 0 | 1 | 2 | 3;

export interface H2ACliVerbContract {
  /** Full verb path, space-separated (`"negotiate open"`, `"host setup"`). */
  readonly verb: string;
  /** Canonical envelope of the stdout payload on success. */
  readonly outputShape: H2ACliOutputShape;
  /** Exit codes this verb can produce. Always includes `0` for success. */
  readonly exitCodes: readonly H2ACliExitCode[];
  /** Flags required for a happy-path invocation. */
  readonly requiredFlags: readonly string[];
  /** Flags accepted but optional. */
  readonly optionalFlags: readonly string[];
  /** One-line human description. */
  readonly description: string;
}

export const H2A_CLI_VERB_CONTRACTS: readonly H2ACliVerbContract[] = [
  // --- meta / help ---
  {
    verb: "--help",
    outputShape: "text",
    exitCodes: [0],
    requiredFlags: [],
    optionalFlags: [],
    description: "Print human-readable usage. Same as `help` and no-argv invocation."
  },

  // --- registry / hosts / tooling discovery ---
  {
    verb: "hosts",
    outputShape: "list",
    exitCodes: [0],
    requiredFlags: [],
    optionalFlags: [],
    description: "List host descriptors known to this CLI (codex, claude, gemini)."
  },
  {
    verb: "mcp-tools",
    outputShape: "list",
    exitCodes: [0],
    requiredFlags: [],
    optionalFlags: [],
    description: "List canonical MCP tool names exposed by the built-in server."
  },

  // --- setup / registry ---
  {
    verb: "init",
    outputShape: "action",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["root"],
    description: "Create the `<root>/.h2a/` local-files store layout (DEC-031)."
  },
  {
    verb: "register",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["json"],
    optionalFlags: ["root"],
    description: "Append an H2AActorRegistration to `registry/instances.jsonl`."
  },
  {
    verb: "discover",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "role", "scope"],
    description: "List registered instances, optionally filtered by role/scope."
  },

  // --- subagents (DEC-068 / V2) ---
  {
    verb: "subagent register",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["parent", "name"],
    optionalFlags: ["root", "capabilities"],
    description:
      "Register an addressable subagent binding `<parent>~<name>` under an AGENTS parent instance, appended to `registry/subagents.jsonl`. `--capabilities a,b` declares a subset of the parent's capabilities. Validated against the parent (must be AGENTS; capabilities must be a subset) before write. DEC-068."
  },
  {
    verb: "subagent list",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "parent"],
    description:
      "List registered subagent bindings, optionally filtered to one parent instance via `--parent`. DEC-068."
  },
  {
    verb: "subagent route",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["to", "json"],
    optionalFlags: ["root", "mailbox"],
    description:
      "Route an H2A envelope to a registered subagent address (`<parent>~<name>`), validating the binding exists before delivery (exit 2 if unregistered). `--mailbox inbox|outbox` (default inbox). DEC-070."
  },
  {
    verb: "subagent inbox",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: ["parent"],
    optionalFlags: ["root"],
    description:
      "Parent fan-in: list each registered subagent of `--parent` with the envelopes in its inbox, for coordination/audit. DEC-070."
  },
  {
    verb: "subagent audit",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "id", "parent"],
    description:
      "List the append-only audit events (`registered`, `routed`, `revoked`) for a single subagent via `--id <address>`, or for all subagents of `--parent <instance>`. The audit log is permanent history and survives an inbox pop (unlike the fan-in). DEC-071."
  },
  {
    verb: "subagent revoke",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id"],
    optionalFlags: ["root", "reason"],
    description:
      "Takeover at subagent granularity: revoke a subagent (`--id <address>`) so future routing to it is refused (exit 2 on a later route). Status is derived from the audit log; revoking an already-revoked subagent is a state error (exit 2). The parent reclaims pending work via the fan-in (`subagent inbox`). DEC-072."
  },

  // --- negotiation ---
  {
    verb: "negotiate open",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["json"],
    optionalFlags: ["root"],
    description: "Open a new negotiation, persisting its `state.json`."
  },
  {
    verb: "negotiate status",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id", "status"],
    optionalFlags: ["root"],
    description: "Transition a negotiation to a new status (draft / proposed / countered / stabilized / closed)."
  },
  {
    verb: "negotiate event",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id", "json"],
    optionalFlags: ["root", "causation-id", "correlation-id"],
    description: "Append an arbitrary event payload to the negotiation journal."
  },
  {
    verb: "negotiate offer",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id", "instance", "artifact"],
    optionalFlags: ["root", "event-id", "causation-id", "correlation-id"],
    description: "Append a `propose` journal entry carrying the offered artifact body."
  },
  {
    verb: "negotiate counter",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id", "instance", "artifact"],
    optionalFlags: ["root", "event-id", "causation-id", "correlation-id"],
    description: "Append a `counter` journal entry carrying a counter-offer artifact body."
  },
  {
    verb: "negotiate sign",
    outputShape: "resource",
    exitCodes: [0, 1, 2, 3],
    requiredFlags: ["id", "instance", "artifact", "private-key"],
    optionalFlags: ["root", "event-id", "causation-id", "correlation-id"],
    description: "Sign the canonical artifact hash with the given ed25519 PEM private key and append a signature event."
  },
  {
    verb: "negotiate stabilize",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id"],
    optionalFlags: ["root", "event-id"],
    description: "Verify quorum + signatures, persist the winning artifact in write-once form (DEC-033), and mark the negotiation stabilized."
  },
  {
    verb: "negotiate journal",
    outputShape: "list",
    exitCodes: [0, 1, 2],
    requiredFlags: ["id"],
    optionalFlags: ["root"],
    description: "Read and verify the full hash-chained journal for a negotiation."
  },

  // --- mailboxes ---
  {
    verb: "inbox put",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "json"],
    optionalFlags: ["root"],
    description: "Drop an H2A envelope into the inbox of an instance."
  },
  {
    verb: "inbox read",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: ["instance"],
    optionalFlags: ["root"],
    description: "List the inbox envelopes of an instance (oldest first)."
  },
  {
    verb: "inbox pop",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "envelope"],
    optionalFlags: ["root"],
    description: "Remove and return a specific envelope from an instance's inbox."
  },
  {
    verb: "outbox put",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "json"],
    optionalFlags: ["root"],
    description: "Drop an H2A envelope into the outbox of an instance (append-only)."
  },
  {
    verb: "outbox read",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: ["instance"],
    optionalFlags: ["root"],
    description: "List the outbox envelopes of an instance (oldest first)."
  },

  // --- store maintenance (DEC-036) ---
  {
    verb: "store migrate",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: [],
    optionalFlags: ["root", "from", "to", "sanitize-paths", "dry-run"],
    description:
      "Migrate the local-files store schema between known versions (DEC-036). V1→V1 is a no-op (`changed:false`). Unknown --from or --to → exit 1. With `--sanitize-paths` (DEC-064), rename pre-DEC-062 entries containing `:` to the safePathSegment form; a name collision with an already-sanitized target → exit 2."
  },

  // --- MCP transport ---
  {
    verb: "mcp-serve",
    outputShape: "stream",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "auto-open", "host", "instance", "scope", "upgrade-check", "auto-upgrade", "no-restart"],
    description:
      "Run the built-in MCP server speaking JSON-RPC 2.0 over stdio (long-running). `--auto-open` opens a presence session at boot (EVO-6, DEC-105). Version handling is **opt-in** (no network on a default boot): `--auto-upgrade` self-installs @latest and re-execs in place (process.execve, same PID/stdio so the host stays connected; `--no-restart` keeps next-launch); `--upgrade-check` prints a cached availability notice only — EVO-8/DEC-107/108."
  },
  {
    verb: "upgrade",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["check"],
    description:
      "Self-upgrade the global `@sentropic/h2a-cli` (EVO-8, DEC-107). `--check` reports `{current, latest, upgradeAvailable}` without installing; bare runs `npm i -g @sentropic/h2a-cli@latest`. Exit 1 if the install fails."
  },

  // --- remote transport (DEC-076/077, signed-bearer) ---
  {
    verb: "remote serve",
    outputShape: "stream",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "port", "host", "path"],
    description:
      "Run the HTTP listener that authenticates POSTed signed envelopes against the store registry and delivers them to local inboxes (long-running). Binds 127.0.0.1 by default; pass `--host 0.0.0.0` to expose. DEC-077."
  },
  {
    verb: "remote send",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: ["url", "instance", "private-key", "json"],
    optionalFlags: [],
    description:
      "Sign an envelope (`--json`) with `--private-key` as `--instance` and POST it to `--url`. Prints `{ status, body }`; exit 0 on a 2xx response, 1 otherwise. DEC-077."
  },
  {
    verb: "sysml verify",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["json", "public-key"],
    optionalFlags: ["by", "content-integrity", "api-base", "auth"],
    description:
      "Verify an envelope's embedded SysML v2 ref: commit-trust (signature, default) + optional content-integrity (`--content-integrity`: re-fetch the element and compare its hash to `elementHash`). Async (network on the content path). Exit 2 if verification fails. DEC-099."
  },

  // --- drumbeat (DEC-086, anti-stall relance) ---
  {
    verb: "drumbeat record",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: ["instance", "status"],
    optionalFlags: ["root", "command", "resume-command", "cwd", "tty", "tmux-session", "tmux-pane", "tmux-window"],
    description:
      "Record (durably) that an agent stopped, with its work status and launch context, in `<root>/.h2a/drumbeat/`. Survives the presence sweep so a stopped agent can be relanced. Called by the host plugin on exit. DEC-086."
  },
  {
    verb: "drumbeat scan",
    outputShape: "resource",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "max-relances"],
    description:
      "List stalled agents from the drumbeat registry: `findings` (relance candidates) and `exhausted` (hit the relance cap → escalate). `done` entries are skipped. DEC-086."
  },
  {
    verb: "drumbeat clear",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: ["instance"],
    optionalFlags: ["root"],
    description:
      "Remove a drumbeat registry entry — call when an agent is cleanly resumed or finished. DEC-086."
  },
  {
    verb: "drumbeat escalations",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root"],
    description:
      "List open escalations the daemon raised when an agent exhausted its relance budget (→ PRINCIPAL, channel alert). The anti-loop cap (`--max-relances`) is the guard; this is the escalation that replaces further relances. Cleared by `drumbeat clear`. DEC-095."
  },
  {
    verb: "drumbeat relance-inbox",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "instance", "relauncher"],
    description:
      "Consume local inbox envelopes whose body is `drumbeat.resume` and relance the targeted local stopped entry via a local relauncher (logging|local-tmux|headless|auto, where auto is local-tmux then headless). This is the receive side of the D4 remote relay chain. DEC-117."
  },
  {
    verb: "drumbeat watch",
    outputShape: "stream",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "interval-ms", "max-relances", "relauncher", "instance", "private-key", "role", "scope", "decider", "decider-after", "decider-enforce"],
    description:
      "Run the anti-stall daemon (long-running): each beat first consumes D4 `drumbeat.resume` inbox envelopes locally, then scans the registry and relances stalled agents via the relauncher adapter. `--relauncher` selects logging (default, dry-run) | local-tmux (send-keys into the captured pane) | remote (signed D4 relay to endpoints[kind=remote]) | headless (detached respawn) | auto (local-tmux, then remote, then headless). remote/auto require `--instance <signer>` and `--private-key <pem>`; `--role`/`--scope` override signer actor metadata. The external `/loop` codex/agy/gemini lack. DEC-086/091/117. D5: `--decider logging|<command>` adds a reflexive watchdog, consulted only after `--decider-after` relances (default 1; must be < --max-relances); it decides relance/finish/escalate/reroute. Decisions are logged to `drumbeat/decisions.jsonl` and applied only with `--decider-enforce` (advisory-first); reroute escalates with a hint. The decider is consulted each beat in [decider-after, max-relances) — a documented cost. DEC-111."
  },

  // --- host wiring ---
  {
    verb: "host setup",
    outputShape: "resource",
    exitCodes: [0, 1, 2, 3],
    requiredFlags: ["host"],
    optionalFlags: ["root", "print", "write", "force"],
    description:
      "Render or merge the `mcpServers.h2a` snippet for a host (codex|claude). `--print` (default) emits the snippet as a resource on stdout; `--write <file>` switches the verb to an action envelope and merges/creates the target config file."
  },
  {
    verb: "host plugin",
    outputShape: "resource",
    exitCodes: [0, 1, 2, 3],
    requiredFlags: ["host", "instance"],
    optionalFlags: ["root", "status", "write", "force", "scaffold"],
    description:
      "Render the per-host stop-hook command + placement so a stop is recorded with a launch context the drumbeat (D2) and local-tmux relauncher (D3) can relance. `--write <file>` installs the idempotent Claude-format `hooks.Stop` for **claude / gemini / codex** (claude+gemini → settings.json; codex → a plugin hooks.json). `--scaffold <dir>` (codex-only) writes a **full codex local marketplace** (verified: codex installs from a marketplace dir, not a bare plugin) — `.agents/plugins/marketplace.json` + `plugins/<name>/.codex-plugin/plugin.json` + `plugins/<name>/hooks/hooks.json` — and emits the **trust step** (`codex plugin marketplace add <dir>` → `codex plugin add <name>@<marketplace>`) in the `trust` array, since codex has no drop-in/bypass path. **agy** is poll-only (refused, use the poll command). DEC-093/102/103/104/113."
  },
  {
    verb: "host status",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["host"],
    description:
      "Report each host's wave + adapter/setup/scenario-shipped flags (DEC-037/044). Output is `{ ok: true, hosts: [{host, wave, mcpAdapterShipped, hostSetupShipped, hostScenarioShipped, summary}] }`. Filter to a single host with `--host <name>`; unknown host → exit 1."
  },

  // --- high-level coordination (DEC-054) ---
  {
    verb: "connect",
    outputShape: "action",
    exitCodes: [0, 1, 3],
    requiredFlags: ["host"],
    optionalFlags: ["root", "instance", "name"],
    description:
      "Bootstrap a coordinated session: ensures the local store under --root, resolves or mints the perennial instance id, renders the host MCP snippet, and prints follow-up steps (keypair ready + skill install). DEC-054/116."
  },
  {
    verb: "doctor",
    outputShape: "action",
    exitCodes: [0, 2, 3],
    requiredFlags: [],
    optionalFlags: ["root"],
    description:
      "Run a health check on the shared root: existence, schema sentinel version, live presence count. Returns `ok:false` (exit 2) if any check fails. DEC-054."
  },
  {
    verb: "sessions",
    outputShape: "list",
    exitCodes: [0, 3],
    requiredFlags: [],
    optionalFlags: ["root", "scope", "instance"],
    description:
      "List currently-live h2a sessions (CLI mirror of the MCP h2a_discover_sessions tool). Reads presence files, filters by freshness. DEC-054."
  },
  {
    verb: "keys generate",
    outputShape: "action",
    exitCodes: [0, 1, 3],
    requiredFlags: ["instance"],
    optionalFlags: ["root", "out"],
    description:
      "Generate an ed25519 PEM keypair for an instance (PKCS#8 private, SPKI public). Default output directory is <root>/keys/. Returns the on-disk paths and the public PEM. DEC-054."
  },
  {
    verb: "keys add",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "public-key"],
    optionalFlags: ["root"],
    description:
      "Append a public key (PEM file) to an instance's keyring `registry/keys.jsonl` (rotate-in). The verifier then accepts a signature from ANY active key, enabling overlap during rotation. Exit 2 if the instance is unregistered or the key is already active. DEC-078."
  },
  {
    verb: "keys list",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: ["instance"],
    optionalFlags: ["root"],
    description:
      "List an instance's active public keys (registration keys + keyring additions, minus revoked). DEC-078."
  },
  {
    verb: "keys revoke",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "public-key"],
    optionalFlags: ["root"],
    description:
      "Revoke a public key (PEM file) from an instance's keyring (rotate-out). Appends a `revoked` event; the verifier stops accepting it. Exit 2 if the key is not currently active. DEC-079."
  },
  {
    verb: "nhi report",
    outputShape: "resource",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "long-lived-days"],
    description:
      "Derive a Non-Human-Identity posture (OWASP NHI Top 10 / NIST CSF) from the registry: per-risk findings (NHI1 offboarding, NHI4 auth, NHI5 over-privilege, NHI7 long-lived keys, NHI9 reuse) + a summary. Read-only. DEC-087."
  },
  {
    verb: "nhi inventory",
    outputShape: "resource",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "long-lived-days"],
    description:
      "Per-identity inventory of the NHI estate: each instance with its active keys (fingerprint, age, long-lived flag, reuse across instances), its subagents (status, capability bound) and its offboard state, plus estate totals. Read-only. DEC-090."
  },
  {
    verb: "nhi export",
    outputShape: "resource",
    exitCodes: [0, 1],
    requiredFlags: ["instance", "trust-domain"],
    optionalFlags: ["root"],
    description:
      "Export an instance's active public keys as a SPIFFE-trust-bundle / JWKS-shaped object (NHI P3 interop, DEC-094): the first interop primitive from the veille. Carries trust-anchor material in a bundle shape; PEM→JWK/SVID + live endpoint stay in an external connector. Exit 1 on an invalid trust domain. DEC-094."
  },
  {
    verb: "nhi attest",
    outputShape: "resource",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance", "private-key"],
    optionalFlags: ["root", "role", "scope"],
    description:
      "Emit a signed attestation of the current NHI posture: an ed25519-signed `event` envelope (DEC-073) whose body carries the posture report. No new artifact kind. Actor role/scope default to the instance's registration. DEC-087."
  },
  {
    verb: "nhi offboard",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance"],
    optionalFlags: ["root", "reason"],
    description:
      "Coordinated decommission of an NHI: revoke every active key (DEC-079) and every active subagent (DEC-072) of the instance, then append an offboard tombstone. Idempotent (re-running revokes only what is still active). Exit 2 if the instance is not registered. DEC-089."
  },
  {
    verb: "org validate",
    outputShape: "action",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["file"],
    description:
      "Parse the committed org manifest (`--file`, default `org.h2a.yaml` in cwd; block-YAML subset or JSON) and check the h2a invariants (a PRINCIPAL exists, unique instances, canonical roles, every instance scoped, comm edges reference declared instances). Prints `{ ok, errors }`; exit 1 on a parse error or an invalid manifest, exit 3 if the file is unreadable. Read-only. EVO-7 slice 2, DEC-109."
  },
  {
    verb: "org show",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["file"],
    description:
      "Print the normalized org manifest (scope, version, instances, comm edges) with its `validation` result. Exit 1 on a parse error, exit 3 if unreadable. Read-only. EVO-7 slice 2, DEC-109."
  },
  {
    verb: "org diff",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["file", "root"],
    description:
      "Reconcile the declared org manifest against the live registry: `{ scope, matched, missing, undeclared, roleMismatch, scopeGaps, inSync }`. `inSync` is true iff the live estate matches the declared org exactly. Read-only — reports what provisioning would change, changes nothing. Exit 1 on a parse error, exit 3 if unreadable. EVO-7 slice 2, DEC-109."
  },
  {
    verb: "org provision",
    outputShape: "action",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["file", "root", "by"],
    description:
      "Apply a (ratified) org manifest to the live estate — **reconcile keyed-only**: for each declared instance already registered, append role/scope membership **grants** (append-only `org-membership.jsonl`, DEC-078-style; never a registration rewrite; idempotent). A declared-but-unregistered instance is reported under `pending` (needs key + register), never auto-stubbed. Returns `{ ok, scope, applied, unchanged, pending }`. Refuses an invalid manifest (exit 1), exit 3 if unreadable. EVO-7, DEC-109."
  },
  {
    verb: "coach propose",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: ["as"],
    optionalFlags: ["file", "role", "scope", "deliver", "root"],
    description:
      "Emit the *unsigned* `org-proposal` envelope for a validated manifest — the coach proposes, does not impose. `--as <coach-instance>` is the proposing coach (`--role`, default CONDUCTOR; `--scope`, default the manifest scope). `--deliver` also drops it into each declared instance's inbox so agents can have their say (counter). Refuses an invalid manifest (exit 1). EVO-7, DEC-109."
  },
  {
    verb: "coach ratify",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: ["as", "private-key"],
    optionalFlags: ["file", "role", "scope", "deliver", "root"],
    description:
      "The PRINCIPAL ratifies a proposed org: emits the `org-ratified` envelope for a valid manifest, ed25519-signed with `--private-key` as `--as` (`--role`, default PRINCIPAL; `--scope`, default the manifest scope) — verifiable with the standard `verifyEnvelopeSignature`. `--deliver` drops it into each declared instance's inbox. Refuses an invalid manifest (exit 1). Provision it with `h2a org provision`. EVO-7, DEC-109."
  },
  {
    verb: "blockage raise",
    outputShape: "action",
    exitCodes: [0, 1],
    requiredFlags: ["instance", "reason"],
    optionalFlags: ["root", "scope", "needs"],
    description:
      "Raise a blockage so peers in scope are notified (the EVO-3 feedback loop, distinct from the drumbeat stall and from escalation). Durable under `<root>/.h2a/blockage/`; the MCP dispatcher pushes `peer.blocked` to subscribed peers. DEC-092."
  },
  {
    verb: "blockage list",
    outputShape: "list",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "scope", "active", "instance"],
    description:
      "List recorded blockages (optionally filtered by `--scope` or `--active`). The polling path for hosts without a background daemon (e.g. agy). `--instance <id>` is the one-shot poll digest: only blockages in scopes that instance belongs to (effective org view, EVO-3/DEC-110). DEC-092."
  },
  {
    verb: "blockage resolve",
    outputShape: "action",
    exitCodes: [0, 1, 2],
    requiredFlags: ["instance"],
    optionalFlags: ["root", "by"],
    description:
      "Resolve a blockage (idempotent); the dispatcher then pushes `peer.unblocked`. Exit 2 if the instance has no blockage recorded. DEC-092."
  },
  {
    verb: "install-skills",
    outputShape: "action",
    exitCodes: [0, 1, 2, 3],
    requiredFlags: ["host"],
    optionalFlags: ["scope", "force"],
    description:
      "Install the h2a skill bundle into the host's skill directory. Claude/Codex receive SKILL.md files under `~/.<host>/skills/<name>/`; Gemini and agy receive TOML custom commands under `~/.gemini/commands/<name>.toml` (DEC-055) — agy shares the gemini location and the summary emits an `importHint` (`agy plugin import gemini`) since agy imports plugins from gemini/claude (DEC-101). `--scope user` (default) targets the home directory; `--scope project` targets `<cwd>/.<host>/`. Pre-existing files are skipped unless `--force` is set. DEC-054/055/096/101."
  },

  // --- deployment (DEC-058 / Scenario A of DEC-056) ---
  {
    verb: "deploy k8s-sidecar",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: ["instance", "host", "root", "image", "cli-version", "write"],
    description:
      "Render a Kubernetes sidecar fragment suitable for merging into a `remote` session Pod (Scenario A of DEC-056). Default `image` strategy is `npm-runtime` (uses `node:22-alpine` + `npm i -g @sentropic/h2a-cli` at Pod start). Pass an OCI reference to opt out of the runtime install. `--write <file>` switches to an `action` envelope and writes the fragment to disk; otherwise the YAML fragment is printed on stdout. DEC-058."
  },
  {
    verb: "deploy k8s-tenant",
    outputShape: "resource",
    exitCodes: [0, 1, 3],
    requiredFlags: [],
    optionalFlags: [
      "namespace",
      "root",
      "replicas",
      "storage",
      "storage-class",
      "lease-ms",
      "image",
      "cli-version",
      "write"
    ],
    description:
      "Render a complete Kubernetes cluster-tenant manifest (Namespace + ResourceQuota + ReadWriteMany PVC + Deployment) for Scenario B of DEC-056. The Deployment runs the store in lease-lock mode (`H2A_LOCK_MODE=lease`, DEC-065/066) so multiple Pods can safely share the RWX store. Default 2 replicas, `1Gi` storage, cluster-default StorageClass (pass `--storage-class` for an RWX-capable class). `--write <file>` switches to an `action` envelope and writes the manifest to disk; otherwise the multi-document YAML is printed on stdout. DEC-067."
  }
] as const;

/** Map of verb-path → contract for O(1) lookups in tests and tooling. */
export const H2A_CLI_VERB_CONTRACT_BY_VERB: ReadonlyMap<string, H2ACliVerbContract> = new Map(
  H2A_CLI_VERB_CONTRACTS.map((c) => [c.verb, c])
);

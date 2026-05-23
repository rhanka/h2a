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
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root", "from", "to", "dry-run"],
    description:
      "Migrate the local-files store schema between known versions (DEC-036). V1→V1 is a no-op (`changed:false`). Unknown --from or --to → exit 1."
  },

  // --- MCP transport ---
  {
    verb: "mcp-serve",
    outputShape: "stream",
    exitCodes: [0, 1],
    requiredFlags: [],
    optionalFlags: ["root"],
    description: "Run the built-in MCP server speaking JSON-RPC 2.0 over stdio (long-running)."
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
    optionalFlags: ["root", "instance"],
    description:
      "Bootstrap a coordinated session: ensures the local store under --root, picks an instance id, renders the host MCP snippet, and prints follow-up steps (key generation + skill install). DEC-054."
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
    verb: "install-skills",
    outputShape: "action",
    exitCodes: [0, 1, 2, 3],
    requiredFlags: ["host"],
    optionalFlags: ["scope", "force"],
    description:
      "Install the h2a skill bundle into the host's skill directory. Claude/Codex receive SKILL.md files under `~/.<host>/skills/<name>/`; Gemini receives TOML custom commands under `~/.gemini/commands/<name>.toml` (DEC-055). `--scope user` (default) targets the home directory; `--scope project` targets `<cwd>/.<host>/`. Pre-existing files are skipped unless `--force` is set. DEC-054/055."
  }
] as const;

/** Map of verb-path → contract for O(1) lookups in tests and tooling. */
export const H2A_CLI_VERB_CONTRACT_BY_VERB: ReadonlyMap<string, H2ACliVerbContract> = new Map(
  H2A_CLI_VERB_CONTRACTS.map((c) => [c.verb, c])
);

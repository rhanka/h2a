/**
 * `h2a` CLI dispatcher — stable JSON output contract + exit-code table (DEC-034).
 *
 * Output shapes
 * -------------
 * Every JSON-emitting verb writes ONE of three canonical envelopes on stdout:
 *
 * - **resource** — bare JSON of a single entity. Used by verbs that return the
 *   persisted/loaded record itself (`negotiate open`, `negotiate status`,
 *   `negotiate event`, `negotiate offer`, `negotiate counter`, `negotiate sign`,
 *   `inbox pop`, `host setup --print`).
 * - **list** — bare JSON array. Used by `hosts`, `mcp-tools`, `discover`,
 *   `inbox read`, `outbox read`, `negotiate journal`.
 * - **action** — `{ ok: true, ...details }` confirmation envelope. Used by
 *   verbs that perform side effects without a natural entity to return
 *   (`init`, `register`, `inbox put`, `outbox put`, `negotiate stabilize`,
 *   `host setup --write`).
 *
 * Stderr lines always follow `h2a <verb> [sub]: <message>` so callers can
 * grep them deterministically. The `mcp-serve` verb is a long-running
 * JSON-RPC 2.0 stdio transport and does not fit the envelope contract.
 *
 * Exit codes
 * ----------
 *
 * - `0` — success.
 * - `1` — user error: missing/bad flag, invalid JSON, validation failure on
 *   caller-supplied data, unknown verb/subverb/host.
 * - `2` — runtime/state error: store conflict or business-rule violation
 *   (negotiation not found, already open, already stabilized, signature
 *   fails verification, quorum incomplete, broken journal, divergent
 *   pre-existing config file refusing merge without `--force`).
 * - `3` — I/O / OS error: file unreadable, permission denied, write
 *   refused by the filesystem.
 *
 * The full machine-readable manifest lives in `./cli-contract.ts`
 * (`H2A_CLI_VERB_CONTRACTS`). Human-readable reference: `docs/cli-contract.md`.
 */

import { generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeHash,
  signCanonical,
  signEnvelope,
  subagentAddress,
  auditNhiPosture,
  nhiAttestationEnvelope,
  nhiInventory,
  nhiTrustBundle,
  H2A_ROLES,
  H2A_WORK_STATUSES
} from "@sentropic/h2a";
import type { H2ARole } from "@sentropic/h2a";

import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_AGY_HOST } from "./hosts/agy.js";
import { H2A_CLI_MCP_TOOL_NAMES } from "./mcp.js";
import {
  renderStopHook,
  claudeStopHookEntry,
  isH2ARecordHook,
  H2A_HOST_PLUGIN_HOSTS
} from "./hosts/plugin.js";
import {
  H2A_STORE_SCHEMA_VERSION,
  createLocalStore,
  listPresence,
  sanitizeStorePaths
} from "./runtime/local-files/index.js";
import { runMcpStdio } from "./runtime/mcp/index.js";
import { renderK8sSidecar } from "./runtime/deploy/k8s-sidecar.js";
import { renderK8sTenant } from "./runtime/deploy/k8s-tenant.js";
import { remoteServerForStore, sendRemoteEnvelope } from "./runtime/remote/index.js";
import {
  recordStop,
  scanDrumbeat,
  clearDrumbeatEntry,
  runDrumbeatWatch as runDrumbeatWatchLoop,
  loggingRelauncher,
  localTmuxRelauncher,
  headlessRelauncher,
  chainRelauncher,
  type H2ARelauncher,
  type H2ARelauncherKind
} from "./runtime/drumbeat/index.js";
import { gatherNhiSnapshot } from "./runtime/nhi.js";
import {
  raiseBlockage,
  listBlockages,
  resolveBlockage
} from "./runtime/blockage/index.js";
import {
  recordEscalation,
  listEscalations,
  clearEscalation
} from "./runtime/escalation/index.js";
import { verifyEnvelopeSysmlRef } from "./runtime/sysml/index.js";
import {
  checkUpgrade,
  performUpgrade,
  currentCliVersion,
  upgradeCachePath,
  canReexec,
  reexecSelf,
  H2A_REEXEC_GUARD_ENV,
  type UpgradeRuntime
} from "./runtime/upgrade/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// `dist/cli.js` lives in `packages/h2a-cli/dist/`; skills are at
// `packages/h2a-cli/skills/`. Two levels up from the dist file.
const SKILLS_DIR = resolvePath(HERE, "..", "skills");

/**
 * Pattern matchers used to map known store-level error messages to exit code
 * 2 (state/runtime conflict) instead of the default 1 (user error). Anything
 * not matched here keeps the conservative 1 — DEC-034 explicitly opts for
 * "don't over-promote".
 */
const STORE_STATE_ERROR_PATTERNS: readonly RegExp[] = [
  /already registered/i,
  /already open/i,
  /already stabilized/i,
  /not found/i,
  /no such envelope/i,
  /fails verification/i,
  /no artifactHash has the full quorum/i,
  /no offer\/counter event matches/i,
  /stabilized artifact already on disk/i,
  // DEC-069/070/072: subagent binding/routing/revocation preconditions.
  /not registered/i,
  /revoked/i,
  /key not active/i,
  /parent-not-agents/,
  /parent-instance-mismatch/,
  /capabilities-exceed-parent/
];

function classifyStoreError(message: string): 1 | 2 {
  for (const pattern of STORE_STATE_ERROR_PATTERNS) {
    if (pattern.test(message)) return 2;
  }
  return 1;
}

export interface H2ACliStreams {
  stderr: Pick<typeof process.stderr, "write">;
  stdout: Pick<typeof process.stdout, "write">;
  cwd?: () => string;
}

const CLI_HOSTS = [
  H2A_CODEX_HOST,
  H2A_CLAUDE_HOST,
  H2A_GEMINI_HOST,
  H2A_AGY_HOST
] as const;

export function renderCliHelp(): string {
  return [
    "h2a",
    "",
    "Human-to-agent coordination CLI.",
    "",
    "Usage:",
    "  h2a --help",
    "  h2a hosts",
    "  h2a mcp-tools",
    "  h2a init [--root <path>]",
    "  h2a register --json <json> [--root <path>]",
    "  h2a discover [--role <role>] [--scope <scope>] [--root <path>]",
    "  h2a subagent register --parent <instance> --name <name> [--capabilities a,b] [--root <path>]",
    "  h2a subagent list [--parent <instance>] [--root <path>]",
    "  h2a subagent route --to <subagent-address> --json <envelope> [--mailbox inbox|outbox] [--root <path>]",
    "  h2a subagent inbox --parent <instance> [--root <path>]",
    "  h2a subagent audit (--id <subagent-address> | --parent <instance>) [--root <path>]",
    "  h2a subagent revoke --id <subagent-address> [--reason <text>] [--root <path>]",
    "  h2a negotiate open --json <record-json> [--root <path>]",
    "  h2a negotiate status --id <id> --status <status> [--root <path>]",
    "  h2a negotiate event --id <id> --json <payload-json> [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]",
    "  h2a negotiate journal --id <id> [--root <path>]",
    "",
    "Auto-propagation (DEC-033):",
    "  offer/counter/sign/event inherit causationId from the previous journal",
    "  entry's id, and correlationId from the previous entry's correlationId.",
    "  Explicit --causation-id / --correlation-id flags always override the",
    "  inherited default; pass them on the first offer to start a fresh thread.",
    "  h2a inbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a inbox read --instance <id> [--root <path>]",
    "  h2a inbox pop --instance <id> --envelope <id> [--root <path>]",
    "  h2a outbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a outbox read --instance <id> [--root <path>]",
    "  h2a mcp-serve [--root <path>] [--auto-open [--host <h>] [--instance <id>] [--scope <s>]] [--upgrade-check | --auto-upgrade [--no-restart]]   (--auto-open joins the bus at startup; --auto-upgrade self-updates + restarts in place; --upgrade-check = notice only; both opt-in/no network by default; /h2a disconnect to leave)",
    "  h2a upgrade [--check]   (--check: report current vs latest; bare: npm i -g @sentropic/h2a-cli@latest)",
    "  h2a remote serve [--port <n>] [--host <h>] [--path </h2a/envelopes>] [--root <path>]",
    "  h2a remote send --url <u> --instance <signer> --private-key <pem> --json <envelope>",
    "  h2a drumbeat record --instance <id> --status <working|paused|done|blocked|out-of-tokens> [--command <c>] [--resume-command <c>] [--tmux-session <s> --tmux-pane <p>] [--root <path>]",
    "  h2a drumbeat scan [--max-relances <n>] [--root <path>]",
    "  h2a drumbeat clear --instance <id> [--root <path>]",
    "  h2a drumbeat escalations [--root <path>]",
    "  h2a drumbeat watch [--interval-ms <n>] [--max-relances <n>] [--relauncher logging|local-tmux|headless|auto] [--root <path>]",
    "  h2a host setup --host <codex|claude|gemini|agy> [--root <path>] [--print | --write <file>] [--force]",
    "  h2a host status [--host <name>]",
    "  h2a host plugin --host <codex|claude|gemini|agy> --instance <id> [--status <work-status>] [--root <path>] [--write <settings.json> [--force]]   (--write installs the Stop hook for claude|gemini|codex; agy is poll-only)",
    "  h2a store migrate [--from <v>] [--to <v>] [--sanitize-paths] [--dry-run] [--root <path>]",
    "",
    "High-level coordination (DEC-054):",
    "  h2a connect --host <codex|claude|gemini|agy> [--root <path>] [--instance <id>]",
    "  h2a doctor [--root <path>]",
    "  h2a sessions [--root <path>] [--scope <s>] [--instance <i>]",
    "  h2a keys generate --instance <id> [--out <dir>] [--root <path>]",
    "  h2a keys add --instance <id> --public-key <pem-file> [--root <path>]",
    "  h2a keys list --instance <id> [--root <path>]",
    "  h2a keys revoke --instance <id> --public-key <pem-file> [--root <path>]",
    "  h2a nhi report [--long-lived-days <n>] [--root <path>]",
    "  h2a nhi inventory [--long-lived-days <n>] [--root <path>]",
    "  h2a nhi attest --instance <id> --private-key <pem-file> [--role <role>] [--scope <scope>] [--root <path>]",
    "  h2a nhi offboard --instance <id> [--reason <text>] [--root <path>]",
    "  h2a nhi export --instance <id> --trust-domain <domain> [--root <path>]",
    "  h2a blockage raise --instance <id> --reason <text> [--scope <s>] [--needs <text>] [--root <path>]",
    "  h2a blockage list [--scope <s>] [--active] [--root <path>]",
    "  h2a blockage resolve --instance <id> [--by <id>] [--root <path>]",
    "  h2a sysml verify --json <envelope> --public-key <pem-file> [--by <id>] [--content-integrity --api-base <url> [--auth <token>]]",
    "  h2a install-skills --host <claude|codex|gemini|agy> [--scope user|project] [--force]",
    "  h2a deploy k8s-sidecar [--instance <id>] [--host <h>] [--root <path>] [--image <ref>] [--cli-version <ver>] [--write <file>]",
    "  h2a deploy k8s-tenant [--namespace <ns>] [--root <path>] [--replicas <n>] [--storage <size>] [--storage-class <sc>] [--lease-ms <ms>] [--image <ref>] [--cli-version <ver>] [--write <file>]",
    "",
    `Hosts: ${CLI_HOSTS.map((host) => host.host).join(", ")}`,
    `MCP tools: ${H2A_CLI_MCP_TOOL_NAMES.join(", ")}`
  ].join("\n");
}

interface ParsedFlags {
  command: string | undefined;
  flags: Record<string, string>;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

function resolveRoot(flags: Record<string, string>, cwd: () => string): string {
  if (flags.root) return flags.root;
  return join(cwd(), ".h2a");
}

/**
 * Resolve `causationId` / `correlationId` for a new negotiation event.
 *
 * - Explicit `--causation-id` / `--correlation-id` flags always win.
 * - Otherwise, the values are inherited from the **previous journal entry**
 *   on the same negotiation (DEC-033): `causationId` defaults to the previous
 *   entry's `id`, `correlationId` is propagated as-is so the whole negotiation
 *   acts as a single correlation thread by default.
 */
function resolveCausationCorrelation(
  flags: Record<string, string>,
  previous: { id: string; correlationId?: string } | undefined
): { causationId?: string; correlationId?: string } {
  const explicitCausation = flags["causation-id"];
  const explicitCorrelation = flags["correlation-id"];
  const out: { causationId?: string; correlationId?: string } = {};
  if (explicitCausation) {
    out.causationId = explicitCausation;
  } else if (previous) {
    out.causationId = previous.id;
  }
  if (explicitCorrelation) {
    out.correlationId = explicitCorrelation;
  } else if (previous && previous.correlationId !== undefined) {
    out.correlationId = previous.correlationId;
  }
  return out;
}

function cmdInit(flags: Record<string, string>, streams: H2ACliStreams): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  try {
    const store = createLocalStore({ root });
    streams.stdout.write(
      `${JSON.stringify({ ok: true, root: store.paths.root }, null, 2)}\n`
    );
    return 0;
  } catch (error) {
    // `createLocalStore` is the one place this verb can fail, and the only
    // failure mode in practice is filesystem-level (cannot mkdir under root,
    // permission denied, …). Surface those as exit code 3.
    streams.stderr.write(`h2a init: ${(error as Error).message}\n`);
    return 3;
  }
}

function cmdRegister(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.json) {
    streams.stderr.write("h2a register: --json <registration-json> is required\n");
    return 1;
  }
  let registration;
  try {
    registration = JSON.parse(flags.json);
  } catch (error) {
    streams.stderr.write(`h2a register: invalid JSON (${(error as Error).message})\n`);
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  try {
    store.registerInstance(registration);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a register: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, id: registration.id, root: store.paths.root }, null, 2)}\n`
  );
  return 0;
}

function cmdSubagent(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  // DEC-068 (V2): manage addressable subagent bindings under a parent AGENTS
  // instance. `register` constructs + persists a binding; `list` enumerates.
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (sub === "list") {
    const entries = flags.parent
      ? store.listSubagentsOf(flags.parent)
      : store.listSubagents();
    // DEC-072: annotate each binding with its derived lifecycle status.
    const annotated = entries.map((b) => ({
      ...b,
      status: store.subagentStatus(b.id)
    }));
    streams.stdout.write(`${JSON.stringify(annotated, null, 2)}\n`);
    return 0;
  }

  if (sub === "revoke") {
    if (!flags.id) {
      streams.stderr.write("h2a subagent revoke: --id <subagent-address> is required\n");
      return 1;
    }
    try {
      store.revokeSubagent(flags.id, flags.reason);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent revoke: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: flags.id, status: "revoked", ...(flags.reason ? { reason: flags.reason } : {}) }, null, 2)}\n`
    );
    return 0;
  }

  if (sub === "route") {
    if (!flags.to || !flags.json) {
      streams.stderr.write(
        "h2a subagent route: --to <subagent-address> and --json <envelope-json> are required\n"
      );
      return 1;
    }
    const mailbox = flags.mailbox === "outbox" ? "outbox" : "inbox";
    if (flags.mailbox && flags.mailbox !== "inbox" && flags.mailbox !== "outbox") {
      streams.stderr.write(
        `h2a subagent route: --mailbox must be inbox or outbox (got "${flags.mailbox}")\n`
      );
      return 1;
    }
    let envelope;
    try {
      envelope = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a subagent route: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    try {
      store.routeToSubagent(flags.to, envelope, mailbox);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent route: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: envelope.id, to: flags.to, mailbox }, null, 2)}\n`
    );
    return 0;
  }

  if (sub === "inbox") {
    if (!flags.parent) {
      streams.stderr.write("h2a subagent inbox: --parent <instance> is required\n");
      return 1;
    }
    const fanIn = store.readSubagentInboxes(flags.parent);
    streams.stdout.write(`${JSON.stringify(fanIn, null, 2)}\n`);
    return 0;
  }

  if (sub === "audit") {
    if (!flags.id && !flags.parent) {
      streams.stderr.write(
        "h2a subagent audit: --id <subagent-address> or --parent <instance> is required\n"
      );
      return 1;
    }
    const events = flags.id
      ? store.readSubagentAudit(flags.id)
      : store.readSubagentAuditOf(flags.parent);
    streams.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
    return 0;
  }

  if (sub === "register") {
    if (!flags.parent || !flags.name) {
      streams.stderr.write(
        "h2a subagent register: --parent <instance> and --name <name> are required\n"
      );
      return 1;
    }
    const capabilities = flags.capabilities
      ? flags.capabilities.split(",").map((c) => c.trim()).filter((c) => c.length > 0)
      : undefined;
    const binding = {
      id: subagentAddress(flags.parent, flags.name),
      parentInstance: flags.parent,
      name: flags.name,
      ...(capabilities ? { capabilities } : {}),
      createdAt: new Date().toISOString()
    };
    try {
      store.registerSubagent(binding);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent register: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: binding.id, parentInstance: binding.parentInstance, root: store.paths.root }, null, 2)}\n`
    );
    return 0;
  }

  streams.stderr.write(
    `h2a subagent: subcommand required (supported: register, list, route, inbox, audit, revoke)\n`
  );
  return 1;
}

function cmdMailbox(
  argv: readonly string[],
  mailbox: "inbox" | "outbox",
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (!flags.instance) {
    streams.stderr.write(`h2a ${mailbox} ${sub ?? ""}: --instance <id> required\n`);
    return 1;
  }

  if (sub === "put") {
    if (!flags.json) {
      streams.stderr.write(`h2a ${mailbox} put: --json <envelope-json> required\n`);
      return 1;
    }
    let envelope;
    try {
      envelope = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a ${mailbox} put: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    try {
      if (mailbox === "inbox") {
        store.putInboxMessage(flags.instance, envelope);
      } else {
        store.putOutboxMessage(flags.instance, envelope);
      }
      streams.stdout.write(
        `${JSON.stringify({ ok: true, id: envelope.id, mailbox, instance: flags.instance }, null, 2)}\n`
      );
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a ${mailbox} put: ${message}\n`);
      // Envelope-shape failures are user/validation errors (exit 1); only
      // state-level conflicts escalate to exit 2 (none currently emitted here,
      // but the classifier keeps the door open).
      return classifyStoreError(message);
    }
  }

  if (sub === "read") {
    const messages =
      mailbox === "inbox" ? store.readInbox(flags.instance) : store.readOutbox(flags.instance);
    streams.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
    return 0;
  }

  if (sub === "pop" && mailbox === "inbox") {
    if (!flags.envelope) {
      streams.stderr.write("h2a inbox pop: --envelope <id> required\n");
      return 1;
    }
    const popped = store.popInboxMessage(flags.instance, flags.envelope);
    if (!popped) {
      streams.stderr.write(`h2a inbox pop: no such envelope ${flags.envelope}\n`);
      // State conflict against the local store (the envelope is not where the
      // caller expected it). Exit code 2 per DEC-034.
      return 2;
    }
    streams.stdout.write(`${JSON.stringify(popped, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(`Unknown ${mailbox} subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write(
    mailbox === "inbox" ? "Use one of: put, read, pop\n" : "Use one of: put, read\n"
  );
  return 1;
}

function cmdNegotiate(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (sub === "open") {
    if (!flags.json) {
      streams.stderr.write("h2a negotiate open: --json <record-json> required\n");
      return 1;
    }
    let record;
    try {
      record = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a negotiate open: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    try {
      const opened = store.openNegotiation(record);
      streams.stdout.write(`${JSON.stringify(opened, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate open: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "status") {
    if (!flags.id || !flags.status) {
      streams.stderr.write("h2a negotiate status: --id <id> and --status <status> required\n");
      return 1;
    }
    try {
      const updated = store.updateNegotiationStatus(
        flags.id,
        flags.status as Parameters<typeof store.updateNegotiationStatus>[1]
      );
      streams.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate status: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "offer" || sub === "counter") {
    if (!flags.id || !flags.instance || !flags.artifact) {
      streams.stderr.write(
        `h2a negotiate ${sub}: --id <id> --instance <id> --artifact <json> required\n`
      );
      return 1;
    }
    const record = store.readNegotiation(flags.id);
    if (!record) {
      streams.stderr.write(`h2a negotiate ${sub}: negotiation ${flags.id} not found\n`);
      return 2;
    }
    let artifact;
    try {
      artifact = JSON.parse(flags.artifact);
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate ${sub}: invalid --artifact JSON (${(error as Error).message})\n`
      );
      return 1;
    }
    const existing = store.readNegotiationJournal(flags.id);
    const previous = existing[existing.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const chain = resolveCausationCorrelation(flags, previous);
    const payload = {
      id: flags["event-id"] ?? `evt-${Date.now().toString(36)}`,
      type: sub === "offer" ? "propose" : "counter",
      actor: { instance: flags.instance, role: "CONDUCTOR", scope: record.scope },
      body: { artifact },
      createdAt: new Date().toISOString(),
      ...chain
    } as const;
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate ${sub}: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "sign") {
    if (!flags.id || !flags.instance || !flags.artifact || !flags["private-key"]) {
      streams.stderr.write(
        "h2a negotiate sign: --id <id> --instance <id> --artifact <json> --private-key <pem-path> required\n"
      );
      return 1;
    }
    const record = store.readNegotiation(flags.id);
    if (!record) {
      streams.stderr.write(`h2a negotiate sign: negotiation ${flags.id} not found\n`);
      return 2;
    }
    let artifact;
    try {
      artifact = JSON.parse(flags.artifact);
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate sign: invalid --artifact JSON (${(error as Error).message})\n`
      );
      return 1;
    }
    let privateKeyPem;
    try {
      privateKeyPem = readFileSync(flags["private-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate sign: cannot read private key at ${flags["private-key"]} (${(error as Error).message})\n`
      );
      // File/OS error — exit code 3 per DEC-034.
      return 3;
    }
    const artifactHash = computeHash(artifact);
    const signature = signCanonical({ artifactHash }, { by: flags.instance, privateKeyPem });
    const existingForSign = store.readNegotiationJournal(flags.id);
    const previousForSign = existingForSign[existingForSign.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const signChain = resolveCausationCorrelation(flags, previousForSign);
    const payload = {
      id: flags["event-id"] ?? `evt-sign-${Date.now().toString(36)}`,
      type: "event" as const,
      actor: { instance: flags.instance, role: "CONDUCTOR" as const, scope: record.scope },
      body: { kind: "signature", artifactHash, signature },
      createdAt: new Date().toISOString(),
      ...signChain
    };
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate sign: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "stabilize") {
    if (!flags.id) {
      streams.stderr.write("h2a negotiate stabilize: --id <id> required\n");
      return 1;
    }
    try {
      const result = store.stabilizeNegotiation(flags.id, { eventId: flags["event-id"] });
      streams.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            record: result.record,
            artifactHash: result.artifactHash,
            signers: result.signers,
            artifactPath: result.artifactPath,
            finalEvent: { id: result.finalEvent.id, sequence: result.finalEvent.sequence }
          },
          null,
          2
        )}\n`
      );
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate stabilize: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "event") {
    if (!flags.id || !flags.json) {
      streams.stderr.write("h2a negotiate event: --id <id> and --json <payload-json> required\n");
      return 1;
    }
    let payload;
    try {
      payload = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a negotiate event: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    const existingForEvent = store.readNegotiationJournal(flags.id);
    const previousForEvent = existingForEvent[existingForEvent.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const eventChain = resolveCausationCorrelation(flags, previousForEvent);
    // Explicit fields inside the user-supplied payload always take precedence
    // over the CLI-resolved defaults: this preserves the existing "just append
    // whatever JSON I gave you" contract while still adding the chain when the
    // user did not opt in.
    payload = { ...eventChain, ...payload };
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate event: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "journal") {
    if (!flags.id) {
      streams.stderr.write("h2a negotiate journal: --id <id> required\n");
      return 1;
    }
    try {
      const entries = store.readNegotiationJournal(flags.id);
      streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate journal: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  streams.stderr.write(`Unknown negotiate subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use one of: open, status, event, offer, counter, sign, stabilize, journal\n");
  return 1;
}

/**
 * `h2a mcp-serve` binds directly to the real process std streams because it
 * is a long-running JSON-RPC loop. The test-friendly `streams` interface
 * (write-only) cannot express a readable stdin; tests cover `runMcpStdio`
 * with `PassThrough` streams instead of going through this verb.
 */
/**
 * DEC-105 (EVO-6): resolve the auto-open session config from `mcp-serve` flags.
 * `--auto-open` enables it; the instance is `--instance <id>` or, if absent,
 * `<host>:<cwd-leaf>` (host = `--host` or "agent"). Pure + total so it can be
 * unit-tested without spawning the server. Returns undefined when not enabled.
 */
export function resolveAutoOpen(
  flags: Record<string, string>,
  cwd: () => string
): { instance: string; host?: string; scopes?: string[] } | undefined {
  if (flags["auto-open"] === undefined) return undefined;
  const host = flags.host;
  const leaf = (cwd().split("/").filter(Boolean).pop() || "workspace");
  const instance = flags.instance ?? `${host ?? "agent"}:${leaf}`;
  return {
    instance,
    ...(host ? { host } : {}),
    ...(flags.scope ? { scopes: [flags.scope] } : {})
  };
}

/**
 * `h2a upgrade [--check]` (DEC-107, EVO-8 level 1): explicit self-upgrade.
 * `--check` reports current vs latest (no install); bare runs the global
 * install of `@latest`. Sync (spawnSync). `runtime` is injectable for tests.
 */
export function cmdUpgrade(
  flags: Record<string, string>,
  streams: H2ACliStreams,
  runtime?: UpgradeRuntime
): number {
  const current = currentCliVersion();
  if (flags.check !== undefined) {
    const result = checkUpgrade(current, { ...(runtime ? { runtime } : {}), force: true });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const result = checkUpgrade(current, { ...(runtime ? { runtime } : {}), force: true });
  if (!result.upgradeAvailable) {
    streams.stdout.write(
      `${JSON.stringify({ ok: true, current, latest: result.latest ?? current, upgraded: false, reason: "already current or registry unreachable" }, null, 2)}\n`
    );
    return 0;
  }
  const ok = performUpgrade(runtime);
  streams.stdout.write(
    `${JSON.stringify({ ok, current, latest: result.latest, upgraded: ok, package: "@sentropic/h2a-cli" }, null, 2)}\n`
  );
  if (!ok) {
    streams.stderr.write(
      "h2a upgrade: global install failed — run `npm i -g @sentropic/h2a-cli@latest` manually (or check your install method).\n"
    );
    return 1;
  }
  return 0;
}

export async function runMcpServe(
  flags: Record<string, string>,
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
  } = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const autoOpen = resolveAutoOpen(flags, cwd);

  // DEC-107/108 (EVO-8 levels 2/3): version handling at boot. **Opt-in** — no
  // network on a default boot. `--auto-upgrade` self-installs @latest then
  // re-execs in place via process.execve (same PID/stdio, host stays connected;
  // falls back to next-launch where execve is unavailable or `--no-restart`).
  // `--upgrade-check` (notice only) prints a cached, bounded availability hint.
  // The H2A_REEXEC_GUARD_ENV flag (set across the re-exec) prevents a re-loop.
  const wantAutoUpgrade = flags["auto-upgrade"] !== undefined;
  const wantCheckOnly = flags["upgrade-check"] !== undefined;
  if (
    (wantAutoUpgrade || wantCheckOnly) &&
    process.env[H2A_REEXEC_GUARD_ENV] === undefined
  ) {
    try {
      const current = currentCliVersion();
      const result = checkUpgrade(current, { cachePath: upgradeCachePath(root) });
      if (result.upgradeAvailable) {
        if (wantAutoUpgrade) {
          const ok = performUpgrade();
          if (ok && flags["no-restart"] === undefined && canReexec()) {
            io.stderr.write(
              `h2a mcp-serve: auto-upgraded ${current} → ${result.latest}; restarting into the new version…\n`
            );
            reexecSelf(); // on success the image is replaced (never returns)
          }
          io.stderr.write(
            ok
              ? `h2a mcp-serve: auto-upgraded ${current} → ${result.latest} (applies on next launch)\n`
              : `h2a mcp-serve: auto-upgrade to ${result.latest} failed; staying on ${current}\n`
          );
        } else {
          io.stderr.write(
            `h2a mcp-serve: h2a ${result.latest} available (current ${current}) — run \`h2a upgrade\`\n`
          );
        }
      }
    } catch {
      // best-effort: a check/upgrade failure must never block serving.
    }
  }

  try {
    await runMcpStdio({
      root,
      stdin: io.stdin as never,
      stdout: io.stdout as never,
      stderr: io.stderr as never,
      ...(autoOpen ? { autoOpen } : {})
    });
    return 0;
  } catch (err) {
    io.stderr.write(`h2a mcp-serve: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * `h2a remote serve` (DEC-077): long-running HTTP listener that authenticates
 * POSTed envelopes against the store registry and delivers them to local
 * inboxes. Async + blocking, so it is dispatched from bin.ts (like mcp-serve),
 * not the synchronous runCli. Binds 127.0.0.1 by default — never expose to all
 * interfaces implicitly; pass `--host 0.0.0.0` to opt in.
 */
export async function runRemoteServe(
  flags: Record<string, string>,
  io: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    onListening?: (server: import("node:http").Server) => void;
  } = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const host = flags.host ?? "127.0.0.1";
  const port = flags.port ? Number.parseInt(flags.port, 10) : 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`h2a remote serve: invalid --port "${flags.port}"\n`);
    return 1;
  }
  let store;
  try {
    store = createLocalStore({ root });
  } catch (error) {
    io.stderr.write(`h2a remote serve: ${(error as Error).message}\n`);
    return 1;
  }
  const server = remoteServerForStore(store, { path: flags.path });
  return await new Promise<number>((resolve) => {
    server.on("error", (err) => {
      io.stderr.write(`h2a remote serve: ${err.message}\n`);
      resolve(1);
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      io.stdout.write(
        `h2a remote serve: listening on http://${host}:${boundPort}${flags.path ?? "/h2a/envelopes"} (root ${root})\n`
      );
      io.onListening?.(server);
    });
    server.on("close", () => resolve(0));
  });
}

/**
 * `h2a remote send` (DEC-077): sign an envelope and POST it to a remote h2a
 * endpoint. Async (network), so dispatched from bin.ts. Exit 0 on a 2xx,
 * 1 otherwise; prints `{ status, body }`.
 */
export async function runRemoteSend(
  flags: Record<string, string>,
  streams: H2ACliStreams = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  if (!flags.url || !flags.instance || !flags["private-key"] || !flags.json) {
    streams.stderr.write(
      "h2a remote send: --url, --instance, --private-key and --json are required\n"
    );
    return 1;
  }
  let envelope;
  try {
    envelope = JSON.parse(flags.json);
  } catch (error) {
    streams.stderr.write(`h2a remote send: invalid --json (${(error as Error).message})\n`);
    return 1;
  }
  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(flags["private-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a remote send: cannot read --private-key (${(error as Error).message})\n`
    );
    return 1;
  }
  let result;
  try {
    result = await sendRemoteEnvelope(flags.url, envelope, {
      by: flags.instance,
      privateKeyPem
    });
  } catch (error) {
    streams.stderr.write(`h2a remote send: ${(error as Error).message}\n`);
    return 1;
  }
  streams.stdout.write(`${JSON.stringify({ status: result.status, body: result.body }, null, 2)}\n`);
  return result.status >= 200 && result.status < 300 ? 0 : 1;
}

function cmdDrumbeat(argv: readonly string[], streams: H2ACliStreams): number {
  // DEC-086 (D2): durable anti-stall registry — record stops, scan candidates,
  // clear. The long-running `watch` daemon is async (dispatched from bin.ts).
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "record") {
    if (!flags.instance || !flags.status) {
      streams.stderr.write("h2a drumbeat record: --instance <id> and --status <work-status> are required\n");
      return 1;
    }
    if (!(H2A_WORK_STATUSES as readonly string[]).includes(flags.status)) {
      streams.stderr.write(
        `h2a drumbeat record: --status must be one of ${H2A_WORK_STATUSES.join("|")} (got "${flags.status}")\n`
      );
      return 1;
    }
    const launchContext = flags.command
      ? {
          cwd: flags.cwd ?? cwd(),
          command: flags.command,
          ...(flags["resume-command"] ? { resumeCommand: flags["resume-command"] } : {}),
          ...(flags.tty ? { tty: flags.tty } : {}),
          ...(flags["tmux-session"] && flags["tmux-pane"]
            ? { tmux: { session: flags["tmux-session"], pane: flags["tmux-pane"], ...(flags["tmux-window"] ? { window: flags["tmux-window"] } : {}) } }
            : {})
        }
      : undefined;
    const entry = recordStop(root, {
      instance: flags.instance,
      workStatus: flags.status as (typeof H2A_WORK_STATUSES)[number],
      ...(launchContext ? { launchContext } : {})
    });
    streams.stdout.write(`${JSON.stringify({ ok: true, instance: entry.instance, workStatus: entry.workStatus }, null, 2)}\n`);
    return 0;
  }

  if (sub === "scan") {
    const maxRelances = flags["max-relances"] ? Number.parseInt(flags["max-relances"], 10) : undefined;
    const result = scanDrumbeat(root, maxRelances !== undefined ? { maxRelances } : {});
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (sub === "clear") {
    if (!flags.instance) {
      streams.stderr.write("h2a drumbeat clear: --instance <id> is required\n");
      return 1;
    }
    clearDrumbeatEntry(root, flags.instance);
    // DEC-095 (D7): a clean resume/finish also clears any open escalation.
    clearEscalation(root, flags.instance);
    streams.stdout.write(`${JSON.stringify({ ok: true, instance: flags.instance, cleared: true }, null, 2)}\n`);
    return 0;
  }

  if (sub === "escalations") {
    // DEC-095 (D7): the open escalations the daemon raised on relance-exhaustion.
    streams.stdout.write(`${JSON.stringify(listEscalations(root), null, 2)}\n`);
    return 0;
  }

  streams.stderr.write("h2a drumbeat: subcommand required (record, scan, clear, escalations, watch)\n");
  return 1;
}

/**
 * `h2a blockage` (DEC-092, EVO-3): the peer-facing blockage feedback loop —
 * distinct from the drumbeat (silent stall) and escalation (→ authority). Raise
 * a blockage so peers in scope are notified (`peer.blocked` push); resolve it
 * when unblocked (`peer.unblocked`).
 */
function cmdBlockage(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "raise") {
    if (!flags.instance || !flags.reason) {
      streams.stderr.write("h2a blockage raise: --instance <id> and --reason <text> are required\n");
      return 1;
    }
    const blockage = raiseBlockage(root, {
      instance: flags.instance,
      scope: flags.scope ?? "",
      reason: flags.reason,
      ...(flags.needs ? { needs: flags.needs } : {})
    });
    streams.stdout.write(`${JSON.stringify({ ok: true, ...blockage }, null, 2)}\n`);
    return 0;
  }

  if (sub === "list") {
    let blockages = listBlockages(root);
    if (flags.scope) blockages = blockages.filter((b) => b.scope === flags.scope);
    if (flags.active !== undefined) blockages = blockages.filter((b) => b.resolvedAt === undefined);
    streams.stdout.write(`${JSON.stringify(blockages, null, 2)}\n`);
    return 0;
  }

  if (sub === "resolve") {
    if (!flags.instance) {
      streams.stderr.write("h2a blockage resolve: --instance <id> is required\n");
      return 1;
    }
    const resolved = resolveBlockage(root, flags.instance, flags.by ? { by: flags.by } : {});
    if (!resolved) {
      streams.stderr.write(`h2a blockage resolve: no blockage recorded for "${flags.instance}"\n`);
      return 2;
    }
    streams.stdout.write(`${JSON.stringify({ ok: true, ...resolved }, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(`h2a blockage: unknown subcommand "${sub ?? ""}" (raise, list, resolve)\n`);
  return 1;
}

/**
 * `h2a nhi` (DEC-087): Non-Human-Identity posture over the local registry. P1
 * ships `report` — derive the OWASP NHI Top 10 / NIST CSF posture from
 * instances, subagent bindings and the keyring. See evaluations/nhi.md.
 */
function cmdNhi(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());

  if (sub === "report") {
    let longLivedKeyMaxDays: number | undefined;
    if (flags["long-lived-days"] !== undefined) {
      longLivedKeyMaxDays = Number.parseInt(flags["long-lived-days"], 10);
      if (!Number.isInteger(longLivedKeyMaxDays) || longLivedKeyMaxDays < 1) {
        streams.stderr.write(
          `h2a nhi report: --long-lived-days must be a positive integer (got "${flags["long-lived-days"]}")\n`
        );
        return 1;
      }
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(longLivedKeyMaxDays !== undefined ? { longLivedKeyMaxDays } : {})
    });
    streams.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  if (sub === "inventory") {
    let longLivedKeyMaxDays: number | undefined;
    if (flags["long-lived-days"] !== undefined) {
      longLivedKeyMaxDays = Number.parseInt(flags["long-lived-days"], 10);
      if (!Number.isInteger(longLivedKeyMaxDays) || longLivedKeyMaxDays < 1) {
        streams.stderr.write(
          `h2a nhi inventory: --long-lived-days must be a positive integer (got "${flags["long-lived-days"]}")\n`
        );
        return 1;
      }
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const { instances, subagents, keyEvents, offboards } = gatherNhiSnapshot(store);
    const inventory = nhiInventory({
      instances,
      subagents,
      keyEvents,
      offboards,
      ...(longLivedKeyMaxDays !== undefined ? { longLivedKeyMaxDays } : {})
    });
    streams.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return 0;
  }

  if (sub === "export") {
    if (!flags.instance || !flags["trust-domain"]) {
      streams.stderr.write(
        "h2a nhi export: --instance <id> and --trust-domain <domain> are required\n"
      );
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const activeKeys = store.listInstanceKeys(flags.instance);
    try {
      const bundle = nhiTrustBundle({
        instance: flags.instance,
        trustDomain: flags["trust-domain"],
        activeKeys
      });
      streams.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a nhi export: ${(error as Error).message}\n`);
      return 1;
    }
  }

  if (sub === "attest") {
    if (!flags.instance || !flags["private-key"]) {
      streams.stderr.write(
        "h2a nhi attest: --instance <id> and --private-key <pem-file> are required\n"
      );
      return 1;
    }
    let privateKeyPem: string;
    try {
      privateKeyPem = readFileSync(flags["private-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a nhi attest: cannot read --private-key (${(error as Error).message})\n`
      );
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const registration = store.findInstance(flags.instance);
    const role = flags.role ?? registration?.roles?.[0];
    const scope = flags.scope ?? registration?.scopes?.[0];
    if (!role || !scope) {
      streams.stderr.write(
        `h2a nhi attest: cannot resolve actor for "${flags.instance}" — register it first, or pass --role and --scope\n`
      );
      return 2;
    }
    if (!(H2A_ROLES as readonly string[]).includes(role)) {
      streams.stderr.write(
        `h2a nhi attest: --role must be one of ${H2A_ROLES.join("|")} (got "${role}")\n`
      );
      return 1;
    }
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({ instances, subagents, keyEvents });
    const envelope = nhiAttestationEnvelope({
      report,
      actor: { instance: flags.instance, role: role as H2ARole, scope }
    });
    const signed = signEnvelope(envelope, { by: flags.instance, privateKeyPem });
    streams.stdout.write(`${JSON.stringify(signed, null, 2)}\n`);
    return 0;
  }

  if (sub === "offboard") {
    if (!flags.instance) {
      streams.stderr.write("h2a nhi offboard: --instance <id> is required\n");
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    let tombstone;
    try {
      tombstone = store.offboardInstance(flags.instance, flags.reason);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a nhi offboard: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(`${JSON.stringify({ ok: true, ...tombstone }, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(
    `h2a nhi: unknown subcommand "${sub ?? ""}" (report, inventory, attest, offboard, export)\n`
  );
  return 1;
}

/**
 * `h2a drumbeat watch` (DEC-086): long-running anti-stall daemon. Async +
 * blocking, dispatched from bin.ts like mcp-serve. Uses the logging relauncher
 * by default; concrete relaunchers (local-tmux / remote) land in D3/D4.
 */
export async function runDrumbeatWatch(
  flags: Record<string, string>,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd?: () => string; signal?: AbortSignal } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const intervalMs = flags["interval-ms"] ? Number.parseInt(flags["interval-ms"], 10) : 30_000;
  const maxRelances = flags["max-relances"] ? Number.parseInt(flags["max-relances"], 10) : undefined;
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    io.stderr.write(`h2a drumbeat watch: --interval-ms must be >= 1000 (got "${flags["interval-ms"]}")\n`);
    return 1;
  }
  const kind = (flags.relauncher ?? "logging") as H2ARelauncherKind;
  const log = (line: string): void => void io.stdout.write(`${line}\n`);
  let relauncher: H2ARelauncher;
  // DEC-091 (D3): select the relauncher adapter. `auto` = local-tmux with a
  // headless fallback (the D3 chain); `logging` stays the dry-run default.
  switch (kind) {
    case "local-tmux":
      relauncher = localTmuxRelauncher({ log });
      break;
    case "headless":
      relauncher = headlessRelauncher({ log });
      break;
    case "auto":
      relauncher = chainRelauncher(localTmuxRelauncher({ log }), headlessRelauncher({ log }));
      break;
    case "logging":
      relauncher = loggingRelauncher(log);
      break;
    default:
      io.stderr.write(
        `h2a drumbeat watch: --relauncher must be one of logging|local-tmux|headless|auto (got "${flags.relauncher}")\n`
      );
      return 1;
  }
  io.stdout.write(`h2a drumbeat watch: watching ${root} every ${intervalMs}ms (relauncher=${kind})\n`);
  await runDrumbeatWatchLoop(root, relauncher, {
    intervalMs,
    ...(maxRelances !== undefined ? { maxRelances } : {}),
    signal: io.signal,
    // DEC-095 (D7): an exhausted relance budget stops the loop for that agent
    // and escalates to the PRINCIPAL (the anti-loop cap is `maxRelances`).
    onExhausted: (entry) => {
      const record = recordEscalation(root, {
        instance: entry.instance,
        reason: "relance-exhausted",
        relanceCount: entry.relanceCount
      });
      io.stdout.write(
        `drumbeat: ESCALATE ${record.instance} → ${record.to} (${record.channel}, relances=${record.relanceCount})\n`
      );
    },
    onTick: (r) => {
      if (r.relanced.length || r.exhausted.length) {
        io.stdout.write(`drumbeat tick: relanced=[${r.relanced.join(",")}] exhausted=[${r.exhausted.join(",")}]\n`);
      }
    }
  });
  return 0;
}

/**
 * `h2a sysml verify` (DEC-099, S3): verify an envelope's embedded SysML ref —
 * commit-trust (signature) by default; add `--content-integrity` to re-fetch +
 * re-hash the element (network). Async → dispatched from bin.ts like remote.
 */
export async function runSysmlVerify(
  flags: Record<string, string>,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd?: () => string } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  if (!flags.json || !flags["public-key"]) {
    io.stderr.write("h2a sysml verify: --json <envelope> and --public-key <pem-file> are required\n");
    return 1;
  }
  let envelope: Parameters<typeof verifyEnvelopeSysmlRef>[0];
  try {
    envelope = JSON.parse(flags.json) as Parameters<typeof verifyEnvelopeSysmlRef>[0];
  } catch (error) {
    io.stderr.write(`h2a sysml verify: --json is not valid JSON (${(error as Error).message})\n`);
    return 1;
  }
  let publicKeyPem: string;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    io.stderr.write(`h2a sysml verify: cannot read --public-key (${(error as Error).message})\n`);
    return 1;
  }
  const result = await verifyEnvelopeSysmlRef(envelope, {
    publicKeyPem,
    ...(flags.by ? { by: flags.by } : {}),
    ...(flags["content-integrity"] ? { contentIntegrity: true } : {}),
    ...(flags["api-base"] ? { apiBase: flags["api-base"] } : {}),
    ...(flags.auth ? { auth: flags.auth } : {})
  });
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // Verification failure is a state/business outcome → exit 2 (DEC-034).
  return result.ok ? 0 : 2;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function configsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cmdHostSetup(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const host = flags.host;
  if (!host) {
    streams.stderr.write(
      "h2a host setup: --host <codex|claude|gemini|agy> is required\n"
    );
    return 1;
  }
  let snippet;
  if (host === "codex") {
    snippet = H2A_CODEX_HOST.renderMcpConfig({ root: flags.root });
  } else if (host === "claude") {
    snippet = H2A_CLAUDE_HOST.renderMcpConfig({ root: flags.root });
  } else if (host === "gemini") {
    snippet = H2A_GEMINI_HOST.renderMcpConfig({ root: flags.root });
  } else if (host === "agy") {
    snippet = H2A_AGY_HOST.renderMcpConfig({ root: flags.root });
  } else {
    streams.stderr.write(
      `h2a host setup: unknown --host "${host}". Supported: codex, claude, gemini, agy.\n`
    );
    return 1;
  }

  const targetPath = flags.write;
  const printMode = flags.print === "true" || !targetPath;

  if (printMode && !targetPath) {
    streams.stdout.write(`${JSON.stringify(snippet.config, null, 2)}\n`);
    streams.stderr.write(
      `# ${host} — paste this snippet under \`mcpServers\` in:\n# ${snippet.path.hint}\n# example path: ${snippet.path.example}\n`
    );
    return 0;
  }

  // --write path: merge into the target file.
  let existing: Record<string, unknown> = {};
  if (existsSync(targetPath)) {
    let raw;
    try {
      raw = readFileSync(targetPath, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a host setup: cannot read ${targetPath} (${(error as Error).message})\n`
      );
      // File/OS error — exit code 3 per DEC-034.
      return 3;
    }
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          streams.stderr.write(
            `h2a host setup: ${targetPath} is valid JSON but not a JSON object; refusing to merge.\n`
          );
          // Pre-existing on-disk state we refuse to overwrite — state conflict.
          return 2;
        }
        existing = parsed;
      } catch (error) {
        streams.stderr.write(
          `h2a host setup: ${targetPath} is not valid JSON (${(error as Error).message}). Use --force to overwrite intentionally.\n`
        );
        if (flags.force !== "true") {
          // Pre-existing malformed file refused without --force — state conflict.
          return 2;
        }
        existing = {};
      }
    }
  }

  const existingMcpServers = isPlainObject(existing.mcpServers)
    ? existing.mcpServers
    : {};
  const previous = existingMcpServers.h2a;
  const incoming = snippet.config.mcpServers.h2a;

  if (
    previous !== undefined &&
    !configsEqual(previous, incoming) &&
    flags.force !== "true"
  ) {
    streams.stderr.write(
      `h2a host setup: ${targetPath} already has a different mcpServers.h2a entry. Re-run with --force to overwrite.\n`
    );
    // Divergent pre-existing entry — state conflict (exit 2).
    return 2;
  }

  const merged: Record<string, unknown> = {
    ...existing,
    mcpServers: {
      ...existingMcpServers,
      h2a: incoming
    }
  };

  try {
    const dir = dirname(targetPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (error) {
    streams.stderr.write(
      `h2a host setup: cannot write ${targetPath} (${(error as Error).message})\n`
    );
    // File/OS error — exit code 3 per DEC-034.
    return 3;
  }

  streams.stdout.write(
    `${JSON.stringify(
      { ok: true, host, path: targetPath, merged: true },
      null,
      2
    )}\n`
  );
  streams.stderr.write(
    `# wrote mcpServers.h2a for host=${host} to ${targetPath}\n# ${snippet.path.hint}\n`
  );
  return 0;
}

function cmdHostStatus(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const filter = flags.host;
  let selection: readonly (typeof CLI_HOSTS)[number][] = CLI_HOSTS;
  if (filter) {
    const match = CLI_HOSTS.find((h) => h.host === filter);
    if (!match) {
      streams.stderr.write(
        `h2a host status: unknown --host "${filter}". Supported: ${CLI_HOSTS.map(
          (h) => h.host
        ).join(", ")}.\n`
      );
      return 1;
    }
    selection = [match];
  }

  const hosts = selection.map((descriptor) => {
    const mcpAdapterShipped = true; // both stdio + in-process MCP back every host
    const hostSetupShipped =
      typeof descriptor.renderMcpConfig === "function";
    const hostScenarioShipped = descriptor.hostScenarioShipped === true;
    const summary =
      descriptor.wave === 1 && hostSetupShipped && hostScenarioShipped
        ? `wave 1 — host setup + MCP scenario shipped; MCP adapter (stdio + local) wired`
        : descriptor.wave === 1 && hostSetupShipped
          ? `wave 1 — host setup snippet shipped; MCP adapter (stdio + local) wired`
        : descriptor.wave === 2
          ? `wave 2 — descriptor only (DEC-028 defers full enablement)`
          : `wave 1 — MCP adapter wired but no setup snippet`;
    return {
      host: descriptor.host,
      wave: descriptor.wave,
      mcpAdapterShipped,
      hostSetupShipped,
      hostScenarioShipped,
      summary
    };
  });

  streams.stdout.write(
    `${JSON.stringify({ ok: true, hosts }, null, 2)}\n`
  );
  return 0;
}

/**
 * `h2a host plugin` (DEC-093, D6): render the per-host stop-hook command + where
 * it goes, so a stop is recorded with a launch context the drumbeat/D3 can
 * relance. Mirrors `host setup` (h2a renders, the host runtime places it).
 */
function cmdHostPlugin(flags: Record<string, string>, streams: H2ACliStreams): number {
  if (!flags.host) {
    streams.stderr.write(
      `h2a host plugin: --host <${H2A_HOST_PLUGIN_HOSTS.join("|")}> is required\n`
    );
    return 1;
  }
  if (!flags.instance) {
    streams.stderr.write("h2a host plugin: --instance <id> is required\n");
    return 1;
  }
  const render = renderStopHook(flags.host, {
    instance: flags.instance,
    ...(flags.root ? { root: flags.root } : {}),
    ...(flags.status ? { status: flags.status } : {})
  });
  if (!render) {
    streams.stderr.write(
      `h2a host plugin: unknown --host "${flags.host}". Supported: ${H2A_HOST_PLUGIN_HOSTS.join(", ")}.\n`
    );
    return 1;
  }

  // DEC-102/103/104 (D6 slice b): --write installs the Claude-format `hooks.Stop`
  // entry for the three hosts that accept it — **claude** + **gemini** (single
  // settings.json; gemini via `gemini hooks migrate --from-claude`) and **codex**
  // (its plugin `hooks.json` uses the identical Claude-format hooks object;
  // verified against `~/.codex/.../hooks/hooks.json`). agy is poll-only (no
  // daemon), so --write is refused for it and the rendered hook + hint surface.
  if (flags.write) {
    if (flags.host === "agy") {
      streams.stderr.write(
        `h2a host plugin: --write is not available for agy (poll-only, no daemon). ` +
          `Use the poll path: ${render.poll}\n`
      );
      return 1;
    }
    const targetPath = flags.write;
    let existing: Record<string, unknown> = {};
    if (existsSync(targetPath)) {
      let raw: string;
      try {
        raw = readFileSync(targetPath, "utf8");
      } catch (error) {
        streams.stderr.write(`h2a host plugin: cannot read ${targetPath} (${(error as Error).message})\n`);
        return 3;
      }
      if (raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw);
          if (!isPlainObject(parsed)) {
            streams.stderr.write(`h2a host plugin: ${targetPath} is valid JSON but not an object; refusing to merge.\n`);
            return 2;
          }
          existing = parsed;
        } catch (error) {
          streams.stderr.write(
            `h2a host plugin: ${targetPath} is not valid JSON (${(error as Error).message}). Use --force to overwrite.\n`
          );
          if (flags.force !== "true") return 2;
          existing = {};
        }
      }
    }
    const existingHooks = isPlainObject(existing.hooks) ? existing.hooks : {};
    const existingStop = Array.isArray(existingHooks.Stop) ? [...existingHooks.Stop] : [];
    // Idempotent: drop any prior h2a drumbeat-record Stop hook, then append ours.
    const withoutH2A = existingStop.filter((e) => !isH2ARecordHook(e));
    if (withoutH2A.length !== existingStop.length && flags.force !== "true") {
      // A previous h2a hook exists; replacing it is safe & idempotent, allow it.
    }
    const mergedStop = [...withoutH2A, claudeStopHookEntry(render.record)];
    const merged: Record<string, unknown> = {
      ...existing,
      hooks: { ...existingHooks, Stop: mergedStop }
    };
    try {
      const dir = dirname(targetPath);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
    } catch (error) {
      streams.stderr.write(`h2a host plugin: cannot write ${targetPath} (${(error as Error).message})\n`);
      return 3;
    }
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          host: flags.host,
          written: targetPath,
          mechanism: render.mechanism,
          hook: "hooks.Stop",
          // codex loads hooks via a plugin (plugin.json → ./hooks.json); the
          // file written above is a valid codex hooks.json, but codex needs a
          // plugin.json referencing it + the plugin enabled/trusted.
          ...(flags.host === "codex"
            ? {
                pluginHint:
                  'this is a codex hooks.json — add a plugin.json next to it ({"hooks":"./hooks.json"}), then enable + trust it (codex plugin enable <name>; --dangerously-bypass-hook-trust for automation)'
              }
            : {})
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  streams.stdout.write(`${JSON.stringify(render, null, 2)}\n`);
  return 0;
}

function cmdHost(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  if (sub === "setup") return cmdHostSetup(flags, streams);
  if (sub === "status") return cmdHostStatus(flags, streams);
  if (sub === "plugin") return cmdHostPlugin(flags, streams);
  streams.stderr.write(`Unknown host subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write(
    "Use: h2a host setup --host <codex|claude|gemini|agy> ...\n" +
      "     h2a host status [--host <name>]\n" +
      "     h2a host plugin --host <codex|claude|gemini|agy> --instance <id>\n"
  );
  return 1;
}

function cmdStoreMigrate(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const from = flags.from ?? H2A_STORE_SCHEMA_VERSION;
  const to = flags.to ?? H2A_STORE_SCHEMA_VERSION;
  const dryRun = flags["dry-run"] === "true";

  // DEC-064: opt-in within-version maintenance pass. Renames pre-DEC-062
  // store entries with `:` (or other forbidden chars) in their names to the
  // safePathSegment form, so a store created by <=0.1.23 works on Windows and
  // is consistent on every OS. Does not touch the schema version.
  if (flags["sanitize-paths"] === "true") {
    const result = sanitizeStorePaths(root, { dryRun });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // Conflicts (target already exists) are a state issue → exit 2.
    return result.ok ? 0 : 2;
  }

  const KNOWN_VERSIONS: readonly string[] = [H2A_STORE_SCHEMA_VERSION];
  if (!KNOWN_VERSIONS.includes(from)) {
    streams.stderr.write(
      `h2a store migrate: unknown --from version "${from}". Known versions: ${KNOWN_VERSIONS.join(",")}\n`
    );
    return 1;
  }
  if (!KNOWN_VERSIONS.includes(to)) {
    streams.stderr.write(
      `h2a store migrate: unknown --to version "${to}". Known versions: ${KNOWN_VERSIONS.join(",")}\n`
    );
    return 1;
  }

  // V1 → V1: no-op. Future bumps will branch here.
  if (from === H2A_STORE_SCHEMA_VERSION && to === H2A_STORE_SCHEMA_VERSION) {
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          fromVersion: from,
          toVersion: to,
          changed: false,
          dryRun,
          root
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  // Unreachable today (only one known version) — kept for future ramps.
  streams.stderr.write(
    `h2a store migrate: no migration registered for ${from} → ${to}\n`
  );
  return 1;
}

function cmdStore(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  if (sub === "migrate") return cmdStoreMigrate(flags, streams);
  streams.stderr.write(`Unknown store subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use: h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]\n");
  return 1;
}

function cmdDiscover(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  let entries = store.listInstances();
  if (flags.role) {
    const role = flags.role;
    entries = entries.filter((entry) => (entry.roles as readonly string[]).includes(role));
  }
  if (flags.scope) {
    const scope = flags.scope;
    entries = entries.filter((entry) => entry.scopes.includes(scope));
  }
  streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  return 0;
}

function cmdSessions(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  try {
    let sessions = listPresence(root);
    if (flags.scope) {
      const wanted = flags.scope;
      sessions = sessions.filter((s) => s.interests.scopes.includes(wanted));
    }
    if (flags.instance) {
      const wanted = flags.instance;
      sessions = sessions.filter((s) => s.instance === wanted);
    }
    streams.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a sessions: ${(error as Error).message}\n`);
    return 3;
  }
}

function cmdDoctor(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const report: Record<string, unknown> = {
    ok: true,
    root,
    checks: {}
  };
  const checks = report.checks as Record<string, unknown>;

  // 1. Root reachable
  if (!existsSync(root)) {
    checks.rootExists = { ok: false, message: `root does not exist: ${root}` };
    report.ok = false;
  } else {
    checks.rootExists = { ok: true };
  }

  // 2. Schema sentinel present
  const schemaPath = join(root, ".h2a-schema.json");
  if (!existsSync(schemaPath)) {
    checks.schemaSentinel = {
      ok: false,
      message: `missing ${schemaPath}; run \`h2a init --root ${root}\``
    };
    report.ok = false;
  } else {
    try {
      const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
      checks.schemaSentinel = { ok: true, version: parsed.version };
      if (parsed.version !== H2A_STORE_SCHEMA_VERSION) {
        report.ok = false;
        checks.schemaSentinel = {
          ok: false,
          version: parsed.version,
          message: `expected schema version ${H2A_STORE_SCHEMA_VERSION}`
        };
      }
    } catch (error) {
      report.ok = false;
      checks.schemaSentinel = {
        ok: false,
        message: `cannot read schema sentinel: ${(error as Error).message}`
      };
    }
  }

  // 3. Live sessions on the bus
  try {
    const sessions = listPresence(root);
    checks.liveSessions = { ok: true, count: sessions.length };
  } catch (error) {
    report.ok = false;
    checks.liveSessions = {
      ok: false,
      message: (error as Error).message
    };
  }

  // 4. h2a binary reachable (self-check via existing API)
  checks.cliBinary = { ok: true };

  streams.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 2;
}

function cmdKeysGenerate(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.instance) {
    streams.stderr.write("h2a keys generate: --instance <id> is required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const outDir = flags.out ?? join(resolveRoot(flags, cwd), "keys");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    streams.stderr.write(
      `h2a keys generate: cannot create ${outDir} (${(error as Error).message})\n`
    );
    return 3;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  // File names are derived from the instance id with `:` and `/` replaced by `-`
  // so they map cleanly to filesystems on every OS.
  const safeName = flags.instance.replace(/[:/]/g, "-");
  const privatePath = join(outDir, `${safeName}.key.pem`);
  const publicPath = join(outDir, `${safeName}.pub.pem`);

  try {
    writeFileSync(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
    writeFileSync(publicPath, publicPem, "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys generate: cannot write key files (${(error as Error).message})\n`
    );
    return 3;
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        instance: flags.instance,
        privateKeyPath: privatePath,
        publicKeyPath: publicPath,
        publicKeyPem: publicPem
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function cmdKeysAdd(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-078: append a public key to an instance's keyring (rotate-in).
  if (!flags.instance || !flags["public-key"]) {
    streams.stderr.write(
      "h2a keys add: --instance <id> and --public-key <pem-file> are required\n"
    );
    return 1;
  }
  let publicKeyPem;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys add: cannot read --public-key (${(error as Error).message})\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  try {
    store.addInstanceKey(flags.instance, publicKeyPem);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a keys add: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, instance: flags.instance, keys: store.listInstanceKeys(flags.instance).length }, null, 2)}\n`
  );
  return 0;
}

function cmdKeysList(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.instance) {
    streams.stderr.write("h2a keys list: --instance <id> is required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  streams.stdout.write(`${JSON.stringify(store.listInstanceKeys(flags.instance), null, 2)}\n`);
  return 0;
}

function cmdKeysRevoke(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-079: revoke a public key from an instance's keyring (rotate-out).
  if (!flags.instance || !flags["public-key"]) {
    streams.stderr.write(
      "h2a keys revoke: --instance <id> and --public-key <pem-file> are required\n"
    );
    return 1;
  }
  let publicKeyPem;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys revoke: cannot read --public-key (${(error as Error).message})\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  try {
    store.revokeInstanceKey(flags.instance, publicKeyPem);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a keys revoke: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, instance: flags.instance, status: "revoked", keys: store.listInstanceKeys(flags.instance).length }, null, 2)}\n`
  );
  return 0;
}

function cmdConnect(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.host) {
    streams.stderr.write(
      "h2a connect: --host <codex|claude|gemini|agy> is required\n"
    );
    return 1;
  }
  if (!["codex", "claude", "gemini", "agy"].includes(flags.host)) {
    streams.stderr.write(
      `h2a connect: unknown --host "${flags.host}". Supported: codex, claude, gemini, agy.\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const instance =
    flags.instance ??
    `${flags.host}:${cwd().split("/").pop() || "workspace"}`;

  const summary: Record<string, unknown> = {
    ok: true,
    root,
    host: flags.host,
    instance,
    steps: []
  };
  const steps = summary.steps as Array<Record<string, unknown>>;

  // 1. h2a init
  try {
    createLocalStore({ root });
    steps.push({ step: "init", ok: true, root });
  } catch (error) {
    streams.stderr.write(`h2a connect: init failed (${(error as Error).message})\n`);
    return 3;
  }

  // 2. host setup snippet (print only — write requires explicit --write)
  const hostDescriptor =
    flags.host === "codex"
      ? H2A_CODEX_HOST
      : flags.host === "claude"
        ? H2A_CLAUDE_HOST
        : flags.host === "gemini"
          ? H2A_GEMINI_HOST
          : H2A_AGY_HOST;
  const snippet = hostDescriptor.renderMcpConfig({ root });
  steps.push({
    step: "host-setup",
    ok: true,
    pathHint: snippet.path.hint,
    pathExample: snippet.path.example,
    snippet: snippet.config
  });

  // 3. Print follow-up instructions
  const followUp = [
    `Merge the snippet above under \`mcpServers\` in ${snippet.path.example}`,
    `then run: h2a keys generate --instance ${instance} --root ${root}`,
    `and: h2a install-skills --host ${flags.host}`
  ];
  summary.followUp = followUp;

  streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/**
 * Parse a SKILL.md file into its YAML-frontmatter `name`/`description` and
 * the body markdown that follows. The parser is intentionally minimal: it
 * accepts the canonical `---\nname: ...\ndescription: ...\n---\n<body>` shape
 * that every shipped h2a skill uses. Multi-line description values are
 * supported via simple line-continuation indent.
 */
function parseSkill(raw: string): ParsedSkill {
  const match =
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(raw);
  if (!match) {
    throw new Error(
      "skill file missing YAML frontmatter (expected `---` delimiters)"
    );
  }
  const [, fmRaw, body] = match;
  const frontmatter: Record<string, string> = {};
  let currentKey: string | undefined;
  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      frontmatter[currentKey] = kv[2].trim().replace(/^["']|["']$/g, "");
    } else if (currentKey && /^\s+/.test(line)) {
      frontmatter[currentKey] = `${frontmatter[currentKey]} ${line.trim()}`;
    }
  }
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(
      "skill frontmatter must declare both `name` and `description`"
    );
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    body: body.trimStart()
  };
}

/**
 * Render a parsed skill as a Gemini CLI custom-command TOML file
 * (`~/.gemini/commands/<name>.toml`). Gemini consumes a top-level
 * `description` plus a `prompt` (multiline triple-quoted) which is what the
 * agent receives when the user types `/<name>`. We include the original
 * frontmatter so the prompt itself remains self-describing.
 */
function renderSkillAsGeminiToml(skill: ParsedSkill): string {
  const escapedDescription = skill.description.replace(/"/g, '\\"');
  const promptHeader = `You are the ${skill.name} custom command for Gemini CLI.\n\n`;
  const promptBody = `${promptHeader}${skill.body}`;
  // TOML multiline literal: '''...''' is verbatim, no escaping needed beyond
  // disallowing the closing triple-quote in content. The bundled skills do
  // not contain '''.
  return [
    `description = "${escapedDescription}"`,
    `prompt = '''`,
    promptBody,
    `'''`,
    ""
  ].join("\n");
}

interface HostSkillTargetSpec {
  readonly host: string;
  readonly userBase: string;
  readonly projectBase: string;
  readonly write: (
    base: string,
    skillName: string,
    parsed: ParsedSkill,
    rawSource: string
  ) => string;
  readonly extension: string;
}

function targetSpecFor(
  host: string,
  cwd: string
): HostSkillTargetSpec | undefined {
  if (host === "claude") {
    return {
      host: "claude",
      userBase: join(homedir(), ".claude", "skills"),
      projectBase: join(cwd, ".claude", "skills"),
      extension: "SKILL.md",
      write: (base, skillName, _parsed, raw) => {
        const dir = join(base, skillName);
        mkdirSync(dir, { recursive: true });
        const target = join(dir, "SKILL.md");
        writeFileSync(target, raw, "utf8");
        return target;
      }
    };
  }
  if (host === "codex") {
    return {
      host: "codex",
      userBase: join(homedir(), ".codex", "skills"),
      projectBase: join(cwd, ".codex", "skills"),
      extension: "SKILL.md",
      write: (base, skillName, _parsed, raw) => {
        const dir = join(base, skillName);
        mkdirSync(dir, { recursive: true });
        const target = join(dir, "SKILL.md");
        writeFileSync(target, raw, "utf8");
        return target;
      }
    };
  }
  if (host === "gemini") {
    return {
      host: "gemini",
      userBase: join(homedir(), ".gemini", "commands"),
      projectBase: join(cwd, ".gemini", "commands"),
      extension: ".toml",
      write: (base, skillName, parsed) => {
        mkdirSync(base, { recursive: true });
        const target = join(base, `${skillName}.toml`);
        writeFileSync(target, renderSkillAsGeminiToml(parsed), "utf8");
        return target;
      }
    };
  }
  if (host === "agy") {
    // DEC-096/101: agy (Antigravity) is in the Gemini ecosystem and shares
    // `~/.gemini/`; it has no own skill store but imports plugins from gemini
    // or claude (`agy plugin import gemini`). So installing the gemini TOML
    // command IS the agy source — same write/location as gemini; the import
    // step is surfaced as `importHint` in the summary.
    return {
      host: "agy",
      userBase: join(homedir(), ".gemini", "commands"),
      projectBase: join(cwd, ".gemini", "commands"),
      extension: ".toml",
      write: (base, skillName, parsed) => {
        mkdirSync(base, { recursive: true });
        const target = join(base, `${skillName}.toml`);
        writeFileSync(target, renderSkillAsGeminiToml(parsed), "utf8");
        return target;
      }
    };
  }
  return undefined;
}

/**
 * Skill names shipped before DEC-057 that consolidated into a single `h2a`
 * skill. The installer removes them on a fresh install so users do not end up
 * with both the legacy three-skill bundle and the unified one.
 */
const LEGACY_SKILL_NAMES = ["h2a-connect", "h2a-discover", "h2a-send"];

function pruneLegacy(
  spec: HostSkillTargetSpec,
  base: string
): Array<{ name: string; path: string }> {
  const pruned: Array<{ name: string; path: string }> = [];
  for (const legacyName of LEGACY_SKILL_NAMES) {
    if (spec.host === "gemini" || spec.host === "agy") {
      const file = join(base, `${legacyName}.toml`);
      if (existsSync(file)) {
        try {
          unlinkSync(file);
          pruned.push({ name: legacyName, path: file });
        } catch {
          // best-effort
        }
      }
    } else {
      const dir = join(base, legacyName);
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
          pruned.push({ name: legacyName, path: dir });
        } catch {
          // best-effort
        }
      }
    }
  }
  return pruned;
}

function cmdInstallSkills(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const host = flags.host;
  if (!host) {
    streams.stderr.write(
      "h2a install-skills: --host <claude|codex|gemini|agy> is required\n"
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const spec = targetSpecFor(host, cwd());
  if (!spec) {
    streams.stderr.write(
      `h2a install-skills: unknown --host "${host}". Supported: claude, codex, gemini, agy.\n`
    );
    return 1;
  }

  if (!existsSync(SKILLS_DIR)) {
    streams.stderr.write(
      `h2a install-skills: skills bundle missing at ${SKILLS_DIR}\n`
    );
    return 3;
  }

  const scope = flags.scope ?? "user";
  if (scope !== "user" && scope !== "project") {
    streams.stderr.write(
      `h2a install-skills: --scope must be 'user' or 'project'\n`
    );
    return 1;
  }

  const targetBase = scope === "user" ? spec.userBase : spec.projectBase;
  // DEC-057: prune the pre-consolidation skill names if they linger on disk.
  const prunedLegacy = pruneLegacy(spec, targetBase);

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const installed: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillName = entry.name;
    const src = join(SKILLS_DIR, skillName, "SKILL.md");
    if (!existsSync(src)) continue;
    let raw: string;
    try {
      raw = readFileSync(src, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a install-skills: cannot read ${src} (${(error as Error).message})\n`
      );
      return 3;
    }
    let parsed: ParsedSkill;
    try {
      parsed = parseSkill(raw);
    } catch (error) {
      streams.stderr.write(
        `h2a install-skills: ${skillName}: ${(error as Error).message}\n`
      );
      return 2;
    }
    // Probe the would-be target file before writing so existing files are
    // surfaced as skipped (mirrors the previous Claude-only behavior).
    const probeTarget =
      spec.host === "gemini" || spec.host === "agy"
        ? join(targetBase, `${skillName}.toml`)
        : join(targetBase, skillName, "SKILL.md");
    if (existsSync(probeTarget) && flags.force !== "true") {
      skipped.push({
        name: skillName,
        reason: `${probeTarget} already exists (use --force to overwrite)`
      });
      continue;
    }
    try {
      const targetPath = spec.write(targetBase, skillName, parsed, raw);
      installed.push(targetPath);
    } catch (error) {
      streams.stderr.write(
        `h2a install-skills: failed to write ${probeTarget} (${(error as Error).message})\n`
      );
      return 3;
    }
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: skipped.length === 0,
        host,
        scope,
        targetBase,
        installed,
        skipped,
        prunedLegacy,
        // DEC-101: agy has no own skill store — it imports from gemini/claude.
        // The TOML above is written to the shared ~/.gemini location; the user
        // then pulls it into agy with `agy plugin import gemini`.
        ...(host === "agy"
          ? { importHint: "agy plugin import gemini   # then: agy plugin enable h2a" }
          : {})
      },
      null,
      2
    )}\n`
  );
  return skipped.length === 0 ? 0 : 2;
}

function cmdDeploy(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  if (!sub) {
    streams.stderr.write(
      "h2a deploy: subcommand required (supported: k8s-sidecar, k8s-tenant)\n"
    );
    return 1;
  }
  if (sub === "k8s-tenant") {
    return cmdDeployTenant(flags, streams);
  }
  if (sub !== "k8s-sidecar") {
    streams.stderr.write(
      `h2a deploy: unknown subcommand "${sub}". Supported: k8s-sidecar, k8s-tenant.\n`
    );
    return 1;
  }
  // DEC-058: render the Kubernetes sidecar fragment for Scenario A
  // of DEC-056 (remote session sidecar).
  const fragment = renderK8sSidecar({
    instance: flags.instance,
    host: flags.host,
    root: flags.root,
    image: flags.image,
    cliVersion: flags["cli-version"]
  });

  const writeTo = flags.write;
  if (writeTo) {
    try {
      mkdirSync(dirname(writeTo), { recursive: true });
      writeFileSync(writeTo, fragment.yaml, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a deploy k8s-sidecar: cannot write ${writeTo} (${(error as Error).message})\n`
      );
      return 3;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, target: "k8s-sidecar", path: writeTo }, null, 2)}\n`
    );
    return 0;
  }

  // Default: emit a JSON resource envelope (DEC-034). Programmatic callers
  // can consume the structured `container` / `volume` / `volumeMount`
  // pieces; humans pipe `.yaml` to kubectl: `h2a deploy k8s-sidecar | jq -r .yaml`.
  streams.stdout.write(
    `${JSON.stringify(
      {
        target: "k8s-sidecar",
        container: fragment.container,
        volume: fragment.volume,
        mainContainerVolumeMount: fragment.mainContainerVolumeMount,
        yaml: fragment.yaml
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function cmdDeployTenant(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-067: render the full cluster-tenant manifest for Scenario B of DEC-056
  // (shared RWX store coordinated by the lease lock, DEC-065/066).
  const replicas = flags.replicas ? Number.parseInt(flags.replicas, 10) : undefined;
  if (flags.replicas && (!Number.isFinite(replicas) || (replicas as number) < 1)) {
    streams.stderr.write(
      `h2a deploy k8s-tenant: --replicas must be a positive integer (got "${flags.replicas}")\n`
    );
    return 1;
  }
  const leaseMs = flags["lease-ms"] ? Number.parseInt(flags["lease-ms"], 10) : undefined;
  if (flags["lease-ms"] && (!Number.isFinite(leaseMs) || (leaseMs as number) < 1)) {
    streams.stderr.write(
      `h2a deploy k8s-tenant: --lease-ms must be a positive integer (got "${flags["lease-ms"]}")\n`
    );
    return 1;
  }

  const manifest = renderK8sTenant({
    namespace: flags.namespace,
    root: flags.root,
    replicas,
    storage: flags.storage,
    storageClass: flags["storage-class"],
    leaseMs,
    image: flags.image,
    cliVersion: flags["cli-version"]
  });

  const writeTo = flags.write;
  if (writeTo) {
    try {
      mkdirSync(dirname(writeTo), { recursive: true });
      writeFileSync(writeTo, manifest.yaml, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a deploy k8s-tenant: cannot write ${writeTo} (${(error as Error).message})\n`
      );
      return 3;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, target: "k8s-tenant", path: writeTo }, null, 2)}\n`
    );
    return 0;
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        target: "k8s-tenant",
        documents: manifest.documents,
        yaml: manifest.yaml
      },
      null,
      2
    )}\n`
  );
  return 0;
}

export function runCli(
  argv: readonly string[] = process.argv.slice(2),
  streams: H2ACliStreams = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): number {
  const { command, flags } = parseFlags(argv);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    streams.stdout.write(`${renderCliHelp()}\n`);
    return 0;
  }

  if (command === "hosts") {
    streams.stdout.write(`${JSON.stringify(CLI_HOSTS, null, 2)}\n`);
    return 0;
  }

  if (command === "mcp-tools") {
    streams.stdout.write(`${JSON.stringify(H2A_CLI_MCP_TOOL_NAMES, null, 2)}\n`);
    return 0;
  }

  if (command === "init") return cmdInit(flags, streams);
  if (command === "register") return cmdRegister(flags, streams);
  if (command === "discover") return cmdDiscover(flags, streams);
  if (command === "subagent") return cmdSubagent(argv.slice(1), streams);
  if (command === "drumbeat") {
    const sub = argv[1];
    if (sub === "watch") {
      streams.stderr.write("h2a drumbeat watch: async daemon — run via the h2a binary, not the synchronous API.\n");
      return 1;
    }
    return cmdDrumbeat(argv.slice(1), streams);
  }
  if (command === "upgrade") return cmdUpgrade(flags, streams);
  if (command === "nhi") return cmdNhi(argv.slice(1), streams);
  if (command === "blockage") return cmdBlockage(argv.slice(1), streams);
  if (command === "sysml") {
    const sub = argv[1];
    if (sub === "verify") {
      streams.stderr.write(
        "h2a sysml verify: async verb — run via the h2a binary, not the synchronous API.\n"
      );
      return 1;
    }
    streams.stderr.write("h2a sysml: subcommand required (verify).\n");
    return 1;
  }
  if (command === "negotiate") return cmdNegotiate(argv.slice(1), streams);
  if (command === "inbox") return cmdMailbox(argv.slice(1), "inbox", streams);
  if (command === "outbox") return cmdMailbox(argv.slice(1), "outbox", streams);
  if (command === "host") return cmdHost(argv.slice(1), streams);
  if (command === "store") return cmdStore(argv.slice(1), streams);
  if (command === "sessions") return cmdSessions(flags, streams);
  if (command === "doctor") return cmdDoctor(flags, streams);
  if (command === "connect") return cmdConnect(flags, streams);
  if (command === "install-skills") return cmdInstallSkills(flags, streams);
  if (command === "deploy") return cmdDeploy(argv.slice(1), streams);
  if (command === "remote") {
    // `remote serve`/`remote send` are async and dispatched from bin.ts; if we
    // reach here it is a misuse (e.g. via the sync runCli) or an unknown sub.
    const sub = argv[1];
    if (sub === "serve" || sub === "send") {
      streams.stderr.write(
        `h2a remote ${sub}: async verb — run via the h2a binary, not the synchronous API.\n`
      );
      return 1;
    }
    streams.stderr.write(
      `h2a remote: subcommand required (serve, send).\n`
    );
    return 1;
  }
  if (command === "keys") {
    const { command: sub, flags: subFlags } = parseFlags(argv.slice(1));
    if (sub === "generate") return cmdKeysGenerate(subFlags, streams);
    if (sub === "add") return cmdKeysAdd(subFlags, streams);
    if (sub === "list") return cmdKeysList(subFlags, streams);
    if (sub === "revoke") return cmdKeysRevoke(subFlags, streams);
    streams.stderr.write(`h2a keys: unknown subcommand "${sub ?? ""}" (generate, add, list, revoke)\n`);
    return 1;
  }

  streams.stderr.write(`Unknown command: ${command}\n`);
  streams.stderr.write("Run `h2a --help`.\n");
  return 1;
}

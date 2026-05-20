import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { computeHash, signCanonical } from "@sentropic/h2a";

import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_CLI_MCP_TOOL_NAMES } from "./mcp.js";
import { createLocalStore } from "./runtime/local-files/index.js";
import { runMcpStdio } from "./runtime/mcp/index.js";

export interface H2ACliStreams {
  stderr: Pick<typeof process.stderr, "write">;
  stdout: Pick<typeof process.stdout, "write">;
  cwd?: () => string;
}

const CLI_HOSTS = [
  H2A_CODEX_HOST,
  H2A_CLAUDE_HOST,
  H2A_GEMINI_HOST
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
    "  h2a negotiate open --json <record-json> [--root <path>]",
    "  h2a negotiate status --id <id> --status <status> [--root <path>]",
    "  h2a negotiate event --id <id> --json <payload-json> [--root <path>]",
    "  h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--root <path>]",
    "  h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--root <path>]",
    "  h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [--event-id <id>] [--root <path>]",
    "  h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]",
    "  h2a negotiate journal --id <id> [--root <path>]",
    "  h2a inbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a inbox read --instance <id> [--root <path>]",
    "  h2a inbox pop --instance <id> --envelope <id> [--root <path>]",
    "  h2a outbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a outbox read --instance <id> [--root <path>]",
    "  h2a mcp-serve [--root <path>]",
    "  h2a host setup --host <codex|claude> [--root <path>] [--print | --write <file>] [--force]",
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

function cmdInit(flags: Record<string, string>, streams: H2ACliStreams): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  streams.stdout.write(
    `${JSON.stringify({ ok: true, root: store.paths.root }, null, 2)}\n`
  );
  return 0;
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
    streams.stderr.write(`h2a register: ${(error as Error).message}\n`);
    return 1;
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, id: registration.id, root: store.paths.root }, null, 2)}\n`
  );
  return 0;
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
      streams.stderr.write(`h2a ${mailbox} put: ${(error as Error).message}\n`);
      return 1;
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
      return 1;
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
      streams.stderr.write(`h2a negotiate open: ${(error as Error).message}\n`);
      return 1;
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
      streams.stderr.write(`h2a negotiate status: ${(error as Error).message}\n`);
      return 1;
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
      return 1;
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
    const payload = {
      id: flags["event-id"] ?? `evt-${Date.now().toString(36)}`,
      type: sub === "offer" ? "propose" : "counter",
      actor: { instance: flags.instance, role: "CONDUCTOR", scope: record.scope },
      body: { artifact },
      createdAt: new Date().toISOString()
    } as const;
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a negotiate ${sub}: ${(error as Error).message}\n`);
      return 1;
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
      return 1;
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
      return 1;
    }
    const artifactHash = computeHash(artifact);
    const signature = signCanonical({ artifactHash }, { by: flags.instance, privateKeyPem });
    const payload = {
      id: flags["event-id"] ?? `evt-sign-${Date.now().toString(36)}`,
      type: "event" as const,
      actor: { instance: flags.instance, role: "CONDUCTOR" as const, scope: record.scope },
      body: { kind: "signature", artifactHash, signature },
      createdAt: new Date().toISOString()
    };
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a negotiate sign: ${(error as Error).message}\n`);
      return 1;
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
            finalEvent: { id: result.finalEvent.id, sequence: result.finalEvent.sequence }
          },
          null,
          2
        )}\n`
      );
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a negotiate stabilize: ${(error as Error).message}\n`);
      return 1;
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
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a negotiate event: ${(error as Error).message}\n`);
      return 1;
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
      streams.stderr.write(`h2a negotiate journal: ${(error as Error).message}\n`);
      return 1;
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
  try {
    await runMcpStdio({
      root,
      stdin: io.stdin as never,
      stdout: io.stdout as never,
      stderr: io.stderr as never
    });
    return 0;
  } catch (err) {
    io.stderr.write(`h2a mcp-serve: ${(err as Error).message}\n`);
    return 1;
  }
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
      "h2a host setup: --host <codex|claude> is required\n"
    );
    return 1;
  }
  if (host === "gemini") {
    streams.stderr.write(
      "h2a host setup: Gemini is deferred to wave 2 (DEC-028). Use --host codex or claude.\n"
    );
    return 1;
  }
  let snippet;
  if (host === "codex") {
    snippet = H2A_CODEX_HOST.renderMcpConfig({ root: flags.root });
  } else if (host === "claude") {
    snippet = H2A_CLAUDE_HOST.renderMcpConfig({ root: flags.root });
  } else {
    streams.stderr.write(
      `h2a host setup: unknown --host "${host}". Supported: codex, claude.\n`
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
      return 1;
    }
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          streams.stderr.write(
            `h2a host setup: ${targetPath} is valid JSON but not a JSON object; refusing to merge.\n`
          );
          return 1;
        }
        existing = parsed;
      } catch (error) {
        streams.stderr.write(
          `h2a host setup: ${targetPath} is not valid JSON (${(error as Error).message}). Use --force to overwrite intentionally.\n`
        );
        if (flags.force !== "true") {
          return 1;
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
    return 1;
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
    return 1;
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

function cmdHost(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  if (sub === "setup") return cmdHostSetup(flags, streams);
  streams.stderr.write(`Unknown host subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use: h2a host setup --host <codex|claude> ...\n");
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
  if (command === "negotiate") return cmdNegotiate(argv.slice(1), streams);
  if (command === "inbox") return cmdMailbox(argv.slice(1), "inbox", streams);
  if (command === "outbox") return cmdMailbox(argv.slice(1), "outbox", streams);
  if (command === "host") return cmdHost(argv.slice(1), streams);

  streams.stderr.write(`Unknown command: ${command}\n`);
  streams.stderr.write("Run `h2a --help`.\n");
  return 1;
}

import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, join } from "node:path";

import { isH2AEnvelope } from "./envelope.js";
import { isSessionExpired } from "./session.js";
import type { H2AEnvelope } from "./types.js";

import {
  canonicalAddress,
  inboxDir,
  inboxDirRaw,
  localStorePaths,
  type LocalStorePaths,
} from "./runtime/local-files/paths.js";
import { listPresenceWithDiagnostics } from "./runtime/local-files/presence.js";
import {
  listObjectiveLoopsWithDiagnostics,
  type H2AObjectiveLoop,
} from "./runtime/loop/index.js";

export type StatusSessionState = "present" | "absent" | "unknown";
export type StatusGatewayState =
  | "off"
  | "idle"
  | "active"
  | "rate-limited"
  | "unavailable"
  | "unknown";

export interface StatusRuntimeAgent {
  readonly id: string;
  readonly kind: "delegated-job" | "local-session";
  readonly tool: string;
  readonly state: string;
  readonly label?: string;
  readonly tmuxSession?: string;
  readonly h2aInstance?: string;
}

export interface StatusRuntimeProjection {
  readonly kind: "h2a-status-runtime";
  readonly version: 1;
  readonly session: {
    readonly state: StatusSessionState;
    readonly tmuxSession?: string;
    readonly profile?: string;
    readonly path?: string;
  };
  readonly managed: {
    readonly agents: readonly StatusRuntimeAgent[];
    readonly degraded: boolean;
    readonly attentionComplete?: boolean;
  };
  readonly gateway: {
    readonly state: StatusGatewayState;
    readonly requestedModel?: string;
    readonly upstreamModel?: string;
    readonly provider?: string;
    readonly transport?: string;
    readonly accountId?: string;
    readonly accountLabel?: string;
    readonly previousAccountLabel?: string;
    readonly fallbackAccountLabel?: string;
    readonly retryAfterMs?: number;
    readonly updatedAt?: string;
    readonly reason?: string;
  };
  readonly warnings: readonly string[];
}

export interface StatusSubagent {
  readonly id: string;
  readonly parentInstance: string;
  readonly name: string;
  readonly state: "addressable" | "revoked";
  readonly waiting: number;
  readonly lastRoutedAt?: string;
  readonly lastRoutedEnvelopeId?: string;
  readonly lastRoutedMailbox?: "inbox" | "outbox";
}

export interface StatusInboxEnvelope {
  readonly id: string;
  readonly recipient: string;
  readonly from: string;
  readonly type: string;
  readonly createdAt: string;
}

export interface H2AStatusSnapshotV1 {
  readonly kind: "h2a-status";
  readonly version: 1;
  readonly tmuxSession?: string;
  readonly session: StatusRuntimeProjection["session"];
  readonly managed: {
    readonly active: number;
    readonly attention: number;
    readonly attentionComplete: boolean;
    readonly degraded: boolean;
    readonly agents: readonly StatusRuntimeAgent[];
  };
  readonly subagents: {
    readonly addressable: number;
    readonly degraded: boolean;
    readonly items: readonly StatusSubagent[];
  };
  readonly inbox: {
    readonly waiting: number;
    readonly degraded: boolean;
    readonly envelopes: readonly StatusInboxEnvelope[];
  };
  readonly loops: {
    readonly active: number;
    readonly attention: number;
    readonly degraded: boolean;
    readonly items: readonly H2AObjectiveLoop[];
  };
  readonly presence: {
    readonly reachable: number;
    readonly degraded: boolean;
    readonly instances: readonly string[];
  };
  readonly gateway: StatusRuntimeProjection["gateway"];
  readonly warnings: readonly string[];
}

interface StoredSubagent {
  readonly id: string;
  readonly parentInstance: string;
  readonly name: string;
  readonly createdAt: string;
}

interface StoredSubagentAudit {
  readonly subagent: string;
  readonly type: string;
  readonly at?: string;
  readonly envelopeId?: string;
  readonly mailbox?: "inbox" | "outbox";
}

interface StoredInstance {
  readonly instance: string;
}

interface StoredIdentityAlias {
  readonly instance: string;
  readonly legacyInstance: string;
  readonly at: string;
}

interface StoreProjection {
  readonly subagents: StatusSubagent[];
  readonly inbox: StatusInboxEnvelope[];
  readonly subagentsDegraded: boolean;
  readonly inboxDegraded: boolean;
  readonly warnings: string[];
}

function clean(value: unknown, maxScalars = 96): string {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized).slice(0, maxScalars).join("");
}

function readJsonLines<T>(
  path: string,
  label: string,
  validate: (value: unknown) => value is T,
  warnings: string[],
): { values: T[]; degraded: boolean } {
  if (!existsSync(path)) return { values: [], degraded: false };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    warnings.push(`${label} could not be read`);
    return { values: [], degraded: true };
  }
  const values: T[] = [];
  let degraded = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (!validate(value)) throw new Error("invalid shape");
      values.push(value);
    } catch {
      degraded = true;
      warnings.push(`${label} contains a malformed record`);
    }
  }
  return { values, degraded };
}

function isStoredSubagent(value: unknown): value is StoredSubagent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredSubagent>;
  const expectedId = `${row.parentInstance ?? ""}~${row.name ?? ""}`;
  return (
    typeof row.id === "string" &&
    typeof row.parentInstance === "string" &&
    row.parentInstance.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    !row.name.includes("~") &&
    row.id === expectedId &&
    typeof row.createdAt === "string" &&
    Number.isFinite(Date.parse(row.createdAt))
  );
}

function isStoredAudit(value: unknown): value is StoredSubagentAudit {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredSubagentAudit>;
  const validType = row.type === "registered" || row.type === "routed" || row.type === "revoked";
  return (
    typeof row.subagent === "string" &&
    validType &&
    typeof row.at === "string" &&
    Number.isFinite(Date.parse(row.at)) &&
    (row.envelopeId === undefined || typeof row.envelopeId === "string") &&
    (row.mailbox === undefined || row.mailbox === "inbox" || row.mailbox === "outbox") &&
    (row.type !== "routed" ||
      (typeof row.envelopeId === "string" &&
        (row.mailbox === "inbox" || row.mailbox === "outbox")))
  );
}

function isStoredInstance(value: unknown): value is StoredInstance {
  if (!value || typeof value !== "object") return false;
  return typeof (value as Partial<StoredInstance>).instance === "string";
}

function isStoredIdentityAlias(value: unknown): value is StoredIdentityAlias {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredIdentityAlias>;
  return (
    typeof row.instance === "string" &&
    typeof row.legacyInstance === "string" &&
    typeof row.at === "string"
  );
}

function recipientByDirectory(
  paths: LocalStorePaths,
  knownRecipients: readonly string[],
  aliases: readonly StoredIdentityAlias[],
): Map<string, string> {
  const recipients = new Map<string, string>();
  const add = (handle: string, owner: string): void => {
    recipients.set(basename(inboxDir(paths, handle)), owner);
    recipients.set(basename(inboxDirRaw(paths, handle)), owner);
  };
  for (const recipient of knownRecipients) add(recipient, canonicalAddress(recipient));

  // Match the mailbox reader's single-owner rule for a shared legacy alias:
  // the earliest claimant owns it; later de-collisioned peers must not see it.
  const byLegacy = new Map<string, StoredIdentityAlias[]>();
  for (const alias of aliases) {
    const rows = byLegacy.get(alias.legacyInstance) ?? [];
    rows.push(alias);
    byLegacy.set(alias.legacyInstance, rows);
  }
  for (const [legacy, claims] of byLegacy) {
    const owner = claims.reduce((earliest, claim) =>
      claim.at < earliest.at ? claim : earliest,
    );
    if (knownRecipients.includes(owner.instance)) {
      add(legacy, canonicalAddress(owner.instance));
    }
  }
  return recipients;
}

function readStoreProjection(
  root: string,
  presenceInstances: readonly string[],
): StoreProjection {
  const warnings: string[] = [];
  if (!existsSync(root)) {
    return {
      subagents: [],
      inbox: [],
      subagentsDegraded: true,
      inboxDegraded: true,
      warnings: ["h2a store is absent"],
    };
  }
  const paths = localStorePaths(root);
  const storedSubagents = readJsonLines(
    paths.subagents,
    "subagent registry",
    isStoredSubagent,
    warnings,
  );
  const audit = readJsonLines(
    paths.subagentAudit,
    "subagent audit",
    isStoredAudit,
    warnings,
  );
  const storedInstances = readJsonLines(
    paths.instances,
    "instance registry",
    isStoredInstance,
    warnings,
  );
  const aliases = readJsonLines(
    join(root, "identity", "aliases.jsonl"),
    "identity aliases",
    isStoredIdentityAlias,
    warnings,
  );
  const revoked = new Set(
    audit.values
      .filter((event) => event.type === "revoked")
      .map((event) => event.subagent),
  );
  const byId = new Map<string, StatusSubagent>();
  for (const item of storedSubagents.values) {
    byId.set(item.id, {
      id: item.id,
      parentInstance: item.parentInstance,
      name: item.name,
      state: revoked.has(item.id) ? "revoked" : "addressable",
      waiting: 0,
    });
  }
  const subagents = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  const knownRecipients = [
    ...new Set([
      ...presenceInstances,
      ...storedInstances.values.map((registration) => registration.instance),
      ...subagents.map((subagent) => subagent.id),
      ...subagents.map((subagent) => subagent.parentInstance),
    ]),
  ];
  const recipientMap = recipientByDirectory(paths, knownRecipients, aliases.values);
  const inboxByRecipientAndId = new Map<string, StatusInboxEnvelope>();
  let inboxDegraded = false;
  let directories: string[];
  try {
    directories = readdirSync(paths.inbox);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") directories = [];
    else {
      warnings.push("inbox directory could not be read");
      directories = [];
      inboxDegraded = true;
    }
  }
  for (const directory of directories) {
    let files: string[];
    try {
      files = readdirSync(join(paths.inbox, directory));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOTDIR") continue;
      warnings.push(`inbox ${clean(directory)} could not be read`);
      inboxDegraded = true;
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const recipient = recipientMap.get(directory);
      if (!recipient) {
        warnings.push(`inbox ${clean(directory)} has no registered owner`);
        inboxDegraded = true;
        continue;
      }
      try {
        const value: unknown = JSON.parse(
          readFileSync(join(paths.inbox, directory, file), "utf8"),
        );
        if (!isH2AEnvelope(value)) throw new Error("invalid envelope");
        const envelope = value as H2AEnvelope;
        const waitingKey = `${recipient}\u0000${envelope.id}`;
        if (!inboxByRecipientAndId.has(waitingKey)) {
          inboxByRecipientAndId.set(waitingKey, {
            id: clean(envelope.id),
            recipient,
            from: clean(envelope.actor.instance),
            type: clean(envelope.type),
            createdAt: clean(envelope.createdAt),
          });
        }
      } catch {
        warnings.push(`inbox ${clean(directory)} contains a malformed envelope`);
        inboxDegraded = true;
      }
    }
  }
  const inbox = [...inboxByRecipientAndId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const lastRouted = new Map<string, StoredSubagentAudit>();
  for (const event of audit.values) {
    if (event.type !== "routed") continue;
    const current = lastRouted.get(event.subagent);
    if (!current || (event.at ?? "") >= (current.at ?? "")) {
      lastRouted.set(event.subagent, event);
    }
  }
  const enrichedSubagents = subagents.map((subagent) => {
    const route = lastRouted.get(subagent.id);
    return {
      ...subagent,
      waiting: inbox.filter(
        (envelope) => canonicalAddress(envelope.recipient) === canonicalAddress(subagent.id),
      ).length,
      ...(route?.at ? { lastRoutedAt: route.at } : {}),
      ...(route?.envelopeId ? { lastRoutedEnvelopeId: route.envelopeId } : {}),
      ...(route?.mailbox ? { lastRoutedMailbox: route.mailbox } : {}),
    };
  });
  return {
    subagents: enrichedSubagents,
    inbox,
    subagentsDegraded: storedSubagents.degraded || audit.degraded,
    inboxDegraded: inboxDegraded || storedInstances.degraded || aliases.degraded,
    warnings,
  };
}

const ACTIVE_AGENT_STATES = new Set([
  "pending",
  "running",
  "throttled",
  "attached",
  "detached",
  "live",
]);
const ATTENTION_AGENT_STATES = new Set(["throttled", "failed"]);
const ACTIVE_LOOP_STATES = new Set([
  "created",
  "running",
  "waiting-human",
  "waiting-agent",
  "stalled",
  "degraded",
  "active",
  "blocked",
]);
const ATTENTION_LOOP_STATES = new Set([
  "waiting-human",
  "stalled",
  "degraded",
  "blocked",
]);

export interface StatusSnapshotDependencies {
  readonly projectRuntime?: (input: {
    tmuxSession?: string;
    includeGateway?: boolean;
  }) => Promise<StatusRuntimeProjection>;
}

async function defaultRuntimeProjection(input: {
  tmuxSession?: string;
  includeGateway?: boolean;
}): Promise<StatusRuntimeProjection> {
  const packageName: string = "@sentropic/h2a-runtime/status";
  const runtime = (await import(packageName)) as {
    projectStatusForH2a?: (options: {
      tmuxSession?: string;
      includeGateway?: boolean;
    }) => Promise<StatusRuntimeProjection>;
  };
  if (typeof runtime.projectStatusForH2a !== "function") {
    throw new Error("runtime status projection is unavailable");
  }
  return runtime.projectStatusForH2a(input);
}

export async function readStatusSnapshot(
  input: {
    readonly root: string;
    readonly tmuxSession?: string;
    readonly includeGateway?: boolean;
  },
  dependencies: StatusSnapshotDependencies = {},
): Promise<H2AStatusSnapshotV1> {
  const warnings: string[] = [];
  let runtime: StatusRuntimeProjection;
  try {
    runtime = await (dependencies.projectRuntime ?? defaultRuntimeProjection)({
      ...(input.tmuxSession ? { tmuxSession: input.tmuxSession } : {}),
      ...(input.includeGateway === false ? { includeGateway: false } : {}),
    });
    warnings.push(...runtime.warnings);
  } catch {
    runtime = {
      kind: "h2a-status-runtime",
      version: 1,
      session: {
        state: "unknown",
        ...(input.tmuxSession ? { tmuxSession: input.tmuxSession } : {}),
      },
      managed: { agents: [], degraded: true, attentionComplete: false },
      gateway: { state: "unknown", reason: "runtime projection unavailable" },
      warnings: [],
    };
    warnings.push("optional h2a runtime projection is unavailable");
  }

  let presenceInstances: string[] = [];
  let presenceDegraded = false;
  try {
    const presence = listPresenceWithDiagnostics(input.root, {
      includeExpired: true,
      sweep: false,
    });
    presenceInstances = presence.sessions
      .filter((session) => !isSessionExpired(session))
      .map((session) => session.instance);
    presenceDegraded = presence.warnings.length > 0;
    warnings.push(...presence.warnings);
  } catch {
    presenceDegraded = true;
    warnings.push("presence could not be read");
  }
  const store = readStoreProjection(input.root, presenceInstances);
  warnings.push(...store.warnings);

  let loops: H2AObjectiveLoop[] = [];
  let loopsDegraded = false;
  try {
    const result = listObjectiveLoopsWithDiagnostics(input.root);
    loops = result.loops;
    loopsDegraded = result.warnings.length > 0;
    warnings.push(...result.warnings);
  } catch {
    loopsDegraded = true;
    warnings.push("objective loops could not be read");
  }

  const activeAgents = runtime.managed.agents.filter((agent) =>
    ACTIVE_AGENT_STATES.has(agent.state),
  );
  return {
    kind: "h2a-status",
    version: 1,
    ...(input.tmuxSession || runtime.session.tmuxSession
      ? { tmuxSession: input.tmuxSession ?? runtime.session.tmuxSession }
      : {}),
    session: runtime.session,
    managed: {
      active: activeAgents.length,
      attention: runtime.managed.agents.filter((agent) =>
        ATTENTION_AGENT_STATES.has(agent.state),
      ).length,
      attentionComplete: runtime.managed.attentionComplete === true,
      degraded: runtime.managed.degraded,
      agents: runtime.managed.agents,
    },
    subagents: {
      addressable: store.subagents.filter(
        (subagent) => subagent.state === "addressable",
      ).length,
      degraded: store.subagentsDegraded,
      items: store.subagents,
    },
    inbox: {
      waiting: store.inbox.length,
      degraded: store.inboxDegraded,
      envelopes: store.inbox,
    },
    loops: {
      active: loops.filter((loop) => ACTIVE_LOOP_STATES.has(loop.status)).length,
      attention: loops.filter((loop) => ATTENTION_LOOP_STATES.has(loop.status)).length,
      degraded: loopsDegraded,
      items: loops,
    },
    presence: {
      reachable: presenceInstances.length,
      degraded: presenceDegraded,
      instances: presenceInstances.sort(),
    },
    gateway: runtime.gateway,
    warnings: [...new Set(warnings)],
  };
}

function countSegment(
  prefix: string,
  count: number,
  attention: number | undefined,
  degraded: boolean,
  attentionComplete = true,
): string {
  if (degraded) return `${prefix}?`;
  if (attention === undefined) return `${prefix}${count}`;
  if (attention > 0) {
    return `${prefix}${count}!${attention}${attentionComplete ? "" : "+"}`;
  }
  return `${prefix}${count}${attentionComplete ? "" : "!?"}`;
}

export function renderWorkloadBar(snapshot: H2AStatusSnapshotV1): string {
  if (snapshot.session.state === "absent") return "h2a absent";
  if (snapshot.session.state === "unknown") return "h2a ?";
  return [
    countSegment(
      "A",
      snapshot.managed.active,
      snapshot.managed.attention,
      snapshot.managed.degraded,
      snapshot.managed.attentionComplete,
    ),
    countSegment(
      "D",
      snapshot.subagents.addressable,
      undefined,
      snapshot.subagents.degraded,
    ),
    countSegment("I", snapshot.inbox.waiting, undefined, snapshot.inbox.degraded),
    countSegment(
      "L",
      snapshot.loops.active,
      snapshot.loops.attention,
      snapshot.loops.degraded,
    ),
  ].join(" ");
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60_000)}m`;
}

export function renderGatewayBar(snapshot: H2AStatusSnapshotV1): string {
  if (snapshot.session.state === "absent") return "gw n/a";
  if (snapshot.session.state === "unknown") return "gw ?";
  const gateway = snapshot.gateway;
  if (gateway.state === "off") return "gw off";
  if (gateway.state === "unavailable") return "gw unavailable";
  if (gateway.state === "unknown") return "gw ?";
  const state = gateway.state === "rate-limited" ? "429" : gateway.state;
  const parts = [`gw ${state}`];
  if (gateway.requestedModel && gateway.upstreamModel) {
    parts.push(
      `${gateway.state === "idle" ? "last " : ""}${clean(gateway.requestedModel)}→${clean(gateway.upstreamModel)}`,
    );
  }
  if (gateway.previousAccountLabel && gateway.fallbackAccountLabel) {
    parts.push(
      `acct ${clean(gateway.previousAccountLabel)}→${clean(gateway.fallbackAccountLabel)}`,
    );
  } else if (gateway.accountLabel) {
    parts.push(`acct ${clean(gateway.accountLabel)}`);
  }
  if (gateway.state === "rate-limited" && gateway.retryAfterMs !== undefined) {
    parts.push(`retry ${duration(gateway.retryAfterMs)}`);
  }
  return parts.join(" · ");
}

export function renderStatusBar(
  snapshot: H2AStatusSnapshotV1,
  segment: "workload" | "gateway" | "all" = "all",
): string {
  if (segment === "workload") return renderWorkloadBar(snapshot);
  if (segment === "gateway") return renderGatewayBar(snapshot);
  const identity = snapshot.tmuxSession ? `[${clean(snapshot.tmuxSession)}] ` : "";
  return `${identity}${renderWorkloadBar(snapshot)}  ${renderGatewayBar(snapshot)}`;
}

function rowsOrNone(rows: readonly string[]): string[] {
  return rows.length > 0 ? [...rows] : ["  (none)"];
}

export function renderHumanStatus(snapshot: H2AStatusSnapshotV1): string {
  const lines: string[] = [
    `H2A STATUS${snapshot.tmuxSession ? ` — ${clean(snapshot.tmuxSession)}` : ""}`,
    `SESSION  ${snapshot.session.state}`,
    "",
    "MANAGED WORK",
    ...rowsOrNone(
      snapshot.managed.agents.map(
        (agent) =>
          `  ${clean(agent.id)}  ${clean(agent.kind)}  ${clean(agent.tool)}  ${clean(agent.state)}`,
      ),
    ),
    "",
    "H2A DELEGATION BINDINGS",
    ...rowsOrNone(
      snapshot.subagents.items.map(
        (subagent) => {
          const waiting = subagent.waiting > 0 ? `  ${subagent.waiting} waiting` : "";
          const routed = subagent.lastRoutedAt
            ? `  last routed${subagent.lastRoutedEnvelopeId ? ` ${clean(subagent.lastRoutedEnvelopeId)}` : ""}${subagent.lastRoutedMailbox ? ` to ${subagent.lastRoutedMailbox}` : ""} at ${clean(subagent.lastRoutedAt)}`
            : "";
          return `  ${clean(subagent.id)}  ${subagent.state}  parent ${clean(subagent.parentInstance)}${waiting}${routed}`;
        },
      ),
    ),
    "",
    "INBOX",
    ...rowsOrNone(
      snapshot.inbox.envelopes.map(
        (envelope) =>
          `  ${clean(envelope.recipient)}  from ${clean(envelope.from)}  ${clean(envelope.type)}  ${clean(envelope.createdAt)}`,
      ),
    ),
    "",
    "OBJECTIVE LOOPS",
    ...rowsOrNone(
      snapshot.loops.items.map(
        (loop) =>
          `  ${clean(loop.id)}  ${clean(loop.status)}  ${loop.agents.length} agent(s)  ${clean(loop.name)}`,
      ),
    ),
    "",
    "REACHABLE PEERS",
    ...rowsOrNone(snapshot.presence.instances.map((instance) => `  ${clean(instance)}`)),
    "",
    "GATEWAY",
    `  ${renderGatewayBar(snapshot)}`,
  ];
  if (snapshot.gateway.provider) {
    lines.push(
      `  provider ${clean(snapshot.gateway.provider)}${snapshot.gateway.transport ? `  transport ${clean(snapshot.gateway.transport)}` : ""}`,
    );
  }
  if (snapshot.gateway.accountId) {
    lines.push(`  account id ${clean(snapshot.gateway.accountId)}`);
  }
  if (snapshot.gateway.reason) lines.push(`  ${clean(snapshot.gateway.reason)}`);
  if (snapshot.warnings.length > 0) {
    lines.push("", "WARNINGS", ...snapshot.warnings.map((warning) => `  ${clean(warning)}`));
  }
  return `${lines.join("\n")}\n`;
}

export interface StatusSurfaceStreams {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

export interface StatusSurfaceCliDependencies extends StatusSnapshotDependencies {
  readonly root: string;
  readonly openTmuxWindow?: (tmuxSession: string) => Promise<boolean>;
  readonly signal?: AbortSignal;
}

export function statusWatchIntervalMs(raw: string | undefined): number {
  if (!raw) return 5000;
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(raw.trim());
  if (!match) throw new Error("--interval must be a duration such as 2s or 500ms");
  const value = Number(match[1]);
  const ms = match[2] === "ms" ? value : value * 1000;
  if (!Number.isFinite(ms) || ms < 250) throw new Error("--interval must be at least 250ms");
  return Math.round(ms);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runStatusSurfaceCli(
  flags: Record<string, string>,
  streams: StatusSurfaceStreams,
  dependencies: StatusSurfaceCliDependencies,
): Promise<number> {
  const tmuxSession = flags["tmux-session"];
  if (flags["tmux-window"] === "true" || flags["tmux-window"]) {
    const target = flags["tmux-window"] === "true"
      ? tmuxSession
      : flags["tmux-window"];
    if (!target || !dependencies.openTmuxWindow) {
      streams.stderr.write("h2a status --tmux-window requires an exact managed session\n");
      return 1;
    }
    return (await dependencies.openTmuxWindow(target)) ? 0 : 1;
  }
  const renderOnce = async (): Promise<string> => {
    const segment =
      flags.segment === "workload" || flags.segment === "gateway"
        ? flags.segment
        : "all";
    const snapshot = await readStatusSnapshot(
      {
        root: dependencies.root,
        ...(tmuxSession ? { tmuxSession } : {}),
        ...(flags.bar === "true" && segment === "workload"
          ? { includeGateway: false }
          : {}),
      },
      dependencies,
    );
    if (flags.bar === "true") {
      return `${renderStatusBar(snapshot, segment)}\n`;
    }
    return renderHumanStatus(snapshot);
  };
  if (flags.watch !== "true") {
    streams.stdout.write(await renderOnce());
    return 0;
  }
  let wait: number;
  try {
    wait = statusWatchIntervalMs(flags.interval);
  } catch (error) {
    streams.stderr.write(`h2a status: ${(error as Error).message}\n`);
    return 1;
  }
  do {
    streams.stdout.write(`\u001b[2J\u001b[H${await renderOnce()}`);
    await delay(wait, dependencies.signal);
  } while (!dependencies.signal?.aborted);
  return 0;
}

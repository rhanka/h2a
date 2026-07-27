import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

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
  H2A_TERMINAL_LOOP_STATUSES,
  listObjectiveLoopsWithDiagnostics,
  type H2AObjectiveLoop,
} from "./runtime/loop/index.js";
import { loopAttendance } from "./runtime/loop/supervisor.js";

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
  readonly delegations?: {
    readonly executions: readonly StatusDelegatedExecution[];
    readonly degraded: boolean;
  };
  readonly gateway: {
    readonly state: StatusGatewayState;
    readonly requestedModel?: string;
    readonly upstreamModel?: string;
    readonly requestedModelTruncated?: boolean;
    readonly upstreamModelTruncated?: boolean;
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

export interface StatusDelegatedExecution {
  readonly id: string;
  readonly origin: "mcp:h2a_run" | "cli:h2a-delegate";
  readonly delegatorInstance: string;
  readonly delegatorTmuxSession: string;
  readonly tool: string;
  readonly state: "pending" | "running" | "throttled" | "failed";
}

export interface StatusMcpDelegationAttestation {
  readonly workerTmuxSession: string;
  readonly workerPid: number;
  readonly origin: "mcp:h2a_run";
  readonly delegatorInstance: string;
  readonly delegatorTmuxSession: string;
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
  readonly delegations: {
    readonly open: number;
    readonly attention: number;
    readonly degraded: boolean;
    readonly items: readonly StatusDelegatedExecution[];
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

interface StoredMcpDelegationAttestation extends StatusMcpDelegationAttestation {
  readonly version: 1;
  readonly recordedAt: string;
}

interface StoreProjection {
  readonly subagents: StatusSubagent[];
  readonly inbox: StatusInboxEnvelope[];
  readonly subagentsDegraded: boolean;
  readonly inboxDegraded: boolean;
  readonly warnings: string[];
}

export function cleanStatusText(value: unknown, maxScalars = 96): string {
  const normalized = String(value ?? "")
    // Host and tmux text is untrusted.  Strip every Unicode control/format
    // scalar (including ANSI controls, zero-width controls, and bidi marks)
    // before it becomes terminal text.
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
    .replace(/[#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scalars = Array.from(normalized);
  return scalars.length > maxScalars
    ? `${scalars.slice(0, maxScalars).join("")}[cut]`
    : normalized;
}

const clean = cleanStatusText;

function readJsonLines<T>(
  path: string,
  label: string,
  validate: (value: unknown) => value is T,
  warnings: string[],
  options: { readonly requireExists?: boolean; readonly maxBytes?: number } = {},
): { values: T[]; degraded: boolean } {
  if (!existsSync(path)) {
    if (options.requireExists) {
      warnings.push(`${label} is absent`);
      return { values: [], degraded: true };
    }
    return { values: [], degraded: false };
  }
  let text: string;
  try {
    if (options.maxBytes !== undefined) {
      // Do not preflight with stat then read the whole file: an append between
      // those operations would make this supposedly bounded bar reader ingest
      // unbounded history. Read only one byte past the budget instead.
      const fd = openSync(path, "r");
      try {
        const bytes = Buffer.allocUnsafe(options.maxBytes + 1);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        if (count > options.maxBytes) {
          warnings.push(`${label} exceeds its bounded read budget`);
          return { values: [], degraded: true };
        }
        text = bytes.subarray(0, count).toString("utf8");
      } finally {
        closeSync(fd);
      }
    } else {
      text = readFileSync(path, "utf8");
    }
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

function isStoredMcpDelegationAttestation(
  value: unknown,
): value is StoredMcpDelegationAttestation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredMcpDelegationAttestation>;
  return row.version === 1 &&
    row.origin === "mcp:h2a_run" &&
    typeof row.workerTmuxSession === "string" &&
    /^(?:h2a|remote)-[A-Za-z0-9_.#-]{1,120}$/.test(row.workerTmuxSession) &&
    typeof row.workerPid === "number" && Number.isInteger(row.workerPid) && row.workerPid > 0 &&
    typeof row.delegatorInstance === "string" &&
    INSTANCE_TOKEN.test(row.delegatorInstance) &&
    typeof row.delegatorTmuxSession === "string" &&
    /^(?:h2a|remote)-[A-Za-z0-9_.#-]{1,120}$/.test(row.delegatorTmuxSession) &&
    typeof row.recordedAt === "string" &&
    Number.isFinite(Date.parse(row.recordedAt));
}

function readMcpDelegationAttestations(
  root: string,
  warnings: string[],
): { values: StatusMcpDelegationAttestation[]; known: boolean } {
  const paths = localStorePaths(root);
  const records = readJsonLines(
    join(paths.registry, "mcp-delegations.jsonl"),
    "MCP delegation attestation",
    isStoredMcpDelegationAttestation,
    warnings,
    // This append-only launch history is not a status index. Bound the legacy
    // reader so a long-lived owner gets J? rather than an ever-growing five-
    // second scan or a partial-looking count.
    { maxBytes: 32 * 1024 },
  );
  return { values: records.values, known: !records.degraded };
}

function readStoreProjection(
  root: string,
  ownerInstance: string | undefined,
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
    { requireExists: true },
  );
  const audit = readJsonLines(
    paths.subagentAudit,
    "subagent audit",
    isStoredAudit,
    warnings,
    { requireExists: true },
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

  const inboxByRecipientAndId = new Map<string, StatusInboxEnvelope>();
  // An existing root alone is not an initialized h2a store. Without the inbox
  // collection there is no authority to report a reassuring zero.
  let inboxDegraded = !ownerInstance || !existsSync(paths.inbox);
  if (!ownerInstance) {
    warnings.push("exact tmux owner is unavailable");
  }
  if (!existsSync(paths.inbox)) {
    warnings.push("h2a inbox collection is absent");
  }
  const scopedRecipients = ownerInstance
    ? [
        ownerInstance,
        ...subagents
          .filter(
            (subagent) =>
              canonicalAddress(subagent.parentInstance) ===
              canonicalAddress(ownerInstance),
          )
          .map((subagent) => subagent.id),
      ]
    : [];
  const inboxDirectories = new Map<string, string>();
  for (const recipient of scopedRecipients) {
    const canonical = canonicalAddress(recipient);
    inboxDirectories.set(inboxDir(paths, recipient), canonical);
    inboxDirectories.set(inboxDirRaw(paths, recipient), canonical);
  }
  for (const [directoryPath, recipient] of inboxDirectories) {
    let files: string[];
    try {
      files = readdirSync(directoryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      warnings.push(`inbox ${clean(directoryPath)} could not be read`);
      inboxDegraded = true;
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const value: unknown = JSON.parse(
          readFileSync(join(directoryPath, file), "utf8"),
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
        warnings.push(`inbox ${clean(directoryPath)} contains a malformed envelope`);
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
    inboxDegraded: inboxDegraded || storedSubagents.degraded || audit.degraded,
    warnings,
  };
}

const ATTENTION_LOOP_STATES = new Set([
  "waiting-human",
  "stalled",
  "degraded",
  "blocked",
  "failed",
]);

const INSTANCE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/;

export interface StatusSnapshotDependencies {
  readonly projectRuntime?: (input: {
    tmuxSession?: string;
    ownerInstance?: string;
    includeGateway?: boolean;
    includeDelegations?: boolean;
    includeManagedInventory?: boolean;
    delegationAttestations?: readonly StatusMcpDelegationAttestation[];
    delegationAttestationsKnown?: boolean;
  }) => Promise<StatusRuntimeProjection>;
}

async function defaultRuntimeProjection(input: {
  tmuxSession?: string;
  ownerInstance?: string;
  includeGateway?: boolean;
  includeDelegations?: boolean;
  includeManagedInventory?: boolean;
  delegationAttestations?: readonly StatusMcpDelegationAttestation[];
  delegationAttestationsKnown?: boolean;
}): Promise<StatusRuntimeProjection> {
  const packageName: string = "@sentropic/h2a-runtime/status";
  const runtime = (await import(packageName)) as {
    projectStatusForH2a?: (options: {
      tmuxSession?: string;
      ownerInstance?: string;
      includeGateway?: boolean;
      includeDelegations?: boolean;
      includeManagedInventory?: boolean;
      delegationAttestations?: readonly StatusMcpDelegationAttestation[];
      delegationAttestationsKnown?: boolean;
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
    /** Instance attested by the local MCP sidecar for this exact tmux session. */
    readonly ownerInstance?: string;
    readonly includeGateway?: boolean;
    readonly includeDelegations?: boolean;
    readonly includeManagedInventory?: boolean;
    /** Human detail is the only path that reads ambient presence. */
    readonly includePresence?: boolean;
    readonly includeInbox?: boolean;
    readonly includeLoops?: boolean;
  },
  dependencies: StatusSnapshotDependencies = {},
): Promise<H2AStatusSnapshotV1> {
  const warnings: string[] = [];
  const ownerInstance = input.ownerInstance && INSTANCE_TOKEN.test(input.ownerInstance)
    ? input.ownerInstance
    : undefined;
  if (input.ownerInstance && !ownerInstance) {
    warnings.push("tmux owner instance is invalid");
  }
  // The gateway segment must stay independent of workload storage. It does
  // not need provenance records, so avoid even opening that collection there.
  const mcpDelegations = input.includeDelegations === false
    ? { values: [], known: true }
    : readMcpDelegationAttestations(input.root, warnings);
  let runtime: StatusRuntimeProjection;
  try {
    runtime = await (dependencies.projectRuntime ?? defaultRuntimeProjection)({
      ...(input.tmuxSession ? { tmuxSession: input.tmuxSession } : {}),
      ...(ownerInstance ? { ownerInstance } : {}),
      ...(input.includeGateway === false ? { includeGateway: false } : {}),
      ...(input.includeDelegations === false ? { includeDelegations: false } : {}),
      ...(input.includeManagedInventory === false
        ? { includeManagedInventory: false }
        : {}),
      delegationAttestations: mcpDelegations.values,
      delegationAttestationsKnown: mcpDelegations.known,
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
  let presenceDegraded = input.includePresence === false;
  if (input.includePresence !== false) {
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
  }
  const store = input.includeInbox === false
    ? {
        subagents: [],
        inbox: [],
        subagentsDegraded: true,
        inboxDegraded: true,
        warnings: [],
      }
    : readStoreProjection(input.root, ownerInstance);
  warnings.push(...store.warnings);

  let loops: H2AObjectiveLoop[] = [];
  let loopsDegraded = false;
  if (input.includeLoops === false) {
    loopsDegraded = true;
  } else {
    try {
      if (!existsSync(join(input.root, "loops"))) {
        loopsDegraded = true;
        warnings.push("h2a loops collection is absent");
      }
      const result = listObjectiveLoopsWithDiagnostics(input.root);
      loops = result.loops;
      loopsDegraded = loopsDegraded || result.warnings.length > 0;
      warnings.push(...result.warnings);
    } catch {
      loopsDegraded = true;
      warnings.push("objective loops could not be read");
    }
  }

  const delegatedExecutions = runtime.delegations?.executions ?? [];
  const openLoops = loops.filter(
    (loop) => !H2A_TERMINAL_LOOP_STATUSES.has(loop.status),
  );
  const loopAttention = new Set(
    loops
      .filter((loop) => ATTENTION_LOOP_STATES.has(loop.status))
      .map((loop) => loop.id),
  );
  for (const loop of openLoops) {
    try {
      if (loopAttendance(input.root, loop) === "unattended") {
        loopAttention.add(loop.id);
      }
    } catch {
      loopsDegraded = true;
      warnings.push(`loop ${clean(loop.id)} attendance could not be read`);
    }
  }
  return {
    kind: "h2a-status",
    version: 1,
    ...(input.tmuxSession || runtime.session.tmuxSession
      ? { tmuxSession: input.tmuxSession ?? runtime.session.tmuxSession }
      : {}),
    session: runtime.session,
    managed: {
      active: runtime.managed.agents.length,
      attention: 0,
      attentionComplete: runtime.managed.attentionComplete === true,
      degraded: runtime.managed.degraded,
      agents: runtime.managed.agents,
    },
    delegations: {
      open: delegatedExecutions.filter((execution) => execution.state !== "failed").length,
      attention: delegatedExecutions.filter(
        (execution) =>
          execution.state === "pending" ||
          execution.state === "throttled" ||
          execution.state === "failed",
      ).length,
      // A runtime built before delegated-execution provenance is deliberately
      // UNKNOWN: it has no authority to report a reassuring zero.
      degraded: runtime.delegations?.degraded !== false,
      items: delegatedExecutions,
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
      active: openLoops.length,
      attention: loopAttention.size,
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
): string {
  if (degraded) return `${prefix}?`;
  if (attention === undefined) return `${prefix}${count}`;
  return attention > 0 ? `${prefix}${count}!${attention}` : `${prefix}${count}`;
}

export function renderWorkloadBar(snapshot: H2AStatusSnapshotV1): string {
  if (snapshot.session.state === "absent") return "h2a absent";
  if (snapshot.session.state === "unknown") return "h2a ?";
  return [
    countSegment(
      "J",
      snapshot.delegations.open,
      snapshot.delegations.attention,
      snapshot.delegations.degraded,
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

function displayColumns(value: string): number {
  // The bar's width tier is terminal-cell based, not JS UTF-16 length. Model
  // ids are normally ASCII, but host-controlled text must not make us claim a
  // route fits when full-width or combining scalars say otherwise.
  let columns = 0;
  for (const scalar of value) {
    if (/\p{Mark}/u.test(scalar)) continue;
    const code = scalar.codePointAt(0)!;
    const wide =
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd));
    columns += wide ? 2 : 1;
  }
  return columns;
}

function wholeRouteId(value: string): string | undefined {
  // Model ids are identifiers, not a prose preview: a cut identifier could
  // name a different route. Cap host text but omit this optional detail when
  // that cap was reached, leaving the truthful gateway state visible.
  const rendered = clean(value, 96);
  return rendered.endsWith("[cut]") ? undefined : rendered;
}

export function renderGatewayBar(
  snapshot: H2AStatusSnapshotV1,
  maxColumns?: number,
): string {
  if (snapshot.session.state === "absent") return "gw n/a";
  if (snapshot.session.state === "unknown") return "gw ?";
  const gateway = snapshot.gateway;
  if (gateway.state === "off") return "gw off";
  if (gateway.state === "unavailable") return "gw unavailable";
  if (gateway.state === "unknown") return "gw ?";
  const state = gateway.state === "rate-limited" ? "429" : gateway.state;
  const parts = [`gw ${state}`];
  if (gateway.requestedModelTruncated || gateway.upstreamModelTruncated) {
    // We deliberately do not show a prefix of an identifier as if it named a
    // complete route. Make the omission explicit instead.
    const cut = "route [cut]";
    const candidate = `${parts[0]} · ${cut}`;
    if (maxColumns === undefined || displayColumns(candidate) <= maxColumns) {
      parts.push(cut);
    }
    return parts.join(" · ");
  }
  if (
    gateway.requestedModel &&
    gateway.upstreamModel &&
    !gateway.requestedModelTruncated &&
    !gateway.upstreamModelTruncated
  ) {
    const requested = wholeRouteId(gateway.requestedModel);
    const upstream = wholeRouteId(gateway.upstreamModel);
    if (requested && upstream) {
      const route = `${requested}→${upstream}`;
      const candidate = `${parts[0]} · ${route}`;
      if (maxColumns === undefined || displayColumns(candidate) <= maxColumns) {
        parts.push(route);
      }
    } else {
      const cut = "route [cut]";
      const candidate = `${parts[0]} · ${cut}`;
      if (maxColumns === undefined || displayColumns(candidate) <= maxColumns) {
        parts.push(cut);
      }
    }
  }
  return parts.join(" · ");
}

export function renderStatusBar(
  snapshot: H2AStatusSnapshotV1,
  segment: "workload" | "gateway" | "all" = "all",
  maxColumns?: number,
): string {
  if (segment === "workload") return renderWorkloadBar(snapshot);
  if (segment === "gateway") return renderGatewayBar(snapshot, maxColumns);
  return `${renderWorkloadBar(snapshot)}  ${renderGatewayBar(snapshot, maxColumns)}`;
}

function rowsOrNone(rows: readonly string[]): string[] {
  return rows.length > 0 ? [...rows] : ["  (none)"];
}

export function renderHumanStatus(snapshot: H2AStatusSnapshotV1): string {
  const lines: string[] = [
    `H2A STATUS${snapshot.tmuxSession ? ` — ${clean(snapshot.tmuxSession)}` : ""}`,
    `SESSION  ${snapshot.session.state}`,
    "",
    "RUNTIME INVENTORY (not used as liveness or owner-scoped work evidence)",
    ...rowsOrNone(
      snapshot.managed.agents.map(
        (agent) =>
          `  ${clean(agent.id)}  ${clean(agent.kind)}  ${clean(agent.tool)}  ${clean(agent.state)}`,
      ),
    ),
    "",
    "DELEGATED EXECUTIONS (owner-scoped, verified)",
    ...rowsOrNone(
      snapshot.delegations.items.map(
        (execution) =>
          `  ${clean(execution.id)}  ${execution.origin}  ${clean(execution.tool)}  ${execution.state}`,
      ),
    ),
    "",
    "H2A DELEGATION BINDINGS (inventory only)",
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
    "PRESENCE (not liveness evidence)",
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
        ...(flags["owner-instance"] ? { ownerInstance: flags["owner-instance"] } : {}),
        ...(flags.bar === "true" && segment === "workload"
          ? { includeGateway: false, includeManagedInventory: false }
          : {}),
        ...(flags.bar === "true" ? { includePresence: false } : {}),
        ...(flags.bar === "true" && segment === "gateway"
          ? {
              includeDelegations: false,
              includeManagedInventory: false,
              includeInbox: false,
              includeLoops: false,
            }
          : {}),
      },
      dependencies,
    );
    if (flags.bar === "true") {
      const width = flags.width && /^\d+$/.test(flags.width)
        ? Number(flags.width)
        : undefined;
      // Reserve room for the static left marker and the owner's prior right
      // segment. Route is omitted rather than silently cut when it cannot fit.
      const gatewayWidth = width === undefined ? undefined : Math.max(0, width - 32);
      return `${renderStatusBar(snapshot, segment, gatewayWidth)}\n`;
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

/** Closed, immutable attachment context captured by the stdio shim. */
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { currentIdentity } from "./handover/admission.js";
import { validate } from "./handover/formats.js";
import { digest } from "./handover/wire.js";
import { isSupportedCentralHost, type SupportedCentralHost } from "./mcp-central-qualification.js";

export const CENTRAL_ATTACHMENT_ENV = [
  "CLAUDE_CODE_SESSION_ID", "TMUX", "TMUX_PANE", "H2A_NATIVE_TARGET_SESSION",
  "H2A_NATIVE_PTY_SESSION", "H2A_NATIVE_SOCKET", "H2A_MCP_READY_FILE",
  "H2A_MCP_READY_NONCE", "H2A_IDENTITY_RETRY_MIN_MS", "H2A_HEARTBEAT_INTERVAL_MS",
  "H2A_NOTIFY_INTERVAL_MS", "H2A_SESSION_EXPIRY_MS"
] as const;
const FLAGS = new Set(["host", "auto-open", "wake", "name", "scope", "auto-upgrade", "upgrade-check", "registry-lock-digest"]);
export type CentralMcpAttachment = {
  version: 2;
  id: string;
  root: string;
  workspace: string;
  host: SupportedCentralHost;
  flags: Record<string, string>;
  env: Record<string, string>;
  resume?: boolean;
  expectedInstance?: string;
  shimProcessIdentity?: ReturnType<typeof currentIdentity>;
};

export function captureCentralAttachment(root: string, workspace: string, flags: Record<string, string>, env: NodeJS.ProcessEnv): CentralMcpAttachment {
  if (!isSupportedCentralHost(flags.host)) throw new Error("unsupported central attachment host");
  return {
    version: 2, id: randomUUID(), root, workspace, host: flags.host, shimProcessIdentity: currentIdentity(),
    flags: Object.fromEntries(Object.entries(flags).filter(([key]) => FLAGS.has(key))),
    env: Object.fromEntries(CENTRAL_ATTACHMENT_ENV.flatMap(key => env[key] === undefined ? [] : [[key, env[key]!]]))
  };
}

export function parseCentralAttachment(encoded: string, root: string): CentralMcpAttachment {
  if (encoded.length > 12_000) throw new Error("central attachment context exceeds budget");
  const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CentralMcpAttachment;
  if (value.version !== 2 || !isSupportedCentralHost(value.host) || !/^[0-9a-f-]{36}$/i.test(value.id) || value.root !== root ||
      !isAbsolute(value.workspace) || value.workspace.includes("\0") || !value.flags || typeof value.flags !== "object" || Array.isArray(value.flags) ||
      !value.env || typeof value.env !== "object" || Array.isArray(value.env)) throw new Error("invalid central attachment context or unsupported state root");
  for (const [key, v] of Object.entries(value.flags)) if (!FLAGS.has(key) || typeof v !== "string") throw new Error("unsupported central attachment flag");
  for (const [key, v] of Object.entries(value.env)) if (!(CENTRAL_ATTACHMENT_ENV as readonly string[]).includes(key) || typeof v !== "string" || v.includes("\0")) throw new Error("unsupported central attachment environment");
  if (value.flags.host !== value.host) throw new Error("central attachment host mismatch");
  // Claude binds its native conversation id; other hosts bind their routed
  // host tag until H6 measures real native session signals for them.
  if (value.host === "claude" && !value.env.CLAUDE_CODE_SESSION_ID?.trim()) throw new Error("central Claude attachment requires a native conversation id");
  if (value.resume !== undefined && typeof value.resume !== "boolean") throw new Error("invalid central resume context");
  if (value.expectedInstance !== undefined && typeof value.expectedInstance !== "string") throw new Error("invalid central resume identity");
  if (value.shimProcessIdentity) validate("processIdentity", value.shimProcessIdentity);
  return value;
}

/**
 * H3 — `SessionAdmissionEvidenceV1` (H2A-DISP-354, r2.md §6.2 + §8.1 H3).
 *
 * An inputs-only admission record for the memory host resolver: it binds what
 * the central ACTUALLY verified — the attachment (`attachmentRef`), the
 * per-request transport proof (`transportMac`), the fenced transport epoch,
 * the admitting host, the channel binding and the session id — plus the
 * identity correlation triple from the binding store. It grants NO authority:
 * no tenant, workspace, membership, scope, purpose or audit field exists on
 * it, and the consumer hashes it into its own connection proof.
 */
export interface SessionAdmissionIdentity {
  /** The perennial agent UUID (`H2AIdentityBinding.agentUuid`). */
  readonly agentUuid: string;
  /** The addressable instance handle `host:label:uuid12`. */
  readonly instanceId: string;
  /** The launch name (`flags.name` of the captured attachment). */
  readonly launchName: string;
}

export interface SessionAdmissionEvidenceV1 {
  readonly format: "h2a.session-admission/v1";
  readonly agentUuid: string;
  readonly instanceId: string;
  readonly launchName: string;
  readonly attachmentRef: string;
  readonly transportMac: string;
  readonly transportEpoch: string;
  readonly centralHost: SupportedCentralHost;
  readonly channelBinding: string;
  readonly sessionId: string;
  readonly verdict: "admitted";
  readonly admittedAt: string;
  readonly signedRequestId: string;
  /** Transport-family digest (`sha256:<64hex>`) over the record without itself. */
  readonly evidenceDigest: string;
}

/** Closed channel-binding set (consumer-context §1 binding union). */
export const SESSION_ADMISSION_CHANNEL_BINDINGS = [
  "in_process_verified",
  "stdio_host_managed_verified",
  "http_mcp_auth_dpop_verified",
  "http_mcp_auth_bearer_verified"
] as const;

export type SessionAdmissionEvidenceParts = Omit<SessionAdmissionEvidenceV1, "format" | "verdict" | "evidenceDigest">;

const MAC_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EPOCH_PATTERN = /^[1-9][0-9]*$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function evidenceField(parts: SessionAdmissionEvidenceParts, field: keyof SessionAdmissionEvidenceParts, pattern?: RegExp): string {
  const value = parts[field];
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new Error(`invalid session admission evidence: ${String(field)}`);
  }
  return value;
}

export function sessionAdmissionEvidenceDigest(record: Omit<SessionAdmissionEvidenceV1, "evidenceDigest">): string {
  return digest(record);
}

/**
 * Strict H3 builder: every structural rule below is a verified-binding rule,
 * so violations are programmer errors at construction and throw. Runtime
 * material (which can be absent or partial) goes through the total
 * assembler in `mcp-central-attachment.ts`, which returns undefined instead.
 */
export function buildSessionAdmissionEvidence(parts: SessionAdmissionEvidenceParts): SessionAdmissionEvidenceV1 {
  const attachmentRef = evidenceField(parts, "attachmentRef");
  const transportMac = evidenceField(parts, "transportMac", MAC_PATTERN);
  const transportEpoch = evidenceField(parts, "transportEpoch", EPOCH_PATTERN);
  const centralHost = evidenceField(parts, "centralHost");
  if (!isSupportedCentralHost(centralHost)) throw new Error("invalid session admission evidence: centralHost");
  const channelBinding = evidenceField(parts, "channelBinding");
  if (!(SESSION_ADMISSION_CHANNEL_BINDINGS as readonly string[]).includes(channelBinding)) throw new Error("invalid session admission evidence: channelBinding");
  const sessionId = evidenceField(parts, "sessionId");
  const agentUuid = evidenceField(parts, "agentUuid", UUID_PATTERN);
  const launchName = evidenceField(parts, "launchName");
  const instanceId = evidenceField(parts, "instanceId");
  if (instanceId !== `${centralHost}:${launchName}:${agentUuid.replace(/-/g, "").slice(0, 12)}`) {
    throw new Error("invalid session admission evidence: instanceId does not bind host, launchName and agentUuid");
  }
  const admittedAt = evidenceField(parts, "admittedAt", INSTANT_PATTERN);
  const signedRequestId = evidenceField(parts, "signedRequestId");
  const record: Omit<SessionAdmissionEvidenceV1, "evidenceDigest"> = {
    format: "h2a.session-admission/v1", agentUuid, instanceId, launchName, attachmentRef,
    transportMac, transportEpoch, centralHost, channelBinding, sessionId,
    verdict: "admitted", admittedAt, signedRequestId
  };
  return { ...record, evidenceDigest: sessionAdmissionEvidenceDigest(record) };
}

/** Total H3 verifier: true only for a complete, consistent, untampered record. */
export function verifySessionAdmissionEvidence(evidence: unknown): evidence is SessionAdmissionEvidenceV1 {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) return false;
  const value = evidence as Record<string, unknown>;
  if (value.format !== "h2a.session-admission/v1" || value.verdict !== "admitted") return false;
  try {
    const { evidenceDigest, ...record } = value as unknown as SessionAdmissionEvidenceV1;
    if (typeof evidenceDigest !== "string" || sessionAdmissionEvidenceDigest(record) !== evidenceDigest) return false;
    buildSessionAdmissionEvidence(record);
    return true;
  } catch {
    return false;
  }
}

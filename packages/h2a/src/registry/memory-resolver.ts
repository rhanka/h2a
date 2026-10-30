/**
 * H2A-DISP-354 — the injectable memory host resolver port (r2.md §6.2, §8.2
 * row 5; consumer-context §1–§4).
 *
 * The interim direct-field ctx (the raw `{context, participant}` attachment
 * object) is REPLACED by this typed port: per call the daemon supplies the
 * H3 session admission evidence and the caller's cancellation, and the bound
 * resolver — the memory host, cluster-mesh at cutover, a deterministic
 * contract double in tests — returns the closed host invocation context plus
 * the F15 per-call tool set and policy revision. No resolver, no evidence or
 * an out-of-set tool means NO producer dispatch (fail-closed, zero calls).
 *
 * h2a types the producer seam structurally and never imports mesh or engram
 * internals: `runtime.server.callTool(name, args, ctx, envelope?, signal?)`.
 */
import type { SessionAdmissionEvidenceV1 } from "../runtime/mcp-central-context.js";
import type { CentralAdmissionTransport } from "../runtime/mcp-central-attachment.js";
import type { MemoryProviderRegistration } from "./memory-provider.js";

/**
 * The lateral transport material the daemon binds per call. It rides as a
 * SIBLING of the H3 evidence, never inside the frozen 11-key record
 * (spec-r4-h2a-cosign.md §3.4 action 1).
 */
export type MemoryHostTransportMaterial = CentralAdmissionTransport;

export interface MemoryHostResolveInput {
  /** The exact tool being dispatched. */
  readonly tool: string;
  /** The caller's arguments, unmodified. */
  readonly args: Record<string, unknown>;
  /** H3 session admission evidence (inputs only; no authority). */
  readonly evidence: SessionAdmissionEvidenceV1;
  /** The verified transport material of the admitted request (MAC, channel binding, session id). */
  readonly transport?: MemoryHostTransportMaterial;
  /** Caller cancellation for this call, when the transport provides one. */
  readonly signal?: AbortSignal;
}

export interface MemoryHostResolvedContext {
  /** Closed host invocation context (opaque to h2a; never fabricated here). */
  readonly context: unknown;
  /** F15 per-call allowed tool set; the daemon refuses out-of-set tools. */
  readonly allowedTools: readonly string[];
  /** F15 policy revision stamped on this decision. */
  readonly policyRevision: string;
}

export type MemoryHostResolution = ({ ok: true } & MemoryHostResolvedContext) | { ok: false; code: string; message: string };

export interface MemoryHostResolverPort {
  resolveContext(input: MemoryHostResolveInput): Promise<MemoryHostResolution>;
}

/** The producer runtime's per-call dispatch seam (consumer-context §1/§2). */
export interface MemoryRuntimeServer {
  callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: unknown,
    envelope?: { idempotencyKey?: string; elicitationRef?: string },
    signal?: AbortSignal
  ): Promise<unknown>;
}

/** Marker for a typed resolver refusal surfacing as a domain refusal. */
const RESOLVER_REFUSAL = Symbol("h2a.memoryResolverRefusal");

export function isMemoryResolverRefusal(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { [RESOLVER_REFUSAL]?: unknown })[RESOLVER_REFUSAL] === true;
}

export function memoryResolverRefusal(code: string, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code, [RESOLVER_REFUSAL]: true });
}

/**
 * Structural read of the registration's producer runtime handle: the mesh
 * builtin exposes `runtime()` post-selection; its `server.callTool` is the
 * production-capable dispatch entry. Anything else is a wiring defect and
 * yields undefined (the daemon refuses fail-closed).
 */
export function memoryRuntimeServer(registration: MemoryProviderRegistration | undefined): MemoryRuntimeServer | undefined {
  const handle = registration?.builtin?.runtime?.() as { close?: unknown; server?: unknown } | undefined;
  const server = handle?.server;
  if (!server || typeof (server as { callTool?: unknown }).callTool !== "function") return undefined;
  return server as MemoryRuntimeServer;
}

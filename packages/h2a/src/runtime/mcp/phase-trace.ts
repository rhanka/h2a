/**
 * Per-phase MCP boot/serve tracing (lot L0 — measurement & diagnosis only).
 *
 * Emits correlated, closed-field JSONL spans to an injected stderr writer so a
 * host or an out-of-process measurement probe can reconstruct the whole
 * `mcp-serve` lifecycle — process start, identity resolution, lock waits,
 * registry reads, transport `initialize` / `tools/list` / first tool — WITHOUT
 * pulling in the CLI or the heavy runtime. It has three properties the rest of
 * the fix relies on:
 *
 *  1. **Passive.** A measurement callback can never fail the MCP protocol:
 *     every emit is wrapped, a writer throw is swallowed, and the trace has no
 *     side effect on the JSON-RPC stream (it only ever writes to stderr).
 *  2. **Confidential.** Fields are a fixed whitelist and every string is
 *     sanitized + length-capped, so no PEM, token, lock payload or binding
 *     content can ever reach an event — even if a caller passes it by mistake.
 *  3. **Monotonic + correlated.** Every event carries `attemptId` (a locally
 *     minted UUID — a child process cannot inherit an identity from the MCP
 *     client), `pid`, a per-trace `seq`, and a monotonic `monotonicMs`. Two
 *     processes are correlated by matching events, never by subtracting their
 *     independent monotonic clocks.
 *
 * `H2A_MCP_TRACE=1` turns on the detailed spans (`begin`/`end` of internal
 * phases). Lifecycle milestones and failure diagnostics stay visible without
 * the flag.
 */

import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

/** Log line prefix; every trace event is `${TRACE_LINE_PREFIX}${json}\n` on stderr. */
export const TRACE_LINE_PREFIX = "h2a.mcp.phase ";

/** Env flag that turns on detailed (`begin`/`end`) spans. */
export const TRACE_DETAIL_ENV = "H2A_MCP_TRACE";

export type McpTraceRole = "server" | "identity-child";
export type McpTraceEventKind = "begin" | "end" | "error" | "sample";

/** The wire event. `v:1` is the schema version; keep additions backward-safe. */
export interface McpTraceEvent {
  readonly v: 1;
  readonly attemptId: string;
  readonly pid: number;
  readonly role: McpTraceRole;
  readonly seq: number;
  readonly monotonicMs: number;
  readonly phase: string;
  readonly event: McpTraceEventKind;
  readonly durationMs?: number;
  readonly requestId?: string | number;
  readonly method?: string;
  readonly tool?: string;
  readonly bytes?: number;
  readonly waitMs?: number;
  readonly holdMs?: number;
  readonly code?: string | number;
}

/** The only fields a caller may attach. Everything else is dropped. */
export interface McpTraceFields {
  readonly requestId?: string | number;
  readonly method?: string;
  readonly tool?: string;
  readonly bytes?: number;
  readonly waitMs?: number;
  readonly holdMs?: number;
  readonly code?: string | number;
  readonly durationMs?: number;
}

export interface McpTraceOptions {
  readonly role?: McpTraceRole;
  /** Locally minted UUID; never taken from the MCP client. */
  readonly attemptId?: string;
  readonly pid?: number;
  /** Injected sink; defaults to a swallow-on-throw `process.stderr` writer. */
  readonly writer?: (line: string) => void;
  /** Monotonic clock; defaults to `performance.now`. */
  readonly now?: () => number;
  /** Force detailed spans on/off; defaults to `env[H2A_MCP_TRACE] === "1"`. */
  readonly detailed?: boolean;
  readonly env?: Record<string, string | undefined>;
}

export interface McpTrace {
  readonly attemptId: string;
  readonly role: McpTraceRole;
  readonly pid: number;
  readonly detailed: boolean;
  /** A lifecycle milestone (`sample`). Always emitted — this is a diagnostic. */
  phase(name: string, fields?: McpTraceFields): void;
  /** Start of a detailed span. Emitted only when `detailed`. */
  begin(name: string, fields?: McpTraceFields): void;
  /** End of a detailed span. Emitted only when `detailed`. */
  end(name: string, fields?: McpTraceFields): void;
  /** A failure. Always emitted, flag or not. */
  error(name: string, fields?: McpTraceFields): void;
  /** Wrap `fn`: `begin`/`end` when detailed, an `error` event on throw always. */
  span<T>(name: string, fn: () => T, fields?: McpTraceFields): T;
  /** A correlated sub-trace (same `attemptId`) for a child role. */
  child(role: McpTraceRole, options?: Pick<McpTraceOptions, "pid" | "writer">): McpTrace;
}

const MAX_STR = 200;

/** Strip control chars / newlines and cap length so a JSONL line stays one line. */
function safeStr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === "string" ? value : String(value);
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > MAX_STR ? cleaned.slice(0, MAX_STR) : cleaned;
}

function safeNum(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  return Number.isFinite(value) ? value : undefined;
}

function safeId(value: unknown): string | number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return safeStr(value);
}

/** Default writer: never throws into the caller (a broken stderr is not fatal). */
function defaultWriter(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    /* a measurement sink must never break the protocol */
  }
}

class Trace implements McpTrace {
  readonly attemptId: string;
  readonly role: McpTraceRole;
  readonly pid: number;
  readonly detailed: boolean;
  private readonly writer: (line: string) => void;
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private seq = 0;

  constructor(options: McpTraceOptions) {
    this.env = options.env ?? process.env;
    this.role = options.role ?? "server";
    this.attemptId = options.attemptId ?? randomUUID();
    this.pid = options.pid ?? process.pid;
    this.writer = options.writer ?? defaultWriter;
    this.now = options.now ?? (() => performance.now());
    this.detailed =
      options.detailed ?? this.env[TRACE_DETAIL_ENV] === "1";
  }

  private emit(phase: string, kind: McpTraceEventKind, fields?: McpTraceFields): void {
    try {
      const event: McpTraceEvent = {
        v: 1,
        attemptId: this.attemptId,
        pid: this.pid,
        role: this.role,
        seq: this.seq++,
        monotonicMs: Math.round(this.now() * 1000) / 1000,
        phase: safeStr(phase) ?? "unknown",
        event: kind,
        ...withField("durationMs", safeNum(fields?.durationMs)),
        ...withField("requestId", safeId(fields?.requestId)),
        ...withField("method", safeStr(fields?.method)),
        ...withField("tool", safeStr(fields?.tool)),
        ...withField("bytes", safeNum(fields?.bytes)),
        ...withField("waitMs", safeNum(fields?.waitMs)),
        ...withField("holdMs", safeNum(fields?.holdMs)),
        ...withField("code", safeId(fields?.code))
      };
      this.writer(`${TRACE_LINE_PREFIX}${JSON.stringify(event)}\n`);
    } catch {
      /* the trace is best-effort; it never disturbs the caller */
    }
  }

  phase(name: string, fields?: McpTraceFields): void {
    this.emit(name, "sample", fields);
  }

  begin(name: string, fields?: McpTraceFields): void {
    if (this.detailed) this.emit(name, "begin", fields);
  }

  end(name: string, fields?: McpTraceFields): void {
    if (this.detailed) this.emit(name, "end", fields);
  }

  error(name: string, fields?: McpTraceFields): void {
    this.emit(name, "error", fields);
  }

  span<T>(name: string, fn: () => T, fields?: McpTraceFields): T {
    const start = this.now();
    if (this.detailed) this.emit(name, "begin", fields);
    try {
      const out = fn();
      if (this.detailed) {
        this.emit(name, "end", { ...fields, durationMs: round3(this.now() - start) });
      }
      return out;
    } catch (err) {
      this.emit(name, "error", {
        ...fields,
        durationMs: round3(this.now() - start),
        code: err instanceof Error ? err.name : "error"
      });
      throw err;
    }
  }

  child(role: McpTraceRole, options?: Pick<McpTraceOptions, "pid" | "writer">): McpTrace {
    return new Trace({
      role,
      attemptId: this.attemptId,
      detailed: this.detailed,
      now: this.now,
      env: this.env,
      ...(options?.pid !== undefined ? { pid: options.pid } : {}),
      ...(options?.writer !== undefined ? { writer: options.writer } : {})
    });
  }
}

function withField<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function round3(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

/** Create a fresh trace. `attemptId` defaults to a locally minted UUID. */
export function createMcpTrace(options: McpTraceOptions = {}): McpTrace {
  return new Trace(options);
}

// --- Ambient, process-wide active trace ------------------------------------
//
// The boot path threads through many modules (bin → cli → identity → store →
// stdio). Rather than plumb a trace object through every signature, the entry
// point installs ONE active trace and the deep modules reach it via
// `getActiveMcpTrace()`. When none is installed (a normal CLI verb, or a unit
// test), every deep call is a no-op via optional chaining.

let active: McpTrace | undefined;

export function setActiveMcpTrace(trace: McpTrace | undefined): void {
  active = trace;
}

export function getActiveMcpTrace(): McpTrace | undefined {
  return active;
}

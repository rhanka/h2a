// AGY/Claude shared contract — VENDORED copy of
// `packages/h2a/src/runtime/agy-claude.ts` (see agy-claude-vendor-sync.test.ts).
// Why vendored instead of imported: this module is a leaf (node builtins
// only) that both the runtime and the core need; a cross-package import in
// either direction creates an undeclared edge that breaks isolated installs
// of this package (MODULE_NOT_FOUND at host startup) or an unorderable
// typecheck cycle. Edit the CORE copy first, then sync this file exactly
// (the sync test fails closed on any drift).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const AGY_CLAUDE_QUOTA_CODE = "agy-claude-quota-exhausted";
export type AgyEffort = "low" | "medium" | "high";
export class AgyEffortError extends Error {
  readonly code = "agy-effort-unsupported";
}
export function normalizeAgyEffort(effort: string | undefined): AgyEffort | undefined {
  if (effort === undefined) return undefined;
  if (effort === "max") return "high";
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  throw new AgyEffortError(`invalid AGY effort ${effort}; AGY effort must be low|medium|high (max maps to high)`);
}
export function isAgyClaudeModel(model: string | undefined): boolean {
  return model?.startsWith("claude-") ?? false;
}
export function resolveAgyModel(model: string | undefined, effort?: string): string | undefined {
  const level = normalizeAgyEffort(effort);
  const claude = model && /^(claude-(?:opus|sonnet)-5-5)(?:-(.*))?$/.exec(model);
  if (claude) {
    // Validate a supplied suffix even when a separate effort overrides it.
    const suffix = normalizeAgyEffort(claude[2]);
    const resolved = level ?? suffix;
    return resolved ? `${claude[1]}-${resolved}` : model;
  }
  return model;
}
export class AgyClaudeBuildOptInError extends Error {
  readonly code = "agy-claude-build-requires-opt-in";
}
export function assertAgyClaudeBuildAllowed(options: {
  profile: string; model?: string | undefined; role?: string | undefined; allowClaudeBuild?: boolean | undefined;
}): void {
  if (options.role !== undefined && !["review", "challenge", "build"].includes(options.role)) {
    throw new Error("invalid agy run role: expected review|challenge|build");
  }
  if (options.profile === "agy" && isAgyClaudeModel(options.model) && options.role === "build" && options.allowClaudeBuild !== true) {
    throw new AgyClaudeBuildOptInError("AGY Claude credits are reserved for reviews and adversarial challenges; build requires --allow-claude-build");
  }
}
export type AgyClaudeQuotaStatus = {
  status: "unknown" | "exhausted";
  observedAt?: string;
  resetsAt?: string;
  signature?: string;
};
export function detectAgyClaudeQuotaExhaustion(output: string, now = Date.now()): {
  exhausted: boolean; signature?: string; resetsAt?: string;
} {
  let preliminary: { exhausted: boolean; signature?: string } = { exhausted: false };
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!;
    // Provider diagnostics only: prose mentioning 429/quota is not evidence.
    if (!/^\s*(?:AGY_ERROR\s*\{|(?:API )?error\s*:)/i.test(line)) continue;
    let structured = /AGY_ERROR\s*(\{.*)/.exec(line)?.[1];
    if (structured) {
      // Native/tmux screen captures insert newlines at visual column wraps,
      // including inside JSON strings. Reassemble only an anchored diagnostic,
      // require complete JSON, and never consume the next provider diagnostic.
      let end = index;
      for (;;) {
        try { JSON.parse(structured); break; } catch {
          const next = lines[end + 1];
          if (next === undefined || /^\s*(?:AGY_ERROR\s*\{|(?:API )?error\s*:)/i.test(next)) break;
          structured += next;
          end++;
        }
      }
      try { JSON.parse(structured); } catch { continue; } // Partial chunks still prove no complete reset.
      line = `AGY_ERROR ${structured}`;
      index = end;
    }
    let signature: string | undefined;
    if (/\b429\b/.test(line)) signature = "agy-claude:http-429";
    else if (/RESOURCE_EXHAUSTED/i.test(line)) signature = "agy-claude:resource-exhausted";
    else if (/quota (?:exceeded|reached)|individual quota/i.test(line)) signature = "agy-claude:quota-exceeded";
    if (!signature) continue;
    const duration = /Resets in\s+((?:\d+(?:\.\d+)?\s*[dhms]\s*)+)/i.exec(line)?.[1];
    let ms = 0;
    if (duration) for (const part of duration.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
      ms += Number(part[1]) * ({ d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }[part[2]!.toLowerCase()] ?? 0);
    }
    const resetsAt = duration && Number.isFinite(now + ms) && ms < 8.64e15 - now
      ? new Date(now + ms).toISOString() : undefined;
    if (resetsAt) return { exhausted: true, signature, resetsAt };
    preliminary = { exhausted: true, signature };
  }
  return preliminary;
}
export class AgyClaudeQuotaExhaustedError extends Error {
  readonly code = AGY_CLAUDE_QUOTA_CODE;
  readonly retrySafe = false;
  readonly retryable = false;
  readonly quota: AgyClaudeQuotaStatus;
  constructor(readonly signature: string, output: string, now = Date.now()) {
    super("AGY Claude quota exhausted; no fallback or automatic retry. The caller chooses the next action.");
    const detected = detectAgyClaudeQuotaExhaustion(output, now);
    this.quota = { status: "exhausted", signature, observedAt: new Date(now).toISOString(),
      ...(detected.resetsAt ? { resetsAt: detected.resetsAt } : {}) };
  }
  get resetsAt(): string | undefined { return this.quota.resetsAt; }
}
export function agyClaudeQuotaError(signature: string, output: string, now = Date.now()): AgyClaudeQuotaExhaustedError {
  return new AgyClaudeQuotaExhaustedError(signature, output, now);
}
export function agyQuotaStatusPath(): string {
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "h2a", "agy-claude-quota.json");
}
export function readAgyClaudeQuotaStatus(path = agyQuotaStatusPath()): AgyClaudeQuotaStatus {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as AgyClaudeQuotaStatus;
    if (value.status === "exhausted" && typeof value.observedAt === "string" && Number.isFinite(Date.parse(value.observedAt))) {
      return { status: value.status, observedAt: value.observedAt,
        ...(typeof value.signature === "string" ? { signature: value.signature } : {}),
        ...(typeof value.resetsAt === "string" && Number.isFinite(Date.parse(value.resetsAt)) ? { resetsAt: value.resetsAt } : {}) };
    }
  } catch { /* No provider observation: never invent availability. */ }
  return { status: "unknown" };
}
export function writeAgyClaudeQuotaStatus(status: AgyClaudeQuotaStatus, path = agyQuotaStatusPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(status), { mode: 0o600 });
  renameSync(temporary, path);
}

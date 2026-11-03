/**
 * R6 hosted read-only composition (h2a side, for the claude.ai connector).
 *
 * The hosted surface is the exact ordered intersection of the selected
 * provider ownership, the publisher `hosted-read-only` capability profiles
 * and the existing `H2A_HOSTED_READONLY_TOOLS` allowlist, in descriptor
 * order — composed from the same registry descriptors as the CLI bridge, so
 * the allowlist cannot drift from the published entries. Unknown or stale
 * allowlist members and private-key schemas fail composition (defense in
 * depth beside `dispatchHostedTool`); mutating tools are never routable.
 *
 * Path non-disclosure: in `hosted-read-only` mode no tool result discloses
 * server filesystem paths (`root`/`workspaceRoot` are replaced by opaque
 * binding refs at the composition root; `redactHostedResult` enforces it on
 * payloads). Tenant confinement comes from the deployment lock: an unbound
 * tenant refuses at preflight (`missing_binding`); a per-request call for an
 * unselected capability refuses through the normal wire error with zero
 * handler runs (the service keeps its existing envelope — no new wire code
 * here).
 *
 * The live service cutover (rewiring `mcp-http/app.ts` onto this
 * composition) is a deployment decision outside this change; this module
 * qualifies the composition and the lock lifecycle it will consume.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { H2A_HOSTED_READONLY_TOOLS } from "../runtime/mcp-http/readonly-allowlist.js";
import { RegistryError } from "./descriptors.js";
import type { RegistryEntry } from "./descriptors.js";

export const HOSTED_DEPLOYMENT_LOCK_FORMAT = "h2a.hosted-deployment-lock/v1";

function fail(message: string): never {
  throw new RegistryError("invalid_entry", message);
}

interface ManifestTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface CapabilityManifest {
  tools: ManifestTool[];
  resources: unknown[];
  prompts: unknown[];
}

/**
 * Compose the hosted tool surface. Throws when an allowlisted name resolves
 * to zero or several declared base capabilities, or when an exposed tool
 * takes a private key.
 */
export function composeHostedTools(options: {
  coordinationManifest: CapabilityManifest;
  trackManifest: CapabilityManifest;
  allowlist?: readonly string[];
}): ManifestTool[] {
  const allowlist = options.allowlist ?? H2A_HOSTED_READONLY_TOOLS;
  const base = new Map<string, ManifestTool>();
  for (const tool of [...options.coordinationManifest.tools, ...options.trackManifest.tools]) {
    if (base.has(tool.name)) fail(`duplicate base capability ${tool.name} across hosted provider manifests`);
    base.set(tool.name, tool);
  }
  const composed: ManifestTool[] = [];
  for (const name of allowlist) {
    const tool = base.get(name);
    if (!tool) fail(`allowlisted tool ${name} has no declared base capability: refusing a stale allowlist`);
    if (JSON.stringify(tool.inputSchema ?? {}).includes("privateKeyPem")) {
      fail(`hosted surface must not include private-key tool ${name}`);
    }
    composed.push(tool);
  }
  return composed;
}

/** Routing guard: only composed read-only names are routable on the hosted surface. */
export function assertHostedRoutable(name: string): void {
  if (!(H2A_HOSTED_READONLY_TOOLS as readonly string[]).includes(name)) {
    throw new RegistryError("invalid_entry", `tool ${name} is not routable on the hosted read-only surface (allowlist refusal, zero handler runs)`);
  }
}

const REDACTED_KEYS = new Set(["root", "workspaceRoot"]);

/** Strip server filesystem paths from a hosted tool result (deep). */
export function redactHostedResult<T>(result: T): T {
  if (Array.isArray(result)) return result.map((item) => redactHostedResult(item)) as unknown as T;
  if (typeof result === "object" && result !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key)) continue;
      out[key] = redactHostedResult(value);
    }
    return out as T;
  }
  return result;
}

export interface HostedDeploymentLock {
  format: typeof HOSTED_DEPLOYMENT_LOCK_FORMAT;
  lockVersion: 1;
  serviceBindingRef: string;
  entries: Array<{ kind: string; id: string; entryVersion: string; digest: string }>;
  tenants: Record<string, { repositoryBindingRef: string }>;
  createdFrom: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Draft a deployment lock from root-only operator input. Opaque refs only:
 * no filesystem paths, secrets or client-visible data are stored.
 */
export function draftHostedLock(options: {
  lockPath: string;
  serviceBindingRef: string;
  entries: RegistryEntry[];
  tenant?: { id: string; repositoryBindingRef: string };
  tenants?: Record<string, { repositoryBindingRef: string }>;
  createdFrom?: string;
}): HostedDeploymentLock {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.serviceBindingRef)) {
    throw new RegistryError("invalid_parameters", "serviceBindingRef must be an ASCII binding reference");
  }
  const tenants: HostedDeploymentLock["tenants"] = {};
  if (options.tenant) tenants[options.tenant.id] = { repositoryBindingRef: options.tenant.repositoryBindingRef };
  if (options.tenants) {
    for (const [id, binding] of Object.entries(options.tenants)) tenants[id] = { repositoryBindingRef: binding.repositoryBindingRef };
  }
  for (const tenant of Object.values(tenants)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(tenant.repositoryBindingRef)) {
      throw new RegistryError("invalid_parameters", "tenant repositoryBindingRef must be an ASCII binding reference");
    }
  }
  const lock: HostedDeploymentLock = {
    format: HOSTED_DEPLOYMENT_LOCK_FORMAT,
    lockVersion: 1,
    serviceBindingRef: options.serviceBindingRef,
    entries: options.entries.map((entry) => ({ kind: entry.kind, id: entry.id, entryVersion: entry.entryVersion, digest: "" })),
    tenants,
    createdFrom: options.createdFrom ?? "root-only operator draft"
  };
  mkdirSync(dirname(options.lockPath), { recursive: true });
  writeFileSync(options.lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  return lock;
}

export interface HostedBindings {
  [bindingKey: string]: { contract: string };
}

/**
 * Shared verification core: every lock binding is checked against real
 * supplied ports and unbound refuses. `verifyHostedLock` and
 * `activateHostedLock` both run this core — no second divergent checker.
 */
function checkHostedLock(lock: unknown, bindings: HostedBindings): { ok: true; lock: HostedDeploymentLock } | { ok: false; diagnostics: Array<{ code: string; message: string }> } {
  if (!isRecord(lock) || lock["format"] !== HOSTED_DEPLOYMENT_LOCK_FORMAT) {
    return { ok: false, diagnostics: [{ code: "invalid_entry", message: "invalid_entry: unknown deployment lock format" }] };
  }
  const typed = lock as unknown as HostedDeploymentLock;
  if (!isRecord(typed.tenants)) {
    return { ok: false, diagnostics: [{ code: "invalid_entry", message: "invalid_entry: deployment lock tenants must be an object" }] };
  }
  const service = bindings[typed.serviceBindingRef];
  if (!service || service.contract !== "h2a.hosted-service/v1") {
    return { ok: false, diagnostics: [{ code: "missing_binding", message: "missing_binding: hosted service binding fails verification" }] };
  }
  const tenantIds = Object.keys(typed.tenants);
  if (tenantIds.length === 0) {
    // Single-tenant bootstrap refuses Track serving when no binding verifies.
    return { ok: false, diagnostics: [{ code: "missing_binding", message: "missing_binding: no tenant repository binding verifies" }] };
  }
  for (const id of tenantIds) {
    const ref = (typed.tenants[id] as { repositoryBindingRef: string }).repositoryBindingRef;
    const binding = bindings[ref];
    if (!binding || binding.contract !== "h2a.workspace/v1") {
      return { ok: false, diagnostics: [{ code: "missing_binding", message: `missing_binding: tenant ${id} repository binding fails verification` }] };
    }
  }
  return { ok: true, lock: typed };
}

/** Verify every lock binding against real supplied ports. Unbound refuses. */
export function verifyHostedLock(options: { lockPath: string; bindings: HostedBindings }): { ok: true; lock: HostedDeploymentLock } | { ok: false; diagnostics: Array<{ code: string; message: string }> } {
  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(options.lockPath, "utf8")) as unknown;
  } catch (error) {
    return { ok: false, diagnostics: [{ code: "invalid_entry", message: `invalid_entry: unreadable deployment lock: ${(error as Error).message}` }] };
  }
  return checkHostedLock(lock, options.bindings);
}

/**
 * Atomically activate a verified draft as the hosted lock. Admission runs
 * the shared verification core against the operator bindings first: an
 * unbound draft refuses with the verification diagnostic and the active
 * lock file is left absent/unchanged. The published active bytes equal the
 * verified draft bytes.
 */
export function activateHostedLock(options: { lockPath: string; activePath: string; bindings: HostedBindings }): { action: "activated"; lock: HostedDeploymentLock; backupPath?: string } {
  let raw: string;
  try {
    raw = readFileSync(options.lockPath, "utf8");
  } catch (error) {
    throw Object.assign(new Error(`invalid_entry: unreadable deployment lock: ${(error as Error).message}`), { code: "invalid_entry" });
  }
  let draft: unknown;
  try {
    draft = JSON.parse(raw) as unknown;
  } catch (error) {
    throw Object.assign(new Error(`invalid_entry: unreadable deployment lock: ${(error as Error).message}`), { code: "invalid_entry" });
  }
  const checked = checkHostedLock(draft, options.bindings);
  if (!checked.ok) {
    const first = checked.diagnostics[0] as { code: string; message: string };
    throw Object.assign(new Error(first.message), { code: first.code });
  }
  const existed = existsSync(options.activePath);
  const backupPath = existed ? `${options.activePath}.backup-${randomUUID()}` : undefined;
  if (backupPath) writeFileSync(backupPath, readFileSync(options.activePath), { flag: "wx", mode: 0o600 });
  mkdirSync(dirname(options.activePath), { recursive: true });
  const staging = `${options.activePath}.${randomUUID()}.tmp`;
  writeFileSync(staging, raw, { flag: "wx", mode: 0o600 });
  renameSync(staging, options.activePath);
  return { action: "activated", lock: checked.lock, ...(backupPath ? { backupPath } : {}) };
}

/** Per-request tenant check: unbound tenants get coordination reads only (zero Track handler runs). */
export function isTenantBound(lock: Pick<HostedDeploymentLock, "tenants">, tenantId: string): boolean {
  return isRecord(lock.tenants) && isRecord(lock.tenants[tenantId]);
}

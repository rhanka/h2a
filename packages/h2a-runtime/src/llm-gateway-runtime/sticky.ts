import {
  closeSync,
  chmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  accountSupportsRoute,
  effectiveAccountAuthType,
  findAccount,
  selectAccount,
  selectAccountForRoute,
  upstreamTransportForAccount,
} from "./accounts.js";
import type {
  AccountDescriptor,
  GatewayUpstreamTransport,
} from "./accounts.js";
import {
  resolveModelRoute,
  routeForProvider,
  type RoutingTarget,
} from "./canonical-routing.js";
import { upsertSessionLedger } from "./session-ledger.js";

// ─── k8s ConfigMap client ────────────────────────────────────────────────────

const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const K8S_HOST =
  process.env.KUBERNETES_SERVICE_HOST ?? "kubernetes.default.svc.cluster.local";
const K8S_PORT = process.env.KUBERNETES_SERVICE_PORT ?? "443";
const NAMESPACE = process.env.POD_NAMESPACE ?? "sentropic-remote";
const CONFIGMAP_NAME = process.env.STICKY_CONFIGMAP ?? "llm-gateway-sticky";
const LOCAL_STICKY_FILE = process.env.LLM_GATEWAY_STICKY_FILE;

function saToken(): string {
  try {
    return readFileSync(SA_TOKEN_PATH, "utf-8").trim();
  } catch {
    // Fallback for local dev/testing
    return process.env.K8S_TOKEN ?? "";
  }
}

function cmUrl(): string {
  return `https://${K8S_HOST}:${K8S_PORT}/api/v1/namespaces/${NAMESPACE}/configmaps/${CONFIGMAP_NAME}`;
}

function readLocalSticky(): Record<string, string> {
  if (!LOCAL_STICKY_FILE) return {};
  try {
    return JSON.parse(readFileSync(LOCAL_STICKY_FILE, "utf8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function writeLocalSticky(data: Record<string, string>): void {
  if (!LOCAL_STICKY_FILE) return;
  mkdirSync(dirname(LOCAL_STICKY_FILE), { recursive: true });
  const tmp = `${LOCAL_STICKY_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, LOCAL_STICKY_FILE);
}

async function withLocalStickyLock<T>(operation: () => T): Promise<T> {
  if (!LOCAL_STICKY_FILE) return operation();
  const lockPath = `${LOCAL_STICKY_FILE}.lock`;
  let fd: number | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  if (fd === undefined) throw new Error("timed out acquiring sticky-file lock");
  try {
    return operation();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // The lock was already removed; the guarded operation has still ended.
    }
  }
}

interface StickyBinding {
  readonly accountId: string;
  readonly requiredTransport?: GatewayUpstreamTransport;
}

function parsePersistedTransport(
  value: unknown,
): GatewayUpstreamTransport | undefined {
  return value === "anthropic-messages" ||
    value === "codex-responses" ||
    value === "openai-chat-completions"
    ? value
    : undefined;
}

function decodeStickyBinding(value: string): StickyBinding | undefined {
  if (!value.startsWith("{")) return { accountId: value };
  try {
    const parsed = JSON.parse(value) as {
      accountId?: unknown;
      requiredTransport?: unknown;
    };
    const requiredTransport = parsePersistedTransport(parsed.requiredTransport);
    if (typeof parsed.accountId !== "string" || !requiredTransport) {
      return undefined;
    }
    return { accountId: parsed.accountId, requiredTransport };
  } catch {
    return undefined;
  }
}

function encodeStickyBinding(
  accountId: string,
  requiredTransport?: GatewayUpstreamTransport,
): string {
  return requiredTransport
    ? JSON.stringify({ accountId, requiredTransport })
    : accountId;
}

interface StickySnapshot {
  readonly data: Record<string, string>;
  readonly hasData: boolean;
  readonly resourceVersion?: string;
}

async function readStickySnapshot(): Promise<StickySnapshot> {
  if (LOCAL_STICKY_FILE) return { data: readLocalSticky(), hasData: true };
  const token = saToken();
  if (!token) return { data: readLocalSticky(), hasData: true };
  const resp = await fetch(cmUrl(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return { data: {}, hasData: false };
  if (!resp.ok) throw new Error(`sticky ConfigMap read failed: ${resp.status}`);
  const cm = (await resp.json()) as {
    data?: Record<string, string>;
    metadata?: { resourceVersion?: string };
  };
  return {
    data: cm.data ?? {},
    hasData: cm.data !== undefined,
    ...(cm.metadata?.resourceVersion
      ? { resourceVersion: cm.metadata.resourceVersion }
      : {}),
  };
}

export async function readSticky(): Promise<Record<string, string>> {
  return (await readStickySnapshot()).data;
}

export async function writeSticky(
  sessionId: string,
  accountId: string,
  requiredTransport?: GatewayUpstreamTransport,
): Promise<void> {
  const binding = encodeStickyBinding(accountId, requiredTransport);
  if (LOCAL_STICKY_FILE) {
    await withLocalStickyLock(() => {
      writeLocalSticky({ ...readLocalSticky(), [sessionId]: binding });
    });
    return;
  }
  const token = saToken();
  if (!token) {
    await withLocalStickyLock(() => {
      writeLocalSticky({ ...readLocalSticky(), [sessionId]: binding });
    });
    return;
  }
  const patch = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: CONFIGMAP_NAME, namespace: NAMESPACE },
    data: { [sessionId]: binding },
  };
  const resp = await fetch(cmUrl(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/strategic-merge-patch+json",
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok)
    throw new Error(`sticky ConfigMap patch failed: ${resp.status}`);
}

async function compareAndSetStickyBinding(
  sessionId: string,
  accountId: string,
  requiredTransport: GatewayUpstreamTransport | undefined,
  expected: StickySnapshot,
): Promise<void> {
  const binding = encodeStickyBinding(accountId, requiredTransport);
  if (LOCAL_STICKY_FILE) {
    await withLocalStickyLock(() => {
      const current = readLocalSticky();
      if (current[sessionId] !== expected.data[sessionId]) {
        throw new Error("session binding changed concurrently");
      }
      writeLocalSticky({ ...current, [sessionId]: binding });
      if (readLocalSticky()[sessionId] !== binding) {
        throw new Error("session transport claim was not persisted");
      }
    });
    return;
  }

  const token = saToken();
  if (!token) {
    if (requiredTransport) {
      throw new Error(
        "a durable sticky backend is required for constrained sessions",
      );
    }
    await writeSticky(sessionId, accountId, requiredTransport);
    return;
  }
  const escapedSessionId = sessionId.replaceAll("~", "~0").replaceAll("/", "~1");
  let snapshot = expected;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!snapshot.resourceVersion) {
      throw new Error("sticky ConfigMap resourceVersion is required for claim CAS");
    }
    const resp = await fetch(cmUrl(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify([
        {
          op: "test",
          path: "/metadata/resourceVersion",
          value: snapshot.resourceVersion,
        },
        snapshot.hasData
          ? { op: "add", path: `/data/${escapedSessionId}`, value: binding }
          : { op: "add", path: "/data", value: { [sessionId]: binding } },
      ]),
    });
    const current = await readStickySnapshot();
    if (current.data[sessionId] === binding) return;
    if (resp.ok) {
      throw new Error("session transport claim was not persisted");
    }
    if (current.data[sessionId] !== snapshot.data[sessionId]) {
      throw new Error(`session binding CAS failed (${resp.status})`);
    }
    snapshot = current;
  }
  throw new Error("session binding CAS retry limit exceeded");
}

// ─── Restart-safe gateway token derivation ──────────────────────────────────

export interface SessionEntry {
  sessionId: string;
  gatewayToken: string;
  accountId: string;
  token: string;
  provider: string;
  authType?: AccountDescriptor["authType"];
  transport?: GatewayUpstreamTransport;
  requiredTransport?: GatewayUpstreamTransport;
}

const _sessions = new Map<string, SessionEntry>();
const _acquisitionLocks = new Map<string, Promise<void>>();
const TOKEN_PREFIX = "gw-v1-";

async function withSessionAcquisitionLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = _acquisitionLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  _acquisitionLocks.set(sessionId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (_acquisitionLocks.get(sessionId) === current) {
      _acquisitionLocks.delete(sessionId);
    }
  }
}

function tokenSeed(): string {
  const seed = process.env.LLM_GATEWAY_TOKEN_SEED;
  if (!seed) throw new Error("LLM_GATEWAY_TOKEN_SEED env var is required");
  return seed;
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function unb64url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function macFor(sessionId: string): string {
  return createHmac("sha256", tokenSeed())
    .update("gw-token-v1\0")
    .update(sessionId)
    .digest("base64url");
}

export function gatewayTokenForSession(sessionId: string): string {
  return `${TOKEN_PREFIX}${b64url(sessionId)}.${macFor(sessionId)}`;
}

function sessionIdFromGatewayToken(gatewayToken: string): string | null {
  if (!gatewayToken.startsWith(TOKEN_PREFIX)) return null;
  const rest = gatewayToken.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const encodedSessionId = rest.slice(0, dot);
  const suppliedMac = rest.slice(dot + 1);
  const sessionId = unb64url(encodedSessionId);
  if (!sessionId) return null;
  const expectedMac = macFor(sessionId);
  const a = Buffer.from(suppliedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function sessionCount(): number {
  return _sessions.size;
}

export async function lookupToken(
  gatewayToken: string,
): Promise<SessionEntry | undefined> {
  const cached = _sessions.get(gatewayToken);
  const sessionId = sessionIdFromGatewayToken(gatewayToken);
  if (!sessionId) return undefined;

  const existing = await readSticky();
  const rawBinding = existing[sessionId];
  const binding =
    rawBinding === undefined ? undefined : decodeStickyBinding(rawBinding);
  if (rawBinding !== undefined && !binding) return undefined;
  if (!binding) {
    return cached && !cached.requiredTransport && !LOCAL_STICKY_FILE && !saToken()
      ? cached
      : undefined;
  }
  const account = findAccount(binding.accountId);
  if (!account) return undefined;
  if (
    binding?.requiredTransport &&
    upstreamTransportForAccount(account) !== binding.requiredTransport
  ) {
    return undefined;
  }

  const entry: SessionEntry = {
    sessionId,
    gatewayToken,
    accountId: account.id,
    token: account.token,
    provider: account.provider,
    authType: effectiveAccountAuthType(account),
    transport: upstreamTransportForAccount(account),
    ...(binding?.requiredTransport
      ? { requiredTransport: binding.requiredTransport }
      : {}),
  };
  _sessions.set(gatewayToken, entry);
  upsertSessionLedger({
    gatewaySessionId: sessionId,
    account,
  });
  return entry;
}

/** Update the bearer token for a session after an OAuth refresh. */
export function updateSessionToken(
  gatewayToken: string,
  newToken: string,
): void {
  const entry = _sessions.get(gatewayToken);
  if (!entry) return;
  const transport = upstreamTransportForAccount({
    id: entry.accountId,
    provider: entry.provider,
    label: entry.accountId,
    token: newToken,
  });
  if (entry.requiredTransport && transport !== entry.requiredTransport) {
    throw new Error(
      `refreshed credential no longer satisfies ${entry.requiredTransport} transport`,
    );
  }
  (entry as { token: string }).token = newToken;
  (entry as { transport?: GatewayUpstreamTransport }).transport = transport;
}

export async function rebindGatewaySession(
  gatewayToken: string,
  account: AccountDescriptor,
  route?: RoutingTarget,
): Promise<SessionEntry | undefined> {
  const sessionId = sessionIdFromGatewayToken(gatewayToken);
  if (!sessionId) return undefined;
  const cached = _sessions.get(gatewayToken);
  const snapshot = await readStickySnapshot();
  const rawBinding = snapshot.data[sessionId];
  const persistedBinding =
    rawBinding === undefined ? undefined : decodeStickyBinding(rawBinding);
  if (rawBinding !== undefined && !persistedBinding) {
    throw new Error("invalid persisted session binding");
  }
  if (
    persistedBinding &&
    cached &&
    persistedBinding.accountId !== cached.accountId
  ) {
    throw new Error("cannot rebind a stale gateway session");
  }
  if (
    persistedBinding?.requiredTransport &&
    cached?.requiredTransport &&
    persistedBinding.requiredTransport !== cached.requiredTransport
  ) {
    throw new Error("cached and persisted session transport claims conflict");
  }
  const targetTransport = upstreamTransportForAccount(account);
  const requiredTransport =
    targetTransport !== "unknown"
      ? targetTransport
      : (persistedBinding?.requiredTransport ?? cached?.requiredTransport);

  await compareAndSetStickyBinding(
    sessionId,
    account.id,
    requiredTransport,
    snapshot,
  );
  const entry: SessionEntry = {
    sessionId,
    gatewayToken,
    accountId: account.id,
    token: account.token,
    provider: account.provider,
    authType: effectiveAccountAuthType(account),
    transport: upstreamTransportForAccount(account),
    ...(requiredTransport ? { requiredTransport } : {}),
  };
  _sessions.set(gatewayToken, entry);
  upsertSessionLedger({
    gatewaySessionId: sessionId,
    account,
    ...(route ? { route } : {}),
  });
  return entry;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface SessionResult {
  gatewayToken: string;
  accountId: string;
  requestedModel?: string;
  modelId?: string;
  upstreamModel?: string;
  reasoningEffort?: string;
  provider: string;
  authType: "api-key" | "bearer";
  transport: GatewayUpstreamTransport;
  routePolicy?: string;
  routeReason?: string;
}

export interface AcquireSessionOptions {
  model?: string;
  provider?: string;
  workspaceId?: string;
  profile?: string;
  clientSessionId?: string;
  reasoningEffort?: string;
  requiredTransport?: string;
}

const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const REQUIRED_TRANSPORTS = new Set<GatewayUpstreamTransport>([
  "anthropic-messages",
  "codex-responses",
  "openai-chat-completions",
]);

function requiredTransportFromOptions(
  options: AcquireSessionOptions,
): GatewayUpstreamTransport | undefined {
  if (!options.requiredTransport) return undefined;
  if (!REQUIRED_TRANSPORTS.has(options.requiredTransport as GatewayUpstreamTransport)) {
    throw new Error(`unsupported required transport: ${options.requiredTransport}`);
  }
  return options.requiredTransport as GatewayUpstreamTransport;
}

function routeFromOptions(
  options: AcquireSessionOptions,
): RoutingTarget | undefined {
  if (options.model) return resolveModelRoute(options.model);
  if (options.provider) return routeForProvider(options.provider);
  return undefined;
}

/**
 * Acquire or re-acquire a session for a given sessionId.
 * Idempotent: the same sessionId always maps to the same accountId and token.
 * The token is derived from LLM_GATEWAY_TOKEN_SEED + sessionId, never persisted.
 */
export async function acquireSession(
  sessionId: string,
  options: AcquireSessionOptions = {},
): Promise<SessionResult> {
  return withSessionAcquisitionLock(sessionId, () =>
    acquireSessionUnlocked(sessionId, options),
  );
}

async function acquireSessionUnlocked(
  sessionId: string,
  options: AcquireSessionOptions = {},
): Promise<SessionResult> {
  const route = routeFromOptions(options);
  if (options.model && !route)
    throw new Error(`unsupported model: ${options.model}`);
  if (options.reasoningEffort && !REASONING_EFFORTS.has(options.reasoningEffort)) {
    throw new Error(`unsupported reasoning effort: ${options.reasoningEffort}`);
  }
  const requestedTransport = requiredTransportFromOptions(options);
  if (requestedTransport && !route) {
    throw new Error("requiredTransport requires a model or provider route");
  }

  // Check ConfigMap for existing sticky binding
  const snapshot = await readStickySnapshot();
  const existing = snapshot.data;
  const rawBinding = existing[sessionId];
  let persistedBinding =
    rawBinding === undefined ? undefined : decodeStickyBinding(rawBinding);
  if (rawBinding !== undefined && !persistedBinding) {
    throw new Error("invalid persisted session binding");
  }
  const cached = _sessions.get(gatewayTokenForSession(sessionId));
  const cachedBinding: StickyBinding | undefined = cached
    ? {
        accountId: cached.accountId,
        ...(cached.requiredTransport
          ? { requiredTransport: cached.requiredTransport }
          : {}),
      }
    : undefined;
  if (persistedBinding?.accountId && route) {
    const boundAcc = findAccount(persistedBinding.accountId);
    if (!boundAcc || !accountSupportsRoute(boundAcc, route)) {
      persistedBinding = undefined;
    }
  }
  if (
    persistedBinding &&
    cachedBinding?.requiredTransport &&
    persistedBinding.requiredTransport &&
    cachedBinding.requiredTransport !== persistedBinding.requiredTransport
  ) {
    throw new Error("cached and persisted session transport claims conflict");
  }
  const binding: StickyBinding | undefined = persistedBinding
    ? {
        accountId: persistedBinding.accountId,
        ...(persistedBinding.requiredTransport ?? cachedBinding?.requiredTransport
          ? {
              requiredTransport:
                persistedBinding.requiredTransport ??
                cachedBinding!.requiredTransport!,
            }
          : {}),
      }
    : cachedBinding;
  if (
    requestedTransport &&
    binding?.requiredTransport &&
    requestedTransport !== binding.requiredTransport
  ) {
    throw new Error(
      `session transport constraint is already ${binding.requiredTransport}`,
    );
  }
  const requiredTransport =
    binding?.requiredTransport ?? requestedTransport;
  if (requiredTransport && !route) {
    throw new Error("a constrained session requires a model or provider route");
  }
  let account: AccountDescriptor;
  let bindingChanged = false;

  const boundId = binding?.accountId;
  if (boundId !== undefined) {
    const found = findAccount(boundId);
    if (
      found &&
      (!route || accountSupportsRoute(found, route)) &&
      (!requiredTransport ||
        upstreamTransportForAccount(found) === requiredTransport)
    ) {
      account = found;
    } else {
      account = route
        ? selectAccountForRoute(
            route,
            requiredTransport ? { requiredTransport } : {},
          )
        : selectAccount();
      bindingChanged = true;
    }
  } else {
    account = route
      ? selectAccountForRoute(
          route,
          requiredTransport ? { requiredTransport } : {},
        )
      : selectAccount();
    bindingChanged = true;
  }

  if (
    requiredTransport &&
    persistedBinding?.requiredTransport !== requiredTransport
  ) {
    await compareAndSetStickyBinding(
      sessionId,
      account.id,
      requiredTransport,
      snapshot,
    );
  } else if (bindingChanged) {
    await compareAndSetStickyBinding(
      sessionId,
      account.id,
      requiredTransport,
      snapshot,
    );
  }

  const gatewayToken = gatewayTokenForSession(sessionId);
  _sessions.set(gatewayToken, {
    sessionId,
    gatewayToken,
    accountId: account.id,
    token: account.token,
    provider: account.provider,
    authType: effectiveAccountAuthType(account),
    transport: upstreamTransportForAccount(account),
    ...(requiredTransport ? { requiredTransport } : {}),
  });
  upsertSessionLedger({
    gatewaySessionId: sessionId,
    clientSessionId: options.clientSessionId ?? sessionId,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    account,
    ...(route ? { route } : {}),
  });

  return {
    gatewayToken,
    accountId: account.id,
    ...(route?.requestedModel ? { requestedModel: route.requestedModel } : {}),
    ...(route?.catalogModelId ? { modelId: route.catalogModelId } : {}),
    ...(route?.upstreamModel ? { upstreamModel: route.upstreamModel } : {}),
    ...(options.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
    provider: account.provider,
    authType: effectiveAccountAuthType(account),
    transport: upstreamTransportForAccount(account),
    ...(route?.routingPolicy ? { routePolicy: route.routingPolicy } : {}),
    ...(route?.routeReason ? { routeReason: route.routeReason } : {}),
  };
}

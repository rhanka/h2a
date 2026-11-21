/**
 * LH-07 instance binding and per-instance revocation on a live trunk link.
 *
 * - Resolves local registered Ed25519 instance keys through `preparePossession`
 *   (requiring `row.id === instanceId && row.instance === instanceId`).
 * - Signs `instance.bind` strictly with the instance private key (never the node key).
 * - Serializes `instance.bind` on channel 0 with single-use rotated `bindNonce`.
 * - Persists revoked instance ids under `<root>/remote-control/revoked-instances.json`
 *   using `withLockSync` on `<root>/remote-control/.lock` (0700 dir, 0600 atomic rename).
 */

import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { preparePossession } from "../identity/possession.js";
import { LockTimeoutError, withLockSync } from "../local-files/locks.js";
import { signTrunkBytes, type InstanceBoundRecord, type InstanceRevokedRecord } from "./types.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface LocalInstancePossession {
  readonly instanceId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly instancePublicKey: string;
  readonly instanceFingerprint: string;
}

export interface InstanceActResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface RevokedInstancesRegistryRead {
  readonly ok: boolean;
  readonly entries: Record<string, string[]>;
}

export function remoteControlLockPath(root: string): string {
  return join(root, "remote-control", ".lock");
}

export function revokedInstancesFilePath(root: string): string {
  return join(root, "remote-control", "revoked-instances.json");
}

export function extractRawEd25519PublicKeyBase64(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ format: "der", type: "spki" });
  if (der.length !== 44 || !der.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    throw new Error("not a valid Ed25519 SPKI public key");
  }
  return der.subarray(12).toString("base64");
}

export function formatWET2Fingerprint(rawPublicKeyBytes: Uint8Array): string {
  if (rawPublicKeyBytes.byteLength !== 32) {
    throw new Error("Ed25519 raw public key must be 32 bytes");
  }
  const first10 = createHash("sha256").update(rawPublicKeyBytes).digest().subarray(0, 10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of first10) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

function hasExactIdAndInstanceRow(root: string, instanceId: string): boolean {
  const file = join(root, "registry", "instances.jsonl");
  if (!existsSync(file)) return false;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      if (row["id"] === instanceId && row["instance"] === instanceId) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function loadLocalInstancePossession(root: string, instanceId: string): LocalInstancePossession | undefined {
  if (!instanceId || !hasExactIdAndInstanceRow(root, instanceId)) {
    return undefined;
  }
  const receipt = preparePossession(root, instanceId);
  if (!receipt) return undefined;
  const keyName = instanceId.replace(/[:/]/g, "-");
  const privateFile = join(root, "keys", `${keyName}.key.pem`);
  const publicFile = join(root, "keys", `${keyName}.pub.pem`);
  try {
    const privateKeyPem = readFileSync(privateFile, "utf8");
    const publicKeyPem = readFileSync(publicFile, "utf8");
    const instancePublicKey = extractRawEd25519PublicKeyBase64(publicKeyPem);
    const instanceFingerprint = formatWET2Fingerprint(Buffer.from(instancePublicKey, "base64"));
    return {
      instanceId,
      privateKeyPem,
      publicKeyPem,
      instancePublicKey,
      instanceFingerprint
    };
  } catch {
    return undefined;
  }
}

function parseRevokedRegistryContent(raw: string): Record<string, string[]> | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  if (record["version"] !== 1 || typeof record["entries"] !== "object" || record["entries"] === null || Array.isArray(record["entries"])) {
    return null;
  }
  const out: Record<string, string[]> = {};
  for (const [scope, list] of Object.entries(record["entries"] as Record<string, unknown>)) {
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
      return null;
    }
    out[scope] = [...new Set(list)].sort();
  }
  return out;
}

function readRevokedRegistryUnlocked(root: string): RevokedInstancesRegistryRead {
  const file = revokedInstancesFilePath(root);
  if (!existsSync(file)) return { ok: true, entries: {} };
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = parseRevokedRegistryContent(raw);
    if (parsed === null) return { ok: false, entries: {} };
    return { ok: true, entries: parsed };
  } catch {
    return { ok: false, entries: {} };
  }
}

export function readRevokedInstancesRegistry(root: string, options?: { readonly timeoutMs?: number }): RevokedInstancesRegistryRead {
  const dir = join(root, "remote-control");
  if (!existsSync(dir)) return { ok: true, entries: {} };
  try {
    return withLockSync(
      remoteControlLockPath(root),
      () => readRevokedRegistryUnlocked(root),
      { timeoutMs: options?.timeoutMs ?? 250 }
    );
  } catch {
    return { ok: false, entries: {} };
  }
}

export function persistRevokedInstancesRegistry(
  root: string,
  scopeKey: string,
  ids: readonly string[],
  options?: { readonly timeoutMs?: number }
): { readonly ok: boolean; readonly busy?: boolean; readonly corrupt?: boolean } {
  const dir = join(root, "remote-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore
  }
  try {
    return withLockSync(
      remoteControlLockPath(root),
      () => {
        const current = readRevokedRegistryUnlocked(root);
        if (!current.ok) {
          return { ok: false, corrupt: true };
        }
        const merged = new Set<string>(current.entries[scopeKey] ?? []);
        for (const id of ids) {
          if (id) merged.add(id);
        }
        const nextEntries: Record<string, string[]> = {
          ...current.entries,
          [scopeKey]: [...merged].sort()
        };
        const file = revokedInstancesFilePath(root);
        const tmp = join(dir, `.revoked-instances.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        const body = JSON.stringify({ version: 1, entries: nextEntries }, null, 2) + "\n";
        writeFileSync(tmp, body, { mode: 0o600 });
        try {
          chmodSync(tmp, 0o600);
        } catch {
          // ignore
        }
        renameSync(tmp, file);
        return { ok: true };
      },
      { timeoutMs: options?.timeoutMs ?? 250 }
    );
  } catch (err) {
    if (err instanceof LockTimeoutError) {
      return { ok: false, busy: true };
    }
    return { ok: false };
  }
}

export interface TrunkInstanceManagerOptions {
  readonly root: string;
  readonly meshId: string;
  readonly endpoint: string;
  readonly tenantId: string;
  readonly enrolmentRef: string;
  readonly nodeId: string;
  readonly clock: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  readonly canonicalBindBytes: (payload: {
    readonly meshId: string;
    readonly endpoint: string;
    readonly tenantId: string;
    readonly enrolmentRef: string;
    readonly nodeId: string;
    readonly instanceId: string;
    readonly instancePublicKey: string;
    readonly bindNonce: string;
  }) => Uint8Array;
  readonly sendBindRecord: (record: {
    readonly t: "instance.bind";
    readonly instanceId: string;
    readonly instancePublicKey: string;
    readonly instanceFingerprint: string;
    readonly bindNonce: string;
    readonly sig: string;
  }) => boolean;
  readonly onAudit: (event: {
    readonly kind: string;
    readonly at: number;
    readonly meshId: string;
    readonly tenantId: string;
    readonly enrolmentRef: string;
    readonly instanceId?: string;
    readonly fingerprint?: string;
    readonly reason?: string;
  }) => void;
  readonly onRefusalRecorded: (refusal: { readonly code: string; readonly instanceId: string; readonly at: number }) => void;
  readonly onStatusUpdated: (instanceId: string, status: "live" | "revoked") => void;
}

export class TrunkInstanceManager {
  readonly #opts: TrunkInstanceManagerOptions;
  readonly #scopeKey: string;
  readonly #revoked = new Set<string>();
  readonly #pendingPersist = new Set<string>();
  readonly #bound = new Map<string, { status: "live" | "refused"; reason?: string; fingerprint?: string }>();
  readonly #fingerprints = new Map<string, string>();
  readonly #queue: string[] = [];
  #inFlight: { instanceId: string; fingerprint: string } | null = null;
  #bindNonce: string | null = null;
  #registryCorrupt = false;
  #persistRetryTimer: unknown = null;

  constructor(options: TrunkInstanceManagerOptions) {
    this.#opts = options;
    this.#scopeKey = `${options.meshId}|${options.tenantId}|${options.enrolmentRef}|${options.nodeId}`;
  }

  get scopeKey(): string {
    return this.#scopeKey;
  }

  isRegistryCorrupt(): boolean {
    return this.#registryCorrupt;
  }

  revokedIds(): ReadonlySet<string> {
    return this.#revoked;
  }

  resetConnectionState(): void {
    this.#bindNonce = null;
    this.#inFlight = null;
    this.#queue.length = 0;
    this.#bound.clear();
  }

  dispose(): void {
    if (this.#persistRetryTimer !== null) {
      this.#opts.clock.clearTimeout(this.#persistRetryTimer);
      this.#persistRetryTimer = null;
    }
    this.resetConnectionState();
  }

  onReady(bindNonce: string, serverRevokedInstances: readonly string[]): readonly string[] {
    this.resetConnectionState();
    this.#bindNonce = bindNonce;

    const loaded = readRevokedInstancesRegistry(this.#opts.root, { timeoutMs: 0 });
    if (!loaded.ok) {
      // Distinguish lock contention vs corruption by reading unlocked check
      const unlocked = readRevokedRegistryUnlocked(this.#opts.root);
      if (!unlocked.ok) {
        this.#registryCorrupt = true;
      } else {
        this.#registryCorrupt = false;
        for (const id of unlocked.entries[this.#scopeKey] ?? []) {
          this.#revoked.add(id);
        }
      }
    } else {
      this.#registryCorrupt = false;
      for (const id of loaded.entries[this.#scopeKey] ?? []) {
        this.#revoked.add(id);
      }
    }

    for (const id of serverRevokedInstances) {
      if (id) {
        this.#revoked.add(id);
        this.#pendingPersist.add(id);
      }
    }
    if (this.#pendingPersist.size > 0 || serverRevokedInstances.length > 0) {
      this.#flushPendingRevocations();
    }
    return [...this.#revoked].sort();
  }

  requestBind(instanceId: string): { readonly ok: boolean; readonly reason?: string } {
    this.#refreshRegistryReadability();
    if (this.#registryCorrupt) {
      return { ok: false, reason: "instance-registry-unavailable" };
    }
    if (!this.#bindNonce) {
      return { ok: false, reason: "link-not-ready" };
    }
    if (this.#revoked.has(instanceId)) {
      this.#emitAudit("instance-bind-refused", instanceId, "instance-revoked");
      return { ok: false, reason: "instance-revoked" };
    }
    const existing = this.#bound.get(instanceId);
    if (existing?.status === "live") {
      return { ok: true };
    }
    if (existing?.status === "refused") {
      return { ok: false, reason: existing.reason ?? "instance-refused" };
    }
    const possession = loadLocalInstancePossession(this.#opts.root, instanceId);
    if (!possession) {
      this.#emitAudit("instance-bind-refused", instanceId, "unknown-instance");
      return { ok: false, reason: "unknown-instance" };
    }
    this.#fingerprints.set(instanceId, possession.instanceFingerprint);
    if (!this.#queue.includes(instanceId) && this.#inFlight?.instanceId !== instanceId) {
      this.#queue.push(instanceId);
    }
    this.#drainQueue();
    return { ok: true };
  }

  onInstanceBound(record: InstanceBoundRecord): { readonly ok: boolean; readonly code?: string } {
    if (!this.#inFlight || this.#inFlight.instanceId !== record.instanceId) {
      return { ok: false, code: "unexpected-instance-bound" };
    }
    const finished = this.#inFlight;
    this.#inFlight = null;
    this.#bindNonce = record.bindNonce;

    if (this.#revoked.has(record.instanceId)) {
      // An instance.revoked push wins over an in-flight bind.
      this.#bound.set(record.instanceId, { status: "refused", reason: "instance-revoked", fingerprint: finished.fingerprint });
      this.#emitAudit("instance-bind-superseded-by-revoke", record.instanceId, "instance-revoked");
      this.#drainQueue();
      return { ok: true };
    }

    if (record.status === "live") {
      this.#bound.set(record.instanceId, { status: "live", fingerprint: finished.fingerprint });
      this.#emitAudit("instance-bound", record.instanceId);
    } else {
      const reason = record.reason ?? "refused";
      this.#bound.set(record.instanceId, { status: "refused", reason, fingerprint: finished.fingerprint });
      if (reason === "instance-revoked") {
        this.#revoked.add(record.instanceId);
        this.#pendingPersist.add(record.instanceId);
        this.#flushPendingRevocations();
      }
      this.#opts.onRefusalRecorded({ code: reason, instanceId: record.instanceId, at: this.#opts.clock.now() });
      this.#emitAudit("instance-bind-refused", record.instanceId, reason);
    }

    this.#drainQueue();
    return { ok: true };
  }

  onInstanceRevoked(record: InstanceRevokedRecord): void {
    const id = record.instanceId;
    this.#revoked.add(id);
    this.#pendingPersist.add(id);
    this.#bound.set(id, { status: "refused", reason: "instance-revoked", fingerprint: this.#fingerprints.get(id) });
    // Remove from pending bind queue
    for (let i = this.#queue.length - 1; i >= 0; i--) {
      if (this.#queue[i] === id) this.#queue.splice(i, 1);
    }
    this.#flushPendingRevocations();
    this.#emitAudit("instance-revoked", id, "instance-revoked");
    this.#opts.onRefusalRecorded({ code: "instance-revoked", instanceId: id, at: this.#opts.clock.now() });
    if (!this.#registryCorrupt) {
      this.#opts.onStatusUpdated(id, "revoked");
    }
  }

  admitAct(instanceId: string): InstanceActResult {
    this.#refreshRegistryReadability();
    if (this.#registryCorrupt) {
      this.#emitAudit("instance-act-refused", instanceId, "instance-registry-unavailable");
      return { ok: false, reason: "instance-registry-unavailable" };
    }
    if (this.#revoked.has(instanceId)) {
      this.#emitAudit("instance-act-refused", instanceId, "instance-revoked");
      return { ok: false, reason: "instance-revoked" };
    }
    const binding = this.#bound.get(instanceId);
    if (!binding) {
      this.#emitAudit("instance-act-refused", instanceId, "instance-not-bound");
      return { ok: false, reason: "instance-not-bound" };
    }
    if (binding.status !== "live") {
      const reason = binding.reason ?? "instance-refused";
      this.#emitAudit("instance-act-refused", instanceId, reason);
      return { ok: false, reason };
    }
    this.#emitAudit("instance-act-admitted", instanceId);
    return { ok: true };
  }

  #refreshRegistryReadability(): void {
    const check = readRevokedRegistryUnlocked(this.#opts.root);
    if (!check.ok) {
      this.#registryCorrupt = true;
      return;
    }
    if (this.#registryCorrupt) {
      this.#registryCorrupt = false;
      for (const id of check.entries[this.#scopeKey] ?? []) {
        this.#revoked.add(id);
      }
      if (this.#pendingPersist.size > 0) {
        this.#flushPendingRevocations();
      }
    }
  }

  #flushPendingRevocations(): void {
    if (this.#pendingPersist.size === 0) return;
    const ids = [...this.#pendingPersist];
    const res = persistRevokedInstancesRegistry(this.#opts.root, this.#scopeKey, ids, { timeoutMs: 0 });
    if (res.ok) {
      this.#registryCorrupt = false;
      for (const id of ids) this.#pendingPersist.delete(id);
      if (this.#persistRetryTimer !== null) {
        this.#opts.clock.clearTimeout(this.#persistRetryTimer);
        this.#persistRetryTimer = null;
      }
      return;
    }
    if (res.corrupt) {
      this.#registryCorrupt = true;
      return;
    }
    if (res.busy && this.#persistRetryTimer === null) {
      this.#persistRetryTimer = this.#opts.clock.setTimeout(() => {
        this.#persistRetryTimer = null;
        this.#flushPendingRevocations();
      }, 25);
    }
  }

  #drainQueue(): void {
    if (this.#inFlight !== null || !this.#bindNonce || this.#queue.length === 0) return;
    while (this.#queue.length > 0) {
      const instanceId = this.#queue.shift()!;
      if (this.#revoked.has(instanceId)) continue;
      const possession = loadLocalInstancePossession(this.#opts.root, instanceId);
      if (!possession) {
        this.#emitAudit("instance-bind-refused", instanceId, "unknown-instance");
        continue;
      }
      this.#fingerprints.set(instanceId, possession.instanceFingerprint);
      const bindNonce = this.#bindNonce;
      const bytes = this.#opts.canonicalBindBytes({
        meshId: this.#opts.meshId,
        endpoint: this.#opts.endpoint,
        tenantId: this.#opts.tenantId,
        enrolmentRef: this.#opts.enrolmentRef,
        nodeId: this.#opts.nodeId,
        instanceId,
        instancePublicKey: possession.instancePublicKey,
        bindNonce
      });
      const sig = signTrunkBytes(bytes, possession.privateKeyPem);
      this.#inFlight = { instanceId, fingerprint: possession.instanceFingerprint };
      const sent = this.#opts.sendBindRecord({
        t: "instance.bind",
        instanceId,
        instancePublicKey: possession.instancePublicKey,
        instanceFingerprint: possession.instanceFingerprint,
        bindNonce,
        sig
      });
      if (!sent) {
        this.#inFlight = null;
        return;
      }
      return;
    }
  }

  #emitAudit(kind: string, instanceId?: string, reason?: string): void {
    const fingerprint = instanceId ? this.#fingerprints.get(instanceId) : undefined;
    this.#opts.onAudit({
      kind,
      at: this.#opts.clock.now(),
      meshId: this.#opts.meshId,
      tenantId: this.#opts.tenantId,
      enrolmentRef: this.#opts.enrolmentRef,
      ...(instanceId !== undefined ? { instanceId } : {}),
      ...(fingerprint !== undefined ? { fingerprint } : {}),
      ...(reason !== undefined ? { reason } : {})
    });
  }
}

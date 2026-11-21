/**
 * LH-01 node key store: one key per OS account and workstation.
 *
 * Most reversible choices (all behind the LH-00 flag; LH-11 consumes this):
 * - Storage: `<configDir>/remote/node-key.json`, mode 0600. `configDir` is
 *   always explicit in tests (a temporary dir). The default resolves to
 *   `$XDG_CONFIG_HOME/sentropic/h2a`, else `~/.config/sentropic/h2a`.
 * - Fingerprint (Q-06): SHA-256 hex of the DER-encoded SPKI public key
 *   bytes. The printing side (here) and the verification side (LH-11 / fake
 *   enrolment) both derive it from the same SPKI bytes, so the encoding
 *   never drifts.
 * - Key loss (Q-15): a missing or unreadable key is reported as a named
 *   state (`missing` / `invalid`, both `requiresEnrolment: true`). Load
 *   NEVER generates; only `generateNodeKey` creates, and only when absent.
 */

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NODE_KEY_FILE = "node-key.json";
export const NODE_KEY_DIR = "remote";

export type NodeKeyLoadResult =
  | {
      readonly state: "present";
      readonly nodeId: string;
      readonly fingerprint: string;
      readonly publicKeyPem: string;
      readonly privateKeyPem: string;
      readonly createdAt: string;
    }
  | { readonly state: "missing"; readonly requiresEnrolment: true }
  | { readonly state: "invalid"; readonly requiresEnrolment: true };

export type NodeKeyStatus = "present" | "missing" | "invalid";

export interface NodeKeyOptions {
  readonly configDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function resolveNodeKeyDir(options: NodeKeyOptions = {}): string {
  if (options.configDir !== undefined && options.configDir !== "") return options.configDir;
  const env = options.env ?? process.env;
  const xdg = env["XDG_CONFIG_HOME"]?.trim();
  const base = xdg !== undefined && xdg !== "" ? xdg : join(homedir(), ".config");
  return join(base, "sentropic", "h2a");
}

function nodeKeyFilePath(options: NodeKeyOptions = {}): string {
  return join(resolveNodeKeyDir(options), NODE_KEY_DIR, NODE_KEY_FILE);
}

/** Fingerprint over the fixed DER/SPKI encoding of the public key (Q-06). */
export function nodeKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

interface StoredNodeKey {
  readonly nodeId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly algorithm: "ed25519";
  readonly version: 1;
}

function parseStored(raw: string): StoredNodeKey | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  if (typeof r["nodeId"] !== "string" || r["nodeId"] === "") return null;
  if (typeof r["publicKeyPem"] !== "string") return null;
  if (typeof r["privateKeyPem"] !== "string") return null;
  if (typeof r["fingerprint"] !== "string") return null;
  if (typeof r["createdAt"] !== "string") return null;
  // Fail closed on unexpected fields: no token-shaped field may ride along.
  const allowlist = new Set([
    "nodeId",
    "publicKeyPem",
    "privateKeyPem",
    "fingerprint",
    "createdAt",
    "algorithm",
    "version"
  ]);
  for (const k of Object.keys(r)) {
    if (!allowlist.has(k)) return null;
  }
  try {
    // Cheap sanity: both PEMs must parse and the fingerprint must match.
    const expected = nodeKeyFingerprint(r["publicKeyPem"]);
    if (expected !== r["fingerprint"]) return null;
  } catch {
    return null;
  }
  return {
    nodeId: r["nodeId"],
    publicKeyPem: r["publicKeyPem"],
    privateKeyPem: r["privateKeyPem"],
    fingerprint: r["fingerprint"],
    createdAt: r["createdAt"],
    algorithm: "ed25519",
    version: 1
  };
}

export function loadNodeKey(options: NodeKeyOptions = {}): NodeKeyLoadResult {
  const file = nodeKeyFilePath(options);
  if (!existsSync(file)) return { state: "missing", requiresEnrolment: true };
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { state: "invalid", requiresEnrolment: true };
  }
  const parsed = parseStored(raw);
  if (parsed === null) return { state: "invalid", requiresEnrolment: true };
  return {
    state: "present",
    nodeId: parsed.nodeId,
    fingerprint: parsed.fingerprint,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
    createdAt: parsed.createdAt
  };
}

export function readNodeKeyStatus(options: NodeKeyOptions = {}): NodeKeyStatus {
  return loadNodeKey(options).state;
}

/**
 * Generate the node key when absent; return the existing key when present.
 * Never re-keys over a corrupt file: that is `invalid` and stays `invalid`
 * until the caller deletes and re-enrols.
 */
export function generateNodeKey(options: NodeKeyOptions = {}): NodeKeyLoadResult {
  const existing = loadNodeKey(options);
  if (existing.state === "present") return existing;
  if (existing.state === "invalid") return existing;
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const stored: StoredNodeKey = {
    nodeId: `node:${randomUUID()}`,
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey,
    fingerprint: nodeKeyFingerprint(pair.publicKey),
    createdAt: new Date().toISOString(),
    algorithm: "ed25519",
    version: 1
  };
  const dir = join(resolveNodeKeyDir(options), NODE_KEY_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, NODE_KEY_FILE);
  const body = JSON.stringify(stored, null, 2) + "\n";
  writeFileSync(file, body, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // mode already requested at write; a failed chmod does not lose the key.
  }
  // If a concurrent writer won the race, keep theirs.
  const loaded = loadNodeKey(options);
  if (loaded.state === "present") return loaded;
  return {
    state: "present",
    nodeId: stored.nodeId,
    fingerprint: stored.fingerprint,
    publicKeyPem: stored.publicKeyPem,
    privateKeyPem: stored.privateKeyPem,
    createdAt: stored.createdAt
  };
}

/** Remove key material. Returns true when a file was removed. */
export function deleteNodeKey(options: NodeKeyOptions = {}): boolean {
  const file = nodeKeyFilePath(options);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

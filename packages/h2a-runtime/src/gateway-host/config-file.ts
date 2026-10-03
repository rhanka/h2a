/** Public host configuration only; provider credentials stay upstream. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { validateLlmMeshRoutingConfig, type LlmMeshRoutingConfig } from "../routing-preferences.js";

export interface LlmMeshConfig {
  /** Deprecated migration sinks. Never returned or persisted. */
  accounts?: readonly unknown[];
  meshAccounts?: readonly unknown[];
  /** Local port for the gateway. Default: 3002 */
  port?: number;
  /** Log file path (stdout+stderr of the gateway process). Default: ~/.sentropic/llm-mesh.log */
  logFile?: string;
  /** Public host routing policy. Provider/model knowledge remains in llm-mesh. */
  routing?: LlmMeshRoutingConfig;
}

export function sentropicDir(): string {
  return join(homedir(), ".sentropic");
}

export function llmMeshConfigPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh.json");
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writePrivateMetadata(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function readLlmMeshConfig(dir?: string): LlmMeshConfig | null {
  const config = readJson<Omit<LlmMeshConfig, "accounts" | "meshAccounts"> & {
    accounts?: unknown;
    meshAccounts?: unknown;
  }>(llmMeshConfigPath(dir));
  if (!config) return null;
  const { accounts: _legacyAccounts, meshAccounts: _legacyPublicIds, ...publicConfig } = config;
  return publicConfig;
}

export function writeLlmMeshConfig(config: LlmMeshConfig, dir?: string): void {
  // The facade/keyring own credentials. Keep only public enrollment metadata
  // in llm-mesh.json, including when migrating a pre-facade configuration.
  const {
    accounts: _legacyCredentialRecords,
    meshAccounts: _legacyPublicIds,
    ...publicConfig
  } = config;
  if (publicConfig.routing) validateLlmMeshRoutingConfig(publicConfig.routing);
  writePrivateMetadata(llmMeshConfigPath(dir), publicConfig);
}

export function updateLlmMeshRoutingConfig(
  routing: LlmMeshRoutingConfig | undefined,
  dir?: string,
): LlmMeshConfig {
  const config = readLlmMeshConfig(dir) ?? {};
  const next = routing
    ? { ...config, routing: validateLlmMeshRoutingConfig(routing) }
    : (() => {
        const copy = { ...config };
        delete copy.routing;
        return copy;
      })();
  writeLlmMeshConfig(next, dir);
  return next;
}


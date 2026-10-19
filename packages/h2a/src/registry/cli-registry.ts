/**
 * CLI verbs for the h2a-side registry (R5 bootstrap, R6 hosted lock).
 *
 * - `h2a registry catalog` — metadata only, writes nothing.
 * - `h2a registry bootstrap preview|install|uninstall --host <h> --config <path> [--profile] [--lock] [--dry-run]`
 *   — the explicit operator-owned host-config writer. Anything else
 *   (rendering, preview, launch, serve) writes no host config.
 * - `h2a registry-bridge serve --host <h> --profile <p> --lock <path>` —
 *   guard chain (lock → compile → central attachment admission → served-surface
 *   equality) then delegates transport to the central attachment shim
 *   (never the legacy `mcp-serve` path).
 *   Refusals are typed JSON-RPC initialize errors; a missing lock is never
 *   an inferred server and never a silent empty tools/list.
 * - `h2a hosted-lock draft|verify|activate` — operator lifecycle for the
 *   deployment-owned hosted lock (opaque refs only).
 *
 * Kept in this module so cli.ts only gains dispatch lines: no shared serve
 * behavior changes. Per-connection central admission stays owned by the
 * 0.98.7 lane policy; strict no-fallback enforcement for bridge launches
 * awaits the lane's R5-CA policy change (recorded NOT covered).
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { installBridgeEntry, previewInstall, uninstallBridgeEntry } from "./host-bootstrap.js";
import { assertRegistryHost } from "./host-bootstrap.js";
import { defaultBridgeLockPath, provisionBridgeLock, readBridgeLock } from "./bridge-lock.js";
import { validateRegistryEntry, type RegistryEntry } from "./descriptors.js";
import { activateHostedLock, draftHostedLock, verifyHostedLock } from "./hosted.js";
import { registryPackageManifest } from "./manifest.js";
import { createRegistry } from "./registry.js";
import { bridgeCentralAttachmentAdmitted } from "../runtime/mcp-central-policy.js";

export interface CliStreams {
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  cwd?: () => string;
}

function usageError(streams: CliStreams, message: string): number {
  streams.stderr.write(`${message}\n`);
  return 1;
}

function registryError(streams: CliStreams, context: string, error: unknown): number {
  streams.stderr.write(`${context}: ${(error as Error).message}\n`);
  return 2;
}

function packedEntries(): RegistryEntry[] {
  return [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries] as RegistryEntry[];
}

function packedManifests(): { h2aManifest: unknown; trackManifest: unknown } {
  // Manifest assets resolve next to the packed entries descriptors.
  // (node:fs is a builtin: fine in this CLI-only module, which never joins
  // the light `./registry/definitions` import graph.)
  const h2aEntry = (registryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
  const trackEntry = (trackRegistryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
  const h2aManifest = JSON.parse(readFileSync(new URL(`../../${h2aEntry.mcp?.manifestAsset}`, import.meta.url), "utf8")) as unknown;
  const trackManifest = JSON.parse(readFileSync(new URL(`../../../track/${trackEntry.mcp?.manifestAsset}`, import.meta.url), "utf8")) as unknown;
  return { h2aManifest, trackManifest };
}

export function cmdRegistry(argv: readonly string[], streams: CliStreams): number {
  const [sub, action, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] as string;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  if (sub === "catalog") {
    try {
      const entries = packedEntries().map((entry) => {
        const { digest } = validateRegistryEntry(entry);
        return { kind: entry.kind, id: entry.id, entryVersion: entry.entryVersion, digest, description: entry.description };
      });
      streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return 0;
    } catch (error) {
      return registryError(streams, "h2a registry catalog", error);
    }
  }
  if (sub === "bootstrap") {
    const host = flags["host"];
    const config = flags["config"];
    if (!host) return usageError(streams, "h2a registry bootstrap: --host <claude|codex|agy|muse|vibe> is required");
    if (!config && action !== "preview") {
      // Preview may also run against an absent config (action install).
      if (action === "install" || action === "uninstall") {
        return usageError(streams, "h2a registry bootstrap: --config <path> is required");
      }
    }
    if (!config) return usageError(streams, "h2a registry bootstrap: --config <path> is required");
    const profile = flags["profile"] ?? "default";
    const lockPath = flags["lock"] ?? defaultBridgeLockPath(config);
    try {
      if (action === "preview") {
        const preview = previewInstall({ host, configPath: config, profile });
        streams.stdout.write(`${JSON.stringify({ ok: true, ...preview, host, profile, config, lock: lockPath }, null, 2)}\n`);
        return 0;
      }
      if (action === "install") {
        const installed = installBridgeEntry({ host, configPath: config, profile, lockPath, dryRun: flags["dry-run"] === "true" });
        let lockAction = "skipped-dry-run";
        if (flags["dry-run"] !== "true") {
          const h2aEntry = (registryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
          const trackEntry = (trackRegistryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
          lockAction = provisionBridgeLock({ lockPath, host, profile, bridge: { command: "h2a", args: ["registry-bridge", "serve", "--host", host, "--profile", profile, "--lock", lockPath] }, h2aEntry, trackEntry }).action;
        }
        streams.stdout.write(`${JSON.stringify({ ok: true, host, profile, config, lock: lockPath, lockAction, ...installed }, null, 2)}\n`);
        return 0;
      }
      if (action === "uninstall") {
        const removed = uninstallBridgeEntry({ host, configPath: config });
        try {
          if (existsSync(lockPath)) unlinkSync(lockPath);
        } catch {
          /* lock removal is best-effort after the config is clean */
        }
        streams.stdout.write(`${JSON.stringify({ ok: true, host, config, lock: lockPath, ...removed }, null, 2)}\n`);
        return 0;
      }
      return usageError(streams, "h2a registry bootstrap: use preview|install|uninstall");
    } catch (error) {
      return registryError(streams, "h2a registry bootstrap", error);
    }
  }
  return usageError(streams, "h2a registry: use catalog|bootstrap");
}

export function cmdHostedLock(argv: readonly string[], streams: CliStreams): number {
  const [action, ...rest] = argv;
  const flags: Record<string, string> = {};
  const bindings: Record<string, { contract: string }> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] as string;
    if (token === "--binding") {
      const next = rest[i + 1] as string;
      const eq = next?.indexOf("=");
      if (next === undefined || eq < 0) return usageError(streams, "h2a hosted-lock verify: --binding <key>=<contract> needs a value");
      bindings[next.slice(0, eq)] = { contract: next.slice(eq + 1) };
      i++;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  const lockPath = flags["lock"];
  if (!lockPath) return usageError(streams, "h2a hosted-lock: --lock <path> is required");
  try {
    if (action === "draft") {
      const lock = draftHostedLock({
        lockPath,
        serviceBindingRef: flags["service"] ?? "h2a-hosted-service",
        entries: packedEntries(),
        tenant: flags["tenant"] ? { id: flags["tenant"], repositoryBindingRef: flags["repository"] ?? `${flags["tenant"]}-workspace` } : undefined
      });
      streams.stdout.write(`${JSON.stringify({ ok: true, action: "drafted", lock: lockPath, entries: lock.entries.map((entry) => entry.id) }, null, 2)}\n`);
      return 0;
    }
    if (action === "verify") {
      const result = verifyHostedLock({ lockPath, bindings });
      streams.stdout.write(`${JSON.stringify(result.ok ? { ok: true, action: "verified", lock: lockPath } : { ok: false, action: "refused", lock: lockPath, diagnostics: result.diagnostics }, null, 2)}\n`);
      return result.ok ? 0 : 2;
    }
    if (action === "activate") {
      const active = flags["active"] ?? lockPath;
      const receipt = activateHostedLock({ lockPath, activePath: active });
      streams.stdout.write(`${JSON.stringify({ ok: true, ...receipt, lock: lockPath, active }, null, 2)}\n`);
      return 0;
    }
    return usageError(streams, "h2a hosted-lock: use draft|verify|activate");
  } catch (error) {
    return registryError(streams, "h2a hosted-lock", error);
  }
}

export interface BridgeServeDeps {
  delegateServe: (flags: Record<string, string>) => Promise<number>;
}

/**
 * Guard chain then delegate. Writes nothing: not the host config, not the
 * lock, not the receipt. A missing/invalid lock, an unqualified central
 * route or a served-surface mismatch refuses with a typed JSON-RPC
 * initialize error on stdout and a remediating diagnostic on stderr.
 */
export async function cmdRegistryBridge(
  argv: readonly string[],
  streams: CliStreams,
  deps: BridgeServeDeps
): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "serve") {
    streams.stderr.write("h2a registry-bridge: use serve\n");
    return 1;
  }
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] as string;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  const refuse = (code: string, message: string): number => {
    streams.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: `${code}: ${message}` } })}\n`);
    streams.stderr.write(`h2a registry-bridge serve: ${code}: ${message}\n`);
    return 2;
  };
  const host = flags["host"];
  const profile = flags["profile"] ?? "default";
  const lockPath = flags["lock"];
  try {
    assertRegistryHost(host);
  } catch (error) {
    return refuse("unsupported_host", (error as Error).message);
  }
  if (!lockPath) {
    return refuse("missing_lock", `no --lock for host=${host} profile=${profile}; run h2a registry bootstrap install --host ${host} --profile ${profile} --config <host-config>`);
  }
  let lock;
  try {
    lock = readBridgeLock(lockPath);
  } catch (error) {
    return refuse((error as { code?: string }).code ?? "missing_lock", (error as Error).message);
  }
  if (lock.host !== host || lock.profile !== profile) {
    return refuse("invalid_entry", `lock at ${lockPath} binds host=${lock.host} profile=${lock.profile}, not host=${host} profile=${profile}`);
  }
  const modes = Object.values(lock.entries).map((record) => (record.config as Record<string, unknown>)["mode"]);
  if (modes.includes("hosted-read-only")) {
    return refuse("invalid_parameters", "a CLI bridge never serves hosted-read-only mode; that composition belongs to the hosted service");
  }
  if (modes.includes("shared-central") && flags["instance"] === undefined) {
    // Central attachment admission lives in the central policy file: a
    // qualified Claude session AND an enabled central with a local
    // protocol-2 marker. Anything else is refused here — a missing lock is
    // never an inferred server. Instance (sidecar) requests skip this
    // refusal and stay on stdio through the plain shim; the lane policy
    // admits them per connection, if at all.
    if (!bridgeCentralAttachmentAdmitted({ host, ...flags })) {
      // TODO(R5-CA): non-Claude adapters (gemini/codex/copilot/opencode/agents, ESC lanes).
      const adapter = (host as string) !== "claude" ? " (R5-CA owns non-Claude adapters)" : "";
      return refuse(
        "central_unavailable",
        `shared-central has no qualified central route for host=${host}${adapter}: needs linux, a qualified Claude session, enabled central and a local protocol-2 marker; refusing instead of substituting a server`
      );
    }
  }
  // Prove the selection against the registry, then prove the served surface
  // equals the delegated server's surface exactly (no silent subset).
  try {
    const registry = createRegistry();
    const { h2aManifest, trackManifest } = packedManifests();
    const entries = new Map(packedEntries().map((entry) => [entry.id, entry]));
    const unreachable = (name: string) => (): unknown => {
      throw new Error(`bridge defect: plan handler invoked for ${name}; dispatch authority stays with the delegated server`);
    };
    for (const selected of lock.selection) {
      const entry = entries.get(selected.id);
      if (!entry) return refuse("invalid_entry", `unknown provider ${selected.id}`);
      const manifest = selected.id === "sentropic.h2a" ? h2aManifest : trackManifest;
      const tools = (manifest as { tools: Array<{ name: string }> }).tools;
      registry.register({ descriptor: structuredClone(entry), manifest: structuredClone(manifest), handlers: new Map(tools.map((tool) => [tool.name, unreachable(tool.name)])) });
    }
    registry.select(lock.selection.map((selected) => selected.id));
    for (const [id, record] of Object.entries(lock.entries)) {
      registry.configure(id, (record as { config: unknown }).config);
    }
    const candidate = await registry.compile({
      bindings: {
        "h2a-local-central": { contract: "h2a.central-attachment/v2" },
        "h2a-attachment-workspace": { contract: "h2a.workspace/v1" },
        "h2a-hosted-service": { contract: "h2a.hosted-service/v1" }
      },
      compatibility: lock.compatibility
    });
    if (!candidate.ok) {
      const first = candidate.diagnostics[0] as { code: string; message: string };
      return refuse(first.code, first.message);
    }
    const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../runtime/mcp/tools.js");
    if (JSON.stringify(candidate.plan.orderedCapabilities) !== JSON.stringify(H2A_CLI_MCP_TOOL_DESCRIPTORS.map(tool => tool.name))) {
      return refuse("invalid_parameters", "lock selection does not equal the served surface; subset locks need a filtered server (not covered in this increment)");
    }
  } catch (error) {
    return refuse((error as { code?: string }).code ?? "invalid_entry", (error as Error).message);
  }
  const passthrough: Record<string, string> = { ...flags, host };
  delete passthrough["lock"];
  delete passthrough["profile"];
  return deps.delegateServe(passthrough);
}



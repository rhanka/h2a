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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { installBridgeEntry, previewInstall, uninstallBridgeEntry, verifyPluginInstall } from "./host-bootstrap.js";
import { assertRegistryHost } from "./host-bootstrap.js";
import { defaultBridgeLockPath, defaultPluginBridgeLockPath, readBridgeLock } from "./bridge-lock.js";
import { normalizeConfiguration, RegistryError, validateRegistryEntry, type RegistryEntry } from "./descriptors.js";
import { activateHostedLock, draftHostedLock, verifyHostedLock } from "./hosted.js";
import { registryPackageManifest } from "./manifest.js";
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

/**
 * Resolve a packed track asset through the `@sentropic/track` package
 * itself (works hoisted, nested, or workspace-linked). The monorepo-sibling
 * fallback below covers bare trees with no installed track package.
 * Exported for the packed-layout tests; production callers omit `fromUrl`.
 */
export function resolveTrackManifestAsset(asset: string, fromUrl: string = import.meta.url): string {
  try {
    const packagePath = createRequire(fromUrl).resolve("@sentropic/track/package.json");
    return join(dirname(packagePath), asset);
  } catch {
    return fileURLToPath(new URL(`../../../track/${asset}`, fromUrl));
  }
}

function readPackedAsset(label: string, path: string): unknown {
  let bytes: string;
  try {
    bytes = readFileSync(path, "utf8");
  } catch (error) {
    // The missing-asset diagnostic names the asset path and carries no raw
    // ENOENT stack; non-ENOENT read failures surface unchanged.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RegistryError("invalid_entry", `invalid_entry: missing packed ${label} asset at ${path}`);
    }
    throw error;
  }
  try {
    return JSON.parse(bytes) as unknown;
  } catch (error) {
    throw new RegistryError("invalid_entry", `invalid_entry: unreadable packed ${label} asset at ${path} (${(error as Error).message})`);
  }
}

function packedManifests(): { h2aManifest: unknown; trackManifest: unknown } {
  // Manifest assets resolve next to the packed entries descriptors.
  // (node:fs is a builtin: fine in this CLI-only module, which never joins
  // the light `./registry/definitions` import graph.)
  const h2aEntry = (registryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
  const trackEntry = (trackRegistryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
  const h2aAsset = h2aEntry.mcp?.manifestAsset;
  const trackAsset = trackEntry.mcp?.manifestAsset;
  if (!h2aAsset || !trackAsset) {
    throw new RegistryError("invalid_entry", "invalid_entry: packed entries declare no manifestAsset");
  }
  const h2aManifest = readPackedAsset("h2a", fileURLToPath(new URL(`../../${h2aAsset}`, import.meta.url)));
  const trackManifest = readPackedAsset("track", resolveTrackManifestAsset(trackAsset));
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
    const mechanism = flags["mechanism"] ?? "file";
    if (mechanism !== "file" && mechanism !== "plugin") {
      return usageError(streams, "h2a registry bootstrap: --mechanism must be file|plugin");
    }
    if (mechanism === "plugin" && action !== "install") {
      return usageError(streams, "h2a registry bootstrap: --mechanism plugin is only supported for install");
    }
    try {
      if (action === "preview") {
        const preview = previewInstall({ host, configPath: config, profile });
        streams.stdout.write(`${JSON.stringify({ ok: true, ...preview, host, profile, config, lock: lockPath }, null, 2)}\n`);
        return 0;
      }
      if (action === "install") {
        const h2aEntry = (registryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
        const trackEntry = (trackRegistryPackageManifest.entries as RegistryEntry[])[0] as RegistryEntry;
        if (mechanism === "plugin") {
          // Plugin-mechanism verification: the installed plugin declaration is
          // verified, the per-host/profile default lock is provisioned and the
          // receipt recorded. The plugin cache and the host config are read,
          // never edited.
          const pluginDir = flags["plugin-dir"];
          if (!pluginDir) return usageError(streams, "h2a registry bootstrap: --plugin-dir <path> is required with --mechanism plugin");
          const installed = verifyPluginInstall({ host, configPath: config, profile, pluginDir, h2aEntry, trackEntry });
          streams.stdout.write(`${JSON.stringify({ ok: true, host, profile, config, lock: defaultPluginBridgeLockPath(host, profile), ...installed }, null, 2)}\n`);
          return 0;
        }
        // The whole config+receipt+lock sequence runs in the one install
        // transaction (host-bootstrap.ts); nothing is provisioned here after
        // the installer returns.
        const installed = installBridgeEntry({ host, configPath: config, profile, lockPath, dryRun: flags["dry-run"] === "true", h2aEntry, trackEntry });
        streams.stdout.write(`${JSON.stringify({ ok: true, host, profile, config, lock: lockPath, ...installed }, null, 2)}\n`);
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
      if (next === undefined || eq < 0) return usageError(streams, "h2a hosted-lock: --binding <key>=<contract> needs a value");
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
      // Activation verifies the draft against the operator bindings first;
      // an unbound draft refuses and the active file stays absent/unchanged.
      const active = flags["active"] ?? lockPath;
      const receipt = activateHostedLock({ lockPath, activePath: active, bindings });
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
  const explicitLock = flags["lock"];
  try {
    assertRegistryHost(host);
  } catch (error) {
    return refuse("unsupported_host", (error as Error).message);
  }
  // An explicit --lock stays authoritative. Without one, the bridge resolves
  // the per-host/profile default provisioned by `bootstrap install
  // --mechanism plugin` (RQ-17); nothing is ever inferred into a server.
  let lockPath = explicitLock;
  let defaulted = false;
  if (!lockPath) {
    try {
      lockPath = defaultPluginBridgeLockPath(host, profile);
      defaulted = true;
    } catch (error) {
      return refuse("missing_lock", (error as Error).message);
    }
  }
  let lock;
  try {
    lock = readBridgeLock(lockPath);
  } catch (error) {
    if (defaulted) {
      return refuse(
        "missing_lock",
        `no lock at the plugin default ${lockPath} for host=${host} profile=${profile} ` +
        `(${(error as Error).message}); run h2a registry bootstrap install --mechanism plugin ` +
        `--host ${host} --profile ${profile} --config <host-config> --plugin-dir <plugin-dir>`
      );
    }
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
  // Prove the selection against the published Sentropic registry with REAL
  // handlers (H2a daemon composition `./sentropic-daemon.js`), then prove the
  // served surface equals the delegated server's surface exactly (no silent
  // subset). The private preparation compiler (`./registry.js`) is no longer
  // on this path. Lock config bounds are preserved: unknown providers refuse
  // (`invalid_entry`) and bad mode/binding values refuse through the package
  // validators (`invalid_parameters`/`missing_binding`).
  try {
    const entries = new Map(packedEntries().map((entry) => [entry.id, entry]));
    for (const selected of lock.selection) {
      if (!entries.has(selected.id)) return refuse("invalid_entry", `unknown provider ${selected.id}`);
    }
    for (const [id, record] of Object.entries(lock.entries)) {
      const entry = entries.get(id);
      if (!entry) return refuse("invalid_entry", `unknown provider ${id}`);
      try {
        normalizeConfiguration(entry, (record as { config: unknown }).config);
      } catch (error) {
        return refuse((error as { code?: string }).code ?? "invalid_parameters", (error as Error).message);
      }
    }
    // Order-sensitive: the served surface is h2a tools then Track tools, so a
    // reordered lock (or any subset) refuses here exactly as before.
    const selectedIds = lock.selection.map((selected) => selected.id);
    if (JSON.stringify(selectedIds) !== JSON.stringify(["sentropic.h2a", "sentropic.track"])) {
      return refuse("invalid_parameters", "lock selection does not equal the served surface; subset locks need a filtered server (not covered in this increment)");
    }
    // Packed-layout integrity: the shipped manifest assets must resolve and
    // parse (a deleted asset refuses typed, naming the asset, with no raw
    // ENOENT). This I/O validation stays; only compilation moved to Sentropic.
    try {
      packedManifests();
    } catch (error) {
      return refuse((error as { code?: string }).code ?? "invalid_entry", (error as Error).message);
    }
    const { composeDaemonRegistry } = await import("./sentropic-daemon.js");
    const root = streams.cwd?.() ?? process.cwd();
    let toolNames: string[];
    try {
      const composed = await composeDaemonRegistry({ view: "combined", root });
      toolNames = composed.toolNames();
    } catch (error) {
      return refuse((error as { code?: string }).code ?? "invalid_entry", (error as Error).message);
    }
    const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../runtime/mcp/tools.js");
    // Membership equality (sorted): the published kernel emits its compiled
    // tools in canonical sorted order while the served surface keeps
    // declaration order. The bound is unchanged — same tools, no silent
    // subset or extra — only the irrelevant ordering is normalized.
    const served = H2A_CLI_MCP_TOOL_DESCRIPTORS.map(tool => tool.name).sort();
    if (JSON.stringify([...toolNames].sort()) !== JSON.stringify(served)) {
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



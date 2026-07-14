import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type RequestListener } from "node:http";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_ASSETS_DIR = join(PACKAGE_ROOT, "focus-app");
const DEFAULT_H2A_BIN = join(PACKAGE_ROOT, "dist", "bin.js");
const FOCUS_ARTIFACT_SCHEMA_VERSION = 1;
const FOCUS_RUNTIME_DEPENDENCIES = ["@sentropic/track"] as const;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5178;

interface FocusArtifactManifest {
  kind: "sentropic.h2a.focus-app";
  schemaVersion: number;
  adapter: "@sveltejs/adapter-node";
  handler: "handler.js";
  sourceHash: string;
  clientVersion: string;
  externalDependencies: string[];
  files: Record<string, string>;
}

export interface FocusAssets {
  dir: string;
  handlerPath: string;
  manifest: FocusArtifactManifest;
}

export interface FocusServeConfig {
  repoRoot: string;
  trackEvents: string;
  host: string;
  port: number;
  h2aBin: string;
  emitterInstance?: string;
  assets: FocusAssets;
}

export interface FocusServeStreams {
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
}

interface FocusServeDeps {
  cwd?: () => string;
  env?: NodeJS.ProcessEnv;
  assetsDir?: string;
  h2aBin?: string;
}

interface ParsedFocusArgs {
  help: boolean;
  values: Record<string, string>;
}

export function renderFocusServeHelp(): string {
  return [
    "Usage:",
    "  h2a focus serve [--repo <path>] [--track-events <path>] [--host <host>] [--port <0-65535>]",
    "  h2a focus web   [--repo <path>] [--track-events <path>] [--host <host>] [--port <0-65535>]",
    "",
    "Serve the packaged production Focus Web app for a tracked repository.",
    "The exact `web` subcommand is an alias for `serve`; bare `h2a focus ...` remains the Track CLI facade.",
    `Default bind: http://${DEFAULT_HOST}:${DEFAULT_PORT}. Port 0 selects an available port.`,
    "Repository precedence: --repo, FOCUS_REPO_ROOT, then the nearest ancestor with .track/events.jsonl.",
    "Events precedence: --track-events, FOCUS_TRACK_EVENTS, then <repo>/.track/events.jsonl."
  ].join("\n");
}

function parseFocusArgs(argv: readonly string[]): ParsedFocusArgs {
  if (argv[0] !== "focus" || (argv[1] !== "serve" && argv[1] !== "web")) {
    throw new Error("expected `h2a focus serve` or its exact alias `h2a focus web`");
  }
  const values: Record<string, string> = {};
  const valued = new Set(["repo", "track-events", "host", "port"]);
  let help = false;
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected positional argument "${token}"`);
    const key = token.slice(2);
    if (!valued.has(key)) throw new Error(`unknown option --${key}`);
    if (values[key] !== undefined) throw new Error(`option --${key} was provided more than once`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`option --${key} requires a value`);
    values[key] = value;
    i++;
  }
  return { help, values };
}

function canonicalDirectory(input: string, base: string, label: string): string {
  const candidate = resolve(base, input);
  try {
    const canonical = realpathSync(candidate);
    if (!statSync(canonical).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch (error) {
    throw new Error(`${label} is not a readable directory (${candidate}): ${(error as Error).message}`);
  }
}

function canonicalFile(input: string, base: string, label: string): string {
  const candidate = resolve(base, input);
  try {
    const canonical = realpathSync(candidate);
    if (!statSync(canonical).isFile()) throw new Error("not a regular file");
    accessSync(canonical, fsConstants.R_OK);
    return canonical;
  } catch (error) {
    throw new Error(`${label} is not a readable file (${candidate}): ${(error as Error).message}`);
  }
}

function findTrackedRepo(start: string): string | undefined {
  let current = canonicalDirectory(start, start, "current working directory");
  while (true) {
    if (existsSync(join(current, ".track", "events.jsonl"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function inferRepoFromEvents(events: string): string | undefined {
  const trackDir = dirname(events);
  return dirname(trackDir) !== trackDir && basename(trackDir) === ".track" ? dirname(trackDir) : undefined;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) throw new Error(`--port must be an integer from 0 to 65535 (got "${raw}")`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error(`--port must be an integer from 0 to 65535 (got "${raw}")`);
  }
  return port;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function validateFocusAssets(assetsDir = DEFAULT_ASSETS_DIR): FocusAssets {
  const dir = resolve(assetsDir);
  const manifestPath = join(dir, "h2a-focus.json");
  let manifest: FocusArtifactManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FocusArtifactManifest;
  } catch (error) {
    throw new Error(`packaged Focus assets are absent or invalid (${manifestPath}): ${(error as Error).message}`);
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.kind !== "sentropic.h2a.focus-app" ||
    manifest.schemaVersion !== FOCUS_ARTIFACT_SCHEMA_VERSION ||
    manifest.adapter !== "@sveltejs/adapter-node" ||
    manifest.handler !== "handler.js" ||
    typeof manifest.sourceHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.sourceHash) ||
    typeof manifest.clientVersion !== "string" ||
    !/^h2a-focus-[a-f0-9]{16}$/.test(manifest.clientVersion) ||
    !Array.isArray(manifest.externalDependencies) ||
    manifest.externalDependencies.length !== FOCUS_RUNTIME_DEPENDENCIES.length ||
    !FOCUS_RUNTIME_DEPENDENCIES.every(
      (dependency, index) => manifest.externalDependencies[index] === dependency
    ) ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files) ||
    Object.keys(manifest.files).length === 0
  ) {
    throw new Error(
      `packaged Focus assets are incompatible (${manifestPath}); expected schema ${FOCUS_ARTIFACT_SCHEMA_VERSION} adapter-node handler`
    );
  }
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const filePath = resolve(dir, relativePath);
    if (
      relativePath.includes("\\") ||
      relativePath === "h2a-focus.json" ||
      filePath === dir ||
      !filePath.startsWith(`${dir}${sep}`) ||
      !/^sha256:[a-f0-9]{64}$/.test(expectedHash)
    ) {
      throw new Error(`packaged Focus asset inventory is incompatible (${relativePath})`);
    }
    let actualHash: string;
    try {
      actualHash = `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
    } catch (error) {
      throw new Error(
        `packaged Focus assets are incomplete (${relativePath}): ${(error as Error).message}`
      );
    }
    if (actualHash !== expectedHash) {
      throw new Error(`packaged Focus asset is incompatible (${relativePath}); content hash mismatch`);
    }
  }
  const handlerPath = join(dir, manifest.handler);
  if (!isFile(handlerPath) || !isFile(join(dir, "client", "_app", "version.json")) || !isDirectory(join(dir, "server"))) {
    throw new Error(`packaged Focus assets are incomplete (${dir})`);
  }
  try {
    const clientVersion = JSON.parse(
      readFileSync(join(dir, "client", "_app", "version.json"), "utf8")
    ) as { version?: unknown };
    if (clientVersion.version !== manifest.clientVersion) {
      throw new Error(`expected ${manifest.clientVersion}, got ${String(clientVersion.version)}`);
    }
  } catch (error) {
    throw new Error(`packaged Focus client version is invalid: ${(error as Error).message}`);
  }
  const require = createRequire(import.meta.url);
  for (const dependency of manifest.externalDependencies) {
    try {
      require.resolve(dependency);
    } catch (error) {
      throw new Error(
        `packaged Focus runtime dependency ${dependency} is unavailable: ${(error as Error).message}`
      );
    }
  }
  return { dir, handlerPath, manifest };
}

export function resolveFocusServeConfig(
  argv: readonly string[],
  deps: FocusServeDeps = {}
): FocusServeConfig | { help: true } {
  const parsed = parseFocusArgs(argv);
  if (parsed.help) return { help: true };
  const host = parsed.values.host ?? DEFAULT_HOST;
  if (host.trim() === "") throw new Error("--host must not be empty");
  const port = parsePort(parsed.values.port);
  const cwd = (deps.cwd ?? (() => process.cwd()))();
  const env = deps.env ?? process.env;
  const eventsInput = parsed.values["track-events"] ?? env.FOCUS_TRACK_EVENTS;
  const earlyEvents = eventsInput ? canonicalFile(eventsInput, cwd, "Focus track events") : undefined;
  const repoInput = parsed.values.repo ?? env.FOCUS_REPO_ROOT;
  const inferred = earlyEvents ? inferRepoFromEvents(earlyEvents) : undefined;
  const repoRoot = repoInput
    ? canonicalDirectory(repoInput, cwd, "Focus repository")
    : inferred ?? findTrackedRepo(cwd);
  if (!repoRoot) {
    throw new Error(
      `no tracked repository found from ${resolve(cwd)}; pass --repo <path> or set FOCUS_REPO_ROOT`
    );
  }
  const trackEvents = earlyEvents ?? canonicalFile(join(repoRoot, ".track", "events.jsonl"), cwd, "Focus track events");
  const h2aBin = canonicalFile(deps.h2aBin ?? DEFAULT_H2A_BIN, cwd, "h2a executable");
  const emitterInstance = env.FOCUS_EMITTER_INSTANCE?.trim() || env.H2A_INSTANCE?.trim() || undefined;
  return {
    repoRoot,
    trackEvents,
    host,
    port,
    h2aBin,
    emitterInstance,
    assets: validateFocusAssets(deps.assetsDir)
  };
}

function signalExitCode(reason: unknown): number {
  switch (reason) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 0;
  }
}

function displayHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function allowedLoopbackHostHeader(header: string | undefined, host: string, port: number): boolean {
  if (!header) return false;
  const names = new Set([displayHost(host).toLowerCase(), "localhost", "127.0.0.1", "[::1]"]);
  const normalized = header.toLowerCase();
  for (const name of names) {
    if (normalized === `${name}:${port}` || (port === 80 && normalized === name)) return true;
  }
  return false;
}

export async function runFocusServeCli(
  argv: readonly string[],
  streams: FocusServeStreams = { stdout: process.stdout, stderr: process.stderr },
  signal?: AbortSignal,
  deps: FocusServeDeps = {}
): Promise<number> {
  let resolved: FocusServeConfig | { help: true };
  try {
    resolved = resolveFocusServeConfig(argv, deps);
  } catch (error) {
    streams.stderr.write(`h2a focus ${argv[1] ?? "serve"}: ${(error as Error).message}\n`);
    return 1;
  }
  if ("help" in resolved) {
    streams.stdout.write(`${renderFocusServeHelp()}\n`);
    return 0;
  }

  const previousEnv = new Map<string, string | undefined>();
  const focusEnv: Record<string, string> = {
    FOCUS_REPO_ROOT: resolved.repoRoot,
    FOCUS_TRACK_EVENTS: resolved.trackEvents,
    FOCUS_H2A_BIN: resolved.h2aBin
  };
  if (resolved.emitterInstance) focusEnv.FOCUS_EMITTER_INSTANCE = resolved.emitterInstance;
  for (const [key, value] of Object.entries(focusEnv)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    let handler: RequestListener;
    try {
      const module = (await import(pathToFileURL(resolved.assets.handlerPath).href)) as {
        handler?: unknown;
      };
      if (typeof module.handler !== "function") {
        throw new Error("handler.js does not export a callable handler");
      }
      handler = module.handler as RequestListener;
    } catch (error) {
      streams.stderr.write(`h2a focus ${argv[1]}: incompatible packaged handler: ${(error as Error).message}\n`);
      return 1;
    }

    const restrictHostHeader = isLoopbackHost(resolved.host);
    let boundPort = resolved.port;
    const server = createServer((request, response) => {
      if (restrictHostHeader && !allowedLoopbackHostHeader(request.headers.host, resolved.host, boundPort)) {
        response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
        response.end("Misdirected Request\n");
        return;
      }
      handler(request, response);
    });
    const rc = await new Promise<number>((done) => {
      let settled = false;
      let forceTimer: NodeJS.Timeout | undefined;
      const settle = (code: number): void => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        signal?.removeEventListener("abort", onAbort);
        done(code);
      };
      const stop = (code: number): void => {
        if (!server.listening) {
          settle(code);
          return;
        }
        server.close((error) => {
          if (error) streams.stderr.write(`h2a focus ${argv[1]}: shutdown failed: ${error.message}\n`);
          settle(error ? 1 : code);
        });
        server.closeIdleConnections?.();
        forceTimer = setTimeout(() => {
          server.closeAllConnections?.();
          settle(code);
        }, 2000);
        forceTimer.unref();
      };
      const onAbort = (): void => stop(signalExitCode(signal?.reason));

      server.once("error", (error) => {
        streams.stderr.write(`h2a focus ${argv[1]}: server failed: ${error.message}\n`);
        stop(1);
      });
      server.listen({ host: resolved.host, port: resolved.port }, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : resolved.port;
        boundPort = port;
        streams.stdout.write(`Focus Web: http://${displayHost(resolved.host)}:${port}\n`);
        streams.stdout.write(`Repository: ${resolved.repoRoot}\n`);
        if (!restrictHostHeader) {
          streams.stderr.write(
            `h2a focus ${argv[1]}: warning: --host ${resolved.host} exposes an unauthenticated repository view\n`
          );
        }
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
    return rc;
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

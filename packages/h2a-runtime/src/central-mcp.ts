/**
 * Runtime-side central MCP lifecycle. The core package remains the sole owner
 * of marker validation, reclaim, and server startup; this module only selects
 * a persisted endpoint, asks core for protected liveness facts, and starts the
 * existing foreground command as a detached child when necessary.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getH2aConfig } from "./config.js";

type CentralMarker = Readonly<{
  endpoint: string;
  generation: string;
  pid: number;
  startedAt: string;
  root?: string;
  protocol?: number;
  endpointMode?: "fixed" | "discovered";
}>;

type CentralPing =
  | Readonly<{ kind: "generation"; generation: string }>
  | Readonly<{ kind: "dead" }>
  | Readonly<{ kind: "ambiguous" }>;

type CoreCentralMcp = Readonly<{
  ensureCentralForRoot(root: string): Promise<CentralMarker>;
  centralMcpMarkerPath(): string;
  H2A_MCP_CENTRAL_ENV: string;
  H2A_MCP_CENTRAL_ENDPOINT_ENV: string;
  centralMcpPing(endpoint: string, timeoutMs?: number): Promise<CentralPing>;
  readCentralMcpMarker(): CentralMarker | undefined;
  runCli(
    argv: readonly string[],
    streams: {
      stdout: Pick<typeof process.stdout, "write">;
      stderr: Pick<typeof process.stderr, "write">;
      cwd?: () => string;
    },
    options?: unknown,
  ): number;
}>;

export type CentralMcpPreparation =
  | Readonly<{ status: "central"; endpoint: string; generation: string }>
  | Readonly<{ status: "degraded"; reason: string }>;

let coreCentralMcp: Promise<CoreCentralMcp> | undefined;

function loadCoreCentralMcp(): Promise<CoreCentralMcp> {
  // Keep the core/runtime boundary dynamic. Core already reaches runtime via a
  // string-specifier seam for central marker ownership checks, so a static
  // runtime dependency here would turn that boundary into a hard cycle.
  const corePackage: string = "@sentropic/h2a";
  coreCentralMcp ??= import(corePackage).then((core) => {
    const candidate = core as Partial<CoreCentralMcp>;
    if (
      typeof candidate.H2A_MCP_CENTRAL_ENV !== "string" ||
      typeof candidate.H2A_MCP_CENTRAL_ENDPOINT_ENV !== "string" ||
      typeof candidate.centralMcpPing !== "function" ||
      typeof candidate.readCentralMcpMarker !== "function" ||
      typeof candidate.runCli !== "function"
    ) {
      throw new Error("@sentropic/h2a does not expose the central MCP runtime surface");
    }
    return candidate as CoreCentralMcp;
  });
  return coreCentralMcp;
}

/**
 * Ensure the persisted central endpoint is served. A live matching marker is
 * reused; dead registrations are reclaimed by the existing foreground serve
 * command, never by this runtime wrapper.
 */
export async function ensureCentralMcp(
  options: Readonly<{ root?: string }> = {},
): Promise<Readonly<{ endpoint: string; generation: string }> | undefined> {
  if (!getH2aConfig().central?.enabled || process.env.H2A_MCP_CENTRAL === "0" || process.env.H2A_MCP_CENTRAL === "false") return undefined;
  const rawRoot = options.root ?? process.env.H2A_ROOT;
  if (rawRoot && !isAbsolute(rawRoot)) {
    // Relative roots derive from cwd; deterministically select stdio per invariant
    return undefined;
  }
  const root = rawRoot ? resolve(rawRoot) : join(homedir(), "h2a-workspace", ".h2a");
  const core = await loadCoreCentralMcp();
  if (typeof core.ensureCentralForRoot !== "function") throw new Error("central_starter_unqualified");
  return core.ensureCentralForRoot(root);
}

function activateCentralMcpEnvironment(core: CoreCentralMcp, endpoint: string): void {
  process.env[core.H2A_MCP_CENTRAL_ENV] = "1";
  process.env.H2A_MCP_AUTHORITY = core.centralMcpMarkerPath();
  const marker = core.readCentralMcpMarker();
  if (marker?.endpointMode === "fixed") process.env[core.H2A_MCP_CENTRAL_ENDPOINT_ENV] = endpoint;
  else delete process.env[core.H2A_MCP_CENTRAL_ENDPOINT_ENV];
}

function deactivateCentralMcpEnvironment(): void {
  delete process.env.H2A_MCP_AUTHORITY;
  delete process.env.H2A_MCP_CENTRAL;
  delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prepare transport only. Configuration writes require an explicit host setup --write. */
export async function prepareCentralMcpForLaunch(options: Readonly<{
  root?: string;
  profile: string;
  cwd: string;
}>): Promise<CentralMcpPreparation | undefined> {
  return prepareCentralMcpForRestore(options.root ? { root: options.root } : {});
}

/** Restore and run never write a host or project configuration. */
export async function prepareCentralMcpForRestore(
  options: Readonly<{ root?: string }> = {},
): Promise<CentralMcpPreparation | undefined> {
  try {
    const central = await ensureCentralMcp(options);
    if (!central) return undefined;
    activateCentralMcpEnvironment(await loadCoreCentralMcp(), central.endpoint);
    return { status: "central", ...central };
  } catch (error) {
    deactivateCentralMcpEnvironment();
    return { status: "degraded", reason: errorMessage(error) };
  }
}

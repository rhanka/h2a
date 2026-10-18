import type { NativeTerminalClient } from "./client.js";
import type { NativeTerminalSessionState } from "./host.js";
import { NATIVE_TERMINAL_PROTOCOL_VERSION, type NativeTerminalPing } from "./protocol.js";

type NativeTerminalHostDetails = {
  generation: string;
  loadedVersion: string;
  frontendVersion?: string;
  admission?: "unfenced";
  retirement?: "deferred";
};

/** A launch fence/owner tag does not establish an admission drain barrier.
 * In particular, an unmodified pre-B peer cannot be retired automatically. */
export function describeNativeTerminalHost(ping: NativeTerminalPing): NativeTerminalHostDetails {
  if (ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION) throw new Error("unsupported native terminal client protocol");
  if (!Number.isSafeInteger(ping.hostPid) || ping.hostPid <= 0 || typeof ping.generation !== "string" || !ping.generation.trim()) {
    throw new Error("invalid native terminal host identity");
  }
  const { owner, frontend } = ping as NativeTerminalPing & { owner?: { pid?: number; version?: string }; frontend?: { version?: string } };
  if (owner && owner.pid !== ping.hostPid) throw new Error("native terminal owner identity mismatch");
  return { generation: ping.generation, loadedVersion: owner?.version || "unknown",
    ...(frontend?.version ? { frontendVersion: frontend.version } : {}),
    ...(!owner ? { admission: "unfenced" as const, retirement: "deferred" as const } : {}) };
}

export type NativeInventory = {
  complete: boolean;
  sessions: Array<NativeTerminalSessionState & { socketPath: string }>;
  hosts: Array<{ socketPath: string; client?: NativeTerminalClient; absent?: true; reason?: string } & Partial<NativeTerminalHostDetails>>;
};

/** Every endpoint contributes separately; duplicate names are evidence. */
export async function collectNativeInventory(
  endpoints: readonly string[],
  connect: (socketPath: string) => Promise<NativeTerminalClient>,
  proveAbsent?: (socketPath: string, failure: unknown) => Promise<boolean>,
): Promise<NativeInventory> {
  const inventory: NativeInventory = { complete: true, sessions: [], hosts: [] };
  for (const socketPath of endpoints) {
    try {
      const client = await connect(socketPath);
      const details = describeNativeTerminalHost(await client.ping());
      const sessions = await client.list();
      inventory.hosts.push({ socketPath, client, ...details });
      inventory.sessions.push(...sessions.map(session => ({ ...session, socketPath })));
    } catch (error) {
      try {
        if (await proveAbsent?.(socketPath, error)) {
          inventory.hosts.push({ socketPath, absent: true });
          continue;
        }
      } catch (proofError) {
        error = new Error(`${error instanceof Error ? error.message : String(error)}; absence proof failed: ${proofError instanceof Error ? proofError.message : String(proofError)}`);
      }
      inventory.complete = false;
      inventory.hosts.push({ socketPath, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return inventory;
}

export type NativeOwnerResolution =
  | { state: "found"; socketPath: string; client: NativeTerminalClient; session: NativeTerminalSessionState }
  | { state: "ambiguous-owner"; sockets: string[] }
  | { state: "unknown"; reason: string }
  | { state: "absent" };

export function resolveNativeOwner(id: string, inventory: NativeInventory): NativeOwnerResolution {
  const matches = inventory.sessions.filter(session => session.id === id);
  if (matches.length > 1) return { state: "ambiguous-owner", sockets: matches.map(session => session.socketPath) };
  const session = matches[0];
  if (session) return { state: "found", session, socketPath: session.socketPath,
    client: inventory.hosts.find(host => host.socketPath === session.socketPath)!.client! };
  if (!inventory.complete) return { state: "unknown", reason: inventory.hosts.filter(host => host.reason)
    .map(host => `${host.socketPath}: ${host.reason}`).join("; ") };
  return { state: "absent" };
}

import type { NativeTerminalClient } from "./client.js";
import type { NativeTerminalSessionState } from "./host.js";

export type NativeInventory = {
  complete: boolean;
  sessions: Array<NativeTerminalSessionState & { socketPath: string }>;
  hosts: Array<{ socketPath: string; client?: NativeTerminalClient; absent?: true; reason?: string }>;
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
      const sessions = await client.list();
      inventory.hosts.push({ socketPath, client });
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

import { NativeTerminalClient } from "./client.js";
import { collectNativeInventory, type NativeInventoryClient } from "./fleet.js";
import type { NativeTerminalSessionState } from "./host.js";
import { proveNativeTerminalEndpointAbsent } from "./server.js";
import { knownNativeTerminalSocketPaths } from "./socket-path.js";

export const REMOTE_NATIVE_INVENTORY_CONNECT_TIMEOUT_MS = 250 as const;
export const REMOTE_NATIVE_INVENTORY_REQUEST_TIMEOUT_MS = 250 as const;

export type RemoteNativeInventorySession = NativeTerminalSessionState & {
  readonly socketPath: string;
};

export interface RemoteNativeInventoryResult {
  readonly complete: boolean;
  readonly sessions: readonly RemoteNativeInventorySession[];
}

export interface RemoteNativeInventoryOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
  readonly socketPaths?: readonly string[];
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly connect?: (
    socketPath: string,
    options: { readonly connectTimeoutMs: number; readonly requestTimeoutMs: number },
  ) => Promise<NativeInventoryClient>;
  readonly proveAbsent?: (socketPath: string, failure: unknown) => Promise<boolean>;
}

function makeAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const err = new Error("native inventory aborted");
  err.name = "AbortError";
  (err as NodeJS.ErrnoException).code = "ABORT_ERR";
  return err;
}

function cloneSession(
  session: NativeTerminalSessionState & { readonly socketPath: string },
): RemoteNativeInventorySession {
  return {
    ...session,
    ...(session.exit ? { exit: { ...session.exit } } : {}),
    ...(session.lastLocalSize ? { lastLocalSize: { ...session.lastLocalSize } } : {}),
    ...(session.controller ? { controller: { ...session.controller } } : {}),
  };
}

/**
 * In-process asynchronous native terminal inventory reader for the remote
 * agent (LH-06). Never calls `spawnSync`, enforces short per-socket budgets
 * (250 ms connect + 250 ms list), closes every acquired client on completion,
 * error or cancellation (including late-resolving connects), and lets an
 * already-started native absence proof release its lock without blocking
 * `watch.stop()`.
 */
export async function listNativeInventoryForRemote(
  options: RemoteNativeInventoryOptions = {},
): Promise<RemoteNativeInventoryResult> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw makeAbortError(signal);
  }

  const connectTimeoutMs =
    options.connectTimeoutMs ?? REMOTE_NATIVE_INVENTORY_CONNECT_TIMEOUT_MS;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? REMOTE_NATIVE_INVENTORY_REQUEST_TIMEOUT_MS;
  const endpoints = options.socketPaths ?? knownNativeTerminalSocketPaths(options.env);
  const baseConnect =
    options.connect ??
    ((socketPath: string, opts: { readonly connectTimeoutMs: number; readonly requestTimeoutMs: number }) =>
      NativeTerminalClient.connect(socketPath, opts));
  const baseProveAbsent =
    options.proveAbsent ??
    ((socketPath: string, failure: unknown) =>
      proveNativeTerminalEndpointAbsent(socketPath, failure));

  const acquiredClients = new Set<NativeInventoryClient>();
  let aborted = false;
  let finished = false;
  const abortWaiters = new Set<() => void>();

  const closeClient = (client: NativeInventoryClient | undefined): void => {
    if (!client) return;
    acquiredClients.delete(client);
    try {
      client.close();
    } catch {
      // Idempotent close on shutdown/abort.
    }
  };

  const closeAllAcquired = (): void => {
    for (const client of [...acquiredClients]) {
      closeClient(client);
    }
  };

  const onAbort = (): void => {
    aborted = true;
    closeAllAcquired();
    for (const wake of [...abortWaiters]) {
      wake();
    }
    abortWaiters.clear();
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  const raceAbort = <T>(promise: Promise<T>): Promise<T> => {
    if (aborted || signal?.aborted) {
      return Promise.reject(makeAbortError(signal));
    }
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const wake = (): void => {
        if (settled) return;
        settled = true;
        abortWaiters.delete(wake);
        reject(makeAbortError(signal));
      };
      abortWaiters.add(wake);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          abortWaiters.delete(wake);
          if (aborted || signal.aborted) {
            reject(makeAbortError(signal));
          } else {
            resolve(value);
          }
        },
        (error) => {
          if (settled) return;
          settled = true;
          abortWaiters.delete(wake);
          reject(error);
        },
      );
    });
  };

  const guardedConnect = async (socketPath: string): Promise<NativeInventoryClient> => {
    if (aborted || finished || signal?.aborted) {
      throw makeAbortError(signal);
    }
    const rawPromise = baseConnect(socketPath, { connectTimeoutMs, requestTimeoutMs });
    // Ensure a client acquired AFTER abort/finish is closed immediately.
    rawPromise.then(
      (client) => {
        if (aborted || finished || signal?.aborted) {
          closeClient(client);
        }
      },
      () => {
        // Ignore late rejections after abort/finish.
      },
    );
    const client = await raceAbort(rawPromise);
    if (aborted || finished || signal?.aborted) {
      closeClient(client);
      throw makeAbortError(signal);
    }
    acquiredClients.add(client);
    return {
      async list() {
        if (aborted || finished || signal?.aborted) {
          closeClient(client);
          throw makeAbortError(signal);
        }
        const listPromise = client.list();
        listPromise.catch(() => {
          // Ignore late rejections after abort.
        });
        const sessions = await raceAbort(listPromise);
        if (aborted || finished || signal?.aborted) {
          closeClient(client);
          throw makeAbortError(signal);
        }
        return sessions;
      },
      close() {
        closeClient(client);
      },
    };
  };

  const guardedProveAbsent = async (
    socketPath: string,
    failure: unknown,
  ): Promise<boolean> => {
    if (aborted || finished || signal?.aborted) {
      throw makeAbortError(signal);
    }
    // Start read-only absence proof; if aborted while it holds its publication
    // lock, let it settle and release its lock in the background while the
    // caller returns immediately.
    const proofPromise = baseProveAbsent(socketPath, failure);
    proofPromise.catch(() => {
      // Ignore late rejection after abort so the lock release is clean.
    });
    const verdict = await raceAbort(proofPromise);
    if (aborted || finished || signal?.aborted) {
      throw makeAbortError(signal);
    }
    return verdict;
  };

  let inventory:
    | {
        complete: boolean;
        sessions: Array<NativeTerminalSessionState & { socketPath: string }>;
        hosts: Array<{ socketPath: string; client?: NativeInventoryClient }>;
      }
    | undefined;

  try {
    const collectPromise = collectNativeInventory(
      endpoints,
      guardedConnect,
      guardedProveAbsent,
    );
    collectPromise.then(
      (lateInventory) => {
        if (finished || aborted || signal?.aborted) {
          for (const host of lateInventory.hosts) {
            closeClient(host.client);
          }
        }
      },
      () => {
        // Ignore late rejections after abort.
      },
    );
    inventory = await raceAbort(collectPromise);
    if (aborted || signal?.aborted) {
      throw makeAbortError(signal);
    }
    return {
      complete: inventory.complete,
      sessions: inventory.sessions.map(cloneSession),
    };
  } finally {
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    abortWaiters.clear();
    if (inventory) {
      for (const host of inventory.hosts) {
        closeClient(host.client);
      }
    }
    closeAllAcquired();
  }
}

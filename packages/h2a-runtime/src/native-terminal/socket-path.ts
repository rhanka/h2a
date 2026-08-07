import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export type NativeTerminalSocketIdentity = Readonly<{
  dev: number;
  ino: number;
}>;

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function assertOwnedByCurrentUser(info: Stats, label: string): void {
  const uid = currentUid();
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`${label} must be owned by uid ${uid}`);
  }
}

export async function assertPrivateNativeTerminalSocketDirectory(
  socketPath: string,
): Promise<void> {
  if (!isAbsolute(socketPath)) {
    throw new Error("terminal host socket path must be absolute");
  }
  const directory = dirname(socketPath);
  const info = await lstat(directory);
  if (!info.isDirectory()) {
    throw new Error(`terminal host socket parent is not a directory: ${directory}`);
  }
  assertOwnedByCurrentUser(info, "terminal host socket parent");
  if ((info.mode & 0o777) !== 0o700) {
    throw new Error(
      `terminal host socket parent must have mode 0700: ${directory}`,
    );
  }
}

export async function inspectPrivateNativeTerminalSocket(
  socketPath: string,
): Promise<NativeTerminalSocketIdentity> {
  await assertPrivateNativeTerminalSocketDirectory(socketPath);
  const info = await lstat(socketPath);
  if (!info.isSocket()) {
    throw new Error(`terminal host path exists and is not a socket: ${socketPath}`);
  }
  assertOwnedByCurrentUser(info, "terminal host socket");
  if ((info.mode & 0o777) !== 0o600) {
    throw new Error(`terminal host socket must have mode 0600: ${socketPath}`);
  }
  return Object.freeze({ dev: info.dev, ino: info.ino });
}

export function sameNativeTerminalSocket(
  left: NativeTerminalSocketIdentity,
  right: NativeTerminalSocketIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

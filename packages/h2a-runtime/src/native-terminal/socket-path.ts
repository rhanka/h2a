import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export type NativeTerminalSocketIdentity = Readonly<{
  dev: number;
  ino: number;
}>;

// Kernel AF_UNIX sun_path budget: 108 bytes on Linux, 104 on Darwin, both
// including the terminating NUL. Binding or connecting past this limit does
// NOT fail loudly — libuv silently truncates the path, so the socket appears
// at a *different* name and every follow-up (chmod, lstat, connect) reports a
// baffling ENOENT. Fail closed with a clear message instead.
const UNIX_SOCKET_MAX_PATH_BYTES = process.platform === "darwin" ? 103 : 107;

export function assertNativeTerminalSocketPathWithinLimit(
  socketPath: string,
  label = "terminal host socket path",
): void {
  const bytes = Buffer.byteLength(socketPath, "utf8");
  if (bytes > UNIX_SOCKET_MAX_PATH_BYTES) {
    throw new Error(
      `${label} exceeds the unix socket path limit ` +
        `(${bytes} > ${UNIX_SOCKET_MAX_PATH_BYTES} bytes): ${socketPath}`,
    );
  }
}

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

/**
 * Canonical short socket path for the native terminal host. Nothing else in
 * the tree computes one; deriving a socket path from a workspace directory is
 * unsafe because deep workspace paths overflow the sun_path budget above.
 * The parent directory is created (0700) by the host server on startup.
 */
export function defaultNativeTerminalSocketPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const runtimeDir = env["XDG_RUNTIME_DIR"];
  const base = runtimeDir !== undefined && isAbsolute(runtimeDir)
    ? join(runtimeDir, "h2a-nt")
    : join(tmpdir(), `h2a-nt-${currentUid() ?? "default"}`);
  const socketPath = join(base, "native-terminal.sock");
  assertNativeTerminalSocketPathWithinLimit(socketPath);
  return socketPath;
}

/**
 * Shared ownership check for user-private runtime resources. Callers still own
 * their resource-specific type and mode checks.
 */
export function assertOwnedByCurrentUser(info: Stats, label: string): void {
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
  assertNativeTerminalSocketPathWithinLimit(socketPath);
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

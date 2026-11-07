/**
 * Open the sign-in URL in the system browser without a shell. STUB (tests first).
 */

import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface BrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, "on" | "unref">;

export function browserCommand(
  _platform: NodeJS.Platform,
  _url: string,
  _env: Readonly<Record<string, string | undefined>> = process.env,
): BrowserCommand {
  throw new Error("not implemented");
}

export function openInSystemBrowser(_url: string, _opts: { platform?: NodeJS.Platform; spawn?: SpawnLike } = {}): boolean {
  throw new Error("not implemented");
}

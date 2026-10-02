/** Independent launch owner: launcher death closes stdin, even during sync waits. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { killNativeSessionIfIncarnation } from "./native-host.js";
import { killLocalSession, localSessionPanePid } from "./tmux.js";

export type LaunchOwnership =
  | { host: "native"; sessions: Array<{ name: string; generation: string; incarnation: string }> }
  | { host: "tmux"; sessions: Array<{ name: string; pane: string; pid: number }> };

type CleanupDeps = {
  stopNative: (name: string, generation: string, incarnation: string) => boolean;
  stopTmux: (name: string, pane: string, pid: number) => boolean;
};

function writeStatus(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path); // The MCP reader must never observe partial JSON.
}

export function cleanupLaunch(ownership: LaunchOwnership, deps: CleanupDeps): boolean {
  let stopped = true;
  for (const session of [...ownership.sessions].reverse()) {
    try {
      const ok = ownership.host === "native"
        ? deps.stopNative(session.name, (session as { generation: string }).generation,
            (session as { incarnation: string }).incarnation)
        : deps.stopTmux(session.name, (session as { pane: string }).pane,
            (session as { pid: number }).pid);
      if (!ok) stopped = false;
    } catch {
      stopped = false; // Still stop the other owned sessions.
    }
  }
  return stopped;
}

export type LaunchGuard = {
  own: (ownership: LaunchOwnership) => void;
  complete: () => void;
};

/** Only call for a freshly created session, never an existing-name attach. */
export function startLaunchGuard(runDir: string, ownership: LaunchOwnership): LaunchGuard {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const statusPath = join(runDir, "launch.json");
  const child: ChildProcess = spawn(process.execPath,
    [fileURLToPath(new URL("./launch-guard.js", import.meta.url)), statusPath],
    { stdio: ["pipe", "ignore", "ignore"] });
  child.unref();
  (child.stdin as NodeJS.WritableStream & { unref?: () => void }).unref?.();
  child.on("error", () => {
    const stopped = cleanupLaunch(ownership, {
      stopNative: killNativeSessionIfIncarnation,
      stopTmux: (name, pane, pid) => localSessionPanePid(pane) === pid && killLocalSession(name),
    });
    writeStatus(statusPath, { state: stopped ? "stopped" : "cleanup-failed",
      token: process.env.H2A_RUN_LAUNCH_TOKEN, ownership });
  });
  // The guard may exit immediately after completing. An EPIPE must never
  // crash a successfully launched worker; its file remains the cleanup proof.
  child.stdin!.on("error", () => {});
  const own = (value: LaunchOwnership) => {
    writeStatus(statusPath, { state: "launching",
      token: process.env.H2A_RUN_LAUNCH_TOKEN, ownership: value });
    child.stdin!.write(`${JSON.stringify({ ownership: value })}\n`);
  };
  own(ownership);
  return {
    own,
    complete: () => { child.stdin!.end(`${JSON.stringify({ completed: true })}\n`); },
  };
}

async function guard(statusPath: string): Promise<void> {
  let ownership: LaunchOwnership | undefined;
  let completed = false;
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line) as { ownership?: LaunchOwnership; completed?: boolean };
    if (message.ownership) ownership = message.ownership;
    if (message.completed) completed = true;
  }
  if (!ownership) return;
  const stopped = completed ? false : cleanupLaunch(ownership, {
    stopNative: killNativeSessionIfIncarnation,
    stopTmux: (name, pane, pid) =>
      localSessionPanePid(pane) === pid && killLocalSession(name),
  });
  writeStatus(statusPath, {
    state: completed ? "started" : stopped ? "stopped" : "cleanup-failed",
    token: process.env.H2A_RUN_LAUNCH_TOKEN,
    ownership,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const statusPath = process.argv[2];
  if (!statusPath) throw new Error("launch guard requires a status path");
  await guard(statusPath);
}

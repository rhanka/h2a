/** Independent launch owner: launcher death closes stdin, even during sync waits. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { killNativeSessionIfIncarnation, nativeSessionState } from "./native-host.js";
import { sleepSync } from "./prompt-delivery.js";
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
  stop: () => boolean;
};

function stopOwnedNative(name: string, generation: string, incarnation: string): boolean {
  // A create op already in flight may outlive its launcher. Its deadline is
  // 15s; allow it to settle before certifying that a reserved session is absent.
  const deadline = Date.now() + 16_000;
  for (;;) {
    const probe = nativeSessionState(name);
    if (probe.state === "found") {
      if (probe.session.generation !== generation || probe.session.incarnation !== incarnation) return false;
      return probe.session.status === "exited" || killNativeSessionIfIncarnation(name, generation, incarnation);
    }
    if (probe.state === "unknown") return false;
    if (Date.now() >= deadline) return true;
    sleepSync(100);
  }
}

const cleanupDeps: CleanupDeps = {
  stopNative: stopOwnedNative,
  stopTmux: (name, pane, pid) => localSessionPanePid(pane) === pid && killLocalSession(name),
};

/** Only call for a freshly created session, never an existing-name attach. */
export function startLaunchGuard(runDir: string, ownership: LaunchOwnership, spawnGuard: typeof spawn = spawn): LaunchGuard {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const statusPath = join(runDir, "launch.json");
  let completed = false;
  const child: ChildProcess = spawnGuard(process.execPath,
    [fileURLToPath(new URL("./launch-guard.js", import.meta.url)), statusPath],
    { stdio: ["pipe", "ignore", "ignore"] });
  child.unref();
  (child.stdin as NodeJS.WritableStream & { unref?: () => void }).unref?.();
  child.on("error", () => {
    if (completed) return;
    const stopped = cleanupLaunch(ownership, cleanupDeps);
    writeStatus(statusPath, { state: stopped ? "stopped" : "cleanup-failed",
      token: process.env.H2A_RUN_LAUNCH_TOKEN, ownership });
  });
  // The guard may exit immediately after completing. An EPIPE must never
  // crash a successfully launched worker; its file remains the cleanup proof.
  child.stdin!.on("error", () => {});
  const own = (value: LaunchOwnership) => {
    ownership = value;
    writeStatus(statusPath, { state: "launching",
      token: process.env.H2A_RUN_LAUNCH_TOKEN, ownership: value });
    child.stdin!.write(`${JSON.stringify({ ownership: value })}\n`);
  };
  own(ownership);
  const finish = (state: string) => {
    completed = true;
    writeStatus(statusPath, { state, token: process.env.H2A_RUN_LAUNCH_TOKEN, ownership });
    child.stdin!.end(`${JSON.stringify({ completed: true, state })}\n`);
  };
  return {
    own,
    complete: () => finish("started"),
    stop: () => {
      const stopped = cleanupLaunch(ownership, cleanupDeps);
      finish(stopped ? "stopped" : "cleanup-failed");
      return stopped;
    },
  };
}

async function guard(statusPath: string): Promise<void> {
  let ownership: LaunchOwnership | undefined;
  let completed = false;
  let finalState = "started";
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line) as { ownership?: LaunchOwnership; completed?: boolean; state?: string };
    if (message.ownership) ownership = message.ownership;
    if (message.completed) { completed = true; finalState = message.state ?? "started"; }
  }
  // The atomic receipt also covers death before the pipe write was flushed.
  if (!completed) {
    try {
      const receipt = JSON.parse(readFileSync(statusPath, "utf8"));
      if (receipt.token === process.env.H2A_RUN_LAUNCH_TOKEN) {
        ownership = receipt.ownership;
        if (["started", "stopped", "cleanup-failed"].includes(receipt.state)) {
          completed = true;
          finalState = receipt.state;
        }
      }
    } catch { /* Pipe ownership remains usable. */ }
  }
  if (!ownership) return;
  const stopped = completed ? false : cleanupLaunch(ownership, cleanupDeps);
  writeStatus(statusPath, {
    state: completed ? finalState : stopped ? "stopped" : "cleanup-failed",
    token: process.env.H2A_RUN_LAUNCH_TOKEN,
    ownership,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const statusPath = process.argv[2];
  if (!statusPath) throw new Error("launch guard requires a status path");
  await guard(statusPath);
}

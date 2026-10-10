/** Independent launch owner: launcher death closes stdin, even during sync waits. */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import { killNativeSessionIfIncarnation, nativeSessionState } from "./native-host.js";
import type { NativeLaunchOwnership } from "./native-host.js";
import { sleepSync } from "./prompt-delivery.js";
import { withLaunchReceipt, updateLaunchReceipt } from "./launch-receipt.js";
import { killLocalSession, localSessionPanePid } from "./tmux.js";
import { ownLaunchSlot, releaseLaunchSlot } from "./launch-capacity.js";

export type LaunchOwnership =
  | { host: "native"; sessions: Array<NativeLaunchOwnership> }
  | { host: "tmux"; sessions: Array<{ name: string; pane: string; pid: number }> };

type CleanupDeps = {
  stopNative: (name: string, generation: string, incarnation: string, socketPath: string, inputEpoch?: number) => boolean;
  stopTmux: (name: string, pane: string, pid: number) => boolean;
};

function writeStatus(path: string, value: unknown): void {
  updateLaunchReceipt(path, process.env.H2A_RUN_LAUNCH_TOKEN, value as Record<string, unknown>);
}

export function cleanupLaunch(ownership: LaunchOwnership, deps: CleanupDeps, inputEpoch?: number): boolean {
  let stopped = true;
  for (const session of [...ownership.sessions].reverse()) {
    try {
      const ok = ownership.host === "native"
        ? deps.stopNative(session.name, (session as { generation: string }).generation,
            (session as { incarnation: string }).incarnation, (session as NativeLaunchOwnership).socketPath,
            ...(inputEpoch !== undefined && session === ownership.sessions[0] ? [inputEpoch] : []))
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
  markSubmitAttempted: () => void;
  complete: () => void;
  stop: () => boolean;
  isSubmitAttempted: () => boolean;
};

function stopOwnedNative(name: string, generation: string, incarnation: string, socketPath: string, inputEpoch?: number): boolean {
  if (!socketPath) return false; // No owner reference means cleanup is unproven.
  // A create op already in flight may outlive its launcher. Its deadline is
  // 15s; allow it to settle before certifying that a reserved session is absent.
  const deadline = Date.now() + 16_000;
  for (;;) {
    const probe = nativeSessionState(name, socketPath);
    if (probe.state === "found") {
      if (probe.session.generation !== generation || probe.session.incarnation !== incarnation) return false;
      return probe.session.status === "exited" || killNativeSessionIfIncarnation(name, generation, incarnation, socketPath, inputEpoch);
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
  let submitAttempted = false;
  const child: ChildProcess = spawnGuard(process.execPath,
    [fileURLToPath(new URL("./launch-guard.js", import.meta.url)), statusPath],
    { stdio: ["pipe", "ignore", "ignore"] });
  child.unref();
  (child.stdin as NodeJS.WritableStream & { unref?: () => void }).unref?.();
  child.on("error", () => {
    if (completed) return;
    try {
      withLaunchReceipt(statusPath, process.env.H2A_RUN_LAUNCH_TOKEN, (receipt, save) => {
        submitAttempted ||= receipt?.submitAttempted === true;
        if (submitAttempted) {
          save({ state: "launch-unconfirmed", submitAttempted: true, retrySafe: false, stopped: false, ownership });
        } else {
          const stopped = cleanupLaunch(ownership, cleanupDeps, receipt?.inputEpoch as number | undefined);
          save({ state: stopped ? "stopped" : "cleanup-failed", ownership });
        }
      });
    } catch { /* An unreadable or foreign receipt never authorizes cleanup. */ }
    return;

  });
  // The guard may exit immediately after completing. An EPIPE must never
  // crash a successfully launched worker; its file remains the cleanup proof.
  child.stdin!.on("error", () => {});
  const own = (value: LaunchOwnership) => {
    ownership = value;
    writeStatus(statusPath, { state: "launching",
      token: process.env.H2A_RUN_LAUNCH_TOKEN,
      submitAttempted: submitAttempted || undefined,
      ownership: value });
    child.stdin!.write(`${JSON.stringify({ ownership: value, submitAttempted: submitAttempted || undefined })}\n`);
    if (value.host === "native" && value.sessions[0]) ownLaunchSlot(value.sessions[0].name.replace(/^h2a-/, ""), value.sessions);
  };
  own(ownership);
  const markSubmitAttempted = () => {
    submitAttempted = true;
    writeStatus(statusPath, {
      state: "launching",
      token: process.env.H2A_RUN_LAUNCH_TOKEN,
      submitAttempted: true,
      ownership,
    });
    child.stdin!.write(`${JSON.stringify({ submitAttempted: true })}\n`);
  };
  const finish = (state: string) => {
    completed = true;
    const payload: Record<string, unknown> = {
      state,
      token: process.env.H2A_RUN_LAUNCH_TOKEN,
      ownership,
    };
    if (submitAttempted) {
      payload.submitAttempted = true;
      if (state === "launch-unconfirmed") {
        payload.retrySafe = false;
        payload.stopped = false;
      }
    }
    writeStatus(statusPath, payload);
    child.stdin!.end(`${JSON.stringify({ completed: true, state, submitAttempted: submitAttempted || undefined })}\n`);
  };
  return {
    own,
    markSubmitAttempted,
    isSubmitAttempted: () => withLaunchReceipt(statusPath, process.env.H2A_RUN_LAUNCH_TOKEN, receipt => {
      submitAttempted ||= receipt?.submitAttempted === true;
      return submitAttempted;
    }),
    complete: () => finish("started"),
    stop: () => {
      let stopped = false;
      let state = "launch-unconfirmed";
      try {
        withLaunchReceipt(statusPath, process.env.H2A_RUN_LAUNCH_TOKEN, (receipt, save) => {
          submitAttempted ||= receipt?.submitAttempted === true;
          if (!submitAttempted) {
            stopped = cleanupLaunch(ownership, cleanupDeps, receipt?.inputEpoch as number | undefined);
            state = stopped ? "stopped" : "cleanup-failed";
          }
          save({ state, submitAttempted, ownership, ...(submitAttempted ? { retrySafe: false, stopped: false } : {}) });
        });
      } catch { return false; }
      completed = true;
      child.stdin!.end(`${JSON.stringify({ completed: true, state, submitAttempted })}\n`);
      return stopped;
    },
  };
}

async function guard(statusPath: string): Promise<void> {
  let ownership: LaunchOwnership | undefined;
  let completed = false;
  let submitAttempted = false;
  let finalState = "started";
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line) as {
      ownership?: LaunchOwnership;
      completed?: boolean;
      state?: string;
      submitAttempted?: boolean;
    };
    if (message.ownership) ownership = message.ownership;
    if (message.submitAttempted) submitAttempted = true;
    if (message.completed) {
      completed = true;
      finalState = message.state ?? "started";
    }
  }
  // EOF, pipe errors and parent cleanup all fence on the same durable receipt.
  try {
    withLaunchReceipt(statusPath, process.env.H2A_RUN_LAUNCH_TOKEN, (receipt, save) => {
      if (!receipt) return; // Missing durability never proves non-submission.
      if (receipt.ownership) ownership = receipt.ownership as LaunchOwnership;
      submitAttempted ||= receipt.submitAttempted === true;
      if (!ownership) return;
      if (["started", "stopped", "cleanup-failed", "launch-unconfirmed"].includes(String(receipt.state))) return;
      if (submitAttempted) {
        save({ state: "launch-unconfirmed", submitAttempted: true, retrySafe: false, stopped: false, ownership });
        return;
      }
      const stopped = cleanupLaunch(ownership, cleanupDeps, receipt.inputEpoch as number | undefined);
      save({ state: stopped ? "stopped" : "cleanup-failed", ownership });
      if (stopped && ownership.host === "native" && ownership.sessions[0]) releaseLaunchSlot(ownership.sessions[0].name.replace(/^h2a-/, ""), "stopped");
    });
  } catch { /* Foreign, corrupt or locked receipt: preserve every incarnation. */ }

}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const statusPath = process.argv[2];
  if (!statusPath) throw new Error("launch guard requires a status path");
  await guard(statusPath);
}

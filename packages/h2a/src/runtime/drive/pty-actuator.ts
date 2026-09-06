import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { H2ALaunchContext, H2ASession } from "../../session.js";
import { listPresence } from "../local-files/presence.js";
import type { RelauncherRuntime } from "../drumbeat/relaunchers.js";
import type { H2ARelauncher } from "../drumbeat/watch.js";
import type { H2ADriver } from "./index.js";
import type {
  ActuationRequest,
  ActuationResult,
  ClusterMeshRegistration,
  PtyActuatorPort,
  SessionTargetStatePort
} from "@sentropic/cluster-mesh";

const ACTUATOR_REF_PREFIX = "h2a-pty:v1:";

export type ActuationTarget =
  | {
      readonly kind: "native-terminal";
      readonly sessionId: string;
      readonly instance: string;
      readonly host?: string;
      readonly launchContext?: H2ALaunchContext;
    }
  | {
      readonly kind: "tmux";
      /** The current volatile `session:window.pane` (or bare pane id). */
      readonly target: string;
      readonly instance: string;
      readonly host?: string;
      readonly launchContext: H2ALaunchContext;
    }
  | {
      readonly kind: "opaque";
      readonly handle: string;
      readonly instance: string;
      readonly host?: string;
      readonly launchContext?: H2ALaunchContext;
    };

export type H2aTargetState = "alive" | "dead" | "parked" | "unknown";

/**
 * The registration is optional because the health-only port methods receive
 * only `actuatorRef`. Actuation passes the real registration through, without
 * interpreting it or repeating the cluster-mesh authorization gate.
 */
export type ResolveActuationTarget = (
  actuatorRef: string,
  registration?: ClusterMeshRegistration
) => ActuationTarget | null;

export type ProbeAliveness = (
  target: ActuationTarget
) => Promise<H2aTargetState>;

export interface H2aPtyActuatorDeps {
  readonly resolveActuationTarget?: ResolveActuationTarget;
  readonly probeAliveness?: ProbeAliveness;
  readonly drivers?: Partial<Record<"drive" | "wake", H2ADriver>>;
  readonly relaunchers?: Partial<Record<ActuationTarget["kind"], H2ARelauncher>>;
  readonly now?: () => number;
}

type NativeTerminalState = {
  readonly id?: unknown;
  readonly status?: unknown;
};

let cachedNativeTerminalOpPath: string | null | undefined;

function nativeTerminalOpPath(): string | undefined {
  if (cachedNativeTerminalOpPath !== undefined) {
    return cachedNativeTerminalOpPath ?? undefined;
  }
  let entry: string | undefined;
  try {
    const resolver = (import.meta as unknown as {
      resolve?: (specifier: string) => string;
    }).resolve;
    if (typeof resolver === "function") {
      entry = fileURLToPath(resolver("@sentropic/h2a-runtime"));
    }
  } catch {
    entry = undefined;
  }
  if (entry === undefined) {
    try {
      entry = createRequire(import.meta.url).resolve("@sentropic/h2a-runtime");
    } catch {
      cachedNativeTerminalOpPath = null;
      return undefined;
    }
  }
  const operation = join(dirname(entry), "native-terminal", "op.js");
  cachedNativeTerminalOpPath = existsSync(operation) ? operation : null;
  return cachedNativeTerminalOpPath ?? undefined;
}

function runNativeTerminalOp(args: readonly string[]): Record<string, unknown> | undefined {
  const operation = nativeTerminalOpPath();
  if (operation === undefined) return undefined;
  const result = spawnSync(process.execPath, [operation, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) return undefined;
  const line = result.stdout.trim().split("\n").at(-1);
  if (!line) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function h2aStoreRoot(): string {
  const configured = process.env.H2A_ROOT;
  return configured && configured.length > 0
    ? configured
    : join(homedir(), "h2a-workspace", ".h2a");
}

function targetKey(actuatorRef: string): string | undefined {
  if (!actuatorRef.startsWith(ACTUATOR_REF_PREFIX)) return undefined;
  const key = actuatorRef.slice(ACTUATOR_REF_PREFIX.length);
  return key.length > 0 ? key : undefined;
}

function tmuxPane(launchContext: H2ALaunchContext): string | undefined {
  const tmux = launchContext.tmux;
  if (!tmux) return undefined;
  return tmux.window === undefined
    ? tmux.pane
    : `${tmux.session}:${tmux.window}.${tmux.pane}`;
}

function nativeTerminalSession(sessionKey: string): NativeTerminalState | undefined {
  const listed = runNativeTerminalOp(["list"]);
  const sessions = listed?.sessions;
  if (!Array.isArray(sessions)) return undefined;
  const matches = sessions.filter(
    (session): session is NativeTerminalState =>
      !!session &&
      typeof session === "object" &&
      !Array.isArray(session) &&
      (session as NativeTerminalState).id === sessionKey
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Default stable lookup. The registration stores `h2a-pty:v1:<sessionKey>`,
 * never a pane address. For tmux, `sessionKey` may match the perennial h2a
 * instance/session/name or its managed tmux session; fresh presence supplies
 * the current pane after a relaunch. For native-terminal, `sessionKey` is the
 * stable native session id and the native host list proves the current target.
 * A fresh non-tmux presence with no native match is retained as an opaque
 * handle (and probes `unknown` by default); a wholly unresolved key is null.
 */
export function resolveActuationTarget(
  actuatorRef: string,
  _registration?: ClusterMeshRegistration,
  now: number = Date.now()
): ActuationTarget | null {
  const sessionKey = targetKey(actuatorRef);
  if (sessionKey === undefined) return null;

  let current: H2ASession | undefined;
  try {
    current = listPresence(h2aStoreRoot(), { now, sweep: false })
      .filter(
        (session) =>
          session.instance === sessionKey ||
          session.sessionId === sessionKey ||
          session.name === sessionKey ||
          session.launchContext?.tmux?.session === sessionKey
      )
      .sort((left, right) => Date.parse(right.heartbeatAt) - Date.parse(left.heartbeatAt))[0];
  } catch {
    current = undefined;
  }

  if (current?.launchContext) {
    const pane = tmuxPane(current.launchContext);
    if (pane !== undefined) {
      return {
        kind: "tmux",
        target: pane,
        instance: current.instance,
        ...(current.host !== undefined ? { host: current.host } : {}),
        launchContext: current.launchContext
      };
    }
  }

  if (nativeTerminalSession(sessionKey) !== undefined) {
    return {
      kind: "native-terminal",
      sessionId: sessionKey,
      instance: current?.instance ?? sessionKey,
      ...(current?.host !== undefined ? { host: current.host } : {}),
      ...(current?.launchContext !== undefined
        ? { launchContext: current.launchContext }
        : {})
    };
  }

  if (current !== undefined) {
    return {
      kind: "opaque",
      handle: sessionKey,
      instance: current.instance,
      ...(current.host !== undefined ? { host: current.host } : {}),
      ...(current.launchContext !== undefined
        ? { launchContext: current.launchContext }
        : {})
    };
  }
  return null;
}

function probeTmux(
  target: Extract<ActuationTarget, { kind: "tmux" }>,
  runtime: Pick<RelauncherRuntime, "capture">
): H2aTargetState {
  const pane = runtime.capture?.("tmux", [
    "display-message",
    "-p",
    "-t",
    target.target,
    "#{pane_dead}:#{pane_id}"
  ]);
  if (pane === undefined) return "dead";
  return pane.trim().startsWith("1:") ? "dead" : "alive";
}

function nativeState(status: unknown): H2aTargetState | undefined {
  switch (status) {
    case "running":
      return "alive";
    case "stopping":
      return "parked";
    case "exited":
      return "dead";
    default:
      return undefined;
  }
}

/** One default aliveness probe shared by both exported port factories. */
export async function probeAliveness(target: ActuationTarget): Promise<H2aTargetState> {
  switch (target.kind) {
    case "tmux": {
      const { defaultRelauncherRuntime } = await import("../drumbeat/relaunchers.js");
      return probeTmux(target, defaultRelauncherRuntime);
    }
    case "native-terminal": {
      const state = runNativeTerminalOp(["state", "--id", target.sessionId]);
      const known = nativeState(state?.status);
      if (known !== undefined) return known;
      const probe = runNativeTerminalOp(["probe", "--id", target.sessionId]);
      if (probe?.verdict === "dead") return "dead";
      if (probe?.verdict === "live") return "alive";
      return "unknown";
    }
    case "opaque":
      return "unknown";
  }
}

async function defaultDriver(target: ActuationTarget): Promise<H2ADriver> {
  const { headlessDriver, localTmuxDriver, nativeBackchannelDriver } =
    await import("./index.js");
  if (target.kind === "tmux") return localTmuxDriver();
  if (target.kind === "opaque") return headlessDriver();
  return nativeBackchannelDriver({
    send(request) {
      const result = runNativeTerminalOp([
        "drive",
        "--target",
        request.to,
        "--b64",
        Buffer.from(request.instructionLine, "utf8").toString("base64")
      ]);
      if (result?.outcome === "unresolved") return undefined;
      return result?.outcome === "driven";
    }
  });
}

function receiptTarget(target: ActuationTarget): string {
  switch (target.kind) {
    case "native-terminal":
      return target.sessionId;
    case "tmux":
      return target.target;
    case "opaque":
      return `opaque:${createHash("sha256").update(target.handle).digest("hex").slice(0, 16)}`;
  }
}

function driverRequest(target: ActuationTarget, commandRef: string) {
  return {
    to: target.kind === "native-terminal" ? target.sessionId : target.instance,
    instructionLine: commandRef,
    ...(target.host !== undefined ? { host: target.host } : {}),
    ...(target.launchContext !== undefined
      ? { launchContext: target.launchContext }
      : {})
  };
}

async function defaultRelauncher(target: ActuationTarget): Promise<H2ARelauncher> {
  const { chainRelauncher, headlessRelauncher, localTmuxRelauncher } =
    await import("../drumbeat/relaunchers.js");
  return target.kind === "tmux"
    ? chainRelauncher(localTmuxRelauncher(), headlessRelauncher())
    : headlessRelauncher();
}

export function createH2aPtyActuator(
  deps: H2aPtyActuatorDeps = {}
): PtyActuatorPort {
  const resolve = deps.resolveActuationTarget ??
    ((actuatorRef, registration) =>
      resolveActuationTarget(actuatorRef, registration, deps.now?.() ?? Date.now()));
  const probe = deps.probeAliveness ?? probeAliveness;
  const now = deps.now ?? Date.now;
  let receiptSequence = 0;

  const result = (
    input: ActuationRequest,
    outcome: "acted" | "deferred" | "failed",
    target?: ActuationTarget
  ): ActuationResult => {
    receiptSequence += 1;
    const digest = createHash("sha256")
      .update(
        `${input.action}\0${input.registration.actuatorRef}\0${now()}\0${receiptSequence}`
      )
      .digest("hex")
      .slice(0, 20);
    return {
      effectRef: `h2a-pty:${outcome}:${input.action}:${digest}`,
      actedTargets:
        outcome === "acted" && target !== undefined
          ? [receiptTarget(target)]
          : []
    };
  };

  return {
    kind: "pty",
    async isAvailable(actuatorRef) {
      let target: ActuationTarget | null;
      try {
        target = resolve(actuatorRef);
      } catch {
        return false;
      }
      if (target === null) return false;
      try {
        return (await probe(target)) === "alive";
      } catch {
        return false;
      }
    },
    async actuate(input) {
      let target: ActuationTarget | null;
      try {
        target = resolve(input.registration.actuatorRef, input.registration);
      } catch {
        return result(input, "failed");
      }
      if (target === null) return result(input, "deferred");

      if (input.action === "relaunch") {
        const launchContext = target.launchContext;
        const command = launchContext?.resumeCommand ?? launchContext?.command;
        if (!command || command.trim().length === 0) {
          return result(input, "deferred");
        }
        let acted = false;
        try {
          const relauncher =
            deps.relaunchers?.[target.kind] ?? await defaultRelauncher(target);
          acted = await relauncher.relance({
            instance: target.instance,
            reason: "stopped",
            workStatus: "paused",
            launchContext,
            relanceCount: 0
          });
        } catch {
          acted = false;
        }
        return result(input, acted ? "acted" : "failed", acted ? target : undefined);
      }

      if (input.commandRef.trim().length === 0) return result(input, "deferred");
      let state: H2aTargetState;
      try {
        state = await probe(target);
      } catch {
        state = "unknown";
      }
      if (state !== "alive") return result(input, "failed");

      let acted = false;
      try {
        const driver = deps.drivers?.[input.action] ?? await defaultDriver(target);
        acted = await driver.drive(driverRequest(target, input.commandRef));
      } catch {
        acted = false;
      }
      return result(input, acted ? "acted" : "failed", acted ? target : undefined);
    }
  };
}

export function createH2aSessionTargetState(
  deps: H2aPtyActuatorDeps = {}
): SessionTargetStatePort {
  const resolve = deps.resolveActuationTarget ??
    ((actuatorRef, registration) =>
      resolveActuationTarget(actuatorRef, registration, deps.now?.() ?? Date.now()));
  const probe = deps.probeAliveness ?? probeAliveness;
  return {
    async inspect(actuatorRef) {
      let target: ActuationTarget | null;
      try {
        target = resolve(actuatorRef);
      } catch {
        return "unknown";
      }
      if (target === null) return "dead";
      try {
        return await probe(target);
      } catch {
        return "unknown";
      }
    }
  };
}

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readPtyProcess, type PtyProcess } from "../proc-cpu.js";
import { UNKNOWN_APPLICATION_FOREGROUND, type ApplicationForeground } from "./protocol.js";

export const APPLICATION_ROLE_ENV = "H2A_NATIVE_FOREGROUND_ROLE";

type ForegroundProcess = Readonly<Pick<PtyProcess, "pid" | "birth" | "state" | "processGroup">>;
type ForegroundObservation = Readonly<{
  foregroundProcessGroup: number;
  application?: ForegroundProcess;
  shell?: ForegroundProcess;
}>;

export type ApplicationForegroundReader = (
  ptyPid: number, ptyBirth: number, token: string,
) => ForegroundObservation | undefined;

const MAX_LAUNCH_PROCESSES = 16;

function launchChildren(pid: number): number[] {
  const raw = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
  return raw ? raw.split(/\s+/).map(Number) : [];
}

function sameTerminal(root: PtyProcess, child: PtyProcess): boolean {
  return root.session === child.session && root.tty === child.tty &&
    root.foregroundProcessGroup === child.foregroundProcessGroup;
}

function sameProcess(first: PtyProcess, current: PtyProcess): boolean {
  return first.pid === current.pid && first.birth === current.birth &&
    first.parent === current.parent && first.processGroup === current.processGroup &&
    sameTerminal(first, current);
}

/**
 * Observe only the launch chain under the PTY leader we spawned. The native
 * launch wrapper stamps the specific exec PID. A child inheriting that label
 * cannot enroll itself, and the reset OSC never serves as identity evidence.
 */
export const readApplicationForeground: ApplicationForegroundReader = (ptyPid, ptyBirth, token) => {
  if (process.platform !== "linux") return undefined;
  const root = readPtyProcess(ptyPid);
  if (!root || Number(root.birth) !== ptyBirth || root.session !== ptyPid ||
      root.tty === 0 || root.foregroundProcessGroup <= 0) return undefined;

  let application: PtyProcess | undefined;
  let shell: PtyProcess | undefined;
  const queue = [{ process: root, depth: 0 }];
  try {
    for (let index = 0; index < queue.length; index++) {
      const { process: candidate, depth } = queue[index]!;
      if (candidate.state === "Z" || candidate.state === "X") continue;
      const env = readFileSync(`/proc/${candidate.pid}/environ`, "utf8").split("\0");
      if (!env.includes(token)) return undefined;
      const isApplication = env.includes(`${APPLICATION_ROLE_ENV}=cli:${candidate.pid}`);
      const isShell = env.includes(`${APPLICATION_ROLE_ENV}=shell:${candidate.pid}`);
      if (isApplication || isShell) {
        if (application || shell || (isApplication && isShell)) return undefined;
        const confirmed = readPtyProcess(candidate.pid);
        if (!confirmed || !sameProcess(candidate, confirmed)) return undefined;
        if (isApplication) application = confirmed;
        else shell = confirmed;
        continue;
      }
      // forkpty guardian -> launch wrapper -> application. The guardian and
      // wrapper may exec directly, so each position can also be the leaf.
      if (depth === 2) continue;
      const children = launchChildren(candidate.pid);
      if (queue.length + children.length > MAX_LAUNCH_PROCESSES) return undefined;
      for (const pid of children) {
        const child = readPtyProcess(pid);
        if (!child || child.parent !== candidate.pid || !sameTerminal(root, child)) return undefined;
        queue.push({ process: child, depth: depth + 1 });
      }
    }
  } catch {
    return undefined;
  }

  // A foreground switch or a recycled leader during the walk invalidates it.
  const confirmed = readPtyProcess(ptyPid);
  if (!confirmed || !sameProcess(root, confirmed)) return undefined;
  return {
    foregroundProcessGroup: root.foregroundProcessGroup,
    ...(application ? { application } : {}),
    ...(shell ? { shell } : {}),
  };
};

function canReadTerminal(process: ForegroundProcess): boolean {
  return !["T", "t", "Z", "X", "x"].includes(process.state);
}

export class ApplicationFacetState {
  #current: ApplicationForeground = UNKNOWN_APPLICATION_FOREGROUND;
  #application: { pid: number; birth: string; incarnation: string } | undefined;

  get current(): ApplicationForeground {
    return this.#current;
  }

  invalidate(replacePty = false): ApplicationForeground {
    if (replacePty) this.#application = undefined;
    return this.#update("unknown", null, null, true);
  }

  observe(observation: ForegroundObservation | undefined): ApplicationForeground {
    if (!observation || (observation.application && observation.shell)) {
      return this.#update("unknown", null, null);
    }
    const { application, shell, foregroundProcessGroup: group } = observation;
    if (application && !["Z", "X", "x"].includes(application.state)) {
      if (this.#application?.pid === application.pid && this.#application.birth !== application.birth) {
        return this.#update("unknown", null, group);
      }
      if (this.#application?.pid !== application.pid) {
        this.#application = { pid: application.pid, birth: application.birth, incarnation: randomUUID() };
      }
      if (!canReadTerminal(application)) return this.#update("unknown", this.#application.incarnation, group);
      return this.#update(
        group === application.processGroup ? "cli" : "other", this.#application.incarnation, group,
      );
    }
    if (shell && canReadTerminal(shell) && shell.processGroup === group) {
      return this.#update("shell", null, group);
    }
    return this.#update("unknown", null, group);
  }

  #update(
    applicationFacet: ApplicationForeground["applicationFacet"],
    applicationIncarnation: string | null,
    foregroundProcessGroup: number | null,
    force = false,
  ): ApplicationForeground {
    const current = this.#current;
    if (!force && current.applicationFacet === applicationFacet &&
        current.applicationIncarnation === applicationIncarnation &&
        current.foregroundProcessGroup === foregroundProcessGroup) return current;
    this.#current = Object.freeze({
      applicationFacet,
      applicationIncarnation,
      foregroundProcessGroup,
      foregroundRevision: current.foregroundRevision + 1,
    });
    return this.#current;
  }
}

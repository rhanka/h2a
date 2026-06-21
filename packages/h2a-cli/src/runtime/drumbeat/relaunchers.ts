/**
 * Drumbeat relauncher adapters (DEC-091, slice D3). D2 shipped the dumb daemon
 * + the `H2ARelauncher` interface with only a logging adapter; D3 supplies the
 * two **local** adapters that actually revive a stalled agent:
 *
 * - **local-tmux**: `tmux send-keys` the resume/launch command into the pane
 *   captured at launch (DEC-085 `launchContext.tmux`). The natural revive for a
 *   user-local agent — it lands back in its original terminal.
 * - **headless**: detached background respawn of the captured command + a
 *   notification (the PRINCIPAL escalation is wired fully in D7).
 *
 * `chainRelauncher` composes them (try tmux, fall back to headless) — the
 * "local-tmux adapter + headless fallback" of D3. The actual process I/O is
 * behind an injectable `RelauncherRuntime` so the adapters are unit-testable
 * with no real tmux or child processes. The remote adapter is D4.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  H2A_DRUMBEAT_RESUME_BODY_KIND,
  createEnvelope,
  type H2AActorRef,
  type H2ADrumbeatResumeBody,
  type H2AEnvelope
} from "@sentropic/h2a";

import { createLocalStore } from "../local-files/store.js";
import {
  sendRemoteEnvelope,
  type SendRemoteOptions,
  type SendRemoteResult
} from "../remote/client.js";
import type { H2ADrumbeatFinding } from "./scan.js";
import type { H2ARelauncher } from "./watch.js";

/** Process I/O the adapters need — injected so tests supply a fake. */
export interface RelauncherRuntime {
  /** Run a foreground command; return true on exit code 0. */
  run(file: string, args: readonly string[]): boolean;
  /** Spawn a detached background process; return true if it started. */
  spawnDetached(
    command: string | { file: string; args: readonly string[]; cwd?: string },
    options: { cwd?: string }
  ): boolean;
  /** Run a command and return its stdout (undefined on failure). For probes. */
  capture?(file: string, args: readonly string[]): string | undefined;
  /** Optional side-channel note (relances are observable). */
  notify?(line: string): void;
}

export const defaultRelauncherRuntime: RelauncherRuntime = {
  run(file, args) {
    const res = spawnSync(file, [...args], { stdio: "ignore" });
    return res.status === 0;
  },
  capture(file, args) {
    try {
      const res = spawnSync(file, [...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return res.status === 0 ? res.stdout : undefined;
    } catch {
      return undefined;
    }
  },
  spawnDetached(command, options) {
    try {
      const child =
        typeof command === "string"
          ? spawn(command, {
              cwd: options.cwd,
              shell: true,
              detached: true,
              stdio: "ignore"
            })
          : spawn(command.file, [...command.args], {
              cwd: command.cwd ?? options.cwd,
              detached: true,
              stdio: "ignore"
            });
      child.unref();
      return child.pid !== undefined;
    } catch {
      return false;
    }
  }
};

interface RelauncherCommonOptions {
  runtime?: RelauncherRuntime;
  log?: (line: string) => void;
}

export type RemoteEndpointResolver = (
  instance: string
) => string | undefined | Promise<string | undefined>;

export type RemoteEnvelopeSender = (
  url: string,
  envelope: H2AEnvelope<H2ADrumbeatResumeBody>,
  options: SendRemoteOptions
) => Promise<SendRemoteResult>;

export interface RemoteRelauncherOptions {
  /** Store root used by the default endpoint resolver. */
  root?: string;
  /** Actor placed on the resume envelope and used as the signature signer. */
  actor: H2AActorRef;
  /** Signer's ed25519 private-key PEM. */
  privateKeyPem: string;
  /** Resolve the target instance to its remote endpoint. Defaults to registry lookup. */
  resolveEndpoint?: RemoteEndpointResolver;
  /** Transport override for tests. Defaults to sendRemoteEnvelope. */
  sendImpl?: RemoteEnvelopeSender;
  /** Clock source for deterministic tests. */
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Build a tmux target-pane spec from a captured `launchContext.tmux`. With a
 * window it is `session:window.pane`; otherwise the pane is assumed to be a
 * unique tmux pane id (`%N`, captured via `#{pane_id}` by the D6 plugins) and
 * targeted directly.
 */
export function tmuxTarget(t: { session: string; window?: string; pane: string }): string {
  return t.window !== undefined ? `${t.session}:${t.window}.${t.pane}` : t.pane;
}

/**
 * Type `text` into a tmux pane AND submit it. Sends the text literally (`-l`, so
 * spaces / special chars aren't interpreted as tmux key names) then Enter as a
 * SEPARATE send-keys. A combined `send-keys "text" Enter` (or one without `-l`)
 * leaves the line in the input but **never commits** on modern TUIs
 * (codex/claude) — the bug behind "the line is written but no Enter fires". A
 * second Enter covers TUIs that buffer the first. The single shared submit path
 * for both the drumbeat relauncher and the EVO-1 wake/drive local-tmux driver.
 */
export function tmuxSendSubmit(
  runtime: Pick<RelauncherRuntime, "run">,
  target: string,
  text: string
): boolean {
  const typed = runtime.run("tmux", ["send-keys", "-t", target, "-l", text]);
  const enter1 = runtime.run("tmux", ["send-keys", "-t", target, "Enter"]);
  const enter2 = runtime.run("tmux", ["send-keys", "-t", target, "Enter"]);
  return typed && enter1 && enter2;
}

/**
 * Default window (ms): if a tmux client attached to the pane's session was
 * active within this window, a wake/relance is DEFERRED so it does not clobber
 * a human typing in the pane. Override via `H2A_WAKE_DEFER_ACTIVITY_MS` (0 = off).
 */
export const H2A_WAKE_DEFER_ACTIVITY_DEFAULT_MS = 4000;

function activityWindowMs(): number {
  const raw = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return H2A_WAKE_DEFER_ACTIVITY_DEFAULT_MS;
}

/**
 * True iff a tmux CLIENT attached to `target`'s session had activity within the
 * defer window — i.e. a human is (probably) typing/looking RIGHT NOW, so a wake
 * that types into the pane would clobber their in-progress input. TUI-agnostic
 * (uses tmux `client_activity`, not any TUI's composer state). Fail-OPEN: if the
 * probe can't be read (no `capture`, no tmux, detached/no client), returns false
 * so waking still works — the guard only fires on a POSITIVE recent-activity read.
 */
export function paneHasRecentHumanActivity(
  runtime: Pick<RelauncherRuntime, "capture">,
  target: string,
  opts: { now?: number; windowMs?: number } = {}
): boolean {
  if (!runtime.capture) return false;
  const windowMs = opts.windowMs ?? activityWindowMs();
  if (windowMs <= 0) return false; // disabled
  const now = opts.now ?? Date.now();
  const sessionRaw = runtime.capture("tmux", [
    "display-message",
    "-p",
    "-t",
    target,
    "#{session_name}"
  ]);
  const session = sessionRaw?.trim();
  if (!session) return false;
  const clientsRaw = runtime.capture("tmux", [
    "list-clients",
    "-t",
    `=${session}`,
    "-F",
    "#{client_activity}"
  ]);
  if (!clientsRaw) return false; // no attached client → no human → don't defer
  let mostRecentSec = 0;
  for (const line of clientsRaw.split("\n")) {
    const epoch = Number.parseInt(line.trim(), 10);
    if (Number.isFinite(epoch) && epoch > mostRecentSec) mostRecentSec = epoch;
  }
  if (mostRecentSec === 0) return false;
  const ageMs = now - mostRecentSec * 1000; // client_activity is epoch SECONDS
  return ageMs >= 0 && ageMs < windowMs;
}

/** Revive a stalled agent by sending its resume/launch command into its pane. */
export function localTmuxRelauncher(options: RelauncherCommonOptions = {}): H2ARelauncher {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    relance(finding: H2ADrumbeatFinding): boolean {
      const lc = finding.launchContext;
      if (!lc?.tmux) return false; // not a tmux-launched agent — let the chain fall through
      const command = lc.resumeCommand ?? lc.command;
      const target = tmuxTarget(lc.tmux);
      // literal command + separate Enter(s) — a combined `send-keys cmd Enter`
      // doesn't commit in a TUI (the reported "line written, no Enter") and
      // without -l the command keys can be misread as tmux key names.
      const ok = tmuxSendSubmit(runtime, target, command);
      options.log?.(
        `drumbeat[local-tmux]: relance ${finding.instance} → tmux send-keys -t ${target} (${ok ? "ok" : "failed"})`
      );
      return ok;
    }
  };
}

/** Fallback: detached background respawn of the captured command + notify. */
export function headlessRelauncher(options: RelauncherCommonOptions = {}): H2ARelauncher {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    relance(finding: H2ADrumbeatFinding): boolean {
      const lc = finding.launchContext;
      const command = lc?.resumeCommand ?? lc?.command;
      if (!command) return false; // nothing to respawn
      const ok = runtime.spawnDetached(command, { cwd: lc?.cwd });
      const note = `drumbeat[headless]: relance ${finding.instance} → detached "${command}" (${ok ? "spawned" : "failed"})`;
      options.log?.(note);
      runtime.notify?.(note);
      return ok;
    }
  };
}

/** Try each adapter in order; the first to issue a relance wins (D3 fallback). */
export function chainRelauncher(...relaunchers: readonly H2ARelauncher[]): H2ARelauncher {
  return {
    async relance(finding: H2ADrumbeatFinding): Promise<boolean> {
      for (const r of relaunchers) {
        if (await r.relance(finding)) return true;
      }
      return false;
    }
  };
}

function envelopeId(now: number): string {
  return `env:${now}:${randomBytes(4).toString("hex")}`;
}

/**
 * D4 remote adapter: sign a `drumbeat.resume` envelope and deliver it to the
 * target instance's declared remote endpoint. It never executes remote code.
 */
export function remoteRelauncher(options: RemoteRelauncherOptions): H2ARelauncher {
  const store = options.root ? createLocalStore({ root: options.root }) : undefined;
  const resolveEndpoint =
    options.resolveEndpoint ??
    ((instance: string): string | undefined =>
      store?.findInstance(instance)?.endpoints.find((e) => e.kind === "remote")?.uri);
  const sendImpl = options.sendImpl ?? sendRemoteEnvelope;

  return {
    async relance(finding: H2ADrumbeatFinding): Promise<boolean> {
      const endpoint = await resolveEndpoint(finding.instance);
      if (!endpoint) {
        options.log?.(`drumbeat[remote]: no remote endpoint for ${finding.instance}`);
        return false;
      }

      const now = options.now?.() ?? Date.now();
      const envelope = createEnvelope<H2ADrumbeatResumeBody>({
        id: envelopeId(now),
        type: "event",
        actor: options.actor,
        target: { instance: finding.instance },
        body: {
          kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
          target: finding.instance,
          reason: finding.reason,
          requestedBy: options.actor.instance
        },
        createdAt: new Date(now).toISOString()
      });

      try {
        const result = await sendImpl(endpoint, envelope, {
          by: options.actor.instance,
          privateKeyPem: options.privateKeyPem
        });
        const ok = result.status >= 200 && result.status < 300;
        options.log?.(
          `drumbeat[remote]: relay ${finding.instance} -> ${endpoint} (${result.status}${ok ? " ok" : " failed"})`
        );
        return ok;
      } catch (error) {
        options.log?.(
          `drumbeat[remote]: relay ${finding.instance} -> ${endpoint} failed (${(error as Error).message})`
        );
        return false;
      }
    }
  };
}

export type H2ARelauncherKind = "logging" | "local-tmux" | "headless" | "remote" | "auto";

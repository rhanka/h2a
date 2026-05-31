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
  spawnDetached(command: string, options: { cwd?: string }): boolean;
  /** Optional side-channel note (relances are observable). */
  notify?(line: string): void;
}

export const defaultRelauncherRuntime: RelauncherRuntime = {
  run(file, args) {
    const res = spawnSync(file, [...args], { stdio: "ignore" });
    return res.status === 0;
  },
  spawnDetached(command, options) {
    try {
      const child = spawn(command, {
        cwd: options.cwd,
        shell: true,
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

/** Revive a stalled agent by sending its resume/launch command into its pane. */
export function localTmuxRelauncher(options: RelauncherCommonOptions = {}): H2ARelauncher {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    relance(finding: H2ADrumbeatFinding): boolean {
      const lc = finding.launchContext;
      if (!lc?.tmux) return false; // not a tmux-launched agent — let the chain fall through
      const command = lc.resumeCommand ?? lc.command;
      const target = tmuxTarget(lc.tmux);
      const ok = runtime.run("tmux", ["send-keys", "-t", target, command, "Enter"]);
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

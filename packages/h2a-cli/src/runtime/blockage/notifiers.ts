/**
 * Blockage delivery adapters (DEC-092, EVO-3 Phase B). Connected peers already
 * get the `peer.blocked`/`peer.unblocked` MCP push (DEC-052) — these adapters
 * are for waking **disconnected** peers, mirroring the drumbeat relauncher
 * adapters (DEC-091). The real per-host wake command is install-time config
 * (D6 / EVO-1); here is the in-repo abstraction + the agy polling fallback,
 * behind an injectable runtime so it is unit-testable with no host.
 */

import { spawnSync } from "node:child_process";

import type { H2ABlockage } from "@sentropic/h2a";

/** A peer to (try to) notify of a blockage. */
export interface BlockagePeer {
  readonly instance: string;
  readonly host?: string;
}

/** Adapter that delivers a blockage to a disconnected peer. */
export interface BlockageNotifier {
  /** Returns true if a notification was delivered/dispatched. */
  notify(blockage: H2ABlockage, peer: BlockagePeer): boolean | Promise<boolean>;
}

/** Process I/O the adapters need — injected so tests supply a fake. */
export interface NotifierRuntime {
  run(file: string, args: readonly string[]): boolean;
  note?(line: string): void;
}

export const defaultNotifierRuntime: NotifierRuntime = {
  run(file, args) {
    const res = spawnSync(file, [...args], { stdio: "ignore" });
    return res.status === 0;
  }
};

interface NotifierCommonOptions {
  log?: (line: string) => void;
}

/** Dry-run default: only logs what it would deliver. */
export function loggingNotifier(write: (line: string) => void): BlockageNotifier {
  return {
    notify(blockage, peer) {
      write(
        `blockage: would notify ${peer.instance}${peer.host ? ` (${peer.host})` : ""} of ${blockage.instance} blocked: ${blockage.reason}`
      );
      return true;
    }
  };
}

/**
 * Wake a disconnected peer by running a configured per-host command. The
 * template substitutes `{instance}` (the blocked agent), `{reason}` and
 * `{peer}` (the peer being woken). The actual command per host (claude wake /
 * codex remote-control / gemini hooks) is supplied at install time (D6).
 */
export function commandNotifier(options: {
  command: readonly string[];
  runtime?: NotifierRuntime;
  log?: (line: string) => void;
}): BlockageNotifier {
  const runtime = options.runtime ?? defaultNotifierRuntime;
  return {
    notify(blockage, peer) {
      if (options.command.length === 0) return false;
      const subst = (s: string): string =>
        s
          .replaceAll("{instance}", blockage.instance)
          .replaceAll("{reason}", blockage.reason)
          .replaceAll("{peer}", peer.instance);
      const [file, ...args] = options.command.map(subst);
      const ok = runtime.run(file, args);
      options.log?.(
        `blockage[command]: notify ${peer.instance} of ${blockage.instance} → ${file} (${ok ? "ok" : "failed"})`
      );
      return ok;
    }
  };
}

/**
 * The agy fallback: agy has no background daemon (capability matrix), so it
 * cannot be woken — its imported plugin polls `h2a blockage list` instead. This
 * adapter therefore declines (push is a no-op); it exists so a chain can mark a
 * peer as "poll-only" explicitly rather than silently dropping it.
 */
export function pollingNotifier(options: NotifierCommonOptions = {}): BlockageNotifier {
  return {
    notify(blockage, peer) {
      options.log?.(
        `blockage[polling]: ${peer.instance} is poll-only (no daemon) — will see ${blockage.instance} via 'h2a blockage list'`
      );
      return false;
    }
  };
}

/** Try each adapter in order; the first to deliver wins. */
export function chainNotifier(...notifiers: readonly BlockageNotifier[]): BlockageNotifier {
  return {
    async notify(blockage, peer) {
      for (const n of notifiers) {
        if (await n.notify(blockage, peer)) return true;
      }
      return false;
    }
  };
}

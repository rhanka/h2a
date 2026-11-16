/**
 * LH-02 shared remote-control service: the one code path the CLI (here),
 * the skill (LH-03) and the MCP tools (LH-03) all call.
 *
 * Most reversible choices behind the LH-00 flag:
 * - The eight new verbs stay OUT of the frozen CLI contract (DEC-034):
 *   they are flag-gated and unstable until LH-10/LH-11. Freezing them
 *   (contract + golden) is a later step; only the help text names them now.
 * - `revoke` is gated like `enrol`/`up`/`on`: it deletes key material.
 * - Terminal gate (Q-07): an interactive terminal means stdin+stdout are
 *   TTYs; a non-human pseudo-terminal cannot be told apart portably, so
 *   the refusal text names the site-side approval as the human boundary.
 *   Typed confirmation is `--confirm <verb>` with the verb word itself.
 * - Agent wiring is a stub until LH-07..LH-11: gated verbs that pass the
 *   gate reach the stub service and return `state: "stubbed"`. `kill`
 *   already sets the local flag; `status` reports it. No link, catalogue
 *   or bridge code runs here.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_MESSAGE } from "./flag.js";

export const REMOTE_CONTROL_VERBS = [
  "enrol",
  "up",
  "down",
  "status",
  "off",
  "on",
  "kill",
  "revoke"
] as const;

export type RemoteControlVerb = (typeof REMOTE_CONTROL_VERBS)[number];

export const REMOTE_CONTROL_GATED_VERBS: readonly RemoteControlVerb[] = [
  "enrol",
  "up",
  "on",
  "revoke"
] as const;

export const REMOTE_CONTROL_GROUP = [
  "serve",
  "send",
  "mirror-serve",
  "mirror",
  ...REMOTE_CONTROL_VERBS
] as const;

export function isRemoteControlVerb(value: string | undefined): value is RemoteControlVerb {
  return value !== undefined && (REMOTE_CONTROL_VERBS as readonly string[]).includes(value);
}

export function defaultIsInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function remoteControlUnknownMessage(sub: string): string {
  return `h2a remote: unknown subcommand "${sub}" (${REMOTE_CONTROL_GROUP.join(", ")})`;
}

export function remoteControlKillFlagFile(root: string): string {
  return join(root, "remote-control", "kill");
}

function isKillSet(root: string): boolean {
  return existsSync(remoteControlKillFlagFile(root));
}

export function setRemoteControlKillFlag(root: string): string {
  const dir = join(root, "remote-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "kill");
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // mode already requested at write
  }
  return file;
}

export function readRemoteControlKillFlag(root: string): { readonly kill: boolean; readonly at?: string } {
  const file = remoteControlKillFlagFile(root);
  if (!existsSync(file)) return { kill: false };
  try {
    const obj = JSON.parse(readFileSync(file, "utf8")) as { at?: unknown };
    return typeof obj.at === "string" ? { kill: true, at: obj.at } : { kill: true };
  } catch {
    return { kill: true };
  }
}

export type RemoteControlResult =
  | { readonly ok: true; readonly verb: RemoteControlVerb; readonly state: "stubbed" | "ok"; readonly killFlagFile?: string; readonly kill?: boolean; readonly at?: string }
  | { readonly ok: false; readonly verb: string; readonly reason: string; readonly message: string };

export interface RemoteControlRunOptions {
  readonly root: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isInteractive?: boolean;
  readonly confirm?: string;
}

/**
 * Run one new remote-control verb against the stub service. Pure with
 * respect to the network: the only write is the local kill flag.
 */
export function runRemoteControlVerb(
  verb: string,
  options: RemoteControlRunOptions
): RemoteControlResult {
  if (!isRemoteControlVerb(verb)) {
    return {
      ok: false,
      verb,
      reason: "unknown-subcommand",
      message: remoteControlUnknownMessage(verb)
    };
  }
  const env = options.env ?? process.env;
  if (!isRemoteControlEnabled(env)) {
    return {
      ok: false,
      verb,
      reason: "remote-control-disabled",
      message: `h2a remote ${verb}: ${REMOTE_CONTROL_DISABLED_MESSAGE}`
    };
  }
  if ((REMOTE_CONTROL_GATED_VERBS as readonly string[]).includes(verb)) {
    const interactive = options.isInteractive ?? defaultIsInteractive();
    if (!interactive || options.confirm !== verb) {
      return {
        ok: false,
        verb,
        reason: "terminal-gate",
        message:
          `h2a remote ${verb}: requires an interactive terminal and typed ` +
          `confirmation (--confirm ${verb}); site-side approval is the human boundary`
      };
    }
  }
  if (verb === "kill") {
    const killFlagFile = setRemoteControlKillFlag(options.root);
    return { ok: true, verb, state: "ok", killFlagFile };
  }
  if (verb === "status") {
    const flag = readRemoteControlKillFlag(options.root);
    return {
      ok: true,
      verb,
      state: "ok",
      kill: flag.kill,
      ...(flag.at !== undefined ? { at: flag.at } : {})
    };
  }
  return { ok: true, verb, state: "stubbed" };
}

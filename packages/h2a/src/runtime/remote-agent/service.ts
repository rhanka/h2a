/**
 * LH-02 / LH-06 shared remote-control service: the one code path the CLI,
 * the skill and the MCP tools all call.
 *
 * Control order for `off` / `on` (LH-06):
 * 1. Unknown subcommand
 * 2. Feature flag (`H2A_REMOTE_CONTROL=1`)
 * 3. Terminal gate + typed confirmation (`on`, `enrol`, `up`, `revoke`)
 * 4. Target validation (`invalid-session`, zero disk access)
 * 5. Disk exclusion read/write (`exclusions.ts`)
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_MESSAGE } from "./flag.js";
import {
  clearSessionExcluded,
  setSessionExcluded,
  validateSessionTarget
} from "./exclusions.js";

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
  | {
      readonly ok: true;
      readonly verb: RemoteControlVerb;
      readonly state: "stubbed" | "ok";
      readonly killFlagFile?: string;
      readonly kill?: boolean;
      readonly at?: string;
      readonly sessionId?: string;
      readonly excluded?: boolean;
    }
  | { readonly ok: false; readonly verb: string; readonly reason: string; readonly message: string };

export interface RemoteControlRunOptions {
  readonly root: string;
  readonly configDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isInteractive?: boolean;
  readonly confirm?: string;
  readonly session?: string;
}

/**
 * Run one remote-control verb against the shared service.
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
  if (verb === "off" || verb === "on") {
    if (!validateSessionTarget(options.session)) {
      return {
        ok: false,
        verb,
        reason: "invalid-session",
        message: `h2a remote ${verb}: invalid-session (exactly one non-empty session target is required)`
      };
    }
    const mutation =
      verb === "off"
        ? setSessionExcluded(options.session, {
            root: options.root,
            configDir: options.configDir,
            env
          })
        : clearSessionExcluded(options.session, {
            root: options.root,
            configDir: options.configDir,
            env
          });
    if (!mutation.ok) {
      return {
        ok: false,
        verb,
        reason: mutation.reason,
        message: `h2a remote ${verb}: ${mutation.message}`
      };
    }
    return {
      ok: true,
      verb,
      state: "ok",
      sessionId: mutation.sessionId,
      excluded: mutation.excluded
    };
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

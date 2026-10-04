/** Closed, immutable attachment context captured by the stdio shim. */
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export const CENTRAL_ATTACHMENT_ENV = [
  "CLAUDE_CODE_SESSION_ID", "TMUX", "TMUX_PANE", "H2A_NATIVE_TARGET_SESSION",
  "H2A_NATIVE_PTY_SESSION", "H2A_NATIVE_SOCKET", "H2A_MCP_READY_FILE",
  "H2A_MCP_READY_NONCE", "H2A_IDENTITY_RETRY_MIN_MS", "H2A_HEARTBEAT_INTERVAL_MS",
  "H2A_NOTIFY_INTERVAL_MS", "H2A_SESSION_EXPIRY_MS"
] as const;
const FLAGS = new Set(["host", "auto-open", "wake", "name", "scope", "auto-upgrade", "upgrade-check"]);
export type CentralMcpAttachment = {
  version: 2;
  id: string;
  root: string;
  workspace: string;
  host: "claude";
  flags: Record<string, string>;
  env: Record<string, string>;
  resume?: boolean;
  expectedInstance?: string;
};

export function captureCentralAttachment(root: string, workspace: string, flags: Record<string, string>, env: NodeJS.ProcessEnv): CentralMcpAttachment {
  return {
    version: 2, id: randomUUID(), root, workspace, host: "claude",
    flags: Object.fromEntries(Object.entries(flags).filter(([key]) => FLAGS.has(key))),
    env: Object.fromEntries(CENTRAL_ATTACHMENT_ENV.flatMap(key => env[key] === undefined ? [] : [[key, env[key]!]]))
  };
}

export function parseCentralAttachment(encoded: string, root: string): CentralMcpAttachment {
  if (encoded.length > 12_000) throw new Error("central attachment context exceeds budget");
  const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CentralMcpAttachment;
  if (value.version !== 2 || value.host !== "claude" || !/^[0-9a-f-]{36}$/i.test(value.id) || value.root !== root ||
      !isAbsolute(value.workspace) || value.workspace.includes("\0") || !value.flags || typeof value.flags !== "object" || Array.isArray(value.flags) ||
      !value.env || typeof value.env !== "object" || Array.isArray(value.env)) throw new Error("invalid central attachment context or unsupported state root");
  for (const [key, v] of Object.entries(value.flags)) if (!FLAGS.has(key) || typeof v !== "string") throw new Error("unsupported central attachment flag");
  for (const [key, v] of Object.entries(value.env)) if (!(CENTRAL_ATTACHMENT_ENV as readonly string[]).includes(key) || typeof v !== "string" || v.includes("\0")) throw new Error("unsupported central attachment environment");
  if (value.flags.host !== "claude" || !value.env.CLAUDE_CODE_SESSION_ID?.trim()) throw new Error("central Claude attachment requires a native conversation id");
  if (value.resume !== undefined && typeof value.resume !== "boolean") throw new Error("invalid central resume context");
  if (value.expectedInstance !== undefined && typeof value.expectedInstance !== "string") throw new Error("invalid central resume identity");
  return value;
}

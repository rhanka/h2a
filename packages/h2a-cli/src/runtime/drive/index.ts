/**
 * EVO-1 bilateral-discussion driver (signed terminal injection), slices E1a-E1c.
 *
 * Provides the signed sender path (`h2a drive`) and receiver gate (`h2a drive
 * receive`): a visible signed line `[h2a from=… sig=…] <instruction>`, an
 * `H2ADriver` chain (native/local-tmux/headless/auto), sender-side authority,
 * and receiver-side verify-before-act primitives. Host plugins wire the receive
 * gate into pre-action prompt hooks; remote crossing remains the stricter trust
 * boundary for E1d.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  H2A_AUTHORITY_MATRIX,
  canSignArtifactKind,
  createReplayGuard,
  signCanonical,
  verifyCanonical,
  type H2AActorRegistration,
  type H2AEnvelope,
  type H2ALaunchContext,
  type H2AReplayGuard,
  type H2ASignature
} from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";
import {
  defaultRelauncherRuntime,
  tmuxTarget,
  type RelauncherRuntime
} from "../drumbeat/relaunchers.js";

export interface H2ADriveInstructionPayload {
  readonly from: string;
  readonly to: string;
  readonly instruction: string;
  readonly nonce: string;
  readonly at: string;
}

export interface FormatSignedDriveInstructionOptions {
  readonly from: string;
  readonly to: string;
  readonly instruction: string;
  readonly privateKeyPem: string;
  readonly nonce?: string;
  readonly at?: string;
  readonly now?: () => number;
}

export interface ParsedSignedDriveInstruction {
  readonly payload: H2ADriveInstructionPayload;
  readonly signature: H2ASignature;
}

export type H2ADriveVerifyReason =
  | "malformed"
  | "no-public-key"
  | "bad-signature"
  | "invalid-timestamp"
  | "expired"
  | "future"
  | "replayed";

export type H2ADriveVerifyResult =
  | { readonly ok: true; readonly payload: H2ADriveInstructionPayload }
  | { readonly ok: false; readonly reason: H2ADriveVerifyReason };

export interface VerifySignedDriveInstructionOptions {
  readonly resolvePublicKeys: (instance: string) => readonly string[];
  readonly guard: H2AReplayGuard;
  readonly now?: number;
}

export type H2ADriveAuthorizeReason = "missing-registration" | "unauthorized";

export type H2ADriveAuthorizeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: H2ADriveAuthorizeReason };

export type H2ADriveAcceptReason =
  | H2ADriveVerifyReason
  | H2ADriveAuthorizeReason
  | "target-mismatch"
  | "inject-failed";

export type H2ADriveAcceptResult =
  | { readonly ok: true; readonly payload: H2ADriveInstructionPayload }
  | { readonly ok: false; readonly reason: H2ADriveAcceptReason };

export interface AcceptDriveInstructionOptions {
  readonly store: Pick<LocalStore, "findInstance" | "listInstanceKeys">;
  readonly guard: H2AReplayGuard;
  readonly expectedTo?: string;
  readonly now?: number;
  readonly inject: (payload: H2ADriveInstructionPayload) => boolean | Promise<boolean>;
}

export interface H2ADriveRequest {
  readonly to: string;
  readonly host?: string;
  readonly instructionLine: string;
  readonly launchContext?: H2ALaunchContext;
}

export interface H2ADriver {
  drive(request: H2ADriveRequest): boolean | Promise<boolean>;
}

export type H2ADriverKind = "logging" | "native" | "local-tmux" | "headless" | "auto";

export interface NativeBackchannelDriverOptions {
  readonly send?: (request: H2ADriveRequest) => boolean | Promise<boolean>;
  readonly runtime?: RelauncherRuntime;
  readonly log?: (line: string) => void;
}

export interface DriverRuntimeOptions {
  readonly runtime?: RelauncherRuntime;
  readonly log?: (line: string) => void;
}

export interface DriveCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface BuildHeadlessDriveCommandInput {
  readonly host?: string;
  readonly instructionLine: string;
  readonly cwd?: string;
}

export interface NativeDriveCommandInput {
  readonly to: string;
  readonly instructionLine: string;
  readonly host?: string;
  readonly launchContext?: H2ALaunchContext;
}

export type H2ADriveRemoteReason =
  | H2ADriveAcceptReason
  | "missing-line"
  | "payload-too-large";

export type H2ADriveRemoteResult =
  | {
      readonly ok: true;
      readonly from: string;
      readonly to: string;
      readonly instruction: string;
    }
  | { readonly ok: false; readonly reason: H2ADriveRemoteReason };

export interface RemoteDriveServerOptions {
  /** Local remote/sidecar instance that this injector is allowed to drive. */
  readonly to: string;
  /** Registry/key lookup used by the verify-before-inject gate. */
  readonly store: Pick<LocalStore, "findInstance" | "listInstanceKeys">;
  /** Called only after signature, freshness, target, and authority pass. */
  readonly inject: (
    payload: H2ADriveInstructionPayload,
    line: string
  ) => boolean | Promise<boolean>;
  /** Shared replay guard. Defaults to an in-memory guard for the service lifetime. */
  readonly guard?: H2AReplayGuard;
  /** POST endpoint path. Default `/h2a/drive`. */
  readonly path?: string;
  /** Reject bodies larger than this many bytes. Default 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Clock source handed to the replay guard. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export type RemoteDriveServerForStoreOptions = Omit<RemoteDriveServerOptions, "store">;

function randomNonce(): string {
  return randomBytes(12).toString("hex");
}

function driveReplayEnvelope(payload: H2ADriveInstructionPayload): H2AEnvelope {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `drive:${payload.from}:${payload.to}:${payload.nonce}`,
    type: "event",
    actor: { instance: payload.from, role: "AGENTS", scope: "scope:default" },
    target: { instance: payload.to },
    body: { kind: "drive.instruction" },
    createdAt: payload.at
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : shellQuote(value);
}

function hostFromRequest(request: {
  readonly to?: string;
  readonly host?: string;
  readonly launchContext?: H2ALaunchContext;
}): string | undefined {
  if (request.host) return request.host;
  const toHost = request.to?.split(":", 1)[0];
  if (toHost) return toHost;
  const command = request.launchContext?.command ?? request.launchContext?.resumeCommand;
  return command?.trim().split(/\s+/, 1)[0];
}

function codexThreadId(launchContext: H2ALaunchContext | undefined): string | undefined {
  for (const command of [launchContext?.resumeCommand, launchContext?.command]) {
    if (!command) continue;
    const resume = /\bcodex\s+resume\s+([^\s]+)/.exec(command);
    if (resume) return resume[1];
    const short = /\bcodex\b[\s\S]*\s-r\s+([^\s]+)/.exec(command);
    if (short) return short[1];
    const long = /\bcodex\b[\s\S]*\s--resume\s+([^\s]+)/.exec(command);
    if (long) return long[1];
  }
  return undefined;
}

function claudeRemoteControlName(launchContext: H2ALaunchContext | undefined): string | undefined {
  for (const command of [launchContext?.command, launchContext?.resumeCommand]) {
    if (!command) continue;
    const spaced = /--remote-control\s+([^\s]+)/.exec(command);
    if (spaced) return spaced[1];
    const equals = /--remote-control=([^\s]+)/.exec(command);
    if (equals) return equals[1];
  }
  return undefined;
}

export function formatSignedDriveInstruction(
  options: FormatSignedDriveInstructionOptions
): string {
  const now = options.now?.() ?? Date.now();
  const payload: H2ADriveInstructionPayload = {
    from: options.from,
    to: options.to,
    instruction: options.instruction,
    nonce: options.nonce ?? randomNonce(),
    at: options.at ?? new Date(now).toISOString()
  };
  const signature = signCanonical(payload, {
    by: options.from,
    privateKeyPem: options.privateKeyPem
  });
  return `[h2a from=${payload.from} to=${payload.to} nonce=${payload.nonce} at=${payload.at} sig=${signature.value}] ${payload.instruction}`;
}

export function parseSignedDriveInstruction(
  line: string
): ParsedSignedDriveInstruction | undefined {
  const match = /^\[h2a ([^\]]+)\] ([\s\S]*)$/.exec(line);
  if (!match) return undefined;
  const attrs = new Map<string, string>();
  for (const part of match[1].split(" ")) {
    const idx = part.indexOf("=");
    if (idx <= 0) return undefined;
    attrs.set(part.slice(0, idx), part.slice(idx + 1));
  }
  const from = attrs.get("from");
  const to = attrs.get("to");
  const nonce = attrs.get("nonce");
  const at = attrs.get("at");
  const sig = attrs.get("sig");
  if (!from || !to || !nonce || !at || !sig) return undefined;
  return {
    payload: { from, to, instruction: match[2], nonce, at },
    signature: { by: from, alg: "ed25519", value: sig }
  };
}

export function verifySignedDriveInstruction(
  line: string,
  options: VerifySignedDriveInstructionOptions
): H2ADriveVerifyResult {
  const parsed = parseSignedDriveInstruction(line);
  if (!parsed) return { ok: false, reason: "malformed" };
  const publicKeys = options.resolvePublicKeys(parsed.payload.from);
  if (publicKeys.length === 0) return { ok: false, reason: "no-public-key" };
  const signatureOk = publicKeys.some((pem) =>
    verifyCanonical(parsed.payload, parsed.signature, pem)
  );
  if (!signatureOk) return { ok: false, reason: "bad-signature" };
  const replay = options.guard.accept(driveReplayEnvelope(parsed.payload), options.now);
  if (!replay.ok) {
    return { ok: false, reason: replay.reason ?? "replayed" };
  }
  return { ok: true, payload: parsed.payload };
}

export type H2ADriveReceiveReason =
  | H2ADriveVerifyReason
  | H2ADriveAuthorizeReason
  | "target-mismatch";

export type H2ADriveReceiveResult =
  | {
      readonly ok: true;
      readonly from: string;
      readonly to: string;
      readonly instruction: string;
    }
  | { readonly ok: false; readonly reason: H2ADriveReceiveReason };

export interface VerifyDriveOnReceiveOptions {
  readonly to: string;
  readonly guard: H2AReplayGuard;
  readonly now?: number;
}

function hasSharedScope(a: H2AActorRegistration, b: H2AActorRegistration): boolean {
  const bScopes = new Set(b.scopes);
  return a.scopes.some((scope) => bScopes.has(scope));
}

function canIssueMandate(reg: H2AActorRegistration): boolean {
  return reg.roles.some(
    (role) =>
      H2A_AUTHORITY_MATRIX.MANDATE.roles.includes(role) &&
      canSignArtifactKind(role, "MANDATE")
  );
}

export function authorizeDrive(
  store: Pick<LocalStore, "findInstance">,
  request: { readonly from: string; readonly to: string }
): H2ADriveAuthorizeResult {
  const from = store.findInstance(request.from);
  const to = store.findInstance(request.to);
  if (!from || !to) return { ok: false, reason: "missing-registration" };
  if (request.from === request.to) return { ok: true };
  if (to.conductor === request.from || to.principal === request.from) return { ok: true };
  if (hasSharedScope(from, to) && canIssueMandate(from)) {
    return { ok: true };
  }
  return { ok: false, reason: "unauthorized" };
}

export function verifyDriveOnReceive(
  store: Pick<LocalStore, "findInstance" | "listInstanceKeys">,
  line: string,
  options: VerifyDriveOnReceiveOptions
): H2ADriveReceiveResult {
  const parsed = parseSignedDriveInstruction(line);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.payload.to !== options.to) {
    return { ok: false, reason: "target-mismatch" };
  }
  const verified = verifySignedDriveInstruction(line, {
    resolvePublicKeys: (instance) => store.listInstanceKeys(instance),
    guard: options.guard,
    now: options.now
  });
  if (!verified.ok) return verified;
  const auth = authorizeDrive(store, {
    from: verified.payload.from,
    to: verified.payload.to
  });
  if (!auth.ok) return auth;
  return {
    ok: true,
    from: verified.payload.from,
    to: verified.payload.to,
    instruction: verified.payload.instruction
  };
}

export async function acceptDriveInstruction(
  line: string,
  options: AcceptDriveInstructionOptions
): Promise<H2ADriveAcceptResult> {
  const parsed = parseSignedDriveInstruction(line);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (options.expectedTo !== undefined && parsed.payload.to !== options.expectedTo) {
    return { ok: false, reason: "target-mismatch" };
  }

  const verified = verifySignedDriveInstruction(line, {
    resolvePublicKeys: (instance) => options.store.listInstanceKeys(instance),
    guard: options.guard,
    now: options.now
  });
  if (!verified.ok) return verified;

  const authorized = authorizeDrive(options.store, {
    from: verified.payload.from,
    to: verified.payload.to
  });
  if (!authorized.ok) return authorized;

  const injected = await options.inject(verified.payload);
  if (!injected) return { ok: false, reason: "inject-failed" };
  return { ok: true, payload: verified.payload };
}

export function loggingDriver(log: (line: string) => void = () => undefined): H2ADriver {
  return {
    drive(request) {
      log(`drive[logging]: ${request.to} <= ${request.instructionLine}`);
      return true;
    }
  };
}

export function nativeBackchannelDriver(
  options: NativeBackchannelDriverOptions = {}
): H2ADriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const injected = options.send?.(request);
      if (injected !== undefined) return injected;
      const command = nativeDriveCommand(request);
      if (!command) {
        options.log?.(`drive[native]: no native backchannel for ${request.to}`);
        return false;
      }
      const ok = runtime.run(command[0], command.slice(1));
      options.log?.(`drive[native]: ${request.to} (${ok ? "ok" : "failed"})`);
      return ok;
    }
  };
}

export function nativeDriveCommand(
  input: NativeDriveCommandInput
): readonly string[] | undefined {
  const host = hostFromRequest(input);
  if (host === "codex") {
    const threadId = codexThreadId(input.launchContext);
    if (!threadId) return undefined;
    const request = JSON.stringify({
      id: "h2a-drive",
      method: "turn/start",
      params: {
        threadId,
        input: [{ type: "text", text: input.instructionLine }]
      }
    });
    return [
      "sh",
      "-lc",
      `printf '%s\\n' ${shellQuote(request)} | codex app-server proxy`
    ];
  }
  if (host === "claude") {
    const remote = claudeRemoteControlName(input.launchContext);
    if (!remote) return undefined;
    return [
      "sh",
      "-lc",
      `claude --remote-control ${shellWord(remote)} --brief -p ${shellQuote(input.instructionLine)}`
    ];
  }
  if (host === "gemini") {
    const command = input.launchContext?.command ?? input.launchContext?.resumeCommand ?? "";
    if (!/\bgemini\b/.test(command) || !/\s--acp\b/.test(` ${command}`)) return undefined;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: "h2a-drive",
      method: "turn/start",
      params: { input: input.instructionLine }
    });
    return ["sh", "-lc", `printf '%s\\n' ${shellQuote(request)} | gemini --acp`];
  }
  return undefined;
}

export function localTmuxDriver(options: DriverRuntimeOptions = {}): H2ADriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const tmux = request.launchContext?.tmux;
      if (!tmux) return false;
      const target = tmuxTarget(tmux);
      const literal = runtime.run("tmux", [
        "send-keys",
        "-t",
        target,
        "-l",
        request.instructionLine
      ]);
      const enter = runtime.run("tmux", [
        "send-keys",
        "-t",
        target,
        "Enter"
      ]);
      const ok = literal && enter;
      options.log?.(`drive[local-tmux]: ${request.to} -> ${target} (${ok ? "ok" : "failed"})`);
      return ok;
    }
  };
}

export function buildHeadlessDriveCommand(
  input: BuildHeadlessDriveCommandInput
): DriveCommand | undefined {
  switch (input.host) {
    case "codex":
      return {
        file: "codex",
        args: ["exec", input.instructionLine],
        ...(input.cwd ? { cwd: input.cwd } : {})
      };
    case "claude":
      return {
        file: "claude",
        args: ["-p", input.instructionLine],
        ...(input.cwd ? { cwd: input.cwd } : {})
      };
    case "gemini":
      return {
        file: "gemini",
        args: ["-p", input.instructionLine],
        ...(input.cwd ? { cwd: input.cwd } : {})
      };
    case "agy":
      return {
        file: "agy",
        args: ["-p", input.instructionLine],
        ...(input.cwd ? { cwd: input.cwd } : {})
      };
    default:
      return undefined;
  }
}

export function headlessDriver(options: DriverRuntimeOptions = {}): H2ADriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const cwd = request.launchContext?.cwd;
      const command =
        buildHeadlessDriveCommand({
          host: request.host,
          instructionLine: request.instructionLine,
          cwd
        }) ??
        (request.launchContext?.command
          ? `${request.launchContext.command} ${shellQuote(request.instructionLine)}`
          : undefined);
      if (!command) return false;
      const ok = runtime.spawnDetached(command, { cwd });
      options.log?.(`drive[headless]: ${request.to} -> detached (${ok ? "spawned" : "failed"})`);
      return ok;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function remoteDriveRejectionStatus(reason: H2ADriveRemoteReason): number {
  switch (reason) {
    case "malformed":
    case "missing-line":
    case "invalid-timestamp":
      return 400;
    case "no-public-key":
    case "bad-signature":
      return 401;
    case "missing-registration":
    case "unauthorized":
    case "target-mismatch":
      return 403;
    case "replayed":
      return 409;
    case "expired":
    case "future":
      return 422;
    case "inject-failed":
      return 502;
    case "payload-too-large":
      return 413;
    default:
      return 400;
  }
}

export function createRemoteDriveServer(options: RemoteDriveServerOptions): Server {
  const guard = options.guard ?? createReplayGuard();
  const path = options.path ?? "/h2a/drive";
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;

  return createServer((req, res) => {
    const respond = (status: number, body: H2ADriveRemoteResult | { ok: false; error: string }): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    };

    const url = req.url ?? "";
    if (url.split("?")[0] !== path) {
      respond(404, { ok: false, error: "not-found" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      respond(405, { ok: false, error: "method-not-allowed" });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        aborted = true;
        respond(remoteDriveRejectionStatus("payload-too-large"), {
          ok: false,
          reason: "payload-too-large"
        });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (aborted) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        respond(remoteDriveRejectionStatus("malformed"), { ok: false, reason: "malformed" });
        return;
      }
      if (!isRecord(payload) || typeof payload.line !== "string") {
        respond(remoteDriveRejectionStatus("missing-line"), {
          ok: false,
          reason: "missing-line"
        });
        return;
      }

      let result: H2ADriveAcceptResult;
      try {
        result = await acceptDriveInstruction(payload.line, {
          store: options.store,
          guard,
          expectedTo: options.to,
          now: options.now?.(),
          inject: (drivePayload) => options.inject(drivePayload, payload.line as string)
        });
      } catch {
        result = { ok: false, reason: "inject-failed" };
      }
      if (!result.ok) {
        respond(remoteDriveRejectionStatus(result.reason), {
          ok: false,
          reason: result.reason
        });
        return;
      }
      respond(202, {
        ok: true,
        from: result.payload.from,
        to: result.payload.to,
        instruction: result.payload.instruction
      });
    });
  });
}

export function remoteDriveServerForStore(
  store: Pick<LocalStore, "findInstance" | "listInstanceKeys">,
  options: RemoteDriveServerForStoreOptions
): Server {
  return createRemoteDriveServer({ ...options, store });
}

export function chainDriver(...drivers: readonly H2ADriver[]): H2ADriver {
  return {
    async drive(request) {
      for (const driver of drivers) {
        if (await driver.drive(request)) return true;
      }
      return false;
    }
  };
}

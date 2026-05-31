/**
 * EVO-1 bilateral-discussion driver (signed terminal injection), slice E1a.
 *
 * Provides the SENDER half end-to-end (`h2a drive`): a signed instruction line
 * `[h2a from=… sig=…] <instruction>`, an `H2ADriver` chain
 * (logging/native/local-tmux/headless/auto), and a sender-side authority gate.
 *
 * `verifySignedDriveInstruction` + the receiver `authorizeDrive` below are
 * exported, tested primitives but are **library-only in E1a — not yet wired
 * into any host receive hook**. The receiver-side "verify-before-act" is
 * deferred to E1c (local plugin authority hook) and is mandatory in E1d
 * (remote, which crosses the trust boundary). This is consistent with the
 * ratified single-trusted-user local threat model (DEC-116): a malicious local
 * injector is out of scope; the signature gives provenance + accountability and
 * the sender gate blocks unauthorized h2a drives. Declared boundary, not a gap
 * — see docs/superpowers/specs/2026-05-31-evo1-bilateral-discussion-driver-framing.md.
 */
import { randomBytes } from "node:crypto";

import {
  H2A_AUTHORITY_MATRIX,
  canSignArtifactKind,
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

export interface H2ADriveRequest {
  readonly to: string;
  readonly instructionLine: string;
  readonly launchContext?: H2ALaunchContext;
}

export interface H2ADriver {
  drive(request: H2ADriveRequest): boolean | Promise<boolean>;
}

export type H2ADriverKind = "logging" | "native" | "local-tmux" | "headless" | "auto";

export interface NativeBackchannelDriverOptions {
  readonly send?: (request: H2ADriveRequest) => boolean | Promise<boolean>;
}

export interface DriverRuntimeOptions {
  readonly runtime?: RelauncherRuntime;
  readonly log?: (line: string) => void;
}

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
  return {
    drive(request) {
      return options.send?.(request) ?? false;
    }
  };
}

export function localTmuxDriver(options: DriverRuntimeOptions = {}): H2ADriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const tmux = request.launchContext?.tmux;
      if (!tmux) return false;
      const target = tmuxTarget(tmux);
      const ok = runtime.run("tmux", [
        "send-keys",
        "-t",
        target,
        request.instructionLine,
        "Enter"
      ]);
      options.log?.(`drive[local-tmux]: ${request.to} -> ${target} (${ok ? "ok" : "failed"})`);
      return ok;
    }
  };
}

export function headlessDriver(options: DriverRuntimeOptions = {}): H2ADriver {
  const runtime = options.runtime ?? defaultRelauncherRuntime;
  return {
    drive(request) {
      const base = request.launchContext?.command;
      if (!base) return false;
      const command = `${base} ${shellQuote(request.instructionLine)}`;
      const ok = runtime.spawnDetached(command, { cwd: request.launchContext?.cwd });
      options.log?.(`drive[headless]: ${request.to} -> detached (${ok ? "spawned" : "failed"})`);
      return ok;
    }
  };
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

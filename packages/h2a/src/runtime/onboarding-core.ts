// Canonical onboarding, modal-guard, start-serialization, trust-precheck, and memory-scope helpers.
// Keep imports strictly limited to Node built-ins (`node:*`) so both `@sentropic/h2a`
// and its vendored copy in `@sentropic/h2a-runtime` stay decoupled with zero package edges.

import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
  ftruncateSync,
  appendFileSync,
} from "node:fs";
import { homedir, totalmem } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const AGY_QUALIFIED_VERSION = "1.5.17" as const;
export const MIN_AGY_START_SPACING_MS = 13_000;
export const MAX_AGY_START_SPACING_MS = 300_000;
export const DEFAULT_AGY_LOCK_TIMEOUT_MS = 72_000;
export const MCP_AGY_LAUNCH_BUDGET_MS = 240_000;
export const POST_SPAWN_MAX_HOLD_MS = 3_000;
export const AGY_DEFAULT_MEMORY_MAX_BYTES = 16 * 1024 ** 3;
export const AGY_MEMORY_HOST_CAP_RATIO = 0.30;
export const AGY_MEMORY_HIGH_RATIO = 0.75;
export const AGY_SLICE_MAX_HOST_CAP_RATIO = 0.65;
export const AGY_AGENTS_SLICE_NAME = "h2a-agents.slice" as const;

export const AGY_FLOCK_CANDIDATES: readonly string[] = Object.freeze([
  "/usr/bin/flock",
  "/bin/flock",
]);

export type OnboardingFailureCode =
  | "cli-workspace-not-trusted"
  | "cli-first-run-wizard"
  | "cli-hooks-review-required"
  | "cli-trust-config-unreadable"
  | "cli-trust-audit-mismatch"
  | "cli-trust-unsupported-cwd"
  | "cli-trust-refused"
  | "agy-auth-required"
  | "cli-auth-required"
  | "cli-permission-prompt-required"
  | "cli-update-modal-blocking";

export type StartQueueFailureCode =
  | "cli-start-lock-unavailable"
  | "cli-start-lock-timeout"
  | "cli-start-lock-invalid-config";

export type MemorySliceFailureCode =
  | "cli-memory-scope-unavailable"
  | "cli-memory-slice-missing"
  | "cli-memory-slice-insufficient"
  | "cli-memory-slice-unbounded"
  | "cli-memory-slice-unreadable";

export type HostModalCode =
  | "agy-auth-required"
  | "cli-auth-required"
  | "cli-workspace-not-trusted"
  | "cli-first-run-wizard"
  | "cli-hooks-review-required"
  | "cli-permission-prompt-required"
  | "cli-update-modal-blocking";

export type HostModal = {
  readonly code?: HostModalCode;
  readonly reason: string;
  readonly hint: string;
};

export type StructuredLaunchPhase = "onboarding" | "start-queue" | "memory-slice";

export interface StructuredOnboardingErrorPayload {
  readonly kind: "h2a.run.failure";
  readonly version: 1;
  readonly state: "not-started";
  readonly phase: StructuredLaunchPhase;
  readonly code: OnboardingFailureCode | StartQueueFailureCode | MemorySliceFailureCode;
  readonly error: string;
  readonly hint?: string;
  readonly launchId?: string;
  readonly creationAttempted: false;
  readonly retrySafe: boolean;
  readonly prompt?: { readonly delivered: false };
}

export class OnboardingLaunchError extends Error {
  readonly code: OnboardingFailureCode | StartQueueFailureCode | MemorySliceFailureCode;
  readonly phase: StructuredLaunchPhase;
  readonly hint: string | undefined;
  readonly retrySafe: boolean;

  constructor(options: {
    code: OnboardingFailureCode | StartQueueFailureCode | MemorySliceFailureCode;
    phase: StructuredLaunchPhase;
    message: string;
    hint?: string;
    retrySafe?: boolean;
  }) {
    super(options.message);
    this.name = "OnboardingLaunchError";
    this.code = options.code;
    this.phase = options.phase;
    this.hint = options.hint;
    this.retrySafe = options.retrySafe ?? true;
  }

  toRunFailure(launchId?: string): StructuredOnboardingErrorPayload {
    return {
      kind: "h2a.run.failure",
      version: 1,
      state: "not-started",
      phase: this.phase,
      code: this.code,
      error: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(launchId ? { launchId } : {}),
      creationAttempted: false,
      retrySafe: this.retrySafe,
      prompt: { delivered: false },
    };
  }
}

export const AGY_LOGIN_MENU =
  /Select login method:\s*>?\s*1\. Google OAuth\s*>?\s*2\. Use a Google Cloud project\s*↑\/↓ Navigate · enter Select\s*$/i;

export const MODAL_CHOICE = /(^|\n)\s*[›>❯]?\s*1\.\s+\S/;
export const MODAL_CONFIRM = /(?:press\s+)?(?:enter|return)(?:\s+to)?\s+(?:continue|confirm|select)/i;
export const BLOCKING_ACTIVITY =
  /\b(?:compacting conversation|summarizing conversation|generating summary)\b|\besc to interrupt\b|\bctrl\+c to cancel\b/i;

function captureTailLines(text: string, lineCount = 35): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-lineCount).join("\n");
}

function activeComposerAfterMatch(capture: string, matchEndIndex: number, profile?: string): boolean {
  const after = capture.slice(matchEndIndex);
  if (after.trim().length === 0) return false;
  if (MODAL_CONFIRM.test(after)) return false;
  if (profile === "agy") {
    return /\?\s*for shortcuts/i.test(after) && /(?:^|\n)\s*(?:│\s*)?>/m.test(after);
  }
  if (/›/.test(after) && /·\s*(?:~|\/)/.test(after)) return true;
  if (/❯/.test(after) && /·\s*(?:~|\/)/.test(after)) return true;
  if (profile === "codex" || profile === "muse") return false;
  return /(?:^|\n)\s*[❯›]\s*(?:Ready|\S.*)?\s*$/m.test(after) && !MODAL_CHOICE.test(after);
}

function testNamedModal(capture: string, pattern: RegExp, profile?: string): boolean {
  const flags = pattern.flags.replace(/g/g, "");
  const re = new RegExp(pattern.source, flags);
  const match = re.exec(capture);
  if (!match) return false;
  const matchEnd = match.index + match[0].length;
  return !activeComposerAfterMatch(capture, matchEnd, profile);
}

export const NAMED_HOST_MODALS: ReadonlyArray<{
  readonly match: RegExp;
  readonly profiles?: readonly string[];
  readonly exclude?: RegExp;
  readonly modal: HostModal;
}> = [
  {
    match:
      /(?:Folder\s+access[\s\S]{0,240}(?:Yes,\s*continue|trust\s+this\s+(?:folder|directory)|this\s+directory)|Trust\s+this\s+(?:folder|directory)\?|Do\s+you\s+trust(?:\s+the\s+contents\s+of)?\s+this\s+(?:directory|folder|workspace)\??|Quick\s+safety\s+check:\s*Is\s+this\s+a\s+project\s+you\s+created\s+or\s+one\s+you\s+trust\?|Do\s+you\s+trust\s+the\s+files\s+in\s+this\s+folder\?|Trust\s+and\s+continue)/i,
    modal: {
      code: "cli-workspace-not-trusted",
      reason: "the host is waiting on its directory-trust prompt",
      hint: "approve this directory once interactively (for agy: run `h2a trust agy <dir>` in an owner terminal; the host records trust per repository root), then relaunch",
    },
  },
  {
    match:
      /(?:hooks?\s+(?:need\s+review|are\s+new\s+or\s+changed|require\s+review)|hook\s+is\s+new\s+or\s+changed|new\s+or\s+changed\s+hooks?|Review\s+plugin\s+hooks?|Review\s+project\s+hooks?)/i,
    modal: {
      code: "cli-hooks-review-required",
      reason: "the host is waiting on its hook-review prompt",
      hint: "review and approve hooks once interactively in this workspace (on Codex, an interactive session can also choose '3. Continue without trusting (hooks won't run)' for a non-persistent run), then relaunch",
    },
  },
  {
    match:
      /(?:Welcome\s+to\s+(?:Antigravity|Gemini\s+CLI|Claude\s+Code|Mistral\s+Vibe)|Choose\s+the\s+text\s+style\s+that\s+looks\s+best|(?:Select|Choose)\s+(?:a\s+)?(?:color\s+)?theme[\s\S]{0,200}(?:Enter|Continue|Apply)|Get\s+started[\s\S]{0,180}(?:Login|Theme|Continue)|Terms\s+of\s+Service[\s\S]{0,200}(?:Accept|Continue|Enter))/i,
    modal: {
      code: "cli-first-run-wizard",
      reason: "the host is waiting on its first-run onboarding wizard",
      hint: "complete first-run onboarding once in an interactive owner terminal, then relaunch",
    },
  },
  {
    match:
      /(?:WARNING:\s*Claude\s+Code\s+running\s+in\s+Bypass\s+Permissions\s+mode[\s\S]{0,200}Yes,\s*I\s+accept|(?:Allow\s+once|Allow\s+always|Yes,\s*allow)[\s\S]{0,120}(?:No,\s*reject|Deny|Esc\s+to\s+cancel)|(?:Do\s+you\s+want\s+to\s+proceed\?|Allow\s+this\s+(?:tool|command)\?)[\s\S]{0,140}(?:1\.|Yes|Allow|Continue))/i,
    modal: {
      code: "cli-permission-prompt-required",
      reason: "the host is waiting on an interactive permission prompt",
      hint: "answer or configure the permission prompt interactively, then relaunch",
    },
  },
  {
    match: /update\s+available[\s\S]{0,240}(?:\b1\.|Press\s+(?:Enter|Return)|Enter\s+to\s+(?:update|continue|confirm|select)|\[y\/N\])/i,
    modal: {
      code: "cli-update-modal-blocking",
      reason: "the host is waiting on its update prompt",
      hint: "answer the host update prompt once in an interactive session (or update the CLI), then relaunch",
    },
  },
  {
    match:
      /(?:Sign\s+in\s+with[\s\S]{0,200}(?:Enter|Browser|API\s+key)|Please\s+authenticate\s+to\s+continue|Enter\s+your\s+(?:Anthropic|OpenAI|Google|Mistral)\s+API\s+key|Choose\s+login\s+method:[\s\S]{0,200}Enter)/i,
    exclude: /Google\s+OAuth[\s\S]{0,120}Google\s+Cloud\s+project/i,
    modal: {
      code: "cli-auth-required",
      reason: "the host is waiting on authentication",
      hint: "run the CLI interactively in an owner terminal to authenticate, then relaunch",
    },
  },
];

export function detectNamedHostModal(capture: string, profile?: string): HostModal | undefined {
  if (profile === "agy" && AGY_LOGIN_MENU.test(capture)) {
    return {
      code: "agy-auth-required",
      reason: "AGY requires authentication",
      hint: "run agy interactively to sign in, then relaunch",
    };
  }
  if (/Do you trust this workspace\?/.test(capture) && /Trust and continue/.test(capture)) {
    return {
      code: "cli-workspace-not-trusted",
      reason: "Muse is waiting on its workspace-trust prompt (directory-trust)",
      hint: "trust this workspace in an interactive Muse session, then relaunch",
    };
  }
  const activeRegion = capture.length > 4096 ? captureTailLines(capture, 50) : capture;
  for (const entry of NAMED_HOST_MODALS) {
    if (entry.profiles && (!profile || !entry.profiles.includes(profile))) continue;
    if (entry.exclude?.test(activeRegion)) continue;
    if (testNamedModal(activeRegion, entry.match, profile)) {
      return entry.modal;
    }
  }
  return undefined;
}

export function detectHostModal(capture: string, profile?: string): HostModal | undefined {
  const named = detectNamedHostModal(capture, profile);
  if (named !== undefined) return named;
  const activeRegion = capture.length > 4096 ? captureTailLines(capture, 50) : capture;
  if (!MODAL_CHOICE.test(activeRegion) || !MODAL_CONFIRM.test(activeRegion)) {
    return undefined;
  }
  return {
    reason: "the host is waiting on a modal choice prompt",
    hint: "answer the host prompt once in an interactive session, then relaunch",
  };
}

export function agyPaneHasComposer(capture: string): boolean {
  // AGY 1.5.17 draws a boxed `>` prompt above a `? for shortcuts` footer
  // (optionally alongside a passive `esc to dismiss` banner).
  const hasComposer =
    /(?:^|\n)\s*(?:│\s*)?>\s*(?:[^│\n]*│\s*)?$/m.test(capture) ||
    /(?:─+|╭─+╮)[\s\S]{0,400}(?:^|\n)\s*(?:│\s*)?>/m.test(capture);
  const hasFooter = /\?\s*for shortcuts/i.test(capture);
  return hasComposer && hasFooter;
}

export function paneHasDrawnUi(capture: string): boolean {
  const lines = capture
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  if (lines.length >= 2) return true;
  return capture.trimEnd().length >= 8 || /[❯›>]/.test(capture);
}

export function paneHasBlockingActivity(capture: string): boolean {
  const recentLines = capture
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-12)
    .join("\n");
  if (BLOCKING_ACTIVITY.test(recentLines)) return true;
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(?:compacting|working|thinking|running|loading)/i.test(recentLines)) {
    return true;
  }
  return false;
}

export function paneIsReady(capture: string, profile?: string): boolean {
  if (paneHasBlockingActivity(capture)) return false;
  if (detectHostModal(capture, profile) !== undefined) return false;
  if (profile === "agy") {
    return agyPaneHasComposer(capture);
  }
  if (profile === "codex") {
    if (/model:\s*loading/i.test(capture)) return false;
    return /›/.test(capture) && /·\s*(?:~|\/)/.test(capture);
  }
  if (profile === "muse") {
    return /❯/.test(capture) && /·\s*(?:~|\/)/.test(capture);
  }
  return paneHasDrawnUi(capture);
}

export type PaneGuardMode = "cli-input" | "shell-relaunch";

export type PaneGuardDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly outcome: "deferred" | "blocked";
      readonly reason: string;
      readonly modal?: HostModal;
    };

export function guardPaneBeforeAutomatedInput(
  capture: string | undefined,
  profile: string | undefined,
  mode: PaneGuardMode,
): PaneGuardDecision {
  if (capture === undefined) {
    return {
      ok: false,
      outcome: "deferred",
      reason: "capture-unavailable",
    };
  }
  const modal = detectHostModal(capture, profile);
  if (modal !== undefined) {
    return {
      ok: false,
      outcome: "blocked",
      reason: modal.code ?? "host-modal",
      modal,
    };
  }
  if (mode === "cli-input" && profile === "agy" && !paneIsReady(capture, profile)) {
    return {
      ok: false,
      outcome: "deferred",
      reason: "agy-pane-not-ready",
    };
  }
  return { ok: true };
}

export type ClassifiedCliCommand =
  | "agy"
  | "claude"
  | "codex"
  | "muse"
  | "vibe"
  | "gemini"
  | "mistral"
  | "opencode"
  | "shell"
  | "unknown";

const KNOWN_CLI_BASENAMES: Readonly<Record<string, ClassifiedCliCommand>> = {
  agy: "agy",
  antigravity: "agy",
  claude: "claude",
  "claude-code": "claude",
  codex: "codex",
  muse: "muse",
  "muse-code": "muse",
  vibe: "vibe",
  "mistral-vibe": "vibe",
  gemini: "gemini",
  "gemini-cli": "gemini",
  mistral: "mistral",
  mistralcli: "mistral",
  opencode: "opencode",
};

const KNOWN_WRAPPER_COMMANDS = new Set(["env", "exec", "nohup", "setsid"]);

export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasToken = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      hasToken = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      hasToken = true;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else if (ch === "\\") escaped = true;
      else current += ch;
      hasToken = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
    } else if (ch === '"') {
      inDouble = true;
      hasToken = true;
    } else if (ch === "\\") {
      escaped = true;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

function mapTokenToCli(token: string): ClassifiedCliCommand | undefined {
  const clean = basename(token).toLowerCase();
  return KNOWN_CLI_BASENAMES[clean];
}

function classifyTokenArray(tokens: readonly string[], depth = 0): ClassifiedCliCommand {
  if (depth > 6 || tokens.length === 0) return "unknown";
  let index = 0;

  while (index < tokens.length) {
    const tok = tokens[index]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      index++;
      continue;
    }
    const base = basename(tok).toLowerCase();
    if (KNOWN_WRAPPER_COMMANDS.has(base)) {
      index++;
      if (base === "env") {
        while (index < tokens.length) {
          const arg = tokens[index]!;
          if (arg === "-u" || arg === "-C" || arg === "--unset" || arg === "--chdir") {
            index += 2;
            continue;
          }
          if (arg.startsWith("-")) {
            index++;
            continue;
          }
          if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
            index++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (base === "nice" || base === "stdbuf" || base === "timeout") {
      index++;
      if (index < tokens.length && tokens[index]!.startsWith("-")) index++;
      if (index < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[index]!)) index++;
      continue;
    }
    break;
  }

  if (index >= tokens.length) return "unknown";
  const head = tokens[index]!;
  const direct = mapTokenToCli(head);
  if (direct) return direct;

  const headBase = basename(head).toLowerCase();

  // `h2a run <profile>` / `h2a agy` / `remote run <profile>`
  if (headBase === "h2a" || headBase === "remote") {
    const sub = tokens[index + 1];
    if (sub === "run" && tokens[index + 2]) {
      return mapTokenToCli(tokens[index + 2]!) ?? "unknown";
    }
    if (sub) {
      return mapTokenToCli(sub) ?? "unknown";
    }
    return "unknown";
  }

  // `node .../session-scope.js [--flag=...] <cmd> ...` or `node .../bin.js run agy ...` or `prepareGatewayRetypeCommand`
  if (headBase === "node" || headBase.startsWith("node")) {
    let cursor = index + 1;
    if (tokens[cursor] === "-e" && tokens.length >= cursor + 4) {
      // prepareGatewayRetypeCommand passes `[node, "-e", reader, file, cmd]`
      const wrappedCmd = tokens[cursor + 3]!;
      return classifyCliCommand(wrappedCmd, depth + 1);
    }
    while (cursor < tokens.length && tokens[cursor]!.startsWith("-")) {
      cursor++;
    }
    const script = tokens[cursor];
    if (!script) return "unknown";
    const scriptBase = basename(script);
    if (scriptBase === "session-scope.js" || scriptBase === "session-scope.ts") {
      cursor++;
      while (cursor < tokens.length && tokens[cursor]!.startsWith("-")) {
        cursor++;
      }
      return classifyTokenArray(tokens.slice(cursor), depth + 1);
    }
    if (scriptBase === "agy-headless.js" || scriptBase === "agy-headless.ts") {
      return "agy";
    }
    if (scriptBase === "bin.js" || scriptBase === "bin.ts" || scriptBase === "cli.js") {
      const sub = tokens[cursor + 1];
      if (sub === "run" && tokens[cursor + 2]) {
        return mapTokenToCli(tokens[cursor + 2]!) ?? "unknown";
      }
      if (sub) return mapTokenToCli(sub) ?? "unknown";
    }
    return "unknown";
  }

  // Shell wrapper: bash/sh -lc/-c <script> [args...]
  if (headBase === "bash" || headBase === "sh" || headBase === "zsh") {
    let cursor = index + 1;
    let sawDashC = false;
    while (cursor < tokens.length) {
      const flag = tokens[cursor]!;
      if (flag === "-c" || flag === "-lc" || flag === "-cl") {
        sawDashC = true;
        cursor++;
        break;
      }
      if (flag.startsWith("-")) {
        cursor++;
        continue;
      }
      break;
    }
    if (!sawDashC || cursor >= tokens.length) return "unknown";
    const script = tokens[cursor]!;
    const positional = tokens.slice(cursor + 1);
    // H2A LOCAL_WRAPPER passes `[relaunchCmd, cli, ...args]` (`cli="$1"`).
    if (script.includes('cli="$1"') && positional[1]) {
      return classifyTokenArray(positional.slice(1), depth + 1);
    }
    // H2A STRUCTURED_LOCAL_WRAPPER passes `[cli, ...args]` (`cli="$0"`).
    if (script.includes('cli="$0"') && positional[0]) {
      return classifyTokenArray(positional, depth + 1);
    }
    // HEADLESS_WRAPPER passes `[result, log, prompt, cli, ...args]`.
    if (script.includes('cli="$3"') && positional[3]) {
      return classifyTokenArray(positional.slice(3), depth + 1);
    }
    // Otherwise inspect the inline shell script itself (simple single command or chain).
    const parts = script.split(/\s*(?:;|&&|\|\|)\s*/);
    let detected: ClassifiedCliCommand = "unknown";
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const cls = classifyTokenArray(tokenizeShellCommand(trimmed), depth + 1);
      if (cls === "agy") return "agy";
      if (detected === "unknown" && cls !== "unknown") detected = cls;
    }
    return detected;
  }

  return "unknown";
}

export function classifyCliCommand(
  input: string | readonly string[],
  depth = 0,
): ClassifiedCliCommand {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return "unknown";
    const segments = trimmed.split(/\s*(?:;|&&|\|\|)\s*/);
    let firstKnown: ClassifiedCliCommand = "unknown";
    for (const seg of segments) {
      const s = seg.trim();
      if (!s) continue;
      const cls = classifyTokenArray(tokenizeShellCommand(s), depth);
      if (cls === "agy") return "agy";
      if (firstKnown === "unknown" && cls !== "unknown") firstKnown = cls;
    }
    return firstKnown;
  }
  return classifyTokenArray(input, depth);
}

// ============================================================================
// Serialized AGY starts (`/run/user/<uid>/agy-start.lock`)
// ============================================================================

export function resolveAgyStartSpacingMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env["H2A_AGY_START_SPACING_MS"];
  if (raw === undefined || raw.trim() === "") return MIN_AGY_START_SPACING_MS;
  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed) || parsed < MIN_AGY_START_SPACING_MS || parsed > MAX_AGY_START_SPACING_MS) {
    throw new OnboardingLaunchError({
      code: "cli-start-lock-invalid-config",
      phase: "start-queue",
      message: `invalid H2A_AGY_START_SPACING_MS (${raw}): must be an integer between ${MIN_AGY_START_SPACING_MS} and ${MAX_AGY_START_SPACING_MS} ms`,
      hint: `unset H2A_AGY_START_SPACING_MS or set it >= ${MIN_AGY_START_SPACING_MS}`,
      retrySafe: true,
    });
  }
  return parsed;
}

export function resolveAgyStartLockPath(uid = process.getuid?.() ?? 0): string {
  return `/run/user/${uid}/agy-start.lock`;
}

function isQualifiedFlockTool(candidate: string, currentUid: number): boolean {
  let tool: ReturnType<typeof statSync>;
  let parent: ReturnType<typeof statSync>;
  try {
    tool = statSync(candidate);
    parent = statSync(dirname(candidate));
  } catch {
    return false;
  }
  return (
    tool.isFile() &&
    tool.uid !== currentUid &&
    parent.uid !== currentUid &&
    !(tool.mode & 0o022) &&
    !(parent.mode & 0o022)
  );
}

export function resolveFlockTool(
  candidates: readonly string[] = AGY_FLOCK_CANDIDATES,
  uid = process.getuid?.() ?? 0,
): string {
  for (const candidate of candidates) {
    if (isQualifiedFlockTool(candidate, uid)) return candidate;
  }
  throw new OnboardingLaunchError({
    code: "cli-start-lock-unavailable",
    phase: "start-queue",
    message: `util-linux flock unavailable at fixed system paths (${candidates.join(", ")})`,
    hint: "install util-linux so /usr/bin/flock (or /bin/flock) is root-owned and non-writable",
    retrySafe: true,
  });
}

function openAgyStartLockFd(lockPath: string, expectedUid: number): number {
  const parent = dirname(lockPath);
  let parentInfo: ReturnType<typeof lstatSync>;
  try {
    parentInfo = lstatSync(parent);
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-start-lock-unavailable",
      phase: "start-queue",
      message: `start lock directory unavailable (${parent}): ${error instanceof Error ? error.message : String(error)}`,
      hint: `ensure ${parent} exists as a uid-${expectedUid} mode-0700 directory (logind /run/user/<uid>)`,
      retrySafe: true,
    });
  }
  if (
    !parentInfo.isDirectory() ||
    parentInfo.isSymbolicLink() ||
    parentInfo.uid !== expectedUid ||
    (parentInfo.mode & 0o777) !== 0o700
  ) {
    throw new OnboardingLaunchError({
      code: "cli-start-lock-unavailable",
      phase: "start-queue",
      message: `start lock parent ${parent} has unsafe ownership or mode (${(parentInfo.mode & 0o777).toString(8)})`,
      hint: `ensure ${parent} is owned by uid ${expectedUid} with mode 0700`,
      retrySafe: true,
    });
  }
  let fd: number;
  try {
    fd = openSync(
      lockPath,
      fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-start-lock-unavailable",
      phase: "start-queue",
      message: `cannot open start lock ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
      hint: `verify ${lockPath} is not a symlink and is writable by uid ${expectedUid}`,
      retrySafe: true,
    });
  }
  try {
    const info = fstatSync(fd);
    const mode = info.mode & 0o777;
    if (!info.isFile() || info.uid !== expectedUid) {
      throw new OnboardingLaunchError({
        code: "cli-start-lock-unavailable",
        phase: "start-queue",
        message: `start lock ${lockPath} is not a regular file owned by uid ${expectedUid}`,
        retrySafe: true,
      });
    }
    if (mode === 0o664 || mode === 0o640 || mode === 0o644) {
      fchmodSync(fd, 0o600);
    } else if (mode !== 0o600) {
      throw new OnboardingLaunchError({
        code: "cli-start-lock-unavailable",
        phase: "start-queue",
        message: `start lock ${lockPath} has unsafe mode ${mode.toString(8)}`,
        hint: `chmod 0600 ${lockPath}`,
        retrySafe: true,
      });
    }
    return fd;
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

interface LockStamp {
  startedAtMs?: number;
  releasedAtMs?: number;
}

function readLockStampFromFd(fd: number): LockStamp | undefined {
  try {
    const raw = readFileSync(fd, "utf8").trim();
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const obj = parsed as Record<string, unknown>;
    return {
      ...(typeof obj.startedAtMs === "number" ? { startedAtMs: obj.startedAtMs } : {}),
      ...(typeof obj.releasedAtMs === "number" ? { releasedAtMs: obj.releasedAtMs } : {}),
    };
  } catch {
    return undefined;
  }
}

function writeLockStampToFd(fd: number, stamp: { pid: number; startedAtMs: number; releasedAtMs: number }): void {
  try {
    ftruncateSync(fd, 0);
    writeSync(fd, Buffer.from(`${JSON.stringify(stamp)}\n`, "utf8"), 0, undefined, 0);
  } catch {
    /* Non-fatal: kernel flock already provided mutual exclusion. */
  }
}

function syncSleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(ms));
}

function pidExeLooksLikeAgy(pid: number, readlinkFn?: (p: string) => string): boolean {
  try {
    const exe = readlinkFn ? readlinkFn(`/proc/${pid}/exe`) : realpathSync(`/proc/${pid}/exe`);
    const base = basename(exe).toLowerCase();
    return base === "agy" || base === "antigravity";
  } catch {
    return false;
  }
}

function pidCmdlineMentionsAgy(pid: number): boolean {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    const argv0 = raw.split("\0")[0] ?? "";
    const base = basename(argv0).toLowerCase();
    return base === "agy" || base === "antigravity";
  } catch {
    return false;
  }
}

export function processTreeContainsAgy(
  rootPid: number,
  procRoot = "/proc",
): boolean {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return false;
  if (pidExeLooksLikeAgy(rootPid) || pidCmdlineMentionsAgy(rootPid)) return true;
  if (process.platform !== "linux") return false;
  let childrenByPpid: Map<number, number[]>;
  try {
    const entries = readdirSync(procRoot);
    childrenByPpid = new Map<number, number[]>();
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      try {
        const stat = readFileSync(join(procRoot, entry, "stat"), "utf8");
        const endParen = stat.lastIndexOf(")");
        if (endParen < 0) continue;
        const fields = stat.slice(endParen + 2).split(" ");
        const ppid = Number(fields[1]);
        if (Number.isSafeInteger(ppid) && ppid > 0) {
          let list = childrenByPpid.get(ppid);
          if (!list) {
            list = [];
            childrenByPpid.set(ppid, list);
          }
          list.push(pid);
        }
      } catch {
        /* exited mid-scan */
      }
    }
  } catch {
    return false;
  }
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== rootPid && (pidExeLooksLikeAgy(current) || pidCmdlineMentionsAgy(current))) {
      return true;
    }
    for (const child of childrenByPpid.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return false;
}

export interface AgyStartQueueOptions {
  readonly lockPath?: string;
  readonly flockCandidates?: readonly string[];
  readonly spacingMs?: number;
  readonly timeoutMs?: number;
  readonly postSpawnMaxHoldMs?: number;
  readonly uid?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly onWait?: (message: string) => void;
  readonly checkWorkerAgy?: (workerPid: number) => boolean;
}

export interface AgyStartQueueResult<T> {
  readonly value: T;
  readonly waitedForLockMs: number;
  readonly waitedForSpacingMs: number;
}

const agyStartLockStorage = new AsyncLocalStorage<Set<string>>();
const inProcessAgyAsyncQueues = new Map<string, Promise<void>>();

export function resolveAgyQueueTimeoutMs(budgetMs?: number): number {
  if (budgetMs !== undefined && Number.isFinite(budgetMs) && budgetMs > 0) {
    return budgetMs;
  }
  return DEFAULT_AGY_LOCK_TIMEOUT_MS;
}

export function withAgyStartQueueSync<T>(
  fn: () => { result: T; workerPid?: number | undefined },
  options: AgyStartQueueOptions = {},
): T {
  const env = options.env ?? process.env;
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const lockPath = options.lockPath ?? resolveAgyStartLockPath(uid);
  const spacingMs = options.spacingMs ?? resolveAgyStartSpacingMs(env);
  const timeoutMs = resolveAgyQueueTimeoutMs(options.timeoutMs);
  const postSpawnMaxHoldMs = options.postSpawnMaxHoldMs ?? POST_SPAWN_MAX_HOLD_MS;
  const onWait =
    options.onWait ?? ((msg: string) => { process.stderr.write(`${msg}\n`); });

  const held = agyStartLockStorage.getStore();
  if (held?.has(lockPath)) {
    return fn().result;
  }

  const flockTool = resolveFlockTool(options.flockCandidates, uid);
  const fd = openAgyStartLockFd(lockPath, uid);
  const nextHeld = new Set(held);
  nextHeld.add(lockPath);
  const enteredAt = Date.now();
  const deadline = enteredAt + timeoutMs;
  const startedAtMs = enteredAt;
  try {
    const nonBlock = spawnSync(flockTool, ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "ignore", fd],
      env: {},
    });
    if (nonBlock.status !== 0) {
      onWait(`[h2a] agy start queued: waiting for ${lockPath} (serialized start spacing ${spacingMs}ms)`);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new OnboardingLaunchError({
          code: "cli-start-lock-timeout",
          phase: "start-queue",
          message: `timed out waiting for agy start lock ${lockPath} after ${timeoutMs}ms`,
          hint: "wait for in-flight agy starts to finish or increase --launch-budget-ms",
          retrySafe: true,
        });
      }
      const timeoutSec = Math.max(0.05, remainingMs / 1000).toFixed(3);
      const blocking = spawnSync(flockTool, ["--exclusive", "--timeout", timeoutSec, "3"], {
        stdio: ["ignore", "ignore", "ignore", fd],
        env: {},
      });
      if (blocking.status !== 0) {
        throw new OnboardingLaunchError({
          code: "cli-start-lock-timeout",
          phase: "start-queue",
          message: `timed out waiting for agy start lock ${lockPath} after ${timeoutMs}ms`,
          hint: "wait for in-flight agy starts to finish or increase --launch-budget-ms",
          retrySafe: true,
        });
      }
    }

    const prevStamp = readLockStampFromFd(fd);
    const prevRefMs = prevStamp?.startedAtMs ?? prevStamp?.releasedAtMs;
    if (prevRefMs !== undefined) {
      const waitRemaining = prevRefMs + spacingMs - Date.now();
      if (waitRemaining > 0) {
        if (Date.now() + waitRemaining > deadline) {
          throw new OnboardingLaunchError({
            code: "cli-start-lock-timeout",
            phase: "start-queue",
            message: `agy start spacing wait (${Math.ceil(waitRemaining)}ms) exceeds launch budget (${timeoutMs}ms)`,
            hint: "retry once the spacing window clears or increase --launch-budget-ms",
            retrySafe: true,
          });
        }
        onWait(`[h2a] agy start spacing: waiting ${Math.ceil(waitRemaining)}ms before starting next agy`);
        syncSleepMs(waitRemaining);
      }
    }

    const actualStartMs = Date.now();
    const { result, workerPid } = agyStartLockStorage.run(nextHeld, fn);
    if (workerPid !== undefined && workerPid > 0) {
      const holdDeadline = Date.now() + postSpawnMaxHoldMs;
      while (Date.now() < holdDeadline) {
        const active = options.checkWorkerAgy
          ? options.checkWorkerAgy(workerPid)
          : processTreeContainsAgy(workerPid);
        if (active) break;
        syncSleepMs(Math.min(50, Math.max(1, holdDeadline - Date.now())));
      }
    }
    writeLockStampToFd(fd, {
      pid: process.pid,
      startedAtMs: actualStartMs || startedAtMs,
      releasedAtMs: Date.now(),
    });
    return result;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

export async function withAgyStartQueueAsync<T>(
  fn: () => Promise<{ result: T; workerPid?: number | undefined }>,
  options: AgyStartQueueOptions = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const lockPath = options.lockPath ?? resolveAgyStartLockPath(uid);
  const spacingMs = options.spacingMs ?? resolveAgyStartSpacingMs(env);
  const timeoutMs = resolveAgyQueueTimeoutMs(options.timeoutMs);
  const postSpawnMaxHoldMs = options.postSpawnMaxHoldMs ?? POST_SPAWN_MAX_HOLD_MS;
  const onWait =
    options.onWait ?? ((msg: string) => { process.stderr.write(`${msg}\n`); });

  const held = agyStartLockStorage.getStore();
  if (held?.has(lockPath)) {
    return (await fn()).result;
  }

  const flockTool = resolveFlockTool(options.flockCandidates, uid);
  const deadline = Date.now() + timeoutMs;

  const prevQueue = inProcessAgyAsyncQueues.get(lockPath);
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((res) => {
    releaseTurn = res;
  });
  const tail = (prevQueue ?? Promise.resolve()).then(() => currentTurn);
  inProcessAgyAsyncQueues.set(lockPath, tail);
  void tail.finally(() => {
    if (inProcessAgyAsyncQueues.get(lockPath) === tail) {
      inProcessAgyAsyncQueues.delete(lockPath);
    }
  });

  if (prevQueue) {
    onWait(`[h2a] agy start queued: waiting for in-process turn on ${lockPath}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      releaseTurn();
      throw new OnboardingLaunchError({
        code: "cli-start-lock-timeout",
        phase: "start-queue",
        message: `timed out waiting for agy start queue after ${timeoutMs}ms`,
        hint: "wait for in-flight agy starts or increase --launch-budget-ms",
        retrySafe: true,
      });
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      prevQueue.then(() => false),
      new Promise<boolean>((res) => {
        timer = setTimeout(() => res(true), remaining);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      releaseTurn();
      throw new OnboardingLaunchError({
        code: "cli-start-lock-timeout",
        phase: "start-queue",
        message: `timed out waiting for agy start queue after ${timeoutMs}ms`,
        hint: "wait for in-flight agy starts or increase --launch-budget-ms",
        retrySafe: true,
      });
    }
  }

  let fd: number | undefined;
  let actualStartMs = Date.now();
  let lockAcquired = false;
  try {
    fd = openAgyStartLockFd(lockPath, uid);
    const nonBlock = spawnSync(flockTool, ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "ignore", fd],
      env: {},
    });
    if (nonBlock.status !== 0) {
      onWait(`[h2a] agy start queued: waiting for ${lockPath} (serialized start spacing ${spacingMs}ms)`);
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new OnboardingLaunchError({
          code: "cli-start-lock-timeout",
          phase: "start-queue",
          message: `timed out waiting for agy start lock ${lockPath} after ${timeoutMs}ms`,
          retrySafe: true,
        });
      }
      const timeoutSec = Math.max(0.05, remainingMs / 1000).toFixed(3);
      const status = await new Promise<number | null>((resolveLock, rejectLock) => {
        const child = spawn(flockTool, ["--exclusive", "--timeout", timeoutSec, "3"], {
          stdio: ["ignore", "ignore", "ignore", fd],
          env: {},
        });
        child.once("error", rejectLock);
        child.once("exit", (code) => resolveLock(code));
      });
      if (status !== 0) {
        throw new OnboardingLaunchError({
          code: "cli-start-lock-timeout",
          phase: "start-queue",
          message: `timed out waiting for agy start lock ${lockPath} after ${timeoutMs}ms`,
          retrySafe: true,
        });
      }
    }
    lockAcquired = true;

    const prevStamp = readLockStampFromFd(fd);
    const prevRefMs = prevStamp?.startedAtMs ?? prevStamp?.releasedAtMs;
    if (prevRefMs !== undefined) {
      const waitRemaining = prevRefMs + spacingMs - Date.now();
      if (waitRemaining > 0) {
        if (Date.now() + waitRemaining > deadline) {
          throw new OnboardingLaunchError({
            code: "cli-start-lock-timeout",
            phase: "start-queue",
            message: `agy start spacing wait (${Math.ceil(waitRemaining)}ms) exceeds launch budget (${timeoutMs}ms)`,
            retrySafe: true,
          });
        }
        onWait(`[h2a] agy start spacing: waiting ${Math.ceil(waitRemaining)}ms before starting next agy`);
        await delay(waitRemaining);
      }
    }

    const nextHeld = new Set(held);
    nextHeld.add(lockPath);
    actualStartMs = Date.now();
    const { result, workerPid } = await agyStartLockStorage.run(nextHeld, fn);
    if (workerPid !== undefined && workerPid > 0) {
      const holdDeadline = Date.now() + postSpawnMaxHoldMs;
      while (Date.now() < holdDeadline) {
        const active = options.checkWorkerAgy
          ? options.checkWorkerAgy(workerPid)
          : processTreeContainsAgy(workerPid);
        if (active) break;
        await delay(Math.min(50, Math.max(1, holdDeadline - Date.now())));
      }
    }
    writeLockStampToFd(fd, {
      pid: process.pid,
      startedAtMs: actualStartMs,
      releasedAtMs: Date.now(),
    });
    return result;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    releaseTurn();
  }
}

// ============================================================================
// Version check (`agy 1.5.17`)
// ============================================================================

export function parseAgyVersionOutput(text: string): string | undefined {
  const m = /\b(\d+\.\d+\.\d+)\b/.exec(text);
  return m ? m[1] : undefined;
}

export function checkAgyQualifiedVersionWarning(
  command = "agy",
  spawnFn: typeof spawnSync = spawnSync,
): string | undefined {
  try {
    const r = spawnFn(command, ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) return undefined;
    const version = parseAgyVersionOutput(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    if (version && version !== AGY_QUALIFIED_VERSION) {
      return `agy version ${version} differs from qualified ${AGY_QUALIFIED_VERSION}; onboarding patterns were qualified on ${AGY_QUALIFIED_VERSION}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// ============================================================================
// Trust config, audit, pre-check (Q1-A & Q2-C)
// ============================================================================

export function resolveHomeDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const home = env["HOME"]?.trim();
  return home && isAbsolute(home) ? home : homedir();
}

export function resolveXdgConfigHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env["XDG_CONFIG_HOME"]?.trim();
  return raw && isAbsolute(raw) ? raw : join(resolveHomeDir(env), ".config");
}

export function resolveXdgStateHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const raw = env["XDG_STATE_HOME"]?.trim();
  return raw && isAbsolute(raw) ? raw : join(resolveHomeDir(env), ".local", "state");
}

export function agySettingsPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(resolveHomeDir(env), ".gemini", "antigravity-cli", "settings.json");
}

export function h2aTrustApprovalsPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(resolveXdgConfigHome(env), "sentropic", "h2a", "trust-approvals.json");
}

export function h2aTrustAuditPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(resolveXdgStateHome(env), "h2a", "trust-audit.jsonl");
}

export function h2aOwnerAlertsPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(resolveXdgStateHome(env), "h2a", "owner-alerts.jsonl");
}

export function h2aTrustWriteLockPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(resolveXdgStateHome(env), "h2a", "trust-write.lock");
}

export function safeRealpath(targetPath: string): string | undefined {
  try {
    return realpathSync(resolve(targetPath));
  } catch {
    return undefined;
  }
}

export function canonicalizeWorkspacePath(targetPath: string): string {
  const resolved = resolve(targetPath);
  try {
    return realpathSync(resolved);
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-workspace-not-trusted",
      phase: "onboarding",
      message: `workspace path cannot be resolved cleanly (${resolved}): ${error instanceof Error ? error.message : String(error)}`,
      hint: "verify the workspace path exists before trusting or launching",
      retrySafe: true,
    });
  }
}

export interface TrustApprovalsFile {
  readonly version: 1;
  readonly agy: {
    readonly subtrees: readonly string[];
    readonly exact: readonly string[];
    readonly refused: readonly string[];
  };
}

export interface TrustAuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly cli: "agy";
  readonly action: "approve" | "baseline-import" | "remove" | "refuse" | "ack";
  readonly path: string;
  readonly scope?: "subtree" | "exact";
  readonly actor: "owner-tty";
  readonly settingsWritten?: boolean;
  readonly ackedAlertId?: string;
}

export interface TrustOwnerAlert {
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly kind: "out-of-band-trust" | "trust-audit-mismatch" | "trust-config-unreadable";
  readonly cli: "agy";
  readonly path?: string;
  readonly message: string;
}

function parseJsonObjectStrict(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${label} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      hint: `repair ${label} manually, then retry`,
      retrySafe: true,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${label} must be a JSON object`,
      retrySafe: true,
    });
  }
  return parsed as Record<string, unknown>;
}

function readAgySettingsTrustedWorkspaces(settingsFile: string): {
  readonly exists: boolean;
  readonly rawSettings: Record<string, unknown>;
  readonly trustedWorkspaces: string[];
} {
  if (!existsSync(settingsFile)) {
    return { exists: false, rawSettings: {}, trustedWorkspaces: [] };
  }
  let raw: string;
  try {
    raw = readFileSync(settingsFile, "utf8");
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `cannot read ${settingsFile}: ${error instanceof Error ? error.message : String(error)}`,
      retrySafe: true,
    });
  }
  const obj = parseJsonObjectStrict(raw, settingsFile);
  const tw = obj["trustedWorkspaces"];
  if (tw === undefined) {
    return { exists: true, rawSettings: obj, trustedWorkspaces: [] };
  }
  if (!Array.isArray(tw) || !tw.every((item): item is string => typeof item === "string")) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${settingsFile} has invalid trustedWorkspaces (expected string[])`,
      retrySafe: true,
    });
  }
  return { exists: true, rawSettings: obj, trustedWorkspaces: [...tw] };
}

function readTrustApprovalsStrict(filePath: string): {
  readonly exists: boolean;
  readonly subtrees: string[];
  readonly exact: string[];
  readonly refused: string[];
} {
  if (!existsSync(filePath)) {
    return { exists: false, subtrees: [], exact: [], refused: [] };
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      retrySafe: true,
    });
  }
  const obj = parseJsonObjectStrict(raw, filePath);
  const agy = obj["agy"];
  if (agy === undefined) {
    return { exists: true, subtrees: [], exact: [], refused: [] };
  }
  if (!agy || typeof agy !== "object" || Array.isArray(agy)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${filePath} has invalid agy block`,
      retrySafe: true,
    });
  }
  const agyObj = agy as Record<string, unknown>;
  const readStringArr = (key: string): string[] => {
    const val = agyObj[key];
    if (val === undefined) return [];
    if (!Array.isArray(val) || !val.every((x): x is string => typeof x === "string")) {
      throw new OnboardingLaunchError({
        code: "cli-trust-config-unreadable",
        phase: "onboarding",
        message: `${filePath} agy.${key} must be string[]`,
        retrySafe: true,
      });
    }
    return [...val];
  };
  return {
    exists: true,
    subtrees: readStringArr("subtrees"),
    exact: readStringArr("exact"),
    refused: readStringArr("refused"),
  };
}

function readTrustAuditEventsStrict(auditPath: string): TrustAuditEvent[] {
  if (!existsSync(auditPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(auditPath, "utf8");
  } catch (error) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `cannot read ${auditPath}: ${error instanceof Error ? error.message : String(error)}`,
      retrySafe: true,
    });
  }
  const events: TrustAuditEvent[] = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch {
      throw new OnboardingLaunchError({
        code: "cli-trust-audit-mismatch",
        phase: "onboarding",
        message: `${auditPath} line ${i + 1} is corrupt`,
        retrySafe: true,
      });
    }
    if (!parsed || typeof parsed !== "object") {
      throw new OnboardingLaunchError({
        code: "cli-trust-audit-mismatch",
        phase: "onboarding",
        message: `${auditPath} line ${i + 1} is not an object`,
        retrySafe: true,
      });
    }
    events.push(parsed as TrustAuditEvent);
  }
  return events;
}

export function deterministicOutOfBandAlertId(realPath: string): string {
  const hash = createHash("sha256").update(`agy:oob:${realPath}`).digest("hex").slice(0, 10);
  return `oob-agy-${hash}`;
}

function buildAuditedPathSets(events: readonly TrustAuditEvent[]): {
  readonly approvedPaths: Set<string>;
  readonly ackedIds: Set<string>;
} {
  const approvedPaths = new Set<string>();
  const ackedIds = new Set<string>();
  for (const ev of events) {
    if (ev.cli !== "agy") continue;
    const norm = safeRealpath(ev.path) ?? resolve(ev.path);
    if (ev.action === "approve" || ev.action === "baseline-import") {
      approvedPaths.add(norm);
    } else if (ev.action === "remove" || ev.action === "refuse") {
      approvedPaths.delete(norm);
    } else if (ev.action === "ack" && ev.ackedAlertId) {
      ackedIds.add(ev.ackedAlertId);
    }
  }
  return { approvedPaths, ackedIds };
}

export function isUnsupportedTrustRoot(realPath: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const homeReal = safeRealpath(resolveHomeDir(env)) ?? resolve(resolveHomeDir(env));
  return realPath === "/" || realPath === homeReal;
}

export function isPathUnderPrefix(candidateReal: string, rootReal: string): boolean {
  if (candidateReal === rootReal) return true;
  if (rootReal === "/") return false;
  return candidateReal.startsWith(`${rootReal}/`);
}

function findEnclosingGitRoot(realPath: string): string | undefined {
  let cursor = realPath;
  for (;;) {
    const gitMarker = join(cursor, ".git");
    if (existsSync(gitMarker)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

export interface AgyTrustPrecheckResult {
  readonly ok: true;
  readonly realCwd: string;
  readonly coverage: "settings-exact" | "subtree-rule";
  readonly coveredByRoot: string;
  readonly needsSettingsOverride: boolean;
  readonly settingsOverrideJson?: string;
  readonly untrackedTrustApproval: boolean;
  readonly untrackedPaths: readonly string[];
  readonly alerts: readonly TrustOwnerAlert[];
}

export function checkAgyTrustPrecheckSync(options: {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): AgyTrustPrecheckResult {
  const env = options.env ?? process.env;
  const realCwd = canonicalizeWorkspacePath(options.cwd);
  const homeReal = safeRealpath(resolveHomeDir(env)) ?? resolve(resolveHomeDir(env));

  if (isUnsupportedTrustRoot(realCwd, env)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-unsupported-cwd",
      phase: "onboarding",
      message: `refusing agy workspace launch in protected root directory ${realCwd} ($HOME or / cannot be trusted cleanly)`,
      hint: "launch agy inside a specific project workspace directory instead of $HOME or /",
      retrySafe: true,
    });
  }

  const settingsFile = agySettingsPath(env);
  const approvalsFile = h2aTrustApprovalsPath(env);
  const auditFile = h2aTrustAuditPath(env);

  const settings = readAgySettingsTrustedWorkspaces(settingsFile);
  const approvals = readTrustApprovalsStrict(approvalsFile);
  const auditEvents = readTrustAuditEventsStrict(auditFile);
  const { approvedPaths, ackedIds } = buildAuditedPathSets(auditEvents);

  // Every active entry inside h2a's own trust-approvals.json MUST have a matching
  // approval/baseline entry in trust-audit.jsonl (fail closed on manual tampering).
  for (const listed of [...approvals.subtrees, ...approvals.exact]) {
    const norm = safeRealpath(listed) ?? resolve(listed);
    if (!approvedPaths.has(norm)) {
      throw new OnboardingLaunchError({
        code: "cli-trust-audit-mismatch",
        phase: "onboarding",
        message: `trust-approvals.json contains "${listed}" without matching entry in ${auditFile}`,
        hint: `run \`h2a trust audit\` or \`h2a trust init-baseline\` in an owner terminal to reconcile trust records`,
        retrySafe: true,
      });
    }
  }

  const normalizedRefused = new Set(approvals.refused.map((p) => safeRealpath(p) ?? resolve(p)));

  // Reject any explicitly refused directory immediately (even if present in an ancestor subtree or settings).
  if (normalizedRefused.has(realCwd)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-refused",
      phase: "onboarding",
      message: `workspace ${realCwd} is marked as refused for agy trust`,
      hint: `approve explicitly with \`h2a trust agy ${realCwd}\` in an owner terminal if you intend to reverse this refusal`,
      retrySafe: true,
    });
  }

  // Detect any out-of-band additions in settings.json not recorded in trust-audit.jsonl.
  const untrackedPaths: string[] = [];
  const alerts: TrustOwnerAlert[] = [];
  const normalizedSettings: string[] = [];
  for (const rawEntry of settings.trustedWorkspaces) {
    const norm = safeRealpath(rawEntry) ?? resolve(rawEntry);
    normalizedSettings.push(norm);
    if (!approvedPaths.has(norm)) {
      untrackedPaths.push(norm);
      const id = deterministicOutOfBandAlertId(norm);
      if (!ackedIds.has(id)) {
        alerts.push({
          id,
          severity: "warning",
          kind: "out-of-band-trust",
          cli: "agy",
          path: norm,
          message: `out-of-band agy trust in settings.json: ${norm} (ack with: h2a trust audit --ack ${id})`,
        });
      }
    }
  }

  // 1. Exact presence in agy settings.json trustedWorkspaces.
  if (normalizedSettings.includes(realCwd)) {
    const rawIncludesReal = settings.trustedWorkspaces.includes(realCwd);
    const union = rawIncludesReal
      ? undefined
      : Array.from(new Set([...settings.trustedWorkspaces, realCwd]));
    return {
      ok: true,
      realCwd,
      coverage: "settings-exact",
      coveredByRoot: realCwd,
      needsSettingsOverride: !rawIncludesReal,
      ...(union ? { settingsOverrideJson: JSON.stringify({ trustedWorkspaces: union }) } : {}),
      untrackedTrustApproval: untrackedPaths.length > 0,
      untrackedPaths,
      alerts,
    };
  }

  // 2. Q2-C: approved root covering internal subdirs (realpath prefix),
  //    never $HOME, never "/", never a refused path, and external worktrees don't inherit.
  const cwdGitRoot = findEnclosingGitRoot(realCwd);
  const matchingRoots = approvals.subtrees
    .map((r) => safeRealpath(r) ?? resolve(r))
    .filter((rootReal) => {
      if (rootReal === "/" || rootReal === homeReal) return false;
      if (normalizedRefused.has(rootReal)) return false;
      if (!isPathUnderPrefix(realCwd, rootReal)) return false;
      // If cwd lies inside a nested independent git worktree/repo whose root is
      // NOT the trusted root (e.g. a worktree placed inside another trusted directory),
      // require separate approval unless the worktree belongs inside `rootReal` and
      // `.git` at cwdGitRoot is NOT a separate repository outside rootReal.
      if (cwdGitRoot && cwdGitRoot !== rootReal && isPathUnderPrefix(cwdGitRoot, rootReal)) {
        const gitDot = join(cwdGitRoot, ".git");
        try {
          if (statSync(gitDot).isDirectory()) {
            // Distinct nested git repository — not just internal subdirs of rootReal.
            return false;
          }
        } catch {
          /* ignore */
        }
      }
      return true;
    })
    .sort((a, b) => b.length - a.length);

  if (matchingRoots.length > 0) {
    const union = Array.from(new Set([...settings.trustedWorkspaces, realCwd]));
    return {
      ok: true,
      realCwd,
      coverage: "subtree-rule",
      coveredByRoot: matchingRoots[0]!,
      needsSettingsOverride: true,
      settingsOverrideJson: JSON.stringify({ trustedWorkspaces: union }),
      untrackedTrustApproval: untrackedPaths.length > 0,
      untrackedPaths,
      alerts,
    };
  }

  throw new OnboardingLaunchError({
    code: "cli-workspace-not-trusted",
    phase: "onboarding",
    message: `agy does not trust workspace ${realCwd}`,
    hint: `run \`h2a trust agy ${realCwd}\` in an owner terminal (never inside an agent session), then retry`,
    retrySafe: true,
  });
}

export function collectTrustAlertsReadOnly(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly alerts: readonly TrustOwnerAlert[] } {
  const alerts: TrustOwnerAlert[] = [];
  const settingsFile = agySettingsPath(env);
  const approvalsFile = h2aTrustApprovalsPath(env);
  const auditFile = h2aTrustAuditPath(env);

  let trustedWorkspaces: string[] = [];
  try {
    trustedWorkspaces = readAgySettingsTrustedWorkspaces(settingsFile).trustedWorkspaces;
  } catch (error) {
    alerts.push({
      id: "agy-settings-unreadable",
      severity: "error",
      kind: "trust-config-unreadable",
      cli: "agy",
      path: settingsFile,
      message: error instanceof Error ? error.message : String(error),
    });
    return { alerts };
  }

  let approvals: ReturnType<typeof readTrustApprovalsStrict> = {
    exists: false,
    subtrees: [],
    exact: [],
    refused: [],
  };
  let auditEvents: TrustAuditEvent[] = [];
  try {
    approvals = readTrustApprovalsStrict(approvalsFile);
    auditEvents = readTrustAuditEventsStrict(auditFile);
  } catch (error) {
    alerts.push({
      id: "agy-trust-audit-unreadable",
      severity: "error",
      kind: error instanceof OnboardingLaunchError && error.code === "cli-trust-audit-mismatch"
        ? "trust-audit-mismatch"
        : "trust-config-unreadable",
      cli: "agy",
      message: error instanceof Error ? error.message : String(error),
    });
    return { alerts };
  }

  const { approvedPaths, ackedIds } = buildAuditedPathSets(auditEvents);

  for (const listed of [...approvals.subtrees, ...approvals.exact]) {
    const norm = safeRealpath(listed) ?? resolve(listed);
    if (!approvedPaths.has(norm) && !ackedIds.has(`mismatch-${norm}`)) {
      alerts.push({
        id: `mismatch-${createHash("sha256").update(norm).digest("hex").slice(0, 8)}`,
        severity: "error",
        kind: "trust-audit-mismatch",
        cli: "agy",
        path: norm,
        message: `trust-approvals.json lists ${norm} without matching trust-audit entry`,
      });
    }
  }

  for (const rawEntry of trustedWorkspaces) {
    const norm = safeRealpath(rawEntry) ?? resolve(rawEntry);
    if (!approvedPaths.has(norm)) {
      const id = deterministicOutOfBandAlertId(norm);
      if (!ackedIds.has(id)) {
        alerts.push({
          id,
          severity: "warning",
          kind: "out-of-band-trust",
          cli: "agy",
          path: norm,
          message: `out-of-band agy trust in settings.json: ${norm} (ack with: h2a trust audit --ack ${id})`,
        });
      }
    }
  }

  if (existsSync(h2aOwnerAlertsPath(env))) {
    try {
      const raw = readFileSync(h2aOwnerAlertsPath(env), "utf8");
      for (const line of raw.split(/\r?\n/).filter((l) => l.trim().length > 0)) {
        const parsed = JSON.parse(line) as Partial<TrustOwnerAlert>;
        if (parsed.id && parsed.message && !ackedIds.has(parsed.id) && !alerts.some((a) => a.id === parsed.id)) {
          alerts.push({
            id: parsed.id,
            severity: parsed.severity === "error" ? "error" : "warning",
            kind: parsed.kind ?? "out-of-band-trust",
            cli: "agy",
            ...(parsed.path ? { path: parsed.path } : {}),
            message: parsed.message,
          });
        }
      }
    } catch {
      /* Preserve computed alerts cleanly */
    }
  }

  return { alerts };
}

export function writeFileAtomicPrivate(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(
    tmpPath,
    fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, content, 0, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, targetPath);
}

export function appendJsonlPrivate(targetPath: string, record: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  appendFileSync(targetPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

// ============================================================================
// Memory Policy & Slice Guard (Q3-A & Lot 1a.5)
// ============================================================================

export type NativeMemoryPolicy = "default" | "agy";
export type NativeSessionClass = "human" | "background";

export interface AgyMemoryLimits {
  readonly memoryMaxBytes: number;
  readonly memoryHighBytes: number;
  readonly memorySwapMaxBytes: 0;
}

export function computeAgyMemoryLimits(totalMemBytes = totalmem()): AgyMemoryLimits {
  const memoryMaxBytes = Math.min(
    AGY_DEFAULT_MEMORY_MAX_BYTES,
    Math.floor(totalMemBytes * AGY_MEMORY_HOST_CAP_RATIO),
  );
  const memoryHighBytes = Math.floor(memoryMaxBytes * AGY_MEMORY_HIGH_RATIO);
  return {
    memoryMaxBytes,
    memoryHighBytes,
    memorySwapMaxBytes: 0,
  };
}

export function resolveMemoryScopeSpec(options: {
  readonly memoryPolicy?: NativeMemoryPolicy | undefined;
  readonly sessionClass?: NativeSessionClass | undefined;
  readonly totalMemBytes?: number | undefined;
}): {
  readonly policy: NativeMemoryPolicy;
  readonly sessionClass: NativeSessionClass;
  readonly slice: "app.slice" | typeof AGY_AGENTS_SLICE_NAME;
  readonly oomPreference: "avoid" | "none";
  readonly defaultMaxBytes: number;
  readonly highRatio: number;
} {
  const policy: NativeMemoryPolicy = options.memoryPolicy === "agy" ? "agy" : "default";
  const sessionClass: NativeSessionClass = options.sessionClass === "human" ? "human" : "background";
  const hostMem = options.totalMemBytes ?? totalmem();
  if (policy === "agy") {
    const limits = computeAgyMemoryLimits(hostMem);
    return {
      policy,
      sessionClass,
      slice: sessionClass === "background" ? AGY_AGENTS_SLICE_NAME : "app.slice",
      oomPreference: sessionClass === "human" ? "avoid" : "none",
      defaultMaxBytes: limits.memoryMaxBytes,
      highRatio: AGY_MEMORY_HIGH_RATIO,
    };
  }
  return {
    policy,
    sessionClass,
    slice: "app.slice",
    oomPreference: sessionClass === "human" ? "avoid" : "none",
    defaultMaxBytes: Math.min(8 * 1024 ** 3, Math.floor(hostMem / 4)),
    highRatio: 0.8,
  };
}

export interface SliceGuardCheckOptions {
  readonly slice?: string;
  readonly totalMemBytes?: number;
  readonly uid?: number;
  readonly runSystemctlShow?: () => { status: number | null; stdout: string; stderr: string; error?: Error };
  readonly readCgroupFile?: (path: string) => string;
}

export type SliceGuardResult =
  | {
      readonly ok: true;
      readonly memoryMaxBytes: number;
      readonly source: "cgroupfs" | "systemd-show";
    }
  | {
      readonly ok: false;
      readonly code:
        | "cli-memory-slice-missing"
        | "cli-memory-slice-insufficient"
        | "cli-memory-slice-unbounded"
        | "cli-memory-slice-unreadable";
      readonly reason: string;
      readonly hint: string;
    };

export function inspectAgyAgentsSliceSync(options: SliceGuardCheckOptions = {}): SliceGuardResult {
  const sliceName = options.slice ?? AGY_AGENTS_SLICE_NAME;
  const hostMem = options.totalMemBytes ?? totalmem();
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const laneAgyMax = computeAgyMemoryLimits(hostMem).memoryMaxBytes;
  const maxCeilingBytes = Math.floor(hostMem * AGY_SLICE_MAX_HOST_CAP_RATIO);
  const cgroupMemoryMaxPath = `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service/${sliceName}/memory.max`;

  const readCgroup = (path: string): string | undefined => {
    try {
      return (options.readCgroupFile ? options.readCgroupFile(path) : readFileSync(path, "utf8")).trim();
    } catch {
      return undefined;
    }
  };

  let sysOut = "";
  let sysOk = false;
  if (options.runSystemctlShow) {
    const r = options.runSystemctlShow();
    sysOk = !r.error && r.status === 0;
    sysOut = r.stdout ?? "";
  } else {
    const r = spawnSync(
      "systemctl",
      [
        "--user",
        "show",
        sliceName,
        "-p",
        "FragmentPath",
        "-p",
        "MemoryMax",
        "-p",
        "MemoryHigh",
        "-p",
        "NeedDaemonReload",
        "-p",
        "ActiveState",
      ],
      { encoding: "utf8", timeout: 1_500, stdio: ["ignore", "pipe", "pipe"] },
    );
    sysOk = !r.error && r.status === 0;
    sysOut = r.stdout ?? "";
  }

  const props = new Map<string, string>();
  if (sysOk) {
    for (const line of sysOut.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0) props.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
  }

  const cgroupRaw = readCgroup(cgroupMemoryMaxPath);
  const activeState = props.get("ActiveState") ?? "";
  const fragmentPath = props.get("FragmentPath") ?? "";
  const needDaemonReload = props.get("NeedDaemonReload") ?? "no";

  if (!sysOk && cgroupRaw === undefined) {
    return {
      ok: false,
      code: "cli-memory-slice-unreadable",
      reason: `cannot inspect systemd slice ${sliceName} (systemctl and cgroupfs both unavailable)`,
      hint: `verify user systemd is running and create ~/.config/systemd/user/${sliceName}, then run \`systemctl --user daemon-reload\``,
    };
  }

  if (sysOk && fragmentPath.length === 0) {
    return {
      ok: false,
      code: "cli-memory-slice-missing",
      reason: `systemd unit ${sliceName} has no FragmentPath`,
      hint: `create ~/.config/systemd/user/${sliceName} with MemoryHigh=31G and MemoryMax=37G, then run \`systemctl --user daemon-reload\``,
    };
  }

  const evalNumericCeiling = (bytes: number, source: "cgroupfs" | "systemd-show"): SliceGuardResult => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return {
        ok: false,
        code: "cli-memory-slice-unreadable",
        reason: `${sliceName} reported non-numeric memory limit (${bytes})`,
        hint: `check MemoryMax in ~/.config/systemd/user/${sliceName} and run \`systemctl --user daemon-reload\``,
      };
    }
    if (bytes <= laneAgyMax) {
      return {
        ok: false,
        code: "cli-memory-slice-insufficient",
        reason: `${sliceName} MemoryMax (${bytes} B) is <= lane agy MemoryMax (${laneAgyMax} B)`,
        hint: `set MemoryMax above ${laneAgyMax} B (recommended 37G) in ~/.config/systemd/user/${sliceName} and run \`systemctl --user daemon-reload\``,
      };
    }
    if (bytes > maxCeilingBytes) {
      return {
        ok: false,
        code: "cli-memory-slice-unbounded",
        reason: `${sliceName} MemoryMax (${bytes} B) exceeds 65% host RAM cap (${maxCeilingBytes} B)`,
        hint: `bound MemoryMax <= 37G (<= ${maxCeilingBytes} B) in ~/.config/systemd/user/${sliceName} and run \`systemctl --user daemon-reload\``,
      };
    }
    return { ok: true, memoryMaxBytes: bytes, source };
  };

  // When active in cgroupfs, live kernel memory.max takes precedence.
  if (cgroupRaw !== undefined && (activeState === "active" || !sysOk)) {
    if (cgroupRaw === "max") {
      return {
        ok: false,
        code: "cli-memory-slice-unbounded",
        reason: `${sliceName} active cgroup memory.max is unbounded ("max")`,
        hint: `set finite MemoryMax (e.g. 37G) in ~/.config/systemd/user/${sliceName} and run \`systemctl --user daemon-reload\``,
      };
    }
    const parsed = Number(cgroupRaw);
    return evalNumericCeiling(parsed, "cgroupfs");
  }

  // Slice inactive in cgroupfs: NeedDaemonReload=yes must fail closed so stale disk units never pass silently.
  if (needDaemonReload === "yes") {
    return {
      ok: false,
      code: "cli-memory-slice-insufficient",
      reason: `${sliceName} requires \`systemctl --user daemon-reload\` before limits take effect`,
      hint: "run `systemctl --user daemon-reload` and retry",
    };
  }

  const memMaxProp = props.get("MemoryMax") ?? "";
  if (
    memMaxProp === "" ||
    memMaxProp === "infinity" ||
    memMaxProp === "max" ||
    memMaxProp === "18446744073709551615"
  ) {
    return {
      ok: false,
      code: "cli-memory-slice-unbounded",
      reason: `${sliceName} MemoryMax is unbounded (${memMaxProp || "unset"})`,
      hint: `set MemoryMax=37G in ~/.config/systemd/user/${sliceName} and run \`systemctl --user daemon-reload\``,
    };
  }

  const parsedProp = Number(memMaxProp);
  if (!Number.isFinite(parsedProp)) {
    return {
      ok: false,
      code: "cli-memory-slice-unreadable",
      reason: `${sliceName} MemoryMax could not be parsed (${memMaxProp})`,
      hint: `verify MemoryMax in ~/.config/systemd/user/${sliceName}`,
    };
  }
  return evalNumericCeiling(parsedProp, "systemd-show");
}

export function verifyNativeHostScopeFromProc(hostPid: number, expectedIsolated: boolean): boolean {
  if (!expectedIsolated) return false;
  if (process.platform !== "linux") return true;
  if (!Number.isSafeInteger(hostPid) || hostPid <= 0) return false;
  try {
    const raw = readFileSync(`/proc/${hostPid}/cgroup`, "utf8");
    return raw.split(/\r?\n/).some((line) => /app\.slice\/h2a-native-.*\.scope$/.test(line.trim()));
  } catch {
    // If host /proc isn't inspectable from this test fixture, rely on ping.hostIsolated.
    return expectedIsolated;
  }
}

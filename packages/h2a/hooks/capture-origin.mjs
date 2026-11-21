#!/usr/bin/env node
/**
 * Hook classifier for captured messages (Lot 3b, spec §7.6 DS-9).
 *
 * Dependency-free. Invoked as:
 *   node capture-origin.mjs --cli <cli> [--text-key <key>]
 * with the hook payload on standard input.
 *
 * Always exits 0 and writes nothing to stdout so the host CLI is never blocked.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTrackBin } from "./track-bin.mjs";

export const INJECTION_LEDGER_WINDOW_MS = 120_000;

const INJECTION_PREFIXES = ["[h2a ", "[h2a-wake ", "[h2a restart]"];
const HEX64_RE = /^[0-9a-f]{64}$/;
const DEFAULT_TEXT_KEYS = ["prompt", "line", "message", "text", "input"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalise an injected or captured text according to the Lot 2 file contract:
 * CRLF and lone CR -> LF, trailing line breaks removed, surrounding whitespace
 * trimmed.
 */
export function normalizeInjectionText(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/g, "")
    .trim();
}

export function digestInjectionText(text) {
  return createHash("sha256").update(normalizeInjectionText(text), "utf8").digest("hex");
}

export function sessionKeyFileName(sessionKey) {
  return createHash("sha256").update(sessionKey, "utf8").digest("hex");
}

export function resolveInjectionLedgerDir(env = process.env) {
  const xdg = env?.XDG_STATE_HOME;
  const stateBase =
    typeof xdg === "string" && xdg.length > 0
      ? xdg
      : join(env?.HOME || homedir(), ".local", "state");
  return join(stateBase, "h2a", "injected");
}

export function readInjectionLedger(sessionKey, options = {}) {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) return [];
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? INJECTION_LEDGER_WINDOW_MS;
  const filePath = join(resolveInjectionLedgerDir(env), sessionKeyFileName(sessionKey));

  let raw;
  try {
    const st = lstatSync(filePath);
    if (!st.isFile() || st.isSymbolicLink()) return [];
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const entries = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const { at, digest } = parsed;
    if (
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      typeof digest !== "string" ||
      !HEX64_RE.test(digest)
    ) {
      continue;
    }
    const age = now - at;
    if (age >= 0 && age <= windowMs) {
      entries.push({ at, digest });
    }
  }
  return entries;
}

function getByDottedPath(obj, dottedPath) {
  if (!isPlainObject(obj) || typeof dottedPath !== "string" || dottedPath.length === 0) {
    return { found: false, value: undefined };
  }
  const parts = dottedPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
      return { found: false, value: undefined };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

function extractText(value, textKey) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractText(item, textKey);
      if (found !== undefined && found.length > 0) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;

  if (typeof textKey === "string" && textKey.length > 0) {
    if (Object.hasOwn(value, textKey)) {
      const direct = extractText(value[textKey]);
      if (direct !== undefined && direct.length > 0) return direct;
    }
    if (isPlainObject(value.params) && Object.hasOwn(value.params, textKey)) {
      const nested = extractText(value.params[textKey]);
      if (nested !== undefined && nested.length > 0) return nested;
    }
    return undefined;
  }

  for (const key of DEFAULT_TEXT_KEYS) {
    if (Object.hasOwn(value, key)) {
      const found = extractText(value[key]);
      if (found !== undefined && found.length > 0) return found;
    }
  }
  if (isPlainObject(value.params)) {
    const found = extractText(value.params);
    if (found !== undefined && found.length > 0) return found;
  }
  return undefined;
}

function selectQualificationEntry(cli, qualification) {
  if (!qualification) return undefined;
  if (Array.isArray(qualification.entries)) {
    return qualification.entries.find((entry) => isPlainObject(entry) && entry.cli === cli);
  }
  if (isPlainObject(qualification) && (qualification.cli === undefined || qualification.cli === cli)) {
    return qualification;
  }
  return undefined;
}

function matchesSubAgentMarker(payload, marker) {
  if (!isPlainObject(marker) || marker.source !== "payload") return false;
  const { found, value } = getByDottedPath(payload, marker.path);
  if (!found) return false;
  if (marker.rule === "present") return value !== undefined;
  if (marker.rule === "true") return value === true;
  if (marker.rule === "non-null") {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.length > 0;
    return true;
  }
  return false;
}

function hasInjectionPrefix(text) {
  if (typeof text !== "string") return false;
  const trimmedStart = text.trimStart();
  if (trimmedStart.length === 0) return false;
  return INJECTION_PREFIXES.some((prefix) => trimmedStart.startsWith(prefix));
}

function ledgerContainsDigest(ledger, digest, now) {
  if (!ledger) return false;
  if (typeof ledger === "function") return Boolean(ledger(digest, now));
  if (Array.isArray(ledger)) {
    return ledger.some(
      (entry) =>
        isPlainObject(entry) &&
        entry.digest === digest &&
        typeof entry.at === "number" &&
        Number.isFinite(entry.at) &&
        now - entry.at >= 0 &&
        now - entry.at <= INJECTION_LEDGER_WINDOW_MS,
    );
  }
  if (isPlainObject(ledger) && Array.isArray(ledger.entries)) {
    const windowMs = typeof ledger.windowMs === "number" ? ledger.windowMs : INJECTION_LEDGER_WINDOW_MS;
    const refNow = typeof ledger.now === "number" ? ledger.now : now;
    return ledger.entries.some(
      (entry) =>
        isPlainObject(entry) &&
        entry.digest === digest &&
        typeof entry.at === "number" &&
        Number.isFinite(entry.at) &&
        refNow - entry.at >= 0 &&
        refNow - entry.at <= windowMs,
    );
  }
  return false;
}

function matchesHumanSessionEvidence(payload, env, evidence) {
  if (!isPlainObject(evidence)) return false;
  const { source, name, interactiveValue } = evidence;
  if (typeof name !== "string" || name.length === 0 || typeof interactiveValue !== "string") {
    return false;
  }
  if (source === "env") {
    return Object.hasOwn(env, name) && env[name] === interactiveValue;
  }
  if (source === "payload") {
    const { found, value } = getByDottedPath(payload, name);
    return found && value !== null && value !== undefined && String(value) === interactiveValue;
  }
  return false;
}

/**
 * Pure origin classifier (spec §7.6 DS-9, Lot 1).
 *
 * Rules (first match wins):
 *   1. Unparsable payload -> doubtful
 *   2. REMOTE_JOB_ID or H2A_SESSION_CLASS=background -> background
 *   3. H2A_SESSION_CLASS present with value other than human|background -> doubtful
 *   4. CLI qualification sub-agent marker -> subagent
 *   5. Injection prefix ([h2a , [h2a-wake , [h2a restart]) or ledger digest within 120s -> injected
 *   6. H2A_SESSION_CLASS=human or CLI qualified interactive sign -> owner
 *   7. Anything else -> doubtful
 */
export function classifyOrigin({
  cli,
  payload,
  env = {},
  qualification,
  ledger,
  textKey,
  now = Date.now(),
} = {}) {
  // 1. Parse and validate payload.
  let parsedPayload;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (!isPlainObject(parsed)) {
        return { origin: "doubtful", reason: "hook payload JSON is not an object" };
      }
      parsedPayload = parsed;
    } catch {
      return { origin: "doubtful", reason: "unparsable hook payload" };
    }
  } else if (isPlainObject(payload)) {
    parsedPayload = payload;
  } else {
    return { origin: "doubtful", reason: "unparsable hook payload" };
  }

  const safeEnv = isPlainObject(env) ? env : {};

  // 2. Delegated job or background session class.
  if (typeof safeEnv.REMOTE_JOB_ID === "string" && safeEnv.REMOTE_JOB_ID.trim().length > 0) {
    return { origin: "background", reason: "REMOTE_JOB_ID is set" };
  }
  if (safeEnv.H2A_SESSION_CLASS === "background") {
    return { origin: "background", reason: "H2A_SESSION_CLASS is background" };
  }

  // 3. Session class present with an unknown value.
  if (
    Object.hasOwn(safeEnv, "H2A_SESSION_CLASS") &&
    safeEnv.H2A_SESSION_CLASS !== undefined &&
    safeEnv.H2A_SESSION_CLASS !== "human"
  ) {
    return { origin: "doubtful", reason: "H2A_SESSION_CLASS has an unrecognised value" };
  }

  const entry = selectQualificationEntry(cli, qualification);

  // 4. Sub-agent marker from the CLI's qualification entry.
  if (entry && matchesSubAgentMarker(parsedPayload, entry.subAgentMarker)) {
    return {
      origin: "subagent",
      reason: `sub-agent marker matched (${entry.subAgentMarker.path})`,
    };
  }

  // 5. Injection marker or ledger digest match within window.
  const effectiveTextKey =
    typeof textKey === "string" && textKey.length > 0
      ? textKey
      : typeof entry?.payloadTextKey === "string" && entry.payloadTextKey.length > 0
        ? entry.payloadTextKey
        : undefined;
  const text = extractText(parsedPayload, effectiveTextKey);
  if (typeof text === "string" && text.length > 0) {
    if (hasInjectionPrefix(text)) {
      return { origin: "injected", reason: "text starts with an h2a injection marker" };
    }
    const normalized = normalizeInjectionText(text);
    if (normalized.length > 0) {
      const digest = digestInjectionText(text);
      if (ledgerContainsDigest(ledger, digest, now)) {
        return { origin: "injected", reason: "text digest matches session injection ledger" };
      }
    }
  }

  // 6. Positive proof of a human session.
  if (safeEnv.H2A_SESSION_CLASS === "human") {
    return { origin: "owner", reason: "H2A_SESSION_CLASS is human" };
  }
  if (entry && matchesHumanSessionEvidence(parsedPayload, safeEnv, entry.humanSessionEvidence)) {
    return {
      origin: "owner",
      reason: `qualified interactive session evidence (${entry.humanSessionEvidence.source}:${entry.humanSessionEvidence.name})`,
    };
  }

  // 7. Anything else is doubtful.
  return { origin: "doubtful", reason: "no positive proof of a human session" };
}

function loadDefaultQualification() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const qualPath = join(here, "..", "fixtures", "capture-qualification.json");
    return JSON.parse(readFileSync(qualPath, "utf8"));
  } catch {
    return undefined;
  }
}

function resolveCurrentSessionKey(env = process.env) {
  const nativeName = env?.H2A_NATIVE_PTY_SESSION;
  if (typeof nativeName === "string" && nativeName.length > 0) {
    return `native:${nativeName}`;
  }
  const tmuxPane = env?.TMUX_PANE;
  if (typeof tmuxPane === "string" && tmuxPane.length > 0) {
    try {
      const res = spawnSync(
        "tmux",
        ["display-message", "-p", "-t", tmuxPane, "#{session_name}"],
        { encoding: "utf8", env, timeout: 500, maxBuffer: 4096 },
      );
      if (res.status === 0 && typeof res.stdout === "string") {
        const sessionName = res.stdout.trim();
        if (sessionName.length > 0) return `tmux:${sessionName}`;
      }
    } catch {
      // tmux unavailable; continue without ledger
    }
  }
  return undefined;
}

function parseCliArgs(argv) {
  let cli;
  let textKey;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cli" && i + 1 < argv.length) {
      cli = argv[++i];
    } else if (arg === "--text-key" && i + 1 < argv.length) {
      textKey = argv[++i];
    }
  }
  return { cli, textKey };
}

export function executeHook({
  cli,
  textKey,
  rawInput,
  env = process.env,
  qualification = loadDefaultQualification(),
  sessionKey = resolveCurrentSessionKey(env),
  ledger,
  now = Date.now(),
  resolveBin = resolveTrackBin,
} = {}) {
  let stderr = "";
  if (!cli || String(cli).trim().length === 0) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "capture-origin: missing required --cli argument; capture skipped.\n",
    };
  }
  try {
    const resolvedLedger =
      ledger !== undefined
        ? ledger
        : sessionKey
          ? readInjectionLedger(sessionKey, { env, now })
          : [];
    const classification = classifyOrigin({
      cli,
      payload: rawInput,
      env,
      qualification,
      ledger: resolvedLedger,
      textKey,
      now,
    });

    const trackBin = resolveBin({ env });
    if (!trackBin) {
      return {
        exitCode: 0,
        stdout: "",
        stderr:
          "capture-origin: unable to resolve Track binary (checked TRACK_BIN, ancestor node_modules/@sentropic/track, global npm prefix); capture skipped.\n",
        classification,
      };
    }

    const args = [
      trackBin,
      "capture",
      "add",
      "--cli",
      cli,
      "--origin",
      classification.origin,
    ];
    if (textKey) args.push("--text-key", textKey);
    args.push("--stdin");

    const res = spawnSync(process.execPath, args, {
      input: rawInput,
      encoding: "utf8",
      env,
      timeout: 4_000,
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (res.stderr) stderr += res.stderr;
    if (res.error) {
      stderr += `capture-origin: failed to invoke track: ${res.error.message}\n`;
    }
    return { exitCode: 0, stdout: "", stderr, classification };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 0,
      stdout: "",
      stderr: `capture-origin: unexpected error: ${msg}\n`,
    };
  }
}

function runHookCli() {
  const done = (message) => {
    if (message) process.stderr.write(`${message}\n`);
    process.exit(0);
  };

  const { cli, textKey } = parseCliArgs(process.argv.slice(2));
  if (!cli || cli.trim().length === 0) {
    return done("capture-origin: missing required --cli argument; capture skipped.");
  }

  let raw = "";
  const timer = setTimeout(() => done("capture-origin: stdin timeout; capture skipped."), 4_000);
  process.stdin.setEncoding("utf8");
  process.stdin.on("error", () => {
    clearTimeout(timer);
    done("capture-origin: unreadable stdin; capture skipped.");
  });
  process.stdin.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_048_576) {
      clearTimeout(timer);
      done("capture-origin: oversized payload; capture skipped.");
    }
  });
  process.stdin.on("end", () => {
    clearTimeout(timer);
    const outcome = executeHook({ cli, textKey, rawInput: raw, env: process.env });
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    process.exit(0);
  });
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runHookCli();
}

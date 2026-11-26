#!/usr/bin/env node
/**
 * Lot 3q hook qualification probe harness.
 *
 * Builds a throwaway project folder under TMPDIR (mode 0700), writes project-level
 * probe hooks only (mode 0700/0600, never touches user-level config or copies
 * credentials), sends a synthetic witness phrase, compares sent vs received UTF-8
 * bytes, and inspects payload fields, interactive vs headless diffs, sub-agent
 * differentiation, end-of-turn transcripts, and native question tool hooks.
 *
 * Packaging note (cyber C4): packages/h2a/package.json ships `scripts/` as a unit
 * because `scripts/qualify-host.mjs` (verified by `native-host-package.test.js`
 * inside the packed tarball) imports the sibling `qualification-*.mjs` helpers and
 * `scripts/mh-l1-package-prototype.mjs` copies `pkg.files` literally without `!`
 * negation globs. This harness is strictly opt-in, carries zero secrets or local
 * paths, and is never invoked automatically by `h2a` or package lifecycle hooks.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { withAgyStartQueueSync } from "../dist/runtime/onboarding-core.js";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAILER_RULES } from "./attribution-trailer-guard.mjs";

export const SANITIZER_ID = "packages/h2a/scripts/qualification-capture.mjs#sanitizeCaptureEvidence";
export const SANITIZER_VERSION = 1;
export const AGREED_WITNESS_BYTES = 92;

// Closed allow-list of non-sensitive mode/state environment flags.
// Path-, session-, proxy-, and header-bearing variables are deliberately excluded.
export const SAFE_ENV_ALLOWLIST = new Set([
  "TERM",
  "TERM_PROGRAM",
  "COLORTERM",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "H2A_SESSION_CLASS"
]);

const FORBIDDEN_RAW_KEYS = new Set([
  "receivedText",
  "rawPayload",
  "payload",
  "raw",
  "prompt",
  "lastUserInput",
  "user_prompt",
  "rawMessage",
  "ownerMessage",
  "messageText"
]);

// Value-based secret and PII patterns (aligned with packages/agent-stats/src/redact.ts
// and packages/h2a/scripts/attribution-trailer-guard.mjs).
const PEM_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const URL_CREDENTIALS_RE = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!<token>@)[^\s/@:]+:[^\s/@]+@/g;
const URL_QUERY_SECRET_RE =
  /([?&](?:access_token|id_token|refresh_token|api[_-]?key|token|secret|auth|sig|signature|key|password)=)(?!<token>(?:[&\s"'`<>]|$))[^&\s"'`<>]+/gi;
const ACCESS_URL_RE = /\b(?:https?|wss?):\/\/[^\s"'`<>]+/gi;
const AUTH_HEADER_RE =
  /\b(Authorization|Proxy-Authorization|X-Api-Key|Cookie|Set-Cookie)\s*:(?!\s*<token>(?:[\r\n"',;}]|$))\s*(?:(?:Bearer|Basic|Token)\s+)?[^\r\n"',;}]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRET_ENV_ASSIGNMENT_RE =
  /\b([A-Za-z][A-Za-z0-9_]*_(?:SECRETS?|PASSWORD|PASSWD|PWD|TOKEN|CREDENTIALS?|KEY)|SECRETS?|PASSWORD|PASSWD|TOKEN|CREDENTIALS?)\s*=(?!\s*<token>(?:[\s"',;}]|$))\s*\S+/gi;

const TOKEN_VALUE_RULES = Object.freeze([
  { id: "github-pat", pattern: /\bgh[posru]_[A-Za-z0-9]{20,}\b/g },
  { id: "github-fine-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: "provider-sk-key", pattern: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "gitlab-pat", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  { id: "hf-token", pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { id: "jwt-eyj", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "jwt-generic", pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "bearer-token", pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g },
  {
    id: "generic-secret-kv",
    pattern: /\b(?:token|secret|api[_-]?key|password|passwd|bearer)\s*[:=](?!\s*<token>(?:[\s"',;}]|$))\s*\S+/gi
  }
]);

const DASH_SLUG_HOME_RE = /-(?:home|Users)-[A-Za-z0-9._-]+(?=-)/g;
const GENERIC_HOME_POSIX_RE = /(^|[\s"'`(=:])\/(?:home|Users)\/[A-Za-z0-9._-]+/g;
const GENERIC_HOME_WIN_RE = /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g;
const CLAUDE_ENCODED_PROJECT_RE = /(\.claude\/projects\/)(?!<encoded-cwd>(?:\/|$))[^/\s"'`]+(?=\/)/g;
const TMP_THROWAWAY_RE =
  /(?:<tmp-dir>|(?:^|[\s"'`(=:])\/(?:tmp|var\/folders\/[^\s"'`]+|private\/var\/[^\s"'`]+))\/h2a-3q-[a-z0-9-]+/g;
const LOCAL_TMP_PREFIX_RE = /(^|[\s"'`(=:])\/(?:tmp|var\/folders|private\/var|run\/user)(?=\/|$)/g;
const AGY_BRAIN_UUID_RE =
  /(antigravity-cli\/brain\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CODEX_ROLLOUT_RE = /(\.codex\/sessions\/)\d{4}\/\d{2}\/\d{2}\/rollout-[^/\s"'`]+\.jsonl/g;
const GEMINI_CHAT_RE = /(\.gemini\/tmp\/)(?!<project>\/)[^/\s"'`]+(\/chats\/session-)[^/\s"'`]+(\.jsonl)/g;
const MUSE_SESSION_DATE_RE = /(muse\/sessions\/)\d{4}\/\d{2}\/\d{2}\//g;
const RAW_WITNESS_RE = /\bh2a-3q-witness-[0-9a-f]+[^\r\n]*/g;
const PRIVATE_IPV4_RE = /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168|127\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g;
const INTERNAL_HOST_RE =
  /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:internal|local|lan|corp|home\.arpa|svc\.cluster\.local)\b/gi;

function resetRegex(re) {
  re.lastIndex = 0;
  return re;
}

function replaceLiteral(text, needle, replacement) {
  if (!needle || needle === "/" || needle.length < 2) return text;
  const variants = new Set([needle]);
  if (needle.endsWith("/") && needle.length > 1) variants.add(needle.slice(0, -1));
  if (needle.includes("/")) variants.add(needle.replace(/\//g, "\\"));
  let out = text;
  for (const variant of variants) {
    if (variant && variant !== "/" && out.includes(variant)) {
      out = out.split(variant).join(replacement);
    }
  }
  return out;
}

export function sanitizeString(text, context = {}) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;

  // 1. Strip any raw witness phrase first.
  if (typeof context.witness === "string" && context.witness.length > 0) {
    out = out.split(context.witness).join("<witness>");
  }
  out = out.replace(resetRegex(RAW_WITNESS_RE), "<witness>");

  // 2. Replace explicit context paths longest-first so nested roots win over home/tmp.
  const homePath = context.home !== undefined ? context.home : homedir();
  const explicitPaths = [
    [context.vibeHome, "$VIBE_HOME"],
    [context.xdgDataHome, "$XDG_DATA_HOME"],
    [context.xdgConfigHome, "$XDG_CONFIG_HOME"],
    [context.xdgStateHome, "$XDG_STATE_HOME"],
    [context.xdgCacheHome, "$XDG_CACHE_HOME"],
    [context.projectDir, "<throwaway-project>"],
    [context.baseTmpDir, "<tmp-dir>"],
    [homePath, "~"]
  ]
    .filter(([p]) => typeof p === "string" && p.length > 1 && p !== "/")
    .sort((a, b) => b[0].length - a[0].length);

  for (const [rawPath, token] of explicitPaths) {
    out = replaceLiteral(out, rawPath, token);
  }

  // 3. Normalize Claude encoded project slugs, dash-slug homes, and generic user/tmp paths.
  out = out.replace(resetRegex(CLAUDE_ENCODED_PROJECT_RE), "$1<encoded-cwd>");
  out = out.replace(resetRegex(DASH_SLUG_HOME_RE), "~");
  out = out.replace(resetRegex(GENERIC_HOME_POSIX_RE), "$1~");
  out = out.replace(resetRegex(GENERIC_HOME_WIN_RE), "~");
  out = out.replace(resetRegex(TMP_THROWAWAY_RE), (match) => {
    const lead = match.match(/^[\s"'`(=:]/);
    return `${lead ? lead[0] : ""}<throwaway-project>`;
  });
  out = out.replace(resetRegex(LOCAL_TMP_PREFIX_RE), "$1<tmp-dir>");

  // 4. Normalize session/conversation IDs, UUIDs, and date-stamped transcript paths.
  const sessionToken = context.cli === "agy" ? "<conversationId>" : "<session_id>";
  if (Array.isArray(context.sessionIds)) {
    const sortedIds = [...new Set(context.sessionIds)]
      .filter((id) => typeof id === "string" && id.length >= 6)
      .sort((a, b) => b.length - a.length);
    for (const id of sortedIds) {
      out = out.split(id).join(sessionToken);
    }
  }
  out = out.replace(resetRegex(AGY_BRAIN_UUID_RE), "$1<conversationId>");
  out = out.replace(resetRegex(UUID_RE), sessionToken);
  out = out.replace(resetRegex(CODEX_ROLLOUT_RE), "$1YYYY/MM/DD/rollout-*.jsonl");
  out = out.replace(resetRegex(GEMINI_CHAT_RE), "$1<project>$2*$3");
  out = out.replace(resetRegex(MUSE_SESSION_DATE_RE), "$1YYYY/MM/DD/");

  // 5. Value-based secret, URL, PII, internal host, and attribution-trailer redaction.
  out = out.replace(resetRegex(PEM_PRIVATE_KEY_RE), "<redacted-private-key>");
  out = out.replace(resetRegex(URL_CREDENTIALS_RE), "$1<token>@");
  out = out.replace(resetRegex(URL_QUERY_SECRET_RE), "$1<token>");
  out = out.replace(resetRegex(ACCESS_URL_RE), "<url>");
  out = out.replace(resetRegex(AUTH_HEADER_RE), "$1: <token>");
  out = out.replace(resetRegex(EMAIL_RE), "<email>");
  out = out.replace(resetRegex(SECRET_ENV_ASSIGNMENT_RE), "$1=<token>");
  for (const rule of TOKEN_VALUE_RULES) {
    out = out.replace(resetRegex(rule.pattern), "<token>");
  }
  out = out.replace(resetRegex(PRIVATE_IPV4_RE), "<ip>");
  out = out.replace(resetRegex(INTERNAL_HOST_RE), "<internal-host>");

  const lines = out.split("\n");
  let changedLine = false;
  for (let i = 0; i < lines.length; i++) {
    if (TRAILER_RULES.some((rule) => rule.pattern.test(lines[i]))) {
      lines[i] = "<redacted-trailer>";
      changedLine = true;
    }
  }
  if (changedLine) out = lines.join("\n");

  return out;
}

export function filterSafeEnv(env, context = {}) {
  const out = {};
  if (!env || typeof env !== "object") return out;
  for (const key of Object.keys(env).sort()) {
    if (!SAFE_ENV_ALLOWLIST.has(key)) continue;
    const val = env[key];
    if (typeof val !== "string") continue;
    out[key] = sanitizeString(val, context);
  }
  return out;
}

export function sanitizeCaptureEvidence(value, context = {}) {
  if (typeof value === "string") {
    return sanitizeString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCaptureEvidence(item, context));
  }
  if (value !== null && typeof value === "object") {
    const nextCtx =
      typeof value.cli === "string" && !context.cli ? { ...context, cli: value.cli } : context;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined || FORBIDDEN_RAW_KEYS.has(key)) continue;
      if (key === "safeEnv" && val !== null && typeof val === "object" && !Array.isArray(val)) {
        out[key] = filterSafeEnv(val, nextCtx);
        continue;
      }
      if (key === "envDiffs" && Array.isArray(val)) {
        out[key] = val
          .filter((item) => item && typeof item === "object" && SAFE_ENV_ALLOWLIST.has(item.name))
          .map((item) => sanitizeCaptureEvidence(item, nextCtx));
        continue;
      }
      out[key] = sanitizeCaptureEvidence(val, nextCtx);
    }
    return out;
  }
  return value;
}

export function sanitizeEvidenceDocument(doc, context = {}) {
  const cleaned = sanitizeCaptureEvidence(doc, {
    cli: typeof doc?.cli === "string" ? doc.cli : undefined,
    ...context
  });
  const sanitization = {
    method: SANITIZER_ID,
    version: SANITIZER_VERSION
  };
  if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)) {
    // Deterministic key placement: place `sanitization` immediately after `probeHarness`
    // (or at the top if `probeHarness` is absent) without duplicating it.
    const ordered = {};
    let placed = false;
    for (const [k, v] of Object.entries(cleaned)) {
      if (k === "sanitization") continue;
      ordered[k] = v;
      if (k === "probeHarness") {
        ordered.sanitization = sanitization;
        placed = true;
      }
    }
    if (!placed) {
      ordered.sanitization = sanitization;
    }
    return ordered;
  }
  return cleaned;
}

export function scanEvidenceForLeaks(value, options = {}) {
  const findings = [];
  const homePath = options.home !== undefined ? options.home : homedir();

  const scanString = (str, path) => {
    if (resetRegex(RAW_WITNESS_RE).test(str)) findings.push({ path, rule: "raw-witness-text" });
    if (resetRegex(PEM_PRIVATE_KEY_RE).test(str)) findings.push({ path, rule: "pem-private-key" });
    if (resetRegex(URL_CREDENTIALS_RE).test(str)) findings.push({ path, rule: "url-credentials" });
    if (resetRegex(URL_QUERY_SECRET_RE).test(str)) findings.push({ path, rule: "url-query-secret" });
    if (resetRegex(ACCESS_URL_RE).test(str)) findings.push({ path, rule: "access-url" });
    if (resetRegex(AUTH_HEADER_RE).test(str)) findings.push({ path, rule: "auth-header" });
    if (resetRegex(EMAIL_RE).test(str)) findings.push({ path, rule: "email-address" });
    if (resetRegex(SECRET_ENV_ASSIGNMENT_RE).test(str)) findings.push({ path, rule: "secret-env-assignment" });
    for (const rule of TOKEN_VALUE_RULES) {
      if (resetRegex(rule.pattern).test(str)) findings.push({ path, rule: `secret-token:${rule.id}` });
    }
    if (
      (homePath && homePath.length > 1 && homePath !== "/" && str.includes(homePath)) ||
      resetRegex(GENERIC_HOME_POSIX_RE).test(str) ||
      resetRegex(GENERIC_HOME_WIN_RE).test(str) ||
      resetRegex(DASH_SLUG_HOME_RE).test(str)
    ) {
      findings.push({ path, rule: "home-path" });
    }
    if (resetRegex(LOCAL_TMP_PREFIX_RE).test(str)) findings.push({ path, rule: "local-tmp-path" });
    if (resetRegex(UUID_RE).test(str)) findings.push({ path, rule: "raw-uuid" });
    if (resetRegex(PRIVATE_IPV4_RE).test(str)) findings.push({ path, rule: "private-ipv4" });
    if (resetRegex(INTERNAL_HOST_RE).test(str)) findings.push({ path, rule: "internal-host" });
    for (const line of str.split("\n")) {
      for (const rule of TRAILER_RULES) {
        if (rule.pattern.test(line)) findings.push({ path, rule: `attribution-trailer:${rule.id}` });
      }
    }
  };

  const walk = (node, path) => {
    if (typeof node === "string") {
      scanString(node, path);
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, val] of Object.entries(node)) {
        const childPath = `${path}.${key}`;
        if (FORBIDDEN_RAW_KEYS.has(key)) {
          findings.push({ path: childPath, rule: "forbidden-raw-field" });
        }
        if (key === "witnessProbe" && val && typeof val === "object" && !Array.isArray(val)) {
          if (typeof val.sentBytes === "number" && val.sentBytes !== AGREED_WITNESS_BYTES) {
            findings.push({ path: `${childPath}.sentBytes`, rule: "non-agreed-witness-bytes" });
          }
          if (
            val.byteIdentical === true &&
            typeof val.receivedBytes === "number" &&
            val.receivedBytes !== AGREED_WITNESS_BYTES
          ) {
            findings.push({ path: `${childPath}.receivedBytes`, rule: "non-agreed-witness-bytes" });
          }
        }
        walk(val, childPath);
      }
    }
  };

  walk(value, "$");
  return { ok: findings.length === 0, findings };
}

export function sha256Utf8(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function buildWitnessPhrase(nonce = randomBytes(4).toString("hex")) {
  // Synthetic phrase covering ASCII, accented characters, a line break,
  // double/single quotes, a backslash, and multi-byte UTF-8 characters.
  return `h2a-3q-witness-${nonce}: café naïve "quoted" 'single' C:\\dir\\file\nline-2 € ✓ 日本語`;
}

export function compareWitnessBytes(sent, received) {
  const sentBuf = Buffer.from(sent, "utf8");
  const sentDigest = createHash("sha256").update(sentBuf).digest("hex");
  if (typeof received !== "string") {
    return {
      sentDigest,
      receivedDigest: null,
      byteIdentical: false,
      sentBytes: sentBuf.length,
      receivedBytes: 0,
      firstDiffByteOffset: 0
    };
  }
  const recvBuf = Buffer.from(received, "utf8");
  const receivedDigest = createHash("sha256").update(recvBuf).digest("hex");
  const byteIdentical = Buffer.compare(sentBuf, recvBuf) === 0;
  let firstDiffByteOffset = -1;
  if (!byteIdentical) {
    const minLen = Math.min(sentBuf.length, recvBuf.length);
    firstDiffByteOffset = minLen;
    for (let i = 0; i < minLen; i++) {
      if (sentBuf[i] !== recvBuf[i]) {
        firstDiffByteOffset = i;
        break;
      }
    }
  }
  return {
    sentDigest,
    receivedDigest,
    byteIdentical,
    sentBytes: sentBuf.length,
    receivedBytes: recvBuf.length,
    firstDiffByteOffset
  };
}

function getByPath(obj, dottedPath) {
  let cur = obj;
  for (const seg of dottedPath.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function inspectHookPayload(payload, sentWitness) {
  const isObj = payload !== null && typeof payload === "object" && !Array.isArray(payload);
  if (!isObj) {
    return {
      topLevelKeys: [],
      payloadTextKey: null,
      receivedText: typeof payload === "string" ? payload : null,
      payloadSessionKey: null,
      payloadFolderKey: null,
      payloadTranscriptKey: null,
      subAgentFields: [],
      toolName: null,
      toolInputKeys: []
    };
  }

  const topLevelKeys = Object.keys(payload).sort();
  const textCandidates = [
    "prompt",
    "lastUserInput",
    "user_prompt",
    "message",
    "text",
    "input",
    "line",
    "params.prompt",
    "params.text",
    "params.message"
  ];
  let payloadTextKey = null;
  let receivedText = null;
  for (const candidate of textCandidates) {
    const val = getByPath(payload, candidate);
    if (typeof val === "string") {
      if (sentWitness !== undefined && val === sentWitness) {
        payloadTextKey = candidate;
        receivedText = val;
        break;
      }
      if (payloadTextKey === null) {
        payloadTextKey = candidate;
        receivedText = val;
      }
    }
  }

  const sessionCandidates = ["session_id", "sessionId", "thread_id", "conversationId", "conversation_id"];
  const folderCandidates = ["cwd", "workspace", "workspace_dir", "workspacePaths", "working_directory", "project_dir"];
  const transcriptCandidates = ["transcript_path", "transcriptPath", "transcript", "session_file", "sessionFile"];

  const findKey = (candidates) => {
    for (const k of candidates) {
      const val = getByPath(payload, k);
      if (typeof val === "string" && val.length > 0) return k;
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") return k;
    }
    return null;
  };

  const subAgentFields = [];
  const subPattern = /subagent|parent|agent_id|agent_type|agent_transcript|is_subagent|caller|depth/i;
  for (const key of topLevelKeys) {
    if (subPattern.test(key)) {
      const val = payload[key];
      subAgentFields.push({
        path: key,
        valueType: val === null ? "null" : Array.isArray(val) ? "array" : typeof val,
        nonNull: val !== null && val !== undefined && val !== ""
      });
    }
  }

  const toolName =
    typeof payload.tool_name === "string"
      ? payload.tool_name
      : typeof payload.toolCall?.name === "string"
        ? payload.toolCall.name
        : typeof payload.tool === "string"
          ? payload.tool
          : null;
  const rawToolInput = payload.tool_input ?? payload.toolCall?.args ?? payload.arguments ?? null;
  const toolInputKeys =
    rawToolInput && typeof rawToolInput === "object" && !Array.isArray(rawToolInput)
      ? Object.keys(rawToolInput).sort()
      : [];

  return {
    topLevelKeys,
    payloadTextKey,
    receivedText,
    payloadSessionKey: findKey(sessionCandidates),
    payloadFolderKey: findKey(folderCandidates),
    payloadTranscriptKey: findKey(transcriptCandidates),
    subAgentFields,
    toolName,
    toolInputKeys
  };
}

export function diffInteractiveVsHeadless(interactiveRecord, headlessRecord, sanitizeContext = {}) {
  const envDiffs = [];
  const payloadDiffs = [];
  const iEnv = filterSafeEnv(interactiveRecord?.safeEnv ?? {}, sanitizeContext);
  const hEnv = filterSafeEnv(headlessRecord?.safeEnv ?? {}, sanitizeContext);
  const envKeys = [...new Set([...Object.keys(iEnv), ...Object.keys(hEnv)])].sort();
  for (const key of envKeys) {
    if (iEnv[key] !== hEnv[key]) {
      envDiffs.push({ name: key, interactiveValue: iEnv[key] ?? null, headlessValue: hEnv[key] ?? null });
    }
  }

  const iPayload = sanitizeCaptureEvidence(interactiveRecord?.payloadShape ?? {}, sanitizeContext);
  const hPayload = sanitizeCaptureEvidence(headlessRecord?.payloadShape ?? {}, sanitizeContext);
  const payloadKeys = [...new Set([...Object.keys(iPayload), ...Object.keys(hPayload)])].sort();
  for (const key of payloadKeys) {
    if (iPayload[key] !== hPayload[key]) {
      payloadDiffs.push({ name: key, interactiveValue: iPayload[key] ?? null, headlessValue: hPayload[key] ?? null });
    }
  }
  return { envDiffs, payloadDiffs };
}

export function scanTranscriptForWitness(filePaths, sentWitness, sanitizeContext = {}) {
  const sentDigest = sha256Utf8(sentWitness);
  const expanded = [];
  const collectFiles = (p) => {
    if (!p || !existsSync(p)) return;
    let stat;
    try {
      stat = statSync(p);
    } catch {
      return;
    }
    if (stat.isFile()) {
      expanded.push(p);
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(p, { withFileTypes: true })) {
        const child = join(p, entry.name);
        if (entry.isDirectory() && ["journal", "chunks"].includes(entry.name)) {
          collectFiles(child);
        } else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))) {
          expanded.push(child);
        }
      }
    }
  };
  for (const p of filePaths) collectFiles(p);

  const cleanPath = (p) => sanitizeString(p, sanitizeContext);

  let firstReadable = null;
  for (const filePath of expanded) {
    const raw = readFileSync(filePath, "utf8");
    const ext = filePath.endsWith(".jsonl") ? "jsonl" : filePath.endsWith(".json") ? "json" : "text";
    if (!firstReadable) firstReadable = { format: ext, filePath };
    if (raw.includes(sentWitness)) {
      return { readable: true, format: ext, witnessByteIdentical: true, sentDigest, matchedIn: cleanPath(filePath) };
    }
    // Check JSON-encoded strings inside JSON or JSONL lines.
    const foundStrings = [];
    const collectStrings = (node) => {
      if (typeof node === "string") {
        foundStrings.push(node);
      } else if (Array.isArray(node)) {
        for (const item of node) collectStrings(item);
      } else if (node && typeof node === "object") {
        for (const val of Object.values(node)) collectStrings(val);
      }
    };
    try {
      if (ext === "jsonl") {
        for (const line of raw.split(/\r?\n/)) {
          if (line.trim()) collectStrings(JSON.parse(line));
        }
      } else {
        collectStrings(JSON.parse(raw));
      }
    } catch {
      // Fall back to raw check already done above.
    }
    const exactMatch = foundStrings.find((s) => compareWitnessBytes(sentWitness, s).byteIdentical);
    if (exactMatch !== undefined) {
      return { readable: true, format: ext, witnessByteIdentical: true, sentDigest, matchedIn: cleanPath(filePath) };
    }
  }
  if (firstReadable) {
    return {
      readable: true,
      format: firstReadable.format,
      witnessByteIdentical: false,
      sentDigest,
      matchedIn: cleanPath(firstReadable.filePath)
    };
  }
  return { readable: false, format: null, witnessByteIdentical: false, sentDigest, matchedIn: null };
}

function buildProbeHookScript(recordPath, { cli, block = true } = {}) {
  const allowlistJson = JSON.stringify([...SAFE_ENV_ALLOWLIST]);
  const tokenRegexSources = JSON.stringify(TOKEN_VALUE_RULES.map((r) => [r.pattern.source, r.pattern.flags]));
  return `#!/usr/bin/env node
import { appendFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
const ALLOW = new Set(${allowlistJson});
const TOKEN_RES = (${tokenRegexSources}).map(([s, f]) => new RegExp(s, f));
const HOME = homedir();
function sanitizeEnvVal(val) {
  let out = val;
  if (HOME && HOME.length > 1 && HOME !== "/") out = out.split(HOME).join("~");
  out = out.replace(/(^|[\\s"'\`(=:])\\/(?:home|Users)\\/[A-Za-z0-9._-]+/g, "$1~");
  out = out.replace(/[A-Za-z]:\\\\Users\\\\[A-Za-z0-9._-]+/g, "~");
  out = out.replace(/\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b/gi, "<session_id>");
  out = out.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "<redacted-private-key>");
  out = out.replace(/\\b(?:https?|wss?):\\/\\/[^\\s"'\`<>]+/gi, "<url>");
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, "<email>");
  for (const re of TOKEN_RES) { re.lastIndex = 0; out = out.replace(re, "<token>"); }
  return out;
}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");
let parsed = null;
try { parsed = JSON.parse(raw || "{}"); } catch { parsed = raw; }
const safeEnv = {};
for (const k of Object.keys(process.env).sort()) {
  if (!ALLOW.has(k)) continue;
  const v = process.env[k];
  if (typeof v !== "string") continue;
  safeEnv[k] = sanitizeEnvVal(v);
}
const eventTag = process.argv[2] || "unknown";
const record = {
  at: new Date().toISOString(),
  eventTag,
  argv: process.argv.slice(2),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  safeEnv,
  rawByteLength: Buffer.byteLength(raw, "utf8"),
  payload: parsed
};
const recordPath = ${JSON.stringify(recordPath)};
appendFileSync(recordPath, JSON.stringify(record) + "\\n", { encoding: "utf8", mode: 0o600 });
chmodSync(recordPath, 0o600);
const shouldBlock = ${JSON.stringify(Boolean(block))};
if (shouldBlock && eventTag === "message") {
  if (${JSON.stringify(cli)} === "claude" || ${JSON.stringify(cli)} === "codex" || ${JSON.stringify(cli)} === "standin") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: "h2a-3q-probe-block" }) + "\\n");
  } else if (${JSON.stringify(cli)} === "gemini") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "h2a-3q-probe-block", continue: false, stopReason: "h2a-3q-probe-block" }) + "\\n");
  } else if (${JSON.stringify(cli)} === "agy") {
    process.stdout.write(JSON.stringify({ terminationBehavior: "terminate", errorMessage: { userMessage: "h2a-3q-probe-block" } }) + "\\n");
  } else if (${JSON.stringify(cli)} === "vibe") {
    process.stdout.write(JSON.stringify({ decision: "deny", reason: "h2a-3q-probe-block" }) + "\\n");
  } else if (${JSON.stringify(cli)} === "muse") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: "h2a-3q-probe-block" }) + "\\n");
  }
} else if (${JSON.stringify(cli)} === "vibe" && eventTag === "tool") {
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\\n");
} else if (${JSON.stringify(cli)} === "agy") {
  process.stdout.write("{}");
}
process.exit(0);
`;
}

function writeFileMode(filePath, content, mode) {
  writeFileSync(filePath, content, { encoding: "utf8", mode });
  chmodSync(filePath, mode);
}

export function writeProjectProbeHooks(cli, projectDir, { block = true } = {}) {
  const recordPath = join(projectDir, ".probe-records.jsonl");
  const hookScript = join(projectDir, ".probe-hook.mjs");
  writeFileMode(hookScript, buildProbeHookScript(recordPath, { cli, block }), 0o700);
  const cmd = (tag) => `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScript)} ${tag}`;
  let configPath;

  if (cli === "claude") {
    configPath = join(projectDir, ".claude", "settings.json");
    mkdirSync(join(projectDir, ".claude"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("message"), timeout: 10 }] }],
            PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("tool"), timeout: 10 }] }],
            SubagentStart: [{ hooks: [{ type: "command", command: cmd("subagent-start"), timeout: 10 }] }],
            Stop: [{ hooks: [{ type: "command", command: cmd("stop"), timeout: 10 }] }]
          }
        },
        null,
        2
      ) + "\n",
      0o600
    );
  } else if (cli === "codex") {
    configPath = join(projectDir, ".codex", "hooks.json");
    mkdirSync(join(projectDir, ".codex"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("message"), timeout: 10 }] }],
            PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("tool"), timeout: 10 }] }],
            Stop: [{ hooks: [{ type: "command", command: cmd("stop"), timeout: 10 }] }]
          }
        },
        null,
        2
      ) + "\n",
      0o600
    );
  } else if (cli === "gemini") {
    configPath = join(projectDir, ".gemini", "settings.json");
    mkdirSync(join(projectDir, ".gemini"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify(
        {
          hooks: {
            BeforeAgent: [{ hooks: [{ type: "command", command: cmd("message"), timeout: 10000 }] }],
            BeforeTool: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("tool"), timeout: 10000 }] }],
            AfterAgent: [{ hooks: [{ type: "command", command: cmd("stop"), timeout: 10000 }] }]
          }
        },
        null,
        2
      ) + "\n",
      0o600
    );
  } else if (cli === "vibe") {
    configPath = join(projectDir, ".vibe", "hooks.toml");
    mkdirSync(join(projectDir, ".vibe"), { recursive: true, mode: 0o700 });
    const escapeToml = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    writeFileMode(
      configPath,
      [
        "[[hooks]]",
        'name = "h2a-3q-probe-pre-agent"',
        'type = "pre_agent"',
        `command = "${escapeToml(cmd("message"))}"`,
        "timeout = 10",
        "",
        "[[hooks]]",
        'name = "h2a-3q-probe-post-agent"',
        'type = "post_agent"',
        `command = "${escapeToml(cmd("stop"))}"`,
        "timeout = 10",
        "",
        "[[hooks]]",
        'name = "h2a-3q-probe-pre-tool"',
        'type = "pre_tool"',
        `command = "${escapeToml(cmd("tool"))}"`,
        "timeout = 10",
        ""
      ].join("\n"),
      0o600
    );
  } else if (cli === "agy") {
    configPath = join(projectDir, ".agents", "hooks.json");
    mkdirSync(join(projectDir, ".agents"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify(
        {
          "h2a-3q-probe": {
            enabled: true,
            PreInvocation: [{ type: "command", command: cmd("message"), timeout: 10 }],
            PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("tool"), timeout: 10 }] }],
            Stop: [{ type: "command", command: cmd("stop"), timeout: 10 }]
          }
        },
        null,
        2
      ) + "\n",
      0o600
    );
  } else if (cli === "muse") {
    configPath = join(projectDir, ".muse", "hooks.json");
    mkdirSync(join(projectDir, ".muse"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("session-start"), timeout: 10 }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("message"), timeout: 10 }] }],
            PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: cmd("tool"), timeout: 10 }] }],
            Stop: [{ hooks: [{ type: "command", command: cmd("stop"), timeout: 10 }] }]
          }
        },
        null,
        2
      ) + "\n",
      0o600
    );
  } else if (cli === "standin") {
    configPath = join(projectDir, ".standin", "hooks.json");
    mkdirSync(join(projectDir, ".standin"), { recursive: true, mode: 0o700 });
    writeFileMode(
      configPath,
      JSON.stringify({ hooks: { UserPromptSubmit: [{ command: cmd("message") }] } }, null, 2) + "\n",
      0o600
    );
  } else {
    throw new Error(`Unsupported CLI for capture qualification probe: ${cli}`);
  }

  return { configPath, hookScript, recordPath };
}

export function readProbeRecords(recordPath) {
  if (!existsSync(recordPath)) return [];
  return readFileSync(recordPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function defaultInvocationFor(cli, witness, projectDir) {
  switch (cli) {
    case "claude":
      return { command: "claude", args: ["-p", "--output-format", "json", witness] };
    case "codex":
      return {
        command: "codex",
        args: ["exec", "--dangerously-bypass-hook-trust", "--skip-git-repo-check", witness]
      };
    case "gemini":
      return { command: "gemini", args: ["--skip-trust", "-p", witness] };
    case "vibe":
      return { command: "vibe", args: ["--trust", "-p", witness, "--max-turns", "1"] };
    case "agy":
      return { command: "agy", args: ["-p", witness] };
    case "muse":
      return {
        command: "muse",
        args: ["exec", "--provider", "echo", "--trust-workspace", "--workspace", projectDir, witness],
        extraEnv: {
          XDG_DATA_HOME: join(projectDir, ".muse-data"),
          XDG_STATE_HOME: join(projectDir, ".muse-state"),
          XDG_CACHE_HOME: join(projectDir, ".muse-cache")
        }
      };
    default:
      throw new Error(`No default CLI invocation for ${cli}`);
  }
}

export function buildSanitizedProbeSummary(result, sanitizeContext = {}) {
  const ctx = {
    cli: result.cli,
    home: homedir(),
    ...sanitizeContext
  };
  const rawSummary = {
    cli: result.cli,
    sanitization: {
      method: SANITIZER_ID,
      version: SANITIZER_VERSION
    },
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    recordCount: result.recordCount,
    eventTags: result.eventTags,
    comparison: result.comparison,
    inspected: result.inspected ? { ...result.inspected, receivedText: undefined } : null,
    safeEnv: result.safeEnv ?? {},
    safeEnvKeys: Object.keys(filterSafeEnv(result.safeEnv ?? {}, ctx)).sort(),
    toolRecords: result.toolRecords,
    transcript: result.transcript
  };
  return sanitizeCaptureEvidence(rawSummary, ctx);
}

export function runCaptureProbe({
  cli,
  witness = buildWitnessPhrase(),
  command,
  args,
  block = true,
  timeoutMs = 45000,
  keepWorkspace = false,
  baseTmpDir = process.env.TMPDIR || tmpdir(),
  transcriptPaths = [],
  env = process.env,
  startLockOptions
}) {
  const existedBefore = existsSync(baseTmpDir);
  mkdirSync(baseTmpDir, { recursive: true, mode: 0o700 });
  if (!existedBefore) {
    chmodSync(baseTmpDir, 0o700);
  }
  const projectDir = mkdtempSync(join(baseTmpDir, `h2a-3q-${cli}-`));
  chmodSync(projectDir, 0o700);
  try {
    if (cli === "codex") {
      spawnSync("git", ["init", "-q"], { cwd: projectDir, encoding: "utf8" });
    }
    const { configPath, hookScript, recordPath } = writeProjectProbeHooks(cli, projectDir, { block });
    const inv = command
      ? { command, args: args ?? [configPath, witness], extraEnv: {} }
      : defaultInvocationFor(cli, witness, projectDir);

    const effectiveEnv = {
      ...env,
      ...(inv.extraEnv ?? {}),
      H2A_3Q_PROJECT_DIR: projectDir,
      H2A_3Q_HOOK_CONFIG: configPath
    };

    const execSpawn = () =>
      spawnSync(inv.command, inv.args, {
        cwd: projectDir,
        env: effectiveEnv,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024
      });
    const run = cli === "agy"
      ? withAgyStartQueueSync(() => ({ result: execSpawn() }), {
          env: effectiveEnv,
          ...(startLockOptions ?? {})
        })
      : execSpawn();

    const records = readProbeRecords(recordPath);
    const messageRecord = records.find((r) => r.eventTag === "message") ?? records[0] ?? null;
    const inspected = messageRecord ? inspectHookPayload(messageRecord.payload, witness) : null;
    const comparison = compareWitnessBytes(witness, inspected?.receivedText ?? null);

    const observedSessionIds = [];
    if (inspected?.payloadSessionKey && messageRecord?.payload) {
      const sid = getByPath(messageRecord.payload, inspected.payloadSessionKey);
      if (typeof sid === "string" && sid.length > 0) observedSessionIds.push(sid);
    }

    const sanitizeContext = {
      cli,
      home: homedir(),
      projectDir,
      baseTmpDir,
      vibeHome: effectiveEnv.VIBE_HOME,
      xdgDataHome: effectiveEnv.XDG_DATA_HOME,
      xdgConfigHome: effectiveEnv.XDG_CONFIG_HOME,
      xdgStateHome: effectiveEnv.XDG_STATE_HOME,
      xdgCacheHome: effectiveEnv.XDG_CACHE_HOME,
      sessionIds: observedSessionIds,
      witness
    };

    const candidateTranscripts = [...transcriptPaths];
    if (inspected?.payloadTranscriptKey && messageRecord?.payload) {
      const p = getByPath(messageRecord.payload, inspected.payloadTranscriptKey);
      if (typeof p === "string") candidateTranscripts.unshift(p);
    }
    const transcript = scanTranscriptForWitness(candidateTranscripts, witness, sanitizeContext);

    const toolRecords = records.filter((r) => r.eventTag === "tool").map((r) => inspectHookPayload(r.payload));

    return {
      cli,
      configPath,
      hookScript,
      projectDir,
      sanitizeContext,
      exitCode: run.status,
      signal: run.signal ?? null,
      spawnError: run.error ? sanitizeString(run.error.message, sanitizeContext) : null,
      recordCount: records.length,
      eventTags: records.map((r) => r.eventTag),
      comparison,
      inspected,
      safeEnv: filterSafeEnv(messageRecord?.safeEnv ?? {}, sanitizeContext),
      toolRecords,
      transcript,
      records
    };
  } finally {
    if (!keepWorkspace) {
      if (cli === "vibe") {
        spawnSync("chmod", ["-R", "u+w", projectDir]);
      }
      rmSync(projectDir, { recursive: true, force: true });
    }
  }
}

function parseCliArgs(argv) {
  const opts = {
    cli: undefined,
    block: true,
    timeoutMs: 45000,
    keepWorkspace: false,
    out: undefined,
    sanitizeEvidence: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cli") opts.cli = argv[++i];
    else if (a === "--no-block") opts.block = false;
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--keep-workspace") opts.keepWorkspace = true;
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--witness") opts.witness = argv[++i];
    else if (a === "--sanitize-evidence") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        opts.sanitizeEvidence.push(argv[++i]);
      }
    }
  }
  return opts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.sanitizeEvidence.length > 0) {
    if (opts.out && opts.sanitizeEvidence.length !== 1) {
      process.stderr.write("--out may only be used with a single --sanitize-evidence input file\n");
      process.exit(2);
    }
    for (const inputPath of opts.sanitizeEvidence) {
      const parsed = JSON.parse(readFileSync(inputPath, "utf8"));
      const cleaned = sanitizeEvidenceDocument(parsed, {
        cli: typeof parsed?.cli === "string" ? parsed.cli : undefined,
        home: homedir()
      });
      const scan = scanEvidenceForLeaks(cleaned, { home: homedir() });
      if (!scan.ok) {
        process.stderr.write(
          `Refusing to write ${inputPath}: anti-leak scan failed (${scan.findings.map((f) => `${f.path}:${f.rule}`).join(", ")})\n`
        );
        process.exit(1);
      }
      const target = opts.out ?? inputPath;
      writeFileMode(target, JSON.stringify(cleaned, null, 2) + "\n", 0o600);
    }
    process.exit(0);
  }
  if (!opts.cli) {
    process.stderr.write(
      "Usage: node qualification-capture.mjs --cli <claude|codex|gemini|vibe|agy|muse> [--no-block] [--timeout ms] [--out file]\n" +
        "   or: node qualification-capture.mjs --sanitize-evidence <file...> [--out file]\n"
    );
    process.exit(2);
  }
  const result = runCaptureProbe(opts);
  const summary = buildSanitizedProbeSummary(result, result.sanitizeContext);
  const scan = scanEvidenceForLeaks(summary, { home: homedir() });
  if (!scan.ok) {
    process.stderr.write(
      `Refusing to emit probe summary: anti-leak scan failed (${scan.findings.map((f) => `${f.path}:${f.rule}`).join(", ")})\n`
    );
    process.exit(1);
  }
  const json = JSON.stringify(summary, null, 2) + "\n";
  if (opts.out) {
    writeFileMode(opts.out, json, 0o600);
  } else {
    process.stdout.write(json);
  }
}

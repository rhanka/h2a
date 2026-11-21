#!/usr/bin/env node
/**
 * Lot 3q hook qualification probe harness.
 *
 * Builds a throwaway project folder under TMPDIR, writes project-level probe
 * hooks only (never touches user-level config or copies credentials), sends a
 * synthetic witness phrase, compares sent vs received UTF-8 bytes, and inspects
 * payload fields, interactive vs headless diffs, sub-agent differentiation,
 * end-of-turn transcripts, and native question tool hooks.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_ENV_ALLOWLIST = new Set([
  "TERM",
  "TERM_PROGRAM",
  "COLORTERM",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_PROJECT_DIR",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "CODEX_WORKSPACE_ROOT",
  "GEMINI_CLI",
  "GEMINI_PROJECT_DIR",
  "VIBE_CWD",
  "AGY_SESSION",
  "MUSE_SESSION",
  "H2A_SESSION_CLASS"
]);

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASS|AUTH|CREDENTIAL|COOKIE|PRIVATE/i;

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

export function diffInteractiveVsHeadless(interactiveRecord, headlessRecord) {
  const envDiffs = [];
  const payloadDiffs = [];
  const iEnv = interactiveRecord?.safeEnv ?? {};
  const hEnv = headlessRecord?.safeEnv ?? {};
  const envKeys = [...new Set([...Object.keys(iEnv), ...Object.keys(hEnv)])].sort();
  for (const key of envKeys) {
    if (iEnv[key] !== hEnv[key]) {
      envDiffs.push({ name: key, interactiveValue: iEnv[key] ?? null, headlessValue: hEnv[key] ?? null });
    }
  }

  const iPayload = interactiveRecord?.payloadShape ?? {};
  const hPayload = headlessRecord?.payloadShape ?? {};
  const payloadKeys = [...new Set([...Object.keys(iPayload), ...Object.keys(hPayload)])].sort();
  for (const key of payloadKeys) {
    if (iPayload[key] !== hPayload[key]) {
      payloadDiffs.push({ name: key, interactiveValue: iPayload[key] ?? null, headlessValue: hPayload[key] ?? null });
    }
  }
  return { envDiffs, payloadDiffs };
}

export function scanTranscriptForWitness(filePaths, sentWitness) {
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

  let firstReadable = null;
  for (const filePath of expanded) {
    const raw = readFileSync(filePath, "utf8");
    const ext = filePath.endsWith(".jsonl") ? "jsonl" : filePath.endsWith(".json") ? "json" : "text";
    if (!firstReadable) firstReadable = { format: ext, filePath };
    if (raw.includes(sentWitness)) {
      return { readable: true, format: ext, witnessByteIdentical: true, sentDigest, matchedIn: filePath };
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
      return { readable: true, format: ext, witnessByteIdentical: true, sentDigest, matchedIn: filePath };
    }
  }
  if (firstReadable) {
    return {
      readable: true,
      format: firstReadable.format,
      witnessByteIdentical: false,
      sentDigest,
      matchedIn: firstReadable.filePath
    };
  }
  return { readable: false, format: null, witnessByteIdentical: false, sentDigest, matchedIn: null };
}

function buildProbeHookScript(recordPath, { cli, block = true } = {}) {
  const allowlistJson = JSON.stringify([...SAFE_ENV_ALLOWLIST]);
  return `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const ALLOW = new Set(${allowlistJson});
const SECRET = ${SECRET_ENV_PATTERN.toString()};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");
let parsed = null;
try { parsed = JSON.parse(raw || "{}"); } catch { parsed = raw; }
const safeEnv = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v !== "string" || SECRET.test(k)) continue;
  if (ALLOW.has(k) || /^(CLAUDE|CODEX|GEMINI|VIBE|AGY|MUSE)_/.test(k)) safeEnv[k] = v;
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
appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record) + "\\n", "utf8");
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

export function writeProjectProbeHooks(cli, projectDir, { block = true } = {}) {
  const recordPath = join(projectDir, ".probe-records.jsonl");
  const hookScript = join(projectDir, ".probe-hook.mjs");
  writeFileSync(hookScript, buildProbeHookScript(recordPath, { cli, block }), { mode: 0o755 });
  const cmd = (tag) => `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScript)} ${tag}`;
  let configPath;

  if (cli === "claude") {
    configPath = join(projectDir, ".claude", "settings.json");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
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
      ) + "\n"
    );
  } else if (cli === "codex") {
    configPath = join(projectDir, ".codex", "hooks.json");
    mkdirSync(join(projectDir, ".codex"), { recursive: true });
    writeFileSync(
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
      ) + "\n"
    );
  } else if (cli === "gemini") {
    configPath = join(projectDir, ".gemini", "settings.json");
    mkdirSync(join(projectDir, ".gemini"), { recursive: true });
    writeFileSync(
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
      ) + "\n"
    );
  } else if (cli === "vibe") {
    configPath = join(projectDir, ".vibe", "hooks.toml");
    mkdirSync(join(projectDir, ".vibe"), { recursive: true });
    const escapeToml = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    writeFileSync(
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
      ].join("\n")
    );
  } else if (cli === "agy") {
    configPath = join(projectDir, ".agents", "hooks.json");
    mkdirSync(join(projectDir, ".agents"), { recursive: true });
    writeFileSync(
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
      ) + "\n"
    );
  } else if (cli === "muse") {
    configPath = join(projectDir, ".muse", "hooks.json");
    mkdirSync(join(projectDir, ".muse"), { recursive: true });
    writeFileSync(
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
      ) + "\n"
    );
  } else if (cli === "standin") {
    configPath = join(projectDir, ".standin", "hooks.json");
    mkdirSync(join(projectDir, ".standin"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ hooks: { UserPromptSubmit: [{ command: cmd("message") }] } }, null, 2) + "\n"
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
  env = process.env
}) {
  mkdirSync(baseTmpDir, { recursive: true });
  const projectDir = mkdtempSync(join(baseTmpDir, `h2a-3q-${cli}-`));
  try {
    if (cli === "codex") {
      spawnSync("git", ["init", "-q"], { cwd: projectDir, encoding: "utf8" });
    }
    const { configPath, hookScript, recordPath } = writeProjectProbeHooks(cli, projectDir, { block });
    const inv = command
      ? { command, args: args ?? [configPath, witness], extraEnv: {} }
      : defaultInvocationFor(cli, witness, projectDir);

    const run = spawnSync(inv.command, inv.args, {
      cwd: projectDir,
      env: { ...env, ...(inv.extraEnv ?? {}), H2A_3Q_PROJECT_DIR: projectDir, H2A_3Q_HOOK_CONFIG: configPath },
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024
    });

    const records = readProbeRecords(recordPath);
    const messageRecord = records.find((r) => r.eventTag === "message") ?? records[0] ?? null;
    const inspected = messageRecord ? inspectHookPayload(messageRecord.payload, witness) : null;
    const comparison = compareWitnessBytes(witness, inspected?.receivedText ?? null);

    const candidateTranscripts = [...transcriptPaths];
    if (inspected?.payloadTranscriptKey && messageRecord?.payload) {
      const p = getByPath(messageRecord.payload, inspected.payloadTranscriptKey);
      if (typeof p === "string") candidateTranscripts.unshift(p);
    }
    const transcript = scanTranscriptForWitness(candidateTranscripts, witness);

    const toolRecords = records.filter((r) => r.eventTag === "tool").map((r) => inspectHookPayload(r.payload));

    return {
      cli,
      configPath,
      hookScript,
      exitCode: run.status,
      signal: run.signal ?? null,
      spawnError: run.error ? run.error.message : null,
      recordCount: records.length,
      eventTags: records.map((r) => r.eventTag),
      comparison,
      inspected,
      safeEnv: messageRecord?.safeEnv ?? {},
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
  const opts = { cli: undefined, block: true, timeoutMs: 45000, keepWorkspace: false, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cli") opts.cli = argv[++i];
    else if (a === "--no-block") opts.block = false;
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--keep-workspace") opts.keepWorkspace = true;
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--witness") opts.witness = argv[++i];
  }
  return opts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (!opts.cli) {
    process.stderr.write("Usage: node qualification-capture.mjs --cli <claude|codex|gemini|vibe|agy|muse> [--no-block] [--timeout ms] [--out file]\n");
    process.exit(2);
  }
  const result = runCaptureProbe(opts);
  const summary = {
    cli: result.cli,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    recordCount: result.recordCount,
    eventTags: result.eventTags,
    comparison: result.comparison,
    inspected: result.inspected ? { ...result.inspected, receivedText: undefined } : null,
    safeEnvKeys: Object.keys(result.safeEnv).sort(),
    toolRecords: result.toolRecords,
    transcript: result.transcript
  };
  const json = JSON.stringify(summary, null, 2) + "\n";
  if (opts.out) {
    writeFileSync(opts.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

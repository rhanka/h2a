#!/usr/bin/env node
/**
 * Claude Code PreToolUse guard for the packaged H2A plugin.
 *
 * The plugin owns its MCP lifecycle. An agent must use the h2a_* / track_*
 * tools and H2A skills, never invoke the `h2a` executable through Bash.
 * Exception (owner 08/11): `h2a doctor` (with flags such as --repair/--json,
 * optional redirects and safe filter pipes) is allowed.
 */
import process from "node:process";

function isManualH2aInvocation(command) {
  if (typeof command !== "string") return false;
  // Recognize a command word after normal shell separators, subshells, and
  // optional common launch wrappers / environment assignments. This
  // deliberately does not match prose such as `echo h2a`, paths such as
  // `./h2a`, or an unrelated binary containing h2a.
  return /(?:^|[;|&\n(`]\s*)(?:(?:env\s+)?(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)+|env\s+|command\s+(?:-\w+\s+)*|sudo\s+(?:(?:-[uCgprTtU]\s+\S+|-\w+)\s+)*)*h2a(?:\s|$)/m.test(command);
}

const SAFE_VALUE_TAKING_DOCTOR_FLAGS = new Set([
  "--root",
  "--scan",
  "--host",
  "--guard",
  "--lifecycle",
  "--workspace-scope"
]);

const SAFE_PIPE_COMMANDS = new Set([
  "jq",
  "head",
  "tail",
  "cat",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sed",
  "awk",
  "wc",
  "sort",
  "uniq",
  "tr",
  "cut",
  "less",
  "more",
  "tee",
  "column",
  "fmt",
  "fold"
]);

function stripAllowedRedirects(segment) {
  return segment
    .replace(/(?:^|\s)(?:[12]>&[12]|>&2)(?=\s|$)/g, " ")
    .replace(
      /(?:^|\s)(?:[12]|&)?>>?\s*(?:[a-zA-Z0-9_./:@~+-]+|"[^";|&$`<>()\n\r]*"|'[^'\n\r]*')(?=\s|$)/g,
      " "
    );
}

// Owner exception (08/11): allow `h2a doctor` (incl. --repair/--json and safe
// redirects/pipes) and nothing else.
export function isDoctorOnly(command) {
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (/[;\n\r`()]|\$\(|<\(|>\(|&&|\|\|/.test(trimmed)) return false;
  const stages = trimmed.split("|");
  const firstStage = stripAllowedRedirects(stages[0]).trim();
  if (/[<>&]/.test(firstStage)) return false;
  const tokens = firstStage.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens[0] !== "h2a" || tokens[1] !== "doctor") return false;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^--[a-zA-Z0-9][\w-]*=/.test(token)) {
      const value = token.slice(token.indexOf("=") + 1);
      if (!value || !/^(?:[a-zA-Z0-9_./:@~+-]+|"[^"]*"|'[^']*')$/.test(value)) return false;
      continue;
    }
    if (/^--[a-zA-Z0-9][\w-]*$/.test(token) || /^-[a-zA-Z0-9]$/.test(token)) {
      if (
        SAFE_VALUE_TAKING_DOCTOR_FLAGS.has(token) &&
        i + 1 < tokens.length &&
        !tokens[i + 1].startsWith("-")
      ) {
        const next = tokens[++i];
        if (!/^(?:[a-zA-Z0-9_./:@~+-]+|"[^"]*"|'[^']*')$/.test(next)) return false;
      }
      continue;
    }
    return false;
  }
  for (let s = 1; s < stages.length; s++) {
    const stage = stripAllowedRedirects(stages[s]).trim();
    if (!stage || /[<>&]/.test(stage)) return false;
    const stageTokens = stage.split(/\s+/).filter(Boolean);
    if (stageTokens.length === 0 || !SAFE_PIPE_COMMANDS.has(stageTokens[0])) return false;
    if (stageTokens.some((t) => t === "h2a" || /(?:^|[\\/])h2a$/.test(t))) return false;
  }
  return true;
}

let input = {};
try {
  const raw = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
  input = raw ? JSON.parse(raw) : {};
} catch {
  // A malformed hook payload must never block unrelated work.
  process.exit(0);
}

const command = input?.tool_input?.command;
if ((isManualH2aInvocation(command) || /^\s*h2a\s+doctor\b/.test(command ?? "")) && !isDoctorOnly(command)) {
  process.stderr.write(
    "Blocked manual `h2a` CLI use. This plugin owns H2A through its single MCP: use h2a_* or track_* tools, or the H2A skill instead.\n",
  );
  process.stdout.write(JSON.stringify({ decision: "block", reason: "Use the H2A MCP tools/skill; do not invoke the h2a CLI from Bash." }));
  process.exit(2);
}

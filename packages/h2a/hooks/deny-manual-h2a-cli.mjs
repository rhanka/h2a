#!/usr/bin/env node
/**
 * Claude Code PreToolUse guard for the packaged H2A plugin.
 *
 * The plugin owns its MCP lifecycle. An agent must use the h2a_* / track_*
 * tools and H2A skills, never invoke the `h2a` executable through Bash.
 */
import process from "node:process";

function isManualH2aInvocation(command) {
  if (typeof command !== "string") return false;
  // Recognize a command word after normal shell separators and optional common
  // launch wrappers. This deliberately does not match prose such as
  // `echo h2a`, paths such as `./h2a`, or an unrelated binary containing h2a.
  return /(?:^|[;|&\n]\s*)(?:(?:env\s+(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*)|command\s+|sudo\s+(?:-\w+\s+)*)*h2a(?:\s|$)/m.test(command);
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

if (isManualH2aInvocation(input?.tool_input?.command)) {
  process.stderr.write(
    "Blocked manual `h2a` CLI use. This plugin owns H2A through its single MCP: use h2a_* or track_* tools, or the H2A skill instead.\n",
  );
  process.stdout.write(JSON.stringify({ decision: "block", reason: "Use the H2A MCP tools/skill; do not invoke the h2a CLI from Bash." }));
  process.exit(2);
}

#!/usr/bin/env node
/**
 * Claude Code / Codex PreToolUse guard for the packaged H2A plugin.
 *
 * Blocks Bash invocations of `git commit` or `gh pr create|edit|merge` that
 * carry AI attribution / co-authorship trailers — even if `--no-verify` is
 * passed or the target repo has not yet installed the local commit-msg hook.
 */
import process from "node:process";
import { scanBashCommand } from "../scripts/attribution-trailer-guard.mjs";

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
const result = scanBashCommand(command);
if (!result.ok) {
  const rules = [...new Set(result.matches.map((m) => m.rule))].join(", ");
  process.stderr.write(
    `Blocked commit/PR carrying forbidden AI attribution trailer (${rules}). Remove Co-Authored-By / Claude-Session / Generated with lines and retry.\n`,
  );
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `Forbidden AI attribution trailer (${rules}) in git commit / gh pr command. Remove it before retrying.`,
    }),
  );
  process.exit(2);
}

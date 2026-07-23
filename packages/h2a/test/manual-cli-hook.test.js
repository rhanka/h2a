import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../hooks/deny-manual-h2a-cli.mjs", import.meta.url));
function invoke(command) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_input: { command } }), encoding: "utf8"
  });
}

test("plugin PreToolUse hook blocks direct H2A CLI invocations", () => {
  for (const command of ["h2a connect", "env X=1 h2a install-skills", "sudo h2a mcp-serve", "true; h2a status"]) {
    const r = invoke(command);
    assert.equal(r.status, 2, command);
    assert.match(r.stderr, /Blocked manual `h2a` CLI use/);
  }
});

test("plugin PreToolUse hook permits unrelated Bash work and prose", () => {
  for (const command of ["git status", "echo h2a", "./h2a connect", "company-h2a status"]) {
    assert.equal(invoke(command).status, 0, command);
  }
});

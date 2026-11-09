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

test("plugin PreToolUse hook allows h2a doctor with flags, redirects, and safe pipes", () => {
  const allowed = [
    "h2a doctor",
    "  h2a doctor  ",
    "h2a doctor --repair",
    "h2a doctor --json",
    "h2a doctor --repair --json",
    "h2a doctor --repair --dry-run --host claude --root /tmp/h2a-bus",
    "h2a doctor --root=/tmp/h2a-bus --scan=/tmp/scan --prune",
    "h2a doctor --repair 2>&1",
    "h2a doctor --repair > /tmp/doctor.json 2>&1",
    "h2a doctor --repair 2>/dev/null | jq .",
    "h2a doctor --json | head -n 20"
  ];
  for (const command of allowed) {
    const r = invoke(command);
    assert.equal(r.status, 0, `expected allowed for: ${command} (stderr: ${r.stderr})`);
  }
});

test("plugin PreToolUse hook blocks chained, prefixed, or unsafe h2a doctor forms", () => {
  const blocked = [
    "h2a doctor; h2a send",
    "h2a doctor && rm -rf /tmp/x",
    "h2a doctor || h2a status",
    "h2a doctor & h2a send",
    "h2a doctor\nh2a send",
    "h2a doctor | h2a send",
    "h2a doctor | sh",
    "h2a doctor > /tmp/out; h2a send",
    "h2a doctor > /tmp/out && rm /tmp/out",
    "h2a doctor --root $(h2a send)",
    "h2a doctor --root `id`",
    "env X=1 h2a doctor",
    "X=1 h2a doctor",
    "X=1 h2a send",
    "sudo h2a doctor",
    "sudo -u root h2a doctor --repair",
    "command h2a doctor",
    "h2a doctor send"
  ];
  for (const command of blocked) {
    const r = invoke(command);
    assert.equal(r.status, 2, `expected blocked for: ${command}`);
    assert.match(r.stderr, /Blocked manual `h2a` CLI use/);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../dist/index.js";

// Wake is essential to coordination → `h2a host setup` renders a coordination-ready
// snippet by default: mcp-serve --auto-open --auto-upgrade --wake auto. Opting out
// (--no-wake) is a conscious, warned choice.

function cap() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) },
    cwd: () => process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("host setup: coordination-ready by default (--auto-open --auto-upgrade --wake auto)", () => {
  for (const host of ["claude", "codex"]) {
    const s = cap();
    const rc = runCli(["host", "setup", "--host", host, "--print"], s);
    assert.equal(rc, 0, `exit 0 expected (stderr: ${s.stderrText})`);
    const out = s.stdoutText;
    assert.ok(out.includes("--auto-open"), `${host}: --auto-open by default`);
    assert.ok(out.includes("--auto-upgrade"), `${host}: --auto-upgrade by default`);
    assert.ok(out.includes("--wake") && out.includes("auto"), `${host}: --wake auto by default`);
    assert.ok(out.includes(`"--host"`) && out.includes(`"${host}"`), `${host}: --host ${host}`);
  }
});

test("host setup --no-wake: drops --wake and warns", () => {
  const s = cap();
  const rc = runCli(["host", "setup", "--host", "claude", "--print", "--no-wake"], s);
  assert.equal(rc, 0, `exit 0 expected (stderr: ${s.stderrText})`);
  assert.ok(!s.stdoutText.includes("--wake"), "no --wake under --no-wake");
  assert.ok(s.stdoutText.includes("--auto-open"), "still joins the bus");
  assert.match(s.stderrText, /no-wake/i, "a warning is printed");
});

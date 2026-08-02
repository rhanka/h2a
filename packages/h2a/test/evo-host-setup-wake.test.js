import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../dist/index.js";

function healthyHostInstallations() {
  return {
    ok: true,
    hosts: [
      { host: "claude", ok: true, unrepaired: [] },
      { host: "codex", ok: true, unrepaired: [] }
    ]
  };
}

// Wake is essential to coordination → `h2a host setup` renders a coordination-ready
// snippet by default: mcp-serve --auto-open --auto-upgrade --wake local-tmux.
// local-tmux (not auto) wakes in a tmux pane and no-ops outside it (auto would
// fall through to headless and spawn a new agent). Opt out with --no-wake.

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

test("host setup: coordination-ready by default (--auto-open --auto-upgrade --wake local-tmux)", () => {
  for (const host of ["claude", "codex"]) {
    const s = cap();
    const rc = runCli(["host", "setup", "--host", host, "--print"], s, {
      doctorHostInstallations: healthyHostInstallations
    });
    assert.equal(rc, 0, `exit 0 expected (stderr: ${s.stderrText})`);
    const out = s.stdoutText;
    assert.ok(out.includes("--auto-open"), `${host}: --auto-open by default`);
    assert.ok(out.includes("--auto-upgrade"), `${host}: --auto-upgrade by default`);
    assert.ok(out.includes("--wake") && out.includes("local-tmux"), `${host}: --wake local-tmux by default`);
    assert.ok(out.includes(`"--host"`) && out.includes(`"${host}"`), `${host}: --host ${host}`);
  }
});

test("host setup --no-wake: drops --wake and warns", () => {
  const s = cap();
  const rc = runCli(["host", "setup", "--host", "claude", "--print", "--no-wake"], s, {
    doctorHostInstallations: healthyHostInstallations
  });
  assert.equal(rc, 0, `exit 0 expected (stderr: ${s.stderrText})`);
  assert.ok(!s.stdoutText.includes("--wake"), "no --wake under --no-wake");
  assert.ok(s.stdoutText.includes("--auto-open"), "still joins the bus");
  assert.match(s.stderrText, /no-wake/i, "a warning is printed");
});

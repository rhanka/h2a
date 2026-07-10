import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

function connect(host) {
  const dir = mkdtempSync(join(tmpdir(), `h2a-connect-${host}-`));
  const root = join(dir, ".h2a");
  try {
    const streams = captureStreams(dir);
    const rc = runCli(["connect", "--host", host, "--root", root], streams);
    return { rc, streams, dir, root };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

// Regression: hermes/opencode are in H2A_CLI_HOSTS but `h2a connect --host` used
// to reject them, and its ternary descriptor chain silently fell through to the
// agy snippet for any non-{codex,claude,gemini} host. Every supported host must
// render ITS OWN setup snippet.
for (const [host, hintRe, exampleRe] of [
  ["hermes", /hermes/i, /\.hermes/],
  ["opencode", /opencode/i, /opencode/]
]) {
  test(`h2a connect --host ${host} succeeds and renders the ${host} setup snippet (not agy)`, () => {
    const { rc, streams, dir } = connect(host);
    try {
      assert.equal(rc, 0, streams.stderrText);
      const summary = JSON.parse(streams.stdoutText);
      assert.equal(summary.ok, true);
      assert.equal(summary.host, host);
      const setup = summary.steps.find((s) => s.step === "host-setup");
      assert.ok(setup, "host-setup step present");
      assert.ok(setup.snippet.mcpServers.h2a, "renders mcpServers.h2a");
      // The snippet is THIS host's — its path hint/example name the host…
      assert.match(setup.pathHint, hintRe, `pathHint must mention ${host}`);
      assert.match(setup.pathExample, exampleRe, `pathExample must point at ${host}`);
      // …and never the agy (Antigravity) config slot from the old fall-through.
      assert.doesNotMatch(setup.pathHint, /Antigravity|mcp_config\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("h2a connect still rejects a truly unknown host", () => {
  const { rc, streams, dir } = connect("borg");
  try {
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /unknown --host "borg"/);
    assert.match(streams.stderrText, /hermes, opencode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

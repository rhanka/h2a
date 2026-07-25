// Gap section 1 of the session-exposure feed contract (ratified 2026-07-24):
// InstanceDescriptor.capabilities was structurally always [] because
// identity/live.ts ensureRegistered hardcoded it. It is now threaded through
// ResolveLiveIdentityInput -> ensureRegistered, defaulted by the caller from a
// CLOSED vocabulary.
//
// The invariant these tests protect is as much about what capabilities are NOT
// as about what they are: a DECLARED, NON-AUTHORITATIVE DISPLAY LIST. Nothing
// may treat a capability string as permission (ratification condition 3), so
// the tests pin the closed-vocabulary filter (free text cannot get in) and the
// end-to-end path from `h2a connect` to the descriptor a browser would render.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_CLI_DECLARED_CAPABILITIES,
  H2A_DECLARED_CAPABILITIES,
  buildInstanceDescriptors,
  createLocalStore,
  runCli,
  sanitizeDeclaredCapabilities
} from "../dist/index.js";

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

function connect() {
  const cwd = mkdtempSync(join(tmpdir(), "h2a-caps-ws-"));
  const rootParent = mkdtempSync(join(tmpdir(), "h2a-caps-root-"));
  const root = join(rootParent, ".h2a");
  const previous = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = `caps-${Date.now()}`;
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(["connect", "--root", root, "--host", "claude"], streams);
    assert.equal(rc, 0, streams.stderrText);
    return {
      root,
      summary: JSON.parse(streams.stdoutText),
      cleanup: () => {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(rootParent, { recursive: true, force: true });
      }
    };
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = previous;
  }
}

test("sanitizeDeclaredCapabilities keeps only the closed vocabulary", () => {
  assert.deepEqual(sanitizeDeclaredCapabilities(["h2a.session", "h2a.mcp"]), [
    "h2a.session",
    "h2a.mcp"
  ]);
  // Free text, an injected privilege claim, and duplicates are all dropped.
  assert.deepEqual(
    sanitizeDeclaredCapabilities(["h2a.session", "h2a.session", "admin", "*", "can.spend.money"]),
    ["h2a.session"]
  );
  assert.deepEqual(sanitizeDeclaredCapabilities([]), []);
  assert.deepEqual(sanitizeDeclaredCapabilities(undefined), []);
});

test("sanitizeDeclaredCapabilities normalizes to vocabulary order", () => {
  assert.deepEqual(sanitizeDeclaredCapabilities(["h2a.mcp", "h2a.session"]), [
    "h2a.session",
    "h2a.mcp"
  ]);
});

test("the CLI's declared default is a subset of the closed vocabulary", () => {
  for (const capability of H2A_CLI_DECLARED_CAPABILITIES) {
    assert.ok(
      H2A_DECLARED_CAPABILITIES.includes(capability),
      `${capability} is outside the closed vocabulary`
    );
  }
});

test("h2a connect records the declared capabilities on the registration", () => {
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const registration = store.findInstance(summary.instance);
    assert.ok(registration, "expected the connect to mint a registration");
    assert.deepEqual(registration.capabilities, [...H2A_CLI_DECLARED_CAPABILITIES]);
  } finally {
    cleanup();
  }
});

test("the declared capabilities reach the InstanceDescriptor a browser would see", () => {
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const descriptors = buildInstanceDescriptors({
      asOf: Date.parse("2026-07-24T12:00:00.000Z"),
      sessions: [],
      registrations: store.listInstances()
    });
    const mine = descriptors.find((d) => d.instanceId === summary.instance);
    assert.ok(mine, "expected a descriptor for the connected instance");
    assert.deepEqual(mine.capabilities, [...H2A_CLI_DECLARED_CAPABILITIES]);
    // Still display-only: no path, no key material rides along.
    assert.ok(!JSON.stringify(mine).includes(root));
  } finally {
    cleanup();
  }
});

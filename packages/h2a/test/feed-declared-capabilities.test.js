// Gap section 1 of the session-exposure feed contract (ratified 2026-07-24),
// as re-shaped by the architect's SPLIT ruling of 2026-07-25.
//
// The original attempt threaded the display vocabulary into
// `H2AActorRegistration.capabilities`. That field is AUTHORITY-BEARING: it is
// the subagent capability CEILING (`subagents.ts` -> `capabilities-exceed-parent`,
// a subset check over the whole field) and it feeds `canAttestComprehension`.
// Writing a display list there widened a privilege ceiling as a side effect of a
// display feature.
//
// So the two concerns are now structurally separate:
//   - `capabilities`         -> authority, left exactly as it was pre-PR ([])
//   - `declaredCapabilities` -> the declared, non-authoritative display list
// and the feed reads ONLY the latter.
//
// Note the invariant that does NOT work, and is therefore not relied on: "no
// display-vocabulary member may ever equal a right string". In the exact failure
// probed here that invariant HELD - none of h2a.session / h2a.mcp /
// h2a.subagents is a right string - and the ceiling widened anyway, because the
// check is a SUBSET over the whole field, not a lookup of specific strings.
// Separation of fields is the mitigation; string choice is not.

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
  sanitizeDeclaredCapabilities,
  subagentAddress
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
  process.env.CLAUDE_CODE_SESSION_ID = `caps-${Date.now()}-${Math.random()}`;
  try {
    const streams = captureStreams(cwd);
    const rc = runCli(["connect", "--root", root, "--host", "claude"], streams);
    assert.equal(rc, 0, streams.stderrText);
    return {
      root,
      cwd,
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

test("sanitizeDeclaredCapabilities is an ALLOWLIST intersection with the vocabulary", () => {
  assert.deepEqual(sanitizeDeclaredCapabilities(["h2a.session", "h2a.mcp"]), [
    "h2a.session",
    "h2a.mcp"
  ]);
  // Free text, an injected privilege claim, and duplicates are all dropped
  // because they are not MEMBERS - not because anything looks for bad patterns.
  assert.deepEqual(
    sanitizeDeclaredCapabilities(["h2a.session", "h2a.session", "admin", "*", "can.spend.money"]),
    ["h2a.session"]
  );
  assert.deepEqual(sanitizeDeclaredCapabilities([]), []);
  assert.deepEqual(sanitizeDeclaredCapabilities(undefined), []);
  // Every survivor is a vocabulary member: that is the whole contract.
  for (const value of sanitizeDeclaredCapabilities(["h2a.mcp", "nope", "h2a.subagents"])) {
    assert.ok(H2A_DECLARED_CAPABILITIES.includes(value));
  }
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

test("h2a connect writes declaredCapabilities and leaves capabilities EMPTY", () => {
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const registration = store.findInstance(summary.instance);
    assert.ok(registration, "expected the connect to mint a registration");
    assert.deepEqual(registration.declaredCapabilities, [...H2A_CLI_DECLARED_CAPABILITIES]);
    // THE priority invariant: the authority-bearing field is untouched, exactly
    // as it was before this workstream.
    assert.deepEqual(
      registration.capabilities,
      [],
      "capabilities is the subagent ceiling and the attestation right: it must stay empty"
    );
  } finally {
    cleanup();
  }
});

test("declaredCapabilities changes NO subagent-ceiling outcome", () => {
  // This is the regression the merged display list caused: with the vocabulary
  // written into `capabilities`, a child claiming h2a.mcp became a SUBSET of its
  // parent and was accepted. With the split it is refused again, exactly as
  // before the PR. If the two fields are ever re-merged, this test fails.
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const parent = store.findInstance(summary.instance);
    assert.deepEqual(parent.declaredCapabilities, [...H2A_CLI_DECLARED_CAPABILITIES]);

    assert.throws(
      () =>
        store.registerSubagent({
          id: subagentAddress(summary.instance, "child"),
          parentInstance: summary.instance,
          name: "child",
          // A value that IS in the declared display vocabulary - the point being
          // that declaring it for display must not grant it as authority.
          capabilities: ["h2a.mcp"],
          createdAt: new Date().toISOString()
        }),
      /capabilities-exceed-parent/,
      "a display declaration must never widen the subagent ceiling"
    );

    // Same through the CLI surface, which is how it was originally observed.
    const streams = captureStreams(process.cwd());
    const rc = runCli(
      [
        "subagent",
        "register",
        "--root",
        root,
        "--parent",
        summary.instance,
        "--name",
        "child2",
        "--capabilities",
        "h2a.mcp"
      ],
      streams
    );
    assert.notEqual(rc, 0, "CLI subagent register must still refuse");
    assert.match(streams.stderrText, /capabilities-exceed-parent/);
  } finally {
    cleanup();
  }
});

test("declaredCapabilities changes NO attestation-right outcome", () => {
  // canAttestComprehension reads `capabilities` and looks for the
  // attester-comprehension right. A declared display list must not grant it.
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const registration = store.findInstance(summary.instance);
    assert.ok(
      !registration.capabilities.includes("attester-comprehension"),
      "the attestation right must not have been granted by a display declaration"
    );
    assert.equal(registration.capabilities.length, 0);
  } finally {
    cleanup();
  }
});

test("the declared list reaches the InstanceDescriptor a browser would see", () => {
  const { root, summary, cleanup } = connect();
  try {
    const store = createLocalStore({ root });
    const descriptors = buildInstanceDescriptors({
      asOf: Date.parse("2026-07-25T12:00:00.000Z"),
      sessions: [],
      registrations: store.listInstances()
    });
    const mine = descriptors.find((d) => d.instanceId === summary.instance);
    assert.ok(mine, "expected a descriptor for the connected instance");
    assert.deepEqual(mine.declaredCapabilities, [...H2A_CLI_DECLARED_CAPABILITIES]);
    // The descriptor exposes no field named `capabilities` at all: the wire name
    // itself carries the non-authoritative semantic.
    assert.equal(Object.hasOwn(mine, "capabilities"), false);
    assert.ok(!JSON.stringify(mine).includes(root));
  } finally {
    cleanup();
  }
});

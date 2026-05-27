import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

function run(argv) {
  let stdout = "";
  let stderr = "";
  const rc = runCli(argv, {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) }
  });
  return { rc, stdout, stderr };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-nhi-offboard-"));
  const root = join(dir, ".h2a");
  run(["init", "--root", root]);
  // Parent instance (AGENTS) with one key + one active subagent.
  const { publicKey } = generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  run([
    "register",
    "--root",
    root,
    "--json",
    JSON.stringify({
      id: "agent-001",
      instance: "agent-001",
      roles: ["AGENTS"],
      scopes: ["scope:x"],
      capabilities: ["research"],
      endpoints: [],
      publicKeys: [pubPem],
      acceptedPolicies: [],
      createdAt: "2026-05-27T00:00:00.000Z"
    })
  ]);
  run(["subagent", "register", "--root", root, "--parent", "agent-001", "--name", "r", "--capabilities", "research"]);
  return { dir, root };
}

test("nhi offboard revokes keys + subagents and is idempotent", () => {
  const { dir, root } = setup();
  try {
    // Pre-state: 1 active key, 1 active subagent.
    const before = JSON.parse(run(["nhi", "report", "--root", root]).stdout);
    assert.equal(before.summary.activeKeys, 1);
    assert.equal(before.summary.activeSubagents, 1);

    const first = run(["nhi", "offboard", "--root", root, "--instance", "agent-001", "--reason", "test"]);
    assert.equal(first.rc, 0, first.stderr);
    const t1 = JSON.parse(first.stdout);
    assert.equal(t1.ok, true);
    assert.equal(t1.instance, "agent-001");
    assert.equal(t1.reason, "test");
    assert.equal(t1.revokedKeys, 1);
    assert.deepEqual(t1.revokedSubagents, ["agent-001~r"]);

    // Effects visible in posture: NHI4 now flags the keyless instance.
    const after = JSON.parse(run(["nhi", "report", "--root", root]).stdout);
    assert.equal(after.summary.activeKeys, 0);
    assert.equal(after.summary.activeSubagents, 0);
    const nhi4 = after.findings.find((f) => f.risk === "NHI4");
    assert.equal(nhi4.severity, "high");
    assert.ok(nhi4.subjects.includes("agent-001"));

    // Idempotent: a second offboard revokes nothing more.
    const second = JSON.parse(run(["nhi", "offboard", "--root", root, "--instance", "agent-001"]).stdout);
    assert.equal(second.revokedKeys, 0);
    assert.deepEqual(second.revokedSubagents, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nhi offboard on an unregistered instance exits 2", () => {
  const { dir, root } = setup();
  try {
    const r = run(["nhi", "offboard", "--root", root, "--instance", "ghost:999"]);
    assert.equal(r.rc, 2);
    assert.match(r.stderr, /not registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nhi offboard requires --instance", () => {
  const { dir, root } = setup();
  try {
    const r = run(["nhi", "offboard", "--root", root]);
    assert.equal(r.rc, 1);
    assert.match(r.stderr, /--instance <id> is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

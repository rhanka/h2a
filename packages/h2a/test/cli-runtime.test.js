import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

function captureStreams(extraCwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => extraCwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("h2a init creates the .h2a layout under the explicit --root", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-init-"));
  const root = join(dir, ".h2a");
  try {
    const streams = captureStreams(dir);
    const rc = runCli(["init", "--root", root], streams);
    assert.equal(rc, 0);
    const payload = JSON.parse(streams.stdoutText);
    assert.equal(payload.ok, true);
    assert.equal(payload.root, root);
    assert.equal(existsSync(join(root, "registry", "instances.jsonl")), true);
    assert.equal(existsSync(join(root, "negotiations")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// WP-4: the fallback changed from <cwd>/.h2a to ~/h2a-workspace/.h2a (shared bus default).
// `init` without --root now initialises the shared bus, not the cwd.
test("h2a init defaults to ~/h2a-workspace/.h2a (shared bus default, WP-4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-init-"));
  const savedEnv = process.env.H2A_ROOT;
  try {
    delete process.env.H2A_ROOT;
    const streams = captureStreams(dir);
    const rc = runCli(["init"], streams);
    assert.equal(rc, 0);
    const payload = JSON.parse(streams.stdoutText);
    assert.equal(payload.ok, true);
    // root must be the shared default, not cwd
    assert.match(payload.root, /h2a-workspace[/\\]\.h2a$/);
    assert.equal(existsSync(join(dir, ".h2a")), false, "must NOT create .h2a in cwd");
  } finally {
    if (savedEnv === undefined) { delete process.env.H2A_ROOT; } else { process.env.H2A_ROOT = savedEnv; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a register persists an instance and h2a discover returns it", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-flow-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const registration = {
      id: "conductor:01",
      instance: "conductor:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:principal/antoine"],
      capabilities: ["negotiate"],
      endpoints: [{ kind: "local-files", uri: `file://${root}` }],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };

    const registerStreams = captureStreams(dir);
    const regRc = runCli(
      ["register", "--root", root, "--json", JSON.stringify(registration)],
      registerStreams
    );
    assert.equal(regRc, 0);
    assert.match(registerStreams.stdoutText, /"id": "conductor:01"/);

    const discoverStreams = captureStreams(dir);
    const discRc = runCli(["discover", "--root", root], discoverStreams);
    assert.equal(discRc, 0);
    const list = JSON.parse(discoverStreams.stdoutText);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "conductor:01");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a discover filters by --role and --scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-flow-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const base = {
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };

    runCli(
      [
        "register",
        "--root",
        root,
        "--json",
        JSON.stringify({
          ...base,
          id: "conductor:01",
          instance: "conductor:01",
          roles: ["CONDUCTOR"],
          scopes: ["scope:a"]
        })
      ],
      captureStreams(dir)
    );
    runCli(
      [
        "register",
        "--root",
        root,
        "--json",
        JSON.stringify({
          ...base,
          id: "control:01",
          instance: "control:01",
          roles: ["CONTROL"],
          scopes: ["scope:a", "scope:b"]
        })
      ],
      captureStreams(dir)
    );

    const byRole = captureStreams(dir);
    runCli(["discover", "--root", root, "--role", "CONTROL"], byRole);
    const roleList = JSON.parse(byRole.stdoutText);
    assert.equal(roleList.length, 1);
    assert.equal(roleList[0].id, "control:01");

    const byScope = captureStreams(dir);
    runCli(["discover", "--root", root, "--scope", "scope:b"], byScope);
    const scopeList = JSON.parse(byScope.stdoutText);
    assert.equal(scopeList.length, 1);
    assert.equal(scopeList[0].id, "control:01");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a register fails clearly on duplicate id", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-flow-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const reg = JSON.stringify({
      id: "conductor:01",
      instance: "conductor:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:a"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    runCli(["register", "--root", root, "--json", reg], captureStreams(dir));
    const dup = captureStreams(dir);
    const rc = runCli(["register", "--root", root, "--json", reg], dup);
    // DEC-034: duplicate instance is a store-state conflict → exit 2.
    assert.equal(rc, 2);
    assert.match(dup.stderrText, /already registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a register reports invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-flow-"));
  try {
    const streams = captureStreams(dir);
    const rc = runCli(["register", "--json", "{bad"], streams);
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a register requires --json", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["register"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--json/);
});

test("h2a --help mentions new commands", () => {
  const streams = captureStreams("/tmp");
  runCli(["--help"], streams);
  assert.match(streams.stdoutText, /h2a init/);
  assert.match(streams.stdoutText, /h2a register/);
  assert.match(streams.stdoutText, /h2a discover/);
});

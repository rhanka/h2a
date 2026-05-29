import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const VALID = `scope: org:acme
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme]
  - instance: claude:coach
    role: CONDUCTOR
    scopes: [org:acme]
  - instance: codex:dev-1
    role: AGENTS
    scopes: [org:acme]
commEdges:
  - from: claude:coach
    to: codex:dev-1
`;

// missing PRINCIPAL → invariant failure
const NO_PRINCIPAL = `scope: org:acme
instances:
  - instance: codex:dev-1
    role: AGENTS
    scopes: [org:acme]
`;

function writeManifest(text) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file = join(dir, "org.h2a.yaml");
  writeFileSync(file, text, "utf8");
  return { dir, file };
}

test("org validate → ok on a valid manifest", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["org", "validate", "--file", file]);
    assert.equal(r.rc, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.deepEqual(out.errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org validate → exit 1 + no-principal on an invalid manifest", () => {
  const { dir, file } = writeManifest(NO_PRINCIPAL);
  try {
    const r = run(["org", "validate", "--file", file]);
    assert.equal(r.rc, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.errors.includes("no-principal"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org validate → exit 1 + parse error on malformed YAML", () => {
  const { dir, file } = writeManifest("scope: org:x\ninstances:\n\t- bad\n");
  try {
    const r = run(["org", "validate", "--file", file]);
    assert.equal(r.rc, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => /tab indentation/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org validate → exit 3 when the file is unreadable", () => {
  const r = run(["org", "validate", "--file", join(tmpdir(), "does-not-exist-h2a.yaml")]);
  assert.equal(r.rc, 3);
  assert.match(r.stderr, /cannot read/);
});

test("org show → normalized manifest + validation block", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["org", "show", "--file", file]);
    assert.equal(r.rc, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.scope, "org:acme");
    assert.equal(out.instances.length, 3);
    assert.equal(out.validation.ok, true);
    assert.equal(out.commEdges.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org diff → reports drift against the live registry, then inSync", () => {
  const { dir, file } = writeManifest(VALID);
  const root = join(dir, ".h2a");
  try {
    run(["init", "--root", root]);

    // nothing registered yet → all declared instances are missing
    const before = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.equal(before.scope, "org:acme");
    assert.equal(before.inSync, false);
    assert.equal(before.missing.length, 3);

    // register the three declared instances with matching roles + scope
    for (const [instance, role] of [
      ["claude:lead", "PRINCIPAL"],
      ["claude:coach", "CONDUCTOR"],
      ["codex:dev-1", "AGENTS"]
    ]) {
      const reg = {
        id: `reg-${instance}`,
        instance,
        roles: [role],
        scopes: ["org:acme"],
        capabilities: [],
        endpoints: [],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: "2026-05-29T00:00:00.000Z"
      };
      const r = run(["register", "--root", root, "--json", JSON.stringify(reg)]);
      assert.equal(r.rc, 0, r.stderr);
    }

    const after = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.equal(after.inSync, true, JSON.stringify(after));
    assert.equal(after.matched.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach propose → unsigned org-proposal envelope", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["coach", "propose", "--file", file, "--as", "claude:coach"]);
    assert.equal(r.rc, 0, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.type, "event");
    assert.equal(env.body.kind, "org-proposal");
    assert.equal(env.actor.instance, "claude:coach");
    assert.equal(env.actor.role, "CONDUCTOR"); // default coach role
    assert.equal(env.actor.scope, "org:acme"); // default = manifest scope
    assert.equal(env.body.manifest.instances.length, 3);
    assert.ok(env.id.startsWith("org-"));
    assert.equal(env.signature, undefined); // read-only: unsigned
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach propose → --as is required (exit 1)", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["coach", "propose", "--file", file]);
    assert.equal(r.rc, 1);
    assert.match(r.stderr, /--as <coach-instance> is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach propose → refuses an invalid manifest (exit 1)", () => {
  const { dir, file } = writeManifest(NO_PRINCIPAL);
  try {
    const r = run(["coach", "propose", "--file", file, "--as", "claude:coach"]);
    assert.equal(r.rc, 1);
    assert.match(r.stderr, /refusing to propose an invalid org/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach propose → rejects a non-canonical role (exit 1)", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["coach", "propose", "--file", file, "--as", "x", "--role", "BOSS"]);
    assert.equal(r.rc, 1);
    assert.match(r.stderr, /--role must be one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";
import { verifyEnvelopeSignature } from "@sentropic/h2a";

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

const PROVISION = `scope: org:acme
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme, org:acme/ops]
  - instance: codex:dev-1
    role: AGENTS
    scopes: [org:acme]
`;

test("org provision → grants for keyed instances, pending for unregistered, idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file = join(dir, "provision.h2a.yaml");
  const root = join(dir, ".h2a");
  writeFileSync(file, PROVISION, "utf8");
  try {
    run(["init", "--root", root]);
    // register only claude:lead, with a subset of its declared scopes
    const reg = {
      id: "reg-lead",
      instance: "claude:lead",
      roles: ["PRINCIPAL"],
      scopes: ["org:acme"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    assert.equal(run(["register", "--root", root, "--json", JSON.stringify(reg)]).rc, 0);

    const p = run(["org", "provision", "--root", root, "--file", file]);
    assert.equal(p.rc, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.applied.length, 1);
    assert.equal(out.applied[0].instance, "claude:lead");
    assert.deepEqual(out.applied[0].grantedScopes, ["org:acme/ops"]);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0].instance, "codex:dev-1"); // unregistered → not fabricated

    // diff now sees claude:lead matched (grant took effect); codex:dev-1 still missing
    const diff = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.ok(diff.matched.includes("claude:lead"));
    assert.equal(diff.missing.length, 1);
    assert.equal(diff.missing[0].instance, "codex:dev-1");

    // idempotent: re-provision grants nothing new
    const again = JSON.parse(run(["org", "provision", "--root", root, "--file", file]).stdout);
    assert.equal(again.applied.length, 0);
    assert.ok(again.unchanged.includes("claude:lead"));
    assert.equal(again.pending.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discover --scope reflects a provisioned grant (effective-view gating)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file = join(dir, "provision.h2a.yaml");
  const root = join(dir, ".h2a");
  writeFileSync(file, PROVISION, "utf8"); // claude:lead declared in org:acme + org:acme/ops
  try {
    run(["init", "--root", root]);
    const reg = {
      id: "reg-lead",
      instance: "claude:lead",
      roles: ["PRINCIPAL"],
      scopes: ["org:acme"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    run(["register", "--root", root, "--json", JSON.stringify(reg)]);

    // before provisioning: not a member of org:acme/ops
    const before = JSON.parse(run(["discover", "--root", root, "--scope", "org:acme/ops"]).stdout);
    assert.equal(before.length, 0);

    run(["org", "provision", "--root", root, "--file", file]);

    // after provisioning: the grant makes it discoverable in the granted scope
    const after = JSON.parse(run(["discover", "--root", root, "--scope", "org:acme/ops"]).stdout);
    assert.equal(after.length, 1);
    assert.equal(after[0].instance, "claude:lead");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach propose --deliver drops the org-proposal into declared inboxes", () => {
  const { dir, file } = writeManifest(VALID);
  const root = join(dir, ".h2a");
  try {
    run(["init", "--root", root]);
    const r = run(["coach", "propose", "--root", root, "--file", file, "--as", "claude:coach", "--deliver"]);
    assert.equal(r.rc, 0, r.stderr);
    // each declared instance received the proposal in its inbox
    const inbox = JSON.parse(run(["inbox", "read", "--root", root, "--instance", "codex:dev-1"]).stdout);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].body.kind, "org-proposal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach ratify → PRINCIPAL-signed org-ratified envelope, signature verifies", () => {
  const { dir, file } = writeManifest(VALID);
  const keyPath = join(dir, "principal.pkcs8.pem");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  try {
    const r = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", keyPath]);
    assert.equal(r.rc, 0, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.type, "event");
    assert.equal(env.body.kind, "org-ratified");
    assert.equal(env.actor.instance, "claude:lead");
    assert.equal(env.actor.role, "PRINCIPAL"); // default ratifier role
    assert.equal(env.signatures.length, 1, "ratified envelope must carry one signature");
    // the signature verifies against the signer's public key
    assert.equal(verifyEnvelopeSignature(env, publicPem, { by: "claude:lead" }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coach ratify → requires --private-key (exit 1)", () => {
  const { dir, file } = writeManifest(VALID);
  try {
    const r = run(["coach", "ratify", "--file", file, "--as", "claude:lead"]);
    assert.equal(r.rc, 1);
    assert.match(r.stderr, /--private-key/);
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

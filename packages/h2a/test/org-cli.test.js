import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";
import { verifyEnvelopeSignature, verifyRoleScopePolicyV1 } from "@sentropic/h2a";

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
    mandateRights: [ratify-org]
  - instance: codex:dev-1
    role: AGENTS
    scopes: [org:acme]
`;

test("org provision → grants for keyed instances, pending for unregistered, idempotent (ratified)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file = join(dir, "provision.h2a.yaml");
  const root = join(dir, ".h2a");
  writeFileSync(file, PROVISION, "utf8");
  try {
    run(["init", "--root", root]);
    // register only claude:lead, with a subset of its declared scopes
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyPath = join(dir, "principal.pkcs8.pem");
    writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    const reg = {
      id: "reg-lead",
      instance: "claude:lead",
      roles: ["PRINCIPAL"],
      scopes: ["org:acme"],
      capabilities: [],
      endpoints: [],
      publicKeys: [publicKey.export({ format: "pem", type: "spki" }).toString()],
      acceptedPolicies: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    assert.equal(run(["register", "--root", root, "--json", JSON.stringify(reg)]).rc, 0);

    // H2A-ORG-H1: provisioning requires a PRINCIPAL org-ratified envelope whose
    // signature verifies against a registered key of the ratifier.
    const ratify = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", keyPath]);
    assert.equal(ratify.rc, 0, ratify.stderr);
    const envFile = join(dir, "ratified.json");
    writeFileSync(envFile, ratify.stdout, "utf8");

    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.applied.length, 1);
    assert.equal(out.applied[0].instance, "claude:lead");
    assert.deepEqual(out.applied[0].grantedScopes, ["org:acme/ops"]);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0].instance, "codex:dev-1"); // unregistered → not fabricated
    assert.deepEqual(out.policies, []); // no memorial-agent declaration → no H1 policy emitted

    // diff now sees claude:lead matched (grant took effect); codex:dev-1 still missing
    const diff = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.ok(diff.matched.includes("claude:lead"));
    assert.equal(diff.missing.length, 1);
    assert.equal(diff.missing[0].instance, "codex:dev-1");

    // idempotent: re-provision grants nothing new
    const again = JSON.parse(
      run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]).stdout
    );
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
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyPath = join(dir, "principal.pkcs8.pem");
    writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    const reg = {
      id: "reg-lead",
      instance: "claude:lead",
      roles: ["PRINCIPAL"],
      scopes: ["org:acme"],
      capabilities: [],
      endpoints: [],
      publicKeys: [publicKey.export({ format: "pem", type: "spki" }).toString()],
      acceptedPolicies: [],
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    run(["register", "--root", root, "--json", JSON.stringify(reg)]);
    const ratify = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", keyPath]);
    assert.equal(ratify.rc, 0, ratify.stderr);
    const envFile = join(dir, "ratified.json");
    writeFileSync(envFile, ratify.stdout, "utf8");

    // before provisioning: not a member of org:acme/ops
    const before = JSON.parse(run(["discover", "--root", root, "--scope", "org:acme/ops"]).stdout);
    assert.equal(before.length, 0);

    run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);

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

// ---------------------------------------------------------------------------
// H2A-ORG-H1 — `h2a org provision` fails closed: no verified PRINCIPAL
// org-ratified envelope, no grant. A ratified manifest also emits one signed
// RoleScopePolicyV1 per (actor, scope) key for each declared memorial agent
// (r2 §2.4, §2.6, §8.1 H1), from the declared L1 ceiling of the co-signed
// `org.h2a.yaml` v2 schema (spec-r4-h2a-cosign §2.1).
// ---------------------------------------------------------------------------

/**
 * A manifest with one memorial-agent declaration on `dev-1`, declared in two
 * scopes: provision must emit one H1 policy per (actor, scope) pair, carrying
 * the agent's own declared L1 ceiling (never the general pass-through policy,
 * and never silent hardcoded constants).
 */
const MEMORIAL_PROVISION = `scope: org:acme
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme, org:acme/ops]
    mandateRights: [ratify-org]
  - instance: dev-1
    role: AGENTS
    scopes: [org:acme, org:acme/ops]
    memorialAgent:
      launchName: dev-1
      agentUuidRef: 0199c0de-0000-7000-8000-000000000001
      policyRefs: [pol:org:acme:dev-1:v1]
      memoryScopes: [role, repo]
      purposeGrants:
        - scopeKind: role
          purposeRef: purpose:org:acme/dev-1/role
          allowSubagentExec: false
        - scopeKind: repo
          purposeRef: purpose:org:acme/dev-1/repo
          allowSubagentExec: true
      allowedCliKinds: [claude, codex]
      allowedModels: [muse-spark-1.3]
      effortCeiling: high
      declaringOwner: claude:lead
`;

/**
 * A ready-to-provision estate: temp dir + committed manifest + initialized
 * root + a registered PRINCIPAL (claude:lead) holding an ed25519 key + that
 * PRINCIPAL's signed `org-ratified` envelope over the manifest.
 */
function provisionFixture({ manifest = PROVISION, registerPublicKey = true, ratifyRc = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file = join(dir, "provision.h2a.yaml");
  const root = join(dir, ".h2a");
  writeFileSync(file, manifest, "utf8");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyPath = join(dir, "principal.pkcs8.pem");
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
  run(["init", "--root", root]);
  // the registration id IS the instance name: the keyring verbs (keys add /
  // keys revoke) and `nhi offboard` resolve registrations by id, exactly like
  // the real estate (identity/live.ts keys rows with id === instance)
  const reg = {
    id: "claude:lead",
    instance: "claude:lead",
    roles: ["PRINCIPAL"],
    scopes: ["org:acme"],
    capabilities: [],
    endpoints: [],
    publicKeys: registerPublicKey ? [publicPem] : [],
    acceptedPolicies: [],
    createdAt: "2026-05-29T00:00:00.000Z"
  };
  assert.equal(run(["register", "--root", root, "--json", JSON.stringify(reg)]).rc, 0);
  const ratify = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", keyPath]);
  assert.equal(ratify.rc, ratifyRc, ratify.stderr);
  const envFile = join(dir, "ratified.json");
  writeFileSync(envFile, ratify.stdout === "" ? "{}" : ratify.stdout, "utf8");
  return { dir, file, root, envFile, keyPath, publicPem };
}

test("org provision → refuses without --ratified (fail closed, nothing granted)", () => {
  const { dir, file, root } = provisionFixture();
  try {
    const p = run(["org", "provision", "--root", root, "--file", file]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /refusing to provision an unratified org/);
    assert.match(p.stderr, /--ratified/);
    // fail closed: no grant happened at all
    const diff = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.equal(diff.inSync, false);
    assert.equal(diff.matched.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses a proposal envelope (wrong-kind)", () => {
  const { dir, file, root } = provisionFixture();
  try {
    const prop = run(["coach", "propose", "--file", file, "--as", "claude:coach"]);
    assert.equal(prop.rc, 0, prop.stderr);
    const propFile = join(dir, "proposal.json");
    writeFileSync(propFile, prop.stdout, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", propFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /wrong-kind/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses a CONDUCTOR-signed envelope (wrong-actor-role)", () => {
  const { dir, file, root, keyPath } = provisionFixture();
  try {
    const r = run([
      "coach", "ratify", "--file", file, "--as", "claude:lead", "--role", "CONDUCTOR", "--private-key", keyPath
    ]);
    assert.equal(r.rc, 0, r.stderr);
    const envFile = join(dir, "conductor-ratified.json");
    writeFileSync(envFile, r.stdout, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /wrong-actor-role/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses an edited committed manifest (manifest-mismatch)", () => {
  const { dir, file, root, envFile } = provisionFixture();
  try {
    // the committed file drifts from what was ratified: the edit creates no rights
    const edited = PROVISION.replace("org:acme/ops]", "org:acme/ops, org:acme/new]");
    writeFileSync(file, edited, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /manifest-mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses when the ratifier is not a declared PRINCIPAL (actor-not-declared-principal)", () => {
  const { dir, file, root, keyPath } = provisionFixture();
  try {
    // codex:dev-1 is declared, but as AGENTS — it cannot ratify this org
    const r = run(["coach", "ratify", "--file", file, "--as", "codex:dev-1", "--private-key", keyPath]);
    assert.equal(r.rc, 0, r.stderr);
    const envFile = join(dir, "dev-ratified.json");
    writeFileSync(envFile, r.stdout, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /actor-not-declared-principal/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses when the ratifier has no registered key (signer-not-registered)", () => {
  const { dir, file, root, envFile } = provisionFixture({ registerPublicKey: false });
  try {
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /signer-not-registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses an envelope signed by an unregistered key (bad-signature)", () => {
  const { dir, file, root } = provisionFixture();
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const foreignKeyPath = join(dir, "foreign.pkcs8.pem");
    writeFileSync(foreignKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    const r = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", foreignKeyPath]);
    assert.equal(r.rc, 0, r.stderr);
    const envFile = join(dir, "foreign-ratified.json");
    writeFileSync(envFile, r.stdout, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /bad-signature/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → verified ratification grants AND emits one signed RoleScopePolicyV1 per (actor, scope)", () => {
  const { dir, file, root, envFile, keyPath, publicPem } = provisionFixture({ manifest: MEMORIAL_PROVISION });
  try {
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", keyPath
    ]);
    assert.equal(p.rc, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.applied.length, 1); // claude:lead registered → granted
    assert.equal(out.pending.length, 1); // dev-1 unregistered → pending, never fabricated
    assert.equal(out.pending[0].instance, "dev-1");
    // exactly one policy document per (actorLaunchName, scope) pair: dev-1 is
    // declared in two scopes → two policies (r2 §2.6 "Key: (org actor launch
    // name, scope). Exactly one policy document per (actor, scope)")
    assert.equal(out.policies.length, 2);
    const scopes = out.policies.map((policy) => policy.scope).sort();
    assert.deepEqual(scopes, ["org:acme", "org:acme/ops"]);
    for (const policy of out.policies) {
      assert.equal(policy.format, "h2a.role-scope-policy/v1");
      assert.equal(policy.actorLaunchName, "dev-1");
      assert.deepEqual(policy.governanceRoles, ["AGENTS"]); // asserted only, never keying
      // the agent's OWN declared L1 ceiling — never the general pass-through
      // policy, never empty hardcoded defaults
      assert.deepEqual(policy.allowedCliKinds, ["claude", "codex"]);
      assert.deepEqual(policy.allowedModels, ["muse-spark-1.3"]);
      assert.equal(policy.effortCeiling, "high");
      assert.deepEqual(policy.memoryScopes, ["role", "repo"]); // both declared scopes, not a hardcoded [\"role\"]
      assert.equal(policy.revision, 1);
      assert.equal(policy.signerInstance, "claude:lead");
      // the emitted policy verifies against the ratifying PRINCIPAL's public key
      const check = verifyRoleScopePolicyV1(policy, publicPem);
      assert.equal(check.ok, true, JSON.stringify(check));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → emission honors the explicit --drive-consent-class/--signing-class/--mcp-tools parameters", () => {
  const { dir, file, root, envFile, keyPath, publicPem } = provisionFixture({ manifest: MEMORIAL_PROVISION });
  try {
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", keyPath,
      "--drive-consent-class", "bilateral-journal-v1",
      "--signing-class", "D1",
      "--mcp-tools", "engram_memory_status,artifacts_ensure",
      "--mcp-connector-classes", "memory,artifacts"
    ]);
    assert.equal(p.rc, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.policies.length, 2);
    for (const policy of out.policies) {
      assert.equal(policy.driveConsentClass, "bilateral-journal-v1");
      assert.equal(policy.signingClass, "D1");
      assert.deepEqual(policy.mcpRights, {
        tools: ["engram_memory_status", "artifacts_ensure"],
        connectorClasses: ["memory", "artifacts"]
      });
      assert.equal(verifyRoleScopePolicyV1(policy, publicPem).ok, true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses an unknown --signing-class (fail closed before any grant)", () => {
  const { dir, file, root, envFile, keyPath } = provisionFixture({ manifest: MEMORIAL_PROVISION });
  try {
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", keyPath,
      "--signing-class", "D9"
    ]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /--signing-class/);
    // fail closed: no grant happened at all
    const diff = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.equal(diff.inSync, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses when the ratifying PRINCIPAL lacks the ratify-org mandate right", () => {
  // the committed manifest's PRINCIPAL carries no mandateRights → a valid
  // signature by a declared PRINCIPAL is still not a ratification (spec §2.2)
  const manifest = MEMORIAL_PROVISION.replace("    mandateRights: [ratify-org]\n", "");
  const { dir, file, root, envFile, keyPath } = provisionFixture({ manifest });
  try {
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", keyPath
    ]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /principal-missing-ratify-org/);
    const diff = JSON.parse(run(["org", "diff", "--root", root, "--file", file]).stdout);
    assert.equal(diff.inSync, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses a ratifier key revoked from the keyring (DEC-079)", () => {
  const { dir, file, root, envFile, keyPath, publicPem } = provisionFixture();
  try {
    // rotate the registered key OUT: the baked registration key no longer
    // verifies anything — the envelope it signed must stop counting
    const revokedPemPath = join(dir, "principal.spki.pem");
    writeFileSync(revokedPemPath, publicPem, "utf8");
    assert.equal(
      run(["keys", "revoke", "--root", root, "--instance", "claude:lead", "--public-key", revokedPemPath]).rc,
      0
    );
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /signer-not-registered|bad-signature/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → accepts a ratifier key added by rotation (DEC-078 keyring union)", () => {
  const { dir, file, root } = provisionFixture();
  try {
    // rotate a NEW key IN: an envelope signed only by the rotated key must
    // provision — the active key set is the keyring union, not the first
    // registration row's baked `publicKeys` alone
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const rotatedKeyPath = join(dir, "rotated.pkcs8.pem");
    const rotatedPubPath = join(dir, "rotated.spki.pem");
    writeFileSync(rotatedKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    writeFileSync(rotatedPubPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");
    assert.equal(
      run(["keys", "add", "--root", root, "--instance", "claude:lead", "--public-key", rotatedPubPath]).rc,
      0
    );
    const ratify = run(["coach", "ratify", "--file", file, "--as", "claude:lead", "--private-key", rotatedKeyPath]);
    assert.equal(ratify.rc, 0, ratify.stderr);
    const envFile = join(dir, "rotated-ratified.json");
    writeFileSync(envFile, ratify.stdout, "utf8");
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 0, p.stderr);
    const out = JSON.parse(p.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.applied.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses an offboarded ratifier (DEC-089 tombstone)", () => {
  const { dir, file, root, envFile } = provisionFixture();
  try {
    assert.equal(run(["nhi", "offboard", "--root", root, "--instance", "claude:lead", "--reason", "test"]).rc, 0);
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /signer-not-registered|bad-signature/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses a memorial agent whose launch name is not its instance id", () => {
  const mismatched = MEMORIAL_PROVISION.replace("      launchName: dev-1", "      launchName: dev-one");
  // the mismatched manifest fails validateOrgManifest, so `coach ratify`
  // refuses it (ratifyRc: 1) — and provision refuses the invalid org before
  // the envelope is even read
  const { dir, file, root, envFile, keyPath } = provisionFixture({ manifest: mismatched, ratifyRc: 1 });
  try {
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", keyPath
    ]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /memorial-launch-name-mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org validate → refuses a per-conversation instance id and a memory-granting generalCliPolicy", () => {
  const perConversation = `scope: org:acme
instances:
  - instance: claude:h2a:c18853e319ea
    role: PRINCIPAL
    scopes: [org:acme]
`;
  const { dir, file } = writeManifest(perConversation);
  try {
    const r = run(["org", "validate", "--file", file]);
    assert.equal(r.rc, 1);
    assert.ok(JSON.parse(r.stdout).errors.includes("instance-per-conversation-id-forbidden"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const memoryPassthrough = `scope: org:acme
generalCliPolicy:
  generalPolicyRef: gpol:org:acme:passthrough:v1
  allowedCliKinds: [claude]
  allowedModels: ["*"]
  allowedTools: [h2a_discover_sessions]
  allowMemory: true
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme]
    mandateRights: [ratify-org]
`;
  const dir2 = mkdtempSync(join(tmpdir(), "h2a-org-"));
  const file2 = join(dir2, "org.h2a.yaml");
  writeFileSync(file2, memoryPassthrough, "utf8");
  try {
    const r = run(["org", "validate", "--file", file2]);
    assert.equal(r.rc, 1);
    assert.ok(JSON.parse(r.stdout).errors.includes("passthrough-memory-forbidden"));
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("org provision → refuses to emit policies without --private-key", () => {
  const { dir, file, root, envFile } = provisionFixture({ manifest: MEMORIAL_PROVISION });
  try {
    const p = run(["org", "provision", "--root", root, "--file", file, "--ratified", envFile]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /--private-key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org provision → refuses a signing key that is not the ratifier's registered key", () => {
  const { dir, file, root, envFile } = provisionFixture({ manifest: MEMORIAL_PROVISION });
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const otherKeyPath = join(dir, "other.pkcs8.pem");
    writeFileSync(otherKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
    const p = run([
      "org", "provision", "--root", root, "--file", file, "--ratified", envFile, "--private-key", otherKeyPath
    ]);
    assert.equal(p.rc, 1);
    assert.match(p.stderr, /registered public key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

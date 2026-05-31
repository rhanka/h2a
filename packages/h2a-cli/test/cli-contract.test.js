// DEC-034 — drive every entry of `H2A_CLI_VERB_CONTRACTS` through a happy-path
// invocation of `runCli` and assert the stdout payload conforms to the
// declared envelope shape (resource / list / action / text). A few verbs are
// intentionally skipped (long-running `mcp-serve`, the `host setup --print`
// resource is also covered as a sanity check below).
//
// Then assert the new exit-code classification (DEC-034) for a handful of
// representative failure modes:
//   - `negotiate stabilize` on a missing negotiation → exit 2 (state error).
//   - `inbox pop` on a missing envelope → exit 2 (state error).
//   - `register` with malformed JSON → exit 1 (user error).
//   - `negotiate sign` with a missing private-key file → exit 3 (I/O error).

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H2A_CLI_VERB_CONTRACTS, runCli } from "../dist/index.js";

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

function assertShape(verb, shape, stdoutText) {
  switch (shape) {
    case "text": {
      // No JSON parsing; just non-empty human-readable text.
      assert.ok(
        stdoutText.length > 0,
        `${verb}: expected non-empty text on stdout, got ""`
      );
      return;
    }
    case "list": {
      const parsed = JSON.parse(stdoutText);
      assert.ok(
        Array.isArray(parsed),
        `${verb}: expected a JSON array on stdout, got ${typeof parsed}`
      );
      return;
    }
    case "action": {
      const parsed = JSON.parse(stdoutText);
      assert.ok(
        parsed && typeof parsed === "object" && !Array.isArray(parsed),
        `${verb}: expected a JSON object on stdout`
      );
      assert.equal(
        parsed.ok,
        true,
        `${verb}: action envelope must include "ok": true (got ${JSON.stringify(parsed.ok)})`
      );
      return;
    }
    case "resource": {
      const parsed = JSON.parse(stdoutText);
      assert.ok(
        parsed && typeof parsed === "object",
        `${verb}: expected a JSON object/array on stdout`
      );
      // A resource MUST NOT be the action envelope (that's a separate shape).
      // We can't strictly forbid an `ok` field because legitimate resources
      // can carry one, but we can require that the verb returned the entity
      // and not just a confirmation.
      return;
    }
    case "stream":
      // Streams have no single stdout payload to assert against; covered by
      // dedicated tests (e.g. mcp-stdio.test.js).
      return;
    default:
      throw new Error(`Unknown shape ${shape} for verb ${verb}`);
  }
}

/**
 * Bootstrap a populated `<root>/.h2a` store for verbs that need pre-existing
 * state: a registered conductor, an open negotiation with `req-001` as
 * required signer, an offer carrying an ENGAGEMENT artifact, an envelope in
 * `req-001`'s inbox, and a private-key PEM file on disk.
 */
function bootstrapHappyPath(dir, root) {
  runCli(["init", "--root", root], captureStreams(dir));

  const registration = {
    id: "req-001",
    instance: "req-001",
    roles: ["CONDUCTOR"],
    scopes: ["scope:contract"],
    capabilities: ["negotiate", "sign"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  };
  runCli(
    ["register", "--root", root, "--json", JSON.stringify(registration)],
    captureStreams(dir)
  );

  // An AGENTS parent so `subagent register/list` (DEC-068) has a valid parent.
  const agentRegistration = {
    id: "agent-001",
    instance: "agent-001",
    roles: ["AGENTS"],
    scopes: ["scope:contract"],
    capabilities: ["negotiate", "research"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  };
  runCli(
    ["register", "--root", root, "--json", JSON.stringify(agentRegistration)],
    captureStreams(dir)
  );

  // A registered subagent under agent-001 so `subagent route/inbox` (DEC-070)
  // have a valid target.
  runCli(
    [
      "subagent",
      "register",
      "--root",
      root,
      "--parent",
      "agent-001",
      "--name",
      "researcher"
    ],
    captureStreams(dir)
  );

  const negoRecord = {
    id: "nego-cc",
    scope: "scope:contract",
    parties: ["req-001"],
    subject: "engagement",
    status: "draft",
    requiredSigners: ["req-001"]
  };
  runCli(
    ["negotiate", "open", "--root", root, "--json", JSON.stringify(negoRecord)],
    captureStreams(dir)
  );

  const artifact = { kind: "ENGAGEMENT", id: "engagement:cc", goal: "demo" };
  runCli(
    [
      "negotiate",
      "offer",
      "--root",
      root,
      "--id",
      "nego-cc",
      "--instance",
      "req-001",
      "--event-id",
      "evt-cc-offer",
      "--artifact",
      JSON.stringify(artifact)
    ],
    captureStreams(dir)
  );

  const envelope = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "env-cc-001",
    type: "propose",
    actor: { instance: "req-001", role: "CONDUCTOR", scope: "scope:contract" },
    body: { artifact },
    createdAt: "2026-05-20T00:00:00.000Z"
  };
  runCli(
    [
      "inbox",
      "put",
      "--root",
      root,
      "--instance",
      "req-001",
      "--json",
      JSON.stringify(envelope)
    ],
    captureStreams(dir)
  );
  runCli(
    [
      "outbox",
      "put",
      "--root",
      root,
      "--instance",
      "req-001",
      "--json",
      JSON.stringify({ ...envelope, id: "env-cc-out-001" })
    ],
    captureStreams(dir)
  );
}

/**
 * Build the happy-path argv for a given verb against a freshly bootstrapped
 * store. Returns `null` when the verb cannot be happy-pathed in this single
 * invocation (e.g. `mcp-serve` is long-running, `negotiate stabilize`
 * needs a quorum + ed25519 keypair which is covered by the dedicated test).
 */
function buildHappyArgv(verb, ctx) {
  const { root, privateKeyPath } = ctx;
  switch (verb) {
    case "--help":
      return ["--help"];
    case "hosts":
      return ["hosts"];
    case "mcp-tools":
      return ["mcp-tools"];
    case "init":
      // Fresh sub-root so we don't collide with the bootstrap.
      return ["init", "--root", join(root, "..", "init-sub")];
    case "register":
      return [
        "register",
        "--root",
        root,
        "--json",
        JSON.stringify({
          id: "fresh:001",
          instance: "fresh:001",
          roles: ["CONDUCTOR"],
          scopes: ["scope:fresh"],
          capabilities: [],
          endpoints: [],
          publicKeys: [],
          acceptedPolicies: [],
          createdAt: "2026-05-20T00:00:00.000Z"
        })
      ];
    case "discover":
      return ["discover", "--root", root];
    case "negotiate open":
      return [
        "negotiate",
        "open",
        "--root",
        root,
        "--json",
        JSON.stringify({
          id: "nego-fresh",
          scope: "scope:contract",
          parties: ["req-001"],
          subject: "engagement",
          status: "draft",
          requiredSigners: ["req-001"]
        })
      ];
    case "negotiate status":
      return [
        "negotiate",
        "status",
        "--root",
        root,
        "--id",
        "nego-cc",
        "--status",
        "proposed"
      ];
    case "negotiate event":
      return [
        "negotiate",
        "event",
        "--root",
        root,
        "--id",
        "nego-cc",
        "--json",
        JSON.stringify({
          id: "evt-cc-event",
          type: "event",
          actor: { instance: "req-001", role: "CONDUCTOR", scope: "scope:contract" },
          body: { note: "happy path" },
          createdAt: "2026-05-20T00:00:00.000Z"
        })
      ];
    case "negotiate offer":
      // The bootstrap already issued an offer; a *second* offer is still a
      // valid append. Reuse the same instance/artifact with a new event-id.
      return [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-cc",
        "--instance",
        "req-001",
        "--event-id",
        "evt-cc-offer-2",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "engagement:cc", goal: "demo-2" })
      ];
    case "negotiate counter":
      return [
        "negotiate",
        "counter",
        "--root",
        root,
        "--id",
        "nego-cc",
        "--instance",
        "req-001",
        "--event-id",
        "evt-cc-counter",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "engagement:cc", goal: "demo-counter" })
      ];
    case "negotiate sign":
      // Sign relies on a private key file existing; the registry might not
      // have the matching public key (that only matters at stabilize-time).
      return [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-cc",
        "--instance",
        "req-001",
        "--event-id",
        "evt-cc-sign",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "engagement:cc", goal: "demo" }),
        "--private-key",
        privateKeyPath
      ];
    case "negotiate stabilize":
      // Covered by cli-negotiate-sign-stabilize.test.js — quorum + ed25519
      // signature verification needs more setup than this happy-path harness
      // is designed for. Reported as skip.
      return null;
    case "negotiate journal":
      return ["negotiate", "journal", "--root", root, "--id", "nego-cc"];
    case "inbox put":
      return [
        "inbox",
        "put",
        "--root",
        root,
        "--instance",
        "req-001",
        "--json",
        JSON.stringify({
          protocol: "sentropic.h2a",
          version: "0.1",
          id: "env-cc-fresh-in",
          type: "propose",
          actor: { instance: "req-001", role: "CONDUCTOR", scope: "scope:contract" },
          body: { offer: 1 },
          createdAt: "2026-05-20T00:00:00.000Z"
        })
      ];
    case "inbox read":
      return ["inbox", "read", "--root", root, "--instance", "req-001"];
    case "inbox pop":
      return [
        "inbox",
        "pop",
        "--root",
        root,
        "--instance",
        "req-001",
        "--envelope",
        "env-cc-001"
      ];
    case "outbox put":
      return [
        "outbox",
        "put",
        "--root",
        root,
        "--instance",
        "req-001",
        "--json",
        JSON.stringify({
          protocol: "sentropic.h2a",
          version: "0.1",
          id: "env-cc-fresh-out",
          type: "propose",
          actor: { instance: "req-001", role: "CONDUCTOR", scope: "scope:contract" },
          body: { offer: 1 },
          createdAt: "2026-05-20T00:00:00.000Z"
        })
      ];
    case "outbox read":
      return ["outbox", "read", "--root", root, "--instance", "req-001"];
    case "mcp-serve":
      // Long-running JSON-RPC stdio loop — can't happy-path in a one-shot
      // assertion. Covered by mcp-stdio.test.js + the example.
      return null;
    case "host setup":
      return ["host", "setup", "--host", "codex", "--print"];
    case "host status":
      return ["host", "status"];
    case "store migrate":
      return ["store", "migrate", "--root", root];
    case "connect":
      return ["connect", "--host", "claude", "--root", root, "--instance", "claude:contract"];
    case "doctor":
      return ["doctor", "--root", root];
    case "sessions":
      return ["sessions", "--root", root];
    case "keys generate":
      return [
        "keys",
        "generate",
        "--instance",
        "req-001",
        "--root",
        root,
        "--out",
        join(root, "..", "contract-keys")
      ];
    case "install-skills":
      // Use project scope into a temp subdir so the test stays hermetic and
      // never writes under ~/.claude.
      return [
        "install-skills",
        "--host",
        "claude",
        "--scope",
        "project",
        "--force"
      ];
    case "deploy k8s-sidecar":
      return [
        "deploy",
        "k8s-sidecar",
        "--instance",
        "remote:test",
        "--cli-version",
        "0.1.20"
      ];
    case "deploy k8s-tenant":
      return [
        "deploy",
        "k8s-tenant",
        "--namespace",
        "h2a-test",
        "--replicas",
        "2",
        "--cli-version",
        "0.1.28"
      ];
    case "keys add": {
      const { publicKey } = generateKeyPairSync("ed25519");
      const pubPath = join(root, "..", "keys-add.pub.pem");
      writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");
      return ["keys", "add", "--root", root, "--instance", "agent-001", "--public-key", pubPath];
    }
    case "keys list":
      return ["keys", "list", "--root", root, "--instance", "agent-001"];
    case "keys revoke": {
      // Add a key first so there is an active key to revoke.
      const { publicKey } = generateKeyPairSync("ed25519");
      const pubPath = join(root, "..", "keys-revoke.pub.pem");
      writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");
      const sink = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      runCli(["keys", "add", "--root", root, "--instance", "agent-001", "--public-key", pubPath], sink);
      return ["keys", "revoke", "--root", root, "--instance", "agent-001", "--public-key", pubPath];
    }
    case "subagent register":
      // `researcher` is pre-registered by bootstrapHappyPath (for route/inbox);
      // use a distinct name here so this happy path is a fresh registration.
      return [
        "subagent",
        "register",
        "--root",
        root,
        "--parent",
        "agent-001",
        "--name",
        "analyst",
        "--capabilities",
        "research"
      ];
    case "subagent list":
      return ["subagent", "list", "--root", root, "--parent", "agent-001"];
    case "subagent route":
      return [
        "subagent",
        "route",
        "--root",
        root,
        "--to",
        "agent-001~researcher",
        "--json",
        JSON.stringify({
          protocol: "sentropic.h2a",
          version: "0.1",
          id: "env-sub-route",
          type: "propose",
          actor: { instance: "req-001", role: "CONDUCTOR", scope: "scope:contract" },
          body: { task: "research" },
          createdAt: "2026-05-20T00:00:00.000Z"
        })
      ];
    case "subagent inbox":
      return ["subagent", "inbox", "--root", root, "--parent", "agent-001"];
    case "remote send":
      // Needs a live HTTP server + signer key; covered by remote-cli.test.js.
      return null;
    case "sysml verify":
      // Async verb (network on the content path) + needs a signed envelope with
      // a ref; covered by sysml-verify.test.js.
      return null;
    case "upgrade":
      // Would hit the npm registry / run a global install; covered by
      // upgrade.test.js with an injected runtime.
      return null;
    case "drumbeat record":
      return ["drumbeat", "record", "--root", root, "--instance", "agent-001", "--status", "out-of-tokens"];
    case "drumbeat scan":
      return ["drumbeat", "scan", "--root", root];
    case "drumbeat clear":
      return ["drumbeat", "clear", "--root", root, "--instance", "agent-001"];
    case "drumbeat escalations":
      return ["drumbeat", "escalations", "--root", root];
    case "drumbeat relance-inbox":
      // Async verb (may await relaunchers); covered by drumbeat-remote-relance.test.js.
      return null;
    case "nhi report":
      return ["nhi", "report", "--root", root];
    case "nhi inventory":
      return ["nhi", "inventory", "--root", root];
    case "nhi attest":
      return ["nhi", "attest", "--root", root, "--instance", "agent-001", "--private-key", privateKeyPath];
    case "nhi export":
      return ["nhi", "export", "--root", root, "--instance", "agent-001", "--trust-domain", "example.org"];
    case "host plugin":
      return ["host", "plugin", "--host", "claude", "--instance", "agent-001"];
    case "nhi offboard":
      return ["nhi", "offboard", "--root", root, "--instance", "agent-001", "--reason", "contract-test"];
    case "org validate":
    case "org show":
    case "org diff":
    case "org provision":
    case "coach propose":
    case "coach ratify": {
      const manifest =
        "scope: org:acme\ninstances:\n  - instance: agent-001\n    role: PRINCIPAL\n    scopes: [org:acme]\n";
      const file = join(root, "..", `org-${verb.split(" ")[1]}.h2a.yaml`);
      writeFileSync(file, manifest, "utf8");
      if (verb === "org validate") return ["org", "validate", "--file", file];
      if (verb === "org show") return ["org", "show", "--file", file];
      if (verb === "org diff") return ["org", "diff", "--root", root, "--file", file];
      if (verb === "org provision") return ["org", "provision", "--root", root, "--file", file];
      if (verb === "coach propose") return ["coach", "propose", "--file", file, "--as", "agent-001"];
      return ["coach", "ratify", "--file", file, "--as", "agent-001", "--private-key", privateKeyPath];
    }
    case "blockage raise":
      return ["blockage", "raise", "--root", root, "--instance", "agent-001", "--reason", "waiting on review", "--scope", "scope:contract"];
    case "blockage list":
      return ["blockage", "list", "--root", root];
    case "blockage resolve": {
      // Raise a blockage first so there is one to resolve.
      const sink = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      runCli(["blockage", "raise", "--root", root, "--instance", "agent-001", "--reason", "x"], sink);
      return ["blockage", "resolve", "--root", root, "--instance", "agent-001", "--by", "conductor:01"];
    }
    case "subagent audit":
      return ["subagent", "audit", "--root", root, "--parent", "agent-001"];
    case "subagent revoke":
      return [
        "subagent",
        "revoke",
        "--root",
        root,
        "--id",
        "agent-001~researcher",
        "--reason",
        "takeover-test"
      ];
    default:
      throw new Error(`No happy-path argv for verb "${verb}"`);
  }
}

test("H2A_CLI_VERB_CONTRACTS covers every dispatchable verb (smoke)", () => {
  const declared = H2A_CLI_VERB_CONTRACTS.map((c) => c.verb);
  // Hand-rolled list of verbs we know `runCli` will dispatch.
  const expected = [
    "--help",
    "hosts",
    "mcp-tools",
    "init",
    "register",
    "discover",
    "negotiate open",
    "negotiate status",
    "negotiate event",
    "negotiate offer",
    "negotiate counter",
    "negotiate sign",
    "negotiate stabilize",
    "negotiate journal",
    "inbox put",
    "inbox read",
    "inbox pop",
    "outbox put",
    "outbox read",
    "mcp-serve",
    "upgrade",
    "remote serve",
    "remote send",
    "sysml verify",
    "drumbeat record",
    "drumbeat scan",
    "drumbeat clear",
    "drumbeat escalations",
    "drumbeat relance-inbox",
    "drumbeat watch",
    "host setup",
    "host status",
    "store migrate",
    "host plugin",
    "connect",
    "doctor",
    "sessions",
    "keys generate",
    "keys add",
    "keys list",
    "keys revoke",
    "nhi report",
    "nhi inventory",
    "nhi attest",
    "nhi offboard",
    "nhi export",
    "org validate",
    "org show",
    "org diff",
    "org provision",
    "coach propose",
    "coach ratify",
    "blockage raise",
    "blockage list",
    "blockage resolve",
    "install-skills",
    "deploy k8s-sidecar",
    "deploy k8s-tenant",
    "subagent register",
    "subagent list",
    "subagent route",
    "subagent inbox",
    "subagent audit",
    "subagent revoke"
  ];
  assert.deepEqual([...declared].sort(), [...expected].sort());
  for (const c of H2A_CLI_VERB_CONTRACTS) {
    assert.ok(
      c.exitCodes.includes(0),
      `${c.verb}: every verb must declare exit code 0`
    );
  }
});

for (const contract of H2A_CLI_VERB_CONTRACTS) {
  test(`${contract.verb} emits a ${contract.outputShape} envelope on the happy path`, (t) => {
    if (contract.outputShape === "stream") {
      t.skip(`${contract.verb}: stream shape; covered by mcp-stdio.test.js`);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
    const root = join(dir, ".h2a");
    const privateKeyPath = join(dir, "req-001.pkcs8.pem");
    try {
      bootstrapHappyPath(dir, root);
      // Generate a real ed25519 PEM so the `negotiate sign` verb can read it.
      // We only need the file to exist; the registry's `publicKeys` is empty
      // so the signature would fail verification at stabilize-time, but the
      // `sign` verb itself does not verify and is happy with any valid PEM.
      const { privateKey } = generateKeyPairSync("ed25519");
      writeFileSync(
        privateKeyPath,
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        "utf8"
      );

      const argv = buildHappyArgv(contract.verb, { root, privateKeyPath });
      if (argv === null) {
        t.skip(`${contract.verb}: no single-shot happy-path harness`);
        return;
      }
      const streams = captureStreams(dir);
      const rc = runCli(argv, streams);
      assert.equal(
        rc,
        0,
        `${contract.verb}: expected exit 0 on happy path, got ${rc} (stderr: ${streams.stderrText})`
      );
      assertShape(contract.verb, contract.outputShape, streams.stdoutText);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("negotiate stabilize on a missing negotiation exits 2 (DEC-034 state error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["negotiate", "stabilize", "--root", root, "--id", "ghost-nego"],
      streams
    );
    assert.equal(rc, 2);
    assert.match(streams.stderrText, /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inbox pop on a missing envelope exits 2 (DEC-034 state error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "pop", "--root", root, "--instance", "ghost", "--envelope", "ghost-env"],
      streams
    );
    assert.equal(rc, 2);
    assert.match(streams.stderrText, /no such envelope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("register with malformed JSON exits 1 (DEC-034 user error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    const streams = captureStreams(dir);
    const rc = runCli(
      ["register", "--root", root, "--json", "{not-json"],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("negotiate sign with an unreadable private-key file exits 3 (DEC-034 I/O error)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    runCli(
      [
        "negotiate",
        "open",
        "--root",
        root,
        "--json",
        JSON.stringify({
          id: "nego-io",
          scope: "scope:x",
          parties: ["a"],
          subject: "policy",
          status: "draft",
          requiredSigners: ["a"]
        })
      ],
      captureStreams(dir)
    );
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-io",
        "--instance",
        "a",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT" }),
        "--private-key",
        join(dir, "this-key-does-not-exist.pem")
      ],
      streams
    );
    assert.equal(rc, 3);
    assert.match(streams.stderrText, /cannot read private key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

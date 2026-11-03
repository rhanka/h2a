// DEC-034 — drive every entry of `H2A_CLI_VERB_CONTRACTS` through a happy-path
// invocation and assert the emitted payload conforms to the declared envelope
// shape (resource / list / action / text / stream). Sync verbs go through
// `runCli`; async one-shot and long-running `stream` verbs go through the
// bounded streaming harness below (temporary root, first envelope read + shape
// assertion, guaranteed clean stop — abort signal, stdin EOF or child kill on
// the PID we spawned). `keepalive` is the one remaining skip: its declared
// `action` shape cannot match its text-only stdout (see the plan at
// docs/plan/reenable-cli-contract-happy-paths.md).
//
// Then assert the new exit-code classification (DEC-034) for a handful of
// representative failure modes:
//   - `negotiate stabilize` on a missing negotiation → exit 2 (state error).
//   - `inbox pop` on a missing envelope → exit 2 (state error).
//   - `register` with malformed JSON → exit 1 (user error).
//   - `negotiate sign` with a missing private-key file → exit 3 (I/O error).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from "../dist/runtime/mcp/tools.js";

import {
  H2A_CLI_VERB_CONTRACTS,
  H2A_CLI_MCP_TOOL_NAMES,
  cmdUpgrade,
  createEnvelope,
  createLocalStore,
  formatSignedDriveInstruction,
  identityKeyPaths,
  recordStop,
  runCli,
  runDriveServe,
  runDrumbeatRelanceInbox,
  runMcpServe,
  signEnvelope
} from "../dist/index.js";
import {
  runCanevasServeCli,
  runDrumbeatWatch,
  runLoopEngineCli,
  runSysmlVerify
} from "../dist/cli.js";
import { runFocusServeCli } from "../dist/runtime/focus/serve.js";

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

  // WP-2: register the host-qualified alias for req-001 so `inbox put` to
  // "claude:req-001" resolves to deliver-dormant (registered, no live session)
  // rather than being refused as a phantom.
  const reqQualifiedRegistration = {
    id: "claude:req-001",
    instance: "claude:req-001",
    roles: ["CONDUCTOR"],
    scopes: ["scope:contract"],
    capabilities: ["negotiate", "sign"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  };
  runCli(
    ["register", "--root", root, "--json", JSON.stringify(reqQualifiedRegistration)],
    captureStreams(dir)
  );

  // An AGENTS parent so `subagent register/list` (DEC-068) has a valid parent.
  const agentRegistration = {
    id: "agent-001",
    instance: "agent-001",
    roles: ["AGENTS"],
    scopes: ["scope:contract"],
    capabilities: ["negotiate", "research", "attester-comprehension"],
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
      "claude:req-001",
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
function ensureContractLoop(root) {
  const sink = {
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    cwd: () => process.cwd()
  };
  runCli(
    [
      "loop",
      "create",
      "--root",
      root,
      "--id",
      "loop-contract",
      "--name",
      "Contract loop",
      "--goal",
      "Exercise the Objective Loop CLI contract",
      "--agent",
      "claude:conductor:local"
    ],
    sink
  );
}

/**
 * Register the drive pair `drive`/`drive receive` need: claude:lead (CONDUCTOR
 * holding the `drive` capability + the ed25519 public key) and codex:worker
 * (AGENTS, conducted by the lead). Writes the lead's private key next to the
 * root and returns its path.
 */
function ensureDrivePair(root) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = join(root, "..", "drive-lead.pkcs8.pem");
  writeFileSync(privateKeyPath, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "utf8");
  const store = createLocalStore({ root });
  store.registerInstance({
    id: "claude:lead",
    instance: "claude:lead",
    roles: ["CONDUCTOR"],
    scopes: ["scope:contract"],
    capabilities: ["drive"],
    endpoints: [],
    publicKeys: [publicKey.export({ format: "pem", type: "spki" }).toString()],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  store.registerInstance({
    id: "codex:worker",
    instance: "codex:worker",
    roles: ["AGENTS"],
    scopes: ["scope:contract"],
    conductor: "claude:lead",
    capabilities: ["execute"],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-20T00:00:00.000Z"
  });
  return privateKeyPath;
}

function buildHappyArgv(verb, ctx) {
  const { root, privateKeyPath, publicKeyPath } = ctx;
  switch (verb) {
    case "central status":
    case "central stop":
      return [...verb.split(" "), "--runtime-base", dirname(root)];
    case "--help":
      return ["--help"];
    case "explain":
      return ["explain"];
    case "hosts":
      return ["hosts"];
    case "mcp-tools":
      return ["mcp-tools"];
    case "report-context":
      return ["report-context", "--workspace-root", join(root, ".."), "--root", root];
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
    case "send": {
      const sender = "claude:req-001";
      const privateKeyPem = readFileSync(privateKeyPath, "utf8");
      const publicKeyPem = readFileSync(publicKeyPath, "utf8");
      const store = createLocalStore({ root });
      store.addInstanceKey(sender, publicKeyPem);
      const localKey = identityKeyPaths(root, sender).privateKeyPath;
      mkdirSync(join(root, "keys"), { recursive: true });
      writeFileSync(localKey, privateKeyPem, "utf8");
      return ["send", sender, "contract hello", "--from", sender, "--root", root];
    }
    case "loop create":
      return [
        "loop",
        "create",
        "--root",
        root,
        "--id",
        "loop-contract",
        "--name",
        "Contract loop",
        "--goal",
        "Exercise the Objective Loop CLI contract",
        "--repo",
        "/tmp/repo:target",
        "--track",
        JSON.stringify({
          system: "track",
          repoKey: "h2a",
          workspace: "ws:test",
          aggregateKind: "wp",
          aggregateId: "WP-1",
          role: "target"
        }),
        "--agent",
        "claude:conductor:local"
      ];
    case "loop enable-auto-tick":
      ensureContractLoop(root);
      return ["loop", "enable-auto-tick", "loop-contract", "--root", root];
    case "loop list":
      ensureContractLoop(root);
      return ["loop", "list", "--root", root];
    case "loop status":
      ensureContractLoop(root);
      return ["loop", "status", "loop-contract", "--root", root];
    case "loop agents":
      ensureContractLoop(root);
      return ["loop", "agents", "loop-contract", "--root", root];
    case "loop attach":
      ensureContractLoop(root);
      return ["loop", "attach", "loop-contract", "--root", root, "--agent", "conductor"];
    case "loop logs":
      ensureContractLoop(root);
      return ["loop", "logs", "loop-contract", "--root", root];
    case "loop tick":
    case "loop watch":
      // Async (lazy runtime import + periodic) → handled by ASYNC_HAPPY_PATHS
      // (in-process runLoopEngineCli), not this sync harness.
      return null;
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
    case "negotiate stabilize": {
      // Stabilize verifies the quorum signature against the signer's REGISTERED
      // public keys, so the harness mints its own negotiation with a properly
      // registered signer (same recipe as cli-negotiate-sign-stabilize.test.js):
      // register signer + key, open, offer the artifact, sign, then stabilize.
      const sink = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      runCli(
        [
          "register",
          "--root",
          root,
          "--json",
          JSON.stringify({
            id: "signer:contract",
            instance: "signer:contract",
            roles: ["CONDUCTOR"],
            scopes: ["scope:contract"],
            capabilities: [],
            endpoints: [],
            publicKeys: [readFileSync(publicKeyPath, "utf8")],
            acceptedPolicies: [],
            createdAt: "2026-05-20T00:00:00.000Z"
          })
        ],
        sink
      );
      runCli(
        [
          "negotiate",
          "open",
          "--root",
          root,
          "--json",
          JSON.stringify({
            id: "nego-stab",
            scope: "scope:contract",
            parties: ["signer:contract"],
            subject: "engagement",
            status: "draft",
            requiredSigners: ["signer:contract"]
          })
        ],
        sink
      );
      const artifact = { kind: "ENGAGEMENT", id: "engagement:stab", goal: "demo" };
      runCli(
        [
          "negotiate",
          "offer",
          "--root",
          root,
          "--id",
          "nego-stab",
          "--instance",
          "signer:contract",
          "--artifact",
          JSON.stringify(artifact),
          "--event-id",
          "evt-stab-offer"
        ],
        sink
      );
      runCli(
        [
          "negotiate",
          "sign",
          "--root",
          root,
          "--id",
          "nego-stab",
          "--instance",
          "signer:contract",
          "--artifact",
          JSON.stringify(artifact),
          "--private-key",
          privateKeyPath,
          "--event-id",
          "evt-stab-sign"
        ],
        sink
      );
      return ["negotiate", "stabilize", "--root", root, "--id", "nego-stab"];
    }
    case "negotiate journal":
      return ["negotiate", "journal", "--root", root, "--id", "nego-cc"];
    case "declare-interest":
      return [
        "declare-interest",
        "--root",
        root,
        "--negotiation",
        "nego-cc",
        "--instance",
        "req-001",
        "--interets",
        "vendor stake"
      ];
    case "conflict-posture":
      return ["conflict-posture", "--root", root, "--negotiation", "nego-cc"];
    case "dossier":
      return ["dossier", "--root", root, "--negotiation", "nego-cc"];
    case "confiance":
      return ["confiance", "--root", root, "--negotiation", "nego-cc"];
    case "attest-comprehension":
      return [
        "attest-comprehension",
        "--root",
        root,
        "--instance",
        "agent-001",
        "--dossier",
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "--private-key",
        privateKeyPath,
        "--negotiation",
        "nego-cc",
        "--event-id",
        "evt-cc-comprehension"
      ];
    case "comprehension list": {
      const sink = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      runCli(
        [
          "attest-comprehension",
          "--root",
          root,
          "--instance",
          "agent-001",
          "--dossier",
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "--private-key",
          privateKeyPath,
          "--negotiation",
          "nego-cc",
          "--event-id",
          "evt-cc-comprehension-list"
        ],
        sink
      );
      return ["comprehension", "list", "--root", root, "--negotiation", "nego-cc"];
    }
    case "comprehension verify": {
      const sink = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      let envelopeJson = "";
      const capture = {
        stdout: { write: (chunk) => void (envelopeJson += chunk) },
        stderr: sink.stderr,
        cwd: sink.cwd
      };
      runCli(
        [
          "attest-comprehension",
          "--root",
          root,
          "--instance",
          "agent-001",
          "--dossier",
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          "--private-key",
          privateKeyPath
        ],
        capture
      );
      return [
        "comprehension",
        "verify",
        "--root",
        root,
        "--json",
        envelopeJson,
        "--public-key",
        publicKeyPath
      ];
    }
    case "inbox put":
      return [
        "inbox",
        "put",
        "--root",
        root,
        "--instance",
        "claude:req-001",
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
      return ["inbox", "read", "--root", root, "--instance", "claude:req-001"];
    case "inbox pop":
      return [
        "inbox",
        "pop",
        "--root",
        root,
        "--instance",
        "claude:req-001",
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
      // Long-running JSON-RPC stdio loop → handled by ASYNC_HAPPY_PATHS
      // (initialize round-trip + clean EOF shutdown).
      return null;
    case "host setup":
      return ["host", "setup", "--host", "codex", "--print"];
    case "host status":
      return ["host", "status"];
    case "store migrate":
      return ["store", "migrate", "--root", root];
    case "store index-launch":
      return ["store", "index-launch", "--root", root];
    case "connect":
      return ["connect", "--host", "claude", "--root", root, "--instance", "claude:contract"];
    case "doctor":
      return ["doctor", "--root", root];
    case "status":
      return ["status", "--root", root];
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
    case "keys prove-control":
      // Resolves the LIVE identity in this temp root (minting the keypair on the
      // way) and signs the simulated challenge. No network: the verb has no
      // transport at all. The nonce must be a real one — base64url, >=256 bits —
      // because the verb validates the SHAPE, not just a length bound.
      return [
        "keys",
        "prove-control",
        "--root",
        root,
        "--host",
        "claude",
        "--nonce",
        randomBytes(32).toString("base64url")
      ];
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
    case "drive": {
      // authorizeDrive needs a registered driver pair: claude:lead (CONDUCTOR
      // with the `drive` capability + public key) and codex:worker (AGENTS,
      // conducted by the lead). The logging driver makes it a dry-run.
      const privateKeyPath = ensureDrivePair(root);
      return [
        "drive",
        "--root",
        root,
        "--from",
        "claude:lead",
        "--to",
        "codex:worker",
        "--instruction",
        "Read your inbox.",
        "--private-key",
        privateKeyPath,
        "--driver",
        "logging",
        "--nonce",
        "nonce-contract",
        "--at",
        "2026-05-31T02:00:00.000Z"
      ];
    }
    case "drive receive": {
      // The verify-before-act gate needs a properly signed line for the
      // registered pair; `--now` pins the freshness window.
      const privateKeyPath = ensureDrivePair(root);
      const line = formatSignedDriveInstruction({
        from: "claude:lead",
        to: "codex:worker",
        instruction: "Read your inbox.",
        nonce: "nonce-contract-recv",
        at: "2026-05-31T02:00:00.000Z",
        privateKeyPem: readFileSync(privateKeyPath, "utf8")
      });
      return [
        "drive",
        "receive",
        "--root",
        root,
        "--to",
        "codex:worker",
        "--line",
        line,
        "--now",
        String(Date.parse("2026-05-31T02:00:01.000Z"))
      ];
    }
    case "drive serve":
      // Long-running HTTP endpoint → handled by ASYNC_HAPPY_PATHS
      // (onListening seam + clean server close).
      return null;
    case "sysml verify":
      // Async one-shot (network only on the --content-integrity path) → handled
      // by ASYNC_HAPPY_PATHS (in-process runSysmlVerify, commit-trust only).
      return null;
    case "upgrade":
      // Never a real install here: the runner invokes cmdUpgrade with the
      // injected DEC-107 runtime (see injectedUpgradeRuntime) so every side
      // effect lands in the test's temp dir.
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
      // Async one-shot → handled by ASYNC_HAPPY_PATHS (in-process
      // runDrumbeatRelanceInbox on a seeded temp root).
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
    case "thread":
      // An empty thread (no matching threadId) is a valid `list` happy path.
      return ["thread", "--id", "thr:1", "--instance", "claude:x:abc", "--root", root];
    case "keepalive":
      // STILL SKIPPED (the only one left): DEC-034 declares this verb
      // "action" ({ok:true} JSON envelope) but it never writes JSON to
      // stdout — only text lines "h2a keepalive: refreshed …", and nothing
      // at all when no live tmux pane matches. Enabling it needs a DEC-034
      // amendment (re-declare the shape or make the verb emit an envelope).
      // Blocking dependency + target date: docs/plan/reenable-cli-contract-happy-paths.md §4.
      return null;
    case "conductor":
      // Read-only resolver; workspace defaults to cwd (no flags needed).
      return ["conductor", "--root", root];
    case "conductor claim":
      // Claim by instance; workspace defaults to cwd.
      return ["conductor", "claim", "--instance", "claude:test:aaaaaaaaaaaa", "--root", root];
    case "conductor release":
      // Release is a no-op when no prior claim exists; still exits 0.
      return ["conductor", "release", "--instance", "claude:test:aaaaaaaaaaaa", "--root", root];
    case "conductor-launch-check":
      // DRY-RUN: track may be absent in CI (trackAvailable=false is graceful).
      return ["conductor-launch-check", "--root", root];
    case "conductor-launch":
      // Without --confirm → DRY-RUN preview (recommendation="none" since track absent, action="none").
      return ["conductor-launch", "--root", root];
    case "canevas list":
      // Read-only aggregate; empty on a fresh root → resource envelope.
      return ["canevas", "list", "--root", root];
    case "harness":
      // Namespaced passthrough to @sentropic/harness. `harness --help` prints
      // its usage (text) and exits 0 (help is not an error); deeper parity vs
      // the standalone `harness` bin is covered by harness-facade.test.js.
      return ["harness", "--help"];
    case "registry catalog":
      return ["registry", "catalog"];
    case "registry bootstrap":
      // Preview writes nothing, needs no lock, exits 0 with an action envelope.
      return ["registry", "bootstrap", "preview", "--host", "claude", "--config", join(root, "mcp.json")];
    case "hosted-lock":
      return ["hosted-lock", "draft", "--lock", join(root, "hosted.lock.json")];
    default:
      throw new Error(`No happy-path argv for verb "${verb}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded streaming / async harness (DEC-034 reactivation, 2026-10-12).
//
// Long-running `stream` verbs and async one-shot verbs cannot go through the
// synchronous `runCli` happy path. Each harness below starts the verb in its
// OWN temporary root, reads the FIRST envelope it emits, asserts the declared
// shape, then stops it cleanly: AbortSignal for in-process servers/watchers,
// stdin EOF for stdio JSON-RPC servers, SIGTERM (SIGKILL as a last resort, only
// ever on the PID this test spawned) for a spawned child. Every wait is
// deadline-bounded so a stuck command fails the test instead of hanging the
// suite. No real h2a state is ever reached: spawned children get a temporary
// HOME / XDG_RUNTIME_DIR / H2A_ROOT.
// ─────────────────────────────────────────────────────────────────────────────

const BIN_PATH = join(process.cwd(), "packages", "h2a", "dist", "bin.js");

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`${label}: timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Race a runner promise against a hard deadline; `cleanup` always runs. */
async function settleBounded(promise, label, timeoutMs, cleanup) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: did not settle within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
    cleanup?.();
  }
}

function captureAsyncStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (chunk) => void (stdout += chunk) },
      stderr: { write: (chunk) => void (stderr += chunk) },
      cwd: () => cwd
    },
    stdoutText: () => stdout,
    stderrText: () => stderr
  };
}

function freshRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const root = join(dir, ".h2a");
  runCli(["init", "--root", root], captureStreams(dir));
  return { dir, root };
}

/** Bind an ephemeral port then release it, so a server can be pointed at it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} → ${response.statusCode}`));
        return;
      }
      let body = "";
      response.on("data", (chunk) => void (body += chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).once("error", reject).end();
  });
}

function jsonRpcInitialize(id) {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "h2a-contract-test", version: "0.0.0" }
    }
  })}\n`;
}

/**
 * The FIRST non-empty stdout line, parsed as JSON. Deliberately strict: the
 * declared envelope must be the first thing on the stream — a garbage or
 * delayed first line fails the shape assertion.
 */
async function firstEnvelopeLine(text, label) {
  await waitFor(
    () => text().split("\n").some((line) => line.trim().length > 0),
    20_000,
    `${label}: no envelope on stdout`
  );
  const line = text().split("\n").find((line) => line.trim().length > 0);
  return JSON.parse(line);
}

// `h2a mcp-serve` — JSON-RPC 2.0 over stdio. In-process (repo precedent:
// mcp-stdio.test.js): PassThrough stdin/stdout, clean stop via stdin EOF.
async function happyMcpServe() {
  const { dir, root } = freshRoot("h2a-contract-mcp-");
  try {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let out = "";
    stdout.on("data", (chunk) => void (out += chunk));
    const ac = new AbortController();
    const done = runMcpServe({ root }, { stdin, stdout, stderr, signal: ac.signal, cwd: () => dir });
    stdin.write(jsonRpcInitialize(1));
    const response = await firstEnvelopeLine(() => out, "mcp-serve");
    assert.equal(response.jsonrpc, "2.0", "mcp-serve: first envelope must be JSON-RPC 2.0");
    assert.equal(response.id, 1, "mcp-serve: response id must match the request");
    assert.equal(typeof response.result?.protocolVersion, "string", "mcp-serve: initialize result must carry a protocolVersion");
    assert.equal(response.result?.serverInfo?.name, "@sentropic/h2a", "mcp-serve: serverInfo must identify the h2a server");
    stdin.end();
    const rc = await settleBounded(done, "mcp-serve shutdown", 20_000, () => ac.abort());
    assert.equal(rc, 0, `mcp-serve: expected exit 0, got ${rc}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a track-mcp` — the runner binds to the PROCESS stdio (track's
// serveTrackMcpStdio), so in-process is impossible: spawn the worktree binary
// (never the installed `h2a`) in an isolated env and stop the PID we spawned.
async function happyTrackMcp() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-track-"));
  const trackDir = join(dir, "track");
  const runtimeDir = join(dir, "xdg-runtime");
  let child;
  try {
    mkdirSync(trackDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    child = spawn(process.execPath, [BIN_PATH, "track-mcp", "--track-dir", trackDir], {
      cwd: dir,
      env: { ...process.env, HOME: dir, XDG_RUNTIME_DIR: runtimeDir, H2A_ROOT: join(dir, ".h2a") },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    let childStderr = "";
    child.stdout.on("data", (chunk) => void (out += chunk));
    child.stderr.on("data", (chunk) => void (childStderr += chunk));
    child.stdin.write(jsonRpcInitialize(1));
    const response = await firstEnvelopeLine(() => out, "track-mcp");
    assert.equal(response.jsonrpc, "2.0", "track-mcp: first envelope must be JSON-RPC 2.0");
    assert.equal(response.id, 1, "track-mcp: response id must match the request");
    assert.equal(response.result?.serverInfo?.name, "@sentropic/track", "track-mcp: serverInfo must identify the track server");
    child.stdin.end();
    const exitCode = await settleBounded(
      new Promise((resolve) => child.once("exit", (code) => resolve(code))),
      "track-mcp exit",
      15_000,
      () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    );
    assert.equal(exitCode, 0, `track-mcp: expected exit 0, stderr: ${childStderr}`);
  } finally {
    // Guaranteed termination of ONLY the child this test spawned.
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
}

// Exercise the admitted central shim and its complete stdio wire surface.
// The private marker admits attachment; the embedded catalogue needs no host.
async function happyRegistryBridgeServe() {
  const { dir, root } = freshRoot("h2a-contract-registry-");
  const config = join(dir, "host.json"), lock = join(dir, "host.lock.json");
  const bootstrap = captureStreams(dir);
  let child, closed;
  try {
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude",
      "--config", config, "--lock", lock], bootstrap, {}), 0, bootstrap.stderrText);
    const configBefore = readFileSync(config), lockBefore = readFileSync(lock);
    const runtimeBase = join(dir, "runtime-base");
    const markerDir = join(runtimeBase, "h2a-mcp-central");
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(markerDir, "marker.json"), JSON.stringify({
      endpoint: "http://127.0.0.1:9/", generation: "contract-fixture", pid: process.pid,
      startedAt: new Date().toISOString(), token: "contract-fixture-token", protocol: 2, root
    }), { mode: 0o600 });
    const env = { ...process.env, H2A_ROOT: root, H2A_MCP_CENTRAL: "1", CLAUDE_CODE_SESSION_ID: "contract-fixture" };
    for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME",
      "XDG_CACHE_HOME", "REMOTE_CLI_CONFIG_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "TMPDIR"]) {
      env[key] = join(dir, key.toLowerCase()); mkdirSync(env[key], { mode: 0o700 });
    }
    child = spawn(process.execPath, [BIN_PATH, "registry-bridge", "serve", "--host", "claude",
      "--profile", "default", "--lock", lock, "--root", root, "--runtime-base", runtimeBase], {
      cwd: dir, env, stdio: ["pipe", "pipe", "pipe"]
    });
    closed = new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => done({ code, signal }));
    });
    closed.catch(() => {});
    let out = "", errors = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.stdin.write(jsonRpcInitialize(1));
    const initialized = await firstEnvelopeLine(() => out, "registry-bridge serve");
    assert.equal(initialized.jsonrpc, "2.0");
    assert.equal(initialized.error, undefined, errors + JSON.stringify(initialized));
    assert.equal(initialized.id, 1);
    assert.equal(typeof initialized.result?.protocolVersion, "string");
    assert.equal(initialized.result?.serverInfo?.name, "@sentropic/h2a");
    assert.equal(initialized.result?.capabilities?.tools?.listChanged, true, "central shim fingerprint");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
    const frames = () => out.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
    await waitFor(() => frames().some(row => row.id === 2), 20_000, "registry-bridge tools/list");
    const listed = frames().find(row => row.id === 2);
    assert.equal(listed.error, undefined, errors);
    const names = listed.result.tools.map(tool => tool.name);
    assert.deepEqual(names, H2A_CLI_MCP_TOOL_DESCRIPTORS.map(tool => tool.name), "bridge preserves the exact served order");
    assert.deepEqual([...names].sort(), [...H2A_CLI_MCP_TOOL_NAMES].sort());
    assert.equal(new Set(names).size, names.length, "bridge must not duplicate a tool");
    child.stdin.end();
    assert.deepEqual(await settleBounded(closed, "registry-bridge EOF", 20_000), { code: 0, signal: null }, errors);
    assert.deepEqual(readFileSync(config), configBefore, "serve must not rewrite host configuration");
    assert.deepEqual(readFileSync(lock), lockBefore, "serve must not rewrite its deployment lock");
    console.log(`registry-bridge contract: initialize and ${names.length} tools verified; EOF exit0; config/lock unchanged`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      let timer;
      try {
        const stopped = await Promise.race([closed.then(() => true, () => true), new Promise(done => {
          timer = setTimeout(() => done(false), 1000);
        })]);
        if (!stopped) {
          child.kill("SIGKILL");
          await settleBounded(closed, "registry-bridge forced cleanup", 3000);
        }
      } finally { clearTimeout(timer); }
    } else if (closed) await closed.catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a loop tick` — async (lazy runtime import), so it cannot go through the
// sync runCli harness. In-process via the exported runner bin.ts calls.
async function happyLoopTick() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-loop-"));
  try {
    const created = captureAsyncStreams(dir);
    assert.equal(runCli(["loop", "create", "--name", "t", "--goal", "g", "--root", dir], created.streams), 0, created.stderrText());
    const loopId = JSON.parse(created.stdoutText()).id;
    const cap = captureAsyncStreams(dir);
    const rc = await settleBounded(runLoopEngineCli(["loop", "tick", loopId, "--root", dir], cap.streams), "loop tick", 30_000);
    assert.equal(rc, 0, `loop tick: expected exit 0, got ${rc} (stderr: ${cap.stderrText()})`);
    const plan = JSON.parse(cap.stdoutText());
    assert.equal(plan.loopId, loopId, "loop tick: plan must reference the loop");
    assert.equal(typeof plan.outcome, "string", "loop tick: plan must carry an outcome");
    assert.ok(Array.isArray(plan.actions), "loop tick: plan must carry an actions array");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a loop watch` — periodic, but `--max 1` makes it self-terminating after
// exactly one emitted plan (the stream's first envelope).
async function happyLoopWatch() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-loopw-"));
  try {
    const created = captureAsyncStreams(dir);
    assert.equal(runCli(["loop", "create", "--name", "t", "--goal", "g", "--root", dir], created.streams), 0, created.stderrText());
    const loopId = JSON.parse(created.stdoutText()).id;
    const cap = captureAsyncStreams(dir);
    const rc = await settleBounded(
      runLoopEngineCli(["loop", "watch", loopId, "--root", dir, "--max", "1"], cap.streams),
      "loop watch --max 1",
      30_000
    );
    assert.equal(rc, 0, `loop watch: expected exit 0, got ${rc} (stderr: ${cap.stderrText()})`);
    const plan = JSON.parse(cap.stdoutText().split("\n")[0]);
    assert.equal(plan.loopId, loopId, "loop watch: first envelope must be the plan of this loop");
    assert.ok(plan.exec, "loop watch: the executed beat must carry an execution report");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a canevas serve` — read-only HTTP surface. In-process with an AbortSignal;
// first envelope = the bind banner, then a real GET proves the stream serves.
async function happyCanevasServe() {
  const { dir, root } = freshRoot("h2a-contract-canevas-");
  const port = await freePort();
  const cap = captureAsyncStreams(dir);
  const ac = new AbortController();
  try {
    const done = runCanevasServeCli(["canevas", "serve", "--root", root, "--port", String(port)], cap.streams, ac.signal);
    await waitFor(
      () => new RegExp(`on http://127\\.0\\.0\\.1:${port}`).test(cap.stderrText()),
      10_000,
      "canevas serve: no bind banner"
    );
    const decisions = await httpGetJson(`http://127.0.0.1:${port}/api/decisions`);
    assert.equal(decisions.kind, "canevas-decisions", "canevas serve: /api/decisions must return the canevas aggregate");
    assert.ok(Array.isArray(decisions.decisions), "canevas serve: aggregate must carry a decisions array");
    ac.abort();
    const rc = await settleBounded(done, "canevas serve shutdown", 10_000);
    assert.equal(rc, 0, `canevas serve: expected exit 0 after abort, got ${rc}`);
  } finally {
    ac.abort();
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a focus serve` / `h2a focus web` — packaged web app on a tracked temp repo.
// In-process with an AbortSignal; first envelope = the "Focus Web:" URL line.
async function happyFocusServe(sub) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-focus-"));
  const ac = new AbortController();
  try {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".track"), { recursive: true });
    writeFileSync(join(repo, ".track", "events.jsonl"), "", "utf8");
    const cap = captureAsyncStreams(dir);
    const done = runFocusServeCli(["focus", sub, "--repo", repo, "--port", "0"], cap.streams, ac.signal);
    await waitFor(
      () => /Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(cap.stdoutText()),
      15_000,
      `focus ${sub}: no bind banner`
    );
    assert.match(cap.stdoutText(), /Repository: \S+/, `focus ${sub}: banner must name the served repository`);
    ac.abort();
    const rc = await settleBounded(done, `focus ${sub} shutdown`, 10_000);
    assert.equal(rc, 0, `focus ${sub}: expected exit 0 after abort, got ${rc}`);
  } finally {
    ac.abort();
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a drive serve` — long-running HTTP injection endpoint. In-process with the
// onListening seam; first envelope = the "listening on" line; stop = close.
async function happyDriveServe() {
  const { dir, root } = freshRoot("h2a-contract-driveserve-");
  const cap = captureAsyncStreams(dir);
  let server;
  try {
    const done = runDriveServe(
      { to: "claude:worker", "inject-command": "true", root, port: "0" },
      { ...cap.streams, cwd: () => dir, onListening: (bound) => void (server = bound) }
    );
    await waitFor(
      () => /h2a drive serve: listening on http:\/\/127\.0\.0\.1:\d+\/h2a\/drive/.test(cap.stdoutText()),
      10_000,
      "drive serve: no listening banner"
    );
    assert.match(cap.stdoutText(), /\(to claude:worker, root \S+\)/, "drive serve: banner must name the target and root");
    server.close();
    const rc = await settleBounded(done, "drive serve shutdown", 10_000);
    assert.equal(rc, 0, `drive serve: expected exit 0 after close, got ${rc}`);
  } finally {
    try { server?.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a drumbeat watch` — anti-stall daemon. In-process with an AbortSignal;
// first envelope = the "watching" banner; the seeded stop entry also gets a
// logging relance on the first beat.
async function happyDrumbeatWatch() {
  const { dir, root } = freshRoot("h2a-contract-drumbeatw-");
  recordStop(root, { instance: "claude:stalled", workStatus: "out-of-tokens", launchContext: { command: "echo hi" } });
  const cap = captureAsyncStreams(dir);
  const ac = new AbortController();
  try {
    const done = runDrumbeatWatch(
      { root, "interval-ms": "60000", relauncher: "logging" },
      { ...cap.streams, cwd: () => dir, signal: ac.signal }
    );
    await waitFor(
      () => /h2a drumbeat watch: watching \S+ every \d+ms \(relauncher=logging/.test(cap.stdoutText()),
      10_000,
      "drumbeat watch: no watch banner"
    );
    ac.abort();
    const rc = await settleBounded(done, "drumbeat watch shutdown", 10_000);
    assert.equal(rc, 0, `drumbeat watch: expected exit 0 after abort, got ${rc}`);
  } finally {
    ac.abort();
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a sysml verify` — async one-shot; commit-trust only (no --content-integrity
// → no network). Signed envelope with a sysmlRef, verified against a PEM file.
async function happySysmlVerify() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-contract-sysml-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPath = join(dir, "sysml.spki.pem");
    writeFileSync(publicKeyPath, publicKey.export({ format: "pem", type: "spki" }).toString(), "utf8");
    const envelope = signEnvelope(
      createEnvelope({
        id: "env-sysml-contract",
        type: "event",
        actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:model" },
        body: {
          kind: "ENGAGEMENT",
          subject: { sysmlRef: { kind: "sysmlv2", apiBase: "https://repo.example/api", project: "proj-1", commit: "c0ffee", element: "el-42" } }
        }
      }),
      { by: "conductor:01", privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString() }
    );
    const cap = captureAsyncStreams(dir);
    const rc = await settleBounded(
      runSysmlVerify({ json: JSON.stringify(envelope), "public-key": publicKeyPath, by: "conductor:01" }, cap.streams),
      "sysml verify",
      15_000
    );
    assert.equal(rc, 0, `sysml verify: expected exit 0, got ${rc} (stderr: ${cap.stderrText()})`);
    const result = JSON.parse(cap.stdoutText());
    assert.equal(result.ok, true, "sysml verify: envelope must verify");
    assert.equal(result.signatureVerified, true, "sysml verify: commit-trust must verify the signature");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `h2a drumbeat relance-inbox` — async one-shot. A stopped entry + a
// drumbeat.resume envelope; the logging relauncher also logs to stdout, so the
// action envelope is the final JSON object on stdout.
async function happyDrumbeatRelanceInbox() {
  const { dir, root } = freshRoot("h2a-contract-relance-");
  const target = "claude:remote";
  try {
    createLocalStore({ root }).putInboxMessage(
      target,
      createEnvelope({
        id: "env-resume-contract",
        type: "event",
        actor: { instance: "codex:watch", role: "AGENTS", scope: "scope:contract" },
        target: { instance: target },
        body: { kind: "drumbeat.resume", target, reason: "stopped", requestedBy: "codex:watch" },
        createdAt: new Date().toISOString()
      })
    );
    recordStop(root, { instance: target, workStatus: "paused", launchContext: { command: "echo relance" } });
    const cap = captureAsyncStreams(dir);
    const rc = await settleBounded(
      runDrumbeatRelanceInbox({ root, instance: target, relauncher: "logging" }, cap.streams),
      "drumbeat relance-inbox",
      15_000
    );
    assert.equal(rc, 0, `drumbeat relance-inbox: expected exit 0, got ${rc} (stderr: ${cap.stderrText()})`);
    const envelopeStart = cap.stdoutText().indexOf("{");
    assert.ok(envelopeStart !== -1, "drumbeat relance-inbox: expected an action envelope on stdout");
    const envelope = JSON.parse(cap.stdoutText().slice(envelopeStart));
    assert.equal(envelope.ok, true, "drumbeat relance-inbox: action envelope must include ok: true");
    assert.ok(envelope.relanced.includes(target), "drumbeat relance-inbox: the stopped entry must be relanced");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Async happy paths keyed by verb; the sync loop below skips these. */
const ASYNC_HAPPY_PATHS = new Map([
  ["loop tick", happyLoopTick],
  ["loop watch", happyLoopWatch],
  ["mcp-serve", happyMcpServe],
  ["track-mcp", happyTrackMcp],
  ["registry-bridge serve", happyRegistryBridgeServe],
  ["canevas serve", happyCanevasServe],
  ["focus serve", () => happyFocusServe("serve")],
  ["focus web", () => happyFocusServe("web")],
  ["drive serve", happyDriveServe],
  ["drumbeat watch", happyDrumbeatWatch],
  ["sysml verify", happySysmlVerify],
  ["drumbeat relance-inbox", happyDrumbeatRelanceInbox]
]);

/**
 * Exact reasons for the verbs that still cannot be enabled. Everything not
 * listed here is exercised for real. See
 * docs/plan/reenable-cli-contract-happy-paths.md for the analysis.
 */
const NO_HAPPY_PATH_REASONS = new Map([
  [
    "keepalive",
    "DEC-034 declares an \"action\" ({ok:true} JSON) envelope but the verb only writes plain-text " +
      "\"h2a keepalive: refreshed …\" lines (nothing at all without a live tmux pane) — needs a DEC-034 " +
      "amendment; blocking dependency and target date in docs/plan/reenable-cli-contract-happy-paths.md §4"
  ]
]);

/**
 * DEC-107 upgrade runtime, fully injected: every side effect (registry fetch,
 * staging, swap, prefix) is fake and pointed at the test's temp dir. The real
 * installation is never touched — `runInstall` would be a real global npm
 * install, so it throws if the staged path ever falls back to it.
 */
function injectedUpgradeRuntime(prefix) {
  let swapped = false;
  return {
    now: () => 1_000_000,
    readCache: () => undefined,
    writeCache: () => {},
    fetchLatest: () => "999.0.0",
    runInstall: () => {
      throw new Error("upgrade happy path must never run a real npm install");
    },
    resolvePrefix: () => prefix,
    completeRepairIfPending: () => false,
    acquirePrefixLock: () => ({ acquired: true, release: () => {} }),
    fetchTarball: () => ({ ok: true, file: join(prefix, "staged.tgz") }),
    stageInstall: () => ({ ok: true }),
    probeStagedVersion: () => "999.0.0",
    verifyStagedNative: () => ({ ok: true }),
    swapPackageDir: () => {
      swapped = true;
      return { ok: true, repaired: false };
    },
    readGlobalPkgVersion: () => (swapped ? "999.0.0" : "0.0.0"),
    writeDiagnostics: () => {}
  };
}

test("H2A_CLI_VERB_CONTRACTS covers every dispatchable verb (smoke)", () => {
  const declared = H2A_CLI_VERB_CONTRACTS.map((c) => c.verb);
  // Hand-rolled list of verbs we know `runCli` will dispatch.
  const expected = [
    "central status",
    "central stop",
    "--help",
    // 2026-07-25: public-contract addition. This branch was written against a
    // 97-verb main; PR #30 landed `keys prove-control` first, then `explain`,
    // and `loop enable-auto-tick` raised the reconciled count to 100. Kept in exact sync with
    // docs/contracts/golden/cli-verbs.json — by `scripts/check-public-contract.sh`
    // (which diffs the golden against the built H2A_CLI_VERB_CONTRACTS) and by
    // the count guard in test/cli-command-map.test.js, which additionally covers
    // the two hand-written counts that neither the script nor this array reads.
    "explain",
    "hosts",
    "mcp-tools",
    "report-context",
    "init",
    "register",
    "discover",
    "send",
    "loop create",
    "loop enable-auto-tick",
    "loop list",
    "loop status",
    "loop agents",
    "loop attach",
    "loop logs",
    "loop tick",
    "loop watch",
    "canevas list",
    "canevas serve",
    "focus serve",
    "focus web",
    "negotiate open",
    "negotiate status",
    "negotiate event",
    "negotiate offer",
    "negotiate counter",
    "negotiate sign",
    "negotiate stabilize",
    "negotiate journal",
    "declare-interest",
    "conflict-posture",
    "dossier",
    "confiance",
    "attest-comprehension",
    "comprehension list",
    "comprehension verify",
    "inbox put",
    "inbox read",
    "inbox pop",
    "outbox put",
    "outbox read",
    "mcp-serve",
    "track-mcp",
    "upgrade",
    "drive",
    "drive receive",
    "drive serve",
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
    "store index-launch",
    "host plugin",
    "connect",
    "doctor",
    "status",
    "sessions",
    "keys generate",
    "keys add",
    "keys list",
    "keys revoke",
    "keys prove-control",
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
    "harness",
    "install-skills",
    "deploy k8s-sidecar",
    "deploy k8s-tenant",
    "subagent register",
    "subagent list",
    "subagent route",
    "subagent inbox",
    "subagent audit",
    "subagent revoke",
    "thread",
    "keepalive",
    "conductor",
    "conductor claim",
    "conductor release",
    "conductor-launch-check",
    "conductor-launch",
    "registry catalog",
    "registry bootstrap",
    "registry-bridge serve",
    "hosted-lock"
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
  const asyncPath = ASYNC_HAPPY_PATHS.get(contract.verb);
  if (asyncPath !== undefined) {
    test(`${contract.verb} emits a ${contract.outputShape} envelope on the happy path`, async () => {
      await asyncPath();
    });
    continue;
  }
  test(`${contract.verb} emits a ${contract.outputShape} envelope on the happy path`, async (t) => {
    if (contract.outputShape === "stream") {
      t.skip(`${contract.verb}: stream shape without a registered streaming harness (ASYNC_HAPPY_PATHS)`);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "h2a-contract-"));
    const root = join(dir, ".h2a");
    const privateKeyPath = join(dir, "req-001.pkcs8.pem");
    const publicKeyPath = join(dir, "req-001.spki.pem");
    try {
      bootstrapHappyPath(dir, root);
      // Generate a real ed25519 PEM so the `negotiate sign` verb can read it.
      // We only need the file to exist; the registry's `publicKeys` is empty
      // so the signature would fail verification at stabilize-time, but the
      // `sign` verb itself does not verify and is happy with any valid PEM.
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      writeFileSync(
        privateKeyPath,
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        "utf8"
      );
      writeFileSync(
        publicKeyPath,
        publicKey.export({ format: "pem", type: "spki" }).toString(),
        "utf8"
      );

      // `upgrade` bypasses runCli: it needs the DEC-107 injectable runtime so
      // the happy path never reaches the real registry or global prefix.
      const argv = contract.verb === "upgrade" ? [] : buildHappyArgv(contract.verb, { root, privateKeyPath, publicKeyPath });
      if (argv === null) {
        t.skip(`${contract.verb}: ${NO_HAPPY_PATH_REASONS.get(contract.verb) ?? "no single-shot happy-path harness"}`);
        return;
      }
      const streams = captureStreams(dir);
      let rc;
      if (contract.verb === "upgrade") {
        rc = cmdUpgrade({}, streams, injectedUpgradeRuntime(dir));
      } else {
        rc = await runCli(
          argv,
          streams,
          contract.verb === "host setup"
            ? {
                doctorHostInstallations: () => ({
                  ok: true,
                  hosts: [
                    { host: "claude", ok: true, unrepaired: [] },
                    { host: "codex", ok: true, unrepaired: [] }
                  ]
                })
              }
            : undefined
        );
      }
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

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeHash } from "@sentropic/h2a";
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

function run(argv, cwd) {
  const streams = captureStreams(cwd);
  const rc = runCli(argv, streams);
  return { rc, stdout: streams.stdoutText, stderr: streams.stderrText };
}

function keypair(dir, label) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePath = join(dir, `${label}.pkcs8.pem`);
  const publicPath = join(dir, `${label}.spki.pem`);
  writeFileSync(privatePath, privatePem, "utf8");
  writeFileSync(publicPath, publicPem, "utf8");
  return { privatePath, publicPath, publicPem };
}

function register(dir, root, reg) {
  const result = run(["register", "--root", root, "--json", JSON.stringify(reg)], dir);
  assert.equal(result.rc, 0, result.stderr);
}

function setupNegotiation(dir, root, agentCapabilities = []) {
  run(["init", "--root", root], dir);
  const agentKeys = keypair(dir, "agent_1");
  const principalKeys = keypair(dir, "principal_1");
  register(dir, root, {
    id: "agent:1",
    instance: "agent:1",
    roles: ["AGENTS"],
    scopes: ["scope:attn"],
    capabilities: agentCapabilities,
    endpoints: [],
    publicKeys: [agentKeys.publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
  register(dir, root, {
    id: "principal:1",
    instance: "principal:1",
    roles: ["PRINCIPAL"],
    scopes: ["scope:attn"],
    capabilities: [],
    endpoints: [],
    publicKeys: [principalKeys.publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
  const open = run(
    [
      "negotiate",
      "open",
      "--root",
      root,
      "--json",
      JSON.stringify({
        id: "nego-attn",
        scope: "scope:attn",
        parties: ["agent:1"],
        subject: "engagement",
        status: "draft",
        requiredSigners: ["agent:1"]
      })
    ],
    dir
  );
  assert.equal(open.rc, 0, open.stderr);
  return { agentKeys, principalKeys };
}

test("AGENTS need attester-comprehension to emit a comprehension-attestation", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-attn-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { agentKeys } = setupNegotiation(dir, root, []);
    const denied = run(
      [
        "attest-comprehension",
        "--root",
        root,
        "--instance",
        "agent:1",
        "--dossier",
        computeHash("dossier"),
        "--private-key",
        agentKeys.privatePath
      ],
      dir
    );

    assert.equal(denied.rc, 2);
    assert.match(denied.stderr, /attester-comprehension/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attest-comprehension appends a signed non-binding journal event and verifies it", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-attn-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { agentKeys } = setupNegotiation(dir, root, ["attester-comprehension"]);
    const dossierHash = computeHash({ dossier: "exact" });
    const emitted = run(
      [
        "attest-comprehension",
        "--root",
        root,
        "--instance",
        "agent:1",
        "--dossier",
        dossierHash,
        "--private-key",
        agentKeys.privatePath,
        "--negotiation",
        "nego-attn",
        "--event-id",
        "evt-comprehension-01"
      ],
      dir
    );
    assert.equal(emitted.rc, 0, emitted.stderr);
    const entry = JSON.parse(emitted.stdout);
    assert.equal(entry.type, "event");
    assert.equal(entry.artifactKind, undefined);
    assert.equal(entry.body.kind, "comprehension-attestation");
    assert.equal(entry.body.subject, "agent:1");
    assert.equal(entry.body.dossierHash, dossierHash);
    assert.equal(entry.signatures.length, 1);

    const listed = run(
      ["comprehension", "list", "--root", root, "--negotiation", "nego-attn"],
      dir
    );
    assert.equal(listed.rc, 0, listed.stderr);
    const attestations = JSON.parse(listed.stdout);
    assert.equal(attestations.length, 1);
    assert.equal(attestations[0].id, "evt-comprehension-01");

    const verified = run(
      [
        "comprehension",
        "verify",
        "--root",
        root,
        "--json",
        JSON.stringify(entry),
        "--public-key",
        agentKeys.publicPath
      ],
      dir
    );
    assert.equal(verified.rc, 0, verified.stderr);
    const verification = JSON.parse(verified.stdout);
    assert.equal(verification.ok, true);
    assert.equal(verification.subject, "agent:1");
    assert.equal(verification.dossierHash, dossierHash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a PRINCIPAL can attest comprehension without an attester-comprehension grant", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-attn-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { principalKeys } = setupNegotiation(dir, root, []);
    const result = run(
      [
        "attest-comprehension",
        "--root",
        root,
        "--instance",
        "principal:1",
        "--dossier",
        computeHash("human dossier"),
        "--private-key",
        principalKeys.privatePath
      ],
      dir
    );
    assert.equal(result.rc, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.body.kind, "comprehension-attestation");
    assert.equal(envelope.actor.role, "PRINCIPAL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("comprehension-attestation never satisfies stabilizeNegotiation quorum", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-attn-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { agentKeys } = setupNegotiation(dir, root, ["attester-comprehension"]);
    const artifact = { kind: "ENGAGEMENT", id: "engagement:attn", scope: "scope:attn", charter: {} };
    assert.equal(
      run(
        [
          "negotiate",
          "offer",
          "--root",
          root,
          "--id",
          "nego-attn",
          "--instance",
          "principal:1",
          "--artifact",
          JSON.stringify(artifact)
        ],
        dir
      ).rc,
      0
    );
    assert.equal(
      run(
        [
          "attest-comprehension",
          "--root",
          root,
          "--instance",
          "agent:1",
          "--dossier",
          computeHash(artifact),
          "--private-key",
          agentKeys.privatePath,
          "--negotiation",
          "nego-attn"
        ],
        dir
      ).rc,
      0
    );

    const stabilized = run(
      ["negotiate", "stabilize", "--root", root, "--id", "nego-attn"],
      dir
    );
    assert.equal(stabilized.rc, 2);
    assert.match(stabilized.stderr, /no artifactHash has the full quorum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

function newKeyPair(dir, name) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePath = join(dir, `${name}.pkcs8.pem`);
  writeFileSync(privatePath, privatePem, "utf8");
  return { privatePath, publicPem };
}

function setupWithSigners(dir, root, signerCount) {
  run(["init", "--root", root], dir);
  const signers = [];
  for (let i = 1; i <= signerCount; i++) {
    const id = `signer:${i}`;
    const { privatePath, publicPem } = newKeyPair(dir, id.replace(":", "_"));
    const reg = {
      id,
      instance: id,
      roles: ["CONDUCTOR"],
      scopes: ["scope:nego"],
      capabilities: [],
      endpoints: [],
      publicKeys: [publicPem],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    run(["register", "--root", root, "--json", JSON.stringify(reg)], dir);
    signers.push({ id, privatePath });
  }
  run(
    [
      "negotiate",
      "open",
      "--root",
      root,
      "--json",
      JSON.stringify({
        id: "nego-sign",
        scope: "scope:nego",
        parties: signers.map((s) => s.id),
        subject: "engagement",
        status: "draft",
        requiredSigners: signers.map((s) => s.id)
      })
    ],
    dir
  );
  return signers;
}

test("h2a negotiate sign + stabilize: full quorum stabilizes the negotiation", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-sign-"));
  const root = join(dir, ".h2a");
  try {
    const signers = setupWithSigners(dir, root, 2);

    const artifact = { kind: "ENGAGEMENT", id: "engagement:001", goal: "ship-v1" };

    for (const signer of signers) {
      const result = run(
        [
          "negotiate",
          "sign",
          "--root",
          root,
          "--id",
          "nego-sign",
          "--instance",
          signer.id,
          "--artifact",
          JSON.stringify(artifact),
          "--private-key",
          signer.privatePath,
          "--event-id",
          `evt-sign-${signer.id.replace(":", "-")}`
        ],
        dir
      );
      assert.equal(result.rc, 0);
      const entry = JSON.parse(result.stdout);
      assert.equal(entry.body.kind, "signature");
      assert.match(entry.body.artifactHash, /^sha256:/);
    }

    const stab = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(stab.rc, 0);
    const parsed = JSON.parse(stab.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.record.status, "stabilized");
    assert.match(parsed.artifactHash, /^sha256:/);
    assert.equal(parsed.signers.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate stabilize fails when quorum incomplete", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-sign-"));
  const root = join(dir, ".h2a");
  try {
    const signers = setupWithSigners(dir, root, 2);
    const artifact = { kind: "ENGAGEMENT", goal: "x" };

    run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-sign",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify(artifact),
        "--private-key",
        signers[0].privatePath
      ],
      dir
    );

    const stab = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(stab.rc, 1);
    assert.match(stab.stderr, /no artifactHash has the full quorum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate stabilize fails when signers signed different artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-sign-"));
  const root = join(dir, ".h2a");
  try {
    const signers = setupWithSigners(dir, root, 2);

    run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-sign",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ goal: "A" }),
        "--private-key",
        signers[0].privatePath
      ],
      dir
    );
    run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-sign",
        "--instance",
        signers[1].id,
        "--artifact",
        JSON.stringify({ goal: "B" }),
        "--private-key",
        signers[1].privatePath
      ],
      dir
    );

    const stab = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(stab.rc, 1);
    assert.match(stab.stderr, /no artifactHash has the full quorum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate stabilize fails when a signature does not verify against the registry key", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-sign-"));
  const root = join(dir, ".h2a");
  try {
    const signers = setupWithSigners(dir, root, 1);
    // Sign with an unrelated private key — registry has the right public key but
    // the signature was made by a different key, so verification must fail.
    const intruder = newKeyPair(dir, "intruder");
    run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-sign",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ goal: "x" }),
        "--private-key",
        intruder.privatePath
      ],
      dir
    );
    const stab = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(stab.rc, 1);
    assert.match(stab.stderr, /fails verification/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate stabilize is idempotently refused once stabilized", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-sign-"));
  const root = join(dir, ".h2a");
  try {
    const signers = setupWithSigners(dir, root, 2);
    const artifact = { goal: "z" };
    for (const s of signers) {
      run(
        [
          "negotiate",
          "sign",
          "--root",
          root,
          "--id",
          "nego-sign",
          "--instance",
          s.id,
          "--artifact",
          JSON.stringify(artifact),
          "--private-key",
          s.privatePath
        ],
        dir
      );
    }
    const first = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(first.rc, 0);
    const second = run(["negotiate", "stabilize", "--root", root, "--id", "nego-sign"], dir);
    assert.equal(second.rc, 1);
    assert.match(second.stderr, /already stabilized/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate sign requires --id --instance --artifact --private-key", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["negotiate", "sign", "--id", "x"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--id.*--instance.*--artifact.*--private-key/);
});

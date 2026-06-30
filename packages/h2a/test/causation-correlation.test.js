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

function setupRoot(signerCount = 2) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-causation-"));
  const root = join(dir, ".h2a");
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
      createdAt: "2026-05-20T00:00:00.000Z"
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
        id: "nego-chain",
        scope: "scope:nego",
        parties: signers.map((s) => s.id),
        subject: "engagement",
        status: "draft",
        requiredSigners: signers.map((s) => s.id)
      })
    ],
    dir
  );
  return { dir, root, signers };
}

test("first offer without --causation-id / --correlation-id leaves both undefined", () => {
  const { dir, root, signers } = setupRoot(2);
  try {
    const r = run(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--event-id",
        "evt-offer-1"
      ],
      dir
    );
    assert.equal(r.rc, 0);
    const entry = JSON.parse(r.stdout);
    assert.equal(entry.causationId, undefined);
    assert.equal(entry.correlationId, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a subsequent counter inherits causationId = previous entry's id", () => {
  const { dir, root, signers } = setupRoot(2);
  try {
    const offer = run(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--event-id",
        "evt-offer-1"
      ],
      dir
    );
    assert.equal(offer.rc, 0);
    const offerEntry = JSON.parse(offer.stdout);

    const counter = run(
      [
        "negotiate",
        "counter",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[1].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "b" }),
        "--event-id",
        "evt-counter-1"
      ],
      dir
    );
    assert.equal(counter.rc, 0);
    const counterEntry = JSON.parse(counter.stdout);
    assert.equal(counterEntry.causationId, offerEntry.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit --correlation-id on the first offer propagates and inherits to next entries", () => {
  const { dir, root, signers } = setupRoot(2);
  try {
    const offer = run(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--event-id",
        "evt-offer-1",
        "--correlation-id",
        "myCorr"
      ],
      dir
    );
    assert.equal(offer.rc, 0);
    const offerEntry = JSON.parse(offer.stdout);
    assert.equal(offerEntry.correlationId, "myCorr");

    const counter = run(
      [
        "negotiate",
        "counter",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[1].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "b" }),
        "--event-id",
        "evt-counter-1"
      ],
      dir
    );
    assert.equal(counter.rc, 0);
    const counterEntry = JSON.parse(counter.stdout);
    assert.equal(counterEntry.correlationId, "myCorr");
    assert.equal(counterEntry.causationId, offerEntry.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit --causation-id overrides the auto-inherited previous-id default", () => {
  const { dir, root, signers } = setupRoot(2);
  try {
    run(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--event-id",
        "evt-offer-1"
      ],
      dir
    );
    const counter = run(
      [
        "negotiate",
        "counter",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[1].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "b" }),
        "--event-id",
        "evt-counter-1",
        "--causation-id",
        "manual"
      ],
      dir
    );
    assert.equal(counter.rc, 0);
    const counterEntry = JSON.parse(counter.stdout);
    assert.equal(counterEntry.causationId, "manual");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sign verb also threads causationId / correlationId from the journal", () => {
  const { dir, root, signers } = setupRoot(1);
  try {
    const offer = run(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--event-id",
        "evt-offer-1",
        "--correlation-id",
        "thread-A"
      ],
      dir
    );
    assert.equal(offer.rc, 0);
    const offerEntry = JSON.parse(offer.stdout);

    const sign = run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-chain",
        "--instance",
        signers[0].id,
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", id: "e:1", goal: "a" }),
        "--private-key",
        signers[0].privatePath,
        "--event-id",
        "evt-sign-1"
      ],
      dir
    );
    assert.equal(sign.rc, 0);
    const signEntry = JSON.parse(sign.stdout);
    assert.equal(signEntry.causationId, offerEntry.id);
    assert.equal(signEntry.correlationId, "thread-A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

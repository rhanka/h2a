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

function keypair(dir, label) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePath = join(dir, `${label}.pkcs8.pem`);
  writeFileSync(privatePath, privatePem, "utf8");
  return { privatePath, publicPem };
}

function setupSigner(dir, root) {
  run(["init", "--root", root], dir);
  const signer = "signer:1";
  const { privatePath, publicPem } = keypair(dir, "signer_1");
  const registration = {
    id: signer,
    instance: signer,
    roles: ["CONDUCTOR"],
    scopes: ["scope:self"],
    capabilities: [],
    endpoints: [],
    publicKeys: [publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  };
  run(["register", "--root", root, "--json", JSON.stringify(registration)], dir);
  run(
    [
      "negotiate",
      "open",
      "--root",
      root,
      "--json",
      JSON.stringify({
        id: "nego-conflit",
        scope: "scope:self",
        parties: [signer],
        subject: "engagement",
        status: "draft",
        requiredSigners: [signer]
      })
    ],
    dir
  );
  return { signer, privatePath };
}

test("h2a declare-interest writes declaration-interet and conflict-posture derives signer posture", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-conflit-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { signer } = setupSigner(dir, root);

    const declared = run(
      [
        "declare-interest",
        "--root",
        root,
        "--negotiation",
        "nego-conflit",
        "--instance",
        signer,
        "--interets",
        "vendor stake,board seat",
        "--bindings",
        "scope:umbrella",
        "--masque-impact-collectif",
        "--event-id",
        "evt-declaration-01"
      ],
      dir
    );
    assert.equal(declared.rc, 0, declared.stderr);
    const entry = JSON.parse(declared.stdout);
    assert.equal(entry.body.kind, "declaration-interet");
    assert.equal(entry.body.subject, signer);
    assert.deepEqual(entry.body.interets, ["vendor stake", "board seat"]);
    assert.deepEqual(entry.body.bindings, ["scope:umbrella"]);
    assert.equal(entry.body.masqueImpactCollectif, true);

    const postureResult = run(
      ["conflict-posture", "--root", root, "--negotiation", "nego-conflit"],
      dir
    );
    assert.equal(postureResult.rc, 0, postureResult.stderr);
    const posture = JSON.parse(postureResult.stdout);
    assert.equal(posture.negotiationId, "nego-conflit");
    assert.equal(posture.postures.length, 1);
    assert.equal(posture.postures[0].subject, signer);
    assert.equal(posture.postures[0].postureConflit, "conflit-declarable");
    assert.deepEqual(posture.postures[0].criteres, ["hors-scope-propre", "signataire"]);
    assert.equal(posture.postures[0].disclosureMode, "evidence-package");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stabilize adds a postureConflit escalation before the final stabilized event", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-conflit-stab-"));
  const root = join(dir, ".h2a");
  try {
    const { signer, privatePath } = setupSigner(dir, root);
    const artifact = {
      kind: "ENGAGEMENT",
      id: "engagement:conflit",
      scope: "scope:self",
      goal: "ship with declared posture"
    };

    assert.equal(
      run(
        [
          "declare-interest",
          "--root",
          root,
          "--negotiation",
          "nego-conflit",
          "--instance",
          signer,
          "--interets",
          "vendor stake",
          "--event-id",
          "evt-declaration-01"
        ],
        dir
      ).rc,
      0
    );
    assert.equal(
      run(
        [
          "negotiate",
          "offer",
          "--root",
          root,
          "--id",
          "nego-conflit",
          "--instance",
          signer,
          "--artifact",
          JSON.stringify(artifact),
          "--event-id",
          "evt-offer-01"
        ],
        dir
      ).rc,
      0
    );
    assert.equal(
      run(
        [
          "negotiate",
          "sign",
          "--root",
          root,
          "--id",
          "nego-conflit",
          "--instance",
          signer,
          "--artifact",
          JSON.stringify(artifact),
          "--private-key",
          privatePath,
          "--event-id",
          "evt-sign-01"
        ],
        dir
      ).rc,
      0
    );

    const stabilized = run(
      ["negotiate", "stabilize", "--root", root, "--id", "nego-conflit"],
      dir
    );
    assert.equal(stabilized.rc, 0, stabilized.stderr);
    const stabilizedPayload = JSON.parse(stabilized.stdout);
    assert.ok(stabilizedPayload.advisoryEvents.length >= 1);

    const journal = JSON.parse(
      run(["negotiate", "journal", "--root", root, "--id", "nego-conflit"], dir).stdout
    );
    const advisory = journal.find(
      (entry) =>
        entry.type === "escalate" &&
        entry.body?.kind === "escalation" &&
        entry.body?.payload?.kind === "postureConflit"
    );
    assert.ok(advisory, "expected a postureConflit escalation event");
    const final = journal[journal.length - 1];
    assert.equal(final.body.kind, "stabilized");
    assert.ok(advisory.sequence < final.sequence);
    assert.equal(advisory.body.channel, "alert");
    assert.equal(advisory.body.payload.subject, signer);
    assert.equal(advisory.body.payload.postureConflit, "conflit-declarable");
    assert.equal(advisory.body.payload.requiredBodyKind, "declaration-interet");
    assert.ok(
      journal.some((entry) => entry.body?.payload?.kind === "postureConfiance"),
      "expected a postureConfiance advisory event"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

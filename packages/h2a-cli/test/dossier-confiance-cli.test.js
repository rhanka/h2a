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

function json(result) {
  assert.equal(result.rc, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function keypair(dir, label) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePath = join(dir, `${label}.pkcs8.pem`);
  writeFileSync(privatePath, privatePem, "utf8");
  return { privatePath, publicPem };
}

function register(dir, root, registration) {
  const result = run(["register", "--root", root, "--json", JSON.stringify(registration)], dir);
  assert.equal(result.rc, 0, result.stderr);
}

function setup(dir, root, options = {}) {
  run(["init", "--root", root], dir);
  const signerKeys = keypair(dir, "principal_agencex_achats");
  const presenterKeys = keypair(dir, "mandataire_immo");
  register(dir, root, {
    id: "principal:agencex-achats",
    instance: "principal:agencex-achats",
    roles: ["PRINCIPAL"],
    scopes: ["scope:agencex"],
    capabilities: [],
    endpoints: [],
    publicKeys: [signerKeys.publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
  register(dir, root, {
    id: "mandataire:immo",
    instance: "mandataire:immo",
    roles: ["MANDATAIRE"],
    scopes: ["scope:immo"],
    capabilities: [],
    endpoints: [],
    publicKeys: [presenterKeys.publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-31T00:00:00.000Z"
  });
  json(
    run(
      [
        "negotiate",
        "open",
        "--root",
        root,
        "--json",
        JSON.stringify({
          id: "nego-confiance",
          scope: "scope:agencex",
          parties: ["principal:agencex-achats"],
          subject: "engagement",
          status: "draft",
          requiredSigners: ["principal:agencex-achats"]
        })
      ],
      dir
    )
  );
  const offered = offerArtifact(dir, root, options.artifact ?? artifact());
  return { signerKeys, presenterKeys, offered };
}

function artifact(overrides = {}) {
  return {
    kind: "ENGAGEMENT",
    id: "engagement:agencex-immo",
    scope: "scope:agencex",
    charter: { goal: "operate AgenceX immo service" },
    roleBindings: [],
    controls: [],
    policies: [],
    successCriteria: ["accepted by AgenceX"],
    ...overrides
  };
}

function offerArtifact(dir, root, body, subcommand = "offer", eventId = "evt-offer-01") {
  return json(
    run(
      [
        "negotiate",
        subcommand,
        "--root",
        root,
        "--id",
        "nego-confiance",
        "--instance",
        "principal:agencex-achats",
        "--artifact",
        JSON.stringify(body),
        "--event-id",
        eventId
      ],
      dir
    )
  );
}

function declareInterest(dir, root, instance, extra = []) {
  return json(
    run(
      [
        "declare-interest",
        "--root",
        root,
        "--negotiation",
        "nego-confiance",
        "--instance",
        instance,
        "--interets",
        "relationship at immo",
        "--bindings",
        "scope:immo",
        ...extra
      ],
      dir
    )
  );
}

function signAndStabilize(dir, root, artifactBody, signerKeys) {
  json(
    run(
      [
        "negotiate",
        "sign",
        "--root",
        root,
        "--id",
        "nego-confiance",
        "--instance",
        "principal:agencex-achats",
        "--artifact",
        JSON.stringify(artifactBody),
        "--private-key",
        signerKeys.privatePath,
        "--event-id",
        "evt-sign-01"
      ],
      dir
    )
  );
  return json(
    run(["negotiate", "stabilize", "--root", root, "--id", "nego-confiance"], dir)
  );
}

function assertNoMeasurementOrLegitimacy(value) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /score|harmScore|metric|measure|mesure|legitimacy|legitimite|validity|verdict|veto/i
  );
}

test("h2a dossier renders a risk-ranked advisory dossier and presenter bias", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-dossier-cli-"));
  const root = join(dir, ".h2a");
  try {
    const currentArtifact = artifact({
      aval: "engagement:sentropic-platform",
      successCriteria: []
    });
    const { signerKeys } = setup(dir, root, { artifact: currentArtifact });
    declareInterest(dir, root, "principal:agencex-achats", ["--masque-impact-collectif"]);
    declareInterest(dir, root, "mandataire:immo");

    const rendered = json(
      run(
        [
          "dossier",
          "--root",
          root,
          "--negotiation",
          "nego-confiance",
          "--presenter",
          "mandataire:immo",
          "--advisory-gate",
          "--event-id",
          "evt-presenter-bias-01"
        ],
        dir
      )
    );
    assert.equal(rendered.negotiationId, "nego-confiance");
    assert.equal(rendered.dossier.kind, "decision-dossier");
    assert.equal(rendered.dossierHash, computeHash(rendered.dossier));
    assert.equal(rendered.dossier.items[0].subject, "principal:agencex-achats");
    assert.deepEqual(rendered.dossier.items[0].reasons, [
      "conflit-declarable",
      "masque-impact-collectif",
      "cross-scope-aval",
      "missing-success-criteria"
    ]);
    assert.equal(rendered.presenterBias.biased, true);
    assert.equal(rendered.presenterBias.posture.postureConflit, "conflit-declarable");
    assertNoMeasurementOrLegitimacy(rendered.dossier);

    const journal = json(
      run(["negotiate", "journal", "--root", root, "--id", "nego-confiance"], dir)
    );
    assert.ok(
      journal.some((entry) => entry.body?.payload?.kind === "presenterBias"),
      "expected advisory presenterBias escalation"
    );

    const stabilized = signAndStabilize(dir, root, currentArtifact, signerKeys);
    assert.equal(stabilized.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a confiance moves from non-etablie to etablie with a fresh dossier attestation", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-confiance-cli-"));
  const root = join(dir, ".h2a");
  try {
    const { signerKeys } = setup(dir, root);

    const initial = json(
      run(["confiance", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    assert.equal(initial.posture.postureConfiance, "non-etablie");
    assert.equal(initial.posture.attentionAttested, false);
    assert.match(initial.posture.dossierHash, /^sha256:[a-f0-9]{64}$/);

    const dossier = json(
      run(["dossier", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    json(
      run(
        [
          "attest-comprehension",
          "--root",
          root,
          "--negotiation",
          "nego-confiance",
          "--instance",
          "principal:agencex-achats",
          "--dossier",
          dossier.dossierHash,
          "--private-key",
          signerKeys.privatePath,
          "--event-id",
          "evt-attention-01"
        ],
        dir
      )
    );

    const established = json(
      run(["confiance", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    assert.equal(established.posture.postureConfiance, "etablie");
    assert.equal(established.posture.attentionAttested, true);
    assert.equal(established.posture.noUndisclosedCollectiveConflict, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a confiance rejects stale attention after the dossier changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-confiance-stale-"));
  const root = join(dir, ".h2a");
  try {
    const { signerKeys } = setup(dir, root);
    const firstDossier = json(
      run(["dossier", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    json(
      run(
        [
          "attest-comprehension",
          "--root",
          root,
          "--negotiation",
          "nego-confiance",
          "--instance",
          "principal:agencex-achats",
          "--dossier",
          firstDossier.dossierHash,
          "--private-key",
          signerKeys.privatePath,
          "--event-id",
          "evt-attention-01"
        ],
        dir
      )
    );
    offerArtifact(
      dir,
      root,
      artifact({ aval: "engagement:sentropic-platform", successCriteria: [] }),
      "counter",
      "evt-counter-01"
    );

    const stale = json(
      run(["confiance", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    assert.notEqual(stale.posture.dossierHash, firstDossier.dossierHash);
    assert.equal(stale.posture.postureConfiance, "non-etablie");
    assert.deepEqual(stale.posture.staleAttestations, ["principal:agencex-achats"]);
    assert.ok(stale.posture.reasons.includes("attention-not-attested"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a confiance reports undisclosed conflict as non-etablie and disclosed conflict as reservee", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-confiance-conflict-"));
  const root = join(dir, ".h2a");
  try {
    const { signerKeys } = setup(dir, root, {
      artifact: artifact({ aval: "engagement:sentropic-platform" })
    });
    const dossier = json(
      run(["dossier", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    json(
      run(
        [
          "attest-comprehension",
          "--root",
          root,
          "--negotiation",
          "nego-confiance",
          "--instance",
          "principal:agencex-achats",
          "--dossier",
          dossier.dossierHash,
          "--private-key",
          signerKeys.privatePath,
          "--event-id",
          "evt-attention-01"
        ],
        dir
      )
    );
    json(
      run(
        [
          "negotiate",
          "event",
          "--root",
          root,
          "--id",
          "nego-confiance",
          "--json",
          JSON.stringify({
            id: "evt-control-flag-01",
            type: "event",
            actor: { instance: "control:1", role: "CONTROL", scope: "scope:agencex" },
            body: {
              kind: "postureConflit",
              subject: "principal:agencex-achats",
              postureConflit: "conflit-declarable"
            },
            createdAt: "2026-05-31T00:00:00.000Z"
          })
        ],
        dir
      )
    );

    const undisclosed = json(
      run(["confiance", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    assert.equal(undisclosed.posture.postureConfiance, "non-etablie");
    assert.deepEqual(undisclosed.posture.undisclosedConflicts, [
      "principal:agencex-achats"
    ]);

    declareInterest(dir, root, "principal:agencex-achats", ["--masque-impact-collectif"]);
    const disclosedDossier = json(
      run(["dossier", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    json(
      run(
        [
          "attest-comprehension",
          "--root",
          root,
          "--negotiation",
          "nego-confiance",
          "--instance",
          "principal:agencex-achats",
          "--dossier",
          disclosedDossier.dossierHash,
          "--private-key",
          signerKeys.privatePath,
          "--event-id",
          "evt-attention-02"
        ],
        dir
      )
    );
    const disclosed = json(
      run(["confiance", "--root", root, "--negotiation", "nego-confiance"], dir)
    );
    assert.equal(disclosed.posture.postureConfiance, "reservee");
    assert.equal(disclosed.posture.disclosedConflicts.length, 1);

    const stabilized = signAndStabilize(
      dir,
      root,
      artifact({ aval: "engagement:sentropic-platform" }),
      signerKeys
    );
    assert.equal(stabilized.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a dossier and confiance on a missing negotiation exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-missing-dossier-"));
  const root = join(dir, ".h2a");
  try {
    run(["init", "--root", root], dir);
    const dossier = run(["dossier", "--root", root, "--negotiation", "ghost"], dir);
    assert.equal(dossier.rc, 2);
    assert.match(dossier.stderr, /not found/i);
    const confiance = run(["confiance", "--root", root, "--negotiation", "ghost"], dir);
    assert.equal(confiance.rc, 2);
    assert.match(confiance.stderr, /not found/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

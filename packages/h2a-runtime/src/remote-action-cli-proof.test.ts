import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PROOF_TTL_MS,
  SIGNING_DOMAIN_PREFIX,
  canonicalJson,
  digestDomain,
} from "./remote-action-contract.js";
import { createPinnedTrust } from "./remote-action-trust.js";
import { PROOF_FIELDS, verifyCliSessionProof } from "./remote-action-verifier.js";
import {
  CLI_PROOF_KIND,
  evaluateCliProofRouteAdmission,
  evaluateRouteHttpMedia,
  mintCliSessionProof,
  resolveCliProofTarget,
  verifyCliSessionProofBinding,
  type CliProofMintInput,
} from "./remote-action-cli-proof.js";

const NOW_MS = 1793520000000;

const FIXTURES = new URL(
  "./fixtures/session-content/v3/remote-action-v1/",
  import.meta.url,
);

function loadBytes(relative: string): Buffer {
  return readFileSync(new URL(relative, FIXTURES));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** r3-pinned sha256 of the three N3 route vectors (copied byte-identical). */
const ROUTE_VECTOR_SHA = {
  "route-cli-proof.json":
    "7ad92a453d6c0d889bab419e4865a5893a9c18ba3390f5f6a2071866cb471742",
  "route-source-open.json":
    "26bda742c134fc2d072e97e915f34da95d627d5b312c71161e58a4cbba64e4cd",
  "route-source-renew.json":
    "9aeecf90f6e323f1ffc7819ec6c3bd30d4f230a485eb1b3ca2b03c9e5a62f410",
} as const;

function mintKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, spkiBase64: der.toString("base64") };
}

const source = mintKeys();

const trust = createPinnedTrust([
  {
    kid: "test-source",
    issuer: "test-source-issuer",
    audience: "test-b-audience",
    purposes: ["cli-session-proof"],
    publicKeySpkiBase64: source.spkiBase64,
    revoked: false,
    fixtureOnly: false,
  },
]);

function opts() {
  return {
    trust,
    expectedAudience: "test-b-audience",
    nowMs: NOW_MS,
    clockKnown: true,
    clockRollback: false,
  };
}

function mintTarget(overrides: Record<string, unknown> = {}) {
  return {
    appMeshId: "mesh-a",
    sourceMeshId: "mesh-b",
    nativeAudience: "aud-b",
    registrationId: "reg-1",
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    bindingId: "binding-1",
    sourceId: "source-1",
    sourceSessionId: "session-1",
    nativeSessionId: "cli-1",
    sourceGeneration: 3,
    bootGeneration: 7,
    custodyEpoch: 1,
    controllerEpoch: 2,
    connectionId: "conn-1",
    connectionGeneration: 4,
    ...overrides,
  };
}

function mintInput(overrides: Partial<CliProofMintInput> = {}): CliProofMintInput {
  return {
    target: mintTarget(),
    owner: { issuer: "test-idp", sub: "user-1" },
    enrollment: { approvedRegistrationRef: "reg-1", approvedRegistrationRevision: 1 },
    signer: {
      kid: "test-source",
      issuer: "test-source-issuer",
      audience: "test-b-audience",
      privateKey: source.privateKey,
    },
    provider: {
      providerId: "provider-1",
      providerVersion: "v1",
      executableDigest: "e".repeat(64),
    },
    nativeSessionPublicKeyId: "native-key-1",
    capabilitiesDigest: "d".repeat(64),
    permissionMode: "interactive",
    autoApprovePolicyDigest: null,
    proofId: "proof-1",
    issuedAtMs: NOW_MS - 1000,
    expiresAtMs: NOW_MS + 59000,
    ...overrides,
  };
}

function expected() {
  const target = mintTarget();
  return {
    targetDigest: digestDomain("target", target),
    ownerIssuer: "test-idp",
    ownerSub: "user-1",
    approvedRegistrationRef: "reg-1",
    approvedRegistrationRevision: 1,
    providerId: "provider-1",
    providerVersion: "v1",
    executableDigest: "e".repeat(64),
    nativeSessionPublicKeyId: "native-key-1",
    capabilitiesDigest: "d".repeat(64),
    permissionMode: "interactive" as const,
    autoApprovePolicyDigest: null,
    proofId: "proof-1",
    issuedAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 59000,
  };
}

/** Validly re-sign a mutated body with the test source key (guard helper). */
function resignMutated(body: Record<string, unknown>) {
  const bytes = Buffer.concat([
    Buffer.from(`${SIGNING_DOMAIN_PREFIX}${CLI_PROOF_KIND}`, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(body), "utf8"),
  ]);
  const signature = sign(null, bytes, source.privateKey);
  return {
    body,
    signature: {
      alg: "Ed25519" as const,
      value: signature.toString("base64url").replace(/=+$/, ""),
    },
  };
}

describe("remote-action cli proof producer", () => {
  it("mints a proof the N1 verifier accepts", () => {
    const record = mintCliSessionProof(mintInput(), NOW_MS);
    const body = verifyCliSessionProof(record, opts());
    expect(body["proofId"]).toBe("proof-1");
    expect(digestDomain("target", body["target"])).toBe(expected().targetDigest);
  });

  it("refuses a missing enrollment without filling the source gap", () => {
    expect(() => mintCliSessionProof(mintInput({ enrollment: null }))).toThrowError(
      expect.objectContaining({ code: "contract_source_gap_blocked" }),
    );
  });

  it("refuses a missing signer without filling the source gap", () => {
    expect(() => mintCliSessionProof(mintInput({ signer: null }))).toThrowError(
      expect.objectContaining({ code: "contract_source_gap_blocked" }),
    );
  });

  it("refuses missing provider metadata without filling the source gap", () => {
    expect(() => mintCliSessionProof(mintInput({ provider: null }))).toThrowError(
      expect.objectContaining({ code: "contract_source_gap_blocked" }),
    );
  });

  it("refuses a non-closed target", () => {
    const target = mintTarget() as Record<string, unknown>;
    delete target["connectionGeneration"];
    expect(() => mintCliSessionProof(mintInput({ target }))).toThrowError(
      expect.objectContaining({ code: "invalid_target" }),
    );
  });

  it("refuses an unknown permission mode", () => {
    expect(() =>
      mintCliSessionProof(mintInput({ permissionMode: "sudo" as never })),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("refuses a TTL overflow beyond the frozen proof bound", () => {
    expect(() =>
      mintCliSessionProof(
        mintInput({ issuedAtMs: NOW_MS - PROOF_TTL_MS - 1, expiresAtMs: NOW_MS }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });
});

describe("remote-action cli proof binding verifier", () => {
  it("accepts the exact target, provider, mode and generations", () => {
    const record = mintCliSessionProof(mintInput(), NOW_MS);
    const body = verifyCliSessionProofBinding(record, opts(), expected());
    expect(body["providerId"]).toBe("provider-1");
    expect(body["permissionMode"]).toBe("interactive");
  });

  it("refuses tampered bytes without a new signature", () => {
    const record = mintCliSessionProof(mintInput(), NOW_MS);
    const tampered = {
      body: { ...(record.body as Record<string, unknown>), providerId: "provider-2" },
      signature: record.signature,
    };
    expect(() => verifyCliSessionProofBinding(tampered, opts(), expected())).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });

  const mutations: Array<[string, Record<string, unknown> | undefined]> = [
    ["target.nativeSessionId", { nativeSessionId: "cli-2" }],
    ["target.sourceGeneration", { sourceGeneration: 4 }],
    ["target.controllerEpoch", { controllerEpoch: 3 }],
    ["providerId", undefined],
    ["providerVersion", undefined],
    ["executableDigest", undefined],
    ["approvedRegistrationRef", undefined],
    ["approvedRegistrationRevision", undefined],
    ["nativeSessionPublicKeyId", undefined],
    ["permissionMode", undefined],
    ["ownerIssuer", undefined],
    ["ownerSub", undefined],
    ["capabilitiesDigest", undefined],
    ["autoApprovePolicyDigest", undefined],
  ];
  it.each(mutations)(
    "refuses a validly re-signed mutation of %s",
    (field, targetOverride) => {
      const input = mintInput();
      if (targetOverride !== undefined) {
        input.target = mintTarget(targetOverride);
      } else if (field === "providerId") {
        input.provider = { ...input.provider!, providerId: "provider-2" };
      } else if (field === "providerVersion") {
        input.provider = { ...input.provider!, providerVersion: "v2" };
      } else if (field === "executableDigest") {
        input.provider = { ...input.provider!, executableDigest: "f".repeat(64) };
      } else if (field === "approvedRegistrationRef") {
        input.enrollment = { ...input.enrollment!, approvedRegistrationRef: "reg-2" };
      } else if (field === "approvedRegistrationRevision") {
        input.enrollment = { ...input.enrollment!, approvedRegistrationRevision: 2 };
      } else if (field === "nativeSessionPublicKeyId") {
        input.nativeSessionPublicKeyId = "native-key-2";
      } else if (field === "permissionMode") {
        input.permissionMode = "auto-approve";
      } else if (field === "ownerIssuer") {
        input.owner = { issuer: "test-idp-2", sub: input.owner.sub };
      } else if (field === "ownerSub") {
        input.owner = { issuer: "test-idp", sub: "user-2" };
      } else if (field === "autoApprovePolicyDigest") {
        input.autoApprovePolicyDigest = "a".repeat(64);
      } else {
        input.capabilitiesDigest = "e".repeat(64);
      }
      const record = mintCliSessionProof(input, NOW_MS);
      expect(() =>
        verifyCliSessionProofBinding(record, opts(), expected()),
      ).toThrowError(expect.objectContaining({ code: "binding_mismatch" }));
    },
  );

  it("refuses a non-Ed25519 signer key with a typed request error", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const input = mintInput({
      signer: {
        kid: "test-source",
        issuer: "test-source-issuer",
        audience: "test-b-audience",
        privateKey: ec.privateKey,
      },
    });
    expect(() => mintCliSessionProof(input, NOW_MS)).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("refuses a zero-duration lifetime", () => {
    expect(() =>
      mintCliSessionProof(mintInput({ issuedAtMs: NOW_MS, expiresAtMs: NOW_MS }), NOW_MS),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("refuses a validly re-signed mutation of every closed body field", () => {
    const base = mintCliSessionProof(mintInput(), NOW_MS);
    const baseBody = base.body as Record<string, unknown>;
    const mutate = (field: string): { value: unknown; code: string } => {
      switch (field) {
        case "version":
          return { value: "remote-action-v9", code: "unsupported_version" };
        case "kind":
          return { value: "action-claim", code: "invalid_request" };
        case "issuer":
          return { value: "test-source-issuer-2", code: "authority_refused" };
        case "kid":
          return { value: "test-source-2", code: "unknown_kid" };
        case "audience":
          return { value: "test-b-audience-2", code: "authority_refused" };
        case "target":
          return { value: mintTarget({ nativeSessionId: "cli-2" }), code: "binding_mismatch" };
        case "approvedRegistrationRef":
          return { value: "reg-2", code: "binding_mismatch" };
        case "approvedRegistrationRevision":
          return { value: 2, code: "binding_mismatch" };
        case "executableDigest":
          return { value: "f".repeat(64), code: "binding_mismatch" };
        case "nativeSessionPublicKeyId":
          return { value: "native-key-2", code: "binding_mismatch" };
        case "proofId":
          return { value: "proof-2", code: "binding_mismatch" };
        case "issuedAt":
          return { value: NOW_MS - 500, code: "binding_mismatch" };
        case "expiresAt":
          return { value: NOW_MS + 30000, code: "binding_mismatch" };
        case "ownerIssuer":
          return { value: "test-idp-2", code: "binding_mismatch" };
        case "ownerSub":
          return { value: "user-2", code: "binding_mismatch" };
        case "providerId":
          return { value: "provider-2", code: "binding_mismatch" };
        case "providerVersion":
          return { value: "v2", code: "binding_mismatch" };
        case "capabilitiesDigest":
          return { value: "e".repeat(64), code: "binding_mismatch" };
        case "permissionMode":
          return { value: "auto-approve", code: "binding_mismatch" };
        case "autoApprovePolicyDigest":
          return { value: "a".repeat(64), code: "binding_mismatch" };
        default:
          throw new Error(`guard without mutator: ${field}`);
      }
    };
    expect(PROOF_FIELDS).toHaveLength(20);
    for (const field of PROOF_FIELDS) {
      const { value, code } = mutate(field);
      const record = resignMutated({ ...baseBody, [field]: value });
      expect(() =>
        verifyCliSessionProofBinding(record, opts(), expected()),
      ).toThrowError(expect.objectContaining({ code }));
    }
  });
});

describe("remote-action cli proof approved-target mapping", () => {
  it("resolves wire integer generations from the approved admission, never from host strings", () => {
    const admission = {
      appMeshId: "mesh-a",
      sourceMeshId: "mesh-b",
      nativeAudience: "aud-b",
      registrationId: "reg-1",
      tenantId: "tenant-1",
      workspaceId: "ws-1",
      bindingId: "binding-1",
      sourceId: "source-1",
      sourceSessionId: "session-1",
      connectionId: "conn-1",
      sourceGeneration: 3,
      bootGeneration: 7,
      custodyEpoch: 1,
      connectionGeneration: 4,
    };
    // Host strings may even carry digits: they must never become integers.
    const target = resolveCliProofTarget(admission, {
      nativeSessionId: "cli-1",
      controllerEpoch: 2,
      hostGeneration: "42",
      incarnation: "7-uuid",
    });
    expect(target["sourceGeneration"]).toBe(3);
    expect(target["controllerEpoch"]).toBe(2);
    expect(target["nativeSessionId"]).toBe("cli-1");
  });

  it("refuses a missing approved admission instead of inventing generations", () => {
    expect(() =>
      resolveCliProofTarget(null, {
        nativeSessionId: "cli-1",
        controllerEpoch: 2,
        hostGeneration: "g",
        incarnation: "i",
      }),
    ).toThrowError(expect.objectContaining({ code: "contract_source_gap_blocked" }));
  });
});

describe("remote-action cli proof r3 route vectors", () => {
  it("pins the exact r3 bytes of the cli-proof, source-open and source-renew vectors", () => {
    for (const [name, sha] of Object.entries(ROUTE_VECTOR_SHA)) {
      expect(sha256Hex(loadBytes(`vectors/${name}`))).toBe(sha);
    }
  });

  it("executes every routeGuard case with zero handler effects", () => {
    let positives = 0;
    let negatives = 0;
    for (const name of Object.keys(ROUTE_VECTOR_SHA)) {
      const vector = JSON.parse(loadBytes(`vectors/${name}`).toString("utf8")) as {
        routeId: string;
        positive: Array<{ id: string; evaluator: string; input: never; expected: { decision: string; code?: string; modelBodyReads: number; modelHandlerCalls: number } }>;
        negative: Array<{ id: string; evaluator: string; input: never; expected: { decision: string; code?: string; modelBodyReads: number; modelHandlerCalls: number } }>;
      };
      for (const entry of [...vector.positive, ...vector.negative]) {
        if (entry.evaluator === "routeGuard") {
          const decision = evaluateCliProofRouteAdmission(entry.input as never);
          expect({ ...decision, id: entry.id }).toEqual({
            decision: entry.expected.decision,
            code: entry.expected.code ?? null,
            id: entry.id,
          });
          expect(entry.expected.modelBodyReads).toBe(0);
          expect(entry.expected.modelHandlerCalls).toBe(0);
          if (entry.expected.decision === "allow") positives += 1;
          else negatives += 1;
        } else {
          const decision = evaluateRouteHttpMedia(entry.input as never);
          expect({ ...decision, id: entry.id }).toEqual({
            decision: entry.expected.decision,
            code: entry.expected.code ?? null,
            id: entry.id,
          });
        }
      }
    }
    expect(positives).toBe(7);
    expect(negatives).toBe(98);
  });

describe("remote-action cli proof receiver pack (H-3)", () => {
  const H3_SHA =
    "f175afe0046f23a85cef9b029a49b63cf3d7ec2f7fff98fcef09547b428398bd";

  function loadPack() {
    const bytes = loadBytes("vectors/cli-proof-h3.json");
    expect(sha256Hex(bytes)).toBe(H3_SHA);
    return JSON.parse(bytes.toString("utf8")) as {
      format: string;
      contractManifestSha256: string;
      signingDomain: string;
      canonicalBody: Record<string, unknown>;
      bodyDigest: string;
      targetDigest: string;
      mutationCorpus: Array<{
        id: string;
        scope: "target" | "body";
        field: string;
        value: unknown;
        expectCode: string;
      }>;
      registrationMapping: {
        hostFacts: {
          sessionId: string;
          hostGeneration: string;
          incarnation: string;
          controllerEpoch: number;
        };
        approvedAdmission: Parameters<typeof resolveCliProofTarget>[0];
        resolvedTarget: Record<string, unknown>;
      };
      sourceGaps: string[];
    };
  }

  function applyMutation(
    base: CliProofMintInput,
    entry: { scope: "target" | "body"; field: string; value: unknown },
  ): CliProofMintInput {
    const next: CliProofMintInput = {
      ...base,
      target: { ...(base.target as Record<string, unknown>) },
      owner: { ...base.owner },
      provider: base.provider === null ? null : { ...base.provider },
    };
    if (entry.scope === "target") {
      next.target = { ...(next.target as Record<string, unknown>), [entry.field]: entry.value };
    } else if (
      entry.field === "providerId" ||
      entry.field === "providerVersion" ||
      entry.field === "executableDigest"
    ) {
      next.provider = { ...(next.provider as NonNullable<CliProofMintInput["provider"]>), [entry.field]: entry.value };
    } else if (
      entry.field === "approvedRegistrationRef" ||
      entry.field === "approvedRegistrationRevision"
    ) {
      next.enrollment = {
        ...(next.enrollment as NonNullable<CliProofMintInput["enrollment"]>),
        [entry.field]: entry.value,
      };
    } else if (entry.field === "ownerIssuer") {
      next.owner = { ...next.owner, issuer: entry.value as string };
    } else if (entry.field === "ownerSub") {
      next.owner = { ...next.owner, sub: entry.value as string };
    } else if (entry.field === "capabilitiesDigest") {
      next.capabilitiesDigest = entry.value as string;
    } else if (entry.field === "nativeSessionPublicKeyId") {
      next.nativeSessionPublicKeyId = entry.value as string;
    } else if (entry.field === "autoApprovePolicyDigest") {
      next.autoApprovePolicyDigest = entry.value as string;
    } else if (entry.field === "permissionMode") {
      next.permissionMode = entry.value as CliProofMintInput["permissionMode"];
    } else {
      throw new Error(`H-3 corpus field without applier: ${entry.field}`);
    }
    return next;
  }

  it("locks the pack bytes and pins the r3 contract manifest", () => {
    const pack = loadPack();
    expect(pack.format).toBe("h2a.rc2-n3-h3/1");
    expect(pack.contractManifestSha256).toBe(
      "88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565",
    );
    expect(pack.signingDomain).toBe("sentropic.remote-action-v1/cli-session-proof");
    expect(pack.sourceGaps).toEqual(["DEP-AUTH-A", "DEP-AUTH-B", "SG-R15", "SG-NATIVE"]);
  });

  it("reproduces the pack signing digests from the canonical body", () => {
    const pack = loadPack();
    expect(digestDomain("cli-session-proof", pack.canonicalBody)).toBe(pack.bodyDigest);
    expect(digestDomain("target", pack.canonicalBody["target"])).toBe(pack.targetDigest);
  });

  it("refuses every corpus mutation with its recorded code", () => {
    const pack = loadPack();
    expect(pack.mutationCorpus.length).toBe(14);
    for (const entry of pack.mutationCorpus) {
      const record = mintCliSessionProof(applyMutation(mintInput(), entry), NOW_MS);
      expect(() => verifyCliSessionProofBinding(record, opts(), expected())).toThrowError(
        expect.objectContaining({ code: entry.expectCode }),
      );
    }
  });

  it("resolves the approved mapping without coercing host strings", () => {
    const pack = loadPack();
    const { hostFacts, approvedAdmission, resolvedTarget } = pack.registrationMapping;
    expect(hostFacts.hostGeneration).toBe("42");
    const target = resolveCliProofTarget(approvedAdmission, {
      nativeSessionId: hostFacts.sessionId,
      controllerEpoch: hostFacts.controllerEpoch,
      hostGeneration: hostFacts.hostGeneration,
      incarnation: hostFacts.incarnation,
    });
    expect(target).toEqual(resolvedTarget);
    expect(target["sourceGeneration"]).toBe(3);
  });
});

  it("refuses an app-chat stage through the guard, never as transport", () => {
    const vector = JSON.parse(
      loadBytes("vectors/route-cli-proof.json").toString("utf8"),
    ) as {
      positive: Array<{ input: Record<string, unknown> }>;
    };
    const base = vector.positive[0]!.input;
    expect(
      evaluateCliProofRouteAdmission({ ...base, engineKind: "app-chat" } as never),
    ).toEqual({ decision: "deny", code: "relay_scope_refused" });
  });
});

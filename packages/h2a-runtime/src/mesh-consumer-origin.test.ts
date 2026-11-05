/**
 * Mesh origin-port consumer tests — registry slice only, cell RC2.mesh-consumer
 * lot 1 (B6). No lane, no route, no transport: the five
 * `SessionOriginRegistryPortV1` methods are dispatched against the pinned r3
 * vectors and must refuse with a typed value while the registry-bearing
 * archive is unpublished. The lane slice stays blocked by relay-1.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MESH_ORIGIN_METHODS,
  MESH_ORIGIN_PORT_ID,
  MESH_ORIGIN_R3_PIN,
  createMeshOriginConsumer,
  isMeshOriginRefusal,
  type MeshOriginPortMethod,
} from "./mesh-consumer-origin.js";

const FIXTURES = new URL(
  "./fixtures/session-content/v3/mesh-consumer-origin/",
  import.meta.url,
);

const MANIFEST_SHA256 =
  "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715";
const CONTRACT_MANIFEST_SHA256 =
  "88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565";

const EVIDENCE_LEVEL =
  "local API data-shape contract only; handle authentication and package implementation not supplied";
const RUNTIME_GATE = "BLOCKED_EXTERNAL_AND_PUBLIC_EXPORTS";

// Envelope only: the vectors pin the eight required runtime cases, but this
// lot executes just three of them (`incompatible-public-export` via the
// incompatible-version probe, `no-source-internal-import` via the import-graph
// test, `typed-refusal-not-throw` via dispatch). The other five stay envelope
// under `BLOCKED_EXTERNAL_AND_PUBLIC_EXPORTS` and are not claimed as covered.
const REQUIRED_RUNTIME_CASES = [
  "wrong-local-capability",
  "foreign-process-or-session",
  "incompatible-public-export",
  "no-source-internal-import",
  "duplicate-reuses-revision",
  "matching-ACK-or-remote-unknown",
  "sole-origin-writer-fence",
  "typed-refusal-not-throw",
] as const;

const EXPECTED_ENVELOPE: Record<
  MeshOriginPortMethod,
  { parameterSchema: string; resultSchema: string; signature: string; revisionSemantics: string }
> = {
  ingestLifecycle: {
    parameterSchema:
      "schemas/SessionOriginIngestLifecycleParametersV1.schema.json",
    resultSchema: "schemas/SessionOriginCommitResultV1.schema.json",
    signature:
      "ingestLifecycle(parameters: SessionOriginIngestLifecycleParametersV1, options?: { signal?: AbortSignal }): Promise<SessionOriginCommitResultV1>",
    revisionSemantics:
      "new authenticated changed fact allocates exactly +1; identical retry reuses commit",
  },
  ingestCapabilities: {
    parameterSchema:
      "schemas/SessionOriginIngestCapabilitiesParametersV1.schema.json",
    resultSchema: "schemas/SessionOriginCommitResultV1.schema.json",
    signature:
      "ingestCapabilities(parameters: SessionOriginIngestCapabilitiesParametersV1, options?: { signal?: AbortSignal }): Promise<SessionOriginCommitResultV1>",
    revisionSemantics:
      "new authenticated changed fact allocates exactly +1; identical retry reuses commit",
  },
  publishListing: {
    parameterSchema:
      "schemas/SessionOriginPublishListingParametersV1.schema.json",
    resultSchema: "schemas/SessionOriginPublishResultV1.schema.json",
    signature:
      "publishListing(parameters: SessionOriginPublishListingParametersV1, options?: { signal?: AbortSignal }): Promise<SessionOriginPublishResultV1>",
    revisionSemantics: "does not allocate originRevision",
  },
  renewFreshness: {
    parameterSchema:
      "schemas/SessionOriginRenewFreshnessParametersV1.schema.json",
    resultSchema: "schemas/SessionOriginPublishResultV1.schema.json",
    signature:
      "renewFreshness(parameters: SessionOriginRenewFreshnessParametersV1, options?: { signal?: AbortSignal }): Promise<SessionOriginPublishResultV1>",
    revisionSemantics: "does not allocate originRevision",
  },
  snapshot: {
    parameterSchema: "schemas/SessionOriginSnapshotParametersV1.schema.json",
    resultSchema: "schemas/SessionOriginPublishResultV1.schema.json",
    signature:
      "snapshot(parameters: SessionOriginSnapshotParametersV1, options?: { signal?: AbortSignal }): Promise<SessionOriginPublishResultV1>",
    revisionSemantics: "does not allocate originRevision",
  },
};

function loadBytes(relative: string): Buffer {
  return readFileSync(new URL(relative, FIXTURES));
}

function loadJson(relative: string): any {
  return JSON.parse(loadBytes(relative).toString("utf8"));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function vectorFileName(method: MeshOriginPortMethod): string {
  return `port-SessionOriginRegistryPortV1-${method}.json`;
}

describe("mesh origin-port r3 vector pin", () => {
  it("pins the r3 manifest and every pinned registry vector byte", () => {
    const pin = loadJson("pin.json") as {
      revision: string;
      manifestSha256: string;
      contractManifestSha256: string;
      vectors: Record<string, string>;
    };
    expect(pin.revision).toBe("r3");
    expect(pin.manifestSha256).toBe(MANIFEST_SHA256);
    expect(pin.contractManifestSha256).toBe(CONTRACT_MANIFEST_SHA256);
    expect(MESH_ORIGIN_R3_PIN.manifestSha256).toBe(MANIFEST_SHA256);
    expect(MESH_ORIGIN_R3_PIN.contractManifestSha256).toBe(
      CONTRACT_MANIFEST_SHA256,
    );
    for (const [name, sha] of Object.entries(pin.vectors)) {
      expect(sha256Hex(loadBytes(`vectors/${name}`))).toBe(sha);
      expect((MESH_ORIGIN_R3_PIN.vectors as Record<string, string>)[name]).toBe(
        sha,
      );
    }
    expect(Object.keys(pin.vectors).sort()).toEqual([
      "port-SessionOriginRegistryPortV1-ingestCapabilities.json",
      "port-SessionOriginRegistryPortV1-ingestLifecycle.json",
      "port-SessionOriginRegistryPortV1-publishListing.json",
      "port-SessionOriginRegistryPortV1-renewFreshness.json",
      "port-SessionOriginRegistryPortV1-snapshot.json",
      "registry-revision-digests.json",
    ]);
  });

  it("keeps the exact r3 envelope per origin-port method", () => {
    expect(MESH_ORIGIN_PORT_ID).toBe("SessionOriginRegistryPortV1");
    expect([...MESH_ORIGIN_METHODS]).toEqual([
      "ingestLifecycle",
      "ingestCapabilities",
      "publishListing",
      "renewFreshness",
      "snapshot",
    ]);
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      expect(vector.port).toBe("SessionOriginRegistryPortV1");
      expect(vector.method).toBe(method);
      expect(vector.parameterSchema).toBe(
        EXPECTED_ENVELOPE[method].parameterSchema,
      );
      expect(vector.resultSchema).toBe(EXPECTED_ENVELOPE[method].resultSchema);
      expect(vector.signature).toBe(EXPECTED_ENVELOPE[method].signature);
      expect(vector.revisionSemantics).toBe(
        EXPECTED_ENVELOPE[method].revisionSemantics,
      );
      expect(vector.runtimeGate).toBe(RUNTIME_GATE);
      expect(vector.evidenceLevel).toBe(EVIDENCE_LEVEL);
      expect(vector.requiredRuntimeCases).toEqual([...REQUIRED_RUNTIME_CASES]);
      expect(vector.positive).toHaveLength(1);
      expect(vector.positive[0].expect).toBe("ACCEPT_SHAPE");
      expect(vector.negative).toHaveLength(1);
      expect(vector.negative[0].expect).toBe("REJECT_SCHEMA");
    }
  });
});

describe("mesh origin-port fail-closed dispatch", () => {
  it("rejects invalid consumer input with TypeError before any probe", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "resolve",
      {},
      { resolveSession: undefined },
      { resolveSession: null },
      { resolveSession: 42 },
      { resolveSession: "native" },
    ]) {
      expect(() => createMeshOriginConsumer(bad as never)).toThrow(TypeError);
    }
  });

  it("stays unavailable with a typed refusal while the factory is unpublished", async () => {
    let resolveCalls = 0;
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => {
        resolveCalls += 1;
        return null;
      },
    });
    expect(consumer.status).toBe("unavailable");
    expect(consumer.port).toBe("SessionOriginRegistryPortV1");
    expect([...consumer.methods]).toEqual([...MESH_ORIGIN_METHODS]);
    expect(typeof consumer.installedVersion).toBe("string");
    expect(consumer.exportPresent).toBe(false);
    expect(consumer.unavailability.status).toBe("unavailable");
    expect(consumer.unavailability.error).toEqual({
      format: "cluster-mesh.session-relay/1",
      kind: "error",
      code: "relay_grant_unavailable",
      retryable: true,
    });
    expect(consumer.unavailability.reason).toBe("incompatible-version");
    expect(consumer.unavailability.method).toBeNull();
    expect(isMeshOriginRefusal(consumer.unavailability)).toBe(false);
    expect(isMeshOriginRefusal({ status: "local-committed" })).toBe(false);
    expect(isMeshOriginRefusal({ status: "refused" })).toBe(false);
    expect(isMeshOriginRefusal(null)).toBe(false);
    expect(resolveCalls).toBe(0);
  });

  it("refuses every ACCEPT_SHAPE vector parameter without effect", async () => {
    let resolveCalls = 0;
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => {
        resolveCalls += 1;
        return null;
      },
    });
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      const parameters = vector.positive[0].value;
      expect(typeof parameters).toBe("object");
      expect(parameters).not.toBeNull();
      expect(Array.isArray(parameters)).toBe(false);
      const first = await consumer[method](parameters);
      const second = await consumer[method](parameters);
      expect(isMeshOriginRefusal(first)).toBe(true);
      expect(first.status).toBe("refused");
      expect(Object.keys(first).sort()).toEqual(["error", "status"]);
      expect(first.error.code).toBe("relay_grant_unavailable");
      expect(first.error.retryable).toBe(true);
      expect(second).toEqual(first);
    }
    expect(resolveCalls).toBe(0);
  });

  it("refuses every REJECT_SCHEMA vector parameter without effect", async () => {
    let resolveCalls = 0;
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => {
        resolveCalls += 1;
        return null;
      },
    });
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      const parameters = vector.negative[0].value;
      expect(parameters.arbitraryUrl).toBe("https://forbidden.invalid/");
      const refused = await consumer[method](parameters);
      expect(isMeshOriginRefusal(refused)).toBe(true);
      expect(refused.error.code).toBe("relay_grant_unavailable");
    }
    expect(resolveCalls).toBe(0);
  });

  it("returns the closed r3 refused shape on the five methods", async () => {
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => null,
    });
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      const refused = await consumer[method](vector.positive[0].value);
      expect(refused.status).toBe("refused");
      expect(Object.keys(refused).sort()).toEqual(["error", "status"]);
      expect(Object.keys(refused.error).sort()).toEqual([
        "code",
        "format",
        "kind",
        "retryable",
      ]);
      expect(isMeshOriginRefusal(refused)).toBe(true);
    }
  });

  it("an already-aborted signal precedes unavailability on the five methods", async () => {
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => null,
    });
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      const refused = await consumer[method](vector.positive[0].value, {
        signal: AbortSignal.abort(),
      });
      expect(refused.status).toBe("refused");
      expect(Object.keys(refused).sort()).toEqual(["error", "status"]);
      expect(refused.error.code).toBe("relay_unavailable");
      expect(refused.error.retryable).toBe(false);
      expect(isMeshOriginRefusal(refused)).toBe(true);
    }
  });

  it("never throws on dispatch; TypeError only for invalid JS use", async () => {
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => null,
    });
    for (const method of MESH_ORIGIN_METHODS) {
      const vector = loadJson(`vectors/${vectorFileName(method)}`);
      await expect(
        consumer[method](vector.positive[0].value),
      ).resolves.toMatchObject({ status: "refused" });
      await expect(
        consumer[method](vector.positive[0].value, {
          signal: AbortSignal.timeout(1000),
        }),
      ).resolves.toMatchObject({ status: "refused" });
      await expect(
        consumer[method](
          vector.positive[0].value,
          "signal" as unknown as { signal?: AbortSignal },
        ),
      ).rejects.toThrow(TypeError);
      await expect(
        consumer[method](
          vector.positive[0].value,
          { signal: "now" } as unknown as { signal?: AbortSignal },
        ),
      ).rejects.toThrow(TypeError);
      await expect(
        consumer[method](
          vector.positive[0].value,
          undefined,
          "extra" as unknown as undefined,
        ),
      ).rejects.toThrow(TypeError);
    }
    await expect(
      consumer.snapshot(null as unknown as Record<string, unknown>),
    ).rejects.toThrow(TypeError);
    await expect(
      consumer.snapshot([] as unknown as Record<string, unknown>),
    ).rejects.toThrow(TypeError);
  });

  it("dispose is synchronous, idempotent and outcome-neutral", async () => {
    const consumer = await createMeshOriginConsumer({
      resolveSession: () => null,
    });
    const before = await consumer.snapshot(
      loadJson("vectors/port-SessionOriginRegistryPortV1-snapshot.json")
        .positive[0].value,
    );
    expect(() => consumer.dispose()).not.toThrow();
    expect(() => consumer.dispose()).not.toThrow();
    const after = await consumer.snapshot(
      loadJson("vectors/port-SessionOriginRegistryPortV1-snapshot.json")
        .positive[0].value,
    );
    expect(after).toEqual(before);
  });
});

describe("mesh origin-port revision-digest parity", () => {
  it("pins the digest vector envelope without local recomputation", () => {
    const digests = loadJson("vectors/registry-revision-digests.json");
    expect(digests.format).toBe("rc2.registry-digest-vectors/1");
    expect(digests.positive).toHaveLength(2);
    for (const entry of digests.positive) {
      expect(typeof entry.domain).toBe("string");
      expect(entry.domain.endsWith("\0")).toBe(true);
      expect(entry.projectionDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof entry.inputBase64).toBe("string");
    }
    expect(digests.activatedSignedSnapshot.body.format).toBe(
      "cluster-mesh.session/1",
    );
    expect(digests.activatedSignedSnapshot.signature.alg).toBe("Ed25519");
    expect(digests.negative.map((entry: { id: string }) => entry.id)).toEqual([
      "listing-envelope-instead-of-coarse",
      "activated-signature-included",
    ]);
    for (const entry of digests.negative) {
      expect(entry.expected).toBe("digest-mismatch");
    }
  });
});

describe("mesh origin-port import graph", () => {
  it("imports the published archive root only, never source or deep paths", () => {
    const source = readFileSync(
      new URL("./mesh-consumer-origin.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/cluster-mesh\/src/);
    const deepUses =
      source.match(/@sentropic\/cluster-mesh\/[^"'`\s)]+/g) ?? [];
    for (const use of deepUses) {
      expect(use).toBe("@sentropic/cluster-mesh/package.json");
    }
    expect(source).not.toMatch(/from\s+["']@sentropic\/cluster-mesh["']/);
    expect(source).not.toMatch(/require\(\s*["']@sentropic\/cluster-mesh/);
    expect(source).toMatch(/import\(\s*["']@sentropic\/cluster-mesh["']\s*\)/);
    expect(source).not.toMatch(/remote-protocol/);
    expect(source).not.toMatch(/remote-k8s-orchestrator/);
    // The fs climb escapes the specifier scans: bound every read to the
    // version metadata file alone.
    const fileReads = [...source.matchAll(/readFileSync\(([^)]*)\)/g)].map(
      (entry) => entry[1],
    );
    expect(fileReads).toHaveLength(1);
    expect(fileReads[0]).toContain('"package.json"');
    const staticImports = [...source.matchAll(/^import\s+[^;]+;/gm)].map(
      (entry) => entry[0],
    );
    for (const line of staticImports) {
      expect(line.startsWith('import type') || line.includes("node:")).toBe(
        true,
      );
    }
  });
});

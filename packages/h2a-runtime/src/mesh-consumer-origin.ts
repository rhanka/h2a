/**
 * Mesh origin-port consumer — registry slice only (cell RC2.mesh-consumer,
 * B6 lot 1).
 *
 * This module wires the h2a-owned origin-port composition against the packed
 * `@sentropic/cluster-mesh` archive root only: it probes the installed
 * archive for the `createSessionOriginRegistry` factory and exposes the five
 * `SessionOriginRegistryPortV1` methods with the exact contract call shape
 * (single parameter object plus optional `{ signal }`, typed refusal values,
 * never a throw for a refused call).
 *
 * The registry-bearing archive is unpublished, so every dispatch refuses
 * with the contract `relay_grant_unavailable` error while the probe reports
 * `incompatible-version`. Nothing is filled locally: the native side never
 * supplies writer epoch/revision or a signing key, allocates no revision,
 * matches no ACK and calls the host `resolveSession` binding zero times
 * while unavailable. The lane slice (connector, lane client, source
 * credentials) is out of scope here and stays blocked by relay-1.
 *
 * No route, no transport. Gates §5 stay closed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MESH_ORIGIN_PORT_ID = "SessionOriginRegistryPortV1" as const;

export const MESH_ORIGIN_METHODS = [
  "ingestLifecycle",
  "ingestCapabilities",
  "publishListing",
  "renewFreshness",
  "snapshot",
] as const;

export type MeshOriginPortMethod = (typeof MESH_ORIGIN_METHODS)[number];

export const MESH_ORIGIN_R3_PIN = {
  revision: "r3",
  manifestSha256:
    "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715",
  contractManifestSha256:
    "88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565",
  vectors: {
    "port-SessionOriginRegistryPortV1-ingestLifecycle.json":
      "ea46feb8c640049ded42eeb1e083fa0b3ccb71c861c02ada9a13a87b07485e64",
    "port-SessionOriginRegistryPortV1-ingestCapabilities.json":
      "6a323ecef9c4359aa75bc8467bc69967222cd1a4c7dbc32b0b363f48451f4e83",
    "port-SessionOriginRegistryPortV1-publishListing.json":
      "3fc5b5c67a747d1a4453d4db964562e8553fc3864a4510b1f9c003df01f98470",
    "port-SessionOriginRegistryPortV1-renewFreshness.json":
      "d64e7232ff538c0b8512a2f1f419fcb2e29aaa7fef6c1ffd71d148b841f1d1ec",
    "port-SessionOriginRegistryPortV1-snapshot.json":
      "77c1dba148e19c717fb1e551c40116707b518568fa8c74bf983a6fb758bce002",
    "registry-revision-digests.json":
      "31a375ea904d32f605c1560df3c6deee15d0c528f7059009e00d1cbf74568003",
  },
} as const;

/** Native process binding the origin facts belong to. Never rewritten. */
export interface MeshOriginProcessBindingRef {
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
}

/**
 * Host-owned session resolution. The consumer holds it without ever calling
 * it while unavailable; the mesh side owns writer epoch/revision and keys.
 */
export type MeshOriginResolveSession = (
  binding: MeshOriginProcessBindingRef,
) => unknown;

export interface MeshOriginConsumerInput {
  readonly resolveSession: MeshOriginResolveSession;
}

export interface MeshOriginRelayError {
  readonly format: "cluster-mesh.session-relay/1";
  readonly kind: "error";
  readonly code: "relay_grant_unavailable";
  readonly retryable: true;
}

export type MeshOriginRefusalReason =
  | "archive-not-installed"
  | "incompatible-version";

export interface MeshOriginRefusal {
  readonly status: "unavailable";
  readonly method: MeshOriginPortMethod | null;
  readonly reason: MeshOriginRefusalReason;
  readonly installedVersion: string | null;
  readonly exportPresent: boolean;
  readonly error: MeshOriginRelayError;
}

export interface MeshOriginCallOptions {
  readonly signal?: AbortSignal;
}

export interface MeshOriginConsumer {
  readonly status: "unavailable";
  readonly port: typeof MESH_ORIGIN_PORT_ID;
  readonly methods: readonly MeshOriginPortMethod[];
  readonly installedVersion: string | null;
  readonly exportPresent: boolean;
  readonly refusal: MeshOriginRefusal;
  ingestLifecycle(
    parameters: Record<string, unknown>,
    options?: MeshOriginCallOptions,
  ): Promise<MeshOriginRefusal>;
  ingestCapabilities(
    parameters: Record<string, unknown>,
    options?: MeshOriginCallOptions,
  ): Promise<MeshOriginRefusal>;
  publishListing(
    parameters: Record<string, unknown>,
    options?: MeshOriginCallOptions,
  ): Promise<MeshOriginRefusal>;
  renewFreshness(
    parameters: Record<string, unknown>,
    options?: MeshOriginCallOptions,
  ): Promise<MeshOriginRefusal>;
  snapshot(
    parameters: Record<string, unknown>,
    options?: MeshOriginCallOptions,
  ): Promise<MeshOriginRefusal>;
  dispose(): void;
}

export function isMeshOriginRefusal(value: unknown): value is MeshOriginRefusal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["status"] !== "unavailable") {
    return false;
  }
  const error = candidate["error"];
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const fields = error as Record<string, unknown>;
  return (
    fields["format"] === "cluster-mesh.session-relay/1" &&
    fields["kind"] === "error" &&
    fields["code"] === "relay_grant_unavailable" &&
    fields["retryable"] === true
  );
}

function checkParameters(parameters: unknown): void {
  if (
    typeof parameters !== "object" ||
    parameters === null ||
    Array.isArray(parameters)
  ) {
    throw new TypeError(
      "mesh origin-port call takes a single parameter object",
    );
  }
}

function checkOptions(options: unknown): void {
  if (options === undefined) {
    return;
  }
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      "mesh origin-port call takes at most an options object",
    );
  }
  const signal = (options as { signal?: unknown })["signal"];
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("mesh origin-port signal must be an AbortSignal");
  }
}

function checkCallShape(parameters: unknown, options: unknown): void {
  checkParameters(parameters);
  checkOptions(options);
}

interface MeshOriginProbe {
  readonly installedVersion: string | null;
  readonly exportPresent: boolean;
}

function readInstalledVersion(): string | null {
  let href: string;
  try {
    href = import.meta.resolve("@sentropic/cluster-mesh");
  } catch {
    return null;
  }
  let dir = dirname(fileURLToPath(href));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (meta.name === "@sentropic/cluster-mesh") {
        return typeof meta.version === "string" && meta.version.length > 0
          ? meta.version
          : null;
      }
    } catch {
      /* keep climbing past dist layouts */
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

async function probeRegistryArchive(): Promise<MeshOriginProbe> {
  const installedVersion = readInstalledVersion();
  if (installedVersion === null) {
    return { installedVersion, exportPresent: false };
  }
  try {
    const mesh = (await import(
      "@sentropic/cluster-mesh"
    )) as Record<string, unknown>;
    return {
      installedVersion,
      exportPresent:
        typeof mesh["createSessionOriginRegistry"] === "function",
    };
  } catch {
    return { installedVersion, exportPresent: false };
  }
}

function refuse(
  method: MeshOriginPortMethod | null,
  probe: MeshOriginProbe,
): MeshOriginRefusal {
  return {
    status: "unavailable",
    method,
    reason:
      probe.installedVersion === null
        ? "archive-not-installed"
        : "incompatible-version",
    installedVersion: probe.installedVersion,
    exportPresent: probe.exportPresent,
    error: {
      format: "cluster-mesh.session-relay/1",
      kind: "error",
      code: "relay_grant_unavailable",
      retryable: true,
    },
  };
}

async function compose(
  input: MeshOriginConsumerInput,
  probe: MeshOriginProbe,
): Promise<MeshOriginConsumer> {
  void input;
  const base = refuse(null, probe);
  const dispatch = async (
    method: MeshOriginPortMethod,
    parameters: unknown,
    options: unknown,
    extra: readonly unknown[],
  ): Promise<MeshOriginRefusal> => {
    if (extra.length > 0) {
      throw new TypeError(
        "mesh origin-port call takes a single parameter object",
      );
    }
    checkCallShape(parameters, options);
    return refuse(method, probe);
  };
  return {
    status: "unavailable",
    port: MESH_ORIGIN_PORT_ID,
    methods: [...MESH_ORIGIN_METHODS],
    installedVersion: probe.installedVersion,
    exportPresent: probe.exportPresent,
    refusal: base,
    ingestLifecycle: (parameters, options, ...extra: readonly unknown[]) =>
      dispatch("ingestLifecycle", parameters, options, extra),
    ingestCapabilities: (parameters, options, ...extra: readonly unknown[]) =>
      dispatch("ingestCapabilities", parameters, options, extra),
    publishListing: (parameters, options, ...extra: readonly unknown[]) =>
      dispatch("publishListing", parameters, options, extra),
    renewFreshness: (parameters, options, ...extra: readonly unknown[]) =>
      dispatch("renewFreshness", parameters, options, extra),
    snapshot: (parameters, options, ...extra: readonly unknown[]) =>
      dispatch("snapshot", parameters, options, extra),
    dispose: () => {},
  };
}

/**
 * Build the registry-slice consumer. Throws synchronously with TypeError on
 * invalid JS use; any missing capability refuses with a typed value.
 */
export function createMeshOriginConsumer(
  input: unknown,
): Promise<MeshOriginConsumer> {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("mesh origin-port consumer takes an input object");
  }
  const resolveSession = (input as { resolveSession?: unknown })[
    "resolveSession"
  ];
  if (typeof resolveSession !== "function") {
    throw new TypeError(
      "mesh origin-port consumer requires a resolveSession function",
    );
  }
  const held: MeshOriginConsumerInput = {
    resolveSession: resolveSession as MeshOriginResolveSession,
  };
  return probeRegistryArchive().then((probe) => compose(held, probe));
}

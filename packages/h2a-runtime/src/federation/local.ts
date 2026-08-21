import { spawn } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hostname, userInfo } from "node:os";
import {
  createDegenerateClusterMesh,
  InvalidProjectionReferenceError,
  type ClusterMesh,
  type ClusterNodeDescriptor,
  type CommandResult,
  type CommandRunnerPort,
  type DeviceApprovalResult,
  type DevicePollOutcome,
  type IssuedDeviceCode,
  type LocalDeviceAttachmentPort,
  type LocalProjectionPort,
  type LocalWorkstationDirectoryPort,
  type ProjectionKind,
  type SignedProjectionReference,
  type ValidatedMembershipPort,
} from "@sentropic/cluster-mesh";

export type LocalFederationPorts = Parameters<
  typeof createDegenerateClusterMesh
>[0];

export interface LocalFederationConfig {
  readonly hostname: string;
  readonly issuer: string;
  readonly endpoint: string;
  readonly workspaceId: string;
  readonly ownerUserId: string;
  readonly ownerRole: string;
  readonly tenantId: string;
  readonly projectionSigningKey: Uint8Array;
}

type H2aExecutor = (
  command: "h2a",
  args: readonly string[],
) => Promise<CommandResult>;

export interface LocalFederationDependencies {
  readonly executeH2a?: H2aExecutor;
  readonly now?: () => Date;
}

interface LocalProjectionPayload {
  readonly kind: ProjectionKind;
  readonly localId: string;
  readonly homeNodeId: ClusterNodeDescriptor["nodeId"];
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createLocalNode(
  config: Pick<LocalFederationConfig, "hostname" | "issuer" | "endpoint">,
): ClusterNodeDescriptor {
  return {
    kind: "server",
    nodeId: `node:${digest(config.hostname)}`,
    issuer: config.issuer,
    endpoint: config.endpoint,
    state: "active",
  };
}

export function createEmptyWorkstationDirectory(): LocalWorkstationDirectoryPort {
  return { async listAttached() { return []; } };
}

export function createLocalOwnerMemberships(
  config: Pick<
    LocalFederationConfig,
    "workspaceId" | "ownerUserId" | "tenantId"
  >,
): ValidatedMembershipPort {
  return {
    async resolveApproved(input) {
      return input.workspaceId === config.workspaceId &&
          input.userId === config.ownerUserId
        ? { tenantId: config.tenantId, userId: config.ownerUserId, status: "approved" }
        : null;
    },
  };
}

function decodeCanonicalBase64url(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

function decodeProjection(reference: unknown): LocalProjectionPayload | null {
  try {
    const decoded = decodeCanonicalBase64url(reference);
    if (!decoded) return null;
    const value = JSON.parse(decoded.toString("utf8")) as
      Partial<LocalProjectionPayload>;
    return value &&
        (value.kind === "human_identity" ||
          value.kind === "agent_identity" ||
          value.kind === "memory_snapshot") &&
        typeof value.localId === "string" &&
        typeof value.homeNodeId === "string" &&
        value.homeNodeId.startsWith("node:")
      ? (value as LocalProjectionPayload)
      : null;
  } catch {
    return null;
  }
}

export function createLocalProjectionPort(
  self: ClusterNodeDescriptor,
  signingKey: Uint8Array,
): LocalProjectionPort {
  const keyId = `local:${digest(signingKey).slice(0, 16)}`;
  const sign = (reference: string) =>
    createHmac("sha256", signingKey).update(reference).digest();
  const verify = async (reference: SignedProjectionReference) => {
    if (
      typeof reference?.signature !== "string" ||
      typeof reference.reference !== "string" ||
      reference.homeNodeId !== self.nodeId ||
      reference.issuer !== self.issuer ||
      reference.keyId !== keyId
    ) return false;
    const payload = decodeProjection(reference.reference);
    if (
      !payload ||
      payload.kind !== reference.kind ||
      payload.homeNodeId !== self.nodeId
    ) return false;
    const actual = decodeCanonicalBase64url(reference.signature);
    if (!actual) return false;
    const expected = sign(reference.reference);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  return {
    async create(kind, localId) {
      const payload: LocalProjectionPayload = {
        kind,
        localId,
        homeNodeId: self.nodeId,
      };
      const reference = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return {
        kind,
        reference,
        homeNodeId: self.nodeId,
        issuer: self.issuer,
        keyId,
        signature: sign(reference).toString("base64url"),
      };
    },

    verify,

    async resolve<T>(reference: SignedProjectionReference): Promise<T> {
      if (!(await verify(reference))) {
        throw new InvalidProjectionReferenceError();
      }
      const payload = decodeProjection(reference.reference);
      if (!payload) throw new InvalidProjectionReferenceError();
      return payload as T;
    },
  };
}

async function spawnH2a(
  command: "h2a",
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      finish({ exitCode: 127, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.once("close", (code) => {
      finish({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export class UnconfiguredNhiCommandRunnerError extends Error {
  constructor() {
    super("no authorized NHI command runner configured");
    this.name = "UnconfiguredNhiCommandRunnerError";
  }
}

export function createUnconfiguredNhiRunner(): CommandRunnerPort {
  return {
    async run() {
      throw new UnconfiguredNhiCommandRunnerError();
    },
  };
}

export function createSpawnH2aCommandRunner(): CommandRunnerPort {
  return { run: spawnH2a };
}

export function createH2aCommandRunner(
  execute: H2aExecutor,
): CommandRunnerPort {
  return { run: execute };
}

interface PendingDeviceCode {
  readonly issued: IssuedDeviceCode;
  readonly requestedName: string;
  lastPollAt?: number;
  approved?: Extract<DevicePollOutcome, { status: "approved" }>;
}

export function createInMemoryDeviceAttachments(
  ownerUserId: string,
  ownerRole: string,
  now: () => Date = () => new Date(),
): LocalDeviceAttachmentPort {
  const byDeviceCode = new Map<string, PendingDeviceCode>();
  const byUserCode = new Map<string, PendingDeviceCode>();
  let sequence = 0;

  return {
    issueDeviceCode(deviceName): IssuedDeviceCode {
      sequence += 1;
      const serial = sequence.toString(36).toUpperCase().padStart(8, "0");
      const issued: IssuedDeviceCode = {
        deviceCode: `local-device-${serial}`,
        userCode: `${serial.slice(0, 4)}-${serial.slice(4)}`,
        intervalSec: 5,
        expiresAt: new Date(now().getTime() + 10 * 60_000),
      };
      const entry: PendingDeviceCode = {
        issued,
        requestedName: deviceName?.trim() || "local-device",
      };
      byDeviceCode.set(issued.deviceCode, entry);
      byUserCode.set(issued.userCode, entry);
      return issued;
    },

    pollDeviceCode(deviceCode): DevicePollOutcome {
      const entry = byDeviceCode.get(deviceCode);
      if (!entry) return { status: "denied" };
      const polledAt = now().getTime();
      if (polledAt >= entry.issued.expiresAt.getTime()) return { status: "expired" };
      if (entry.approved) return entry.approved;
      if (
        entry.lastPollAt !== undefined &&
        polledAt - entry.lastPollAt < entry.issued.intervalSec * 1_000
      ) return { status: "slow_down" };
      entry.lastPollAt = polledAt;
      return { status: "authorization_pending" };
    },

    approveDeviceCode(userCode, userId, role, deviceName): DeviceApprovalResult {
      if (userId !== ownerUserId || role !== ownerRole) {
        // This union has no authorization result; avoid disclosing issued codes.
        return { ok: false, reason: "not_found" };
      }
      const entry = byUserCode.get(userCode);
      if (!entry) return { ok: false, reason: "not_found" };
      if (now().getTime() >= entry.issued.expiresAt.getTime()) {
        return { ok: false, reason: "expired" };
      }
      if (entry.approved) return { ok: false, reason: "already_resolved" };
      entry.approved = {
        status: "approved",
        userId: ownerUserId,
        role: ownerRole,
        deviceName: deviceName?.trim() || entry.requestedName,
      };
      return { ok: true };
    },
  };
}

export function createLocalFederationPorts(
  config: LocalFederationConfig,
  dependencies: LocalFederationDependencies = {},
): LocalFederationPorts {
  const self = createLocalNode(config);
  return {
    self,
    workstations: createEmptyWorkstationDirectory(),
    memberships: createLocalOwnerMemberships(config),
    projections: createLocalProjectionPort(self, config.projectionSigningKey),
    nhiRunner: dependencies.executeH2a
      ? createH2aCommandRunner(dependencies.executeH2a)
      : createUnconfiguredNhiRunner(),
    devices: createInMemoryDeviceAttachments(
      config.ownerUserId,
      config.ownerRole,
      dependencies.now,
    ),
  };
}

export function createDefaultLocalFederationPorts(): LocalFederationPorts {
  const localHostname = hostname();
  const workspaceId = process.cwd();
  const hostDigest = digest(localHostname);
  return createLocalFederationPorts({
    hostname: localHostname,
    issuer: `urn:h2a:local:${hostDigest}`,
    endpoint: `local://${localHostname}`,
    workspaceId,
    ownerUserId: userInfo().username,
    ownerRole: "owner",
    tenantId: `tenant:local:${digest(workspaceId)}`,
    projectionSigningKey: randomBytes(32),
  });
}

export function bootstrapLocalFederation(
  ports: LocalFederationPorts,
): ClusterMesh {
  return createDegenerateClusterMesh(ports);
}

export function bootstrapDefaultLocalFederation(): ClusterMesh {
  return bootstrapLocalFederation(createDefaultLocalFederationPorts());
}

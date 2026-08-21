import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CapabilityGatedError,
  InvalidProjectionReferenceError,
  RFC8693_GRANT_TYPE,
  type GatedCapability,
  type SignedProjectionReference,
} from "@sentropic/cluster-mesh";
import {
  bootstrapDefaultLocalFederation,
  bootstrapLocalFederation,
  createLocalFederationPorts,
  type LocalFederationConfig,
} from "./local.js";

const config: LocalFederationConfig = {
  hostname: "test-host",
  issuer: "urn:h2a:test-host",
  endpoint: "local://test-host",
  workspaceId: "/workspace/local",
  ownerUserId: "local-owner",
  ownerRole: "owner",
  tenantId: "local-tenant",
  projectionSigningKey: Buffer.from("test-only-projection-signing-key"),
};

function fixture() {
  let nowMs = Date.parse("2026-08-20T12:00:00.000Z");
  const executeH2a = vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  }));
  const ports = createLocalFederationPorts(config, {
    executeH2a,
    now: () => new Date(nowMs),
  });
  return {
    executeH2a,
    ports,
    mesh: bootstrapLocalFederation(ports),
    advance(ms: number) { nowMs += ms; },
  };
}

async function expectGated(
  operation: Promise<unknown>,
  capability: GatedCapability,
): Promise<void> {
  try {
    await operation;
    throw new Error("expected capability to be gated");
  } catch (error) {
    expect(error).toBeInstanceOf(CapabilityGatedError);
    expect((error as CapabilityGatedError).capability).toBe(capability);
  }
}

describe("local federation", () => {
  it("should bootstrap a ClusterMesh from all six local ports", async () => {
    const { executeH2a, mesh, ports } = fixture();

    expect(mesh.membership.self).toBe(ports.self);
    await expect(mesh.membership.listDirectory({
      workspaceId: config.workspaceId,
      userId: config.ownerUserId,
    })).resolves.toEqual([ports.self]);
    await expect(mesh.membership.listDirectory({
      workspaceId: config.workspaceId,
      userId: "foreign-user",
    })).rejects.toMatchObject({ code: "tenant_membership_required" });

    const projected = await mesh.wrap.projections.project("agent_identity", "agent:1");
    await expect(mesh.wrap.projections.resolve(projected)).resolves.toEqual({
      kind: "agent_identity",
      localId: "agent:1",
      homeNodeId: ports.self.nodeId,
    });

    const issued = mesh.devices.issueDeviceCode("laptop");
    expect(mesh.devices.approveDeviceCode(
      issued.userCode,
      config.ownerUserId,
      "owner",
    )).toEqual({ ok: true });
    expect(mesh.devices.approveDeviceCode(
      issued.userCode,
      config.ownerUserId,
      "owner",
    )).toEqual({ ok: false, reason: "already_resolved" });
    expect(mesh.devices.pollDeviceCode(issued.deviceCode)).toEqual({
      status: "approved",
      userId: config.ownerUserId,
      role: "owner",
      deviceName: "laptop",
    });

    await expect(mesh.wrap.nhi.offboard({ instance: "local" })).resolves.toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
    });
    expect(executeH2a).toHaveBeenCalledWith("h2a", [
      "nhi",
      "offboard",
      "--instance",
      "local",
    ]);
  });

  it("should fail closed without an authorized NHI command runner", async () => {
    const ports = createLocalFederationPorts(config);

    await expect(ports.nhiRunner.run("h2a", ["nhi", "offboard"])).rejects.toThrow(
      "no authorized NHI command runner configured",
    );
  });

  it("should delegate NHI commands to an injected executor", async () => {
    const result = { exitCode: 0, stdout: "ok\n", stderr: "" };
    const executeH2a = vi.fn(async () => result);
    const ports = createLocalFederationPorts(config, { executeH2a });

    await expect(ports.nhiRunner.run("h2a", ["nhi", "offboard"])).resolves.toBe(result);
    expect(executeH2a).toHaveBeenCalledWith("h2a", ["nhi", "offboard"]);
  });

  it("should bootstrap default local federation with exact single-node capabilities", () => {
    expect(bootstrapDefaultLocalFederation().capabilities).toEqual({
      mode: "single-node",
      localDevices: "available",
      localProjection: "available",
      interServerDirectory: "gated",
      tokenExchange: "gated",
      memoryReplication: "gated",
    });
  });

  it("should approve device codes only for the configured local owner role", () => {
    const { mesh } = fixture();
    const issued = mesh.devices.issueDeviceCode("laptop");

    expect(mesh.devices.approveDeviceCode(
      issued.userCode,
      "foreign-user",
      "admin",
    )).toEqual({ ok: false, reason: "not_found" });
    expect(mesh.devices.pollDeviceCode(issued.deviceCode)).toEqual({
      status: "authorization_pending",
    });
    expect(mesh.devices.approveDeviceCode(
      issued.userCode,
      config.ownerUserId,
      "admin",
    )).toEqual({ ok: false, reason: "not_found" });
    expect(mesh.devices.approveDeviceCode(
      issued.userCode,
      config.ownerUserId,
      config.ownerRole,
    )).toEqual({ ok: true });
    expect(mesh.devices.pollDeviceCode(issued.deviceCode)).toEqual({
      status: "approved",
      userId: config.ownerUserId,
      role: config.ownerRole,
      deviceName: "laptop",
    });
  });

  it("should gate inter-server discovery and revocation", async () => {
    const { mesh, ports } = fixture();
    await expectGated(
      mesh.membership.interServer.discover(),
      "inter_server_discovery",
    );
    await expectGated(
      mesh.membership.interServer.revoke(ports.self.nodeId),
      "inter_server_revocation",
    );
  });

  it("should gate RFC 8693 token exchange", async () => {
    await expectGated(
      fixture().mesh.trust.tokenExchange.exchange({
        grantType: RFC8693_GRANT_TYPE,
        subjectToken: "opaque",
        subjectTokenType: "urn:ietf:params:oauth:token-type:access_token",
        audience: "local",
        scope: [],
      }),
      "rfc8693_token_exchange",
    );
  });

  it("should gate memory replication and purge", async () => {
    const { mesh, ports } = fixture();
    const reference = await ports.projections.create("memory_snapshot", "memory:1");
    await expectGated(
      mesh.wrap.memoryReplication.replicate(reference),
      "memory_replication",
    );
    await expectGated(
      mesh.wrap.memoryReplication.purge(reference),
      "memory_replication",
    );
  });

  it("should fail closed for a foreign projection home node", async () => {
    const { mesh, ports } = fixture();
    const local = await ports.projections.create("human_identity", "human:1");
    const foreign: SignedProjectionReference = {
      ...local,
      homeNodeId: "node:foreign",
    };

    await expect(ports.projections.verify(foreign)).resolves.toBe(false);
    await expect(ports.projections.resolve(foreign)).rejects.toBeInstanceOf(
      InvalidProjectionReferenceError,
    );
    await expectGated(
      mesh.wrap.projections.resolve(foreign),
      "remote_projection",
    );
  });

  it("should reject malformed projection encodings", async () => {
    const { ports } = fixture();
    const local = await ports.projections.create("human_identity", "human:1");
    const malformedSignature: SignedProjectionReference = {
      ...local,
      signature: `${local.signature}=`,
    };
    const malformedReference: SignedProjectionReference = {
      ...local,
      reference: `${local.reference}=`,
      signature: createHmac("sha256", config.projectionSigningKey)
        .update(`${local.reference}=`)
        .digest("base64url"),
    };

    await expect(ports.projections.verify(malformedSignature)).resolves.toBe(false);
    await expect(ports.projections.resolve(malformedSignature)).rejects.toBeInstanceOf(
      InvalidProjectionReferenceError,
    );
    await expect(ports.projections.verify(malformedReference)).resolves.toBe(false);
    await expect(ports.projections.resolve(malformedReference)).rejects.toBeInstanceOf(
      InvalidProjectionReferenceError,
    );
  });

  it("should keep every adapter local when effectful dependencies are fakes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const { advance, executeH2a, ports } = fixture();
      await expect(ports.workstations.listAttached()).resolves.toEqual([]);
      await expect(ports.memberships.resolveApproved({
        workspaceId: config.workspaceId,
        userId: config.ownerUserId,
      })).resolves.toMatchObject({ status: "approved" });
      const reference = await ports.projections.create("agent_identity", "agent:2");
      await expect(ports.projections.verify(reference)).resolves.toBe(true);

      const issued = ports.devices.issueDeviceCode();
      expect(ports.devices.pollDeviceCode(issued.deviceCode)).toEqual({
        status: "authorization_pending",
      });
      expect(ports.devices.pollDeviceCode(issued.deviceCode)).toEqual({
        status: "slow_down",
      });
      advance(10 * 60_000);
      expect(ports.devices.pollDeviceCode(issued.deviceCode)).toEqual({
        status: "expired",
      });
      expect(ports.devices.approveDeviceCode(
        issued.userCode,
        config.ownerUserId,
        "owner",
      )).toEqual({ ok: false, reason: "expired" });
      expect(ports.devices.approveDeviceCode(
        "missing",
        config.ownerUserId,
        "owner",
      )).toEqual({ ok: false, reason: "not_found" });

      expect(executeH2a).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

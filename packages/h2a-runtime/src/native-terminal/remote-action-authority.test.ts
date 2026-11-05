// @ts-ignore Shared JS test isolation helper.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { rmSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { digestDomain } from "../remote-action-contract.js";
import { createPinnedTrust } from "../remote-action-trust.js";
import type { PtyHandle, PtySpawner } from "../pty.js";
import { mintCliSessionProof } from "../remote-action-cli-proof.js";
import { NativeTerminalHost } from "./host.js";
import {
  NativeTerminalActionAuthority,
  type CliProofSessionComposition,
} from "./remote-action-authority.js";

let scratch: string;
let registryPath: string;

beforeEach(() => {
  scratch = createPrivateTestDirectory("n3-");
  registryPath = join(scratch, "registry.json");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

class StubPty implements PtyHandle {
  static #nextPid = 51000;
  readonly pid = StubPty.#nextPid++;
  readonly pgid = this.pid;
  readonly cols = 80;
  readonly rows = 24;
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(handler: (chunk: string) => void): { dispose(): void } {
    this.#dataHandlers.add(handler);
    return { dispose: () => this.#dataHandlers.delete(handler) };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitHandlers.add(handler);
    return { dispose: () => this.#exitHandlers.delete(handler) };
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const handler of this.#exitHandlers) handler(event);
  }
}

function stubSpawner(): { spawner: PtySpawner; ptys: Map<string, StubPty>; spawn: ReturnType<typeof vi.fn> } {
  const ptys = new Map<string, StubPty>();
  const spawner: PtySpawner = (options) => {
    const pty = new StubPty();
    ptys.set(options.command, pty);
    return pty;
  };
  return { spawner, ptys, spawn: vi.fn(spawner) };
}

const NOW_MS = 1793520000000;

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

function composition(overrides: Partial<CliProofSessionComposition> = {}): CliProofSessionComposition {
  return {
    admission: {
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
    },
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
    owner: { issuer: "test-idp", sub: "user-1" },
    nativeSessionPublicKeyId: "native-key-1",
    capabilitiesDigest: "d".repeat(64),
    permissionMode: "interactive",
    autoApprovePolicyDigest: null,
    proofId: "proof-1",
    ...overrides,
  };
}

function createHost(spawn: PtySpawner): NativeTerminalHost {
  return new NativeTerminalHost({
    generation: "host-generation-1",
    replayBytesPerSession: 1024,
    registryPath,
    spawner: spawn,
  });
}

function createSession(host: NativeTerminalHost, id: string): void {
  host.create({ id, command: id, args: [], cwd: `/workspace/${id}`, env: {}, cols: 80, rows: 24 });
}

describe("native terminal action authority", () => {
  it("signs the exact host-table target for a real host-owned session", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const state = host.state("cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const record = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    const body = authority.verifySessionProof("cli-1", record, opts());
    const target = body["target"] as Record<string, unknown>;
    expect(target["nativeSessionId"]).toBe("cli-1");
    expect(target["controllerEpoch"]).toBe(state.controllerEpoch);
    expect(digestDomain("target", target)).toBe(
      digestDomain("target", body["target"]),
    );
    expect(body["providerId"]).toBe("provider-1");
    expect(body["permissionMode"]).toBe("interactive");
    // Host-local only: the session PTY was never written through.
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("creates through the host method with identical bytes", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    // Ed25519 is deterministic: same session, composition and instant mint
    // byte-identical records on both paths into the same host table.
    const viaHost = host.createCliSessionProof("cli-1", composition(), NOW_MS);
    const authority = new NativeTerminalActionAuthority(host);
    const viaAuthority = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    expect(viaHost).toEqual(viaAuthority);
    expect(() =>
      authority.verifySessionProof("cli-1", viaHost, opts()),
    ).not.toThrow();
  });

  it("refuses issuance for a session the host table does not own", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    const authority = new NativeTerminalActionAuthority(host);
    expect(() => authority.issueSessionProof("ghost", composition(), NOW_MS)).toThrowError(
      expect.objectContaining({ code: "authority_refused" }),
    );
  });

  it("refuses a missing composition with the typed source-gap code", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    expect(() =>
      authority.issueSessionProof("cli-1", composition({ admission: null }), NOW_MS),
    ).toThrowError(expect.objectContaining({ code: "contract_source_gap_blocked" }));
    expect(() =>
      authority.issueSessionProof("cli-1", composition({ signer: null }), NOW_MS),
    ).toThrowError(expect.objectContaining({ code: "contract_source_gap_blocked" }));
  });

  it("invalidates the prior proof when the session closes", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const record = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    const state = host.state("cli-1");
    host.stopIfIncarnation("cli-1", state.generation, state.incarnation);
    expect(() => authority.verifySessionProof("cli-1", record, opts())).toThrowError(
      expect.objectContaining({ code: "authority_refused" }),
    );
  });

  it("invalidates the prior proof when the session id is replaced", () => {
    const { spawn, ptys } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const record = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    // Drive the stub PTY to exit, then recreate the same id: new incarnation.
    ptys.get("cli-1")!.emitExit({ exitCode: 0 });
    expect(host.state("cli-1").status).toBe("exited");
    createSession(host, "cli-1");
    expect(() => authority.verifySessionProof("cli-1", record, opts())).toThrowError(
      expect.objectContaining({ code: "binding_mismatch" }),
    );
  });

  it("invalidates the prior proof on a permission-mode switch", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const record = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    authority.setSessionPermissionMode("cli-1", "auto-approve");
    expect(() => authority.verifySessionProof("cli-1", record, opts())).toThrowError(
      expect.objectContaining({ code: "binding_mismatch" }),
    );
  });

  it("refuses re-signed executable and session-key mutations the authority did not issue", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const issued = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    const target = issued.body["target"];
    const mutatedDigest = mintCliSessionProof(
      {
        ...composition(),
        target,
        provider: {
          providerId: "provider-1",
          providerVersion: "v1",
          executableDigest: "f".repeat(64),
        },
      },
      NOW_MS,
    );
    expect(() => authority.verifySessionProof("cli-1", mutatedDigest, opts())).toThrowError(
      expect.objectContaining({ code: "binding_mismatch" }),
    );
    const mutatedKey = mintCliSessionProof(
      { ...composition(), target, nativeSessionPublicKeyId: "native-key-2" },
      NOW_MS,
    );
    expect(() => authority.verifySessionProof("cli-1", mutatedKey, opts())).toThrowError(
      expect.objectContaining({ code: "binding_mismatch" }),
    );
    expect(() => authority.verifySessionProof("cli-1", issued, opts())).not.toThrow();
  });

  it("refuses mutated proof bytes against the live session", () => {
    const { spawn } = stubSpawner();
    const host = createHost(spawn);
    createSession(host, "cli-1");
    const authority = new NativeTerminalActionAuthority(host);
    const record = authority.issueSessionProof("cli-1", composition(), NOW_MS);
    const tampered = {
      body: { ...(record.body as Record<string, unknown>), providerVersion: "v2" },
      signature: record.signature,
    };
    expect(() => authority.verifySessionProof("cli-1", tampered, opts())).toThrowError(
      expect.objectContaining({ code: "invalid_signature" }),
    );
  });
});

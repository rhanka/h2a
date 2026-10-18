import { describe, expect, it } from "vitest";

import type { NativeTerminalOperation } from "./protocol.js";
import {
  OWNER_PROTOCOL_VERSION,
  OwnerProtocolAbsentError,
  assertOwnerChannelPresent,
  decodeOwnerFrame,
  encodeOwnerFrame,
  extractAppliedFrontier,
  extractWriteIdentity,
  negotiateOwnerCapabilities,
  OWNER_WRITE_IDENTITY_CAPABILITY,
} from "./owner-protocol.js";

const ALL_V1_OPERATIONS: ReadonlyArray<NativeTerminalOperation> = [
  "ping",
  "create",
  "list",
  "state",
  "read-output",
  "attach-observer",
  "acquire-controller",
  "acquire-controller-if-no-recent-human",
  "release-controller",
  "write",
  "resize",
  "stop",
  "stop-if-incarnation",
];

describe("owner-protocol", () => {
  it("should reject an owner-protocol frame with an unknown version", () => {
    const frame = `${JSON.stringify({ version: OWNER_PROTOCOL_VERSION + 99, id: "a", operation: "ping" })}\n`;
    expect(() => decodeOwnerFrame(frame)).toThrow(/version/);
  });

  it("should reject a truncated owner-protocol frame without dispatching", () => {
    let dispatched = false;
    const dispatch = (): void => {
      dispatched = true;
    };
    expect(() => decodeOwnerFrame('{"version":1,"id":"a",', dispatch)).toThrow();
    expect(dispatched).toBe(false);
    expect(() => decodeOwnerFrame("not json at all\n")).toThrow();
    expect(dispatched).toBe(false);
  });

  it("should round-trip every v1 client operation through the owner boundary unchanged", () => {
    for (const operation of ALL_V1_OPERATIONS) {
      const params = operation === "ping" || operation === "list"
        ? undefined
        : { probe: `${operation}-params` };
      const request = params === undefined
        ? { version: OWNER_PROTOCOL_VERSION, id: `id-${operation}`, operation }
        : { version: OWNER_PROTOCOL_VERSION, id: `id-${operation}`, operation, params };
      const decoded = decodeOwnerFrame(encodeOwnerFrame(request));
      expect(decoded).toEqual(request);
    }
  });

  it("should keep controller-lease identity across the owner boundary", () => {
    const lease = {
      role: "controller",
      id: "h2a-tty1",
      generation: "gen-1",
      incarnation: "inc-1",
      controllerId: "ctrl-1",
      epoch: 3,
    };
    const decoded = decodeOwnerFrame(
      encodeOwnerFrame({
        version: OWNER_PROTOCOL_VERSION,
        id: "lease-1",
        operation: "write",
        params: { lease, data: "x" },
      }),
    );
    expect(decoded.params).toEqual({ lease, data: "x" });
  });

  it("should carry a stable write identity and applied frontier across the owner boundary unchanged", () => {
    const writeIdentity = {
      sessionId: "h2a-tty1",
      incarnation: "inc-1",
      controllerEpoch: 3,
      seq: 41,
    };
    const appliedFrontier = { controllerId: "ctrl-1", epoch: 3, frontier: 40 };
    const params = { lease: { role: "controller" }, data: "hello", writeIdentity, appliedFrontier };
    const decoded = decodeOwnerFrame(
      encodeOwnerFrame({ version: OWNER_PROTOCOL_VERSION, id: "w-1", operation: "write", params }),
    );
    expect(extractWriteIdentity(decoded.params)).toEqual(writeIdentity);
    expect(extractAppliedFrontier(decoded.params)).toEqual(appliedFrontier);
    // Forwarding the decoded frame must not re-mint the identity.
    const forwarded = decodeOwnerFrame(encodeOwnerFrame(decoded));
    expect(extractWriteIdentity(forwarded.params)).toEqual(writeIdentity);
  });

  it("should negotiate the write-identity capability and fail closed on an unknown capability", () => {
    expect(negotiateOwnerCapabilities([OWNER_WRITE_IDENTITY_CAPABILITY])).toEqual({
      writeIdentity: true,
    });
    expect(negotiateOwnerCapabilities([])).toEqual({ writeIdentity: false });
    expect(() => negotiateOwnerCapabilities(["unknown-capability"])).toThrow(/capabilit/);
  });

  it("should fail closed when the owner side is absent, with a typed error", () => {
    expect(() => assertOwnerChannelPresent(null)).toThrow(OwnerProtocolAbsentError);
    expect(() => assertOwnerChannelPresent(undefined)).toThrow(OwnerProtocolAbsentError);
    const channel = { send: () => {} };
    expect(assertOwnerChannelPresent(channel)).toBe(channel);
  });
});

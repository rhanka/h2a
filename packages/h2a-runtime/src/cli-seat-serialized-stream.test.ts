import { describe, expect, it } from "vitest";

import {
  assertNoWriterCredentials,
  beginSerializedStream,
  captureSerializedResult,
  validateStreamClearance,
} from "./cli-seat-materialization.js";

const PREDECESSOR = { epoch: 1, generation: 3, operationId: "op-synth-codex-03" };

describe("cli-seat-serialized-stream", () => {
  it("opens one stream ticket per refresh family", () => {
    const ticket = beginSerializedStream("family-synth-codex-01", PREDECESSOR);
    expect(ticket.familyRef).toBe("family-synth-codex-01");
    expect(ticket.predecessor).toEqual(PREDECESSOR);
    expect(typeof ticket.streamOperationId).toBe("string");
  });

  it("seals a successor when the scenario changed the material", () => {
    const ticket = beginSerializedStream("family-synth-codex-01", PREDECESSOR);
    const capture = captureSerializedResult(ticket, { failed: false, changed: true, ambiguous: false });
    expect(capture.disposition).toBe("successor-sealed");
    expect(capture.requiresWriterJob).toBe(true);
  });

  it("captures a failed scenario before cleanup without skipping recovery", () => {
    const ticket = beginSerializedStream("family-synth-muse-01", PREDECESSOR);
    const capture = captureSerializedResult(ticket, { failed: true, changed: true, ambiguous: false });
    expect(capture.disposition).toBe("successor-sealed");
    expect(capture.scenarioFailed).toBe(true);
  });

  it("keeps the predecessor tuple on an unchanged transition", () => {
    const ticket = beginSerializedStream("family-synth-vibe-01", PREDECESSOR);
    const capture = captureSerializedResult(ticket, { failed: false, changed: false, ambiguous: false });
    expect(capture.disposition).toBe("unchanged-validated");
    expect(capture.successor).toBeUndefined();
    const clearance = validateStreamClearance(ticket, {
      familyRef: ticket.familyRef,
      streamOperationId: ticket.streamOperationId,
      predecessor: PREDECESSOR,
    });
    expect(clearance.cleared).toBe(true);
  });

  it("fences ambiguous provider side effects", () => {
    const ticket = beginSerializedStream("family-synth-agy-01", PREDECESSOR);
    const capture = captureSerializedResult(ticket, { failed: false, changed: true, ambiguous: true });
    expect(capture.disposition).toBe("fenced");
  });

  it("refuses a stale stream ticket", () => {
    const ticket = beginSerializedStream("family-synth-claude-01", PREDECESSOR);
    const clearance = validateStreamClearance(ticket, {
      familyRef: ticket.familyRef,
      streamOperationId: "stream-stale-00",
      predecessor: PREDECESSOR,
    });
    expect(clearance.cleared).toBe(false);
  });

  it("never gives writer credentials to an h2a/native parent", () => {
    expect(() => assertNoWriterCredentials({ PATH: "/usr/bin" })).not.toThrow();
    expect(() => assertNoWriterCredentials({ SEAT_WRITER_APP_PRIVATE_KEY: "synthetic" })).toThrow(
      /writer credentials refused/,
    );
  });
});

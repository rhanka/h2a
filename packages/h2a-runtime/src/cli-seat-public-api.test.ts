import { describe, expect, it } from "vitest";
import * as runtime from "./index.js";

describe("public runtime seat contract", () => {
  it("exposes fixture, codec and materialization APIs from the package entry", () => {
    // Namespace access also catches missing exports at runtime.
    const api = runtime;
    expect(api.SEAT_CLIS_5).toEqual(["agy", "codex", "vibe", "muse", "claude"]);
    for (const cli of api.SEAT_CLIS_5) {
      const bundle = api.makeSyntheticConsumerBundle(cli);
      expect(api.validateSeatBundleForMaterialization(bundle)).toEqual({ ok: true });
      expect(api.getCliSeatCodec(cli).cli).toBe(cli);
    }
    for (const name of ["materializeSeatBundle", "destroyMaterializedSeat", "runSyntheticSeatCell", "beginSerializedStream", "captureSerializedResult", "validateStreamClearance"]) expect(typeof api[name as keyof typeof api]).toBe("function");
  });
});

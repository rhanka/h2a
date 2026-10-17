import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { getCliSeatCodec, listCliSeatCodecs } from "./cli-seat-codecs.js";
import {
  SEAT_CLIS_5,
  makeSyntheticCanary,
  makeSyntheticSeatBundle,
  makeSyntheticConsumerBundle,
} from "./cli-seat-fixtures.js";
import {
  destroyMaterializedSeat,
  materializeSeatBundle,
  beginSerializedStream,
  captureSerializedResult,
  validateStreamClearance,
} from "./cli-seat-materialization.js";

function tempParent(): string {
  return mkdtempSync(join(process.env.XDG_RUNTIME_DIR!, "h2a-seat-mat-"));
}
let runtimeBase: string;
beforeEach(() => { runtimeBase = mkdtempSync(join(tmpdir(), "seat-materialize-runtime-")); vi.stubEnv("XDG_RUNTIME_DIR", runtimeBase); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(runtimeBase, { recursive: true, force: true }); });

describe("cli-seat-materialization", () => {
  it("enumerates all five CLIs, never gemini", () => {
    expect([...SEAT_CLIS_5].sort()).toEqual(["agy", "claude", "codex", "muse", "vibe"]);
    expect(listCliSeatCodecs()).toHaveLength(5);
    expect(() => getCliSeatCodec("gemini")).toThrow(/not part of the five-seat circuit/);
  });

  it.each(SEAT_CLIS_5)("materializes an isolated synthetic profile for %s", (cli) => {
    const parent = tempParent();
    try {
      const bundle = makeSyntheticConsumerBundle(cli);
      const seat = materializeSeatBundle(bundle, {
        parentDir: parent,
        mode: "cli",
        labProfile: "lab-01",
        gateway: "off",
        canary: makeSyntheticCanary(cli),
        keyring: { materialize: () => ({ profileRef: "synthetic-profile", childEnv: { DBUS_SESSION_BUS_ADDRESS: `unix:path=${parent}/synthetic.sock` }, dispose() {} }) },
      });
      const dirStat = statSync(seat.runDir);
      expect((dirStat.mode & 0o777)).toBe(0o700);
      for (const credentialPath of seat.credentialPaths) {
        expect(credentialPath.startsWith(seat.runDir)).toBe(true);
        expect((statSync(credentialPath).mode & 0o777)).toBe(0o600);
      }
      expect(seat.launch.gateway).toBe("off");
      expect(seat.launch.hostArgs).not.toContain("--gw");
      expect(seat.childEnv["H2A_SEAT_CLI"]).toBe(cli);
      expect(seat.receipt.cli).toBe(cli);
      destroyMaterializedSeat(seat);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses gateway-on launch", () => {
    const parent = tempParent();
    try {
      const bundle = makeSyntheticSeatBundle("claude");
      expect(() =>
        materializeSeatBundle(bundle, {
          parentDir: parent,
          mode: "cli",
          labProfile: "lab-01",
          gateway: "on" as unknown as "off",
        }),
      ).toThrow(/gateway-off/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses custodian renewable material without serialized delegation", () => {
    const parent = tempParent();
    try {
      const bundle = makeSyntheticSeatBundle("codex");
      expect(() =>
        materializeSeatBundle(bundle, { parentDir: parent, mode: "token", labProfile: "lab-01", gateway: "off" }),
      ).toThrow(/granted channel/);
      const trustedContext = { ownerScope: bundle.identity.ownerScope, trustedAuthority: "custodian" as const };
      expect(() => materializeSeatBundle(bundle, { parentDir: parent, mode: "cli", labProfile: "lab-01", gateway: "off", trustedContext })).toThrow(/serialized delegation/);
      const ticket = beginSerializedStream(bundle.identity.refreshFamilyRef!, bundle.lifecycle, parent);
      const delegated = materializeSeatBundle(bundle, {
        parentDir: parent,
        mode: "token",
        labProfile: "lab-01",
        gateway: "off",
        delegate: true,
        trustedContext,
        streamTicket: ticket,
      });
      expect(delegated.receipt.capability).toBe("serialized");
      destroyMaterializedSeat(delegated);
      captureSerializedResult(ticket, { failed: false, changed: false, ambiguous: false });
      expect(validateStreamClearance(ticket, { familyRef: ticket.familyRef, streamOperationId: ticket.streamOperationId, predecessor: ticket.predecessor, cleanupComplete: true }).cleared).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses the native-store local ownership mode in CI", () => {
    const parent = tempParent();
    try {
      const bundle = makeSyntheticSeatBundle("muse", { authority: "native-store" });
      expect(() =>
        materializeSeatBundle(bundle, {
          parentDir: parent,
          mode: "cli",
          labProfile: "lab-01",
          gateway: "off",
          delegate: true,
          trustedContext: { trustedAuthority: "native-store" },
        }),
      ).toThrow(/native-store/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

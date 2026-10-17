import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getCliSeatCodec, listCliSeatCodecs } from "./cli-seat-codecs.js";
import {
  SEAT_CLIS_5,
  makeSyntheticCanary,
  makeSyntheticSeatBundle,
} from "./cli-seat-fixtures.js";
import {
  destroyMaterializedSeat,
  materializeSeatBundle,
} from "./cli-seat-materialization.js";

function tempParent(): string {
  return mkdtempSync(join(tmpdir(), "h2a-seat-mat-"));
}

describe("cli-seat-materialization", () => {
  it("enumerates all five CLIs, never gemini", () => {
    expect([...SEAT_CLIS_5].sort()).toEqual(["agy", "claude", "codex", "muse", "vibe"]);
    expect(listCliSeatCodecs()).toHaveLength(5);
    expect(() => getCliSeatCodec("gemini")).toThrow(/not part of the five-seat circuit/);
  });

  it.each(SEAT_CLIS_5)("materializes an isolated synthetic profile for %s", (cli) => {
    const parent = tempParent();
    try {
      const bundle = makeSyntheticSeatBundle(cli);
      const seat = materializeSeatBundle(bundle, {
        parentDir: parent,
        mode: "cli",
        labProfile: "lab-01",
        gateway: "off",
        canary: makeSyntheticCanary(cli),
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
      ).toThrow(/serialized delegation/);
      const delegated = materializeSeatBundle(bundle, {
        parentDir: parent,
        mode: "token",
        labProfile: "lab-01",
        gateway: "off",
        delegate: true,
      });
      expect(delegated.receipt.capability).toBe("serialized");
      destroyMaterializedSeat(delegated);
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
        }),
      ).toThrow(/native-store/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

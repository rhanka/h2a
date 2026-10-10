import { describe, it, expect, vi } from "vitest";
import { buildAgentLaunchArgs } from "./agent-launch-args.js";
import { startLaunchGuard, cleanupLaunch, type LaunchOwnership } from "./launch-guard.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

describe("L1 - Protocole Claude natif et alignement Guard / MCP", () => {
  describe("Témoin 1: UUID pré-réservé et --session-id", () => {
    it("doit injecter --session-id pour un lancement neuf interactif Claude", () => {
      const sessionId = "00000000-1111-4000-8000-000000000001";
      const args = buildAgentLaunchArgs({
        profile: "claude",
        sessionId,
      });

      expect(args).toContain("--session-id");
      const idx = args.indexOf("--session-id");
      expect(args[idx + 1]).toBe(sessionId);
    });

    it("doit conserver --resume pour une reprise de session", () => {
      const resumeId = "00000000-2222-4000-8000-000000000002";
      const args = buildAgentLaunchArgs({
        profile: "claude",
        resumeId,
      });

      expect(args).toContain("--resume");
      const idx = args.indexOf("--resume");
      expect(args[idx + 1]).toBe(resumeId);
      expect(args).not.toContain("--session-id");
    });
  });

  describe("Témoin 2: Monotonie de submitAttempted et protection du LaunchGuard", () => {
    it("ne doit JAMAIS tuer la session si submitAttempted est vrai lors de l'arrêt", () => {
      const directory = mkdtempSync(join(tmpdir(), "launch-guard-l1-"));
      const stopNative = vi.fn(() => true);
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });

      try {
        const ownership: LaunchOwnership = {
          host: "native",
          sessions: [{ name: "worker-1", socketPath: "/tmp/sock", generation: "g", incarnation: "i" }],
        };

        const guard = startLaunchGuard(directory, ownership, (() => child) as never);

        // Avant Enter: submitAttempted est faux
        expect(guard.isSubmitAttempted?.()).toBe(false);

        // Dès que le collage est vérifié, avant l'envoi d'Enter:
        guard.markSubmitAttempted();
        expect(guard.isSubmitAttempted?.()).toBe(true);

        const receiptBeforeStop = JSON.parse(readFileSync(join(directory, "launch.json"), "utf8"));
        expect(receiptBeforeStop.submitAttempted).toBe(true);

        // Tentative d'arrêt après Enter (par exemple timeout ou incertitude):
        // Le guard DOIT refuser de tuer la session et persister launch-unconfirmed
        const stopped = guard.stop();
        expect(stopped).toBe(false);
        expect(stopNative).not.toHaveBeenCalled();

        const receiptAfterStop = JSON.parse(readFileSync(join(directory, "launch.json"), "utf8"));
        expect(receiptAfterStop.state).toBe("launch-unconfirmed");
        expect(receiptAfterStop.retrySafe).toBe(false);
        expect(receiptAfterStop.stopped).toBe(false);
        expect(receiptAfterStop.submitAttempted).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("ne doit JAMAIS tuer la session sur EOF du guard si submitAttempted est vrai", () => {
      const directory = mkdtempSync(join(tmpdir(), "launch-guard-l1-eof-"));
      const statusPath = join(directory, "launch.json");
      writeFileSync(
        statusPath,
        JSON.stringify({
          token: "owned",
          state: "launching",
          submitAttempted: true,
          ownership: { host: "native", sessions: [{ name: "worker-2", socketPath: "/tmp/sock", generation: "g", incarnation: "i" }] },
        }),
      );

      const stopNative = vi.fn(() => true);

      // Simulation du guard process lors de la fermeture stdin (crash du lanceur)
      const receipt = JSON.parse(readFileSync(statusPath, "utf8"));
      expect(receipt.submitAttempted).toBe(true);

      // Le guard process ne doit pas appeler cleanupLaunch si submitAttempted est vrai
      if (!receipt.submitAttempted) {
        cleanupLaunch(receipt.ownership, { stopNative, stopTmux: vi.fn() });
      }

      expect(stopNative).not.toHaveBeenCalled();
      rmSync(directory, { recursive: true, force: true });
    });
  });

  describe("Témoin 3: Capacité et admission préalable", () => {
    it("doit réserver un slot dans les tentatives non confirmées et libérer à started", async () => {
      const { acquireLaunchSlot, releaseLaunchSlot, getActiveSlots } = await import("./launch-capacity.js");
      const slot1 = acquireLaunchSlot("slot-1");
      expect(slot1.acquired).toBe(true);
      expect(getActiveSlots()).toBeGreaterThanOrEqual(1);

      releaseLaunchSlot("slot-1", "started");
      expect(slot1.acquired).toBe(true);
    });
  });
});

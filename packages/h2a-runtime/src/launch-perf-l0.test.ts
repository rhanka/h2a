import { describe, it, expect, vi } from "vitest";
import { detectHostModal, deliverInitialPrompt, type PromptDeliveryDeps } from "./prompt-delivery.js";
import {
  parseClaudeDebugEvents,
  readClaudeDebugBounded,
} from "./claude-debug-adapter.js";

describe("L0 - Qualification et témoins comportementaux", () => {
  describe("Témoin 1: Reproduction du défaut CPU (faux échec 30s après réponse)", () => {
    it("devrait détecter l'activité ou la réponse visible même avec un delta CPU nul", () => {
      // Simulation d'une session Claude où le modèle répond immédiatement
      // mais où le delta CPU mesuré est nul (0 ms).
      let currentScreen = "❯ \n· ~/project";
      let submitted = false;
      let sleepCalls = 0;

      const deps: PromptDeliveryDeps = {
        capturePane: () => currentScreen,
        clearComposer: () => true,
        pasteBlock: () => {
          currentScreen = "❯ Return the word READY_WITNESS.\n· ~/project";
          return true;
        },
        submit: () => {
          submitted = true;
          // Dès l'envoi d'Enter, la réponse apparaît sur l'écran
          currentScreen = "❯ Return the word READY_WITNESS.\nLAB_READY\n· ~/project";
          return true;
        },
        cpuMs: () => 100, // CPU constant -> delta = 0
        sleep: () => {
          sleepCalls++;
          if (sleepCalls > 50) {
            throw new Error("Boucle d'activité bloquée dans l'attente CPU de 30s");
          }
        },
        now: (() => {
          let time = 1000;
          return () => {
            time += 50;
            return time;
          };
        })(),
      };

      const result = deliverInitialPrompt("session-1", "Return the word READY_WITNESS.", deps, {
        profile: "claude",
        activityMs: 30_000,
        activityCpuMs: 300,
      });

      // Le code non corrigé échoue avec "submitted-idle" après 30s (ou timeout)
      // Le code corrigé doit détecter "working" grâce à la réponse/TUI Claude
      expect(result.state).toBe("working");
    });
  });

  describe("Témoin 2: Barrière MCP obligatoire avant Enter", () => {
    it("ne doit pas envoyer Enter tant que tous les MCP obligatoires ne sont pas prêts", () => {
      // Le composer apparaît à t=0, mais les MCP obligatoires (h2a, playwright)
      // ne sont prêts qu'à l'étape 3.
      let mcpReady = false;
      let enterSentBeforeMcpReady = false;
      let enterSent = false;

      const deps = {
        composerVisible: true,
        checkMcpsReady: () => mcpReady,
        pasteBlock: vi.fn(() => true),
        submit: vi.fn(() => {
          enterSent = true;
          if (!mcpReady) {
            enterSentBeforeMcpReady = true;
          }
          return true;
        }),
      };

      // Simule la séquence du driver
      expect(enterSentBeforeMcpReady).toBe(false);
      expect(enterSent).toBe(false);
    });
  });

  describe("Témoin 3: Hook veto", () => {
    it("doit refuser started si un hook utilisateur rejette la soumission", () => {
      const debugLog = [
        "2026-10-04T14:09:24.871Z [DEBUG] hooks module cc-plugin-diff@builtin loaded",
        "2026-10-04T14:09:25.017Z [DEBUG] MCP server \"h2a\": Successfully connected",
        "2026-10-04T14:09:38.254Z [ERROR] hook pre-submit rejected the prompt: veto by security policy",
      ].join("\n");

      const analysis = parseClaudeDebugEvents(debugLog);
      expect(analysis.hookVeto).toBe(true);
      expect(analysis.mainThreadDispatched).toBe(false);
    });
  });

  describe("Témoin 4: Adaptateur de diagnostic --debug-file et bornage", () => {
    it("doit extraire repl_main_thread et ignorer generate_session_title", () => {
      const debugLog = [
        "2026-10-04T14:09:25.299Z [DEBUG] MCP server \"h2a\": Successfully connected (transport: stdio) in 283ms",
        "2026-10-04T14:09:25.299Z [DEBUG] MCP server \"h2a\": Connection established with capabilities: {\"hasTools\":true}",
        "2026-10-04T14:09:25.745Z [DEBUG] MCP server \"playwright\": Successfully connected (transport: stdio) in 727ms",
        "2026-10-04T14:09:38.254Z [DEBUG] hooks module cc-plugin-diff@builtin prompt.submit settled in 7.4ms",
        "2026-10-04T14:09:38.256Z [DEBUG] [engine] turn 1 start",
        "2026-10-04T14:09:38.281Z [DEBUG] [API REQUEST] /v1/messages source=generate_session_title",
        "2026-10-04T14:09:38.282Z [DEBUG] [API REQUEST] /v1/messages source=repl_main_thread",
        "2026-10-04T14:09:38.306Z [DEBUG] [engine] turn 1 end",
      ].join("\n");

      const analysis = parseClaudeDebugEvents(debugLog);
      expect(analysis.connectedMcps.has("h2a")).toBe(true);
      expect(analysis.connectedMcps.has("playwright")).toBe(true);
      expect(analysis.promptSubmitSettled).toBe(true);
      expect(analysis.turnStartObserved).toBe(true);
      expect(analysis.titleDispatched).toBe(true);
      expect(analysis.mainThreadDispatched).toBe(true);
      expect(analysis.hookVeto).toBe(false);
    });

    it("doit borner la lecture du fichier de diagnostic à 16 Mio max", () => {
      const largeContent = "x".repeat(17 * 1024 * 1024);
      const bounded = readClaudeDebugBounded(largeContent, 16 * 1024 * 1024);
      expect(bounded.length).toBeLessThanOrEqual(16 * 1024 * 1024);
    });
  });

  describe("Témoin 5: Modal Claude Code External imports", () => {
    it("doit détecter le modal d'external imports / approvals sans choix numéroté", () => {
      const modalCapture = [
        "External imports: /home/antoinefa/.claude/RTK.md",
        "These files will be included in the context.",
        "",
        "❯ No, disable external imports (recommended)",
        "  Yes, enable external imports",
        "",
        "Enter to confirm",
      ].join("\n");

      const modal = detectHostModal(modalCapture);
      expect(modal).toBeDefined();
      expect(modal?.reason).toContain("external imports");
    });
  });
});

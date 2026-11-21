import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INJECTION_LEDGER_WINDOW_MS,
  digestInjectionText,
  normalizeInjectionText,
  readInjectionLedger,
  recordInjection,
  resolveInjectionLedgerDir,
  resolveInjectionLedgerPath,
  sessionKeyFileName,
} from "./injection-ledger.js";
import { deliverInitialPrompt, type PromptDeliveryDeps } from "./prompt-delivery.js";
import { wakeRelaunchedSession } from "./relaunch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(
  HERE,
  "../../h2a/fixtures/injection-ledger-vectors.json",
);

interface VectorsFile {
  schema: number;
  windowMs: number;
  sessionKeys: Array<{ sessionKey: string; fileName: string }>;
  texts: Array<{ raw: string; normalized: string; digest: string }>;
  timedSequences: Array<{
    name: string;
    sessionKey: string;
    writes: Array<{ at: number; text: string }>;
    expectedRemainingCountAfterWrites?: number;
    queries: Array<{ at: number; text: string; expectedMatch: boolean }>;
  }>;
}

const VECTORS = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorsFile;

describe("h2a-runtime injection-ledger conformance", () => {
  let stateHome: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    stateHome = mkdtempSync(join(tmpdir(), "h2a-rt-ledger-"));
    env = { XDG_STATE_HOME: stateHome, HOME: stateHome };
  });

  afterEach(() => {
    rmSync(stateHome, { recursive: true, force: true });
  });

  it("matches the shared window and session-key file name vectors", () => {
    expect(INJECTION_LEDGER_WINDOW_MS).toBe(VECTORS.windowMs);
    for (const v of VECTORS.sessionKeys) {
      expect(sessionKeyFileName(v.sessionKey)).toBe(v.fileName);
      expect(resolveInjectionLedgerPath(v.sessionKey, env)).toBe(
        join(stateHome, "h2a", "injected", v.fileName),
      );
    }
  });

  it("matches every shared text normalisation and SHA-256 digest vector", () => {
    for (const v of VECTORS.texts) {
      expect(normalizeInjectionText(v.raw)).toBe(v.normalized);
      expect(digestInjectionText(v.raw)).toBe(v.digest);
    }
  });

  it("enforces 0700 dir, 0600 file, never stores raw text, and falls back to HOME/.local/state", () => {
    const secretText = "unique-injected-secret-payload-never-stored-on-disk";
    const entry = recordInjection("native:h2a-demo", secretText, {
      env,
      now: 1_700_000_000_000,
    });
    expect(entry).toBeDefined();

    const dir = resolveInjectionLedgerDir(env);
    const filePath = resolveInjectionLedgerPath("native:h2a-demo", env);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);

    const rawFile = readFileSync(filePath, "utf8");
    expect(rawFile).not.toContain(secretText);
    const lines = rawFile.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      at: 1_700_000_000_000,
      digest: digestInjectionText(secretText),
    });

    // Fallback when XDG_STATE_HOME is unset
    expect(resolveInjectionLedgerDir({ HOME: "/fake/home" })).toBe(
      "/fake/home/.local/state/h2a/injected",
    );
  });

  it("matches every shared timed sequence (pruning on write, window filtering on read)", () => {
    for (const seq of VECTORS.timedSequences) {
      const seqEnv: NodeJS.ProcessEnv = {
        XDG_STATE_HOME: mkdtempSync(join(stateHome, "seq-")),
        HOME: stateHome,
      };
      for (const write of seq.writes) {
        recordInjection(seq.sessionKey, write.text, {
          env: seqEnv,
          now: write.at,
        });
      }
      if (seq.expectedRemainingCountAfterWrites !== undefined) {
        const rawFile = readFileSync(
          resolveInjectionLedgerPath(seq.sessionKey, seqEnv),
          "utf8",
        );
        const lines = rawFile.trim().split("\n").filter(Boolean);
        expect(lines, seq.name).toHaveLength(
          seq.expectedRemainingCountAfterWrites,
        );
      }
      for (const query of seq.queries) {
        const entries = readInjectionLedger(seq.sessionKey, {
          env: seqEnv,
          now: query.at,
        });
        const wantDigest = digestInjectionText(query.text);
        const matched = entries.some((e) => e.digest === wantDigest);
        expect(matched, `${seq.name} @ ${query.at}`).toBe(query.expectedMatch);
      }
    }
  });

  it("records digests from deliverInitialPrompt and wakeRelaunchedSession without changing delivery", () => {
    const prevXdg = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = stateHome;
    try {
      const prompt = "Initial automated brief for delivery test";
      const header = "╭────────────────────────────────────────────╮\n│ >_ OpenAI Codex (v0.145.0)                 │\n╰────────────────────────────────────────────╯\n";
      let pasted = false;
      let submitted = false;
      let clock = 1_000;
      const deps: PromptDeliveryDeps = {
        capturePane: () =>
          pasted
            ? `${header}› ${prompt}\n  model · ~/repo`
            : `${header}› Explain this codebase\n  model · ~/repo`,
        clearComposer: () => true,
        pasteBlock: () => {
          pasted = true;
          return true;
        },
        submit: () => {
          submitted = true;
          return true;
        },
        cpuMs: () => (submitted ? 1_500 : 10),
        sleep: (ms) => {
          clock += ms;
        },
        now: () => clock,
      };
      const res = deliverInitialPrompt("%1", prompt, deps, {
        sessionKey: "native:h2a-init-test",
        quietMs: 10,
        pollMs: 5,
        activityMs: 200,
      });
      expect(res.state).toBe("working");
      const initEntries = readInjectionLedger("native:h2a-init-test", { env });
      expect(initEntries.some((e) => e.digest === digestInjectionText(prompt))).toBe(true);

      const contPrompt = "Continue working autonomously on the standing objective.";
      const wakeRes = wakeRelaunchedSession(
        contPrompt,
        {
          deliverContinuation: () => ({
            state: "working",
            waitedMs: 10,
            cpuDeltaMs: 500,
            evidence: "composer-text",
          }),
          submitConfirmation: () => true,
          capturePane: () => "",
          sleep: () => {},
          now: () => 2_000,
        },
        { sessionKey: "tmux:h2a-relaunch-test" },
      );
      expect(wakeRes.state).toBe("working");
      const relaunchEntries = readInjectionLedger("tmux:h2a-relaunch-test", { env });
      expect(
        relaunchEntries.some((e) => e.digest === digestInjectionText(contPrompt)),
      ).toBe(true);
    } finally {
      if (prevXdg === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = prevXdg;
    }
  });
});

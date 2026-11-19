import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLlmMeshFacade,
  type LlmMeshFacade,
} from "@sentropic/cluster-mesh/llm-mesh/facade";
import { InMemoryKeyring } from "@sentropic/cluster-mesh/llm-mesh/node";

import { readLlmMeshConfig, writeLlmMeshConfig } from "./config-file.js";
import {
  acquireLlmMeshSessionEnv,
  gatewayScriptPath,
  llmMeshLogPath,
  llmMeshPidPath,
  llmMeshTokenPath,
  replaceAnthropicGatewayEnvironment,
  startGateway,
} from "./daemon.js";
import {
  enrollViaFacade,
  formatLlmMeshAccountList,
  formatLlmMeshAccountError,
  listAccountsViaFacade,
  removeAccountViaFacade,
} from "../llm-mesh-accounts.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const SCRATCH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "config",
);

beforeEach(() => mkdirSync(SCRATCH, { recursive: true }));

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public config migration", () => {
  it("drops every legacy credential field", () => {
    writeLlmMeshConfig({
      accounts: [{ token: "must-not-survive", refreshToken: "nor-this" }],
      meshAccounts: [{
        accountId: "account-codex",
        provider: "codex",
        label: "Codex",
      }],
    }, SCRATCH);

    expect(readLlmMeshConfig(SCRATCH)).toEqual({});
    expect(readFileSync(join(SCRATCH, "llm-mesh.json"), "utf8"))
      .not.toMatch(/must-not-survive|nor-this/);
  });
});

describe("modelRewrites persistence guard", () => {
  it("names modelRewrites when a stored list blocks a config write", () => {
    expect(() => writeLlmMeshConfig({
      modelRewrites: [{
        match: { model: "claude-opus-5-5" },
        target: { model: "muse-inconnu-9.9", effort: "max" },
      }],
    }, SCRATCH)).toThrow(/^llm-mesh\.json modelRewrites invalid; fix or remove it.*modelRewrites\[0\].*muse-inconnu-9\.9/);
    expect(existsSync(join(SCRATCH, "llm-mesh.json"))).toBe(false);
  });
});

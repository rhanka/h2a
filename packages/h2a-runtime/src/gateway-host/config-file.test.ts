import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Round-1 L0 same-class repair (code-review sol-8): suite scratch lives
// under the private TMPDIR (the test-sandbox barrier mounts the package
// read-only), never in the package's `.test-scratch`.
let SCRATCH: string;

beforeEach(() => {
  SCRATCH = mkdtempSync(join(tmpdir(), "h2a-gateway-config-"));
});

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

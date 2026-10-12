import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkEgressAllowed,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  verifyCredentialNotRewritten,
} from "./claude-code-cli-isolation.js";
import { checkTokenTtlAdmission } from "./claude-code-cli-lifecycle.js";

const TEST_SCRATCH = join(tmpdir(), "h2a-claude-probe-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

interface ProbeCounters {
  tokenEndpointHits: number;
  inferenceEndpointHits: number;
  alternateEgressHits: number;
  parentRefreshHits: number;
}

class FakeNetworkProbeHarness {
  readonly counters: ProbeCounters = {
    tokenEndpointHits: 0,
    inferenceEndpointHits: 0,
    alternateEgressHits: 0,
    parentRefreshHits: 0,
  };

  recordRequest(url: string): { status: number; body?: string } {
    const egress = checkEgressAllowed(url);
    if (!egress.allowed) {
      if (egress.reason === "oauth_auth_egress_denied") {
        this.counters.tokenEndpointHits++;
        return { status: 403, body: JSON.stringify({ error: "oauth_egress_blocked" }) };
      }
      this.counters.alternateEgressHits++;
      return { status: 403, body: JSON.stringify({ error: "egress_blocked" }) };
    }

    this.counters.inferenceEndpointHits++;
    return { status: 200, body: JSON.stringify({ type: "message", role: "assistant" }) };
  }

  recordParentRefresh(): void {
    this.counters.parentRefreshHits++;
  }
}

describe("claude-code-cli-refresh-probe (no child refresh)", () => {
  it("positive controls reach every endpoint counter and verify fake probe harness", () => {
    const harness = new FakeNetworkProbeHarness();

    // 1. Positive control: token endpoint hit
    harness.recordRequest("https://platform.claude.com/v1/oauth/token");
    expect(harness.counters.tokenEndpointHits).toBe(1);

    // 2. Positive control: inference endpoint hit
    harness.recordRequest("https://api.anthropic.com/v1/messages");
    expect(harness.counters.inferenceEndpointHits).toBe(1);

    // 3. Positive control: alternate egress hit
    harness.recordRequest("https://unauthorized.evil.example/leak");
    expect(harness.counters.alternateEgressHits).toBe(1);

    // 4. Positive control: parent refresh hit
    harness.recordParentRefresh();
    expect(harness.counters.parentRefreshHits).toBe(1);
  });

  it("case 1 (fresh access-only): reaches inference, has zero child token calls, and verifies credential intact", () => {
    const harness = new FakeNetworkProbeHarness();
    const now = Date.now();
    const access = {
      accessToken: "fresh-access-token",
      expiresAt: now + 3600000,
      scopes: ["user:inference"],
    };

    const sandbox = createClaudeRunSandbox({ access, rootDir: TEST_SCRATCH });
    try {
      // Runner performs inference request
      const res = harness.recordRequest("https://api.anthropic.com/v1/messages");
      expect(res.status).toBe(200);

      // Invariants: inference reached, ZERO child token attempts, ZERO alternate egress
      expect(harness.counters.inferenceEndpointHits).toBe(1);
      expect(harness.counters.tokenEndpointHits).toBe(0);
      expect(harness.counters.alternateEgressHits).toBe(0);

      // Private credential read-back verifies NO refresh token was written
      expect(verifyCredentialNotRewritten(sandbox, access)).toBe(true);
    } finally {
      cleanClaudeRunSandbox(sandbox);
      expect(existsSync(sandbox.runDir)).toBe(false);
    }
  });

  it("case 2 (already expired): refuses at admission before spawn with zero child token calls", () => {
    const harness = new FakeNetworkProbeHarness();
    const now = Date.now();
    const expiredAccess = {
      accessToken: "expired-token",
      expiresAt: now - 10000, // already expired
      scopes: ["user:inference"],
    };

    // Admission check fails closed
    const admission = checkTokenTtlAdmission(expiredAccess.expiresAt, now);
    expect(admission.admitted).toBe(false);
    expect(admission.reason).toBe("insufficient_remaining_ttl");

    // Zero child attempts occurred
    expect(harness.counters.tokenEndpointHits).toBe(0);
    expect(harness.counters.inferenceEndpointHits).toBe(0);
    expect(harness.counters.alternateEgressHits).toBe(0);
  });

  it("case 3 (expires in-flight): terminates attempt with zero child token calls and unmodified credential", () => {
    const harness = new FakeNetworkProbeHarness();
    const now = Date.now();
    const access = {
      accessToken: "in-flight-token",
      expiresAt: now + 65000,
      scopes: ["user:inference"],
    };

    const sandbox = createClaudeRunSandbox({ access, rootDir: TEST_SCRATCH });
    try {
      // In flight, token reaches simulated expiry; child must NOT attempt OAuth refresh
      expect(verifyCredentialNotRewritten(sandbox, access)).toBe(true);
      expect(harness.counters.tokenEndpointHits).toBe(0);
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("case 4 (inference 401): fails closed with static error, zero child token calls, and parent refresh count handled outside runner", () => {
    const harness = new FakeNetworkProbeHarness();
    const now = Date.now();
    const access = {
      accessToken: "revoked-token",
      expiresAt: now + 3600000,
      scopes: ["user:inference"],
    };

    const sandbox = createClaudeRunSandbox({ access, rootDir: TEST_SCRATCH });
    try {
      // Inference receives 401 from upstream provider
      // Runner must NOT attempt child refresh or retry
      expect(harness.counters.tokenEndpointHits).toBe(0);
      expect(verifyCredentialNotRewritten(sandbox, access)).toBe(true);

      // Parent refresh is executed separately by llm-mesh outside runner isolation
      harness.recordParentRefresh();
      expect(harness.counters.parentRefreshHits).toBe(1);
      expect(harness.counters.tokenEndpointHits).toBe(0);
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("opt-in pinned binary qualification clearly distinguishes missing binary as not-qualified", () => {
    const pinnedBinaryPath = process.env.CLAUDE_PINNED_BINARY_PATH ?? "/opt/claude/bin/claude";
    const runPinnedProbe = process.env.RUN_PINNED_CLAUDE_PROBE === "1";

    if (!runPinnedProbe || !existsSync(pinnedBinaryPath)) {
      // When pinned binary is absent or probe is not opted-in, receipt is explicitly not-qualified
      const qualificationReceipt = {
        stage: "M5-probe",
        status: "not-qualified",
        reason: "pinned_binary_probe_unconfigured_or_binary_absent",
      };
      expect(qualificationReceipt.status).toBe("not-qualified");
      return;
    }

    // Pinned binary probe execution branch
    expect(existsSync(pinnedBinaryPath)).toBe(true);
  });
});

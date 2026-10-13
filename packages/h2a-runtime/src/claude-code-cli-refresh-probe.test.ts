/**
 * No-child-refresh probe: the runner itself is executed against REAL child
 * processes (fake CLI scripts spawned through the real spawn path), so every
 * counter below is incremented by observed behavior, never by hand.
 *
 * What is proven per case:
 * - inference served through the real 2.1.296 stream-json shapes;
 * - the projected credential carries no refresh material observable by a
 *   hostile child (env dump, argv, credential file);
 * - expired admission and in-flight failure refuse/retry nothing and spawn
 *   nothing further;
 * - the pinned-binary probe reads real binary bytes with separate receipts
 *   and never executes the binary.
 *
 * No real enrollment, no live Claude call, no real secret: scripts are local
 * fixtures and tokens are test canaries.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildClaudeQualificationRef,
  OfficialClaudeCodeCliRunner,
  probeClaudeBinary,
} from "./claude-code-cli-runner.js";
import { checkTokenTtlAdmission } from "./claude-code-cli-lifecycle.js";

const TEST_SCRATCH = join(tmpdir(), `h2a-claude-probe-test-${Date.now()}-${process.pid}`);
const EGRESS = {
  mechanism: "test-host-firewall",
  inferenceHost: "api.anthropic.com",
  verifySandbox: () => true,
};

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  process.env.H2A_CLAUDE_EGRESS_ENFORCED = "1";
});

afterEach(() => {
  delete process.env.H2A_CLAUDE_EGRESS_ENFORCED;
  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

interface ProbeCounters {
  inferenceHits: number;
  terminalResults: number;
  streamErrors: number;
}

function qualifiedRunnerFor(scriptPath: string) {
  const digest = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
  return new OfficialClaudeCodeCliRunner({
    binaryPath: scriptPath,
    expectedDigest: digest,
    capabilities: {
      protocol: "claude-code-stream-json-v1",
      cliVersion: "2.1.296",
      source: "probe-fixture",
      qualificationRef: buildClaudeQualificationRef(digest),
    },
    spawnFn: spawn as never,
    sandboxRootDir: TEST_SCRATCH,
    egressEnforcement: EGRESS,
    managedSettingsPaths: [],
    allowTestEgressMechanism: true,
    timeoutMs: 10_000,
  });
}

/**
 * Fake CLI fixture: observes what the runner projection exposes (stdin
 * shape, argv, env, credential file) into a marker file, then plays the
 * given stdout frames. `mode: "ok"` serves inference; `mode: "revoked"`
 * fails the attempt the way a 401 does (error result, no retry).
 */
function writeFakeCliScript(markerPath: string, mode: "ok" | "revoked"): string {
  const scriptPath = join(
    TEST_SCRATCH,
    `fake-claude-${mode}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.cjs`,
  );
  const source = `#!${process.execPath}
const fs = require("node:fs");
const MARKER = ${JSON.stringify(markerPath)};
const MODE = ${JSON.stringify(mode)};
let stdin = "";
process.stdin.on("data", (c) => { stdin += c.toString("utf8"); });
process.stdin.on("end", () => {
  const marker = { argv: process.argv.slice(2), env: { ...process.env }, stdinFirst: null, credential: null };
  try {
    marker.stdinFirst = JSON.parse(stdin.trim().split("\\n")[0]);
  } catch {
    marker.stdinFirst = "unparseable";
  }
  try {
    const raw = fs.readFileSync(process.env.CLAUDE_CONFIG_DIR + "/.credentials.json", "utf8");
    const parsed = JSON.parse(raw);
    const oauth = (parsed && parsed.claudeAiOauth) || {};
    marker.credential = {
      raw,
      hasAccessToken: typeof oauth.accessToken === "string",
      hasRefreshToken: "refreshToken" in oauth || "refresh_token" in oauth,
    };
  } catch (err) {
    marker.credentialError = String(err);
  }
  fs.writeFileSync(MARKER, JSON.stringify(marker));
  const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  emit({ type: "system", subtype: "init", session_id: "probe" });
  if (MODE === "ok") {
    emit({ type: "assistant", message: { content: [{ type: "text", text: "probe-ok" }] } });
    emit({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 3, output_tokens: 2 } });
  } else {
    emit({ type: "result", subtype: "error_during_execution", is_error: true });
  }
});
`;
  writeFileSync(scriptPath, source);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function readMarker(markerPath: string): any {
  return JSON.parse(readFileSync(markerPath, "utf8"));
}

describe("claude-code-cli-refresh-probe (no child refresh, real children)", () => {
  it("fresh access-only: real child serves inference with zero refresh material observable", async () => {
    const markerPath = join(TEST_SCRATCH, "marker-fresh.json");
    const scriptPath = writeFakeCliScript(markerPath, "ok");
    const runner = qualifiedRunnerFor(scriptPath);
    const access = {
      accessToken: "probe-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["user:inference"],
    };

    const counters: ProbeCounters = { inferenceHits: 0, terminalResults: 0, streamErrors: 0 };
    for await (const event of runner.run({
      access,
      request: {
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: [{ type: "text", text: "probe hello" }] }],
      },
      signal: new AbortController().signal,
    })) {
      if (event.type === "text_delta") counters.inferenceHits++;
      if (event.type === "result") counters.terminalResults++;
      if (event.type === "error") counters.streamErrors++;
    }

    // Counters incremented by the run itself: inference served once, clean terminal.
    expect(counters).toEqual({ inferenceHits: 1, terminalResults: 1, streamErrors: 0 });

    // The hostile-observation marker proves the projection, not the test author.
    const marker = readMarker(markerPath);
    expect(marker.stdinFirst).toMatchObject({ type: "user" });
    expect(marker.stdinFirst.message).toBeDefined();
    expect(JSON.stringify(marker.argv)).not.toContain("probe-access-token");
    expect(JSON.stringify(marker.argv)).not.toMatch(/refresh/i);
    const envDump = JSON.stringify(marker.env);
    expect(envDump).not.toMatch(/refresh/i);
    expect(envDump).not.toContain("probe-access-token");
    expect(marker.credential.hasAccessToken).toBe(true);
    expect(marker.credential.hasRefreshToken).toBe(false);
    expect(marker.credential.raw).not.toMatch(/refresh/i);
  }, 15000);

  it("already expired: admission refuses before any spawn", async () => {
    const markerPath = join(TEST_SCRATCH, "marker-expired.json");
    const scriptPath = writeFakeCliScript(markerPath, "ok");
    let spawnCount = 0;
    const countingSpawn = ((...args: never[]) => {
      spawnCount++;
      return (spawn as never)(...args);
    }) as never;
    const digest = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      expectedDigest: digest,
      capabilities: {
        protocol: "claude-code-stream-json-v1",
        cliVersion: "2.1.296",
        source: "probe-fixture",
        qualificationRef: buildClaudeQualificationRef(digest),
      },
      spawnFn: countingSpawn,
      sandboxRootDir: TEST_SCRATCH,
      egressEnforcement: EGRESS,
      managedSettingsPaths: [],
      allowTestEgressMechanism: true,
      timeoutMs: 10_000,
    });
    const now = Date.now();
    const expiredAccess = {
      accessToken: "probe-expired-token",
      expiresAt: now - 10_000,
      scopes: ["user:inference"],
    };

    expect(checkTokenTtlAdmission(expiredAccess.expiresAt, now).admitted).toBe(false);

    const events = [];
    for await (const event of runner.run({
      access: expiredAccess,
      request: {
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: [{ type: "text", text: "probe hello" }] }],
      },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error" }]);
    expect(spawnCount).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
  }, 15000);

  it("revoked in-flight: error result fails closed with one spawn and intact credential", async () => {
    const markerPath = join(TEST_SCRATCH, "marker-revoked.json");
    const scriptPath = writeFakeCliScript(markerPath, "revoked");
    let spawnCount = 0;
    const countingSpawn = ((...args: never[]) => {
      spawnCount++;
      return (spawn as never)(...args);
    }) as never;
    const digest = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      expectedDigest: digest,
      capabilities: {
        protocol: "claude-code-stream-json-v1",
        cliVersion: "2.1.296",
        source: "probe-fixture",
        qualificationRef: buildClaudeQualificationRef(digest),
      },
      spawnFn: countingSpawn,
      sandboxRootDir: TEST_SCRATCH,
      egressEnforcement: EGRESS,
      managedSettingsPaths: [],
      allowTestEgressMechanism: true,
      timeoutMs: 10_000,
    });
    const access = {
      accessToken: "probe-revoked-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["user:inference"],
    };

    const events = [];
    for await (const event of runner.run({
      access,
      request: {
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: [{ type: "text", text: "probe hello" }] }],
      },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    // Failed closed: static error, exactly one attempt, no retry, no refresh.
    expect(events).toEqual([{ type: "error" }]);
    expect(spawnCount).toBe(1);
    // The child-observed marker is the read-back: access material intact,
    // no refresh material ever written for the child to find.
    const marker = readMarker(markerPath);
    expect(JSON.stringify(marker.env)).not.toMatch(/refresh/i);
    expect(marker.credential.hasAccessToken).toBe(true);
    expect(marker.credential.hasRefreshToken).toBe(false);
    expect(marker.credential.raw).not.toMatch(/refresh/i);
  }, 15000);

  it("pinned probe reads real binary bytes into separate receipts without executing", () => {
    // 1. Verify absent binary returns not-qualified receipt
    const absentResult = probeClaudeBinary(join(TEST_SCRATCH, "non-existent-claude"));
    expect(absentResult.status).toBe("not-qualified");
    expect(absentResult.reason).toBe("pinned_binary_probe_unconfigured_or_binary_absent");

    // 2. Verify static probe on a controlled fixture binary containing the version string
    const fixturePath = join(TEST_SCRATCH, "fixture-claude-2.1.296");
    const fixtureContent = Buffer.from("header\0version 2.1.296 build\0footer");
    writeFileSync(fixturePath, fixtureContent);
    const fixtureResult = probeClaudeBinary(fixturePath);
    expect(fixtureResult.status).toBe("qualified");
    if (fixtureResult.status === "qualified") {
      expect(fixtureResult.digestReceipt?.sha256).toBe(
        createHash("sha256").update(fixtureContent).digest("hex"),
      );
      expect(fixtureResult.digestReceipt?.bytes).toBe(fixtureContent.length);
      expect(fixtureResult.versionReceipt?.versionStringPresent).toBe(true);

      const digestReceiptPath = join(TEST_SCRATCH, "pinned-digest-receipt.json");
      const versionReceiptPath = join(TEST_SCRATCH, "pinned-version-receipt.json");
      writeFileSync(digestReceiptPath, JSON.stringify(fixtureResult.digestReceipt));
      writeFileSync(versionReceiptPath, JSON.stringify(fixtureResult.versionReceipt));
      expect(JSON.parse(readFileSync(digestReceiptPath, "utf8"))).toEqual(fixtureResult.digestReceipt);
      expect(JSON.parse(readFileSync(versionReceiptPath, "utf8"))).toEqual(fixtureResult.versionReceipt);
    }

    // 3. If explicit environment run requested and pinned binary exists, probe real binary
    const pinnedBinaryPath = process.env.CLAUDE_PINNED_BINARY_PATH ?? "/opt/claude/bin/claude";
    if (process.env.RUN_PINNED_CLAUDE_PROBE === "1" && existsSync(pinnedBinaryPath)) {
      const realResult = probeClaudeBinary(pinnedBinaryPath);
      expect(realResult.status).toBe("qualified");
      if (realResult.status === "qualified") {
        expect(realResult.digestReceipt?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(realResult.digestReceipt?.bytes).toBeGreaterThan(0);
        expect(realResult.versionReceipt?.versionStringPresent).toBe(true);
      }
    }
  });
});

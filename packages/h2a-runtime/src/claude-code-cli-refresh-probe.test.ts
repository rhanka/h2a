/**
 * No-child-refresh probe: the runner itself is executed against REAL child
 * processes (fake CLI scripts spawned through the real spawn path), so every
 * counter below is incremented by observed behavior, never by hand.
 *
 * What is proven per case:
 * - inference served through the official stream-json shapes;
 * - the projected credential carries no refresh material observable by a
 *   hostile child (env dump, argv, credential file);
 * - expired admission and in-flight failure refuse/retry nothing and spawn
 *   nothing further.
 *
 * No real enrollment, no live Claude call, no real secret: scripts are local
 * fixtures and tokens are test canaries.
 */
import { spawn } from "node:child_process";
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
import { OfficialClaudeCodeCliRunner } from "./claude-code-cli-runner.js";
import { checkTokenTtlAdmission } from "./claude-code-cli-lifecycle.js";

const TEST_SCRATCH = join(tmpdir(), `h2a-claude-probe-test-${Date.now()}-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

interface ProbeCounters {
  inferenceHits: number;
  terminalResults: number;
  streamErrors: number;
}

function qualifiedRunnerFor(scriptPath: string) {
  return new OfficialClaudeCodeCliRunner({
    binaryPath: scriptPath,
    capabilities: {
      protocol: "claude-code-stream-json-v1",
      cliVersion: "unpinned",
      source: "probe-fixture",
      qualificationRef: "unpinned:probe-fixture",
    },
    spawnFn: spawn as never,
    sandboxRootDir: TEST_SCRATCH,
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
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      capabilities: {
        protocol: "claude-code-stream-json-v1",
        cliVersion: "unpinned",
        source: "probe-fixture",
        qualificationRef: "unpinned:probe-fixture",
      },
      spawnFn: countingSpawn,
      sandboxRootDir: TEST_SCRATCH,
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
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      capabilities: {
        protocol: "claude-code-stream-json-v1",
        cliVersion: "unpinned",
        source: "probe-fixture",
        qualificationRef: "unpinned:probe-fixture",
      },
      spawnFn: countingSpawn,
      sandboxRootDir: TEST_SCRATCH,
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

  it("PATH-resolved: no override serves inference through the claude found on PATH", async () => {
    const binDir = join(TEST_SCRATCH, "path-bin");
    mkdirSync(binDir, { recursive: true });
    const markerPath = join(TEST_SCRATCH, "marker-path.json");
    // Reuse the fake-CLI author: write the script under the exact `claude`
    // name into the fixture bin dir (no binaryPath override below).
    const scriptPath = join(binDir, "claude");
    const authored = writeFakeCliScript(markerPath, "ok");
    const authoredSource = readFileSync(authored, "utf8");
    writeFileSync(scriptPath, authoredSource);
    chmodSync(scriptPath, 0o755);

    const savedPath = process.env.PATH;
    try {
      process.env.PATH = binDir;
      const runner = new OfficialClaudeCodeCliRunner({
        capabilities: {
          protocol: "claude-code-stream-json-v1",
          cliVersion: "unpinned",
          source: "probe-fixture",
          qualificationRef: "unpinned:probe-fixture",
        },
        spawnFn: spawn as never,
        sandboxRootDir: TEST_SCRATCH,
        timeoutMs: 10_000,
      });
      let terminalResults = 0;
      for await (const event of runner.run({
        access: {
          accessToken: "probe-path-token",
          expiresAt: Date.now() + 3_600_000,
          scopes: ["user:inference"],
        },
        request: {
          modelId: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: [{ type: "text", text: "probe hello" }] }],
        },
        signal: new AbortController().signal,
      })) {
        if (event.type === "result") terminalResults++;
      }
      expect(terminalResults).toBe(1);
      expect(readMarker(markerPath).credential.hasRefreshToken).toBe(false);
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  }, 15000);
});

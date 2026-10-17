import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendCrashLog,
  crashSignalName,
  CRASH_LOG_COMPONENTS,
  formatCrashLogHumanRow,
  getCrashLogDrops,
  getCrashLogVersion,
  installCrashHandlers,
  MAX_CRASH_LOG_BYTES,
  readCrashLog,
  readFileTailLines,
  readRecentCrashLogs,
  redactCrashText,
  resolveCrashLogDir,
  resolveCrashLogPath,
} from "./crash-log.js";

function tempEnv(): { env: Record<string, string>; root: string } {
  const root = mkdtempSync(join(tmpdir(), "h2a-crashlog-"));
  const env: Record<string, string> = {
    HOME: join(root, "home"),
    XDG_STATE_HOME: join(root, "state"),
    PATH: "/usr/bin:/bin",
  };
  return { env, root };
}

describe("crash-log", () => {
  it("resolves one state file per component (XDG or HOME fallback)", () => {
    expect(resolveCrashLogPath("cli", { HOME: "/lab/home", XDG_STATE_HOME: "/lab/state" })).toBe(
      "/lab/state/h2a/cli.log",
    );
    expect(resolveCrashLogPath("attach", { HOME: "/lab/home", XDG_STATE_HOME: "/lab/state" })).toBe(
      "/lab/state/h2a/attach.log",
    );
    expect(resolveCrashLogPath("mcp-server", { HOME: "/lab/home", XDG_STATE_HOME: "/lab/state" })).toBe(
      "/lab/state/h2a/mcp-server.log",
    );
    expect(resolveCrashLogPath("cli", { HOME: "/lab/home" })).toBe("/lab/home/.local/state/h2a/cli.log");
    expect(resolveCrashLogDir({ HOME: "/lab/home", XDG_STATE_HOME: "/lab/state" })).toBe("/lab/state/h2a");
    expect(new Set(CRASH_LOG_COMPONENTS)).toEqual(new Set(["cli", "attach", "mcp-server"]));
  });

  it("records version, pid, component and session/instance id on every row", () => {
    const { env, root } = tempEnv();
    try {
      const ok = appendCrashLog(
        "cli",
        { event: "refusal", sessionId: "h2a-demo", instanceId: "gen-1", reason: "native-name-collision", detail: "admission refused" },
        resolveCrashLogPath("cli", env),
      );
      expect(ok).toBe(true);
      const rows = readCrashLog("cli", resolveCrashLogPath("cli", env));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        component: "cli",
        version: getCrashLogVersion(),
        pid: process.pid,
        event: "refusal",
        sessionId: "h2a-demo",
        instanceId: "gen-1",
        reason: "native-name-collision",
      });
      expect(typeof rows[0]!.timestamp).toBe("string");
      expect(statSync(resolveCrashLogPath("cli", env)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never logs secrets (env values, bearer, tokens, cookies, key=value)", () => {
    const { env, root } = tempEnv();
    const secret = "cR4sHl0g-S3cret-9z7q";
    process.env["H2A_CRASHLOG_TEST_SECRET"] = secret;
    try {
      appendCrashLog(
        "attach",
        {
          event: "refusal",
          sessionId: "h2a-s",
          reason: "give-up",
          detail: `boom ${secret} Authorization: Bearer ${secret} token=${secret} Cookie: session=${secret}`,
        },
        resolveCrashLogPath("attach", env),
      );
      const raw = readFileSync(resolveCrashLogPath("attach", env), "utf8");
      expect(raw).not.toContain(secret);
      expect(raw).toContain("[REDACTED]");
      expect(redactCrashText(`Basic ${Buffer.from(`u:${secret}`).toString("base64")}`)).not.toContain(secret);
    } finally {
      delete process.env["H2A_CRASHLOG_TEST_SECRET"];
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rotates at the bound and keeps private modes", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("mcp-server", env);
      mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
      writeFileSync(log, "x".repeat(MAX_CRASH_LOG_BYTES), { mode: 0o600 });
      // Ensure parent dir has private mode for the writer's safety check.
      expect(appendCrashLog("mcp-server", { event: "childExit", exitCode: 1, reason: "spawn" }, log)).toBe(true);
      expect(statSync(`${log}.1`).size).toBe(MAX_CRASH_LOG_BYTES);
      expect(statSync(`${log}.1`).mode & 0o777).toBe(0o600);
      expect(statSync(log).mode & 0o777).toBe(0o600);
      expect(readCrashLog("mcp-server", log).at(-1)).toMatchObject({ event: "childExit", exitCode: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads recent rows across components, oldest first", () => {
    const { env, root } = tempEnv();
    try {
      appendCrashLog("cli", { event: "refusal", reason: "first" }, resolveCrashLogPath("cli", env));
      appendCrashLog("attach", { event: "sessionExit", sessionId: "h2a-x", exitCode: 3 }, resolveCrashLogPath("attach", env));
      const rows = readRecentCrashLogs(["cli", "attach"], 50, env);
      expect(rows.map((r) => r.component)).toEqual(["cli", "attach"]);
      expect(readRecentCrashLogs(["cli", "attach"], 1, env)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops instead of blocking on a live lock and never throws", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      appendCrashLog("cli", { event: "start" }, log);
      writeFileSync(`${log}.lock`, "99999999:live");
      expect(appendCrashLog("cli", { event: "refusal", reason: "contended" }, log)).toBe(false);
      expect(readCrashLog("cli", log)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redacts canonical credential forms with no help from the environment", () => {
    // The secret is deliberately ABSENT from process.env: pattern redaction
    // must hold on its own (revcrashlog constat 1).
    const secret = "n0Env-S3cret-8y6x";
    expect(process.env["H2A_CRASHLOG_ABSENT_A"]).toBeUndefined();
    expect(process.env["H2A_CRASHLOG_ABSENT_B"]).toBeUndefined();
    const cases = [
      `access_token=${secret}`,
      `client_secret=${secret}`,
      `refresh_token=${secret}`,
      `{"password":"${secret}"}`,
      `{"access_token": "${secret}"}`,
      `--password ${secret}`,
      `passphrase=${secret}`,
      `passwd=${secret}`,
      `session=${secret}`,
      `token=${secret}`,
      `?access_token=${secret}&other=1`,
    ];
    for (const text of cases) {
      expect(redactCrashText(text), text).not.toContain(secret);
    }
    expect(redactCrashText(`mytoken=${secret}`)).not.toContain(secret);
    // Non-secret lookalikes must survive redaction.
    expect(redactCrashText("sessionId=h2a-demo")).toContain("h2a-demo");
  });

  it("redacts non-enumerated credential variants with no help from the environment", () => {
    // rev350r2 constat 1: the probe leaked 19/41 shapes (dash/underscore
    // crossing, JSON/= header forms, short aliases, PEM, comma values).
    const secret = "n0Probe-S3cret-4y2w";
    expect(process.env["H2A_CRASHLOG_ABSENT_C"]).toBeUndefined();
    const cases = [
      `--access_token ${secret}`,
      `--refresh_token ${secret}`,
      `--client_secret ${secret}`,
      `--api_key ${secret}`,
      `--auth_token ${secret}`,
      `--session ${secret}`,
      `--credential ${secret}`,
      `--private-key ${secret}`,
      `--private_key ${secret}`,
      `{"Authorization":"${secret}"}`,
      `Authorization=${secret}`,
      `{"cookie":"${secret}"}`,
      `'password': '${secret}'`,
      `pass=${secret}`,
      `pwd=${secret}`,
      `auth=${secret}`,
      `private_key=${secret}`,
      `password=p@ss,word${secret}`,
      `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`,
    ];
    for (const text of cases) {
      expect(redactCrashText(text), text).not.toContain(secret);
    }
    // Non-secret lookalikes must survive redaction.
    expect(redactCrashText("sessionId=h2a-demo")).toContain("h2a-demo");
    expect(redactCrashText("author=octavia")).toContain("octavia");
  });

  it("redacts a Basic credential blob as a whole", () => {
    const blob = Buffer.from("user:s3cr3t").toString("base64");
    expect(redactCrashText(`Basic ${blob}`)).toBe("[REDACTED]");
    expect(redactCrashText("Bearer abcdef12345")).toBe("[REDACTED]");
  });

  it("maps numeric exit signals to names", () => {
    expect(crashSignalName(9)).toBe("SIGKILL");
    expect(crashSignalName(15)).toBe("SIGTERM");
    expect(crashSignalName(2)).toBe("SIGINT");
    expect(crashSignalName("9")).toBe("SIGKILL");
    expect(crashSignalName("SIGTERM")).toBe("SIGTERM");
    expect(crashSignalName("bogus!!")).toBe("unknown");
    expect(crashSignalName(9999)).toBe("SIG9999");
    expect(crashSignalName(undefined)).toBeUndefined();
  });

  it("reads recent rows across rotations (.1 included)", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      expect(appendCrashLog("cli", { event: "refusal", reason: "before-rotation" }, log)).toBe(true);
      mkdirSync(dirname(log), { recursive: true });
      renameSync(log, `${log}.1`);
      expect(appendCrashLog("cli", { event: "refusal", reason: "after-rotation" }, log)).toBe(true);
      const rows = readRecentCrashLogs(["cli"], 50, env);
      expect(rows.map((r) => r.reason)).toEqual(["before-rotation", "after-rotation"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reclaims a stale orphan lock instead of going silent forever", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      expect(appendCrashLog("cli", { event: "start" }, log)).toBe(true);
      writeFileSync(`${log}.lock`, "99999999:orphan");
      const ancient = new Date(Date.now() - 120_000);
      utimesSync(`${log}.lock`, ancient, ancient);
      expect(appendCrashLog("cli", { event: "refusal", reason: "after-orphan" }, log)).toBe(true);
      expect(readCrashLog("cli", log).map((r) => r.reason)).toContain("after-orphan");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never reclaims a stale lock owned by a live process", () => {
    // rev350r2 constat 5: mtime is never refreshed by a writer blocked in the
    // filesystem, so age alone cannot prove death — only a dead owner PID can.
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      expect(appendCrashLog("cli", { event: "start" }, log)).toBe(true);
      writeFileSync(`${log}.lock`, `${process.pid}:live-blocked`);
      const ancient = new Date(Date.now() - 120_000);
      utimesSync(`${log}.lock`, ancient, ancient);
      expect(appendCrashLog("cli", { event: "refusal", reason: "must-drop" }, log)).toBe(false);
      expect(readFileSync(`${log}.lock`, "utf8")).toBe(`${process.pid}:live-blocked`);
      expect(readCrashLog("cli", log)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs a pre-existing group-readable state dir instead of dropping silently", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
      chmodSync(dirname(log), 0o755);
      expect(appendCrashLog("cli", { event: "refusal", reason: "repaired-dir" }, log)).toBe(true);
      expect(statSync(dirname(log)).mode & 0o777).toBe(0o700);
      expect(readCrashLog("cli", log)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accounts a contention drop as a visible dropped row", () => {
    const { env, root } = tempEnv();
    try {
      const log = resolveCrashLogPath("cli", env);
      expect(appendCrashLog("cli", { event: "start" }, log)).toBe(true);
      const dropsBefore = getCrashLogDrops();
      writeFileSync(`${log}.lock`, "99999999:live");
      expect(appendCrashLog("cli", { event: "refusal", reason: "contended" }, log)).toBe(false);
      expect(getCrashLogDrops()).toBeGreaterThan(dropsBefore);
      rmSync(`${log}.lock`, { force: true });
      expect(appendCrashLog("cli", { event: "refusal", reason: "after-contention" }, log)).toBe(true);
      const rows = readCrashLog("cli", log);
      expect(rows.some((r) => r.event === "dropped")).toBe(true);
      expect(rows.at(-1)).toMatchObject({ event: "refusal", reason: "after-contention" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records fatal monitor events without altering process behavior", () => {
    const { env, root } = tempEnv();
    const previous = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = env["XDG_STATE_HOME"];
    try {
      installCrashHandlers("cli");
      const listeners = process.listeners("uncaughtExceptionMonitor");
      const handler = listeners.at(-1) as ((error: Error, origin: string) => void) | undefined;
      expect(handler).toBeDefined();
      handler!(new Error("boom-monitor-probe"), "unhandledRejection");
      try {
        const rows = readCrashLog("cli", resolveCrashLogPath("cli", env));
        expect(rows.at(-1)).toMatchObject({ event: "unhandledRejection", detail: "boom-monitor-probe" });
      } finally {
        if (handler) process.removeListener("uncaughtExceptionMonitor", handler);
      }
    } finally {
      if (previous === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("wires fatal paths: launcher, attach bridge and MCP import the crash log", () => {
    const sources: Record<string, string> = {
      launcher: readFileSync(join(import.meta.dirname ?? ".", "native-host.ts"), "utf8"),
      attach: readFileSync(join(import.meta.dirname ?? ".", "attach.ts"), "utf8"),
      op: readFileSync(join(import.meta.dirname ?? ".", "native-terminal", "op.ts"), "utf8"),
      mcp: readFileSync(join(import.meta.dirname ?? ".", "central-mcp.ts"), "utf8"),
    };
    for (const [name, source] of Object.entries(sources)) {
      expect(source, `${name} must log fatal paths to the crash log`).toContain("crash-log.js");
    }
    // Passive witnesses are installed at the real entry points only: the
    // idempotent once-guard inside main() (real core-binary dispatch path).
    const index = readFileSync(join(import.meta.dirname ?? ".", "index.ts"), "utf8");
    expect(index).toContain("installCliWitnessOnce()");
    expect(sources["op"]).toContain('installCrashHandlers("cli")');
  });

  it("shows the why on one human line: detail and error, single-line and bounded", () => {
    const line = formatCrashLogHumanRow({
      timestamp: "2026-10-17T00:00:00.000Z",
      component: "cli",
      event: "childExit",
      reason: "op:ensure-host",
      exitCode: 1,
      detail: `first line\nsecond line ${"x".repeat(500)}`,
    });
    expect(line).toContain("reason=op:ensure-host");
    expect(line).toContain("exitCode=1");
    expect(line).toContain("detail=first line second line");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(700);
    const hostLine = formatCrashLogHumanRow({
      timestamp: "2026-10-17T00:00:00.000Z",
      component: "native-host",
      event: "uncaughtException",
      error: "[REDACTED]",
      kind: undefined,
    });
    expect(hostLine).toContain("error=[REDACTED]");
  });

  it("tails a raw log for the viewer without throwing on absence", () => {
    const { root } = tempEnv();
    try {
      const raw = join(root, "mcp-central.log");
      expect(readFileTailLines(join(root, "missing.log"), 20)).toEqual([]);
      writeFileSync(raw, Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n"));
      expect(readFileTailLines(raw, 20)).toHaveLength(20);
      expect(readFileTailLines(raw, 20)[0]).toBe("line-10");
      expect(readFileTailLines(raw, 50)).toHaveLength(30);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("caps the tail scan instead of loading a huge raw log", () => {
    // rev350r2 constat 4: the viewer must not load a multi-MB server dump to
    // show its last lines. Lines past the scan window are dropped whole —
    // the last line is always complete.
    const { root } = tempEnv();
    try {
      const raw = join(root, "mcp-central.log");
      const lines = Array.from({ length: 20 }, (_, i) => `big-${i}-${"B".repeat(100_000)}`);
      writeFileSync(raw, `${lines.join("\n")}\n`);
      const tail = readFileTailLines(raw, 20);
      expect(tail.length).toBeGreaterThan(0);
      expect(tail.length).toBeLessThan(20);
      expect(tail.at(-1)).toBe(lines.at(-1));
      expect(tail[0]).toBe(lines[lines.length - tail.length]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

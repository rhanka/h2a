import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appendCrashLog,
  CRASH_LOG_COMPONENTS,
  getCrashLogVersion,
  MAX_CRASH_LOG_BYTES,
  readCrashLog,
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
  });
});

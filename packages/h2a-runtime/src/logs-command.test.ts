import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendCrashLog, resolveCrashLogPath } from "./crash-log.js";
import { main } from "./index.js";
import { appendHostJournal, resolveHostJournalPath } from "./native-terminal/journal.js";

function tempDirs(): { root: string; state: string; configHome: string } {
  const root = mkdtempSync(join(tmpdir(), "h2a-logs-cmd-"));
  return { root, state: join(root, "state"), configHome: join(root, "cfghome") };
}

describe("h2a logs command", () => {
  const saved: Record<string, string | undefined> = {};
  let dirs = tempDirs();
  let chunks: string[] = [];
  let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined;
  let savedExitCode: number | undefined;

  beforeEach(() => {
    dirs = tempDirs();
    for (const key of ["XDG_STATE_HOME", "REMOTE_CLI_CONFIG_HOME"] as const) {
      saved[key] = process.env[key];
    }
    process.env["XDG_STATE_HOME"] = dirs.state;
    process.env["REMOTE_CLI_CONFIG_HOME"] = dirs.configHome;
    savedExitCode = process.exitCode;
    chunks = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(() => {
    stdoutSpy?.mockRestore();
    for (const key of ["XDG_STATE_HOME", "REMOTE_CLI_CONFIG_HOME"] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    process.exitCode = savedExitCode;
    rmSync(dirs.root, { recursive: true, force: true });
  });

  const output = (): string => chunks.join("");

  it("installs the CLI fatal witness on the real dispatch path, exactly once", async () => {
    // rev350r2 constat 2: the owner binary reaches main() via lazy dispatch,
    // never via the runtime file as argv[1] — the witness must live here.
    const before = process.listeners("uncaughtExceptionMonitor").length;
    await main(["node", "h2a", "logs"]);
    await main(["node", "h2a", "logs", "--component", "cli"]);
    expect(process.listeners("uncaughtExceptionMonitor").length - before).toBe(1);
  });

  it("shows the rotated host crash, the why (detail), and rejects bad components", async () => {
    // rev350r2 constats 3+6: host .1 must be read, detail projected, and the
    // test must exercise the command (removing the projection breaks it).
    const env = { XDG_STATE_HOME: dirs.state };
    const hostLog = resolveHostJournalPath(env);
    appendHostJournal(
      { event: "start", pid: 4242, startTime: 1, version: "0.98.6", codePath: "entry", socket: "sock", generation: "gen-old-crash" },
      hostLog,
    );
    renameSync(hostLog, `${hostLog}.1`);
    appendHostJournal(
      { event: "start", pid: 4243, startTime: 2, version: "0.98.6", codePath: "entry", socket: "sock", generation: "gen-new" },
      hostLog,
    );
    const cliLog = resolveCrashLogPath("cli", env);
    expect(appendCrashLog("cli", { event: "refusal", reason: "refusal-mark-7k2q", detail: "why-explained-7k2q" }, cliLog)).toBe(true);

    await main(["node", "h2a", "logs"]);
    const out = output();
    expect(out).toContain("gen-old-crash");
    expect(out).toContain("gen-new");
    expect(out).toContain("reason=refusal-mark-7k2q");
    expect(out).toContain("why-explained-7k2q");

    chunks = [];
    expect(await main(["node", "h2a", "logs", "--component", "nope"])).toBe(1);
  });

  it("shows a raw-only server queue (redacted) instead of claiming no incidents", async () => {
    // rev350r2 constats 1+3: raw mcp-central.log is verbatim child output —
    // the viewer must display it (no early exit) and redact it on display.
    expect(process.env["H2A_LOGS_CMD_ABSENT"]).toBeUndefined();
    const secret = "l0Probe-S3cret-9y1w";
    const rawPath = join(dirs.configHome, ".config", "sentropic", "h2a", "mcp-central.log");
    mkdirSync(dirname(rawPath), { recursive: true });
    writeFileSync(rawPath, `server booted\ntoken=${secret}\nlistening\n`);
    expect(readFileSync(rawPath, "utf8")).toContain(secret);

    await main(["node", "h2a", "logs"]);
    const out = output();
    expect(out).not.toContain("no crash-log incidents");
    expect(out).toContain("mcp-central.log raw tail");
    expect(out).toContain("server booted");
    expect(out).not.toContain(secret);
  });
});

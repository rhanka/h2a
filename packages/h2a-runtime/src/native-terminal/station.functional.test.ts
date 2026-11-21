// @ts-ignore Shared JS test isolation helper.
import {
  isolatedNativeTestEnvironment,
  pinPrivateNativeProcess,
  setupNativeTestEnvironment,
  spawnIsolatedNative as spawn,
  waitForPrivateNativeProcesses,
} from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);

import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import type * as NodePty from "node-pty";
import xtermMod from "@xterm/headless";

import type { NativeTerminalClient } from "./client.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";
import { STATION_STATE_FILE_NAME } from "./station-state.js";
import { TerminalModeTracker } from "./terminal-modes.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

const pty: typeof NodePty = createRequire(import.meta.url)("node-pty");
const loader = fileURLToPath(import.meta.resolve("tsx"));

const children = new Set<ChildProcess>();
const terminals = new Set<NodePty.IPty>();
const directories = new Set<string>();
const supervisors = new Set<NativeTerminalHostSupervisor>();
const processPins = new Set<() => void>();

afterEach(async () => {
  for (const terminal of terminals) terminal.kill("SIGKILL");
  terminals.clear();
  for (const supervisor of supervisors) supervisor.disconnect();
  supervisors.clear();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGKILL");
      await ended;
    }
  }
  children.clear();
  await waitForPrivateNativeProcesses(process.env);
  for (const release of processPins) release();
  processPins.clear();
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
  }
  directories.clear();
});

async function until(accept: () => boolean, timeoutMs = 10_000, label = "state"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!accept()) {
    if (Date.now() > deadline) {
      throw new Error(`isolated station PTY did not reach the expected ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type FixtureSession = {
  id: string;
  label: string;
  /** Most recent first decides the session displayed at launch. */
  mtime: number;
  script: string;
};

/** A child that says it is ready, reports every resize and echoes its input. */
const echoChild = (tag: string, prelude = ""): string => `
  process.stdin.setRawMode(true);
  process.stdin.resume();
  ${prelude}
  process.stdout.write("${tag}_READY\\r\\n");
  process.stdout.on("resize", () => {
    process.stdout.write("${tag}_WINCH:" + process.stdout.columns + "x" + process.stdout.rows + "\\r\\n");
  });
  process.stdin.on("data", (buf) => {
    process.stdout.write("${tag}_RX:" + Buffer.from(buf).toString("hex") + "\\r\\n");
  });
`;

async function createStationFixture(opts: {
  cols: number;
  rows: number;
  sessions: readonly FixtureSession[];
  statusBar?: boolean;
  replayBytes?: number;
}) {
  const directory = await mkdtemp(join(tmpdir(), "station-func-"));
  directories.add(directory);
  const socketPath = join(directory, "host.sock");
  const home = join(directory, "home");
  const configHome = join(directory, "config");
  const configDir = join(configHome, ".config", "sentropic", "h2a");
  const projectDir = join(home, "src", "demo");
  await mkdir(configDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(directory, "xdg-config"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_RUNTIME_DIR: join(directory, "run"),
    REMOTE_CLI_CONFIG_HOME: configHome,
    H2A_NATIVE_SOCKET: socketPath,
    H2A_RIGHT_PANEL_WIDTH: "32",
    H2A_STATUS_BAR: opts.statusBar ? "1" : "0",
    H2A_NO_STATUS_BAR: opts.statusBar ? "" : "1",
    H2A_LANG: "en",
  };
  // The registry and the layout the station reads: throwaway sessions only.
  await writeFile(
    join(configDir, "registry.json"),
    JSON.stringify({
      version: 1,
      entries: opts.sessions.map((session) => ({
        id: session.id,
        tool: "claude",
        kind: "local-native",
        cwd: projectDir,
        label: session.label,
        tmuxSession: session.id,
        source: "run",
        sessionClass: "human",
        lastSeenAt: new Date(session.mtime).toISOString(),
        enrolledAt: new Date(session.mtime).toISOString(),
      })),
    }),
  );
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ layout: { groups: [{ title: "demo", projects: ["demo"] }] } }),
  );

  let host!: ChildProcess;
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath,
    registryPath: join(directory, "host-registry.json"),
    replayBytesPerSession: opts.replayBytes ?? 64 * 1024,
    generationFactory: () => "station-func-test",
    spawnHost: (options) => {
      host = spawn(
        process.execPath,
        [
          "--import",
          loader,
          fileURLToPath(new URL("./process.ts", import.meta.url)),
          "--socket",
          socketPath,
          "--generation",
          options.generation,
          "--replay-bytes",
          String(options.replayBytesPerSession),
          "--registry-path",
          options.registryPath!,
        ],
        { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.add(host);
      return host;
    },
  });
  supervisors.add(supervisor);
  const client: NativeTerminalClient = await supervisor.client();
  const created = new Map<string, Awaited<ReturnType<NativeTerminalClient["create"]>>>();
  for (const session of opts.sessions) {
    created.set(
      session.id,
      await client.create({
        id: session.id,
        command: process.execPath,
        args: ["-e", session.script],
        cwd: projectDir,
        env: env as Record<string, string>,
        cols: 80,
        rows: 24,
      }),
    );
  }
  const statePath = join(configDir, STATION_STATE_FILE_NAME);

  const station = (protectedByParent = false) => {
    const stationArgs = [
      "--import",
      loader,
      fileURLToPath(new URL("./op.ts", import.meta.url)),
      "station",
      "--socket",
      socketPath,
      "--state-file",
      statePath,
      "--dead-count",
      "1",
    ];
    const recovery = new URL("./attach-recovery.ts", import.meta.url).href;
    const args = protectedByParent
      ? [
          "--import",
          loader,
          "--input-type=module",
          "-e",
          `import { spawnSync } from 'node:child_process';
           import { withAttachTerminalRecovery } from ${JSON.stringify(recovery)};
           const ttyState = () => spawnSync('stty', ['-g'], { stdio: ['inherit', 'pipe', 'inherit'] }).stdout.toString();
           const before = ttyState();
           const result = withAttachTerminalRecovery(env => spawnSync(process.execPath,
             ${JSON.stringify(stationArgs)}, { env, stdio: 'inherit' }));
           if (ttyState() !== before) throw new Error('outer termios was not restored');
           process.exitCode = result.status ?? 1;`,
        ]
      : stationArgs;
    isolatedNativeTestEnvironment(env);
    const terminal = pty.spawn(process.execPath, args, {
      cwd: directory,
      env: env as Record<string, string>,
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
    });
    terminals.add(terminal);
    let output = "";
    let ended = false;
    let exitCode: number | undefined;
    /** Simulated terminal: answers the station sentinel like a real one. */
    let answerSentinel = true;
    let sentinels = 0;
    let carry = "";
    const sentinelWaiters: Array<{ after: number; resolve: () => void }> = [];
    terminal.onData((data) => {
      output += data;
      // Only the new bytes are scanned (plus a carry for a split sequence):
      // the cost of observing must not grow with what was already printed.
      const window = carry + data;
      let at = window.indexOf("\x1b[5n");
      while (at >= 0) {
        sentinels += 1;
        if (answerSentinel) terminal.write("\x1b[0n");
        at = window.indexOf("\x1b[5n", at + 4);
      }
      carry = window.slice(-3);
      for (let i = sentinelWaiters.length - 1; i >= 0; i -= 1) {
        if (sentinels > sentinelWaiters[i]!.after) sentinelWaiters.splice(i, 1)[0]!.resolve();
      }
    });
    terminal.onExit((event) => {
      ended = true;
      exitCode = event.exitCode;
      terminals.delete(terminal);
    });
    processPins.add(pinPrivateNativeProcess(terminal.pid, env));
    for (const state of created.values()) {
      processPins.add(pinPrivateNativeProcess(state.pid, env));
    }
    return {
      terminal,
      output: () => output,
      mark: () => output.length,
      since: (mark: number) => output.slice(mark),
      ended: () => ended,
      exitCode: () => exitCode,
      setAnswerSentinel: (value: boolean) => {
        answerSentinel = value;
      },
      sentinelCount: () => sentinels,
      /** Resolves when the station emits its next t6 sentinel. */
      nextSentinel: (after: number): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          if (sentinels > after) return resolve();
          const timer = setTimeout(() => reject(new Error("no station sentinel within 60 s")), 60_000);
          sentinelWaiters.push({
            after,
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
          });
        }),
      pinChild: (pid: number) => {
        processPins.add(pinPrivateNativeProcess(pid, env));
      },
      /** Give the panel the keyboard without changing any geometry. */
      focusPanel: () => {
        terminal.write(`\x1b[<0;${opts.cols};${opts.rows - 3}M`);
        terminal.write(`\x1b[<0;${opts.cols};${opts.rows - 3}m`);
      },
    };
  };

  /** Everything a session ever printed, read from the host. */
  const printed = async (id: string): Promise<string> =>
    (await client.readOutput(id, 0, 20_000)).chunks.map((chunk) => chunk.data).join("");

  return { client, station, printed, created, statePath, directory, env };
}

const hex = (text: string): string => Buffer.from(text, "latin1").toString("hex");

async function assertMatchesFreshTerminal(output: string, cols: number, rows: number): Promise<void> {
  const tracker = new TerminalModeTracker();
  tracker.feed(output);
  expect(tracker.resetSequence()).toBe("");
  expect(tracker.isMouseTrackingEnabled()).toBe(false);
  const outer = new XtermTerminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  const fresh = new XtermTerminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  type Core = {
    _core: {
      _bufferService: { buffer: { scrollTop: number; scrollBottom: number } };
      coreService: { decPrivateModes: { origin: boolean }; modes: { insertMode: boolean } };
      coreMouseService?: { activeProtocol: string; activeEncoding: string };
      _inputHandler: { _curAttrData: { isAttributeDefault(): boolean } };
    };
  };
  try {
    await new Promise<void>((resolve) => outer.write(output, resolve));
    expect(outer.buffer.active.type).toBe(fresh.buffer.active.type);
    const a = (outer as unknown as Core)._core;
    const b = (fresh as unknown as Core)._core;
    expect(a._bufferService.buffer.scrollTop).toBe(b._bufferService.buffer.scrollTop);
    expect(a._bufferService.buffer.scrollBottom).toBe(b._bufferService.buffer.scrollBottom);
    expect(a.coreService.decPrivateModes.origin).toBe(b.coreService.decPrivateModes.origin);
    expect(a.coreService.modes.insertMode).toBe(b.coreService.modes.insertMode);
    expect(outer.modes).toEqual(fresh.modes);
    if (a.coreMouseService && b.coreMouseService) {
      expect(a.coreMouseService.activeProtocol).toBe(b.coreMouseService.activeProtocol);
      expect(a.coreMouseService.activeEncoding).toBe(b.coreMouseService.activeEncoding);
    }
    expect(a._inputHandler._curAttrData.isAttributeDefault()).toBe(true);
  } finally {
    outer.dispose();
    fresh.dispose();
  }
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

describe.skipIf(process.platform !== "linux")(
  "S1 station — real host, real PTYs, real bridge process",
  () => {
    it("should list the live sessions, switch between real PTYs and never route a byte typed for A to B", async () => {
      const f = await createStationFixture({
        cols: 120,
        rows: 30,
        sessions: [
          { id: "h2a-alpha", label: "alpha", mtime: 1_700_000_900_000, script: echoChild("ALPHA") },
          { id: "h2a-bravo", label: "bravo", mtime: 1_700_000_100_000, script: echoChild("BRAVO") },
        ],
      });
      const before = await Promise.all(["h2a-alpha", "h2a-bravo"].map((id) => f.client.state(id)));
      const outer = f.station();
      // Launch: the most recent session of the first group, panel open, one window.
      await until(() => outer.output().includes("ALPHA_READY"), 20_000, "launch");
      await until(() => outer.output().includes("[demo]"), 10_000, "panel");
      expect(outer.output()).toContain("\x1b[?1000h\x1b[?1006h");
      expect(outer.output()).toContain("1 dead");
      // Panel open ⇒ the displayed PTY has the columns left of the panel.
      await until(() => outer.output().includes("ALPHA_WINCH:88x30"), 10_000, "child resize");

      outer.terminal.write("for-alpha");
      await until(() => outer.output().includes(`ALPHA_RX:${hex("for-alpha")}`), 10_000, "echo of A");

      // Switch: panel focus, second row of the tab.
      const switched = outer.mark();
      outer.focusPanel();
      outer.terminal.write("2");
      await until(() => outer.since(switched).includes("BRAVO_READY"), 15_000, "switch to B");
      // t4 in the fixed order, never a full reset.
      const after = outer.since(switched);
      expect(after.indexOf("\x1b[!p")).toBeGreaterThan(-1);
      expect(after.indexOf("\x1b[!p")).toBeLessThan(after.indexOf("\x1b[2J\x1b[3J\x1b[H"));
      expect(after.indexOf("\x1b[2J\x1b[3J\x1b[H")).toBeLessThan(after.indexOf("BRAVO_READY"));
      expect(outer.output()).not.toContain("\x1bc");
      await until(() => outer.since(switched).includes("BRAVO_WINCH:88x30"), 10_000, "resize of B");

      outer.terminal.write("for-bravo");
      await until(() => outer.output().includes(`BRAVO_RX:${hex("for-bravo")}`), 10_000, "echo of B");

      // I4, on the PTY side: A never received a byte typed for B, and vice versa.
      const alpha = await f.printed("h2a-alpha");
      const bravo = await f.printed("h2a-bravo");
      expect(alpha).toContain(`ALPHA_RX:${hex("for-alpha")}`);
      expect(alpha).not.toContain(hex("for-bravo"));
      expect(bravo).toContain(`BRAVO_RX:${hex("for-bravo")}`);
      expect(bravo).not.toContain(hex("for-alpha"));
      // The digit and the panel click stayed in the panel.
      expect(alpha).not.toContain("ALPHA_RX:32");
      expect(alpha).not.toContain(hex("\x1b[<0;"));

      // On this host (no composer broker) A is kept under a compatibility guard.
      expect((await f.client.state("h2a-alpha")).controlled).toBe(true);
      expect((await f.client.state("h2a-bravo")).controlled).toBe(true);

      // Ctrl-\ closes the station; no PTY was created nor stopped.
      outer.terminal.write("\x1c");
      await until(outer.ended, 10_000, "close");
      expect(outer.exitCode()).toBe(0);
      expect(outer.output()).toContain("[h2a] station closed (sessions keep running)");
      const afterStates = await Promise.all(["h2a-alpha", "h2a-bravo"].map((id) => f.client.state(id)));
      expect(afterStates.map((s) => [s.id, s.generation, s.incarnation, s.pid, s.status])).toEqual(
        before.map((s) => [s.id, s.generation, s.incarnation, s.pid, s.status]),
      );
      expect(afterStates.map((s) => s.controlled)).toEqual([false, false]);
      // Atomic 0600 state: tab, last session per tab, compatibility guards only.
      const persisted = JSON.parse(await readFile(f.statePath, "utf8"));
      expect(Object.keys(persisted).sort()).toEqual(["activeTab", "compatGuards", "lastSessionByTab", "version"]);
      expect(persisted).toMatchObject({ activeTab: "demo", lastSessionByTab: { demo: "h2a-bravo" } });
      expect(Object.keys(persisted.compatGuards)).toEqual(["h2a-alpha"]);
      await assertMatchesFreshTerminal(outer.output(), 120, 30);
    }, 60_000);

    it("should not resize a session that comes back at the same size (S1.6, real PTY)", async () => {
      const f = await createStationFixture({
        cols: 120,
        rows: 30,
        sessions: [
          { id: "h2a-alpha", label: "alpha", mtime: 1_700_000_900_000, script: echoChild("ALPHA") },
          { id: "h2a-bravo", label: "bravo", mtime: 1_700_000_100_000, script: echoChild("BRAVO") },
        ],
      });
      const outer = f.station();
      await until(() => outer.output().includes("ALPHA_WINCH:88x30"), 20_000, "launch");
      const toBravo = outer.mark();
      outer.focusPanel();
      outer.terminal.write("2");
      await until(() => outer.since(toBravo).includes("BRAVO_WINCH:88x30"), 15_000, "switch to B");
      const back = outer.mark();
      outer.focusPanel();
      outer.terminal.write("1");
      await until(() => outer.since(back).includes("ALPHA_READY"), 15_000, "back to A");
      // Type for A and wait for the echo: any late resize report would precede it.
      outer.terminal.write("probe");
      await until(() => outer.since(back).includes(`ALPHA_RX:${hex("probe")}`), 10_000, "echo of A");
      const alpha = await f.printed("h2a-alpha");
      // A was resized once, at its first display; coming back printed nothing new.
      expect(alpha.split("ALPHA_WINCH:").length - 1).toBe(1);
      expect((await f.printed("h2a-bravo")).split("BRAVO_WINCH:").length - 1).toBe(1);
      outer.terminal.write("\x1c");
      await until(outer.ended, 10_000, "close");
    }, 60_000);

    it("should leave a fresh terminal and free every lease when the bridge is killed and its guard survives (S1.7c)", async () => {
      const prelude = `process.stdout.write("\\x1b[?1049h\\x1b[?1004;2004;1002;1006h\\x1b[?25l\\x1b[>1u\\x1b[3;12r");`;
      const f = await createStationFixture({
        cols: 120,
        rows: 30,
        statusBar: true,
        sessions: [
          { id: "h2a-alpha", label: "alpha", mtime: 1_700_000_900_000, script: echoChild("ALPHA", prelude) },
          { id: "h2a-bravo", label: "bravo", mtime: 1_700_000_100_000, script: echoChild("BRAVO") },
        ],
      });
      const before = await Promise.all(["h2a-alpha", "h2a-bravo"].map((id) => f.client.state(id)));
      const outer = f.station(true);
      await until(() => outer.output().includes("ALPHA_READY"), 25_000, "launch");
      await until(() => outer.output().includes("[demo]"), 10_000, "panel");
      // One switch and back, so guards, bar, mouse, title and child modes are all live.
      const toBravo = outer.mark();
      outer.focusPanel();
      outer.terminal.write("2");
      await until(() => outer.since(toBravo).includes("BRAVO_READY"), 15_000, "switch to B");
      const back = outer.mark();
      outer.focusPanel();
      outer.terminal.write("1");
      await until(() => outer.since(back).includes("ALPHA_READY"), 15_000, "back to A");
      expect(outer.output()).toContain("\x1b[?1049h");

      const childPids = (
        await readFile(`/proc/${outer.terminal.pid}/task/${outer.terminal.pid}/children`, "utf8")
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      expect(childPids).toHaveLength(1);
      const bridgePid = childPids[0]!;
      expect(await readFile(`/proc/${bridgePid}/cmdline`, "utf8")).toContain("/native-terminal/op.ts");
      outer.pinChild(bridgePid);
      process.kill(bridgePid, "SIGKILL");
      await until(outer.ended, 10_000, "guard exit");

      // Mouse, scroll region, alternate screen, cursor, modes: a brand-new terminal.
      await assertMatchesFreshTerminal(outer.output(), 120, 30);
      // Leases freed, same incarnations: no PTY was touched.
      let states = await Promise.all(["h2a-alpha", "h2a-bravo"].map((id) => f.client.state(id)));
      for (let i = 0; i < 50 && states.some((s) => s.controlled); i += 1) {
        await sleep(50);
        states = await Promise.all(["h2a-alpha", "h2a-bravo"].map((id) => f.client.state(id)));
      }
      expect(states.map((s) => s.controlled)).toEqual([false, false]);
      expect(states.map((s) => [s.id, s.generation, s.incarnation, s.pid, s.status])).toEqual(
        before.map((s) => [s.id, s.generation, s.incarnation, s.pid, s.status]),
      );
    }, 90_000);

    it("should publish the switch latency for 256 KiB and 4 MiB of retained output (S1.8)", async () => {
      const big = (tag: string, bytes: number): string =>
        echoChild(
          tag,
          `
          const line = "${tag} ".padEnd(98, "x") + "\\r\\n";
          let left = ${bytes};
          while (left > 0) { process.stdout.write(line); left -= line.length; }
          `,
        );
      const f = await createStationFixture({
        cols: 160,
        rows: 40,
        replayBytes: 4 * 1024 * 1024,
        sessions: [
          { id: "h2a-small", label: "small", mtime: 1_700_000_900_000, script: echoChild("SMALL") },
          { id: "h2a-k256", label: "k256", mtime: 1_700_000_200_000, script: big("K256", 256 * 1024) },
          { id: "h2a-m4", label: "m4", mtime: 1_700_000_100_000, script: big("M4", 4 * 1024 * 1024) },
        ],
      });
      // Both histories are fully retained before anything is measured.
      for (const [id, tag] of [["h2a-k256", "K256"], ["h2a-m4", "M4"]] as const) {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const replay = await f.client.readOutput(id, 0, 30_000);
          if (replay.chunks.some((chunk) => chunk.data.includes(`${tag}_READY`))) break;
          if (Date.now() > deadline) throw new Error(`fixture ${id} never finished printing`);
          await sleep(100);
        }
      }
      const outer = f.station();
      await until(() => outer.output().includes("SMALL_READY"), 25_000, "launch");
      await until(() => outer.output().includes("[demo]"), 10_000, "panel");
      await sleep(300);

      // Rows of the tab, by label: k256 (1), m4 (2), small (3).
      const measure = async (digit: string, ready: string): Promise<number> => {
        outer.focusPanel();
        await sleep(40);
        const mark = outer.mark();
        const seen = outer.sentinelCount();
        const started = performance.now();
        outer.terminal.write(digit);
        // Input is open once the sentinel of t6 went out and was answered
        // (the simulated terminal answers at once: the sentinel is included).
        await outer.nextSentinel(seen);
        const elapsed = performance.now() - started;
        expect(outer.since(mark)).toContain(ready);
        return elapsed;
      };
      const rounds = 8;
      const samples = { k256: [] as number[], m4: [] as number[] };
      for (let i = 0; i < rounds; i += 1) {
        samples.k256.push(await measure("1", "K256_READY"));
        await measure("3", "SMALL_READY");
        samples.m4.push(await measure("2", "M4_READY"));
        await measure("3", "SMALL_READY");
      }
      const report = {
        criterion: "S1.8",
        panel: "open",
        sentinelTimeoutMs: 150,
        rounds,
        k256: { p95Ms: Math.round(p95(samples.k256)), samplesMs: samples.k256.map(Math.round), budgetMs: 200 },
        m4: { p95Ms: Math.round(p95(samples.m4)), samplesMs: samples.m4.map(Math.round), budgetMs: 1_500 },
      };
      const target = process.env.H2A_S1_8_REPORT ?? join(tmpdir(), "h2a-station-s1-8.json");
      await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`S1.8 ${JSON.stringify(report)}`);
      // The budget decides S3, it is not an assertion of this lot: the measure
      // only has to exist and to be sane.
      expect(samples.k256).toHaveLength(rounds);
      expect(samples.m4).toHaveLength(rounds);
      expect(Math.min(...samples.k256, ...samples.m4)).toBeGreaterThan(0);
      outer.terminal.write("\x1c");
      await until(outer.ended, 10_000, "close");
      expect(outer.exitCode()).toBe(0);
    }, 240_000);
  },
);

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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import type * as NodePty from "node-pty";
import xtermMod from "@xterm/headless";

import { NativeTerminalHostSupervisor } from "./supervisor.js";
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

async function until(accept: () => boolean, timeoutMs = 6_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!accept()) {
    if (Date.now() > deadline) {
      throw new Error("isolated panel PTY did not reach expected state");
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function createPanelPtyFixture(opts: {
  cols: number;
  rows: number;
  statusBar: boolean;
  childScript: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), "rp-func-"));
  directories.add(directory);
  const socketPath = join(directory, "host.sock");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(directory, "home"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_RUNTIME_DIR: join(directory, "run"),
    REMOTE_CLI_CONFIG_HOME: join(directory, "config"),
    H2A_NATIVE_SOCKET: socketPath,
    H2A_RIGHT_PANEL: "1",
    H2A_RIGHT_PANEL_WIDTH: "32",
    H2A_STATUS_BAR: opts.statusBar ? "1" : "0",
    H2A_NO_STATUS_BAR: opts.statusBar ? "" : "1",
  };

  let host!: ChildProcess;
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath,
    registryPath: join(directory, "registry.json"),
    replayBytesPerSession: 64 * 1024,
    generationFactory: () => "panel-func-test",
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
  const client = await supervisor.client();
  const id = "panel-fixture";
  const created = await client.create({
    id,
    command: process.execPath,
    args: ["-e", opts.childScript],
    cwd: directory,
    env: env as Record<string, string>,
    cols: opts.cols,
    rows: opts.rows,
  });

  const attach = (protectedByParent = false) => {
    const attachArgs = [
      "--import",
      loader,
      fileURLToPath(new URL("./op.ts", import.meta.url)),
      "attach",
      "--id",
      id,
      "--socket",
      socketPath,
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
             ${JSON.stringify(attachArgs)}, { env, stdio: 'inherit' }));
           if (ttyState() !== before) throw new Error('outer termios was not restored');
           process.exitCode = result.status ?? 1;`,
        ]
      : attachArgs;
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
    terminal.onData((data) => {
      output += data;
    });
    terminal.onExit(() => {
      ended = true;
      terminals.delete(terminal);
    });
    return {
      terminal,
      output: () => output,
      ended: () => ended,
      pin: () => {
        processPins.add(pinPrivateNativeProcess(created.pid, env));
        processPins.add(pinPrivateNativeProcess(terminal.pid, env));
      },
      pinChild: (pid: number) => {
        processPins.add(pinPrivateNativeProcess(pid, env));
      },
    };
  };

  return { host, client, id, attach, innerPid: created.pid };
}

async function assertMatchesFreshTerminal(
  output: string,
  cols: number,
  rows: number,
): Promise<void> {
  const tracker = new TerminalModeTracker();
  tracker.feed(output);
  expect(tracker.resetSequence()).toBe("");
  expect(tracker.isMouseTrackingEnabled()).toBe(false);

  const outer = new XtermTerminal({
    cols,
    rows,
    scrollback: 0,
    allowProposedApi: true,
  });
  const fresh = new XtermTerminal({
    cols,
    rows,
    scrollback: 0,
    allowProposedApi: true,
  });
  try {
    await new Promise<void>((resolve) => outer.write(output, resolve));
    expect(outer.buffer.active.type).toBe(fresh.buffer.active.type);
    const outerBuf = (outer as unknown as { _core: { _bufferService: { buffer: { scrollTop: number; scrollBottom: number } }; coreService: { decPrivateModes: { origin: boolean }; modes: { insertMode: boolean }; isCursorHidden?: boolean }; coreMouseService?: { activeProtocol: string; activeEncoding: string }; _inputHandler: { _curAttrData: { isAttributeDefault(): boolean } } } })._core;
    const freshBuf = (fresh as unknown as { _core: { _bufferService: { buffer: { scrollTop: number; scrollBottom: number } }; coreService: { decPrivateModes: { origin: boolean }; modes: { insertMode: boolean }; isCursorHidden?: boolean }; coreMouseService?: { activeProtocol: string; activeEncoding: string } } })._core;
    expect(outerBuf._bufferService.buffer.scrollTop).toBe(freshBuf._bufferService.buffer.scrollTop);
    expect(outerBuf._bufferService.buffer.scrollBottom).toBe(freshBuf._bufferService.buffer.scrollBottom);
    expect(outerBuf.coreService.decPrivateModes.origin).toBe(freshBuf.coreService.decPrivateModes.origin);
    expect(outerBuf.coreService.modes.insertMode).toBe(freshBuf.coreService.modes.insertMode);
    if (outerBuf.coreMouseService && freshBuf.coreMouseService) {
      expect(outerBuf.coreMouseService.activeProtocol).toBe(freshBuf.coreMouseService.activeProtocol);
      expect(outerBuf.coreMouseService.activeEncoding).toBe(freshBuf.coreMouseService.activeEncoding);
    }
    expect(outerBuf._inputHandler._curAttrData.isAttributeDefault()).toBe(true);
  } finally {
    outer.dispose();
    fresh.dispose();
  }
}

describe.skipIf(process.platform !== "linux")(
  "L0.5b real-PTY functional proofs — mouse ownership, routing, transcoding, and SIGKILL recovery",
  () => {
    it("whole-attach mouse: collapsed marker & bar marker clicks open panel, CLI clicks transcode under subscription, child 1000/1006 toggle never breaks panel, Shift stays native", async () => {
      const childScript = `
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write("CHILD_READY\\r\\n");
        process.stdin.on("data", (buf) => {
          const s = buf.toString("latin1");
          if (s.includes("S")) {
            process.stdout.write("\\x1b[?1000h\\x1b[?1015hSUB_URXVT\\r\\n");
          } else if (s.includes("D")) {
            process.stdout.write("\\x1b[?1000l\\x1b[?1006lUNSUB_DONE\\r\\n");
          } else {
            process.stdout.write("RX:" + Buffer.from(buf).toString("hex") + "\\r\\n");
          }
        });
      `;
      const f = await createPanelPtyFixture({
        cols: 100,
        rows: 20,
        statusBar: true,
        childScript,
      });
      const outer = f.attach(false);
      await until(() => outer.output().includes("CHILD_READY"));
      outer.pin();

      // 1) Whole-attach mouse enabled while collapsed, and visible bar marker ("▸▸" / "▸▸?" / "▸▸*") rendered on row 20 right edge
      await until(() => outer.output().includes("▸▸"));
      expect(outer.output()).toContain("\x1b[?1000h\x1b[?1006h");

      // 2) Click CLI zone BEFORE child subscribes => dropped (zero RX)
      outer.terminal.write("\x1b[<0;10;5M");
      // 3) Click bottom-bar visible marker (x=98, y=20) while collapsed => opens panel (paints at col 69)!
      const openPaintsBefore = outer.output().split("\x1b[1;69H").length - 1;
      outer.terminal.write("\x1b[<0;98;20M");
      await until(() => outer.output().split("\x1b[1;69H").length - 1 > openPaintsBefore);
      expect(outer.output()).not.toContain("RX:");

      // 4) Close panel by clicking bar marker again => collapsed strip repaints at col 100, outer mouse stays ON
      const stripPaintsBefore = outer.output().split("\x1b[1;100H│").length - 1;
      outer.terminal.write("\x1b[<0;98;20M");
      await until(() => outer.output().split("\x1b[1;100H│").length - 1 > stripPaintsBefore);

      // 5) Enable urxvt mouse subscription in child
      outer.terminal.write("S");
      await until(() => outer.output().includes("SUB_URXVT"));

      // 6) Shift+click in CLI zone => native selection, NEVER forwarded
      outer.terminal.write("\x1b[<4;10;5M");
      // 7) Normal click in CLI zone => transcoded to urxvt "\x1b[32;10;5M"
      outer.terminal.write("\x1b[<0;10;5M");
      const expectedHex = Buffer.from("\x1b[32;10;5M", "utf8").toString("hex");
      await until(() => outer.output().includes(`RX:${expectedHex}`));
      // Confirm Shift+click produced no extra RX
      expect(outer.output().match(/RX:/g)?.length).toBe(1);

      // 8) Child toggles 1000l + 1006l mid-attach => outer mouse stays intact, collapsed marker click STILL opens panel!
      outer.terminal.write("D");
      await until(() => outer.output().includes("UNSUB_DONE"));
      const openPaintsBeforeReopen = outer.output().split("\x1b[1;69H").length - 1;
      outer.terminal.write("\x1b[<0;100;10M");
      await until(() => outer.output().split("\x1b[1;69H").length - 1 > openPaintsBeforeReopen);

      // 9) Detach cleanly => terminal matches fresh terminal oracle
      outer.terminal.write("\x1c");
      await until(outer.ended);
      await assertMatchesFreshTerminal(outer.output(), 100, 20);
    }, 15_000);

    it("bar-inactive routing: last row routes to CLI when x <= childCols and to panel marker when x > childCols", async () => {
      const childScript = `
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write("\\x1b[?1000h\\x1b[?1006hBAR_OFF_READY\\r\\n");
        process.stdin.on("data", (buf) => {
          process.stdout.write("CLI_GOT:" + buf.toString("utf8") + "\\r\\n");
        });
      `;
      const f = await createPanelPtyFixture({
        cols: 100,
        rows: 20,
        statusBar: false,
        childScript,
      });
      const outer = f.attach(false);
      await until(() => outer.output().includes("BAR_OFF_READY"));
      outer.pin();

      // Click on last row y=20 inside CLI zone (x=96 <= childCols=99) => forwarded to CLI (NOT treated as status-marker!)
      outer.terminal.write("\x1b[<0;96;20M");
      await until(() => outer.output().includes("CLI_GOT:\x1b[<0;96;20M"));

      // Click on last row y=20 in marker column (x=100 > childCols=99) => opens panel!
      outer.terminal.write("\x1b[<0;100;20M");
      await until(() => outer.output().includes("sessions"));

      outer.terminal.write("\x1c");
      await until(outer.ended);
      await assertMatchesFreshTerminal(outer.output(), 100, 20);
    }, 15_000);

    it("Step 5 SIGKILL oracle: killing attach bridge with panel open and active child modes recovers outer terminal to fresh-terminal state via surviving guard", async () => {
      const childScript = `
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write("\\x1b[?1049h\\x1b[?1004;2004;1002;1006h\\x1b[?25l\\x1b[>1u\\x1b[3;12rSIGKILL_READY");
        setInterval(() => {}, 1000);
      `;
      const f = await createPanelPtyFixture({
        cols: 100,
        rows: 20,
        statusBar: true,
        childScript,
      });
      const outer = f.attach(true);
      await until(() => outer.output().includes("SIGKILL_READY"));
      outer.pin();

      // Open the right panel so mouse, status bar scroll region, alt screen, and child modes are all active
      outer.terminal.write("\x1b[24~");
      await until(() => outer.output().includes("\x1b[1;69H"));
      expect(outer.output()).toContain("\x1b[?1000h\x1b[?1006h");
      expect(outer.output()).toContain("\x1b[?1049h");

      // Locate and SIGKILL the attach bridge process (child of the surviving guard parent)
      const childPids = (
        await readFile(
          `/proc/${outer.terminal.pid}/task/${outer.terminal.pid}/children`,
          "utf8",
        )
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      expect(childPids).toHaveLength(1);
      const bridgePid = childPids[0]!;
      const cmdline = await readFile(`/proc/${bridgePid}/cmdline`, "utf8");
      expect(cmdline).toContain("/native-terminal/op.ts");
      outer.pinChild(bridgePid);

      process.kill(bridgePid, "SIGKILL");
      await until(outer.ended);

      // Oracle: outer terminal equals a brand-new fresh terminal (mouse, margins, scroll region, alt screen, cursor, SGR).
      await assertMatchesFreshTerminal(outer.output(), 100, 20);
      // Session in native host keeps running untouched.
      expect((await f.client.state(f.id)).status).toBe("running");
    }, 15_000);
  },
);

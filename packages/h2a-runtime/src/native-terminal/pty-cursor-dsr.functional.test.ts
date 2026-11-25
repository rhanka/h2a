import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import xtermMod from "@xterm/headless";
import {
  createPrivateTestDirectory,
  nativeTestEnvironment,
  setupNativeTestEnvironment,
  waitForPrivateNativeProcesses,
} from "../../../h2a/test/helpers/native-isolation.js";
import { nodePtySpawner, type PtyHandle } from "../pty.js";
import { NativeTerminalHost } from "./host.js";
import { startNativeTerminalHostServer } from "./server.js";
import { NativeTerminalClient } from "./client.js";
import { createNativeStatusBar, runAttach, type NativeTerminalAttachRuntime } from "./op.js";
import { buildRightPanelSnapshot } from "./right-panel.js";
import { runStation, type StationRuntime } from "./station.js";
import { withAttachTerminalRecovery } from "./attach-recovery.js";
import {
  CLIENT_TERMINAL_RESET_SEQUENCE,
  enterRawOutputTty,
  installTtySuspendHandlers,
  restoreTtyState,
  TtyBaselineRegistry,
} from "../terminal-reset.js";

setupNativeTestEnvironment(afterAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIST = resolve(HERE, "../../dist");
const H2A_BIN = resolve(HERE, "../../../h2a/dist/bin.js");
const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;

type HeadlessTerm = InstanceType<typeof XtermTerminal>;

function cleanChildEnv(baseEnv: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if (
      k.startsWith("H2A_NATIVE_TERMINAL") ||
      k.startsWith("H2A_NATIVE_PTY_SESSION") ||
      k.startsWith("H2A_SESSION_TOKEN") ||
      k.startsWith("H2A_PREFLIGHT_DONE") ||
      k.startsWith("H2A_CORE_ENTRY") ||
      k.startsWith("H2A_DIRECT_ROUTING_SCRUB") ||
      k.startsWith("H2A_SESSION_CLASS") ||
      k.startsWith("H2A_RUN_TMP") ||
      k === "H2A_ATTACH_RESET_RECEIPT" ||
      k === "H2A_CLIENT_RECOVERY_GUARD_ACTIVE" ||
      k === "CLAUDECODE" ||
      k === "TMUX" ||
      k === "TMUX_PANE"
    ) {
      continue;
    }
    out[k] = v;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  return out;
}

function sttyFlagsForPts(pts: string): string {
  return execFileSync("stty", ["-a", "-F", pts], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
  label = "condition",
): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolvePromise();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        rejectPromise(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 10).unref?.();
    };
    tick();
  });
}

async function writeTerm(term: HeadlessTerm, data: string): Promise<void> {
  await new Promise<void>((r) => term.write(data, r));
}

function makeFakeTtyBridge(cols: number, rows: number) {
  const term = new XtermTerminal({ cols, rows, scrollback: 200, allowProposedApi: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      stdin.isRaw = raw;
      return stdin;
    },
  });
  let allStdout = "";
  const stdoutChunks: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: cols,
    rows,
    write(chunk: string | Uint8Array) {
      const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      allStdout += s;
      stdoutChunks.push(s);
      term.write(s);
      return true;
    },
  });
  term.onData((reply: string) => {
    stdin.write(reply);
  });
  return {
    term,
    stdin,
    stdout,
    getOutput: () => allStdout,
    chunks: stdoutChunks,
  };
}

describe("PTY cursor, DSR coordinator, replay filtering, and TTY restoration (functional)", () => {
  it("Test 1 (agy twin): keeps -opost on outer PTY so cursor position, banner column, and bare LF match raw without stray G", async () => {
    const dir = createPrivateTestDirectory("pty18-agy");
    const env = cleanChildEnv(nativeTestEnvironment(dir));
    const socketPath = join(dir, "host.sock");
    const registryPath = join(dir, "registry.json");

    // agy-like TUI twin: runs in true cfmakeraw (-opost) so bare LF advances row
    // without resetting column, then types `abcdef` + Left x2 and checks cursor/cols.
    const twinScript = [
      'const { execFileSync } = require("node:child_process");',
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'execFileSync("stty", ["-opost"], { stdio: [0, "ignore", "ignore"] });',
      'process.stdout.write("\\x1b[2J\\x1b[H\\x1b[2;7HBANNER\\nZ\\x1b[8;1H> ");',
      'let buf = "";',
      'process.stdin.on("data", (d) => {',
      '  buf += d.toString("utf8");',
      '  if (buf === "abcdef\\x1b[D\\x1b[D") {',
      '    process.stdout.write("\\x1b[8;3Habcdef\\x1b[10;1H---\\x1b[8;7H");',
      '  } else if (buf.includes("Q")) {',
      '    process.exit(0);',
      '  }',
      '});',
    ].join(" ");

    // Raw baseline
    const rawTerm = new XtermTerminal({ cols: 100, rows: 24, allowProposedApi: true });
    const rawPty = nodePtySpawner({
      command: process.execPath,
      args: ["-e", twinScript],
      cwd: dir,
      env,
      cols: 100,
      rows: 24,
    });
    let rawOut = "";
    const rawSub = rawPty.onData((d) => {
      rawOut += d;
      rawTerm.write(d);
    });
    try {
      await waitUntil(() => rawOut.includes("> "), 4000, "raw agy prompt");
      rawPty.write("abcdef\x1b[D\x1b[D");
      await waitUntil(() => rawOut.includes("\x1b[8;7H"), 4000, "raw agy cursor move");
      await writeTerm(rawTerm, "");
      const rawBuf = rawTerm.buffer.active;
      expect(rawBuf.cursorX).toBe(6);
      expect(rawBuf.cursorY).toBe(7);
      expect(rawBuf.getLine(2)?.translateToString(true)).toBe("            Z");

      // Attached through real NativeTerminalHost + REAL outer node-pty running runAttach
      const host = new NativeTerminalHost({
        generation: "func-agy",
        replayBytesPerSession: 65536,
        spawner: nodePtySpawner,
        registryPath,
        socketPath,
      });
      const server = await startNativeTerminalHostServer({ socketPath, host });
      let outerPty: PtyHandle | undefined;
      const attachTerm = new XtermTerminal({ cols: 100, rows: 24, allowProposedApi: true });
      try {
        host.create({
          id: "h2a-agy",
          command: process.execPath,
          args: ["-e", twinScript],
          cwd: dir,
          env,
          cols: 100,
          rows: 23,
        });
        const runner = `
          import { NativeTerminalClient } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "native-terminal/client.js")}`).href)};
          import { runAttach } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "native-terminal/op.js")}`).href)};
          const code = await runAttach("h2a-agy", {
            connect: () => NativeTerminalClient.connect(${JSON.stringify(socketPath)}),
            stdin: process.stdin,
            stdout: process.stdout,
            now: () => Date.now(),
            delay: (ms) => new Promise((r) => setTimeout(r, ms)),
            onResize: () => {},
            offResize: () => {},
            onTerminate: (fn) => { process.once("SIGTERM", fn); },
            offTerminate: () => {},
          }, { statusBar: { enabled: true, env: { ...process.env, H2A_STATUS_BAR: "1" } }, rightPanel: false });
          process.exit(code);
        `;
        outerPty = nodePtySpawner({
          command: process.execPath,
          args: ["--input-type=module", "-e", runner],
          cwd: dir,
          env,
          cols: 100,
          rows: 24,
        });
        let attachedOut = "";
        let exited = false;
        outerPty.onData((d) => {
          attachedOut += d;
          attachTerm.write(d);
        });
        outerPty.onExit(() => {
          exited = true;
        });

        await waitUntil(() => attachedOut.includes("> "), 4000, "h2a agy prompt");
        const outerPts = readlinkSync(`/proc/${outerPty.pid}/fd/1`);
        const activeFlags = sttyFlagsForPts(outerPts);
        expect(activeFlags).toMatch(/(?:^|\s)-opost(?:\s|$)/);

        outerPty.write("abcdef\x1b[D\x1b[D");
        await waitUntil(() => attachedOut.includes("\x1b[8;7H"), 4000, "h2a agy cursor move");
        await writeTerm(attachTerm, "");

        const attBuf = attachTerm.buffer.active;
        expect(attBuf.cursorX).toBe(rawBuf.cursorX);
        expect(attBuf.cursorY).toBe(rawBuf.cursorY);
        expect(attBuf.getLine(2)?.translateToString(true)).toBe("            Z");
        expect(attBuf.getLine(7)?.translateToString(true)).toBe("> abcdef");
        // No stray literal 'G' outside '> abcdef' and no ONLCR CR injected before Z
        expect(attachedOut).toContain("BANNER\nZ");
        expect(attachedOut).not.toContain("G\x1b");

        outerPty.write("Q");
        await waitUntil(() => exited, 4000, "agy clean exit");
      } finally {
        try { outerPty?.kill("SIGKILL"); } catch {}
        attachTerm.dispose();
        await host.forceStopAll().catch(() => {});
        await server.close({ stopSessions: true }).catch(() => {});
      }
    } finally {
      rawSub.dispose();
      try { rawPty.kill("SIGKILL"); } catch {}
      rawTerm.dispose();
    }
    await waitForPrivateNativeProcesses(env);
  });

  it("Test 2 (Claude Code & Codex twins): single CPR, immediate Escape, XTQMODKEYS, and zero bare LF during attach (NB-5)", async () => {
    const dir = createPrivateTestDirectory("pty18-cl-cx");
    const env = cleanChildEnv(nativeTestEnvironment(dir));
    const socketPath = join(dir, "host.sock");
    const registryPath = join(dir, "registry.json");

    // 2a: Claude Code twin under real NativeTerminalHost + runAttach
    {
      const host = new NativeTerminalHost({
        generation: "func-claude",
        replayBytesPerSession: 65536,
        spawner: nodePtySpawner,
        registryPath,
        socketPath,
      });
      const server = await startNativeTerminalHostServer({ socketPath, host });
      const claudeTwin = [
        'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
        'const replies = [];',
        'process.stdin.on("data", (d) => {',
        '  replies.push(d.toString("utf8"));',
        '  if (replies.join("").includes("R")) {',
        '    process.stdout.write("CLAUDE_CPR=" + JSON.stringify(replies.join("")) + "|");',
        '  }',
        '});',
        'process.stdout.write("\\x1b[?1049h\\x1b[?1000h\\x1b[?2004h\\x1b[>1u\\x1b[>4;?m\\x1b[5;8H\\x1b[6n");',
        'setInterval(() => {}, 1000);',
      ].join(" ");

      const bridge = makeFakeTtyBridge(100, 24);
      let termFn: (() => void) | undefined;
      try {
        host.create({
          id: "h2a-claude",
          command: process.execPath,
          args: ["-e", claudeTwin],
          cwd: dir,
          env,
          cols: 100,
          rows: 23,
        });
        const attachPromise = runAttach(
          "h2a-claude",
          {
            connect: () => NativeTerminalClient.connect(socketPath),
            stdin: bridge.stdin as unknown as NodeJS.ReadStream,
            stdout: bridge.stdout as unknown as NodeJS.WriteStream,
            now: () => Date.now(),
            delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
            onResize: () => {},
            offResize: () => {},
            onTerminate: (fn: () => void) => { termFn = fn; },
            offTerminate: () => { termFn = undefined; },
          } as unknown as NativeTerminalAttachRuntime,
          { statusBar: { enabled: true, env }, rightPanel: false },
        );

        await waitUntil(() => bridge.getOutput().includes("CLAUDE_CPR="), 4000, "claude CPR reply");
        // NB-5: verify zero bare LF in attached child/status-bar stream
        const attachedOut = bridge.getOutput();
        let bareLf = 0;
        for (let i = 0; i < attachedOut.length; i++) {
          if (attachedOut[i] === "\n" && attachedOut[i - 1] !== "\r") bareLf += 1;
        }
        expect(bareLf).toBe(0);
        expect(attachedOut).toContain('CLAUDE_CPR="\\u001b[5;8R"');
        expect(attachedOut).not.toContain('1;1R');
        termFn?.();
        await attachPromise;
      } finally {
        bridge.term.dispose();
        await host.forceStopAll().catch(() => {});
        await server.close({ stopSessions: true }).catch(() => {});
      }
    }

    // 2b: Codex twin (single CPR at 5;12, Escape forwarded immediately)
    {
      const sock2 = join(dir, "host2.sock");
      const host = new NativeTerminalHost({
        generation: "func-codex",
        replayBytesPerSession: 65536,
        spawner: nodePtySpawner,
        registryPath,
        socketPath: sock2,
      });
      const server = await startNativeTerminalHostServer({ socketPath: sock2, host });
      const codexTwin = [
        'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
        'let stdinAll = "";',
        'process.stdin.on("data", (d) => {',
        '  const s = d.toString("utf8");',
        '  stdinAll += s;',
        '  if (s === "\\x1b") process.stdout.write("GOT_ESC|");',
        '  if (stdinAll.includes("R")) process.stdout.write("CX=" + JSON.stringify(stdinAll) + "|");',
        '});',
        'setTimeout(() => process.stdout.write("\\x1b[5;12H\\x1b[6n"), 50);',
        'setInterval(() => {}, 1000);',
      ].join(" ");
      const bridge = makeFakeTtyBridge(100, 24);
      let termFn: (() => void) | undefined;
      try {
        host.create({
          id: "h2a-codex",
          command: process.execPath,
          args: ["-e", codexTwin],
          cwd: dir,
          env,
          cols: 100,
          rows: 23,
        });
        const attachPromise = runAttach(
          "h2a-codex",
          {
            connect: () => NativeTerminalClient.connect(sock2),
            stdin: bridge.stdin as unknown as NodeJS.ReadStream,
            stdout: bridge.stdout as unknown as NodeJS.WriteStream,
            now: () => Date.now(),
            delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
            onResize: () => {},
            offResize: () => {},
            onTerminate: (fn: () => void) => { termFn = fn; },
            offTerminate: () => { termFn = undefined; },
          } as unknown as NativeTerminalAttachRuntime,
          { statusBar: { enabled: true, env }, rightPanel: false },
        );
        await waitUntil(() => bridge.getOutput().includes("CX="), 4000, "codex CPR");
        bridge.stdin.write("\x1b");
        await waitUntil(() => bridge.getOutput().includes("GOT_ESC|"), 4000, "codex single ESC");
        expect(bridge.getOutput()).toContain('CX="\\u001b[5;12R"');
        expect(bridge.getOutput()).not.toContain('1;1R');
        termFn?.();
        await attachPromise;
      } finally {
        bridge.term.dispose();
        await host.forceStopAll().catch(() => {});
        await server.close({ stopSessions: true }).catch(() => {});
      }
    }
    await waitForPrivateNativeProcesses(env);
  });

  it("Test 3 (Gemini twin): single live CPR (4,2) and zero 1;2c / >| / >4;?m leak on delayed reattach", async () => {
    const dir = createPrivateTestDirectory("pty18-gemini");
    const env = cleanChildEnv(nativeTestEnvironment(dir));
    const socketPath = join(dir, "host.sock");
    const registryPath = join(dir, "registry.json");
    const host = new NativeTerminalHost({
      generation: "func-gemini",
      replayBytesPerSession: 65536,
      spawner: nodePtySpawner,
      registryPath,
      socketPath,
    });
    const server = await startNativeTerminalHostServer({ socketPath, host });

    // Pre-attach session emitting DA1, XTVERSION, XTQMODKEYS, DSR before attach connects,
    // then waiting on live stdin to verify ZERO leaked query responses on attach and single live CPR.
    const geminiTwin = [
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'let received = "";',
      'process.stdin.on("data", (d) => {',
      '  received += d.toString("utf8");',
      '  if (received.includes("PING")) {',
      '    process.stdout.write("LIVE_ASK\\x1b[4;2H\\x1b[6n");',
      '  }',
      '  if (received.includes("R")) {',
      '    process.stdout.write("STDIN_JSON=" + JSON.stringify(received) + "|");',
      '  }',
      '});',
      'process.stdout.write("\\x1b[c\\x1b[>0q\\x1b[>4;?m\\x1b[6nPRE_GEM_READY");',
      'setInterval(() => {}, 1000);',
    ].join(" ");

    const bridge = makeFakeTtyBridge(100, 24);
    let termFn: (() => void) | undefined;
    try {
      host.create({
        id: "h2a-gemini",
        command: process.execPath,
        args: ["-e", geminiTwin],
        cwd: dir,
        env,
        cols: 100,
        rows: 23,
      });
      await waitUntil(
        () => host.readOutput("h2a-gemini", 0).chunks.some((c) => c.data.includes("PRE_GEM_READY")),
        4000,
        "gemini pre-attach output in replay",
      );

      const attachPromise = runAttach(
        "h2a-gemini",
        {
          connect: () => NativeTerminalClient.connect(socketPath),
          stdin: bridge.stdin as unknown as NodeJS.ReadStream,
          stdout: bridge.stdout as unknown as NodeJS.WriteStream,
          now: () => Date.now(),
          delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
          onResize: () => {},
          offResize: () => {},
          onTerminate: (fn: () => void) => { termFn = fn; },
          offTerminate: () => { termFn = undefined; },
        } as unknown as NativeTerminalAttachRuntime,
        { statusBar: { enabled: true, env }, rightPanel: false },
      );

      await waitUntil(() => bridge.getOutput().includes("PRE_GEM_READY"), 4000, "gemini replay shown");
      // Mark start of post-attach stdin stream, then trigger live DSR query
      bridge.stdin.write("MARK_ATTACH:PING");
      await waitUntil(() => bridge.getOutput().includes("STDIN_JSON="), 4000, "gemini live CPR JSON");

      const out = bridge.getOutput();
      const match = /STDIN_JSON=("[^"]*")/.exec(out);
      expect(match?.[1]).toBeDefined();
      const seenByChild = JSON.parse(match![1]!) as string;
      const postAttach = seenByChild.slice(seenByChild.indexOf("MARK_ATTACH:"));
      expect(seenByChild).not.toContain("1;2c");
      expect(seenByChild).not.toContain(">|");
      expect(seenByChild).not.toContain(">4");
      expect(postAttach).not.toContain("1;2c");
      expect(postAttach).not.toContain(">|");
      expect(postAttach).not.toContain("\x1b[1;1R");
      expect(postAttach).toContain("\x1b[4;2R");
      termFn?.();
      await attachPromise;
    } finally {
      bridge.term.dispose();
      await host.forceStopAll().catch(() => {});
      await server.close({ stopSessions: true }).catch(() => {});
    }
    await waitForPrivateNativeProcesses(env);
  });

  it("Test 4: mute terminal (<= 3 reads), detach mid-query flush, and Station switch replay filtering + promotion", async () => {
    const dir = createPrivateTestDirectory("pty18-mute-switch");
    const env = cleanChildEnv(nativeTestEnvironment(dir));
    const socketPath = join(dir, "host.sock");
    const registryPath = join(dir, "registry.json");
    const host = new NativeTerminalHost({
      generation: "func-mute",
      replayBytesPerSession: 65536,
      spawner: nodePtySpawner,
      registryPath,
      socketPath,
      // Intentionally huge timer so ONLY poll-count & release paths can unblock in test!
      dsrFallbackTimeoutMs: 60_000,
    });
    const server = await startNativeTerminalHostServer({ socketPath, host });

    try {
      // 4a: Mute client resolves within <= 3 post-delivery reads (no waiting for 60s timer)
      const twin = [
        'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
        'process.stdin.on("data", (d) => process.stdout.write("GOT=" + JSON.stringify(d.toString("utf8")) + "|"));',
        'process.stdout.write("\\x1b[6n");',
        'setInterval(() => {}, 1000);',
      ].join(" ");
      host.create({ id: "h2a-mute", command: process.execPath, args: ["-e", twin], cwd: dir, env, cols: 80, rows: 24 });
      const client = await NativeTerminalClient.connect(socketPath);
      const lease = await client.acquireController("h2a-mute", "mute-c", "human", { terminalResponder: true });
      await waitUntil(
        () => host.readOutput("h2a-mute", 0).chunks.some((c) => c.data.includes("\x1b[6n")),
        4000,
        "mute query emitted",
      );
      const first = await client.readOutput("h2a-mute", 0);
      await client.readOutput("h2a-mute", first.latestSeq);
      await client.readOutput("h2a-mute", first.latestSeq);
      await client.readOutput("h2a-mute", first.latestSeq);
      await waitUntil(
        () => host.readOutput("h2a-mute", first.latestSeq).chunks.some((c) => c.data.includes('GOT="\\u001b[1;1R"')),
        4000,
        "mute resolved after 3 reads",
      );
      await client.releaseController(lease);
      client.close();

      // 4b: Detach mid-query immediately unblocks twin
      host.create({ id: "h2a-mid", command: process.execPath, args: ["-e", twin], cwd: dir, env, cols: 80, rows: 24 });
      const c2 = await NativeTerminalClient.connect(socketPath);
      const l2 = await c2.acquireController("h2a-mid", "mid-c", "human", { terminalResponder: true });
      await waitUntil(
        () => host.readOutput("h2a-mid", 0).chunks.some((c) => c.data.includes("\x1b[6n")),
        4000,
        "mid-query emitted",
      );
      await c2.releaseController(l2);
      await waitUntil(
        () => host.readOutput("h2a-mid", 0).chunks.some((c) => c.data.includes('GOT="\\u001b[1;1R"')),
        4000,
        "detach mid-query flush",
      );
      c2.close();

      // 4c: Station switch filters pre-switch catch-up and promotes target responder for live DSR
      const twinB = [
        'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
        'let seen = "";',
        'process.stdin.on("data", (d) => {',
        '  seen += d.toString("utf8");',
        '  if (seen.includes("ASK_B")) process.stdout.write("\\x1b[7;5H\\x1b[6n");',
        '  if (seen.includes("R")) process.stdout.write("B_RES=" + JSON.stringify(seen) + "|");',
        '});',
        'process.stdout.write("\\x1b[c\\x1b[>4;?mB_PRE");',
        'setInterval(() => {}, 1000);',
      ].join(" ");
      host.create({ id: "h2a-swB", command: process.execPath, args: ["-e", twinB], cwd: dir, env, cols: 80, rows: 24 });
      await waitUntil(
        () => host.readOutput("h2a-swB", 0).chunks.some((c) => c.data.includes("B_PRE")),
        4000,
        "B pre-switch bytes",
      );
      const bridge = makeFakeTtyBridge(120, 30);
      let terminateCb: (() => void) | undefined;
      const stationClient = await NativeTerminalClient.connect(socketPath);
      const rt: StationRuntime = {
        stdin: bridge.stdin as unknown as NodeJS.ReadStream,
        stdout: bridge.stdout as unknown as NodeJS.WriteStream,
        now: () => Date.now(),
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        onResize: () => {},
        offResize: () => {},
        onTerminate: (fn) => { terminateCb = fn; },
        offTerminate: () => { terminateCb = undefined; },
        endpoints: () => [socketPath],
        connect: async () => await NativeTerminalClient.connect(socketPath),
        execH2a: async () => ({ ok: true, stdout: "{}" }),
      };
      const mkBar = (sessionId: string) =>
        createNativeStatusBar(
          sessionId,
          bridge.stdout as unknown as NodeJS.WriteStream,
          () => Date.now(),
          { enabled: false, env },
        );
      const stPromise = runStation(rt, {
        createStatusBar: mkBar,
        statePath: join(dir, "station-state.json"),
        locale: "en",
        tty: "/dev/pts/8",
        pid: process.pid,
        panel: {
          width: 30,
          refreshIntervalMs: 500,
          loadSnapshot: async () =>
            buildRightPanelSnapshot({
              currentSessionId: "h2a-swB",
              groups: [{ title: "core", sessions: [{ id: "h2a-swB", label: "swB", status: "running" }] }],
              decisions: [],
            }),
        },
      });
      await waitUntil(() => bridge.getOutput().includes("B_PRE"), 4000, "station displayed B");
      bridge.stdin.write("ASK_B");
      await waitUntil(() => bridge.getOutput().includes("B_RES="), 4000, "station live B CPR");
      const m = /B_RES=("[^"]*")/.exec(bridge.getOutput());
      expect(m?.[1]).toBeDefined();
      const bSeen = JSON.parse(m![1]!) as string;
      expect(bSeen).not.toContain("1;2c");
      expect(bSeen).not.toContain("\x1b[1;1R");
      expect(bSeen).toContain("\x1b[7;5R");
      terminateCb?.();
      await stPromise;
      stationClient.close();
      bridge.term.dispose();
    } finally {
      await host.forceStopAll().catch(() => {});
      await server.close({ stopSessions: true }).catch(() => {});
    }
    await waitForPrivateNativeProcesses(env);
  });

  it("Test 5 & 6: real PTY -opost + SIGKILL guard recovery, SIGTSTP/SIGCONT suspend-resume, and concurrent baseline preservation", async () => {
    const dir = createPrivateTestDirectory("pty18-tty-rec");
    const env = cleanChildEnv(nativeTestEnvironment(dir));

    // 6a & 6b: Real outer master PTY -> child enters raw/-opost + suspend handlers
    const childCode = `
      import {
        CLIENT_TERMINAL_RESET_SEQUENCE,
        enterRawOutputTty,
        installTtySuspendHandlers,
        restoreTtyState,
      } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "terminal-reset.js")}`).href)};
      import { publishAttachReset } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "native-terminal/attach-recovery.js")}`).href)};
      publishAttachReset(CLIENT_TERMINAL_RESET_SEQUENCE);
      const state = enterRawOutputTty(process.stdin, process.stdout);
      let resumes = 0;
      const uninstall = installTtySuspendHandlers({
        state,
        stdin: process.stdin,
        stdout: process.stdout,
        afterResume: () => {
          resumes += 1;
          process.stdout.write("RESUMED:" + resumes + "\\x1b[?1004h");
        },
      });
      process.stdout.write("\\x1b[?1004hREADY_TTY");
      const done = () => {
        uninstall();
        restoreTtyState(state, process.stdin, () => {
          process.stdout.write(CLIENT_TERMINAL_RESET_SEQUENCE);
          publishAttachReset("");
        });
        process.exit(0);
      };
      process.on("SIGTERM", done);
      setInterval(() => {}, 1000);
    `;

    // Guard wrapper + job-control bash shell (non-session-leader pgid so kernel accepts real SIGTSTP)
    const childFile = join(dir, "tty-child.mjs");
    const guardFile = join(dir, "tty-guard.mjs");
    writeFileSync(childFile, childCode);
    writeFileSync(
      guardFile,
      `
        import { spawnSync } from "node:child_process";
        import { withAttachTerminalRecovery } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "native-terminal/attach-recovery.js")}`).href)};
        withAttachTerminalRecovery((guardEnv) => {
          const res = spawnSync(process.execPath, [${JSON.stringify(childFile)}], {
            stdio: "inherit",
            env: guardEnv,
          });
          process.stdout.write("GUARD_DONE:" + (res.signal ?? res.status) + "\\n");
        });
      `,
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const outerPty = nodePtySpawner({
      command: "bash",
      args: ["--norc", "--noprofile", "--noediting", "-i"],
      cwd: dir,
      env: { ...env, PS1: "T5_SH> " },
      cols: 80,
      rows: 24,
    });
    let out = "";
    outerPty.onData((d) => { out += d; });

    const shellPromptRe = /(?:T5_SH>|bash-[^$]*\$) /;
    try {
      await waitUntil(() => shellPromptRe.test(out), 4000, "shell prompt1");
      outerPty.write(`${JSON.stringify(process.execPath)} ${JSON.stringify(guardFile)}\r`);
      await waitUntil(() => out.includes("READY_TTY"), 5000, "child READY_TTY");
      const outerPts = readlinkSync(`/proc/${outerPty.pid}/fd/1`);
      const activeStty = sttyFlagsForPts(outerPts);
      expect(activeStty).toMatch(/(?:^|\s)-opost(?:\s|$)/);
      expect(activeStty).toMatch(/(?:^|\s)-icanon(?:\s|$)/);

      // Find guard (running guardFile) and inner child (ppid === guard.pid)
      const findTree = () => {
        const psOut = execFileSync("ps", ["-eo", "pid,ppid,pgid,args"], { encoding: "utf8" });
        const rows: Array<{ pid: number; ppid: number; pgid: number; args: string }> = [];
        for (const line of psOut.split("\n")) {
          const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), args: m[4] ?? "" });
        }
        const guard = rows.find((r) => r.args.includes(guardFile) && r.pid !== process.pid);
        const child = guard ? rows.find((r) => r.ppid === guard.pid) : undefined;
        return { guard, child };
      };
      let tree: {
        guard?: { pid: number; ppid: number; pgid: number } | undefined;
        child?: { pid: number; ppid: number; pgid: number } | undefined;
      } = {};
      await waitUntil(() => {
        tree = findTree();
        return Boolean(tree.guard && tree.child);
      }, 4000, "guard+child process tree");
      const guard = tree.guard!;
      const innerPid = tree.child!.pid;

      // SIGTSTP stops inner job cleanly & restores opost/icanon/echo while paused in shell
      process.kill(-guard.pgid, "SIGTSTP");
      await waitUntil(() => {
        try {
          const stat = readFileSync(`/proc/${innerPid}/stat`, "utf8");
          const closeIdx = stat.lastIndexOf(") ");
          return closeIdx >= 0 && stat[closeIdx + 2] === "T";
        } catch {
          return false;
        }
      }, 4000, "child stopped in T state");
      await waitUntil(() => shellPromptRe.test(out.slice(out.indexOf("READY_TTY"))), 4000, "shell prompt2");
      const stoppedStty = sttyFlagsForPts(outerPts);
      expect(stoppedStty).toMatch(/(?:^|\s)opost(?:\s|$)/);
      expect(stoppedStty).toMatch(/(?:^|\s)onlcr(?:\s|$)/);
      expect(stoppedStty).toMatch(/(?:^|\s)icanon(?:\s|$)/);
      expect(stoppedStty).toMatch(/(?:^|\s)echo(?:\s|$)/);

      // `fg` resumes job -> re-applies raw & -opost
      outerPty.write("fg\r");
      await waitUntil(() => out.includes("RESUMED:1"), 4000, "child resumed on fg");
      const resumedStty = sttyFlagsForPts(outerPts);
      expect(resumedStty).toMatch(/(?:^|\s)-opost(?:\s|$)/);

      // Now uncatchable SIGKILL on innerPid: guard recovers -opost + icanon + echo + VT reset!
      process.kill(innerPid, "SIGKILL");
      await waitUntil(() => out.includes("GUARD_DONE:SIGKILL"), 5000, "guard recovered after SIGKILL");
      expect(out.slice(out.indexOf("RESUMED:1"))).toContain("\x1b[?1004l");
      const recoveredStty = sttyFlagsForPts(outerPts);
      expect(recoveredStty).toMatch(/(?:^|\s)opost(?:\s|$)/);
      expect(recoveredStty).toMatch(/(?:^|\s)onlcr(?:\s|$)/);
      expect(recoveredStty).toMatch(/(?:^|\s)icanon(?:\s|$)/);
      expect(recoveredStty).toMatch(/(?:^|\s)echo(?:\s|$)/);
    } finally {
      try { outerPty.kill("SIGKILL"); } catch {}
    }

    // 6c: Concurrent holders sharing real baseline S0 on a real PTY device
    const concPty = nodePtySpawner({
      command: process.execPath,
      args: [
        "-e",
        `setInterval(() => {}, 1000);`,
      ],
      cwd: dir,
      env,
      cols: 80,
      rows: 24,
    });
    try {
      // Wait for node-pty child to bind slave pts
      let slavePts = "";
      await waitUntil(() => {
        try {
          const p = readlinkSync(`/proc/${concPty.pid}/fd/0`);
          if (p.startsWith("/dev/pts/")) {
            slavePts = p;
            return true;
          }
        } catch {}
        return false;
      }, 4000, "concurrent slave pts");

      const { openSync, closeSync } = await import("node:fs");
      const fd = openSync(slavePts, "r+");
      try {
        const reg = new TtyBaselineRegistry({ runtimeDir: dir });
        const fakeIn = {
          isTTY: true,
          isRaw: false,
          fd,
          setRawMode: () => fakeIn,
        } as unknown as NodeJS.ReadStream;
        const fakeOut = { isTTY: true, fd };
        const st1 = enterRawOutputTty(fakeIn, fakeOut, { registry: reg, role: "active" });
        expect(sttyFlagsForPts(slavePts)).toMatch(/(?:^|\s)-opost(?:\s|$)/);
        // Second concurrent holder enters while tty already -opost -> must inherit original S0!
        const st2 = enterRawOutputTty(fakeIn, fakeOut, { registry: reg, role: "active" });
        expect(st2.saved?.stdout?.toString()).toBe(st1.saved?.stdout?.toString());

        // Releasing st1 while st2 alive keeps -opost intact
        let r1Reset = 0;
        restoreTtyState(st1, fakeIn, () => { r1Reset += 1; });
        expect(r1Reset).toBe(0);
        expect(sttyFlagsForPts(slavePts)).toMatch(/(?:^|\s)-opost(?:\s|$)/);

        // Releasing st2 last restores opost & runs reset
        let r2Reset = 0;
        restoreTtyState(st2, fakeIn, () => { r2Reset += 1; });
        expect(r2Reset).toBe(1);
        expect(sttyFlagsForPts(slavePts)).toMatch(/(?:^|\s)opost(?:\s|$)/);
      } finally {
        closeSync(fd);
      }
    } finally {
      try { concPty.kill("SIGKILL"); } catch {}
    }

    // 6d: CLI subprocess guard recovery (`attach` HTTP SSE + `withClientTerminalRecoverySubprocess` over real PTY)
    const { createServer } = await import("node:http");
    const sseSockets = new Set<import("node:net").Socket>();
    const httpServer = createServer((req, res) => {
      if (req.url === "/sessions/s-cli/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: terminal.output\ndata: ${JSON.stringify({ type: "terminal.output", payload: { data: "CLI_ATTACH_READY" } })}\n\n`);
        if (res.socket) sseSockets.add(res.socket);
        return;
      }
      res.writeHead(202, { "content-type": "application/json" });
      res.end('{"accepted":true}');
    });
    await new Promise<void>((resolveListen) => httpServer.listen(0, "127.0.0.1", resolveListen));
    const addr = httpServer.address() as { port: number };
    const runner6d = join(dir, "cli-attach-6d.mjs");
    writeFileSync(
      runner6d,
      `
        import { attach } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "attach.js")}`).href)};
        import { runRemoteAttachInRecoverySubprocess } from ${JSON.stringify(new URL(`file://${join(RUNTIME_DIST, "native-terminal/attach-recovery.js")}`).href)};
        const code = await runRemoteAttachInRecoverySubprocess(
          async () => {
            const s = await attach({ baseUrl: ${JSON.stringify(`http://127.0.0.1:${addr.port}`)}, sessionId: "s-cli" });
            await s.finished;
          },
          { baseUrl: ${JSON.stringify(`http://127.0.0.1:${addr.port}`)}, sessionId: "s-cli" },
        );
        process.stdout.write("CLI_REC_EXIT:" + String(code ?? 0));
      `,
    );
    const cliPty = nodePtySpawner({
      command: process.execPath,
      args: [runner6d],
      cwd: dir,
      env,
      cols: 80,
      rows: 24,
    });
    let cliOut = "";
    let cliExited = false;
    cliPty.onData((d) => { cliOut += d; });
    cliPty.onExit(() => { cliExited = true; });
    try {
      await waitUntil(() => cliOut.includes("CLI_ATTACH_READY"), 5000, "cli attach ready");
      const cliPts = readlinkSync(`/proc/${cliPty.pid}/fd/1`);
      expect(sttyFlagsForPts(cliPts)).toMatch(/(?:^|\s)-opost(?:\s|$)/);
      const findCliChildPid = (): number | undefined => {
        const psText = execFileSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" });
        const rows: Array<{ pid: number; ppid: number; args: string }> = [];
        for (const line of psText.split("\n")) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] ?? "" });
        }
        const guard = rows.find((r) => r.args.includes(runner6d) && r.pid !== process.pid);
        return guard ? rows.find((r) => r.ppid === guard.pid)?.pid : undefined;
      };
      let innerAttachPid: number | undefined;
      await waitUntil(() => (innerAttachPid = findCliChildPid()) !== undefined, 3000, "cli child pid");
      expect(innerAttachPid).toBeGreaterThan(0);
      process.kill(innerAttachPid!, "SIGKILL");
      await waitUntil(() => cliExited && cliOut.includes("CLI_REC_EXIT:"), 5000, "cli guard exit after SIGKILL");
      const afterCliKill = sttyFlagsForPts(cliPts);
      expect(afterCliKill).toMatch(/(?:^|\s)opost(?:\s|$)/);
      expect(afterCliKill).toMatch(/(?:^|\s)onlcr(?:\s|$)/);
      expect(afterCliKill).toMatch(/(?:^|\s)icanon(?:\s|$)/);
      expect(cliOut.slice(cliOut.indexOf("CLI_ATTACH_READY"))).toContain("\x1b[?1004l");
    } finally {
      try { cliPty.kill("SIGKILL"); } catch {}
      for (const s of sseSockets) s.destroy();
      await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
    }
    const cliRunOut = spawnSync(
      process.execPath,
      [H2A_BIN, "--version"],
      { encoding: "utf8", env: { ...env, PATH: `${dirname(process.execPath)}:${env.PATH ?? "/usr/bin:/bin"}` } },
    );
    expect(cliRunOut.status).toBe(0);
    await waitForPrivateNativeProcesses(env);
  }, 30_000);
});

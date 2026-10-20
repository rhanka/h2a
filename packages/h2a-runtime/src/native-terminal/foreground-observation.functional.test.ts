/**
 * Round-2 (code-review sol-3): the host foreground observation must follow
 * the terminal's real foreground process group — not the session leader's
 * own group. In an interactive Bash with job control, a foreground job runs
 * in its own process group; enumerating the leader's (shell's) group sees
 * only Bash while the live agent CLI sits in its own group, so D1 concludes
 * shell/needs-adapter and the native owner guard cannot recognise the
 * writer. Real PTY + real interactive Bash + a foreground fixture whose
 * argv[0] is `codex` carrying a conversation id.
 */
import { isolatedNativeTestEnvironment, spawnIsolatedNative as spawn, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);

import type { ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { NativeTerminalClient } from "./client.js";

const entry = fileURLToPath(new URL("./process.ts", import.meta.url));

const children = new Set<ChildProcess>();
const directories = new Set<string>();

afterEach(async () => {
  for (const child of [...children]) {
    children.delete(child);
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  const { rm } = await import("node:fs/promises");
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function eventually<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (accept(last)) return last;
    if (Date.now() >= until) {
      throw new Error(`${label}: deadline expired; last=${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(process.platform !== "linux")("round-2 sol-3: foreground follows the terminal foreground group", () => {
  it("observes a foreground job in its own process group, not only its shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "r2-fg-tpgid-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    process.env.H2A_NATIVE_SOCKET = socketPath;
    const sessionId = "r2-fg-tpgid";
    const convId = "conv-tpgid-1";

    const host = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        entry,
        "--socket",
        socketPath,
        "--generation",
        "r2-fg-tpgid",
        "--replay-bytes",
        String(1024 * 1024),
        "--registry-path",
        join(directory, "host-registry.json"),
      ],
      { cwd: dirname(entry), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.add(host);
    try {
      const { NativeTerminalClient } = (await import("./client.js")) as {
        NativeTerminalClient: new (...args: never[]) => NativeTerminalClient;
      };
      const connect = (
        NativeTerminalClient as unknown as {
          connect(socket: string): Promise<NativeTerminalClient>;
        }
      ).connect;
      const client = await eventually(
        async () => {
          try {
            return await connect(socketPath);
          } catch {
            return undefined;
          }
        },
        (value) => value !== undefined,
        "native host connect",
      );
      try {
        await client.create({
          id: sessionId,
          command: "/bin/bash",
          args: ["--noprofile", "--norc", "-i"],
          cwd: directory,
          env: isolatedNativeTestEnvironment({
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            TERM: "xterm-256color",
            PS1: "r2prompt$ ",
          }),
          cols: 120,
          rows: 30,
        });
        const driver = await client.acquireController(sessionId, "r2-fg-driver", "automation");
        // Readiness is proven by a round trip, never by prompt text (the
        // default prompt varies by build; env PS1 is not honored here).
        await client.write(driver, `echo r2bash-ready\r`);
        await eventually(
          () => client.readOutput(sessionId, 0),
          (replay) => replay.chunks.some((chunk) => chunk.data.includes("r2bash-ready")),
          "interactive bash ready",
        );
        // A foreground job under job control: its own process group, the
        // terminal's foreground. argv[0] is `codex` carrying a conversation.
        await client.write(
          driver,
          `(echo r2-fg-ready; exec -a codex /bin/sh -c 'sleep 30' codex-sh ${convId})\r`,
        );
        await eventually(
          () => client.readOutput(sessionId, 0),
          (replay) => replay.chunks.some((chunk) => chunk.data.includes("r2-fg-ready")),
          "foreground job started",
        );
        // The exec above replaced the subshell a moment after the marker.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const state = await client.state(sessionId);
        const foreground = state.foregroundProcesses ?? [];
        const names = foreground.map((member) => member.command.split("/").pop());
        expect(names).toContain("codex");
        const codex = foreground.filter((member) => member.command.split("/").pop() === "codex");
        expect(codex.length).toBeGreaterThan(0);
        expect(codex.some((member) => member.args.includes(convId))).toBe(true);
        await client.releaseController(driver);
      } finally {
        client.close();
      }
    } finally {
      if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
      else process.env.H2A_NATIVE_SOCKET = previousSocket;
    }
  }, 60_000);
});

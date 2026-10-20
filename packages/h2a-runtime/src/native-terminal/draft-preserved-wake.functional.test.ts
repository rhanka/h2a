/**
 * Round-2 P1 (code-review astra-1/sol-1): a wake must reach an attached
 * recipient whose composer holds an idle human draft — without typing over
 * the human. Real native PTY + real Node readline (the lab's TUI shape):
 * the draft is typed through the held human lease and never submitted, the
 * activity window expires, then op `drive` delivers the signed wake line.
 * Settled state: exactly one new submitted line (the wake), the draft
 * byte-identical, the human window still attached and accepting input.
 */
import { isolatedNativeTestEnvironment, spawnIsolatedNative as spawn, spawnSyncIsolatedNative as spawnSync, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);

import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { NativeTerminalClient } from "./client.js";

const entry = fileURLToPath(new URL("./process.ts", import.meta.url));
const opEntry = fileURLToPath(new URL("./op.ts", import.meta.url));

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

const READLINE_FIXTURE = `import { createInterface } from 'node:readline';
import { writeFileSync, renameSync } from 'node:fs';
const state = process.argv[2];
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const lines = [];
const persist = () => { writeFileSync(state + '.tmp', JSON.stringify({ pid: process.pid, draft: rl.line, lines })); renameSync(state + '.tmp', state); };
rl.on('line', line => { lines.push(line); rl.prompt(); setImmediate(persist); });
process.stdin.on('data', () => setImmediate(persist));
rl.setPrompt('lab-fixture> '); rl.prompt(); persist();
`;

describe.skipIf(process.platform !== "linux")("round-2 P1: wake an attached readline composer holding an idle draft", () => {
  it("delivers the wake on its own line with the human draft intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "r2-wake-draft-"));
    directories.add(directory);
    const socketPath = join(directory, "host.sock");
    const previousSocket = process.env.H2A_NATIVE_SOCKET;
    const previousActivityWindow = process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
    process.env.H2A_NATIVE_SOCKET = socketPath;
    // Short, fixture-only activity window: the draft below is idle long
    // before the drive runs, so only the composition gate is exercised.
    process.env.H2A_WAKE_DEFER_ACTIVITY_MS = "300";
    const sessionId = "r2-wake-draft";
    const fixturePath = join(directory, "readline-fixture.mjs");
    const statePath = join(directory, "readline-state.json");
    await writeFile(fixturePath, READLINE_FIXTURE, "utf8");

    const host = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        entry,
        "--socket",
        socketPath,
        "--generation",
        "r2-wake-draft",
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
      const client = (await eventually(
        async () => {
          try {
            return await (
              NativeTerminalClient as unknown as {
                connect(socket: string): Promise<NativeTerminalClient>;
              }
            ).connect(socketPath);
          } catch {
            return undefined;
          }
        },
        (value) => value !== undefined,
        "native host connect",
      )) as NativeTerminalClient;
      try {
        await client.create({
          id: sessionId,
          command: process.execPath,
          args: [fixturePath, statePath],
          cwd: directory,
          env: isolatedNativeTestEnvironment({
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            TERM: "xterm-256color",
          }),
          cols: 120,
          rows: 30,
        });
        const readState = async (): Promise<{ draft: string; lines: string[] } | undefined> => {
          try {
            return JSON.parse(await readFile(statePath, "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
          }
        };
        await eventually(() => readState(), (state) => state !== undefined && state.draft === "", "readline ready");

        // The human window attaches and stays attached for the whole case.
        const humanLease = await client.acquireController(sessionId, "r2-human-window", "human");
        const draft = "human draft with spaces";
        await client.write(humanLease, draft);
        await eventually(() => readState(), (state) => state !== undefined && state.draft === draft, "human draft typed");
        // Let the (short, fixture-only) activity window expire with the
        // draft still unsubmitted: an expired timer alone never proves an
        // empty composer — the drive below must preserve it, not submit it.
        await new Promise((resolve) => setTimeout(resolve, 700));

        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            opEntry,
            "drive",
            "--id",
            sessionId,
            "--b64",
            Buffer.from("[h2a-wake r2-draft]", "utf8").toString("base64"),
            "--request-id",
            "r2-wake-draft-1",
          ],
          { cwd: dirname(opEntry), env: process.env, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        const payload = JSON.parse(String(result.stdout).trim().split("\n").at(-1)) as {
          outcome: string;
        };
        expect(payload.outcome).toBe("driven");

        const settled = await eventually(
          () => readState(),
          (state) => state !== undefined && state.lines.some((line) => line.includes("h2a-wake")),
          "wake line submitted",
        );
        expect(settled).toBeDefined();
        expect(settled!.lines).toHaveLength(1);
        expect(settled!.lines[0]).toContain("[h2a-wake r2-draft]");
        expect(settled!.lines.every((line) => !line.includes(draft))).toBe(true);
        expect(settled!.draft).toBe(draft);
        expect((await client.state(sessionId)).controlled).toBe(true);
        // The original human window still accepts input afterwards.
        await client.write(humanLease, "x\x7f");
        await eventually(() => readState(), (state) => state !== undefined && state.draft === draft, "window usable");
        await client.releaseController(humanLease);
      } finally {
        client.close();
      }
    } finally {
      if (previousSocket === undefined) delete process.env.H2A_NATIVE_SOCKET;
      else process.env.H2A_NATIVE_SOCKET = previousSocket;
      if (previousActivityWindow === undefined) delete process.env.H2A_WAKE_DEFER_ACTIVITY_MS;
      else process.env.H2A_WAKE_DEFER_ACTIVITY_MS = previousActivityWindow;
    }
  }, 60_000);
});

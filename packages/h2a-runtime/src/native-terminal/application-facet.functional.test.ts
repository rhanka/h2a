import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { nodePtySpawner } from "../pty.js";
import { LOCAL_WRAPPER } from "../tmux.js";
import { NativeTerminalClient } from "./client.js";
import { NativeTerminalHost } from "./host.js";
import { startNativeTerminalHostServer } from "./server.js";

const fixtureCli = `
  printf 'CLI ready\\n'
  IFS= read -r command
  set -m
  /bin/bash -c 'printf "editor ready\\n"; IFS= read -r line; printf "editor got <%s>\\n" "$line"'
  printf 'CLI returned\\n'
  IFS= read -r command
`;
const fixtureShellPrompt = "[[facet-shell-ready]] ";

it("observes a real foreground editor, CLI and persistent shell in one PTY", async () => {
  const directory = await mkdtemp(join(tmpdir(), "facet-"));
  const host = new NativeTerminalHost({
    generation: "fixture-generation",
    registryPath: join(directory, "registry.json"),
    replayBytesPerSession: 4096,
    spawner: nodePtySpawner,
  });
  const socketPath = join(directory, "host.sock");
  const server = await startNativeTerminalHostServer({ host, socketPath });
  const foregroundChanged = vi.fn<Parameters<NativeTerminalHost["onApplicationForegroundChange"]>[0]>();
  const unsubscribe = host.onApplicationForegroundChange(foregroundChanged);
  try {
    const client = await NativeTerminalClient.connect(socketPath);
    try {
      const initial = await client.create({
        id: "fixture",
        command: "/bin/bash",
        args: ["-c", LOCAL_WRAPPER, "fixture-relaunch", "/bin/bash", "-c", fixtureCli],
        cwd: directory,
        env: { HOME: directory, PATH: "/usr/bin:/bin", PS1: "> ", PS2: "continue> " },
        cols: 80,
        rows: 24,
      });
      const output = async () => (await client.readOutput("fixture", 0)).chunks
        .map((chunk) => chunk.data).join("");
      const waitForOutput = (needle: string) =>
        vi.waitFor(async () => expect(await output()).toContain(needle));
      const lease = await client.acquireController("fixture", "fixture-controller");
      await waitForOutput("CLI ready");
      if (process.platform !== "linux") {
        expect(await client.state("fixture")).toMatchObject({ applicationFacet: "unknown" });
        return;
      }
      const cli = await client.state("fixture");
      await client.write(lease, "edit\r");
      // This transition must reach a host observer before any state RPC.
      await vi.waitFor(() => expect(foregroundChanged).toHaveBeenCalledWith(expect.objectContaining({
        id: "fixture",
        generation: initial.generation,
        incarnation: initial.incarnation,
        applicationFacet: "other",
        applicationIncarnation: cli.applicationIncarnation,
        foregroundProcessGroup: expect.any(Number),
      })));
      await waitForOutput("editor ready");
      const editor = await client.state("fixture");
      await client.write(lease, "fixture keystrokes\r");
      await waitForOutput("editor got <fixture keystrokes>");
      await waitForOutput("CLI returned");
      const returned = await client.state("fixture");
      await client.write(lease, "exit fixture\r");
      await waitForOutput("shell on");
      await client.write(lease, `unset IGNOREEOF; PS1='${fixtureShellPrompt}'; printf 'shell available\\n'\r`);
      await waitForOutput("shell available\r\n");
      await vi.waitFor(async () => expect(await output()).toMatch(/\[\[facet-shell-ready\]\] $/));
      const shell = await client.state("fixture");

      expect(shell).toMatchObject({
        applicationFacet: "shell",
        applicationIncarnation: null,
        pid: initial.pid,
        generation: initial.generation,
        incarnation: initial.incarnation,
        status: "running",
      });
      expect(cli).toMatchObject({
        applicationFacet: "cli",
        applicationIncarnation: expect.any(String),
        foregroundProcessGroup: expect.any(Number),
      });
      expect(Reflect.get(cli, "applicationIncarnation")).not.toBe(cli.incarnation);
      expect(Reflect.get(cli, "applicationIncarnation")).not.toBe(cli.generation);
      expect(await client.ping()).toMatchObject({ applicationFacetVersion: 1 });
      expect(editor).toMatchObject({
        applicationFacet: "other",
        applicationIncarnation: Reflect.get(cli, "applicationIncarnation"),
        foregroundProcessGroup: expect.any(Number),
      });
      expect(Reflect.get(editor, "foregroundProcessGroup")).not.toBe(Reflect.get(cli, "foregroundProcessGroup"));
      expect(returned).toMatchObject({
        applicationFacet: "cli",
        applicationIncarnation: Reflect.get(cli, "applicationIncarnation"),
      });
      await client.write(lease, "printf '%s\\n' 'partial");
      expect(await client.state("fixture")).toMatchObject({ applicationFacet: "shell" });
      await client.write(lease, "\rcontinued'\r");
      await waitForOutput("continued\r\n");
      await client.write(lease, "/bin/bash -c 'printf \"manual CLI ready\\n\"; read -r command'\r");
      await waitForOutput("manual CLI ready\r\n");
      await vi.waitFor(async () => expect(await client.state("fixture")).toMatchObject({
        applicationFacet: "unknown",
      }));
      await client.write(lease, "exit fixture\r");
      await vi.waitFor(async () => expect(await output()).toMatch(/\[\[facet-shell-ready\]\] $/));
      expect(await client.state("fixture")).toMatchObject({ applicationFacet: "shell" });
      await client.write(lease, "\x04");
      await vi.waitFor(async () => expect(await client.state("fixture")).toMatchObject({
        status: "exited",
        applicationFacet: "unknown",
      }));
    } finally {
      client.close();
    }
  } finally {
    unsubscribe();
    await server.close({ stopSessions: true });
    await rm(directory, { recursive: true, force: true });
  }
});

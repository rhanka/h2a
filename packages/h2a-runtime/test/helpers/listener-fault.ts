import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";
// @ts-ignore Test-only shared qualification helper.
import { createPrivateTestDirectory } from "../../../h2a/test/helpers/native-isolation.js";
import { NativeTerminalClient } from "../../src/native-terminal/client.js";

export async function assertListenerFaultExit(codes: Array<string | null>, exitCode: number, counter: string): Promise<void> {
  const directory = createPrivateTestDirectory("f");
  const socketPath = join(directory, "host.sock");
  const entry = fileURLToPath(new URL("../fixtures/listener-fault.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", entry,
    "--socket", socketPath, "--registry-path", join(directory, "registry.json"),
    "--generation", "listener-fault"], { env: process.env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let client: NativeTerminalClient | undefined;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  };
  // The enclosing test owns the readiness deadline and its child. A separate
  // 200-tick polling budget races TS startup under concurrent suite load.
  onTestFinished(stop);
  try {
    let stdout = "";
    let log = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", chunk => { log += chunk; });
    await new Promise<void>((resolve, reject) => {
      const earlyExit = () => reject(new Error(`host exited before readiness: ${log}`));
      child.once("exit", earlyExit);
      child.once("error", reject);
      child.stdout!.on("data", chunk => {
        stdout += chunk;
        if (!stdout.includes("h2a.native-terminal.ready")) return;
        child.removeListener("exit", earlyExit);
        resolve();
      });
    });
    client = await NativeTerminalClient.connect(socketPath);
    expect((await client.ping()).hostPid).toBe(child.pid);
    const diagnostics = once(child, "message");
    const exited = once(child, "exit");
    child.send!({ codes });
    const [snapshot] = await diagnostics as [{ faultCounters: Record<string, number> }];
    expect(snapshot.faultCounters[counter]).toBe(1);
    if (codes.length === 3) expect(snapshot.faultCounters["server.listener-error-exhausted"]).toBe(2);
    const [code, signal] = await exited;
    expect(code).toBe(exitCode);
    expect(signal).toBeNull();
    const label = exitCode === 3 ? "unknown listener error" : "unusable listener error";
    expect(log.split("\n").find(line => line.includes(`${label} (`))).toBe(
      `[h2a-pty-host] ${label} (${codes.at(-1) ?? "no errno"}): Error: injected listener fault; stopping`,
    );
    await expect(client.ping()).rejects.toThrow();
    await expect(NativeTerminalClient.connect(socketPath)).rejects.toThrow();
  } finally {
    client?.close();
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}

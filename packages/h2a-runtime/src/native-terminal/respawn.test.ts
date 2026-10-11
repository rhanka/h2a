import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
// @ts-ignore Shared JS qualification helper; never shipped in the runtime.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
import { NativeTerminalClient } from "./client.js";
import { HOST_FAULT_COUNTERS, hostFaultCounters } from "./fault-counters.js";
import { NativeTerminalHostSupervisor } from "./supervisor.js";

setupNativeTestEnvironment(afterAll);
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = createPrivateTestDirectory("r");
  directories.push(directory);
  writeFileSync(join(directory, "registry.json"), JSON.stringify({ version: 1, entries: [] }));
  let now = 0;
  let healthy = false;
  let publishOnSpawn = false;
  let child: EventEmitter & { pid: number; exitCode: number | null; signalCode: null; stderr: null };
  let generation = 0;
  const close = vi.fn();
  const ping = vi.fn(async () => {
    if (!healthy) throw new Error("host unavailable");
    return { hostPid: child.pid, generation: `generation-${generation}`, protocolVersion: 1 };
  });
  // All process identities here are synthetic; never probe or signal the OS.
  vi.spyOn(process, "kill").mockImplementation(() => true);
  const connect = vi.spyOn(NativeTerminalClient, "connect").mockImplementation(async () => {
    if (!healthy) throw new Error("no listener");
    return { ping, close } as unknown as NativeTerminalClient;
  });
  const spawnHost = vi.fn(() => {
    if (publishOnSpawn) healthy = true;
    child = Object.assign(new EventEmitter(), { pid: 987654, exitCode: healthy ? null : 3,
      signalCode: null, stderr: null });
    return child as unknown as ChildProcess;
  });
  const log = vi.fn();
  const supervisor = new NativeTerminalHostSupervisor({
    socketPath: join(directory, "host.sock"), registryPath: join(directory, "registry.json"),
    replayBytesPerSession: 1024, spawnHost, generationFactory: () => `generation-${++generation}`,
    now: () => now, log, ownerProbe: () => "dead",
  });
  return { supervisor, spawnHost, log, advance: (ms: number) => { now += ms; },
    ping, connect, publishOnSpawn: () => { publishOnSpawn = true; },
    setHealthy: (value: boolean) => { healthy = value; },
    die: () => { healthy = false; child.exitCode = 3; child.emit("exit", 3, null); supervisor.disconnect(); } };
}

describe("native terminal bounded respawn", () => {
  it("should abandon after ten consecutive restarts in sixty seconds and expose its counter", async () => {
    const f = fixture();
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.supervisorRespawnAbandoned] ?? 0;
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    for (let restart = 1; restart <= 10; restart++) {
      const delay = Math.min(250 * 2 ** (restart - 1), 5000);
      f.advance(delay - 1);
      await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 1ms/);
      expect(f.spawnHost).toHaveBeenCalledTimes(restart);
      f.advance(1);
      await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    }
    f.advance(5000);
    await expect(f.supervisor.client()).rejects.toThrow("native terminal host restart limit exceeded (10 restarts in 60000ms); abandoning respawn");
    expect(f.spawnHost).toHaveBeenCalledTimes(11); // Initial launch plus ten restarts.
    expect(f.log).toHaveBeenCalledWith("native terminal host restart limit exceeded (10 restarts in 60000ms); abandoning respawn");
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.supervisorRespawnAbandoned]).toBe(before + 1);
    f.advance(60000);
    await expect(f.supervisor.client()).rejects.toThrow(/restart limit exceeded/);
    expect(f.spawnHost).toHaveBeenCalledTimes(11);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.supervisorRespawnAbandoned]).toBe(before + 1);
    // A competing host can still be adopted. A healthy minute is what lifts
    // abandonment and clears the restart history, not elapsed idle time.
    f.setHealthy(true);
    await f.supervisor.client();
    f.advance(60000);
    await f.supervisor.client();
    f.setHealthy(false);
    f.supervisor.disconnect();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    expect(f.spawnHost).toHaveBeenCalledTimes(12);
    await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 250ms/);
  });

  it("should preserve backoff across brief healthy handshakes and reset after sixty seconds of service", async () => {
    const f = fixture();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    f.advance(250);
    // The connect seam answers only after a replacement is spawned.
    f.spawnHost.mockImplementationOnce(() => {
      f.setHealthy(true);
      return Object.assign(new EventEmitter(), { pid: 987654, exitCode: null, signalCode: null, stderr: null }) as unknown as ChildProcess;
    });
    await f.supervisor.client();
    f.setHealthy(false);
    // The spawned synthetic process is the one returned by the mock.
    const replacement = f.spawnHost.mock.results.at(-1)!.value as ChildProcess;
    Object.defineProperty(replacement, "exitCode", { value: 3, writable: true });
    f.supervisor.disconnect();
    await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 500ms/);
    f.advance(500);
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    // Adoption alone does not clear the history; sixty seconds of successful
    // pings do, even if the healthy host was published by another supervisor.
    f.setHealthy(true);
    await f.supervisor.client();
    f.advance(59999);
    await f.supervisor.client();
    f.advance(1);
    await f.supervisor.client();
    f.setHealthy(false);
    f.supervisor.disconnect();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    // Fresh failure after a healthy minute starts at 250ms again.
    await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 250ms/);
  });

  it("should abandon repeated hosts that handshake but die before a healthy minute", async () => {
    const f = fixture();
    f.publishOnSpawn();
    await f.supervisor.client();
    for (let restart = 1; restart <= 10; restart++) {
      f.die();
      const delay = Math.min(250 * 2 ** (restart - 1), 5000);
      await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active/);
      f.advance(delay);
      await f.supervisor.client();
    }
    f.die();
    f.advance(5000);
    await expect(f.supervisor.client()).rejects.toThrow(/restart limit exceeded/);
    expect(f.spawnHost).toHaveBeenCalledTimes(11);
  });

  it("should restart the healthy minute after a failed ping even if the same host reconnects", async () => {
    const f = fixture();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    f.advance(250);
    f.publishOnSpawn();
    await f.supervisor.client();
    f.advance(59000);
    f.ping.mockRejectedValueOnce(new Error("brief health failure"));
    await f.supervisor.client();
    f.advance(1000);
    f.die();
    await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 500ms/);
  });

  it("should restart the healthy minute after a failed reconnect to an owned live host", async () => {
    const f = fixture();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    f.advance(250);
    f.publishOnSpawn();
    await f.supervisor.client();
    f.advance(59000);
    f.supervisor.disconnect();
    f.connect.mockRejectedValueOnce(new Error("brief reconnection failure"));
    await f.supervisor.client();
    f.advance(1000);
    f.die();
    await expect(f.supervisor.client()).rejects.toThrow(/restart backoff active for 500ms/);
  });

  it("should expire restart events outside the rolling sixty-second window", async () => {
    const f = fixture();
    await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    for (let restart = 0; restart < 15; restart++) {
      f.advance(60000);
      await expect(f.supervisor.client()).rejects.toThrow(/exited before accepting connections/);
    }
    expect(f.spawnHost).toHaveBeenCalledTimes(16);
    expect(f.log).not.toHaveBeenCalled();
  });
});

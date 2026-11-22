import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { NativeTerminalHost } from "./host.js";

it("rejects a reused process birth and identifies an enrolled replacement in the same PTY", () => {
  const directory = mkdtempSync(join(tmpdir(), "facet-unit-"));
  const application = (pid: number, birth: string, state = "S") => ({
    pid, birth, state, processGroup: 50_001,
  });
  const readApplicationForeground = vi.fn(() => ({
    foregroundProcessGroup: 50_001,
    application: application(50_002, "2"),
  }));
  const hostOptions = {
    generation: "fixture-generation",
    replayBytesPerSession: 1024,
    registryPath: join(directory, "registry.json"),
    readLeaderStartTime: () => 1,
    readApplicationForeground,
    spawner: () => ({
      pid: 50_001, pgid: 50_001, cols: 80, rows: 24,
      write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
      onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    }),
  };
  const host = new NativeTerminalHost(hostOptions);
  try {
    const first = host.create({
      id: "fixture", command: "fixture", args: [], cwd: directory, env: {}, cols: 80, rows: 24,
    });
    expect(first).toMatchObject({ applicationFacet: "cli", applicationIncarnation: expect.any(String) });

    readApplicationForeground.mockReturnValue({
      foregroundProcessGroup: 50_001,
      application: application(50_002, "2", "T"),
    });
    const stopped = host.state("fixture");
    expect(stopped).toMatchObject({ applicationFacet: "unknown" });
    expect(Reflect.get(stopped, "foregroundRevision")).toBeGreaterThan(Reflect.get(first, "foregroundRevision"));

    readApplicationForeground.mockReturnValue({
      foregroundProcessGroup: 50_001,
      application: application(50_002, "2"),
    });
    const resumed = host.state("fixture");
    expect(resumed).toMatchObject({ applicationFacet: "cli", applicationIncarnation: first.applicationIncarnation });
    expect(resumed.foregroundRevision).toBeGreaterThan(stopped.foregroundRevision!);

    readApplicationForeground.mockReturnValue({
      foregroundProcessGroup: 50_001,
      application: application(50_002, "3"),
    });
    expect(host.state("fixture")).toMatchObject({ applicationFacet: "unknown" });
    expect(host.state("fixture")).toMatchObject({ applicationFacet: "unknown" });

    readApplicationForeground.mockReturnValue({
      foregroundProcessGroup: 50_001,
      application: application(50_003, "4"),
    });
    const replacement = host.state("fixture");
    expect(replacement).toMatchObject({
      generation: first.generation,
      incarnation: first.incarnation,
      pid: first.pid,
      applicationFacet: "cli",
    });
    expect(Reflect.get(replacement, "applicationIncarnation")).not.toBe(Reflect.get(first, "applicationIncarnation"));
  } finally {
    host.stopAll();
    rmSync(directory, { recursive: true, force: true });
  }
});

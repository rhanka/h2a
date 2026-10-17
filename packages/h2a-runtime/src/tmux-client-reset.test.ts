import { describe, expect, it } from "vitest";

import type { TunnelConfig } from "./config.js";
import { attachPodTmux } from "./tmux.js";

const tunnel: TunnelConfig = {
  namespace: "h2a-test",
  context: "test",
} as TunnelConfig;

function nullStderr() {
  const written: string[] = [];
  return {
    written,
    stderr: {
      write: (chunk: string) => {
        written.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream,
  };
}

describe("attachPodTmux client reset (rev351-1)", () => {
  it("should stop on kubectl SIGINT and report 130, never 0 or reconnect", () => {
    const { stderr } = nullStderr();
    let calls = 0;
    const code = attachPodTmux(tunnel, "sess-1", {
      spawnKubectl: () => {
        calls += 1;
        return { status: null, signal: "SIGINT" };
      },
      sleepOnce: () => ({ status: 0, signal: null }),
      reset: () => {},
      stderr,
    });
    expect(code).toBe(130);
    expect(calls).toBe(1);
  });

  it("should stop on kubectl SIGTERM and report 143", () => {
    const { stderr } = nullStderr();
    const code = attachPodTmux(tunnel, "sess-1", {
      spawnKubectl: () => ({ status: null, signal: "SIGTERM" }),
      sleepOnce: () => ({ status: 0, signal: null }),
      reset: () => {},
      stderr,
    });
    expect(code).toBe(143);
  });

  it("should reset the client terminal before reconnecting after a drop", () => {
    const { stderr } = nullStderr();
    let resets = 0;
    let calls = 0;
    const code = attachPodTmux(tunnel, "sess-1", {
      spawnKubectl: () => {
        calls += 1;
        if (calls === 1) return { status: 1, signal: null };
        return { status: 0, signal: null };
      },
      sleepOnce: () => ({ status: 0, signal: null }),
      reset: () => {
        resets += 1;
      },
      stderr,
    });
    expect(code).toBe(0);
    expect(calls).toBe(2);
    // Per-iteration reset: kubectl#1 + sleep + kubectl#2. An outer-only
    // wrapper would reset exactly once.
    expect(resets).toBeGreaterThanOrEqual(3);
  });

  it("should stop when sleep itself is killed by signal instead of reconnecting", () => {
    const { stderr } = nullStderr();
    let kubectlCalls = 0;
    const code = attachPodTmux(tunnel, "sess-1", {
      spawnKubectl: () => {
        kubectlCalls += 1;
        return { status: 1, signal: null };
      },
      sleepOnce: () => ({ status: null, signal: "SIGINT" }),
      reset: () => {},
      stderr,
    });
    expect(code).toBe(130);
    expect(kubectlCalls).toBe(1);
  });
});

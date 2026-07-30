import { describe, expect, it, vi } from "vitest";

// The reconnect path heals the tunnel before reopening the stream, and that call
// is not injectable — against a fake base URL it tries to establish a real one
// and the test never returns. Stub it at the module boundary so the test drives
// the CYCLE, which is what is being pinned here.
vi.mock("./tunnel.js", () => ({
  ensureConnected: async () => {},
  stopTunnel: async () => {},
}));

import { attach } from "./attach.js";

/**
 * Regression: `h2a attach` livelocked at ~6670 reconnections per second for ten
 * minutes straight — 3 982 276 "connection lost" lines in one required CI job,
 * measured by the harness lane, ending only at SIGKILL.
 *
 * The mechanism is in the reconnect loop: on FAILURE it waits 1000ms, but on
 * SUCCESS it breaks out with NO delay, and the 120-attempt ceiling is per outage
 * and reset by every successful reopen. So a control plane that answers 200 with
 * a stream that closes immediately is reopened forever at zero delay — stderr
 * floods and a core burns while the attach looks alive.
 *
 * These tests pin the cycle itself, not the retry: a stream that dies instantly
 * must be paced AND bounded.
 */

/** A body that is already at end-of-stream: opening it succeeds, reading ends. */
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function collectingStderr(): {
  stream: NodeJS.WriteStream;
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream,
    text: () => chunks.join(""),
  };
}

describe("attach — reconnect livelock", () => {
  it("bounds and paces a stream that closes the instant it opens", async () => {
    let eventOpens = 0;
    const stderr = collectingStderr();

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/events")) {
        eventOpens += 1;
        // Answer 200 with a body that is already finished — the exact shape that
        // made the loop spin: reopening succeeds, reading ends immediately.
        return new Response(emptyStream(), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-livelock",
      stderr: stderr.stream,
      fetchImpl,
      reconnect: { minStreamMs: 50, baseDelayMs: 1, maxDelayMs: 4, maxShortCycles: 3 },
    });

    await session.finished;

    // BOUNDED: the old loop produced millions of opens; the bound is small and
    // proportional to maxShortCycles, not to elapsed time.
    expect(eventOpens).toBeGreaterThan(1); // it did retry
    expect(eventOpens).toBeLessThanOrEqual(6); // but it stopped
    // And it said why, instead of dying silently or looking alive.
    expect(stderr.text()).toMatch(/closing immediately|giving up/i);
  });

  it("does not count a healthy long-lived stream against the short-cycle bound", async () => {
    let eventOpens = 0;
    const stderr = collectingStderr();

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/events")) {
        eventOpens += 1;
        if (eventOpens === 1) {
          // A stream that lived a while, then ended: normal reconnect territory.
          return new Response(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                await new Promise((r) => setTimeout(r, 80));
                controller.close();
              },
            }),
            { status: 200 },
          );
        }
        return new Response(emptyStream(), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-mixed",
      stderr: stderr.stream,
      fetchImpl,
      reconnect: { minStreamMs: 50, baseDelayMs: 1, maxDelayMs: 4, maxShortCycles: 3 },
    });

    await session.finished;

    // The first, healthy stream must not consume the budget: opens = 1 healthy
    // + up to maxShortCycles+1 short ones.
    expect(eventOpens).toBeGreaterThan(2);
    expect(eventOpens).toBeLessThanOrEqual(7);
  });
});

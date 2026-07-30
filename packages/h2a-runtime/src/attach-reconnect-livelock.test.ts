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

  it("does not let useful output poison the later give-up budget", async () => {
    // THIRD REVIEW LEG, confirmed: pacing and giving up shared one counter, so a
    // productive short stream consumed the give-up budget without triggering it.
    // With maxShortCycles 3, four useful short streams then empty ones gave up at
    // 5 opens (4 useful + the FIRST empty) instead of 8 (4 useful + 4 empty).
    // Give-up must count CONSECUTIVE futile cycles only.
    let eventOpens = 0;
    const stderr = collectingStderr();
    const USEFUL = 4;

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/events")) {
        eventOpens += 1;
        const useful = eventOpens <= USEFUL;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              if (useful) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'event: terminal.output\ndata: {"type":"terminal.output","payload":{"data":"x"}}\n\n',
                  ),
                );
              }
              controller.close();
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-useful-then-empty",
      stderr: stderr.stream,
      fetchImpl,
      reconnect: { minStreamMs: 1000, baseDelayMs: 1, maxDelayMs: 4, maxShortCycles: 3 },
    });

    await session.finished;

    // 4 useful + 4 empty: the futile budget is spent by empty cycles only.
    expect(eventOpens).toBe(USEFUL + 4);
    expect(stderr.text()).toMatch(/giving up/i);
  });

  it("paces a stream that REPLAYS a backlog and then dies immediately", async () => {
    // SECOND REVIEW LEG, confirmed against the real control plane: its SSE route
    // replays a 128-event backlog to every new subscriber, so EVERY reopen
    // delivers a frame before any new event exists. With progress gating the
    // backoff, that measured 501 reopens in 105ms (~4771/s) and "giving up" was
    // never printed — the livelock restored. Pacing must not be a content
    // question; only GIVING UP may depend on progress.
    let eventOpens = 0;
    const stderr = collectingStderr();

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/events")) {
        eventOpens += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // The replayed backlog: a lifecycle frame the output filter drops.
              controller.enqueue(
                new TextEncoder().encode(
                  'event: session.created\ndata: {"type":"session.created"}\n\n',
                ),
              );
              controller.close(); // and the stream dies at once
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-replay-then-die",
      stderr: stderr.stream,
      fetchImpl,
      reconnect: { minStreamMs: 1000, baseDelayMs: 20, maxDelayMs: 80, maxShortCycles: 3 },
    });

    await new Promise((r) => setTimeout(r, 250));
    const opens = eventOpens;
    await session.close();
    await session.finished;

    // PACED: hundreds of reopens in 105ms was the defect. With a 20ms floor that
    // doubles, a quarter of a second cannot fit more than a handful.
    expect(opens).toBeLessThan(12);
  });

  it("does not give up on SHORT streams that are still delivering output", async () => {
    // REVIEW FINDING on PR 100, confirmed: bounding on lifetime alone terminated a
    // healthy attach. Eleven consecutive 900ms streams, each carrying a valid
    // terminal.output, hit the bound and resolved through "giving up" — and
    // retrying could not recover, because it reset the same counter. A stream that
    // DELIVERED something is not a dead stream, however short-lived; the livelock
    // being bounded is the EMPTY one.
    let eventOpens = 0;
    const stderr = collectingStderr();

    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/events")) {
        eventOpens += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'event: terminal.output\ndata: {"type":"terminal.output","payload":{"data":"x"}}\n\n',
                ),
              );
              await new Promise((r) => setTimeout(r, 5));
              controller.close(); // short, but it DID deliver
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const session = await attach({
      baseUrl: "http://127.0.0.1:1",
      sessionId: "sess-flaky-but-useful",
      stderr: stderr.stream,
      fetchImpl,
      reconnect: { minStreamMs: 1000, baseDelayMs: 1, maxDelayMs: 2, maxShortCycles: 3 },
    });

    // Let it cycle well past the bound, then close it ourselves.
    await new Promise((r) => setTimeout(r, 300));
    const opensBeforeClose = eventOpens;
    await session.close();
    await session.finished;

    // It kept reconnecting past maxShortCycles instead of declaring the session
    // dead, and it never printed the give-up message.
    expect(opensBeforeClose).toBeGreaterThan(4);
    expect(stderr.text()).not.toMatch(/giving up/i);
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

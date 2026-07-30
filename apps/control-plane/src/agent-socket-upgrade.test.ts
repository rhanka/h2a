import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startControlPlane } from "./index.js";

/**
 * A REAL WebSocket handshake against the control plane's PRODUCTION entrypoint.
 *
 * Why this file exists: every other control-plane test reaches the agent socket
 * through the `buildAgentSocketEvents` seam, which deliberately bypasses the
 * upgrade. So the one code path a migration rewrites had no test at all.
 *
 * Why it calls `startControlPlane()` rather than composing `serve()` itself: an
 * external mutation review showed that a test which recomposes the wiring only
 * verifies its own copy. Deleting `websocket: { server }` from the production
 * entrypoint — the single line the v2 migration is about — left the suite green.
 * These tests therefore exercise the exported entrypoint, so a mutation of the
 * real wiring reddens them.
 *
 * Where the guarantee stops: it proves the upgrade completes on both ws routes,
 * that an announce carried over a real socket reaches the store, and that a
 * non-upgrade request is declined with a specific status. It does not exercise
 * `packages/h2a-runtime`, which still carries the adapter and needs its own.
 */

let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "cp-ws-upgrade-"));
  for (const key of ["DATA_DIR", "PORT", "HOST"]) savedEnv[key] = process.env[key];
  process.env.DATA_DIR = dataDir;
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** Boot the REAL entrypoint on an ephemeral loopback port. */
async function startProduction(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = await startControlPlane();
  const port = await new Promise<number>((resolve, reject) => {
    const settle = () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("control plane did not report a numeric port"));
    };
    const address = server.address();
    if (address && typeof address === "object") settle();
    else {
      server.once("listening", settle);
      server.once("error", reject);
    }
  });
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Open a socket and resolve once the handshake completes. */
async function handshake(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the upgrade did not complete within 5s: ${url}`)),
      5_000,
    );
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return socket;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("agent websocket upgrade — real handshake on the production entrypoint", () => {
  it("completes a real upgrade on /sessions/:id/agent", async () => {
    const { port, close } = await startProduction();
    const socket = await handshake(`ws://127.0.0.1:${port}/sessions/s-up/agent`);
    try {
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket.close();
      await close();
    }
  });

  it("upgrades /sessions/:id/terminal, then closes 1008 for an unknown session", async () => {
    // The second upgrade route, ported by the same commit. It had no handshake
    // test at all, so half of what the migration touched was uncovered.
    // It upgrades FIRST and rejects INSIDE the socket (close 1008) rather than
    // with an HTTP status, so the assertion has to be the close code: measured,
    // not assumed — an earlier version of this test asserted OPEN and failed.
    const { port, close } = await startProduction();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/sessions/s-term/terminal`);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no close within 5s")), 5_000);
        socket.once("close", (closeCode) => {
          clearTimeout(timer);
          resolve(closeCode);
        });
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      // 1008 proves the upgrade happened: an un-upgraded request could not
      // produce a WebSocket close frame at all.
      expect(code).toBe(1008);
    } finally {
      socket.close();
      await close();
    }
  });

  it("keeps the socket usable a tick AFTER the handshake", async () => {
    // Resolving on 'open' and asserting nothing afterwards leaves a gap: a
    // server that closes the socket one tick later still passes. The boundary
    // has to be observed after the event loop has turned.
    const { port, close } = await startProduction();
    const socket = await handshake(`ws://127.0.0.1:${port}/sessions/s-tick/agent`);
    try {
      await tick();
      await tick();
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket.close();
      await close();
    }
  });

  it("carries a session.announce from the real socket into the store", async () => {
    // The upgrade and the announce were covered against two DIFFERENT objects —
    // the route on one side, a fake socket through the seam on the other — so
    // their junction was covered by nothing. A factory returning {} accepted the
    // handshake and dropped every announce in silence.
    const { port, close } = await startProduction();
    const id = "s-announce";
    const socket = await handshake(`ws://127.0.0.1:${port}/sessions/${id}/agent`);
    try {
      socket.send(
        JSON.stringify({
          type: "session.announce",
          body: {
            sessionId: id,
            profile: "codex",
            target: "k3s",
            workspacePath: "/workspace",
            workspaceId: "ws-42",
          },
        }),
      );
      // Read it back over HTTP: the announce is only "carried" if the store has
      // it. Polled rather than slept on, so the test does not encode a timing.
      let status = 0;
      for (let attempt = 0; attempt < 50; attempt++) {
        const response = await fetch(`http://127.0.0.1:${port}/sessions/${id}`);
        status = response.status;
        if (status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(status).toBe(200);
    } finally {
      socket.close();
      await close();
    }
  });

  it("declines a plain GET of the ws route with a specific status", async () => {
    // `not.toBe(101)` passed on 404, on 401 and on 500 — every failure mode
    // except the one it named. Pin the status actually measured (404), so a
    // route that starts erroring (500) or authenticating (401) is no longer
    // silently accepted by this assertion.
    //
    // Stated honestly: 404 is ALSO what a deleted route returns, so this test
    // alone does not separate "declines a non-upgrade request" from "route is
    // gone". It is the handshake tests above that carry that half — they redden
    // when the route moves. The pair discriminates; neither does on its own.
    const { port, close } = await startProduction();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/sessions/s-plain/agent`,
      );
      expect(response.status).toBe(404);
    } finally {
      await close();
    }
  });
});

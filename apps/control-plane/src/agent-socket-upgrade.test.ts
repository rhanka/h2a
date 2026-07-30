import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { createControlPlane } from "./index.js";

/**
 * A REAL WebSocket handshake against /sessions/:id/agent.
 *
 * Why this file exists: every other control-plane test reaches the agent socket
 * through the `buildAgentSocketEvents` seam, which deliberately bypasses the
 * upgrade itself. So the one code path that turns an HTTP request into a live
 * socket had no test at all — and it is exactly the path that changes when the
 * adapter behind it is replaced. This test performs the handshake over a loopback
 * port so that a migration can be judged on evidence instead of on a green suite
 * that never touched the upgrade.
 *
 * Where the guarantee stops: it proves the upgrade completes and that a
 * non-upgrade request to the same route is not treated as one. It says nothing
 * about the announce protocol carried over the socket, which the seam covers.
 */

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "cp-ws-upgrade-"));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Start the control plane on an ephemeral loopback port. */
async function startControlPlane(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const app = createControlPlane();
  // v2 takes the ws server at serve() time; there is no post-hoc injection.
  const server = serve({
    fetch: app.fetch,
    port: 0,
    hostname: "127.0.0.1",
    websocket: { server: new WebSocketServer({ noServer: true }) },
  });

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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("agent websocket upgrade — real handshake", () => {
  it("completes a real WebSocket upgrade on /sessions/:id/agent", async () => {
    const { port, close } = await startControlPlane();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/sessions/s-upgrade/agent`);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("the upgrade did not complete within 5s")),
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

      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket.close();
      await close();
    }
  });

  it("does not treat a plain GET of the same route as an upgrade", async () => {
    const { port, close } = await startControlPlane();
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/sessions/s-plain/agent`,
      );
      // The upgrade helper must decline a request without the websocket
      // handshake headers rather than switching protocols on it.
      expect(response.status).not.toBe(101);
    } finally {
      await close();
    }
  });
});

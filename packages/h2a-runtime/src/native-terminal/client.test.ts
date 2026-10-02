import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeTerminalClient } from "./client.js";

// Every socket the client opens, so a test can act inside one of its own event
// listeners. The real `createConnection` still does all the work.
const captured = vi.hoisted(() => ({ sockets: [] as Socket[] }));
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    createConnection: (...args: Parameters<typeof actual.createConnection>) => {
      const socket = actual.createConnection(...args);
      captured.sockets.push(socket);
      return socket;
    },
  };
});

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
  captured.sockets.length = 0;
});

/** A private socket whose server side the test controls, and a client on it. */
async function connectedPair(): Promise<{ client: NativeTerminalClient; clientSocket: Socket; hostSide: Socket }> {
  const directory = await mkdtemp(join(tmpdir(), "h2a-native-terminal-client-"));
  const socketPath = join(directory, "host.sock");
  const hostSides: Socket[] = [];
  const server = createServer((socket) => {
    hostSides.push(socket);
  });
  const accepted = new Promise<Socket>((resolve) => {
    server.once("connection", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
  cleanup.push(async () => {
    for (const socket of hostSides) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const client = await NativeTerminalClient.connect(socketPath);
  cleanup.push(async () => client.close());
  const clientSocket = captured.sockets.at(-1);
  if (clientSocket === undefined) throw new Error("the client opened no socket");
  return { client, clientSocket, hostSide: await accepted };
}

describe("NativeTerminalClient connection loss", () => {
  it("CLIENT_FAILS_CLOSED_BETWEEN_THE_HOSTS_END_OF_STREAM_AND_CLOSE", async () => {
    // A host that dies closes its end of the socket. The client reads that
    // end-of-stream ('end') first; 'close' only follows in a later phase of the
    // event loop. From 'end' on, Node turns every write into an EPIPE ("This
    // socket has been ended by the other party"), so a request issued in that
    // window used to surface Node's raw write error instead of the client's own
    // closed-connection error — the shape a caller that just watched its host
    // exit hits (the reconnect scenario of the functional suite, Node 20).
    //
    // Node ends the client's own side one tick after 'end' (allowHalfOpen is
    // off), and 'close' needs that shutdown to complete in a later loop
    // iteration; a check-phase callback scheduled from 'end' therefore lands
    // inside the window every time. The test asserts that precondition itself
    // rather than trusting the ordering.
    const { client, clientSocket, hostSide } = await connectedPair();
    let closeSeen = false;
    clientSocket.once("close", () => {
      closeSeen = true;
    });
    const inWindow = new Promise<{ outcome: unknown; ended: boolean; closed: boolean }>(
      (resolve) => {
        clientSocket.once("end", () => {
          setImmediate(() => {
            const ended = clientSocket.writableEnded;
            const closed = closeSeen;
            void client.list().then(
              () => resolve({ outcome: "resolved", ended, closed }),
              (error: unknown) => resolve({ outcome: error, ended, closed }),
            );
          });
        });
      },
    );

    // What a SIGKILLed host's exit does to its end of the socket.
    hostSide.destroy();

    const { outcome, ended, closed } = await inWindow;
    expect({ ended, closed }).toEqual({ ended: true, closed: false });
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/terminal host (client is closed|connection closed)/);
  });

  it("CLIENT_FAILS_A_REQUEST_IN_FLIGHT_AS_SOON_AS_THE_HOST_ENDS_THE_STREAM", async () => {
    // No response can follow the host's end-of-stream, so a pending request
    // must not wait for its own timeout (nor for a later 'close').
    const { client, hostSide } = await connectedPair();
    const pending = client.ping(60_000);
    hostSide.end();
    await expect(pending).rejects.toThrow(/terminal host connection closed/);
  });
});

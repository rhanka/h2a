/**
 * HTTP transport for signed envelopes (DEC-076), slice 3b of the signed-bearer
 * transport-auth workstream (DEC-073/074/075).
 *
 * The server is a thin, channel-untrusting front-end over the DEC-075
 * `acceptRemoteEnvelope` pipeline: it reads a POSTed JSON envelope and hands it
 * to the pipeline, which does all verification. The HTTP layer adds only
 * framing (a single POST endpoint, a body-size cap) and a result→status map.
 */

import { createServer, type Server } from "node:http";

import { createReplayGuard, type H2AEnvelope, type H2AReplayGuard } from "@sentropic/h2a";

import { acceptRemoteEnvelope, type H2AAcceptRejection } from "./accept.js";

export interface RemoteServerOptions {
  /** Resolve a signer instance to its active ed25519 public-key PEMs (DEC-078). */
  resolvePublicKeys: (signerInstance: string) => string[];
  /** Deliver an accepted envelope to a local recipient's inbox. */
  deliver: (recipient: string, envelope: H2AEnvelope) => void;
  /** Shared replay guard. Defaults to a fresh in-memory guard (DEC-074). */
  guard?: H2AReplayGuard;
  /** POST endpoint path. Default `/h2a/envelopes`. */
  path?: string;
  /** Reject bodies larger than this many bytes. Default 256 KiB. */
  maxBodyBytes?: number;
  /** Clock source handed to the replay guard. Defaults to `Date.now`. */
  now?: () => number;
}

/** Map an accept-pipeline rejection to an HTTP status code. */
export function rejectionStatus(reason: H2AAcceptRejection): number {
  switch (reason) {
    case "malformed":
    case "no-target":
    case "no-signature":
    case "invalid-timestamp":
      return 400; // bad request (structural / unparseable)
    case "no-public-key":
    case "bad-signature":
      return 401; // unauthorized (cannot authenticate the emitter)
    case "replayed":
      return 409; // conflict (already seen)
    case "expired":
    case "future":
      return 422; // unprocessable (outside the freshness window)
    default:
      return 400;
  }
}

/**
 * Build (but do not start) an HTTP server that feeds POSTed envelopes to the
 * DEC-075 trust boundary. Accepted → 202; rejected → see {@link rejectionStatus};
 * wrong method/path → 404/405. The caller starts it with `.listen(port, host)`
 * and is responsible for closing it.
 */
export function createRemoteServer(options: RemoteServerOptions): Server {
  const guard = options.guard ?? createReplayGuard();
  const path = options.path ?? "/h2a/envelopes";
  const maxBodyBytes = options.maxBodyBytes ?? 256 * 1024;

  return createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    };

    const url = req.url ?? "";
    if (url.split("?")[0] !== path) {
      respond(404, { ok: false, error: "not-found" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      respond(405, { ok: false, error: "method-not-allowed" });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        aborted = true;
        respond(413, { ok: false, error: "payload-too-large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        respond(400, { ok: false, reason: "malformed" });
        return;
      }
      const result = acceptRemoteEnvelope(payload, {
        resolvePublicKeys: options.resolvePublicKeys,
        guard,
        deliver: options.deliver,
        now: options.now?.()
      });
      if (result.ok) {
        respond(202, result);
      } else {
        respond(rejectionStatus(result.reason), result);
      }
    });
  });
}

/**
 * EVO-13 P1 — HTTP ingester for instance mirrors. A thin, channel-untrusting
 * front-end over `acceptMirrorEnvelope`: it reads a POSTed signed mirror and,
 * on success, applies the registration to the store via `registerInstance`.
 *
 * Runs as a SEPARATE deployment from the read-only MCP pod (it writes the store;
 * the MCP surface only reads it), co-mounting the RWX PVC. Store-agnostic +
 * unit-testable; the k8s wiring is the deploy kit.
 */
import { createServer, type Server } from "node:http";

import { createReplayGuard, type H2AReplayGuard } from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";
import { acceptMirrorEnvelope, type H2AMirrorRejection } from "./accept.js";

export interface MirrorServerForStoreOptions {
  /** Operator-enrolled key PEMs allowed to mirror/bootstrap (out-of-band trust). */
  enrolledKeys?: readonly string[];
  /** POST endpoint path. Default `/h2a/mirror`. */
  path?: string;
  /** Shared replay guard. Defaults to a fresh in-memory guard. */
  guard?: H2AReplayGuard;
  /** Body-size cap (bytes). Default 256 KiB. */
  maxBodyBytes?: number;
  /** Clock source handed to the guard. Defaults to `Date.now`. */
  now?: () => number;
}

/** Map a mirror-pipeline rejection to an HTTP status code. */
export function mirrorRejectionStatus(reason: H2AMirrorRejection): number {
  switch (reason) {
    case "malformed":
    case "not-mirror":
    case "no-signature":
    case "instance-key-mismatch":
    case "invalid-timestamp":
      return 400;
    case "unauthorized-key":
    case "bad-signature":
      return 401;
    case "replayed":
      return 409;
    case "expired":
    case "future":
      return 422;
    default:
      return 400;
  }
}

/** Build (unstarted) the mirror ingester bound to `store`. */
export function mirrorServerForStore(store: LocalStore, options: MirrorServerForStoreOptions = {}): Server {
  const guard = options.guard ?? createReplayGuard();
  const enrolledKeys = options.enrolledKeys ?? [];
  const path = options.path ?? "/h2a/mirror";
  const maxBodyBytes = options.maxBodyBytes ?? 256 * 1024;

  return createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if ((req.url ?? "").split("?")[0] !== path) return respond(404, { ok: false, error: "not-found" });
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return respond(405, { ok: false, error: "method-not-allowed" });
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
        return respond(400, { ok: false, error: "malformed" });
      }
      const result = acceptMirrorEnvelope(payload, {
        resolvePublicKeys: (signer) => store.listInstanceKeys(signer),
        enrolledKeys,
        guard,
        applyRegistration: (reg) => store.registerInstance(reg),
        ...(options.now ? { now: options.now() } : {})
      });
      if (result.ok) return respond(202, { ok: true, applied: result.applied, signer: result.signer });
      return respond(mirrorRejectionStatus(result.reason), { ok: false, reason: result.reason });
    });
  });
}

/**
 * EVO-13 P1 — HTTP ingester for instance mirrors. A thin, channel-untrusting
 * front-end over `acceptMirrorEnvelope`: it reads a POSTed signed mirror and,
 * on success, applies the registration to the store via `registerInstance`.
 *
 * Runs as a SEPARATE deployment from the read-only MCP pod (it writes the store;
 * the MCP surface only reads it), co-mounting the RWX PVC. Store-agnostic +
 * unit-testable; the k8s wiring is the deploy kit.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

import { createReplayGuard, type H2AReplayGuard } from "@sentropic/h2a";

import { localStorePaths, withLockSync, writePresence, type LocalStore } from "../local-files/index.js";
import { acceptMirrorEnvelope, type H2AMirrorRejection } from "./accept.js";

/**
 * Durable, per-instance monotonic fence (P2). Returns a predicate that accepts
 * `seq` iff it is strictly greater than the last recorded for `instance`, under
 * a lock so concurrent beats from one agent can't race. Survives restarts (the
 * in-memory replay guard does not), so a replayed older beat cannot resurrect
 * stale presence after the ingester restarts.
 */
function makeSequenceFence(root: string): (instance: string, seq: number) => boolean {
  const dir = join(localStorePaths(root).root, "identity");
  const file = join(dir, "mirror-seq.json");
  const lock = join(dir, ".mirror-seq.lock");
  return (instance, seq) => {
    mkdirSync(dir, { recursive: true });
    return withLockSync(lock, () => {
      let map: Record<string, number> = {};
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (parsed && typeof parsed === "object") map = parsed as Record<string, number>;
      } catch {
        map = {};
      }
      if (seq <= (map[instance] ?? 0)) return false;
      map[instance] = seq;
      writeFileSync(file, `${JSON.stringify(map)}\n`, "utf8");
      return true;
    });
  };
}

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
  const root = store.paths.root;
  const fenceSequence = makeSequenceFence(root);

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
      const stampMs = options.now ? options.now() : Date.now();
      const result = acceptMirrorEnvelope(payload, {
        resolvePublicKeys: (signer) => store.listInstanceKeys(signer),
        enrolledKeys,
        guard,
        applyRegistration: (reg) => store.registerInstance(reg),
        // Re-stamp heartbeatAt with the REMOTE clock → freshness derives from the
        // beat (no local-clock skew, no immortal ghost when the agent dies).
        applyPresence: (session) =>
          writePresence(root, { ...session, heartbeatAt: new Date(stampMs).toISOString(), state: "live" }),
        // Idempotent: registerSubagent throws on a known id — re-mirroring a beat
        // re-sends the same bindings, so treat "already registered" as a no-op.
        applySubagent: (binding) => {
          try {
            store.registerSubagent(binding);
          } catch (error) {
            if (!/already registered/i.test((error as Error).message)) throw error;
          }
        },
        fenceSequence,
        now: stampMs
      });
      if (result.ok) return respond(202, { ok: true, applied: result.applied, signer: result.signer });
      return respond(mirrorRejectionStatus(result.reason), { ok: false, reason: result.reason });
    });
  });
}

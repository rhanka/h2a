/**
 * EVO-13 P1 — HTTP ingester for instance mirrors. A thin, channel-untrusting
 * front-end over `acceptMirrorEnvelope`: it reads a POSTed signed mirror and,
 * on success, applies the registration to the store via `registerInstance`.
 *
 * Runs as a SEPARATE deployment from the read-only MCP pod (it writes the store;
 * the MCP surface only reads it), co-mounting the RWX PVC. Store-agnostic +
 * unit-testable; the k8s wiring is the deploy kit.
 *
 * ── WHAT THIS FILE NO LONGER DOES (2026-07-25) ─────────────────────────────
 *
 * It used to wire `applyRegistration: (reg) => store.registerInstance(reg)` and
 * `writePresence(root, { ...session, … })` — raw passthroughs on both. Narrowing
 * now happens inside `acceptMirrorEnvelope`, and the callback TYPES are the
 * `H2AMirrored*` wire types, so this file could not hand a raw record to a store
 * writer even if it tried. The boundary is not "serve.ts remembers to sanitize";
 * it is "serve.ts is never given anything to leak". See `ingest.ts`.
 *
 * ── AND THE TWO CRASHES THAT MADE THE BOUNDARY MOOT ────────────────────────
 *
 * A boundary that dies is not a boundary, and this one died on the second beat.
 * Both faults are pre-existing, both were MEASURED through this server rather
 * than read off the source, and both had the same shape: a store writer throws,
 * nothing on the path catches it, the throw escapes the `req.on("end")` callback
 * as an **uncaught exception that terminates the process**, and — because the
 * response is never written — the sender does not even get an error. It hangs
 * until its own timeout.
 *
 *  1. `store.registerInstance` throws `Instance already registered` on EVERY
 *     repeat beat (`store.ts:398-409`), and a mirror daemon beats every 15-30 s.
 *     So a healthy, authorized, up-to-date agent killed the ingester roughly one
 *     beat after it started. Fixed here the way the sibling `applySubagent`
 *     already did it: a known id is a no-op.
 *  2. Any OTHER throw from a store writer did the same. `applySubagent`'s
 *     existing catch is narrower than it looks — `registerSubagent` throws four
 *     distinct errors and the `/already registered/i` filter matches one of them;
 *     `Invalid subagent binding (…)` and `Subagent parent not registered` both
 *     escaped. `writePresence` throws a `TypeError` on a record `isH2ASession`
 *     rejects. Each was a remote process-kill available to any enrolled sender.
 *     Contained by a try/catch around the whole pipeline → 500.
 *
 * The 500 body deliberately carries NO exception message. Those messages
 * interpolate record content (`Instance already registered: <instance>`,
 * `Invalid subagent binding (<id>)`), and echoing a record's content back over
 * the network from the module whose job is to keep record content off the wire
 * would be a small version of the exact bug being fixed.
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
      let result;
      try {
        result = acceptMirrorEnvelope(payload, {
          resolvePublicKeys: (signer) => store.listInstanceKeys(signer),
          enrolledKeys,
          guard,
          // `reg` is an `H2AMirroredRegistration` — narrowed by `ingest.ts`
          // before it ever reaches this callback. Idempotent for the same reason
          // `applySubagent` is: a mirror beat re-sends the same registration
          // every cycle, and `registerInstance` throws on a known id.
          //
          // RECORDED, NOT FIXED: a no-op means a row a PRE-FIX sender already
          // landed is never replaced by its narrowed version. The registry is
          // append-only JSONL and `findInstance` returns the FIRST match, so
          // appending would not help either — the raw row would still shadow it
          // on read and still sit on disk. Cleaning data already at rest is a
          // separate operation on the hosted store, not something an ingest fix
          // can do. See the PR body and the joint plan § 9.
          applyRegistration: (reg) => store.registerInstance(reg),
          // Re-stamp heartbeatAt with the REMOTE clock → freshness derives from the
          // beat (no local-clock skew, no immortal ghost when the agent dies).
          // Unlike the registry, presence DOES self-heal: this overwrites the
          // session's file, so one beat from an upgraded sender replaces the raw
          // record a pre-fix sender left behind.
          applyPresence: (session) =>
            writePresence(root, { ...session, heartbeatAt: new Date(stampMs).toISOString(), state: "live", mirroredAt: new Date(stampMs).toISOString() }),
          // Idempotent: registerSubagent throws on a known id — re-mirroring a beat
          // re-sends the same bindings, so treat "already registered" as a no-op.
          // Its OTHER three throws are caught by the outer handler, not here.
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
      } catch {
        // A store writer threw. Without this the throw escapes the request
        // handler as an uncaught exception and TERMINATES the ingester, leaving
        // the sender waiting for a response that never comes. No message is
        // echoed: they interpolate record content. See the module header.
        return respond(500, { ok: false, error: "apply-failed" });
      }
      if (result.ok) {
        return respond(202, {
          ok: true,
          applied: result.applied,
          signer: result.signer,
          // Non-zero ⇒ this sender is running a CLI without the send boundary and
          // we narrowed for it. Field NAMES only, never values.
          narrowed: result.narrowed
        });
      }
      return respond(mirrorRejectionStatus(result.reason), { ok: false, reason: result.reason });
    });
  });
}

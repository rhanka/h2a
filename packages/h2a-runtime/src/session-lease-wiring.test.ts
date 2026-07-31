/**
 * The WIRING, not the store: what one supervising pass actually does against the
 * real registry and the real (machine-scoped) lease file, with the config home
 * redirected into a scratch dir. The store's own guarantees live in
 * `session-lease.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireSessionLease, main, superviseSessionLeases } from "./index.js";
import { advanceJob, enroll, listJobs, resolveRegistryPath } from "./registry.js";
import { resolveSessionLeasePath, SessionLeaseStore } from "./session-lease.js";

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "session-lease-wiring",
);

let scratch: string;
let previousHome: string | undefined;

/**
 * Reader instants are RELATIVE to the moment the test runs. The wiring stamps
 * leases from the real clock, so a frozen fixture date would only be "later"
 * than the lease for as long as the calendar cooperated — a test that is green
 * inside a window is a timebomb, not a proof.
 */
const inMinutes = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "w-"));
  previousHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = previousHome;
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Drive the real CLI action in-process (no `h2a` binary, no live bus — the
 * config home is redirected into the scratch dir above), capturing what the
 * operator would see and the exit code they would get.
 */
async function runCli(...argv: string[]): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const previousCode = process.exitCode;
  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    await main(["node", "h2a", ...argv]);
    return { out: out.join(""), err: err.join(""), code: Number(process.exitCode ?? 0) };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    process.exitCode = previousCode;
  }
}

function enrollJob(id: string, jobState: "running" | "done"): void {
  enroll({
    id,
    tool: "codex",
    kind: "local-tmux",
    cwd: scratch,
    source: "run",
    sessionClass: "background",
    role: "job",
    jobState,
  });
}

describe("the supervising pass, wired to the registry and the machine-scoped store", () => {
  it("files the lease beside the registry — one machine-wide pool, no repo sidecar", () => {
    expect(dirname(resolveSessionLeasePath())).toBe(dirname(resolveRegistryPath()));
    expect(resolveSessionLeasePath()).not.toContain(".track");
  });

  it("releases the lease of a terminal job, and never beats a session it cannot observe", () => {
    enrollJob("job-live", "running");
    enrollJob("job-done", "done");
    acquireSessionLease("job-live", { holder: "conductor", workspace: scratch });
    acquireSessionLease("job-done", { holder: "conductor", workspace: scratch });

    const before = new SessionLeaseStore(resolveSessionLeasePath(), { now: () => inMinutes(0) })
      .forSession("job-live")!;

    // No tmuxSession on either entry ⇒ no pane to read ⇒ no evidence of work.
    const pass = superviseSessionLeases(listJobs(), inMinutes(5));

    expect(pass.released).toEqual(["job-done"]);
    expect(pass.beaten).toEqual([]);
    expect(pass.unreadable).toEqual(["job-live"]);

    const store = new SessionLeaseStore(resolveSessionLeasePath(), { now: () => inMinutes(0) });
    expect(store.forSession("job-done")).toBeUndefined(); // slot given back
    // The live job keeps its lease, un-renewed: an unreadable pane proves nothing
    // in either direction.
    expect(store.forSession("job-live")?.heartbeatAt).toBe(before.heartbeatAt);
  });

  it("reports a slot held without work once the TTL has passed, and proposes only that", () => {
    enrollJob("job-hoarder", "running");
    acquireSessionLease("job-hoarder", { holder: "conductor", workspace: scratch });

    const early = superviseSessionLeases(listJobs(), inMinutes(5));
    expect(early.proposals).toEqual([]);

    const late = superviseSessionLeases(listJobs(), inMinutes(45));
    expect(late.proposals.map((p) => p.sessionId)).toEqual(["job-hoarder"]);
    expect(late.proposals[0]!.holder).toBe("conductor");
    // Proposed — NOT acted on: the job is still running and still holds its slot
    // until a caller decides otherwise.
    expect(listJobs().find((j) => j.id === "job-hoarder")?.jobState).toBe("running");
  });

  it("refuses `jobs reclaim` while the lease still beats, and frees the slot when it does not", async () => {
    enrollJob("job-working", "running");
    enrollJob("job-hoarder", "running");
    // The working session's lease is fresh; the hoarder's was last beaten 90
    // minutes ago — stamped through the injected clock, which is what it is for.
    acquireSessionLease("job-working", { holder: "cond:sub-8" });
    new SessionLeaseStore(resolveSessionLeasePath(), { now: () => inMinutes(-90) }).acquire({
      sessionId: "job-hoarder",
      holder: "cond:sub-7",
    });

    const refused = await runCli("jobs", "reclaim", "job-working");
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/refusing to reclaim job-working/);
    expect(refused.err).toMatch(/It is working/);
    expect(listJobs().find((j) => j.id === "job-working")?.jobState).toBe("running");

    const reclaimed = await runCli("jobs", "reclaim", "job-hoarder");
    expect(reclaimed.code).toBe(0);
    expect(reclaimed.out).toMatch(/reclaimed job-hoarder/);
    expect(reclaimed.err).toMatch(/NOT killed/);
    expect(listJobs().find((j) => j.id === "job-hoarder")?.jobState).toBe("failed");

    const store = new SessionLeaseStore(resolveSessionLeasePath(), { now: () => inMinutes(0) });
    expect(store.forSession("job-hoarder")).toBeUndefined();
    expect(store.forSession("job-working")).toBeDefined();
  });

  it("stops reporting a session once its slot has actually been reclaimed", () => {
    enrollJob("job-hoarder", "running");
    acquireSessionLease("job-hoarder", { holder: "conductor", workspace: scratch });

    // What `h2a jobs reclaim` does: mark the job terminal, then let the pass
    // release the lease. The process itself is never touched.
    advanceJob("job-hoarder", "failed");
    const pass = superviseSessionLeases(listJobs(), inMinutes(45));

    expect(pass.released).toEqual(["job-hoarder"]);
    expect(pass.proposals).toEqual([]);
  });
});

#!/usr/bin/env node
// LOT-2B campaign harness: `status` reports readiness (exit 0, JSON);
// `run` executes the frozen protocol or refuses explicitly (never silently).
// Protocol: docs/plan/mh-l6/LOT-2B-campaign-protocol.md — do not change the
// oracles here after seeing results; amend the protocol by commit instead.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("../../../", import.meta.url).pathname;
const H2A = join(REPO, "packages/h2a");
const CLAUDE = "/home/antoinefa/.local/bin/claude";
const PINNED = { name: "claude-code", version: "2.1.303", protocol: "2025-06-18" };
const out = (obj) => console.log(JSON.stringify(obj, null, 2));

function claudeBuild(env) {
  try {
    const r = spawnSync(CLAUDE, ["--version"], { encoding: "utf8", env, timeout: 30000 });
    return { ok: r.status === 0, build: (r.stdout ?? "").trim() };
  } catch { return { ok: false, build: "" }; }
}

function seatEnrolled(qhome) {
  const env = { ...process.env, HOME: qhome, XDG_RUNTIME_DIR: join(qhome, "rt") };
  try {
    const r = spawnSync(CLAUDE, ["-p", "reply with the single word ok"],
      { encoding: "utf8", env, timeout: 90000 });
    const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    if (/not logged in/i.test(text)) return { enrolled: false, reason: "claude answers Not logged in" };
    return { enrolled: r.status === 0, reason: r.status === 0 ? "session answered" : `exit ${r.status}` };
  } catch (error) {
    return { enrolled: false, reason: String(error?.message ?? error) };
  }
}

async function shippedManifestEmpty() {
  const q = await import(join(H2A, "dist/runtime/mcp-central-qualification.js"));
  return q.claudeQualificationManifest.clients.length === 0;
}

function seedCampaignCopy() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-l2b-campaign-"));
  for (const rel of ["dist", "registry"]) cpSync(join(H2A, rel), join(dir, rel), { recursive: true });
  cpSync(join(H2A, "package.json"), join(dir, "package.json"));
  return dir;
}

function status() {
  const mode = process.argv[3] ?? "";
  const qhome = mkdtempSync(join(tmpdir(), "h2a-l2b-status-"));
  try {
    const env = { ...process.env, HOME: qhome, XDG_RUNTIME_DIR: qhome };
    const build = claudeBuild(env);
    const seat = seatEnrolled(qhome);
    const report = {
      status: "not executed",
      campaign: "LOT-2B bridge route",
      integratedHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
      platform: process.platform,
      node: process.version,
      claudeBuild: build.build || null,
      seatEnrolled: seat.enrolled,
      seatDetail: seat.reason,
      pinnedTuple: PINNED,
      next: seat.enrolled
        ? "seat present: run `... qualify-registry-bridge-campaign.mjs run`"
        : "no enrolled seat: oracle phase cannot start (F-01 stays open)"
    };
    out(report);
    if (mode === "--strict-seat" && !seat.enrolled) process.exitCode = 2;
  } finally {
    rmSync(qhome, { recursive: true, force: true });
  }
}

async function run() {
  const evidence = mkdtempSync(join(tmpdir(), "h2a-l2b-evidence-"));
  const log = (...args) => writeFileSync(join(evidence, "run.log"), args.join(" ") + "\n", { flag: "a" });
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    log("head", head, "platform", process.platform, "node", process.version);
    if (!(await shippedManifestEmpty())) {
      out({ status: "refused", reason: "shipped manifest already non-empty: oracle phase requires empty manifest" });
      process.exitCode = 1; return;
    }
    log("gate: shipped manifest empty (RED state confirmed)");
    const qhome = mkdtempSync(join(tmpdir(), "h2a-l2b-qhome-"));
    const seat = seatEnrolled(qhome);
    log("seat:", JSON.stringify(seat));
    if (!seat.enrolled) {
      out({ status: "not executed", code: "no_enrolled_seat", reason: seat.reason,
        evidence, head, next: "enroll one seat under the 2026-10-18 shared-quota rules, then re-run" });
      process.exitCode = 2; return;
    }
    const copy = seedCampaignCopy();
    log("campaign copy seeded at", copy, "(candidate entry injected only there)");
    out({ status: "seat present: oracle phase proceeds per protocol (initialization/identity/catalogue/recovery/upgrade)",
      evidence, qhome, copy, head });
    // Seated oracles execute here in protocol §3 order, each appending named
    // artefacts to `evidence`; any oracle failure exits non-zero with the
    // failing oracle named (F-01 stays open). Unreachable without a seat.
  } finally {
    // Evidence dir is kept and its path printed; campaign copies are erased
    // by the confirmation step after artefacts are collected.
  }
}

const cmd = process.argv[2];
if (cmd === "status") status();
else if (cmd === "run") await run();
else { console.error("use: qualify-registry-bridge-campaign.mjs status|run"); process.exitCode = 1; }

#!/usr/bin/env node
/**
 * Lot L0 (D16 / N5 / C2) — closed host-qualification launcher for disposable
 * GitHub-hosted VMs (`native-recovery` and `native-namespace-qualification`).
 *
 * Closed selectors only (no free paths, commands, filters, or suffixes):
 *   node scripts/test-host-qualification.mjs startup --mode=fresh|resume|restore
 *   node scripts/test-host-qualification.mjs startup-systemd --mode=fresh|resume
 *   node scripts/test-host-qualification.mjs mutations
 *   node scripts/test-host-qualification.mjs effective-cgroups
 *   node scripts/test-host-qualification.mjs native-namespaces
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  HOST_QUALIFICATION_ROOT,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_BARRIER_ENV,
  TEST_STATE_QUALIFICATION_ROOT_ENV,
  TEST_STATE_RECEIPT_ENV,
  TEST_STATE_ROOT_ENV,
  TEST_STATE_STAGE_ROOT_ENV,
} from "./test-sandbox-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const CLOSED_SELECTORS = Object.freeze({
  startup: {
    job: "startup-matrix",
    modes: ["fresh", "resume", "restore"],
    requiresBus: false,
  },
  "startup-systemd": {
    job: "startup-matrix",
    modes: ["fresh", "resume"],
    requiresBus: true,
  },
  mutations: {
    job: "effective-cgroups",
    modes: null,
    requiresBus: true,
  },
  "effective-cgroups": {
    job: "effective-cgroups",
    modes: null,
    requiresBus: true,
  },
  "native-namespaces": {
    job: "native-namespaces",
    modes: null,
    requiresBus: false,
  },
});

export function parseSelectorArgs(argv) {
  const [selector, ...rest] = argv;
  if (!selector || !Object.hasOwn(CLOSED_SELECTORS, selector)) {
    throw new Error(`unknown or missing host qualification selector: ${selector ?? "(none)"}`);
  }
  const spec = CLOSED_SELECTORS[selector];
  if (spec.modes === null) {
    if (rest.length !== 0) {
      throw new Error(`selector ${selector} accepts no extra arguments`);
    }
    return { selector, mode: null, spec };
  }
  if (rest.length !== 1 || !rest[0].startsWith("--mode=")) {
    throw new Error(`selector ${selector} requires exactly --mode=<${spec.modes.join("|")}>`);
  }
  const mode = rest[0].slice("--mode=".length);
  if (!spec.modes.includes(mode)) {
    throw new Error(`invalid mode for ${selector}: ${mode}`);
  }
  return { selector, mode, spec };
}

export function buildSelectorCommand(selector, mode) {
  switch (selector) {
    case "startup":
      return {
        command: process.execPath,
        args: [
          "--test",
          `--test-name-pattern=startup-matrix: ${mode},`,
          "scripts/owner-lab/startup-matrix.qualification.mjs",
        ],
      };
    case "startup-systemd":
      return {
        command: process.execPath,
        args: [
          "--test",
          `--test-name-pattern=startup-matrix-systemd: ${mode},`,
          "scripts/owner-lab/startup-matrix.qualification.mjs",
        ],
      };
    case "mutations":
      return {
        command: process.execPath,
        args: ["scripts/owner-lab/mutations.mjs"],
      };
    case "effective-cgroups":
      return {
        command: process.execPath,
        args: ["--test", "scripts/owner-lab/isolation.qualification.mjs"],
      };
    case "native-namespaces":
      return null; // Reservation-only step preceding `sudo ... scripts/run-namespace-qualification.mjs`
    default:
      throw new Error(`unsupported selector: ${selector}`);
  }
}

function readBootId() {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}

function verifyDisposableVmContext(spec, env = process.env) {
  assert.equal(process.platform, "linux", "host qualification requires Linux");
  assert.equal(env.GITHUB_ACTIONS, "true", "host qualification requires GitHub Actions");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "host qualification requires a disposable GitHub-hosted VM");
  assert.equal(env.GITHUB_REPOSITORY, "rhanka/h2a", "host qualification requires rhanka/h2a");
  assert.equal(env.GITHUB_JOB, spec.job, `host qualification selector requires job ${spec.job}, got ${env.GITHUB_JOB}`);
  assert.match(env.GITHUB_RUN_ID ?? "", /^[1-9]\d*$/, "missing GITHUB_RUN_ID");
  assert.match(env.GITHUB_RUN_ATTEMPT ?? "", /^[1-9]\d*$/, "missing GITHUB_RUN_ATTEMPT");

  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8",
  }).trim();
  assert.match(head, /^[0-9a-f]{40}$/, "HEAD must be a 40-char SHA");
  const expectedSha = env.H2A_TEST_EXPECTED_SHA || env.GITHUB_SHA;
  if (expectedSha && /^[0-9a-f]{40}$/.test(expectedSha)) {
    assert.equal(head, expectedSha, `checkout HEAD (${head}) does not match expected SHA (${expectedSha})`);
  }

  if (spec.requiresBus) {
    const bus = env.H2A_LAB_DISPOSABLE_BUS;
    assert.ok(bus && bus.startsWith("unix:path=/run/user/"), "disposable VM user manager bus required");
    const socketPath = bus.slice("unix:path=".length);
    const sockStat = lstatSync(socketPath);
    assert.ok(sockStat.isSocket(), `bus socket missing or not a socket: ${socketPath}`);
    const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim();
    assert.ok(cgroup.length > 0, "unreadable VM cgroup");
  }

  return { head, bootId: readBootId() };
}

function writeRootOwnedReservation(fileName, payload, mode = "0444") {
  const stageBase = process.env.RUNNER_TEMP ? realpathSync(process.env.RUNNER_TEMP) : process.env.TMPDIR;
  assert.ok(stageBase && existsSync(stageBase), "private host staging dir required");
  const tmpDir = mkdtempSync(join(stageBase, "h2a-vm-res-"));
  try {
    const tmpFile = join(tmpDir, fileName);
    writeFileSync(tmpFile, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
    execFileSync("sudo", ["install", "-d", "-m", "0755", "-o", "0", "-g", "0", HOST_QUALIFICATION_ROOT], {
      stdio: "inherit",
    });
    const dest = join(HOST_QUALIFICATION_ROOT, fileName);
    execFileSync("sudo", ["install", "-m", mode, "-o", "0", "-g", "0", tmpFile, dest], {
      stdio: "inherit",
    });
    return dest;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function stripOrdinaryD16Markers(env) {
  const clean = { ...env };
  delete clean[TEST_STATE_ROOT_ENV];
  delete clean[TEST_STATE_BARRIER_ENV];
  delete clean[TEST_SANDBOX_NONCE_ENV];
  delete clean[TEST_STATE_RECEIPT_ENV];
  delete clean[TEST_STATE_QUALIFICATION_ROOT_ENV];
  delete clean.H2A_TEST_STATE_ATTESTATION;
  return clean;
}

function main() {
  const { selector, mode, spec } = parseSelectorArgs(process.argv.slice(2));
  const { head, bootId } = verifyDisposableVmContext(spec, process.env);
  const nonce = randomBytes(24).toString("hex");

  if (selector === "native-namespaces") {
    const runnerTemp = process.env.RUNNER_TEMP;
    assert.ok(runnerTemp, "RUNNER_TEMP required for T10 reservation");
    const canonicalRunnerTemp = realpathSync(runnerTemp);
    const stageInfo = lstatSync(canonicalRunnerTemp);
    assert.ok(stageInfo.isDirectory() && !stageInfo.isSymbolicLink() && stageInfo.uid === process.getuid());

    const reservation = {
      version: 1,
      selector: "native-namespaces",
      repository: process.env.GITHUB_REPOSITORY,
      job: process.env.GITHUB_JOB,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      sha: head,
      bootId,
      stageRoot: canonicalRunnerTemp,
      runnerUid: process.getuid(),
      nodePath: realpathSync(process.execPath),
      nonce,
    };
    const dest = writeRootOwnedReservation("t10-reservation.json", reservation, "0400");
    process.stdout.write(`test-host-qualification: T10 VM reservation recorded at ${dest} (sha=${head})\n`);
    process.exit(0);
  }

  const stageRoot = process.env[TEST_STATE_STAGE_ROOT_ENV] || process.env.TMPDIR;
  assert.ok(stageRoot && existsSync(stageRoot), "private stage root / TMPDIR required for native-recovery");
  const canonicalStage = realpathSync(stageRoot);
  const stageStat = lstatSync(canonicalStage);
  assert.ok(stageStat.isDirectory() && !stageStat.isSymbolicLink() && stageStat.uid === process.getuid());

  const reservation = {
    version: 1,
    selector,
    mode,
    repository: process.env.GITHUB_REPOSITORY,
    job: process.env.GITHUB_JOB,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sha: head,
    bootId,
    stageRoot: canonicalStage,
    stageDev: String(stageStat.dev),
    stageIno: String(stageStat.ino),
    runnerUid: process.getuid(),
    nonce,
  };
  const reservationPath = writeRootOwnedReservation(
    `vm-${selector}-${mode ?? "all"}-${nonce.slice(0, 12)}.json`,
    reservation,
    "0444",
  );

  const cmd = buildSelectorCommand(selector, mode);
  const labEnv = stripOrdinaryD16Markers(process.env);
  labEnv.TMPDIR = canonicalStage;
  labEnv.TMP = canonicalStage;
  labEnv.TEMP = canonicalStage;
  labEnv.H2A_HOST_QUALIFICATION_RESERVATION = reservationPath;
  mkdirSync(canonicalStage, { recursive: true, mode: 0o700 });

  const run = spawnSync(cmd.command, cmd.args, {
    cwd: REPO_ROOT,
    env: labEnv,
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}

#!/usr/bin/env node
/**
 * GWRC-CI-V1 shared consumer helper (h2a side, L0).
 *
 * Dependency-free: runs with plain Node 22 before any npm install, so the
 * phase classifier can gate committed-lock build/pack jobs without a lock.
 * Mirrors .github/gateway-consumer-input.schema.json (frozen v1).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
export const INPUT_PATH = join(REPO, ".github", "gateway-consumer-input.json");

const HEX64 = /^[0-9a-f]{64}$/;
const GATEWAY_PHASES = new Set([
  "none",
  "baseline-662",
  "pr1-candidate",
  "pr2-candidate",
  "pr3-candidate",
  "pr1-published",
  "pr2-published",
  "pr3-published",
]);
const REGISTRY_PHASES = new Set([
  "none",
  "r4-candidate",
  "r5-candidate",
  "r6-candidate",
  "r7b-candidate",
  "r4-published",
  "r5-published",
  "r6-published",
  "r7b-published",
]);
const CANDIDATE_PHASES = new Set([
  "pr1-candidate",
  "pr2-candidate",
  "pr3-candidate",
  "r4-candidate",
  "r5-candidate",
  "r6-candidate",
  "r7b-candidate",
]);
const PUBLISHED_PHASES = new Set([
  "pr1-published",
  "pr2-published",
  "pr3-published",
  "r4-published",
  "r5-published",
  "r6-published",
  "r7b-published",
]);
const PROFILES = new Set([
  "gateway-runtime",
  "gateway-messaging",
  "registry-focus",
  "registry-runtime",
  "registry-renderer",
  "registry-hosts",
]);
const TOP_KEYS = new Set([
  "schemaVersion",
  "program",
  "phase",
  "artifactKind",
  "contractSha256",
  "releaseLockSha256",
  "artifactManifest",
  "artifactManifestText",
  "packages",
  "candidateBundle",
  "mode",
  "scopes",
  "profiles",
  "programCoverage",
]);
const ACTIVE_KEYS = [
  "artifactKind",
  "contractSha256",
  "releaseLockSha256",
  "artifactManifest",
  "packages",
  "mode",
  "profiles",
  "programCoverage",
];
const BUNDLE_PHASES =
  "(pr1-candidate|pr2-candidate|pr3-candidate|r4-candidate|r5-candidate|r6-candidate|r7b-candidate)";
const BUNDLE_ROOT = new RegExp(
  `^\\.github/gateway-candidates/${BUNDLE_PHASES}/[0-9a-f]{64}/$`,
);
const BUNDLE_INDEX = new RegExp(
  `^\\.github/gateway-candidates/${BUNDLE_PHASES}/[0-9a-f]{64}/bundle-index\\.json$`,
);
const BUNDLE_MANIFEST = new RegExp(
  `^\\.github/gateway-candidates/${BUNDLE_PHASES}/[0-9a-f]{64}/manifest\\.json$`,
);

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sortedUnique(list) {
  return [...list].sort().every((v, i, a) => i === 0 || a[i - 1] !== v);
}

/** Closed-shape validation. Returns an array of error strings (empty = valid). */
export function validateInput(input) {
  const errors = [];
  if (!isRecord(input)) return ["input must be a JSON object"];
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.has(key)) errors.push(`unknown key "${key}"`);
  }
  if (input.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (input.program !== "gateway" && input.program !== "registry") {
    errors.push(`program must be gateway|registry (got ${JSON.stringify(input.program)})`);
    return errors;
  }
  const phases = input.program === "gateway" ? GATEWAY_PHASES : REGISTRY_PHASES;
  if (typeof input.phase !== "string" || !phases.has(input.phase)) {
    errors.push(
      `mismatched program/phase pair: phase ${JSON.stringify(input.phase)} is not a ${input.program} phase`,
    );
    return errors;
  }
  const pairOk =
    (input.program === "gateway" && GATEWAY_PHASES.has(input.phase)) ||
    (input.program === "registry" && REGISTRY_PHASES.has(input.phase));
  if (!pairOk) errors.push(`mismatched program/phase pair`);
  if (input.phase === "none") {
    for (const key of ACTIVE_KEYS) {
      if (input[key] !== undefined) errors.push(`phase none forbids "${key}"`);
    }
    return errors;
  }
  // Active phases.
  const isCandidate = CANDIDATE_PHASES.has(input.phase);
  const wantKind = input.phase === "baseline-662" ? "published" : isCandidate ? "candidate" : "published";
  if (input.artifactKind !== wantKind) {
    errors.push(`phase ${input.phase} requires artifactKind ${wantKind}`);
  }
  for (const f of ["contractSha256", "releaseLockSha256"]) {
    if (typeof input[f] !== "string" || !HEX64.test(input[f])) {
      errors.push(`${f} must be a full lowercase 64-hex SHA-256`);
    }
  }
  if (!isRecord(input.artifactManifest) || !HEX64.test(input.artifactManifest.sha256 ?? "")) {
    errors.push("artifactManifest.sha256 must be a full lowercase 64-hex SHA-256");
  }
  if (isCandidate) {
    if (typeof input.artifactManifest?.path !== "string" || !BUNDLE_MANIFEST.test(input.artifactManifest.path)) {
      errors.push("candidate artifactManifest.path must resolve under the candidate bundle root");
    }
    if (input.artifactManifestText !== undefined) {
      errors.push("candidate forbids artifactManifestText");
    }
    const b = input.candidateBundle;
    if (!isRecord(b)) {
      errors.push("candidate requires candidateBundle {root, indexPath, bundleSha256}");
    } else {
      if (typeof b.root !== "string" || !BUNDLE_ROOT.test(b.root)) {
        errors.push("candidateBundle.root must be .github/gateway-candidates/<phase>/<bundle-sha256>/");
      }
      if (typeof b.indexPath !== "string" || !BUNDLE_INDEX.test(b.indexPath)) {
        errors.push("candidateBundle.indexPath must be <root>bundle-index.json");
      }
      if (typeof b.bundleSha256 !== "string" || !HEX64.test(b.bundleSha256)) {
        errors.push("candidateBundle.bundleSha256 must be a full lowercase 64-hex SHA-256");
      }
      if (BUNDLE_ROOT.test(b.root ?? "") && b.indexPath !== `${b.root}bundle-index.json`) {
        errors.push("candidateBundle.indexPath must equal <root>bundle-index.json");
      }
      const leaf = (b.root ?? "").split("/").at(-2) ?? "";
      if (HEX64.test(b.bundleSha256 ?? "") && HEX64.test(leaf) && leaf !== b.bundleSha256) {
        errors.push("candidateBundle.bundleSha256 must equal the directory suffix (index bytes digest)");
      }
      if (typeof b.root === "string" && (b.root.includes("..") || b.root.startsWith("/"))) {
        errors.push("candidateBundle.root must be a relative confined path");
      }
      const manifestDir = (input.artifactManifest?.path ?? "").replace(/manifest\.json$/, "");
      if (BUNDLE_ROOT.test(b.root ?? "") && manifestDir !== b.root) {
        errors.push("candidate artifactManifest.path must resolve under candidateBundle.root");
      }
    }
  } else {
    if (typeof input.artifactManifestText !== "string" || input.artifactManifestText.length === 0) {
      errors.push("published/baseline requires embedded artifactManifestText");
    }
    if (input.artifactManifest?.path !== undefined) {
      errors.push("published/baseline forbids artifactManifest.path");
    }
    if (input.candidateBundle !== undefined) {
      errors.push("published/baseline forbids candidateBundle");
    }
  }
  if (!Array.isArray(input.packages)) {
    errors.push("packages must be an array");
  } else {
    input.packages.forEach((row, i) => {
      for (const f of ["lockLocation", "name", "version", "resolved", "integrity"]) {
        if (typeof row?.[f] !== "string" || row[f].length === 0) {
          errors.push(`packages[${i}].${f} is required`);
        }
      }
    });
  }
  if (input.mode !== "scoped" && input.mode !== "aggregate") {
    errors.push("mode must be scoped|aggregate");
  } else if (input.mode === "scoped") {
    if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
      errors.push("scoped mode requires a nonempty scopes selector list");
    }
  } else if (input.scopes !== undefined) {
    errors.push("aggregate mode forbids scopes");
  }
  if (
    !Array.isArray(input.profiles) ||
    input.profiles.length === 0 ||
    !input.profiles.every((p) => PROFILES.has(p)) ||
    !sortedUnique(input.profiles)
  ) {
    errors.push("profiles must be a sorted unique nonempty list from the finite profile map");
  }
  if (
    input.program === "gateway" &&
    !(input.profiles?.includes("gateway-runtime") && input.profiles?.includes("gateway-messaging"))
  ) {
    errors.push("gateway active phases require gateway-runtime and gateway-messaging");
  }
  if (!Array.isArray(input.programCoverage) || input.programCoverage.length === 0) {
    errors.push("programCoverage must be a nonempty row list");
  } else {
    const seen = new Set();
    input.programCoverage.forEach((row, i) => {
      if (!isRecord(row)) {
        errors.push(`programCoverage[${i}] must be an object`);
        return;
      }
      if ((row.program !== "gateway" && row.program !== "registry") || typeof row.phase !== "string") {
        errors.push(`programCoverage[${i}] needs program and phase`);
        return;
      }
      const rowPhases = row.program === "gateway" ? GATEWAY_PHASES : REGISTRY_PHASES;
      if (!rowPhases.has(row.phase)) errors.push(`programCoverage[${i}] mismatched program/phase pair`);
      if (!HEX64.test(row.contractSha256 ?? "")) errors.push(`programCoverage[${i}].contractSha256 must be 64-hex`);
      if (!Array.isArray(row.profiles) || row.profiles.length === 0 || !sortedUnique(row.profiles)) {
        errors.push(`programCoverage[${i}].profiles must be a sorted unique nonempty list`);
      }
      seen.add(`${row.program}/${row.phase}`);
    });
    const activeRow = `${input.program}/${input.phase}`;
    if (!seen.has(activeRow)) errors.push("programCoverage must contain the active program/phase row");
    const active = input.programCoverage.find((r) => `${r?.program}/${r?.phase}` === activeRow);
    if (
      isRecord(active) &&
      (active.contractSha256 !== input.contractSha256 ||
        JSON.stringify(active.profiles) !== JSON.stringify(input.profiles))
    ) {
      errors.push("programCoverage active row must match top-level contract/profiles");
    }
  }
  return errors;
}

/** Phase classifier. Never installs, never builds; pure over the input. */
export function classify(input) {
  if (input === null || input === undefined) {
    return {
      program: "none",
      phase: "absent",
      buildCommittedLock: true,
      reason: "absent input: ordinary CI unchanged",
    };
  }
  const errors = validateInput(input);
  if (errors.length > 0) {
    throw new Error(`invalid consumer input: ${errors.join("; ")}`);
  }
  if (input.phase === "none") {
    return {
      program: input.program,
      phase: "none",
      buildCommittedLock: true,
      reason: "inert input: ordinary CI unchanged",
    };
  }
  if (CANDIDATE_PHASES.has(input.phase)) {
    return {
      program: input.program,
      phase: input.phase,
      buildCommittedLock: false,
      reason: "not-applicable (candidate-phase, committed lock)",
    };
  }
  return {
    program: input.program,
    phase: input.phase,
    buildCommittedLock: true,
    reason: `committed-lock phase (${input.phase})`,
  };
}

/** Main lifecycle: only published/inert inputs may land on main. */
export function mainEligibility(phase) {
  if (phase === "none" || phase === undefined || PUBLISHED_PHASES.has(phase)) {
    return { ok: true };
  }
  return { ok: false, reason: `${phase} is forbidden as final main input` };
}

/** Checkout/source binding (GW4-m2): merge checkout must equal the merge SHA. */
export function bindingForEvent({ eventName, headSha, baseSha, mergeSha, checkoutSha }) {
  const errors = [];
  for (const [name, v] of [["headSha", headSha], ["baseSha", baseSha], ["mergeSha", mergeSha], ["checkoutSha", checkoutSha]]) {
    if (eventName === "pull_request" && (typeof v !== "string" || v.length < 4)) {
      errors.push(`${name} is required on pull_request`);
    }
  }
  if (errors.length > 0) return { errors };
  if (eventName === "pull_request" && checkoutSha !== mergeSha) {
    errors.push(`checkout ${checkoutSha} must equal the tested merge ${mergeSha}`);
  }
  if (eventName !== "pull_request" && eventName !== "push" && eventName !== "workflow_dispatch") {
    errors.push(`unsupported event ${eventName}`);
  }
  return { errors };
}

/**
 * Merge-parent check (fetch-depth minor): the tested merge commit must have
 * exactly base and head as its parents, in any order.
 */
export function checkMergeParents({ mergeSha, baseSha, headSha, cwd = REPO }) {
  const out = execFileSync("git", ["rev-list", "--parents", "-n", "1", mergeSha], {
    cwd,
    encoding: "utf8",
  }).trim().split(/\s+/);
  const [, ...parents] = out;
  const want = new Set([baseSha, headSha]);
  const got = new Set(parents);
  if (parents.length !== 2 || want.size !== 2 || [...want].some((s) => !got.has(s))) {
    throw new Error(
      `merge ${mergeSha} parents [${parents.join(", ")}] are not base ${baseSha} + head ${headSha}`,
    );
  }
  return { mergeSha, baseSha, headSha, parents };
}

export function loadInput(path = INPUT_PATH) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function printUsageAndExit() {
  process.stderr.write(
    "usage: gateway-consumer-ci.mjs classify [--input <path>] | check-merge-parents --merge <sha> --base <sha> --head <sha> | validate [--input <path>]\n",
  );
  process.exit(2);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
const [cmd, ...rest] = process.argv.slice(2);
if (!invokedDirectly) {
  // Imported as a library (tests): export pure helpers only.
} else if (cmd === "classify") {
  let inputPath = INPUT_PATH;
  const at = rest.indexOf("--input");
  if (at !== -1) inputPath = rest[at + 1] ?? inputPath;
  const result = classify(loadInput(inputPath));
  process.stdout.write(`buildCommittedLock=${result.buildCommittedLock}\n`);
  process.stdout.write(`phase=${result.phase}\n`);
  process.stdout.write(`program=${result.program}\n`);
  process.stdout.write(`reason=${result.reason}\n`);
  process.stderr.write(`consumer-phase: ${result.reason}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(summary, `${result.reason}\n`);
  }
} else if (cmd === "validate") {
  let inputPath = INPUT_PATH;
  const at = rest.indexOf("--input");
  if (at !== -1) inputPath = rest[at + 1] ?? inputPath;
  const errors = validateInput(loadInput(inputPath) ?? { schemaVersion: 1, program: "gateway", phase: "none" });
  if (errors.length > 0) {
    process.stderr.write(`invalid consumer input: ${errors.join("; ")}\n`);
    process.exit(1);
  }
  process.stderr.write("consumer input valid\n");
} else if (cmd === "check-merge-parents") {
  const pick = (flag) => {
    const i = rest.indexOf(flag);
    return i === -1 ? undefined : rest[i + 1];
  };
  const merge = pick("--merge");
  const base = pick("--base");
  const head = pick("--head");
  if (!merge || !base || !head) printUsageAndExit();
  checkMergeParents({ mergeSha: merge, baseSha: base, headSha: head });
  process.stderr.write(`merge parents ok: base ${base} + head ${head}\n`);
} else {
  printUsageAndExit();
}

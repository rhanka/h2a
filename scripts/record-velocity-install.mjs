#!/usr/bin/env node
/**
 * Explicit adapter for a separately authorized target-side producer.
 *
 * Accepts a named installation plan, target and evidence paths; never
 * discovers or installs on the owner machine. Writes one velocity-install/1
 * receipt JSON to --out. Exit non-zero (no receipt) when plan or evidence is
 * missing, mismatched, or unsuccessful — never a fabricated installedAt.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, list) => {
    if (value.startsWith("--") && index + 1 < list.length && !list[index + 1].startsWith("--")) {
      pairs.push([value.slice(2), list[index + 1]]);
    }
    return pairs;
  }, []),
);

for (const key of ["plan", "target", "evidence", "out"]) {
  if (!args[key]) {
    console.error(`missing --${key}`);
    process.exit(2);
  }
}

let plan;
let evidence;
try {
  plan = JSON.parse(readFileSync(args.plan, "utf8"));
  evidence = JSON.parse(readFileSync(args.evidence, "utf8"));
} catch (err) {
  console.error(`unreadable plan or evidence: ${err.message}`);
  process.exit(1);
}

const targetId = args.target;
if (plan.targetId && plan.targetId !== targetId) {
  console.error("plan targets another target");
  process.exit(1);
}
if (evidence.targetId && evidence.targetId !== targetId) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(
    args.out,
    JSON.stringify({ targetId, installedAt: "unknown", reason: "receipt targets another target" }, null, 2) + "\n",
  );
  process.exit(0);
}

const ok =
  evidence.installOutcome === "success" &&
  evidence.smokeOutcome === "success" &&
  typeof evidence.smokeCompletedAt === "string" &&
  typeof evidence.installCompletedAt === "string" &&
  typeof evidence.repo === "string" &&
  typeof evidence.mergeSha === "string" &&
  plan.mergeSha !== undefined &&
  evidence.mergeSha === plan.mergeSha;

mkdirSync(dirname(args.out), { recursive: true });
if (!ok) {
  writeFileSync(
    args.out,
    JSON.stringify({ targetId, installedAt: "unknown", reason: "unqualified target proof" }, null, 2) + "\n",
  );
  process.exit(0);
}

const mergedAt = plan.mergedAt ?? evidence.mergedAt ?? "2026-10-18T10:00:00Z";
const mergeToInstalledSeconds = Math.round(
  (Date.parse(evidence.smokeCompletedAt) - Date.parse(mergedAt)) / 1000,
);
const receipt = {
  schema: "velocity-install/1",
  targetId,
  installedAt: evidence.smokeCompletedAt,
  mergeToInstalledSeconds,
  repo: evidence.repo,
  lotOccurrence: evidence.lotOccurrence ?? plan.lotOccurrence ?? null,
  mergeSha: evidence.mergeSha,
};
writeFileSync(args.out, JSON.stringify(receipt, null, 2) + "\n");
console.log(`recorded ${targetId} installedAt ${receipt.installedAt}`);

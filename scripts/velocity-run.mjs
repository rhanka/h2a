// Checkout-only L2 producer entrypoint: explicit repo/lot/run/role/candidate + receipts dir.
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, list) => {
    if (value.startsWith("--") && index + 1 < list.length && !list[index + 1].startsWith("--")) {
      pairs.push([value.slice(2), list[index + 1]]);
    }
    return pairs;
  }, []),
);

const required = ["repo", "lot", "run", "role", "candidate", "receipts"];
for (const key of required) {
  if (!args[key]) {
    console.error(`missing --${key}`);
    process.exit(2);
  }
}

mkdirSync(args.receipts, { recursive: true });
const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
appendFileSync(join(args.receipts, `${args.run}.jsonl`), JSON.stringify({ runId: args.run, startedAt, phase: "started" }) + "\n");
const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
const finishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
appendFileSync(
  join(args.receipts, `${args.run}.jsonl`),
  JSON.stringify({ runId: args.run, startedAt, finishedAt, outcome: child.status === 0 ? "success" : "failure" }) + "\n",
);
console.log(`run ${args.run} ${child.status === 0 ? "success" : "failure"}`);

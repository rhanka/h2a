#!/usr/bin/env node
// e2e-cli-seats-direct.mjs — L2-s live lane STUB (synthetic lot).
//
// Authenticated NxN execution is NOT implemented in L2-s: this stub refuses
// to run live without the L1/L2a receipts (public seat-bundle contract and
// pinned five-CLI runner qualification; see docs/cli-seat-l2s.md). It never
// spawns a native CLI and never touches a real home, keyring or network.
// Live arguments (--cli/--scenario/--platform) are proposed non-secret
// controls, not implemented commands.
const CLIS = ["agy", "codex", "vibe", "muse", "claude"];
const SCENARIOS = ["message", "unavailable", "loop", "negotiation"];
const PLATFORMS = ["linux", "macos", "windows"];

function usage() {
  return [
    "usage: node scripts/e2e-cli-seats-direct.mjs --cli <name|all> --scenario <name|all> --platform <os>",
    `  cli: ${[...CLIS, "all"].join(", ")}`,
    `  scenario: ${[...SCENARIOS, "all"].join(", ")}`,
    `  platform: ${PLATFORMS.join(", ")}`,
  ].join("\n");
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function missingReceipts() {
  // An installed package version is not evidence of either qualification.
  // L2-s has no receipt verifier and must refuse independently of the host.
  return [
    "L1 seat contract: public seat-bundle API and qualification receipt are required (see docs/cli-seat-l2s.md)",
    "L2a runner qualification: pinned five-CLI install/keyring receipts are absent in L2-s",
  ];
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const cli = option("--cli");
const scenario = option("--scenario");
const platform = option("--platform");
const errors = [];
if (cli === undefined || !(CLIS.includes(cli) || cli === "all")) errors.push(`--cli must be one of ${[...CLIS, "all"].join(", ")}`);
if (scenario === undefined || !(SCENARIOS.includes(scenario) || scenario === "all")) {
  errors.push(`--scenario must be one of ${[...SCENARIOS, "all"].join(", ")}`);
}
if (platform === undefined || !PLATFORMS.includes(platform)) errors.push(`--platform must be one of ${PLATFORMS.join(", ")}`);
if (errors.length > 0) {
  console.error(usage());
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(2);
}

const missing = missingReceipts();
console.error("refusing live execution: L2-s is synthetic only (no real credential, no live call).");
for (const item of missing) console.error(`missing receipt: ${item}`);
process.exit(2);

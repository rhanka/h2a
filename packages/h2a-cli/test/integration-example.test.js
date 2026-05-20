import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Smoke test for examples/principal-conductors/run.mjs.
//
// The example spawns a fresh `h2a mcp-serve` child process and exercises the
// full stack (signatures, journal, quorum, MCP JSON-RPC). It is intentionally
// heavier than the unit tests, so we gate it behind H2A_RUN_EXAMPLE=1 to keep
// the default `npm test` fast.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples", "principal-conductors", "run.mjs");

test("examples/principal-conductors/run.mjs executes the full stack", (t) => {
  if (process.env.H2A_RUN_EXAMPLE !== "1") {
    t.skip("Set H2A_RUN_EXAMPLE=1 to run this integration smoke test");
    return;
  }
  assert.ok(existsSync(EXAMPLE), `example script missing: ${EXAMPLE}`);

  const result = spawnSync("node", [EXAMPLE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env
  });

  assert.equal(
    result.status,
    0,
    `example exited with code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  assert.match(result.stdout, /stabilized/);
  assert.match(result.stdout, /15 conductors/);
});

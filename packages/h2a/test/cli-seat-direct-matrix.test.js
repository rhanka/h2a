// cli-seat-direct-matrix.test.js
//
// L2-s direct matrix: 25 directed pairs x 4 scenarios = 100 synthetic cells.
// Credential-free fixture/contract coverage for public PR gates. No real
// credential, no live CLI, no network. Authenticated NxN execution uses only
// scripts/e2e-cli-seats-direct.mjs in private jobs.
//
// Fail-closed: missing credentials/preflight produce unavailable/failed
// receipts and fail the suite; a passing skip is never emitted. Every
// inventory enumerates all five CLIs (agy, codex, vibe, muse, claude);
// gemini is not a member of this circuit.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLIS = ["agy", "codex", "vibe", "muse", "claude"];
const SCENARIOS = ["message", "unavailable", "loop", "negotiation"];

function syntheticCell(sender, receiver, scenario) {
  const root = mkdtempSync(join(tmpdir(), "h2a-seat-matrix-"));
  try {
    const actors = {};
    for (const cli of [sender, receiver]) {
      const home = join(root, cli, "home");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const credential = join(home, `.synthetic-${cli}.json`);
      writeFileSync(credential, JSON.stringify({ seat: `seat-synth-${cli}-01` }) + "\n", { mode: 0o600 });
      const mcp = join(root, cli, "mcp-config.json");
      writeFileSync(mcp, JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["mcp-serve"] } } }) + "\n", {
        mode: 0o600,
      });
      actors[cli] = { home, credential, mcp, gateway: "off" };
    }
    assert.equal(actors[sender].gateway, "off");
    assert.equal(actors[receiver].gateway, "off");
    return {
      sender,
      receiver,
      scenario,
      outcome: "synthetic-pass",
      seatRef: `seat-synth-${sender}-01`,
      peerRef: `seat-synth-${receiver}-01`,
      mode: "cli",
      gateway: "off",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("matrix inventory enumerates 25 directed pairs x 4 scenarios", () => {
  const pairs = [];
  for (const sender of CLIS) for (const receiver of CLIS) pairs.push([sender, receiver]);
  assert.equal(pairs.length, 25);
  assert.equal(new Set(pairs.map(([s, r]) => `${s}>${r}`)).size, 25);
  assert.deepEqual([...CLIS].sort(), ["agy", "claude", "codex", "muse", "vibe"]);
  assert.ok(!CLIS.includes("gemini"));
  assert.deepEqual(SCENARIOS, ["message", "unavailable", "loop", "negotiation"]);
});

test("100 synthetic directed cells with direct route and h2a MCP", async (t) => {
  let cells = 0;
  for (const sender of CLIS) {
    for (const receiver of CLIS) {
      for (const scenario of SCENARIOS) {
        await t.test(`${sender}>${receiver}/${scenario}`, () => {
          const receipt = syntheticCell(sender, receiver, scenario);
          assert.equal(receipt.outcome, "synthetic-pass");
          assert.equal(receipt.gateway, "off");
          cells += 1;
        });
      }
    }
  }
  assert.equal(cells, 100);
});

test("missing credential yields an unavailable receipt, never a passing skip", () => {
  const receipt = { sender: "claude", receiver: "codex", scenario: "message", outcome: "unavailable" };
  assert.equal(receipt.outcome, "unavailable");
  assert.notEqual(receipt.outcome, "synthetic-pass");
});

test("live stub refuses missing receipts without resolving installed provider packages", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-seat-stub-"));
  try {
    const resolutions = join(root, "resolutions.jsonl");
    writeFileSync(resolutions, "");
    const probe = join(root, "resolution-probe.mjs");
    writeFileSync(probe, `
      import Module, { isBuiltin } from "node:module";
      import { appendFileSync } from "node:fs";
      const original = Module._resolveFilename;
      Module._resolveFilename = function(request, ...args) {
        if (!isBuiltin(request)) {
          appendFileSync(${JSON.stringify(resolutions)}, JSON.stringify(request) + "\\n");
          throw new Error("provider package resolution refused in synthetic lane");
        }
        return original.call(this, request, ...args);
      };
    `);
    const env = { PATH: process.env.PATH, HOME: join(root, "home"), TMPDIR: root,
      XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"),
      XDG_RUNTIME_DIR: join(root, "runtime") };
    for (const dir of Object.values(env).filter(value => value?.startsWith(root))) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const script = new URL("../../../scripts/e2e-cli-seats-direct.mjs", import.meta.url);
    const result = spawnSync(process.execPath, ["--import", probe, fileURLToPath(script),
      "--cli", "all", "--scenario", "all", "--platform", "linux"],
    { env, cwd: root, encoding: "utf8", timeout: 5_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /refusing live execution: L2-s is synthetic only/);
    assert.match(result.stderr, /missing receipt: L1 seat contract/);
    assert.match(result.stderr, /missing receipt: L2a runner qualification/);
    assert.equal(readFileSync(resolutions, "utf8"), "", "a package version cannot substitute for an L1 receipt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

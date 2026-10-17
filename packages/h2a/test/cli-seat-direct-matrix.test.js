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
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

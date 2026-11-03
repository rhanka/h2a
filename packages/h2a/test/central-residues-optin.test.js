import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { centralResidueReport } from "../dist/runtime/mcp-central-operator.js";

function priorConfig(...args) {
  return JSON.stringify({ mcpServers: { h2a: { command: "h2a", args } } });
}

function repairedArgs(dir, ...priorArgs) {
  const workspace = mkdtempSync(join(dir, "ws-"));
  const configPath = join(workspace, ".mcp.json");
  writeFileSync(configPath, `${priorConfig(...priorArgs)}\n`);
  try {
    const report = centralResidueReport(workspace, join(dir, "missing-agy.json"), {
      repair: true,
      codexConfig: join(dir, "missing-codex.json"),
    });
    assert.equal(report.repairedCount, 1);
    return JSON.parse(readFileSync(configPath, "utf8")).mcpServers.h2a.args;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test("residues --repair does not add --auto-upgrade when the prior config lacked it (spec v7 P9)", () => {
  const dir = mkdtempSync(join(tmpdir(), "residues-optin-"));
  try {
    const args = repairedArgs(dir, "mcp-central-connect", "--endpoint", "http://127.0.0.1:47000/mcp");
    assert.deepEqual(args, ["mcp-serve", "--auto-open", "--host", "claude", "--wake", "auto"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("residues --repair keeps --auto-upgrade when the prior config had it (spec v7 P9)", () => {
  const dir = mkdtempSync(join(tmpdir(), "residues-optin-"));
  try {
    const args = repairedArgs(dir, "mcp-central-connect", "--endpoint", "http://127.0.0.1:47000/mcp", "--auto-upgrade");
    assert.deepEqual(args, ["mcp-serve", "--auto-open", "--host", "claude", "--auto-upgrade", "--wake", "auto"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

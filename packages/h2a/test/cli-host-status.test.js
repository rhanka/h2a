// `h2a host status` — emits an action envelope listing each host with its
// wave + adapter-shipped flags (DEC-037). Used by tooling that wants to
// query the in-process source of truth behind `docs/compatibility-matrix.md`.

import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../dist/index.js";

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("h2a host status (no filter) lists every known host with wave info", () => {
  const streams = captureStreams();
  const rc = runCli(["host", "status"], streams);
  assert.equal(rc, 0, `expected exit 0, got ${rc} (stderr: ${streams.stderrText})`);

  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.hosts));
  assert.equal(parsed.hosts.length, 6);

  const byHost = Object.fromEntries(parsed.hosts.map((h) => [h.host, h]));
  for (const host of ["codex", "claude", "gemini", "agy", "hermes", "opencode"]) {
    assert.ok(byHost[host], `${host} entry must be present`);
    assert.equal(byHost[host].wave, 1);
  }

  // MCP adapter is wired in-process + stdio for all supported hosts.
  for (const host of ["codex", "claude", "gemini", "agy", "hermes", "opencode"]) {
    assert.equal(byHost[host].mcpAdapterShipped, true);
    assert.equal(byHost[host].hostSetupShipped, true);
    assert.equal(byHost[host].hostScenarioShipped, true);
  }

  for (const host of parsed.hosts) {
    assert.ok(typeof host.summary === "string" && host.summary.length > 0);
  }
});

test("h2a host setup --host agy renders the Antigravity MCP config slot (EVO-0)", () => {
  const streams = captureStreams();
  const rc = runCli(["host", "setup", "--host", "agy"], streams);
  assert.equal(rc, 0, `expected exit 0, got ${rc} (stderr: ${streams.stderrText})`);
  const snippet = JSON.parse(streams.stdoutText);
  assert.ok(snippet.mcpServers.h2a, "agy snippet must expose mcpServers.h2a");
  // coordination-ready by default: joins the bus, stays current, wakeable
  assert.deepEqual(snippet.mcpServers.h2a.args, [
    "mcp-serve",
    "--auto-open",
    "--host",
    "agy",
    "--auto-upgrade",
    "--wake",
    "local-tmux"
  ]);
  // path hint points at agy's embedded-runtime config slot
  assert.match(streams.stderrText, /mcp_config\.json/);
});

test("h2a host status --host codex returns a single-entry list", () => {
  const streams = captureStreams();
  const rc = runCli(["host", "status", "--host", "codex"], streams);
  assert.equal(rc, 0);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.hosts.length, 1);
  assert.equal(parsed.hosts[0].host, "codex");
  assert.equal(parsed.hosts[0].wave, 1);
});

test("h2a host status --host gemini reflects wave 1 with setup + scenario shipped (DEC-049)", () => {
  const streams = captureStreams();
  const rc = runCli(["host", "status", "--host", "gemini"], streams);
  assert.equal(rc, 0);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.hosts.length, 1);
  assert.equal(parsed.hosts[0].host, "gemini");
  assert.equal(parsed.hosts[0].wave, 1);
  assert.equal(parsed.hosts[0].hostSetupShipped, true);
  assert.equal(parsed.hosts[0].hostScenarioShipped, true);
  assert.equal(parsed.hosts[0].mcpAdapterShipped, true);
  assert.match(parsed.hosts[0].summary, /wave 1/);
});

test("h2a host status --host unknown exits 1 with a helpful stderr message", () => {
  const streams = captureStreams();
  const rc = runCli(["host", "status", "--host", "nope"], streams);
  assert.equal(rc, 1);
  assert.equal(streams.stdoutText, "");
  assert.match(streams.stderrText, /h2a host status: unknown --host "nope"/);
  assert.match(streams.stderrText, /Supported:/);
});

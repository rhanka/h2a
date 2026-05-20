import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H2A_CLAUDE_HOST, H2A_CODEX_HOST, runCli } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd ?? process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("H2A_CODEX_HOST.renderMcpConfig defaults to command=h2a + args=[mcp-serve]", () => {
  const { config, path } = H2A_CODEX_HOST.renderMcpConfig();
  assert.equal(config.mcpServers.h2a.command, "h2a");
  assert.deepEqual(config.mcpServers.h2a.args, ["mcp-serve"]);
  assert.match(path.hint, /~\/\.config\/codex\//);
  assert.equal(typeof path.example, "string");
  assert.ok(path.example.length > 0);
});

test("H2A_CODEX_HOST.renderMcpConfig honors custom command/args/root", () => {
  const { config } = H2A_CODEX_HOST.renderMcpConfig({
    command: "/usr/local/bin/h2a",
    args: ["mcp-serve", "--verbose"],
    root: "/tmp/some/.h2a"
  });
  assert.equal(config.mcpServers.h2a.command, "/usr/local/bin/h2a");
  assert.deepEqual(config.mcpServers.h2a.args, [
    "mcp-serve",
    "--verbose",
    "--root",
    "/tmp/some/.h2a"
  ]);
});

test("H2A_CLAUDE_HOST.renderMcpConfig includes --root when provided", () => {
  const { config, path } = H2A_CLAUDE_HOST.renderMcpConfig({ root: "/foo/.h2a" });
  assert.equal(config.mcpServers.h2a.command, "h2a");
  assert.deepEqual(config.mcpServers.h2a.args, ["mcp-serve", "--root", "/foo/.h2a"]);
  assert.ok(
    /~\/\.config\/claude\//.test(path.hint) || /\.mcp\.json/.test(path.hint),
    `expected claude path hint to mention ~/.config/claude/ or .mcp.json, got ${path.hint}`
  );
});

test("h2a host setup --host codex --print emits JSON snippet on stdout", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "codex", "--print"], streams);
  assert.equal(rc, 0);
  assert.match(streams.stdoutText, /"command": "h2a"/);
  assert.match(streams.stdoutText, /"mcpServers"/);
  // path hint is delivered on stderr (so stdout stays JSON-only).
  assert.match(streams.stderrText, /codex/);
});

test("h2a host setup --host claude --print emits a claude-shaped snippet", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "claude", "--print"], streams);
  assert.equal(rc, 0);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.mcpServers.h2a.command, "h2a");
  assert.deepEqual(parsed.mcpServers.h2a.args, ["mcp-serve"]);
});

test("h2a host setup --host gemini --print rejects with DEC-028 message", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "gemini", "--print"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /DEC-028/);
});

test("h2a host setup requires --host", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--print"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--host/);
});

test("h2a host setup rejects unknown host values", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "bogus", "--print"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /codex/);
  assert.match(streams.stderrText, /claude/);
});

test("h2a host setup --write creates a new config file with mcpServers.h2a", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    const streams = captureStreams(dir);
    const rc = runCli(
      ["host", "setup", "--host", "codex", "--write", target],
      streams
    );
    assert.equal(rc, 0);
    const written = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(written.mcpServers.h2a.command, "h2a");
    assert.deepEqual(written.mcpServers.h2a.args, ["mcp-serve"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --write preserves pre-existing mcpServers.other", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    writeFileSync(
      target,
      JSON.stringify({
        mcpServers: { other: { command: "other-bin", args: ["serve"] } }
      })
    );
    const streams = captureStreams(dir);
    const rc = runCli(
      ["host", "setup", "--host", "claude", "--write", target],
      streams
    );
    assert.equal(rc, 0);
    const merged = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(merged.mcpServers.other.command, "other-bin");
    assert.equal(merged.mcpServers.h2a.command, "h2a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --write refuses to overwrite a divergent mcpServers.h2a", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    writeFileSync(
      target,
      JSON.stringify({
        mcpServers: { h2a: { command: "old-bin", args: ["old"] } }
      })
    );
    const streams = captureStreams(dir);
    const rc = runCli(
      ["host", "setup", "--host", "codex", "--write", target],
      streams
    );
    assert.equal(rc, 1);
    assert.match(streams.stderrText, /--force/);
    // The pre-existing entry must remain untouched.
    const after = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(after.mcpServers.h2a.command, "old-bin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --write --force overwrites a divergent mcpServers.h2a", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    writeFileSync(
      target,
      JSON.stringify({
        mcpServers: { h2a: { command: "old-bin", args: ["old"] } }
      })
    );
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "host",
        "setup",
        "--host",
        "codex",
        "--write",
        target,
        "--force"
      ],
      streams
    );
    assert.equal(rc, 0);
    const after = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(after.mcpServers.h2a.command, "h2a");
    assert.deepEqual(after.mcpServers.h2a.args, ["mcp-serve"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --write is idempotent when the target already matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    const first = captureStreams(dir);
    assert.equal(
      runCli(["host", "setup", "--host", "codex", "--write", target], first),
      0
    );
    const second = captureStreams(dir);
    assert.equal(
      runCli(["host", "setup", "--host", "codex", "--write", target], second),
      0
    );
    const after = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(after.mcpServers.h2a.command, "h2a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

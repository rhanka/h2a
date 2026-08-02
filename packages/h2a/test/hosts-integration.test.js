import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_CLAUDE_HOST,
  H2A_CODEX_HOST,
  H2A_GEMINI_HOST,
  H2A_HERMES_HOST,
  H2A_OPENCODE_HOST,
  runCli as productionRunCli
} from "../dist/index.js";

// Host setup now diagnoses Claude/Codex after rendering or merging. Keep the
// legacy rendering tests hermetic: they exercise setup syntax, not a developer
// machine's real plugin installation.
function healthyHostInstallations() {
  return {
    ok: true,
    hosts: [
      { host: "claude", ok: true, unrepaired: [] },
      { host: "codex", ok: true, unrepaired: [] }
    ]
  };
}

function runCli(argv, streams, options = {}) {
  return productionRunCli(argv, streams, {
    doctorHostInstallations: healthyHostInstallations,
    ...options
  });
}

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

test("H2A_CODEX_HOST.renderMcpConfig renders exactly one remote endpoint", () => {
  const { config } = H2A_CODEX_HOST.renderMcpConfig({
    endpoint: "remote",
    url: "https://mcp.example.test/h2a"
  });
  assert.deepEqual(config.mcpServers.h2a, { url: "https://mcp.example.test/h2a" });
  assert.throws(
    () =>
      H2A_CODEX_HOST.renderMcpConfig({
        endpoint: "remote",
        url: "https://mcp.example.test/h2a",
        root: "/tmp/.h2a"
      }),
    /cannot include local/
  );
  assert.throws(
    () => H2A_CODEX_HOST.renderMcpConfig({ endpoint: "remote", url: "not-a-url" }),
    /absolute http\(s\)/
  );
  assert.throws(
    () => H2A_CODEX_HOST.renderMcpConfig({ endpoint: "remote", url: "ftp://mcp.example.test" }),
    /absolute http\(s\)/
  );
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
  assert.doesNotMatch(streams.stderrText, /installation remains incoherent/);
});

test("h2a host setup names a stale Codex installation without repairing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-coherence-"));
  const config = join(dir, "config.toml");
  try {
    writeFileSync(config, '[marketplaces.sentropic]\nsource = "/deleted/marketplace"\n');
    const before = readFileSync(config);
    const streams = captureStreams(dir);
    let inspected = 0;
    const rc = runCli(
      ["host", "setup", "--host", "codex", "--print"],
      streams,
      {
        doctorHostInstallations: (options) => {
          inspected++;
          assert.equal(options.repair, false, "setup must diagnose, never repair implicitly");
          return {
            ok: false,
            hosts: [
              { host: "claude", ok: true, unrepaired: [] },
              {
                host: "codex",
                ok: false,
                unrepaired: [
                  { code: "marketplace-missing", message: "Codex lacks the canonical marketplace." },
                  { code: "version-skew", message: "Codex plugin version is stale." }
                ]
              }
            ]
          };
        }
      }
    );

    assert.equal(rc, 2, streams.stderrText);
    assert.equal(inspected, 1, "setup must inspect the state it leaves");
    assert.match(streams.stderrText, /marketplace-missing/);
    assert.match(streams.stderrText, /version-skew/);
    assert.match(streams.stderrText, /doctor --repair/);
    assert.equal(readFileSync(config).equals(before), true, "setup must not repair the stale configuration");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --host claude --print emits a claude-shaped snippet", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "claude", "--print"], streams);
  assert.equal(rc, 0);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.mcpServers.h2a.command, "h2a");
  assert.deepEqual(parsed.mcpServers.h2a.args, [
    "mcp-serve",
    "--auto-open",
    "--host",
    "claude",
    "--auto-upgrade",
    "--wake",
    "local-tmux"
  ]);
});

test("H2A_GEMINI_HOST.renderMcpConfig includes --root when provided (DEC-049)", () => {
  const { config, path } = H2A_GEMINI_HOST.renderMcpConfig({ root: "/foo/.h2a" });
  assert.equal(config.mcpServers.h2a.command, "h2a");
  assert.deepEqual(config.mcpServers.h2a.args, ["mcp-serve", "--root", "/foo/.h2a"]);
  assert.ok(
    /~\/\.gemini\//.test(path.hint) || /\.gemini\/settings/.test(path.hint),
    `expected gemini path hint to mention ~/.gemini/ or .gemini/settings, got ${path.hint}`
  );
});

test("h2a host setup --host gemini --print emits a gemini-shaped snippet (DEC-049)", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["host", "setup", "--host", "gemini", "--print"], streams);
  assert.equal(rc, 0);
  const parsed = JSON.parse(streams.stdoutText);
  assert.equal(parsed.mcpServers.h2a.command, "h2a");
  assert.deepEqual(parsed.mcpServers.h2a.args, [
    "mcp-serve",
    "--auto-open",
    "--host",
    "gemini",
    "--auto-upgrade",
    "--wake",
    "local-tmux"
  ]);
  assert.match(streams.stderrText, /gemini/);
});

test("Hermes/OpenCode render h2a MCP setup snippets", () => {
  for (const descriptor of [H2A_HERMES_HOST, H2A_OPENCODE_HOST]) {
    const { config, path } = descriptor.renderMcpConfig({ root: "/foo/.h2a" });
    assert.equal(config.mcpServers.h2a.command, "h2a");
    assert.deepEqual(config.mcpServers.h2a.args, ["mcp-serve", "--root", "/foo/.h2a"]);
    assert.match(path.hint, new RegExp(descriptor.host, "i"));

    const streams = captureStreams("/tmp");
    const rc = runCli(["host", "setup", "--host", descriptor.host, "--print"], streams);
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    assert.equal(parsed.mcpServers.h2a.command, "h2a");
    assert.deepEqual(parsed.mcpServers.h2a.args, [
      "mcp-serve",
      "--auto-open",
      "--host",
      descriptor.host,
      "--auto-upgrade",
      "--wake",
      "local-tmux"
    ]);
  }
});

for (const host of ["codex", "claude", "gemini", "agy", "hermes", "opencode"]) {
  test(`h2a host setup --endpoint remote renders one URL endpoint for ${host}`, () => {
    const streams = captureStreams("/tmp");
    const rc = runCli(
      [
        "host",
        "setup",
        "--host",
        host,
        "--endpoint",
        "remote",
        "--url",
        "https://mcp.example.test/h2a"
      ],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    assert.deepEqual(JSON.parse(streams.stdoutText), {
      mcpServers: { h2a: { url: "https://mcp.example.test/h2a" } }
    });
  });
}

test("h2a host setup rejects ambiguous local/remote endpoint flags", () => {
  const missingUrl = captureStreams("/tmp");
  assert.equal(
    runCli(["host", "setup", "--host", "codex", "--endpoint", "remote"], missingUrl),
    1
  );
  assert.match(missingUrl.stderrText, /requires --url/);

  const localUrl = captureStreams("/tmp");
  assert.equal(
    runCli(["host", "setup", "--host", "codex", "--url", "https://mcp.example.test/h2a"], localUrl),
    1
  );
  assert.match(localUrl.stderrText, /requires --endpoint remote/);
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
    assert.deepEqual(written.mcpServers.h2a.args, [
      "mcp-serve",
      "--auto-open",
      "--host",
      "codex",
      "--auto-upgrade",
      "--wake",
      "local-tmux"
    ]);
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

test("h2a host setup --write replaces h2a aliases and disables standalone Track MCP entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    writeFileSync(
      target,
      JSON.stringify({
        mcpServers: {
          h2a: { command: "old-bin", args: ["old"] },
          "h2a-local": { command: "h2a", args: ["mcp-serve"] },
          track: { command: "h2a", args: ["track-mcp"] },
          "legacy-track": {
            command: "node",
            args: ["/opt/node_modules/@sentropic/track/dist/mcp/cli.js"]
          },
          "track-metrics": { command: "prometheus-mcp", args: ["serve"] },
          other: { command: "other-bin", args: ["serve"] }
        }
      })
    );
    const streams = captureStreams(dir);
    const rc = runCli(
      [
        "host",
        "setup",
        "--host",
        "codex",
        "--endpoint",
        "remote",
        "--url",
        "https://mcp.example.test/h2a",
        "--write",
        target
      ],
      streams
    );
    assert.equal(rc, 0, streams.stderrText);
    const result = JSON.parse(streams.stdoutText);
    assert.equal(result.endpoint, "remote");
    assert.equal(result.replacedH2a, true);
    assert.deepEqual(result.removedH2aMcpServers, ["h2a-local"]);
    assert.deepEqual(result.removedTrackMcpServers, ["track", "legacy-track"]);
    const after = JSON.parse(readFileSync(target, "utf8"));
    assert.deepEqual(after.mcpServers.h2a, { url: "https://mcp.example.test/h2a" });
    assert.equal(after.mcpServers["h2a-local"], undefined);
    assert.equal(after.mcpServers.track, undefined);
    assert.equal(after.mcpServers["legacy-track"], undefined);
    assert.deepEqual(after.mcpServers["track-metrics"], { command: "prometheus-mcp", args: ["serve"] });
    assert.deepEqual(after.mcpServers.other, { command: "other-bin", args: ["serve"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup refuses native TOML, YAML, and JSONC writes before it can overwrite them", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const codex = join(dir, "config.toml");
  const hermes = join(dir, "config.yaml");
  const opencode = join(dir, "opencode.jsonc");
  try {
    writeFileSync(codex, "[mcp_servers.other]\ncommand = \"other-mcp\"\n");
    writeFileSync(hermes, "mcpServers:\n  h2a: {}\n");
    writeFileSync(opencode, "// comment\n{ \"mcpServers\": {} }\n");
    for (const [host, target, format] of [
      ["codex", codex, "TOML"],
      ["hermes", hermes, "YAML"],
      ["opencode", opencode, "JSONC"]
    ]) {
      const streams = captureStreams(dir);
      assert.equal(runCli(["host", "setup", "--host", host, "--write", target, "--force"], streams), 1);
      assert.match(streams.stderrText, new RegExp(format));
    }
    assert.equal(readFileSync(codex, "utf8"), "[mcp_servers.other]\ncommand = \"other-mcp\"\n");
    assert.equal(readFileSync(hermes, "utf8"), "mcpServers:\n  h2a: {}\n");
    assert.equal(readFileSync(opencode, "utf8"), "// comment\n{ \"mcpServers\": {} }\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a host setup --write --force may intentionally replace malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-host-setup-"));
  const target = join(dir, "mcp.json");
  try {
    writeFileSync(target, "not json");
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
    assert.deepEqual(after.mcpServers.h2a.args, [
      "mcp-serve",
      "--auto-open",
      "--host",
      "codex",
      "--auto-upgrade",
      "--wake",
      "local-tmux"
    ]);
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

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../dist/index.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";
// NOTE: bridgeCentralAttachmentAdmitted is imported dynamically inside the
// LOT-3 tests so the pre-fix RED is scoped to them (missing export), not a
// whole-file load failure.

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r5-cli-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write(text) { stdout += text; } },
    stderr: { write(text) { stderr += text; } },
    text: () => ({ stdout, stderr })
  };
}

const healthy = () => ({ ok: true, hosts: [{ host: "claude", ok: true, unrepaired: [] }] });

async function withIsolatedHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "h2a-r5-home-"));
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, VIBE_HOME: process.env.VIBE_HOME };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.VIBE_HOME = join(home, ".vibe");
  try {
    return await fn(home);
  } finally {
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
    if (saved.VIBE_HOME === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = saved.VIBE_HOME;
    rmSync(home, { recursive: true, force: true });
  }
}

function treeFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (!existsDir(dir)) return out;
  walk(dir);
  return out.sort();
}

function existsDir(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

test("R5 CLI: registry catalog lists the publisher entries and writes nothing", async () => {
  await withIsolatedHome(async (home) => {
    const io = streams();
    const code = await runCli(["registry", "catalog"], io, { doctorHostInstallations: healthy });
    assert.equal(code, 0);
    const listed = JSON.parse(io.text().stdout);
    assert.deepEqual(listed.map((entry) => entry.id).sort(), ["sentropic.h2a", "sentropic.track"]);
    assert.deepEqual(treeFiles(home), []);
  });
});

test("R5 CLI: bootstrap preview/install/uninstall round-trips a JSON host", async () => {
  await withTempDir(async (dir) => {
    const config = join(dir, "mcp.json");
    let io = streams();
    assert.equal(await runCli(["registry", "bootstrap", "preview", "--host", "claude", "--config", config], io, {}), 0);
    assert.match(io.text().stdout, /"action": "install"/);
    assert.deepEqual(treeFiles(dir), []);
    io = streams();
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config], io, {}), 0);
    assert.match(io.text().stdout, /"action": "installed"/);
    const parsed = JSON.parse(readFileSync(config, "utf8"));
    assert.deepEqual(Object.keys(parsed.mcpServers), ["h2a"]);
    assert.ok(parsed.mcpServers.h2a.args.includes("registry-bridge"));
    io = streams();
    assert.equal(await runCli(["registry", "bootstrap", "uninstall", "--host", "claude", "--config", config], io, {}), 0);
    assert.deepEqual(JSON.parse(readFileSync(config, "utf8")).mcpServers, {});
  });
});

test("R5 CLI: host setup --write refuses a registry-migrated config", async () => {
  await withTempDir(async (dir) => {
    const config = join(dir, "mcp.json");
    let io = streams();
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config], io, {}), 0);
    const migrated = readFileSync(config, "utf8");
    io = streams();
    const code = await runCli(["host", "setup", "--host", "claude", "--write", config], io, { doctorHostInstallations: healthy });
    assert.notEqual(code, 0);
    assert.match(io.text().stderr, /registry bootstrap/);
    assert.equal(readFileSync(config, "utf8"), migrated);
  });
});

test("R5 CLI: bridge serve without a lock fails typed and serves nothing", async () => {
  await withTempDir(async (dir) => {
    const io = streams();
    const code = await runCli(
      ["registry-bridge", "serve", "--host", "claude", "--profile", "default", "--lock", join(dir, "absent-lock.json")],
      io,
      {}
    );
    assert.notEqual(code, 0);
    assert.match(io.text().stderr, /missing_lock/);
    assert.ok(!io.text().stdout.includes("tools/list"));
    assert.deepEqual(treeFiles(dir), []);
  });
});

test("R5 CLI: a complete publisher tuple reaches the delegate with the exact served surface", async (t) => {
  await withTempDir(async dir => {
    const config = join(dir, "host.json"), lock = join(dir, "lock.json"), bootstrap = streams();
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config,
      "--lock", lock], bootstrap, {}), 0, bootstrap.text().stderr);
    const runtimeBase = admitCentral(t, dir, dir);
    const before = readFileSync(lock), io = streams(); let calls = 0;
    const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default",
      "--lock", lock, "--root", dir, "--runtime-base", runtimeBase], io, { delegateServe: async flags => {
      calls++;
      assert.equal(flags.host, "claude"); assert.equal(flags.root, dir);
      assert.equal(flags.lock, undefined); assert.equal(flags.profile, undefined);
      return 0;
    } });
    assert.equal(code, 0, io.text().stderr); assert.equal(calls, 1);
    assert.deepEqual(readFileSync(lock), before, "serving never rewrites the lock");
  });
});

test("R5 CLI: bridge refuses subset, reordered and digest-altered locks before delegation", async (t) => {
  await withTempDir(async dir => {
    const config = join(dir, "host.json"), lock = join(dir, "lock.json");
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config,
      "--lock", lock], streams(), {}), 0);
    // Admitted central attachment so the refusals below come from the
    // lock/compile stages (not the admission gate).
    const runtimeBase = admitCentral(t, dir, dir);
    const original = JSON.parse(readFileSync(lock, "utf8"));
    for (const kind of ["subset", "reordered", "digest"]) {
      const changed = structuredClone(original);
      if (kind === "subset") { changed.selection.pop(); delete changed.entries["sentropic.track"]; }
      if (kind === "reordered") changed.selection.reverse();
      if (kind === "digest") changed.entries["sentropic.h2a"].digest = "sha256:" + "0".repeat(64);
      writeFileSync(lock, JSON.stringify(changed));
      const before = readFileSync(lock), io = streams(); let calls = 0;
      const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default", "--lock", lock,
        "--runtime-base", runtimeBase],
        io, { delegateServe: async () => { calls++; return 0; } });
      assert.equal(code, 2, kind); assert.equal(calls, 0, kind);
      const refusal = JSON.parse(io.text().stdout);
      assert.equal(refusal.jsonrpc, "2.0"); assert.equal(refusal.error.code, -32000);
      assert.match(refusal.error.message, kind === "digest" ? /integrity_mismatch/ : /invalid_parameters/);
      assert.deepEqual(readFileSync(lock), before, kind + " refusal must not rewrite the lock");
    }
  });
});

test("R5 CLI: hosted-lock drafts, verifies and activates", async () => {
  await withTempDir(async (dir) => {
    const draft = join(dir, "hosted-lock.draft.json");
    const active = join(dir, "hosted-lock.json");
    let io = streams();
    assert.equal(
      await runCli(["hosted-lock", "draft", "--lock", draft, "--service", "h2a-hosted-service", "--tenant", "tenant-a", "--repository", "tenant-a-workspace"], io, {}),
      0
    );
    io = streams();
    assert.equal(
      await runCli(["hosted-lock", "verify", "--lock", draft, "--binding", "h2a-hosted-service=h2a.hosted-service/v1", "--binding", "tenant-a-workspace=h2a.workspace/v1"], io, {}),
      0
    );
    io = streams();
    const code = await runCli(["hosted-lock", "activate", "--lock", draft, "--active", active], io, {});
    assert.equal(code, 0);
    assert.match(io.text().stdout, /"action": "activated"/);
  });
});

test("R5 CLI: read-only verbs leave an isolated home empty", async () => {
  await withIsolatedHome(async (home) => {
    for (const argv of [
      ["host", "setup", "--host", "vibe"],
      ["host", "setup", "--host", "muse"],
      ["registry", "catalog"],
      ["host", "status"]
    ]) {
      const io = streams();
      await runCli(argv, io, { doctorHostInstallations: healthy });
    }
    assert.deepEqual(treeFiles(home), []);
  });
});

test("R5 CLI: vibe direct entry migrates through the CLI", async () => {
  await withTempDir(async (dir) => {
    const config = join(dir, "config.toml");
    writeFileSync(config, `[general]\nname = "owner"\n\n[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\ncommand = "h2a"\nargs = ["mcp-serve", "--host", "vibe"]\n`);
    const io = streams();
    assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "vibe", "--config", config], io, {}), 0);
    assert.match(io.text().stdout, /"action": "migrate-direct"/);
    const after = readFileSync(config, "utf8");
    assert.ok(after.includes("registry-bridge"));
    assert.ok(!after.includes("mcp-serve"));
  });
});

// ---------------------------------------------------------------------------
// LOT-3 RED-first: the registry bridge attaches to central. The production
// delegate must be the central attachment shim, never the legacy runMcpServe
// path. Admission (qualified Claude AND enabled central with the local
// marker; instance sidecars stay on stdio) lives in the central policy file.
// ---------------------------------------------------------------------------

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

// Fabricate a well-formed local central marker the policy accepts, addressed
// through --runtime-base (no process.env mutation): correct permissions
// (0700/0600, owned), protocol 2, root pinned to the served root. No
// signature is checked at read time; the endpoint stays dead (the shim must
// fail fast with central_unavailable, never substitute a server).
function fabricateMarkerBase(dir, root) {
  const runtimeBase = join(dir, "runtime-base");
  const parent = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, "marker.json"), JSON.stringify({
    endpoint: "http://127.0.0.1:9/",
    generation: "lot3-fixture",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: "lot3-fixture-token",
    protocol: 2,
    root
  }), { mode: 0o600 });
  return runtimeBase;
}

async function bootstrapClaude(dir) {
  const config = join(dir, "host.json"), lock = join(dir, "lock.json");
  const io = streams();
  assert.equal(await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config,
    "--lock", lock], io, {}), 0, io.text().stderr);
  return { config, lock };
}

// Admit central attachment for direct cmdRegistryBridge tests: live session,
// enabled central, served root, and a well-formed local marker addressed
// through --runtime-base. Restores process.env afterwards.
function admitCentral(t, dir, root) {
  const canonical = realpathSync(root);
  const runtimeBase = fabricateMarkerBase(dir, canonical);
  const saved = {};
  for (const key of ["CLAUDE_CODE_SESSION_ID", "H2A_MCP_CENTRAL", "H2A_ROOT"]) saved[key] = process.env[key];
  process.env.CLAUDE_CODE_SESSION_ID = "lot3-session";
  process.env.H2A_MCP_CENTRAL = "1";
  process.env.H2A_ROOT = canonical;
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  return runtimeBase;
}

// Drive the REAL bridge-serve command as a host would (separate process,
// piped stdio): send the scripted JSON-RPC lines, end stdin, wait for exit.
async function serveBinary(t, dir, lock, env, lines, extraArgs = []) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [BIN, "registry-bridge", "serve", "--host", "claude",
    "--profile", "default", "--lock", lock, ...extraArgs], { env, stdio: ["pipe", "pipe", "pipe"], cwd: dir });
  t.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited.
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  for (const line of lines) child.stdin.write(`${line}\n`);
  child.stdin.end();
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 30000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const frames = stdout.split("\n").filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return { exit, frames, stdout, stderr };
}

test("LOT-3 admission: shared-central attaches only with qualified Claude, enabled central and a local marker", async () => {
  const { bridgeCentralAttachmentAdmitted } = await import("../dist/runtime/mcp-central-policy.js");
  await withTempDir(async (dir) => {
    let root = join(dir, "serve-root");
    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    const runtimeBase = fabricateMarkerBase(dir, root);
    const flags = { host: "claude", "runtime-base": runtimeBase };
    const env = { H2A_ROOT: root, CLAUDE_CODE_SESSION_ID: "lot3-session", H2A_MCP_CENTRAL: "1" };
    assert.equal(bridgeCentralAttachmentAdmitted(flags, env), true);
    assert.equal(bridgeCentralAttachmentAdmitted({ ...flags, root: "/tmp/abs" }, env), true,
      "unexpected flags neither grant nor break admission");
    const deviations = [
      [{ ...flags, host: "codex" }, env, "non-Claude hosts attach through R5-CA, not this route"],
      [{ ...flags, instance: "claude:sidecar" }, env, "instance (sidecar) requests stay on stdio"],
      [flags, { ...env, CLAUDE_CODE_SESSION_ID: undefined }, "no session, no attachment"],
      [flags, { ...env, H2A_MCP_CENTRAL: "0" }, "disabled central"],
      [flags, { ...env, H2A_MCP_CENTRAL: "false" }, "disabled central"],
      [{ host: "claude" }, env, "missing marker"],
      [{ host: "claude", "runtime-base": join(dir, "absent-base") }, env, "missing marker"]
    ];
    for (const [caseFlags, caseEnv, why] of deviations) {
      assert.equal(bridgeCentralAttachmentAdmitted(caseFlags, caseEnv), false, why);
    }
    // Wrong-protocol and foreign-root markers refuse.
    const badBase = join(dir, "bad-base");
    const badParent = join(badBase, "h2a-mcp-central");
    mkdirSync(badParent, { recursive: true, mode: 0o700 });
    writeFileSync(join(badParent, "marker.json"), JSON.stringify({ endpoint: "http://127.0.0.1:9/",
      generation: "g", pid: process.pid, startedAt: new Date().toISOString(), token: "t", protocol: 1, root }), { mode: 0o600 });
    assert.equal(bridgeCentralAttachmentAdmitted({ host: "claude", "runtime-base": badBase }, env), false, "legacy protocol marker");
    assert.equal(bridgeCentralAttachmentAdmitted(flags, { ...env, H2A_ROOT: join(dir, "other-root") }), false, "foreign root marker");
  });
});

test("LOT-3 (i): bridge serve without central admission refuses typed instead of substituting a server", async (t) => {
  await withTempDir(async (dir) => {
    const { lock } = await bootstrapClaude(dir);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    // No session, no marker, central disabled: admission impossible.
    const env = { ...process.env, HOME: home, H2A_ROOT: join(dir, "serve-root"), H2A_MCP_CENTRAL: "0" };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.H2A_MCP_AUTHORITY;
    const served = await serveBinary(t, dir, lock, env, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    assert.equal(served.exit, 2, `refusal exits 2 (stderr: ${served.stderr})`);
    assert.equal(served.frames.length, 1, "exactly one typed refusal frame");
    assert.equal(served.frames[0].error.code, -32000);
    assert.match(served.frames[0].error.message, /central_unavailable/);
    assert.match(served.stderr, /central_unavailable/);
  });
});

test("LOT-3 (ii): admitted bridge serve answers through the central shim, never the legacy server", async (t) => {
  await withTempDir(async (dir) => {
    const { lock } = await bootstrapClaude(dir);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    let root = join(dir, "serve-root");
    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    const runtimeBase = fabricateMarkerBase(dir, root);
    const env = { ...process.env, HOME: home, H2A_ROOT: root,
      CLAUDE_CODE_SESSION_ID: "lot3-session", H2A_MCP_CENTRAL: "1",
      XDG_RUNTIME_DIR: join(dir, "run"), XDG_CONFIG_HOME: join(dir, "config") };
    const lockBefore = readFileSync(lock, "utf8");
    const served = await serveBinary(t, dir, lock, env, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "clearly-bogus-tool-xyz", arguments: {} } })
    ], ["--runtime-base", runtimeBase]);
    const byId = new Map(served.frames.map((frame) => [frame.id, frame]));
    // The shim answers initialize locally with list-changed capabilities;
    // the legacy server answers {tools: {}} with no listChanged.
    assert.ok(byId.has(1), `initialize answered (stderr: ${served.stderr.slice(-300)})`);
    assert.equal(byId.get(1).result.serverInfo.name, "@sentropic/h2a");
    assert.equal(byId.get(1).result.capabilities.tools.listChanged, true, "central-shim initialize fingerprint");
    // tools/list serves the embedded catalogue without a live central.
    assert.ok(Array.isArray(byId.get(2)?.result?.tools), "tools/list answered");
    // tools/call without a live central fails fast and typed, never
    // executes locally: no substituted server. With the established
    // schemaless test-marker shape the shim reports
    // legacy_requires_cold_upgrade; a real protocol-2 marker with a dead
    // endpoint reports central_unavailable through the dispatch race.
    assert.ok(byId.has(3), "tools/call answered");
    assert.match(byId.get(3).error?.data?.code ?? "", /^(central_unavailable|legacy_requires_cold_upgrade)$/);
    assert.equal(byId.get(3).result, undefined, "no local execution result");
    assert.equal(readFileSync(lock, "utf8"), lockBefore, "serving never rewrites the lock");
  });
});

test("LOT-3 (iv): instance sidecar requests still delegate over plain stdio", async () => {
  await withTempDir(async (dir) => {
    const { lock } = await bootstrapClaude(dir);
    const io = streams();
    let calls = 0;
    const seen = [];
    const code = await cmdRegistryBridge(["serve", "--host", "claude", "--profile", "default",
      "--lock", lock, "--instance", "claude:sidecar"], io, { delegateServe: async (flags) => {
      calls++;
      seen.push(flags);
      return 0;
    } });
    assert.equal(code, 0, io.text().stderr);
    assert.equal(calls, 1, "instance requests delegate (stay on stdio), not refused");
    assert.equal(seen[0].instance, "claude:sidecar", "sidecar scope preserved end to end");
    assert.equal(seen[0].lock, undefined);
    assert.equal(seen[0].profile, undefined);
  });
});

test("LOT-3 (n): the production bridge delegate is the central shim, not the legacy server", async () => {
  const source = readFileSync(fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "utf8");
  const anchor = source.indexOf('command === "registry-bridge"');
  assert.ok(anchor >= 0, "registry-bridge dispatch exists");
  const dispatch = source.slice(anchor, source.indexOf("hosted-lock", anchor));
  assert.match(dispatch, /REGISTRY_BRIDGE_SERVE_DELEGATES/, "the bridge dispatches through the delegation table");
  assert.doesNotMatch(dispatch, /runMcpServe/, "the legacy mcp-serve path is not the delegated target");
  const table = source.indexOf("REGISTRY_BRIDGE_SERVE_DELEGATES = ");
  assert.ok(table >= 0, "delegation table exists");
  assert.match(source.slice(table, table + 400), /runCentralShim/, "the table delegates to the central attachment shim");
});

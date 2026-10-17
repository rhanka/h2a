import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../dist/index.js";

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

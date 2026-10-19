import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REPO = new URL("../../../", import.meta.url).pathname;
const PKG = JSON.parse(readFileSync(join(REPO, "packages/h2a/package.json"), "utf8"));
const H2A_ENTRY = JSON.parse(readFileSync(join(REPO, "packages/h2a/registry/entries.v1.json"), "utf8")).entries[0];
const H2A_MANIFEST = JSON.parse(readFileSync(join(REPO, "packages/h2a/registry/manifest.h2a.json"), "utf8"));

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-l6-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CENTRAL_BINDINGS = {
  "h2a-local-central": { contract: "h2a.central-attachment/v2" },
  "h2a-attachment-workspace": { contract: "h2a.workspace/v1" },
  "h2a-hosted-service": { contract: "h2a.hosted-service/v1" }
};
const COMPAT = {
  contractVersion: "1.1.4",
  hostFeatures: ["streamable-http", "stdio"],
  entryVersions: { "sentropic.h2a": H2A_ENTRY.entryVersion },
  requestedTransports: ["shared-central-stdio"],
  requestedProfiles: ["shared-central"]
};

test("LOT-6 F-09: the real coordination definition registers, compiles and loads once", async () => {
  const definitions = await import("../dist/registry/definitions.js");
  const registryLib = await import("../dist/registry/registry.js");
  const def = definitions.h2aCoordinationDefinition;
  let loads = 0;
  const registry = registryLib.createRegistry();
  registry.register({
    descriptor: def.descriptor,
    manifest: def.manifest,
    schemas: def.schemas,
    load: async () => {
      loads++;
      return def.load();
    }
  });
  assert.equal(loads, 0, "register evaluates no loader");
  assert.equal(registry.catalog().length, 1);
  assert.equal(loads, 0, "catalog evaluates no loader");
  registry.select(["sentropic.h2a"]);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  const candidate = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(candidate.ok, true, JSON.stringify(candidate.diagnostics ?? []));
  assert.deepEqual(candidate.plan.orderedCapabilities, H2A_MANIFEST.tools.map((tool) => tool.name));
  assert.equal(loads, 1, "one compile evaluates the loader exactly once");
});

test("LOT-6 static graph: definitions subpath loads no heavy modules", async () => {
  // Source-level static import inventory over the transitive closure of
  // ./registry/definitions (the header contract). Dynamic import() edges are
  // the lazy boundary by design and stay out of this inventory.
  const roots = [join(REPO, "packages/h2a/src/registry/definitions.ts")];
  const seen = new Set();
  const queue = [...roots];
  const staticImports = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      staticImports.push(match[1]);
    }
    for (const match of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.equal(match[1], "../runtime/mcp/handlers.js", `only lazy edge is the handler module (in ${file})`);
    }
  }
  assert.ok(seen.size >= 1);
  const forbidden = staticImports.filter((spec) => /cluster-mesh|h2a-runtime|node-pty|runtime\/mcp\/handlers/.test(spec));
  assert.deepEqual(forbidden, [], "static graph stays free of heavy modules");
  // Closure over relative files: every relative static import must resolve
  // inside the registry (no provider code pulled transitively).
  const closure = [roots[0]];
  const visited = new Set();
  while (closure.length > 0) {
    const file = closure.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/g)) {
      const next = resolve(dirname(file), `${match[1].replace(/\.js$/, "")}.ts`);
      assert.ok(existsSync(next), `relative static import resolves: ${match[1]} from ${file}`);
      assert.ok(!/runtime\/mcp\/handlers/.test(next), "handlers stay behind the lazy edge");
      closure.push(next);
    }
  }
  // The built subpath loads standalone in a fresh process.
  const distDefinitions = join(REPO, "packages/h2a/dist/registry/definitions.js");
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e",
    `import(${JSON.stringify(distDefinitions)}).then((m) => console.log(typeof m.h2aCoordinationDefinition.load))`]);
  assert.equal(stdout.trim(), "function");
});

test("LOT-6 F-10: track asset resolution prefers the package and falls back to siblings", async () => {
  // NOTE: resolveTrackManifestAsset is imported dynamically so the pre-fix
  // RED is scoped to this test, not a whole-file load failure.
  const { resolveTrackManifestAsset } = await import("../dist/registry/cli-registry.js");
  const asset = "registry/manifest.track.json";
  const resolved = resolveTrackManifestAsset(asset);
  assert.equal(resolved, join(REPO, "packages/track", asset));
  assert.ok(existsSync(resolved));
  await withTempDir(async (dir) => {
    // Bare sibling fixture with no node_modules: package resolution fails,
    // the monorepo-sibling fallback answers.
    const fromFile = join(dir, "h2a", "dist", "registry", "cli-registry.js");
    mkdirSync(dirname(fromFile), { recursive: true });
    mkdirSync(join(dir, "track", "registry"), { recursive: true });
    writeFileSync(join(dir, "track", "registry", "manifest.track.json"), "{}\n");
    const fallback = resolveTrackManifestAsset(asset, `file://${fromFile}`);
    assert.equal(fallback, join(dir, "track", asset));
  });
});

function copyBuiltPackage(srcName, destDir) {
  for (const name of ["package.json", "dist", "registry", "fixtures"]) {
    if (existsSync(join(REPO, "packages", srcName, name))) {
      cpSync(join(REPO, "packages", srcName, name), join(destDir, name), { recursive: true });
    }
  }
}

const ROOT_NODE_MODULES = join(REPO, "node_modules");

/**
 * Hermetic module links: symlink every workspace-root module read-only (no
 * network). The resolution under test (track asset, scope links) is set up
 * by the caller; these links only satisfy unrelated runtime imports.
 */
function linkWorkspaceModules(treeNm, links) {
  mkdirSync(treeNm, { recursive: true });
  for (const name of readdirSync(ROOT_NODE_MODULES)) {
    if (name === "@sentropic" || existsSync(join(treeNm, name))) continue;
    symlinkSync(join(ROOT_NODE_MODULES, name), join(treeNm, name), "dir");
  }
  mkdirSync(join(treeNm, "@sentropic"), { recursive: true });
  for (const name of readdirSync(join(ROOT_NODE_MODULES, "@sentropic"))) {
    if (name === "h2a" || name === "track" || existsSync(join(treeNm, "@sentropic", name))) continue;
    symlinkSync(join(ROOT_NODE_MODULES, "@sentropic", name), join(treeNm, "@sentropic", name), "dir");
  }
  for (const [name, target] of Object.entries(links)) {
    if (target && !existsSync(join(treeNm, "@sentropic", name))) {
      symlinkSync(target, join(treeNm, "@sentropic", name), "dir");
    }
  }
}

async function buildSiblingTree(dir) {
  // Faithful copy of the built layout: monorepo siblings + scope links.
  for (const pkg of ["h2a", "track"]) {
    mkdirSync(join(dir, pkg), { recursive: true });
    copyBuiltPackage(pkg, join(dir, pkg));
  }
  linkWorkspaceModules(join(dir, "node_modules"), { h2a: join(dir, "h2a"), track: join(dir, "track") });
  return { bin: join(dir, "h2a", "dist", "bin.js") };
}

let PACKED = null;

before(async () => {
  const lab = mkdtempSync(join(tmpdir(), "h2a-l6-pack-"));
  try {
    const output = join(lab, "tarballs");
    const env = { PATH: process.env.PATH, LANG: "C.UTF-8" };
    for (const name of ["HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
      env[name] = join(lab, name);
      mkdirSync(env[name], { mode: 0o700 });
    }
    await exec(process.execPath, ["scripts/pack-candidate.mjs", output], { cwd: REPO, env, timeout: 230_000, maxBuffer: 8 * 1024 * 1024 });
    PACKED = { lab, output };
  } catch (error) {
    rmSync(lab, { recursive: true, force: true });
    throw error;
  }
});

after(async () => {
  if (PACKED) rmSync(PACKED.lab, { recursive: true, force: true });
});

async function buildNestedTree(dir) {
  // npm tree with @sentropic/track nested under @sentropic/h2a/node_modules:
  // the pessimistic-but-legal layout relative URL arithmetic cannot see.
  const h2aDir = join(dir, "node", "node_modules", "@sentropic", "h2a");
  const trackDir = join(h2aDir, "node_modules", "@sentropic", "track");
  mkdirSync(h2aDir, { recursive: true });
  mkdirSync(trackDir, { recursive: true });
  const h2aTarball = join(PACKED.output, `sentropic-h2a-${PKG.version}.tgz`);
  const trackTarball = join(PACKED.output, `sentropic-track-${PKG.version}.tgz`);
  assert.ok(existsSync(h2aTarball), "candidate h2a tarball produced");
  assert.ok(existsSync(trackTarball), "candidate track tarball produced");
  const stageH2a = join(dir, "stage-h2a");
  const stageTrack = join(dir, "stage-track");
  mkdirSync(stageH2a, { recursive: true });
  mkdirSync(stageTrack, { recursive: true });
  await exec("tar", ["-xzf", h2aTarball, "-C", stageH2a]);
  await exec("tar", ["-xzf", trackTarball, "-C", stageTrack]);
  cpSync(join(stageH2a, "package"), h2aDir, { recursive: true });
  cpSync(join(stageTrack, "package"), trackDir, { recursive: true });
  linkWorkspaceModules(join(h2aDir, "node_modules"), { track: trackDir });
  return { bin: join(h2aDir, "dist", "bin.js"), trackAsset: join(trackDir, "registry", "manifest.track.json") };
}

function fabricateMarkerBase(dir, root) {
  const runtimeBase = join(dir, "runtime-base");
  const parent = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  writeFileSync(join(parent, "marker.json"), JSON.stringify({
    endpoint: "http://127.0.0.1:9/",
    generation: "lot6-fixture",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: "lot6-fixture-token",
    protocol: 2,
    root
  }), { mode: 0o600 });
  return runtimeBase;
}

async function installInTree(bin, dir, cwd) {
  const config = join(dir, "host.json");
  const lock = join(dir, "lock.json");
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
  const install = spawn(process.execPath, [bin, "registry", "bootstrap", "install",
    "--host", "claude", "--config", config, "--lock", lock], { env, cwd });
  const installExit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 60000);
    install.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(installExit, 0, "bootstrap install succeeds in the packed tree");
  return { config, lock, home };
}

test("LOT-6 F-10 (i): sibling tree serves catalog and bridge preflight", async (t) => {
  await withTempDir(async (dir) => {
    const { bin } = await buildSiblingTree(dir);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const baseEnv = { ...process.env, HOME: home };
    const catalog = spawn(process.execPath, [bin, "registry", "catalog"], { env: baseEnv, cwd: dir });
    const catalogOut = await new Promise((resolve) => {
      let out = "";
      catalog.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      catalog.on("exit", (code) => resolve({ code, out }));
    });
    assert.equal(catalogOut.code, 0);
    const entries = JSON.parse(catalogOut.out);
    assert.deepEqual(entries.map((entry) => entry.id).sort(), ["sentropic.h2a", "sentropic.track"]);
    const { lock } = await installInTree(bin, dir, dir);
    // No fixture central: the bridge stops at the attachment refusal.
    const env = { ...baseEnv, H2A_ROOT: join(dir, "serve-root"), H2A_MCP_CENTRAL: "0" };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.H2A_MCP_AUTHORITY;
    const serve = spawn(process.execPath, [bin, "registry-bridge", "serve",
      "--host", "claude", "--profile", "default", "--lock", lock], { env, stdio: ["pipe", "pipe", "pipe"], cwd: dir });
    t.after(() => {
      try {
        serve.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    });
    let stdout = "";
    let stderr = "";
    serve.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    serve.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    serve.stdin.end();
    const exit = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 30000);
      serve.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(exit, 2, `attachment refusal exits 2 (stderr: ${stderr})`);
    assert.match(stderr, /central_unavailable/);
    assert.ok(!stderr.includes("ENOENT"), "no ENOENT in the sibling tree");
  });
});

test("LOT-6 F-10 (ii): nested npm tree serves catalog and bridge preflight", async (t) => {
  await withTempDir(async (dir) => {
    const { bin } = await buildNestedTree(dir);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const baseEnv = { ...process.env, HOME: home };
    const catalog = spawn(process.execPath, [bin, "registry", "catalog"], { env: baseEnv, cwd: dir });
    const catalogOut = await new Promise((resolve) => {
      let out = "";
      let err = "";
      catalog.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      catalog.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      catalog.on("exit", (code) => resolve({ code, out, err }));
    });
    assert.equal(catalogOut.code, 0, catalogOut.err);
    assert.ok(!catalogOut.err.includes("ENOENT"), "no ENOENT in the nested tree");
    const { lock } = await installInTree(bin, dir, dir);
    const env = { ...baseEnv, H2A_ROOT: join(dir, "serve-root"), H2A_MCP_CENTRAL: "0" };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.H2A_MCP_AUTHORITY;
    const serve = spawn(process.execPath, [bin, "registry-bridge", "serve",
      "--host", "claude", "--profile", "default", "--lock", lock], { env, stdio: ["pipe", "pipe", "pipe"], cwd: dir });
    t.after(() => {
      try {
        serve.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    });
    let stdout = "";
    let stderr = "";
    serve.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    serve.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    serve.stdin.end();
    const exit = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 30000);
      serve.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(exit, 2, `attachment refusal exits 2 (stderr: ${stderr})`);
    assert.match(stderr, /central_unavailable/);
    assert.ok(!stderr.includes("ENOENT"), "no ENOENT in the nested tree");
  });
});

test("LOT-6 F-10: nested tree with fixture central answers initialize past preflight", async (t) => {
  await withTempDir(async (dir) => {
    const { bin, trackAsset } = await buildNestedTree(dir);
    assert.ok(existsSync(trackAsset), "nested tree carries the track asset");
    const { lock, home } = await installInTree(bin, dir, dir);
    let root = join(dir, "serve-root");
    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    const runtimeBase = fabricateMarkerBase(dir, root);
    const env = { ...process.env, HOME: home, H2A_ROOT: root,
      CLAUDE_CODE_SESSION_ID: "lot6-session", H2A_MCP_CENTRAL: "1",
      XDG_RUNTIME_DIR: join(dir, "run"), XDG_CONFIG_HOME: join(dir, "config") };
    const serve = spawn(process.execPath, [bin, "registry-bridge", "serve",
      "--host", "claude", "--profile", "default", "--lock", lock, "--runtime-base", runtimeBase],
      { env, stdio: ["pipe", "pipe", "pipe"], cwd: dir });
    t.after(() => {
      try {
        serve.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    });
    let stdout = "";
    let stderr = "";
    serve.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    serve.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    serve.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } })}\n`);
    serve.stdin.end();
    const exit = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 30000);
      serve.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    void exit;
    const frames = stdout.split("\n").filter((line) => line.trim()).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const answered = frames.find((frame) => frame.id === 1);
    assert.ok(answered && answered.result, `initialize answered past preflight (stdout: ${stdout}, stderr: ${stderr})`);
    assert.ok(!stderr.includes("ENOENT"), "asset resolution leaves no ENOENT");
    assert.ok(!stderr.includes("invalid_entry"), "preflight raises no invalid_entry");
  });
});

test("LOT-6 F-10: deleted track asset fails typed naming the asset", async (t) => {
  await withTempDir(async (dir) => {
    const { bin, trackAsset } = await buildNestedTree(dir);
    rmSync(trackAsset);
    const { lock, home } = await installInTree(bin, dir, dir);
    let root = join(dir, "serve-root");
    mkdirSync(root, { recursive: true });
    root = realpathSync(root);
    const runtimeBase = fabricateMarkerBase(dir, root);
    const env = { ...process.env, HOME: home, H2A_ROOT: root,
      CLAUDE_CODE_SESSION_ID: "lot6-session", H2A_MCP_CENTRAL: "1",
      XDG_RUNTIME_DIR: join(dir, "run"), XDG_CONFIG_HOME: join(dir, "config") };
    const serve = spawn(process.execPath, [bin, "registry-bridge", "serve",
      "--host", "claude", "--profile", "default", "--lock", lock, "--runtime-base", runtimeBase],
      { env, stdio: ["pipe", "pipe", "pipe"], cwd: dir });
    t.after(() => {
      try {
        serve.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    });
    let stdout = "";
    let stderr = "";
    serve.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    serve.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    serve.stdin.end();
    const exit = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 30000);
      serve.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(exit, 2, `typed refusal exits 2 (stderr: ${stderr})`);
    assert.match(stderr, /invalid_entry/);
    assert.match(stderr, /manifest\.track\.json/);
    assert.ok(!stderr.includes("ENOENT"), "no raw ENOENT stack");
  });
});

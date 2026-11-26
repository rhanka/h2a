import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { defaultPluginBridgeLockPath, provisionBridgeLock } from "../dist/registry/bridge-lock.js";
import { validateRegistryEntry } from "../dist/registry/descriptors.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { sharedPackCandidates } from "./helpers/shared-pack-candidates.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CANDIDATE_VERSION = JSON.parse(readFileSync(join(REPO, "packages", "h2a", "package.json"), "utf8")).version;

function npm(args, cwd, env = {}) {
  const res = spawnSync("npm", args, { cwd, encoding: "utf8", timeout: 180_000, env: { ...process.env, ...env } });
  return res;
}

// B-6: network reprise — retry npm up to 3 times on transient failure.
function npmWithRetry(args, cwd, env = {}, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = npm(args, cwd, env);
    if (last.status === 0) return last;
    const err = `${last.stderr ?? ""}\n${last.stdout ?? ""}`.slice(0, 500);
    if (i < attempts) console.log(`npm retry ${i}/${attempts} for ${args.slice(0, 3).join(" ")}: ${err.slice(0, 200)}`);
  }
  return last;
}

function binEnv(iso, extra = {}) {
  return {
    ...process.env,
    HOME: iso.home,
    XDG_CONFIG_HOME: join(iso.home, ".config"),
    XDG_CACHE_HOME: join(iso.home, ".cache"),
    XDG_DATA_HOME: join(iso.home, ".local", "share"),
    XDG_STATE_HOME: join(iso.home, ".local", "state"),
    XDG_RUNTIME_DIR: iso.runtime,
    H2A_ROOT: iso.root,
    H2A_MCP_CENTRAL: "1",
    npm_config_cache: iso.npmCache,
    TMPDIR: iso.tmp, TMP: iso.tmp, TEMP: iso.tmp,
    PATH: `${join(iso.prefix, "bin")}:${process.env.PATH}`,
    ...extra,
  };
}

function writePluginCaches(home, version) {
  // Claude cache.
  const claudeDir = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(claudeDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(claudeDir, "scripts"), { recursive: true });
  writeFileSync(join(claudeDir, "scripts", "h2a-bridge-shim.mjs"), "export {};\n");
  const claudeArgs = ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade"];
  writeFileSync(join(claudeDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "h2a", version, mcpServers: "./.claude-plugin/registry.mcp.json" }));
  writeFileSync(join(claudeDir, ".claude-plugin", "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "node", args: claudeArgs } } }));
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(installedPath, JSON.stringify({ version: 2, plugins: { "h2a@sentropic": [{ scope: "user", installPath: claudeDir, version }] } }));
  // Codex cache.
  const codexDir = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(codexDir, ".codex-plugin"), { recursive: true });
  writeFileSync(join(codexDir, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "h2a", version, mcpServers: "./.codex-plugin/registry.mcp.json" }));
  writeFileSync(join(codexDir, ".codex-plugin", "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["registry-bridge", "serve", "--host", "codex", "--profile", "default", "--wake", "auto", "--auto-open"] } } }));
  return { claudeDir, codexDir };
}

async function stdioProbe(bin, args, env, host) {
  const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => { stdout += String(c); });
  child.stderr.on("data", (c) => { stderr += String(c); });
  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
  const waitForId = (id, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      for (const line of stdout.split("\n")) {
        try {
          const frame = JSON.parse(line);
          if (frame?.id === id) return resolve(frame);
        } catch { /* phase logs and non-JSON lines */ }
      }
      if (Date.now() > deadline) return reject(new Error(`host ${host}: no JSON-RPC response id=${id} (stdout: ${stdout.slice(-500)} stderr: ${stderr.slice(-500)})`));
      setTimeout(poll, 50);
    };
    poll();
  });
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "upgrade-probe", version: "1" } } });
    const init = await waitForId(1);
    assert.equal(init?.result !== undefined, true, `host ${host}: initialize returns result`);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const list = await waitForId(2);
    assert.ok(Array.isArray(list?.result?.tools), `host ${host}: tools/list returns tools`);
    return list.result.tools.length;
  } finally {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise((r) => { child.once("exit", () => r(null)); setTimeout(() => r(null), 3000); });
  }
}

test("B-6 upgrade: N-1 (next tag) upgrades to built package (host+bridge+central for real)", { timeout: 600_000 }, async (t) => {
  const isoBase = mkdtempSync(join(tmpdir(), "h2a-l5-upgrade-"));
  t.after(() => rmSync(isoBase, { recursive: true, force: true }));
  const iso = {
    base: isoBase,
    prefix: join(isoBase, "prefix"),
    home: join(isoBase, "home"),
    runtime: join(isoBase, "runtime"),
    root: join(isoBase, "root"),
    npmCache: join(isoBase, "npm-cache"),
    tmp: join(isoBase, "tmp"),
  };
  for (const d of [iso.prefix, iso.home, iso.runtime, iso.root, iso.npmCache, iso.tmp]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const env = binEnv(iso);
  // 1. Resolve N-1 via the `next` dist-tag (not a hardcoded rc).
  const view = npmWithRetry(["view", "@sentropic/h2a", "dist-tags.next", "--json"], isoBase, env);
  assert.equal(view.status, 0, `npm view next must succeed: ${(view.stderr ?? "").slice(0, 1000)}`);
  const n1ver = JSON.parse(view.stdout.trim());
  assert.match(String(n1ver), /^\d+\.\d+\.\d+-rc\.\d+/, `next tag resolves to an rc (got ${n1ver})`);
  const prev = npmWithRetry(["install", "-g", `@sentropic/h2a@${n1ver}`, "--prefix", iso.prefix], isoBase, env);
  assert.equal(prev.status, 0, `N-1 ${n1ver} install must succeed: ${(prev.stderr ?? "").slice(0, 2000)}`);
  const bin = join(iso.prefix, "bin", "h2a");
  assert.ok(existsSync(bin), "upgraded prefix provides bin/h2a");
  const n1out = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000, env });
  assert.equal(n1out.status, 0);
  const n1installed = n1out.stdout.trim();
  // 2. Provision N-1 bridge locks with the N-1 binary (real binary, real plugin cache).
  writePluginCaches(iso.home, n1ver);
  const claudeCfg = join(iso.home, ".claude.json");
  writeFileSync(claudeCfg, JSON.stringify({ mcpServers: {} }, null, 2));
  const codexCfg = join(iso.home, ".codex", "config.toml");
  mkdirSync(dirname(codexCfg), { recursive: true });
  writeFileSync(codexCfg, 'model = "test"\n');
  const claudeCache = join(iso.home, ".claude", "plugins", "cache", "sentropic", "h2a", n1ver);
  const codexCache = join(iso.home, ".codex", "plugins", "cache", "sentropic", "h2a", n1ver);
  for (const [host, cfg, plug] of [["claude", claudeCfg, claudeCache], ["codex", codexCfg, codexCache]]) {
    const r = spawnSync(bin, ["registry", "bootstrap", "install", "--mechanism", "plugin", "--host", host, "--profile", "default", "--config", cfg, "--plugin-dir", plug], { encoding: "utf8", timeout: 60_000, env });
    assert.equal(r.status, 0, `N-1 bootstrap install ${host} must succeed: ${(r.stderr ?? "").slice(0, 1500)} ${(r.stdout ?? "").slice(0, 500)}`);
  }
  const n1EntriesPath = join(iso.prefix, "lib", "node_modules", "@sentropic", "h2a", "registry", "entries.v1.json");
  const n1Entry = JSON.parse(readFileSync(n1EntriesPath, "utf8")).entries[0];
  const n1Digest = validateRegistryEntry(n1Entry).digest;
  const candidateDigest = validateRegistryEntry(registryPackageManifest.entries[0]).digest;
  // Note (NB-2): when a PR adds MCP tools relative to `dist-tags.next` (e.g.
  // 66 -> 68 tools), `nextEntriesUnchanged` is `false` until the next release
  // publishes the updated descriptor, so step 5a exercises the drifted-N-1 path.
  const nextEntriesUnchanged = n1Digest === candidateDigest;

  // 3. Reuse the once-per-run candidate, upgrade the prefix.
  // Cause (run 45379165388 job 138401159720): the private
  // `scripts/package-release.mjs` spawnSync (300 s timeout) was killed with
  // status null after 418 s while shard 22/0 ran T-guard (496 s) + LOT-4B
  // (484 s) + B-6 concurrently on one 4-vCPU runner. Build the candidate
  // once per run and reuse it (helpers/shared-pack-candidates.mjs, warmed by
  // scripts/warm-pack-candidates.mjs); fallback stays private so a missing
  // share never skips the proof.
  let tarPath = "";
  const shared = await sharedPackCandidates();
  if (shared !== null) {
    const candidate = join(shared, `sentropic-h2a-${CANDIDATE_VERSION}.tgz`);
    assert.ok(existsSync(candidate), `shared candidate tarball must exist: ${candidate}`);
    tarPath = candidate;
  } else {
    const outDir = join(isoBase, "candidate");
    const pack = spawnSync(process.execPath, ["scripts/package-release.mjs", "--package", "@sentropic/h2a", "--output", outDir], { cwd: REPO, encoding: "utf8", timeout: 550_000, env: { ...process.env, ...env } });
    assert.equal(pack.status, 0, `package-release candidate must succeed: ${(pack.stderr ?? "").slice(0, 2000)} ${(pack.stdout ?? "").slice(-1000)}`);
    try {
      const parsed = JSON.parse(pack.stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const cand = item?.filename || item?.artifacts?.tarball || item?.tarball || "";
        if (typeof cand === "string" && cand.endsWith(".tgz")) { tarPath = cand; break; }
      }
    } catch { /* fall through to glob */ }
    if (!tarPath || !existsSync(tarPath)) {
      const artDir = join(outDir, "artifacts");
      if (existsSync(artDir)) {
        const tgz = readdirSync(artDir).find((n) => n.endsWith(".tgz"));
        if (tgz) tarPath = join(artDir, tgz);
      }
    }
  }
  assert.ok(tarPath.endsWith(".tgz") && existsSync(tarPath), `candidate tarball must exist (got ${tarPath})`);
  const up = npmWithRetry(["install", "-g", tarPath, "--prefix", iso.prefix], isoBase, env);
  assert.equal(up.status, 0, `upgrade to built package must succeed: ${(up.stderr ?? "").slice(0, 2000)}`);
  // 4. Exact version: equals the packed candidate, differs from N-1.
  const ver = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000, env });
  assert.equal(ver.status, 0);
  assert.equal(ver.stdout.trim(), CANDIDATE_VERSION, `upgraded --version equals candidate ${CANDIDATE_VERSION} (got ${ver.stdout.trim()})`);
  assert.notEqual(ver.stdout.trim(), n1installed, "upgraded version differs from N-1");
  // 5. Bridge for real, with real prefix binaries throughout.
  // Measured ground truth: h2a entries.v1.json is byte-identical between
  // N-1 (next) and the candidate, so a next-provisioned lock is already valid
  // for N — the upgrade must not raise a false integrity_mismatch (5a).
  // The drifted-lock heal/quarantine path (production 0.98.10 -> N) is then
  // proven with genuinely drifted 0.98.10-digest locks (5b).
  const noCentralEnv = { ...env, H2A_MCP_CENTRAL: "0" };
  const lockDir = (host) => join(iso.home, ".config", "sentropic", "h2a", "registry-bridge", host);
  const claudeLock = join(lockDir("claude"), "default.lock.json");
  const codexLock = join(lockDir("codex"), "default.lock.json");
  const codexPackaged = JSON.parse(readFileSync(join(REPO, "packages", "h2a", ".codex-plugin", "registry.mcp.json"), "utf8"));
  const codexArgs = codexPackaged?.mcpServers?.h2a?.args;
  assert.ok(Array.isArray(codexArgs) && !codexArgs.includes("--instance"), "packaged codex serve carries no --instance");
  // 5a. N-1 (next) lock check after upgrade:
  // If N-1 and candidate share the same descriptor digest, both survive untouched
  // to central admission (`central_unavailable`); if candidate added/changed MCP
  // descriptors (e.g. new tools), Claude auto-heals via `--auto-upgrade` while
  // Codex refuses closed with `integrity_mismatch` (B-2).
  const claudeValidPrior = readFileSync(claudeLock, "utf8");
  const claudeValidServe = spawnSync(bin, ["registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade", "--root", iso.root, "--runtime-base", iso.runtime], { encoding: "utf8", timeout: 60_000, env: noCentralEnv });
  const claudeValidOut = `${claudeValidServe.stdout ?? ""}\n${claudeValidServe.stderr ?? ""}`;
  assert.equal(claudeValidServe.status, 2, `valid claude lock refuses at admission (got ${claudeValidServe.status}: ${claudeValidOut.slice(0, 600)})`);
  assert.match(claudeValidOut, /central_unavailable/, "claude passes the lock check and refuses only at central admission");
  assert.doesNotMatch(claudeValidOut, /integrity_mismatch/, "claude upgrade path must not stall at integrity_mismatch");
  const claudeValidQuarantines = readdirSync(lockDir("claude")).filter((n) => n.startsWith("default.lock.json.quarantine-"));
  if (nextEntriesUnchanged) {
    assert.equal(readFileSync(claudeLock, "utf8"), claudeValidPrior, "valid claude lock untouched");
    assert.equal(claudeValidQuarantines.length, 0, "no quarantine for valid lock");
  } else {
    assert.match(claudeValidOut, /refreshed plugin lock .* for version upgrade/, "claude auto-heals N-1 lock when MCP descriptor evolved");
    assert.notEqual(readFileSync(claudeLock, "utf8"), claudeValidPrior, "claude lock re-provisioned to candidate digest");
    assert.ok(claudeValidQuarantines.some((n) => readFileSync(join(lockDir("claude"), n), "utf8") === claudeValidPrior), "claude N-1 lock quarantined intact");
  }
  const codexValidPrior = readFileSync(codexLock, "utf8");
  const codexValidServe = spawnSync(bin, [...codexArgs, "--root", iso.root, "--runtime-base", iso.runtime], { encoding: "utf8", timeout: 60_000, env: noCentralEnv });
  const codexValidOut = `${codexValidServe.stdout ?? ""}\n${codexValidServe.stderr ?? ""}`;
  assert.equal(codexValidServe.status, 2, `codex lock refuses at preflight/admission (got ${codexValidServe.status}: ${codexValidOut.slice(0, 600)})`);
  if (nextEntriesUnchanged) {
    assert.match(codexValidOut, /central_unavailable/, "valid codex lock refuses at R5-CA admission (host!=claude)");
  } else {
    assert.match(codexValidOut, /integrity_mismatch/, "drifted N-1 codex lock refuses closed with integrity_mismatch (B-2)");
  }
  assert.equal(readFileSync(codexLock, "utf8"), codexValidPrior, "codex lock untouched");
  // 5b. Drifted 0.98.10-digest locks (production upgrade case) with the real
  // prefix binary: claude heals via --auto-upgrade, codex refuses closed
  // (B-2) then doctor --repair converges it. 0.98.10 caches are added AFTER
  // the N-1 provisioning so the N-1 bootstrap keeps its exact cache.
  for (const [host, cacheRoot] of [["claude", join(iso.home, ".claude")], ["codex", join(iso.home, ".codex")]]) {
    const verDir = join(cacheRoot, "plugins", "cache", "sentropic", "h2a", "0.98.10");
    const dir = join(verDir, host === "claude" ? ".claude-plugin" : ".codex-plugin");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "h2a", version: "0.98.10", mcpServers: `./${host === "claude" ? ".claude" : ".codex"}-plugin/registry.mcp.json` }));
    if (host === "claude") {
      const claudeArgs = ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade"];
      writeFileSync(join(dir, "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "node", args: claudeArgs } } }));
      // readPluginDeclaration requires the referenced shim to exist.
      mkdirSync(join(verDir, "scripts"), { recursive: true });
      writeFileSync(join(verDir, "scripts", "h2a-bridge-shim.mjs"), readFileSync(join(REPO, "packages", "h2a", "scripts", "h2a-bridge-shim.mjs"), "utf8"), { mode: 0o755 });
    } else {
      writeFileSync(join(dir, "registry.mcp.json"), JSON.stringify({ mcpServers: { h2a: { command: "h2a", args: ["registry-bridge", "serve", "--host", host, "--profile", "default"] } } }));
    }
  }
  const h2aPrior = structuredClone(registryPackageManifest.entries[0]);
  const trackPrior = structuredClone(trackRegistryPackageManifest.entries[0]);
  h2aPrior.publisher.packageVersion = "0.98.10";
  trackPrior.publisher.packageVersion = "0.98.10";
  // provisionBridgeLock is create-only (already-present is a no-op): remove
  // the valid next-locks first so the drifted 0.98.10 digests land on disk.
  rmSync(claudeLock, { force: true });
  rmSync(codexLock, { force: true });
  provisionBridgeLock({ lockPath: claudeLock, host: "claude", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
  provisionBridgeLock({ lockPath: codexLock, host: "codex", profile: "default", h2aEntry: h2aPrior, trackEntry: trackPrior });
  const claudePrior = readFileSync(claudeLock, "utf8");
  const codexPrior = readFileSync(codexLock, "utf8");
  const claudeServe = spawnSync(bin, ["registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade", "--root", iso.root, "--runtime-base", iso.runtime], { encoding: "utf8", timeout: 60_000, env: noCentralEnv });
  const claudeOut = `${claudeServe.stdout ?? ""}\n${claudeServe.stderr ?? ""}`;
  assert.match(claudeOut, /refreshed plugin lock .* for version upgrade/, `claude serve heals drifted lock (got: ${claudeOut.slice(0, 1200)})`);
  assert.notEqual(readFileSync(claudeLock, "utf8"), claudePrior, "claude lock re-provisioned to candidate digests");
  const claudeQ = readdirSync(lockDir("claude")).filter((n) => n.startsWith("default.lock.json.quarantine-"));
  assert.ok(claudeQ.length >= 1, "drifted claude lock quarantined");
  assert.ok(claudeQ.some((name) => readFileSync(join(lockDir("claude"), name), "utf8") === claudePrior), "claude quarantine holds exact prior bytes");
  const codexServe = spawnSync(bin, [...codexArgs, "--root", iso.root, "--runtime-base", iso.runtime], { encoding: "utf8", timeout: 60_000, env: noCentralEnv });
  const codexOut = `${codexServe.stdout ?? ""}\n${codexServe.stderr ?? ""}`;
  assert.equal(codexServe.status, 2, `drifted codex serve refuses closed (got ${codexServe.status}: ${codexOut.slice(0, 800)})`);
  assert.match(codexOut, /integrity_mismatch/, "codex refuses integrity_mismatch (B-2, not central_unavailable)");
  assert.equal(readFileSync(codexLock, "utf8"), codexPrior, "drifted codex lock untouched by serve");
  assert.equal(readdirSync(lockDir("codex")).filter((n) => n.startsWith("default.lock.json.quarantine-")).length, 0, "no quarantine without explicit repair (codex)");
  // Explicit doctor --repair convergence (both hosts, idempotent) is proven
  // hermetically in doctor-repair-converge-b3.test.js (B-3 i-iv); the upgrade
  // prefix keeps the real-binary remedy leg above.
  // 6. Central for real: serve, health/ping 200, then stop.
  const central = spawn(bin, ["mcp-central-serve", "--root", iso.root, "--runtime-base", iso.runtime], { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { try { central.kill("SIGKILL"); } catch { /* ignore */ } });
  let centralOut = "";
  central.stdout.on("data", (c) => { centralOut += String(c); });
  central.stderr.on("data", (c) => { centralOut += String(c); });
  const endpoint = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const poll = () => {
      const m = centralOut.match(/listening on (http:\/\/[^\s)]+)/);
      if (m) return resolve(m[1]);
      if (Date.now() > deadline) return reject(new Error(`central never listened (out: ${centralOut.slice(-800)})`));
      setTimeout(poll, 100);
    };
    poll();
  });
  const health = await fetch(new URL("/_h2a-central/health", endpoint));
  assert.equal(health.status, 200, "central health 200 after upgrade");
  const ping = await fetch(new URL("/_h2a-central/ping", endpoint));
  assert.equal(ping.status, 200, "central ping 200 after upgrade");
  central.kill("SIGINT");
  await new Promise((r) => { central.once("exit", () => r(null)); setTimeout(() => r(null), 5000); });
  // 7. Hosts for real: initialize -> tools/list on mcp-serve for all four.
  const desc = spawnSync(bin, ["registry", "catalog"], { encoding: "utf8", timeout: 30_000, env });
  assert.equal(desc.status, 0, `registry catalog must succeed after upgrade: ${(desc.stderr ?? "").slice(0, 1000)}`);
  for (const host of ["claude", "codex", "agy", "muse"]) {
    const n = await stdioProbe(bin, ["mcp-serve", "--host", host, "--root", iso.root, "--runtime-base", iso.runtime], env, host);
    assert.ok(n > 0, `host ${host}: tools/list non-empty (got ${n})`);
  }
});

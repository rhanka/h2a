import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function npm(args, cwd, env = {}) {
  const res = spawnSync("npm", args, { cwd, encoding: "utf8", timeout: 180_000, env: { ...process.env, ...env } });
  return res;
}

test("L5A upgrade: previous rc in isolated prefix upgrades to built package (bridge+central+hosts)", { timeout: 300_000 }, async (t) => {
  const iso = mkdtempSync(join(tmpdir(), "h2a-l5-upgrade-"));
  t.after(() => rmSync(iso, { recursive: true, force: true }));
  const prefix = join(iso, "prefix");
  mkdirSync(prefix, { recursive: true, mode: 0o700 });
  const env = { npm_config_cache: join(iso, "npm-cache"), TMPDIR: iso, TMP: iso, TEMP: iso };
  mkdirSync(env.npm_config_cache, { recursive: true });
  // 1. Install previous published rc in isolated prefix.
  const prev = npm(["install", "-g", "@sentropic/h2a@0.98.11-rc.13", "--prefix", prefix], iso, env);
  assert.equal(prev.status, 0, `previous rc install must succeed: ${prev.stderr.slice(0, 2000)}`);
  assert.ok(existsSync(join(prefix, "bin", "h2a")) || existsSync(join(prefix, "lib", "node_modules", "@sentropic", "h2a", "dist", "bin.js")));
  // 2. Pack the built candidate via the release script and upgrade the prefix.
  const outDir = join(iso, "candidate");
  const pack = spawnSync(process.execPath, ["scripts/package-release.mjs", "--package", "@sentropic/h2a", "--output", outDir], { cwd: REPO, encoding: "utf8", timeout: 180_000, env: { ...process.env, ...env } });
  assert.equal(pack.status, 0, `package-release candidate must succeed: ${pack.stderr.slice(0, 2000)} ${pack.stdout.slice(-1000)}`);
  let tarPath = "";
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
  assert.ok(tarPath.endsWith(".tgz") && existsSync(tarPath), `candidate tarball must exist (got ${tarPath})`);
  const up = npm(["install", "-g", tarPath, "--prefix", prefix], iso, env);
  assert.equal(up.status, 0, `upgrade to built package must succeed: ${up.stderr.slice(0, 2000)}`);
  const bin = join(prefix, "bin", "h2a");
  const ver = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000, env: { ...process.env, PATH: `${join(prefix, "bin")}:${process.env.PATH}` } });
  assert.equal(ver.status, 0);
  assert.match(ver.stdout, /0\.98\.11/);
  // 3. Bridge descriptors validate (packed entries) for all four hosts.
  // Full host probes (claude/codex/agy/muse binaries) run in L5B on the owner machine;
  // here we prove the upgraded prefix serves the registry descriptors.
  const desc = spawnSync(bin, ["registry", "catalog"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(desc.status, 0, `registry catalog must succeed after upgrade: ${desc.stderr.slice(0, 1000)}`);
});

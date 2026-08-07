import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  renderFocusServeHelp,
  resolveFocusServeConfig,
  runFocusServeCli,
  validateFocusAssets
} from "../dist/runtime/focus/serve.js";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages", "h2a", "dist", "bin.js");

function temporaryDirectory(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function trackedRepo(base, name = "repo") {
  const repo = join(base, name);
  mkdirSync(join(repo, ".track"), { recursive: true });
  writeFileSync(join(repo, ".track", "events.jsonl"), "", "utf8");
  return repo;
}

function fakeAssets(base, overrides = {}) {
  const dir = join(base, `focus-app-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(dir, "client", "_app"), { recursive: true });
  mkdirSync(join(dir, "server"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n', "utf8");
  const clientVersion = `h2a-focus-${"0".repeat(16)}`;
  writeFileSync(join(dir, "client", "_app", "version.json"), `${JSON.stringify({ version: clientVersion })}\n`, "utf8");
  writeFileSync(join(dir, "server", "lazy-route.js"), "export const lazy = true;\n", "utf8");
  writeFileSync(
    join(dir, "handler.js"),
    [
      "export function handler(req, res) {",
      "  res.writeHead(200, { 'content-type': 'application/json' });",
      "  res.end(JSON.stringify({ root: process.env.FOCUS_REPO_ROOT, events: process.env.FOCUS_TRACK_EVENTS, bin: process.env.FOCUS_H2A_BIN, emitter: process.env.FOCUS_EMITTER_INSTANCE }));",
      "}"
    ].join("\n"),
    "utf8"
  );
  const files = Object.fromEntries(
    ["handler.js", "client/_app/version.json", "server/lazy-route.js"].map((relativePath) => [
      relativePath,
      `sha256:${createHash("sha256").update(readFileSync(join(dir, relativePath))).digest("hex")}`
    ])
  );
  const manifest = {
    kind: "sentropic.h2a.focus-app",
    schemaVersion: 1,
    adapter: "@sveltejs/adapter-node",
    handler: "handler.js",
    sourceHash: `sha256:${"0".repeat(64)}`,
    clientVersion,
    externalDependencies: ["@sentropic/track"],
    files,
    ...overrides
  };
  writeFileSync(join(dir, "h2a-focus.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  return dir;
}

function configDeps(cwd, assetsDir) {
  return { cwd: () => cwd, env: {}, assetsDir, h2aBin: process.execPath };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function linkInstalledDependency(nodeModules, specifier) {
  const parts = specifier.split("/");
  const source = join(ROOT, "node_modules", ...parts);
  const destination = join(nodeModules, ...parts);
  mkdirSync(join(destination, ".."), { recursive: true });
  symlinkSync(source, destination, "dir");
}

function requestStatus(url, host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { host } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

test("resolveFocusServeConfig resolves the nearest tracked ancestor and ignores inherited HOST", () => {
  const base = temporaryDirectory("h2a-focus-resolve-");
  try {
    const repo = trackedRepo(base);
    const nested = join(repo, "a", "b");
    mkdirSync(nested, { recursive: true });
    const assets = fakeAssets(base);
    const config = resolveFocusServeConfig(
      ["focus", "serve"],
      { ...configDeps(nested, assets), env: { HOST: "0.0.0.0", PORT: "9999" } }
    );
    assert.equal(config.repoRoot, repo);
    assert.equal(config.trackEvents, join(repo, ".track", "events.jsonl"));
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 5178);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveFocusServeConfig applies CLI-over-env precedence and makes web an exact alias", () => {
  const base = temporaryDirectory("h2a-focus-precedence-");
  try {
    const cliRepo = trackedRepo(base, "cli");
    const envRepo = trackedRepo(base, "env");
    const customEvents = join(base, "custom-events.jsonl");
    writeFileSync(customEvents, "", "utf8");
    const assets = fakeAssets(base);
    const deps = {
      ...configDeps(base, assets),
      env: { FOCUS_REPO_ROOT: envRepo, FOCUS_TRACK_EVENTS: join(envRepo, ".track", "events.jsonl") }
    };
    const serve = resolveFocusServeConfig(
      ["focus", "serve", "--repo", cliRepo, "--track-events", customEvents, "--host", "::1", "--port", "0"],
      deps
    );
    const web = resolveFocusServeConfig(
      ["focus", "web", "--repo", cliRepo, "--track-events", customEvents, "--host", "::1", "--port", "0"],
      deps
    );
    assert.deepEqual(web, serve);
    assert.equal(serve.repoRoot, cliRepo);
    assert.equal(serve.trackEvents, customEvents);
    assert.equal(serve.host, "::1");
    assert.equal(serve.port, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveFocusServeConfig rejects unknown flags, invalid ports, and untracked directories", () => {
  const base = temporaryDirectory("h2a-focus-invalid-");
  try {
    const assets = fakeAssets(base);
    const deps = { ...configDeps(base, assets), findTrackedRepo: () => undefined };
    assert.throws(() => resolveFocusServeConfig(["focus", "serve", "--wat"], deps), /unknown option/);
    assert.throws(() => resolveFocusServeConfig(["focus", "serve", "--port", "65536"], deps), /0 to 65535/);
    assert.throws(() => resolveFocusServeConfig(["focus", "serve"], deps), /no tracked repository/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("validateFocusAssets fails closed for absent, incompatible, and incomplete artifacts", () => {
  const base = temporaryDirectory("h2a-focus-assets-");
  try {
    assert.throws(() => validateFocusAssets(join(base, "absent")), /absent or invalid/);
    const old = fakeAssets(base, { schemaVersion: 0 });
    assert.throws(() => validateFocusAssets(old), /incompatible/);
    const wrongRuntime = fakeAssets(base, { externalDependencies: [] });
    assert.throws(() => validateFocusAssets(wrongRuntime), /incompatible/);
    const incomplete = fakeAssets(base);
    rmSync(join(incomplete, "handler.js"));
    assert.throws(() => validateFocusAssets(incomplete), /incomplete/);
    const missingLazyRoute = fakeAssets(base);
    rmSync(join(missingLazyRoute, "server", "lazy-route.js"));
    assert.throws(() => validateFocusAssets(missingLazyRoute), /incomplete/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("runFocusServeCli serves in-process, injects target env, prints the bound URL, and foregrounds until abort", async () => {
  const base = temporaryDirectory("h2a-focus-server-");
  const ac = new AbortController();
  let run;
  try {
    const repo = trackedRepo(base);
    const assets = fakeAssets(base);
    let stdout = "";
    let stderr = "";
    run = runFocusServeCli(
      ["focus", "web", "--repo", repo, "--port", "0"],
      {
        stdout: { write: (chunk) => void (stdout += chunk) },
        stderr: { write: (chunk) => void (stderr += chunk) }
      },
      ac.signal,
      { ...configDeps(base, assets), env: { H2A_INSTANCE: "codex:repo:test" } }
    );
    await Promise.race([
      waitFor(() => /Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout)),
      run.then((rc) => {
        throw new Error(`Focus server exited before binding (rc=${rc}, stderr=${stderr})`);
      })
    ]);
    const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    assert.equal(
      await requestStatus(url, "evil.example"),
      421,
      "loopback serving should reject DNS-rebinding Host headers"
    );
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      root: repo,
      events: join(repo, ".track", "events.jsonl"),
      bin: process.execPath,
      emitter: "codex:repo:test"
    });
    assert.equal(stderr, "");
    ac.abort();
    assert.equal(await run, 0);
    await assert.rejects(fetch(url));
  } finally {
    if (!ac.signal.aborted) ac.abort();
    if (run) await run;
    rmSync(base, { recursive: true, force: true });
  }
});

test("focus serve/web help is production-server help, not track focus delegation", () => {
  assert.match(renderFocusServeHelp(), /packaged production Focus Web app/);
  for (const alias of ["serve", "web"]) {
    const result = spawnSync(process.execPath, [BIN, "focus", alias, "--help"], { encoding: "utf8" });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /h2a focus serve/, JSON.stringify(result));
    assert.doesNotMatch(result.stderr, /track focus/i);
  }
});

test("packaged Focus smoke serves a repo without monorepo packages/track/dist and exits with its signal status", { skip: process.platform === "win32" }, async () => {
  const base = temporaryDirectory("h2a-focus-smoke-");
  const repo = trackedRepo(base);
  const child = spawn(process.execPath, [BIN, "focus", "serve", "--repo", repo, "--port", "0"], {
    cwd: repo,
    env: { ...process.env, HOST: "0.0.0.0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => void (stdout += chunk));
  child.stderr.on("data", (chunk) => void (stderr += chunk));
  try {
    await Promise.race([
      waitFor(() => /Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout), 10000),
      new Promise((_, reject) => child.once("exit", (code, signal) => {
        reject(new Error(`Focus child exited before binding (code=${code}, signal=${signal}, stderr=${stderr})`));
      }))
    ]);
    const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    const page = await fetch(url);
    assert.equal(page.status, 200, stderr);
    const html = await page.text();
    assert.match(html, /Focus|Suivi/);
    assert.match(html, />Faits</, "the installed @sentropic/track fallback should render the loaded report view");
    assert.doesNotMatch(html, /Impossible de charger le suivi|track (?:build|runtime) introuvable/);
    const asset = html.match(/(?:src|href)="([^"]*_app\/immutable\/[^"]+)"/)?.[1];
    assert.ok(asset, `SSR HTML should reference a packaged hashed asset: ${html.slice(0, 2000)}`);
    assert.equal((await fetch(new URL(asset, `${url}/`))).status, 200);
    child.kill("SIGTERM");
    const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    assert.deepEqual(exit, { code: 143, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(base, { recursive: true, force: true });
  }
});

test("npm tarball Focus smoke runs from an installed-artifact layout", { skip: process.platform === "win32" }, async () => {
  const base = temporaryDirectory("h2a-focus-tarball-");
  let child;
  try {
    const packed = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", base, join(ROOT, "packages", "h2a")],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.equal(packed.status, 0, packed.stderr);
    const [{ filename }] = JSON.parse(packed.stdout);
    const nodeModules = join(base, "install", "node_modules");
    const installedH2a = join(nodeModules, "@sentropic", "h2a");
    mkdirSync(installedH2a, { recursive: true });
    const extracted = spawnSync(
      "tar",
      ["-xzf", join(base, filename), "-C", installedH2a, "--strip-components=1"],
      { encoding: "utf8" }
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const dependency of [
      "@hono/mcp",
      "@hono/node-server",
      "@modelcontextprotocol/sdk",
      "@sentropic/track",
      "hono"
    ]) {
      linkInstalledDependency(nodeModules, dependency);
    }

    const repo = trackedRepo(base, "target-repo");
    const installedBin = join(installedH2a, "dist", "bin.js");
    child = spawn(process.execPath, [installedBin, "focus", "web", "--repo", repo, "--port", "0"], {
      cwd: repo,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => void (stdout += chunk));
    child.stderr.on("data", (chunk) => void (stderr += chunk));
    await Promise.race([
      waitFor(() => /Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout), 10000),
      new Promise((_, reject) => child.once("exit", (code, signal) => {
        reject(new Error(`installed Focus exited before binding (code=${code}, signal=${signal}, stderr=${stderr})`));
      }))
    ]);
    const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    const page = await fetch(url);
    assert.equal(page.status, 200, stderr);
    const html = await page.text();
    assert.match(html, />Faits</);
    const asset = html.match(/(?:src|href)="([^"]*_app\/immutable\/[^"]+)"/)?.[1];
    assert.ok(asset, "installed Focus should reference a packaged hashed asset");
    assert.equal((await fetch(new URL(asset, `${url}/`))).status, 200);
    child.kill("SIGTERM");
    const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    assert.deepEqual(exit, { code: 143, signal: null });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(base, { recursive: true, force: true });
  }
});

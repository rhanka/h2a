import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  H2A_MCP_CENTRAL_ENDPOINT_ENV,
  H2A_MCP_CENTRAL_ENV,
  centralMcpClientEndpoint,
  centralMcpMarkerPath,
  startCentralMcpServer
} from "../dist/index.js";
import { renderH2aMcpServer } from "../dist/hosts/codex.js";

const linux = process.platform === "linux" ? {} : { skip: "central MCP marker requires Linux uid/runtime semantics" };

function currentUid() {
  assert.equal(typeof process.getuid, "function", "Linux provides process.getuid");
  return process.getuid();
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "h2a-mcp-central-test-"));
  // The production base is /run/user/<uid>; retain the UID-only shape in the
  // test-owned replacement base without ever touching the real runtime dir.
  const runtimeBase = join(directory, "run", String(currentUid()));
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  chmodSync(runtimeBase, 0o700);
  return {
    directory,
    runtimeBase,
    root: join(directory, "store")
  };
}

async function endpoint() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return `http://127.0.0.1:${address.port}/mcp`;
}

function envFor(value) {
  return { [H2A_MCP_CENTRAL_ENDPOINT_ENV]: value };
}

function marker(endpointValue, generation, pid = process.pid, startedAt = "2000-01-01T00:00:00.000Z") {
  return `${JSON.stringify({
    endpoint: endpointValue,
    generation,
    pid,
    startedAt
  })}\n`;
}

async function stop(started) {
  if (started?.kind === "started") await started.stop();
}

async function centralGeneration(endpointValue) {
  try {
    const response = await fetch(new URL("/_h2a-central/ping", endpointValue));
    if (!response.ok) return undefined;
    const body = await response.json();
    return typeof body.generation === "string" ? body.generation : undefined;
  } catch {
    return undefined;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function snapshotTree(path) {
  const entries = new Set();
  const visit = (directory, prefix) => {
    let children;
    try {
      children = readdirSync(directory, { withFileTypes: true });
    } catch {
      entries.add(`${prefix}/<unreadable>`);
      return;
    }
    for (const child of children) {
      const relative = prefix ? join(prefix, child.name) : child.name;
      entries.add(relative);
      if (child.isDirectory()) visit(join(directory, child.name), relative);
    }
  };
  visit(path, "");
  return entries;
}

test("M1: central marker is uid-addressed, user-owned, and private", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await endpoint();
    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    assert.equal(started.kind, "started");
    const expectedPath = join(f.runtimeBase, "h2a-mcp-central", "marker.json");
    assert.equal(started.markerPath, expectedPath);
    assert.equal(
      centralMcpMarkerPath(),
      join("/run/user", String(currentUid()), "h2a-mcp-central", "marker.json"),
      "production rendezvous is derived from the uid alone"
    );
    assert.equal(centralMcpMarkerPath({ runtimeBase: f.runtimeBase }), expectedPath);
    assert.equal(statSync(dirname(expectedPath)).uid, currentUid());
    assert.equal(statSync(dirname(expectedPath)).mode & 0o777, 0o700);
    assert.equal(statSync(expectedPath).uid, currentUid());
    assert.equal(statSync(expectedPath).mode & 0o777, 0o600);
  } finally {
    await stop(started);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("M1 negative: an unexpected marker mode is refused without a write", linux, async () => {
  const f = fixture();
  try {
    const requested = await endpoint();
    const markerPath = centralMcpMarkerPath({ runtimeBase: f.runtimeBase });
    mkdirSync(dirname(markerPath), { mode: 0o700 });
    chmodSync(dirname(markerPath), 0o700);
    writeFileSync(markerPath, marker(requested, "old-generation"), { mode: 0o600 });
    chmodSync(markerPath, 0o644);
    const before = readFileSync(markerPath, "utf8");
    const beforeEntries = readdirSync(dirname(markerPath));

    await assert.rejects(
      startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: envFor(requested) }),
      /marker must have mode 0600/
    );

    assert.equal(readFileSync(markerPath, "utf8"), before);
    assert.deepEqual(readdirSync(dirname(markerPath)), beforeEntries);
    assert.equal(existsSync(f.root), false, "rejected launch never creates the MCP store");
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("a protected malformed marker is reclaimable rather than a permanent startup loop", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await endpoint();
    const markerPath = centralMcpMarkerPath({ runtimeBase: f.runtimeBase });
    mkdirSync(dirname(markerPath), { mode: 0o700 });
    chmodSync(dirname(markerPath), 0o700);
    writeFileSync(markerPath, "{not-json\n", { mode: 0o600 });
    chmodSync(markerPath, 0o600);

    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    assert.equal(started.kind, "started");
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).endpoint, requested);
  } finally {
    await stop(started);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("M2: a live divergent endpoint refuses sterilely and names both endpoints", linux, async () => {
  const f = fixture();
  let first;
  try {
    const firstEndpoint = await endpoint();
    const secondEndpoint = await endpoint();
    first = await startCentralMcpServer({
      root: join(f.directory, "first-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(firstEndpoint)
    });
    assert.equal(first.kind, "started");
    const before = readFileSync(first.markerPath, "utf8");
    const beforeEntries = readdirSync(dirname(first.markerPath));

    const duplicate = await startCentralMcpServer({
      root: join(f.directory, "duplicate-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(firstEndpoint)
    });
    assert.equal(duplicate.kind, "reused", "same live endpoint never starts a duplicate listener");
    assert.equal(readFileSync(first.markerPath, "utf8"), before);
    assert.equal(existsSync(join(f.directory, "duplicate-store")), false);

    await assert.rejects(
      startCentralMcpServer({
        root: join(f.directory, "second-store"),
        runtimeBase: f.runtimeBase,
        env: envFor(secondEndpoint)
      }),
      new RegExp(`LIVE central MCP server is registered on ${firstEndpoint}; this launcher requests ${secondEndpoint}`)
    );

    assert.equal(readFileSync(first.markerPath, "utf8"), before);
    assert.deepEqual(readdirSync(dirname(first.markerPath)), beforeEntries, "no temp or second marker exists");
    assert.equal(existsSync(join(f.directory, "second-store")), false, "refusal binds/writes nothing");
    assert.equal(await centralGeneration(secondEndpoint), undefined, "refusal leaves no second listener behind");
  } finally {
    await stop(first);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("concurrent different endpoints leave exactly one live, marked central server", linux, async () => {
  const f = fixture();
  const firstClaimed = deferred();
  const releaseFirst = deferred();
  let firstPromise;
  let secondPromise;
  let outcomes = [];
  try {
    const firstEndpoint = await endpoint();
    const secondEndpoint = await endpoint();
    firstPromise = startCentralMcpServer({
      root: join(f.directory, "first-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(firstEndpoint),
      afterMarkerClaim: async () => {
        firstClaimed.resolve();
        await releaseFirst.promise;
      }
    });
    await firstClaimed.promise;

    secondPromise = startCentralMcpServer({
      root: join(f.directory, "second-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(secondEndpoint)
    });
    await secondPromise.then(() => undefined, () => undefined);
    releaseFirst.resolve();
    outcomes = await Promise.allSettled([firstPromise, secondPromise]);

    const started = outcomes
      .filter((outcome) => outcome.status === "fulfilled" && outcome.value.kind === "started")
      .map((outcome) => outcome.value);
    assert.equal(started.length, 1, "exactly one concurrent launcher owns a central server");
    assert.ok(
      outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value.kind === "reused") ||
      outcomes.some(
        (outcome) => outcome.status === "rejected" &&
          /LIVE central MCP server is registered on/.test(String(outcome.reason))
      ),
      "the losing launcher reuses or refuses the live owner"
    );

    const registered = JSON.parse(readFileSync(centralMcpMarkerPath({ runtimeBase: f.runtimeBase }), "utf8"));
    const live = (await Promise.all(
      [firstEndpoint, secondEndpoint].map(async (value) => ({ endpoint: value, generation: await centralGeneration(value) }))
    )).filter((value) => value.generation !== undefined);
    assert.equal(live.length, 1, "at most one endpoint answers the central ping");
    assert.equal(live[0].endpoint, registered.endpoint, "the marker names the only live endpoint");
    assert.equal(live[0].generation, registered.generation, "the marker identifies the only live generation");
  } finally {
    releaseFirst.resolve();
    if (firstPromise || secondPromise) {
      outcomes = outcomes.length > 0
        ? outcomes
        : await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
      await Promise.all(outcomes.map((outcome) => outcome.status === "fulfilled" ? stop(outcome.value) : undefined));
    }
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("concurrent same-endpoint launchers reuse the listener that won the bind", linux, async () => {
  const f = fixture();
  const firstClaimed = deferred();
  const releaseFirst = deferred();
  let firstPromise;
  let secondPromise;
  let outcomes = [];
  try {
    const requested = await endpoint();
    firstPromise = startCentralMcpServer({
      root: join(f.directory, "first-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(requested),
      afterMarkerClaim: async () => {
        firstClaimed.resolve();
        await releaseFirst.promise;
      }
    });
    await firstClaimed.promise;

    secondPromise = startCentralMcpServer({
      root: join(f.directory, "second-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    await secondPromise.then(() => undefined, () => undefined);
    releaseFirst.resolve();
    outcomes = await Promise.allSettled([firstPromise, secondPromise]);

    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.kind === "started").length,
      1,
      "one launcher owns the endpoint"
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.kind === "reused").length,
      1,
      "the EADDRINUSE launcher reuses the marked live server"
    );
    assert.equal(await centralGeneration(requested), JSON.parse(readFileSync(
      centralMcpMarkerPath({ runtimeBase: f.runtimeBase }),
      "utf8"
    )).generation);
  } finally {
    releaseFirst.resolve();
    if (firstPromise || secondPromise) {
      outcomes = outcomes.length > 0
        ? outcomes
        : await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
      await Promise.all(outcomes.map((outcome) => outcome.status === "fulfilled" ? stop(outcome.value) : undefined));
    }
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("M3: endpoint generation alone decides liveness, never marker PID or age", linux, async () => {
  const f = fixture();
  let reclaimed;
  let live;
  let replacement;
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  try {
    const deadEndpoint = await endpoint();
    const markerPath = centralMcpMarkerPath({ runtimeBase: f.runtimeBase });
    mkdirSync(dirname(markerPath), { mode: 0o700 });
    chmodSync(dirname(markerPath), 0o700);
    writeFileSync(
      markerPath,
      marker(deadEndpoint, "dead-generation", unrelated.pid, new Date().toISOString()),
      { mode: 0o600 }
    );
    chmodSync(markerPath, 0o600);

    // The unrelated process is live, but no endpoint returns this generation:
    // identity says dead and the exact endpoint is reclaimed.
    reclaimed = await startCentralMcpServer({
      root: join(f.directory, "reclaimed-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(deadEndpoint)
    });
    assert.equal(reclaimed.kind, "started");
    assert.notEqual(reclaimed.generation, "dead-generation");
    assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).pid, process.pid);
    await stop(reclaimed);
    reclaimed = undefined;

    // A marker can be ancient and still be live: its matching generation must
    // be adopted rather than reclaimed or rejected as stale by age.
    const liveEndpoint = await endpoint();
    live = await startCentralMcpServer({
      root: join(f.directory, "live-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(liveEndpoint)
    });
    assert.equal(live.kind, "started");
    const oldLiveMarker = marker(liveEndpoint, live.generation, unrelated.pid);
    writeFileSync(markerPath, oldLiveMarker, { mode: 0o600 });
    chmodSync(markerPath, 0o600);
    const adopted = await startCentralMcpServer({
      root: join(f.directory, "adopted-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(liveEndpoint)
    });
    assert.equal(adopted.kind, "reused", "an old matching generation remains live");
    assert.equal(adopted.generation, live.generation);
    assert.equal(readFileSync(markerPath, "utf8"), oldLiveMarker, "liveness never rewrites an old live marker");
    assert.equal(existsSync(join(f.directory, "adopted-store")), false);

    // A real server answering a different generation is equally not the marker's
    // referent. The new server must reclaim, not silently reuse it.
    writeFileSync(markerPath, marker(liveEndpoint, "forged-different-generation"), { mode: 0o600 });
    chmodSync(markerPath, 0o600);
    const replacementEndpoint = await endpoint();
    replacement = await startCentralMcpServer({
      root: join(f.directory, "replacement-store"),
      runtimeBase: f.runtimeBase,
      env: envFor(replacementEndpoint)
    });
    assert.equal(replacement.kind, "started", "a mismatched live generation is never adopted");
    assert.notEqual(replacement.generation, "forged-different-generation");
  } finally {
    unrelated.kill("SIGTERM");
    await stop(replacement);
    await stop(live);
    await stop(reclaimed);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("M4: an absent preferred runtime base refuses without a /tmp fallback", linux, async () => {
  const directory = mkdtempSync(join(tmpdir(), "h2a-mcp-central-no-base-"));
  const previousTmpdir = process.env.TMPDIR;
  const isolatedTmpdir = join(directory, "empty-tmp");
  mkdirSync(isolatedTmpdir, { mode: 0o700 });
  try {
    const requested = await endpoint();
    const absentBase = join(directory, "missing", String(currentUid()));
    process.env.TMPDIR = isolatedTmpdir;
    const before = snapshotTree(isolatedTmpdir);

    await assert.rejects(
      startCentralMcpServer({
        root: join(directory, "store"),
        runtimeBase: absentBase,
        env: envFor(requested)
      }),
      new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV)
    );

    assert.equal(existsSync(absentBase), false);
    const after = snapshotTree(isolatedTmpdir);
    assert.deepEqual(
      [...after].filter((entry) => !before.has(entry)),
      [],
      "missing-base refusal creates no entry anywhere in its isolated /tmp base"
    );
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("central client flag is fail-closed and routes new clients to the exact central URL", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await endpoint();
    const oldStdio = { command: "h2a", args: ["mcp-serve"] };
    assert.deepEqual(renderH2aMcpServer({}, {}), oldStdio, "absent flag preserves the stdio path");
    assert.deepEqual(
      renderH2aMcpServer({}, { [H2A_MCP_CENTRAL_ENV]: "garbage" }),
      oldStdio,
      "garbage flag preserves the stdio path"
    );
    assert.throws(
      () => centralMcpClientEndpoint({ [H2A_MCP_CENTRAL_ENV]: "true" }),
      new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV)
    );
    await assert.rejects(
      startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: {} }),
      new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV)
    );
    assert.equal(existsSync(join(f.runtimeBase, "h2a-mcp-central")), false);
    assert.equal(existsSync(f.root), false, "missing endpoint writes/binds nothing");

    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    assert.equal(started.kind, "started");
    const config = renderH2aMcpServer({}, {
      [H2A_MCP_CENTRAL_ENV]: "true",
      [H2A_MCP_CENTRAL_ENDPOINT_ENV]: requested
    });
    assert.deepEqual(config, { url: requested }, "central config contains no stdio sidecar command");

    const response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "central-test", version: "1" }
        }
      })
    });
    assert.equal(response.status, 200);
    const initialized = await response.json();
    assert.equal(initialized.result.serverInfo.name, "@sentropic/h2a");
  } finally {
    await stop(started);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

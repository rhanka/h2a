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
import { createServer as createHttpServer } from "node:http";
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

function marker(
  endpointValue,
  generation,
  pid = process.pid,
  startedAt = "2000-01-01T00:00:00.000Z",
  token = "test-central-token"
) {
  return `${JSON.stringify({
    endpoint: endpointValue,
    generation,
    pid,
    startedAt,
    token
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

async function expectStartRefusal(options) {
  const outcome = await Promise.allSettled([startCentralMcpServer(options)]);
  if (outcome[0].status === "fulfilled") await stop(outcome[0].value);
  assert.equal(outcome[0].status, "rejected");
  return outcome[0].reason;
}

const centralLauncher = `
import { startCentralMcpServer } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
import { once } from "node:events";

const [endpoint, root, runtimeBase, pingResponseDelayMs = "", waitForStart] = process.argv.slice(1);
try {
  if (waitForStart === "wait") {
    const released = once(process, "SIGUSR2");
    const keepAlive = setInterval(() => {}, 1_000);
    process.stdout.write(JSON.stringify({ kind: "ready" }) + "\\n");
    await released;
    clearInterval(keepAlive);
  }
  const started = await startCentralMcpServer({
    root,
    runtimeBase,
    env: { H2A_MCP_CENTRAL_ENDPOINT: endpoint },
    ...(pingResponseDelayMs === "" ? {} : { pingResponseDelayMs: Number(pingResponseDelayMs) })
  });
  process.stdout.write(JSON.stringify({ kind: "result", result: started.kind, endpoint: started.endpoint, generation: started.generation }) + "\\n");
  if (started.kind === "started") {
    const stop = async () => {
      await started.stop();
      process.exit(0);
    };
    process.once("SIGTERM", () => void stop());
    process.once("SIGINT", () => void stop());
    setInterval(() => {}, 1000);
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: "error", message: error instanceof Error ? error.message : String(error) }) + "\\n");
}
`;

function launchCentralProcess({ endpoint: endpointValue, root, runtimeBase, pingResponseDelayMs, waitForStart = false }) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", centralLauncher, endpointValue, root, runtimeBase,
      pingResponseDelayMs === undefined ? "" : String(pingResponseDelayMs), waitForStart ? "wait" : ""],
    {
      cwd: process.cwd(),
      env: { ...process.env, REMOTE_CLI_CONFIG_HOME: process.env.REMOTE_CLI_CONFIG_HOME ?? join(runtimeBase, "remote-cli") },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let output = "";
  let resultSettled = false;
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      for (;;) {
        const newline = output.indexOf("\n");
        if (newline === -1) return;
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.kind === "ready") {
            if (!readySettled) {
              readySettled = true;
              resolveReady();
            }
          } else if (!resultSettled) {
            resultSettled = true;
            resolve(message);
          }
        } catch (error) {
          if (!resultSettled) {
            resultSettled = true;
            reject(error);
          }
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!resultSettled) reject(new Error(`central launcher exited before reporting (code=${code}, signal=${signal}): ${output}`));
      if (!readySettled) rejectReady(new Error(`central launcher exited before becoming ready (code=${code}, signal=${signal})`));
    });
  });
  // The F3 barrier awaits readiness before it observes result. Keep a child
  // startup error associated with that later assertion rather than letting
  // Node report it as an unhandled rejection in the intervening turn.
  void result.catch(() => undefined);
  void ready.catch(() => undefined);
  return {
    child,
    ready,
    result,
    release() {
      child.kill("SIGUSR2");
    }
  };
}

async function stopCentralProcess(launcher) {
  if (!launcher) return;
  if (launcher.child.exitCode !== null || launcher.child.signalCode !== null) return;
  launcher.child.kill("SIGTERM");
  await Promise.race([
    once(launcher.child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (launcher.child.exitCode === null && launcher.child.signalCode === null) {
    launcher.child.kill("SIGKILL");
    await once(launcher.child, "exit");
  }
}

async function slowPingProxy(target, delayMs) {
  const listener = createHttpServer((request, response) => {
    if (request.url !== "/_h2a-central/ping") {
      response.writeHead(404);
      response.end();
      return;
    }
    setTimeout(() => {
      void fetch(new URL(request.url, target))
        .then(async (upstream) => {
          response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
          response.end(await upstream.text());
        })
        .catch(() => {
          response.writeHead(502);
          response.end();
        });
    }, delayMs);
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    async stop() {
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  };
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

test("F1 negative: wildcard central endpoint is refused before bind", linux, async () => {
  const f = fixture();
  try {
    const reason = await expectStartRefusal({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor("http://0.0.0.0:43123/mcp")
    });
    assert.match(String(reason), new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV));
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("F1 negative: LAN-style central endpoint is refused before bind", linux, async () => {
  const f = fixture();
  try {
    const reason = await expectStartRefusal({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor("http://192.168.20.20:43123/mcp")
    });
    assert.match(String(reason), new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV));
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("F2 negative: port zero central endpoint is refused before bind", linux, async () => {
  const f = fixture();
  try {
    const reason = await expectStartRefusal({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor("http://127.0.0.1:0/mcp")
    });
    assert.match(String(reason), new RegExp(H2A_MCP_CENTRAL_ENDPOINT_ENV));
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("F1 negative: MCP requests without the marker token are unauthorized", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await endpoint();
    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    const response = await fetch(requested, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "unauthorized", version: "1" } }
      })
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("mcp-session-id"), null, "an unauthorized request gets no MCP session");
  } finally {
    await stop(started);
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("F1 negative: cross-origin MCP requests are refused even with the marker token", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await endpoint();
    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: envFor(requested)
    });
    const stored = JSON.parse(readFileSync(started.markerPath, "utf8"));
    const response = await fetch(requested, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${stored.token ?? "current-code-has-no-token"}`,
        origin: "http://attacker.invalid"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cross-origin", version: "1" } }
      })
    });
    assert.equal(response.status, 403);
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

test("F3 negative: concurrent real-process reclaimers elect exactly one dead-marker successor", linux, async () => {
  const f = fixture();
  const launchers = [];
  try {
    const markerPath = centralMcpMarkerPath({ runtimeBase: f.runtimeBase });
    mkdirSync(dirname(markerPath), { mode: 0o700 });
    chmodSync(dirname(markerPath), 0o700);
    writeFileSync(markerPath, marker(await endpoint(), "dead-generation"), { mode: 0o600 });
    chmodSync(markerPath, 0o600);

    const endpoints = await Promise.all(Array.from({ length: 24 }, () => endpoint()));
    for (const [index, endpointValue] of endpoints.entries()) {
      launchers.push(launchCentralProcess({
        endpoint: endpointValue,
        root: join(f.directory, `launcher-${index}`),
        runtimeBase: f.runtimeBase,
        waitForStart: true
      }));
    }
    await Promise.all(launchers.map((launcher) => launcher.ready));
    launchers.forEach((launcher) => launcher.release());
    const outcomes = await Promise.all(launchers.map((launcher) => launcher.result));
    const started = outcomes.filter((outcome) => outcome.kind === "result" && outcome.result === "started");
    assert.equal(started.length, 1, "one concurrent reclaimer wins the marker CAS");
    assert.equal(
      outcomes.filter((outcome) => outcome.kind === "error" || outcome.result === "reused").length,
      endpoints.length - 1,
      "every non-winner reuses or refuses the elected central server"
    );

    const registered = JSON.parse(readFileSync(markerPath, "utf8"));
    const live = (await Promise.all(endpoints.map(async (endpointValue) => ({
      endpoint: endpointValue,
      generation: await centralGeneration(endpointValue)
    })))).filter((observation) => observation.generation !== undefined);
    assert.equal(live.length, 1, "all candidate endpoints contain exactly one live central server");
    assert.equal(live[0].endpoint, registered.endpoint, "the marker names the only live successor");
    assert.equal(live[0].generation, registered.generation, "the marker generation names the only live successor");
  } finally {
    await Promise.all(launchers.map((launcher) => stopCentralProcess(launcher)));
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("F4 negative: a slow real central ping is not reclaimed by a divergent launcher", linux, async () => {
  const f = fixture();
  let first;
  let second;
  let proxy;
  try {
    const firstEndpoint = await endpoint();
    const secondEndpoint = await endpoint();
    first = launchCentralProcess({
      endpoint: firstEndpoint,
      root: join(f.directory, "first-store"),
      runtimeBase: f.runtimeBase
    });
    const firstResult = await first.result;
    assert.deepEqual(firstResult.kind === "result" ? firstResult.result : firstResult.kind, "started");
    assert.ok(await centralGeneration(firstEndpoint), "the first launcher is a real central server");

    proxy = await slowPingProxy(firstEndpoint, 1_000);
    const firstMarker = JSON.parse(readFileSync(centralMcpMarkerPath({ runtimeBase: f.runtimeBase }), "utf8"));
    writeFileSync(
      centralMcpMarkerPath({ runtimeBase: f.runtimeBase }),
      marker(proxy.endpoint, firstMarker.generation, firstMarker.pid, firstMarker.startedAt, firstMarker.token),
      { mode: 0o600 }
    );
    chmodSync(centralMcpMarkerPath({ runtimeBase: f.runtimeBase }), 0o600);

    second = launchCentralProcess({
      endpoint: secondEndpoint,
      root: join(f.directory, "second-store"),
      runtimeBase: f.runtimeBase
    });
    const secondResult = await second.result;
    assert.equal(secondResult.kind, "error", "a possible live registration must refuse rather than reclaim");
    assert.match(secondResult.message, /LIVE central MCP server is registered on/);

    const live = (await Promise.all([firstEndpoint, secondEndpoint].map(async (endpointValue) => ({
      endpoint: endpointValue,
      generation: await centralGeneration(endpointValue)
    })))).filter((observation) => observation.generation !== undefined);
    assert.equal(live.length, 1, "the slow original server remains the only live central server");
    assert.equal(live[0].endpoint, firstEndpoint);
  } finally {
    if (proxy) await proxy.stop();
    await stopCentralProcess(second);
    await stopCentralProcess(first);
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
    const config = centralMcpClientEndpoint({
      [H2A_MCP_CENTRAL_ENV]: "true",
      [H2A_MCP_CENTRAL_ENDPOINT_ENV]: requested
    }, { runtimeBase: f.runtimeBase });
    assert.deepEqual(config, {
      url: requested,
      headers: { Authorization: `Bearer ${JSON.parse(readFileSync(started.markerPath, "utf8")).token}` }
    }, "central clients obtain their auth header from the private marker");

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...config.headers
      },
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

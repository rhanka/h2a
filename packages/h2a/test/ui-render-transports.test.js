import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  runMcpStdio,
  startCentralMcpServer,
  H2A_MCP_CENTRAL_ENDPOINT_ENV
} from "../dist/index.js";

/**
 * json-render L3.2 — the SEP-1865 negotiation and resources/* routes on the
 * h2a transports (h2a spec §2.2): direct stdio advertises and threads
 * io.modelcontextprotocol/ui, serves resources/list and resources/read, and
 * refuses unknown URIs with -32002; the central HTTP server does the same
 * through the MCP SDK (per-session client capabilities). The central stdio
 * shim on main is a transparent forwarder, so it needs no separate wiring.
 */

const UI_EXT = "io.modelcontextprotocol/ui";
const UI_MIME = "text/html;profile=mcp-app";
const RENDER_URI = "ui://sentropic/render/v1";
const CATALOG_URI = "a2ui://sentropic/catalog/v1";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-uirender-transport-"));
}

/**
 * Drive runMcpStdio with a scripted sequence of newline-delimited JSON-RPC
 * messages; resolves with the parsed responses (same harness as
 * mcp-stdio.test.js).
 */
async function runScenario(root, lines) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let buffered = "";
  stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
  });

  const done = runMcpStdio({ root, stdin, stdout, stderr });

  for (const line of lines) {
    stdin.write(`${line}\n`);
  }
  stdin.end();

  await done;

  return buffered
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function initializeRequest(id, { ui = true } = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: ui ? { extensions: { [UI_EXT]: { mimeTypes: [UI_MIME] } } } : {},
      clientInfo: { name: "uirender-test", version: "1" }
    }
  };
}

test("stdio: initialize negotiates io.modelcontextprotocol/ui and advertises resources", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify(initializeRequest(1)),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: RENDER_URI } }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: CATALOG_URI } }),
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "ui://sentropic/none/v1" } })
    ]);
    const init = responses.find((response) => response.id === 1);
    assert.equal(init.result.capabilities.tools.listChanged, true);
    assert.deepEqual(init.result.capabilities.resources, {});
    assert.deepEqual(init.result.capabilities.extensions[UI_EXT], { mimeTypes: [UI_MIME] });

    const list = responses.find((response) => response.id === 2);
    assert.equal(list.result.resources.length, 5);
    assert.deepEqual(
      list.result.resources.map((resource) => resource.uri),
      [
        RENDER_URI,
        CATALOG_URI,
        "ui://sentropic/BarChart/v1",
        "ui://sentropic/BpmnCanvas/v1",
        "ui://sentropic/DecisionDossier/v1"
      ]
    );

    const renderRead = responses.find((response) => response.id === 3);
    const renderContent = renderRead.result.contents[0];
    assert.equal(renderContent.uri, RENDER_URI);
    assert.equal(renderContent.mimeType, UI_MIME);
    assert.ok(renderContent.text.includes('id="st-host-config"'));
    assert.ok(renderContent.text.includes("customElements.define(`st-bar-chart`"));
    assert.deepEqual(renderContent._meta.ui.csp, {
      resourceDomains: ["https://cdn.jsdelivr.net"],
      connectDomains: []
    });

    const catalogRead = responses.find((response) => response.id === 4);
    assert.equal(catalogRead.result.contents[0].mimeType, "application/schema+json");
    assert.ok(catalogRead.result.contents[0].text.includes('"catalogId"'));

    const missing = responses.find((response) => response.id === 5);
    assert.equal(missing.error.code, -32002);
    assert.match(missing.error.message, /Resource not found: ui:\/\/sentropic\/none\/v1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stdio: initialize without the ui extension still advertises the server capability", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify(initializeRequest(1, { ui: false })),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" })
    ]);
    const init = responses.find((response) => response.id === 1);
    assert.deepEqual(init.result.capabilities.extensions[UI_EXT], { mimeTypes: [UI_MIME] });
    assert.deepEqual(init.result.capabilities.resources, {});
    const list = responses.find((response) => response.id === 2);
    assert.equal(list.result.resources.length, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Central HTTP transport (the marker/uid semantics need Linux).
// ---------------------------------------------------------------------------
const linux = process.platform === "linux" ? {} : { skip: "central MCP marker requires Linux uid/runtime semantics" };

test("central HTTP: initialize advertises the ui extension and serves resources/read", linux, async () => {
  assert.equal(typeof process.getuid, "function", "Linux provides process.getuid");
  const directory = mkdtempSync(join(tmpdir(), "h2a-uirender-central-"));
  const runtimeBase = join(directory, "run", String(process.getuid()));
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  chmodSync(runtimeBase, 0o700);
  const root = join(directory, "store");
  let started;
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  const requested = `http://127.0.0.1:${address.port}/mcp`;
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  try {
    started = await startCentralMcpServer({
      root,
      runtimeBase,
      env: { [H2A_MCP_CENTRAL_ENDPOINT_ENV]: requested }
    });
    assert.equal(started.kind, "started");
    const stored = JSON.parse(readFileSync(started.markerPath, "utf8"));
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${stored.token}`
    };
    const initResponse = await fetch(requested, {
      method: "POST",
      headers,
      body: JSON.stringify(initializeRequest(1))
    });
    assert.equal(initResponse.status, 200);
    const sessionId = initResponse.headers.get("mcp-session-id");
    assert.ok(sessionId, "the streamable transport opens an MCP session");
    const init = await initResponse.json();
    assert.deepEqual(init.result.capabilities.extensions[UI_EXT], { mimeTypes: [UI_MIME] });
    assert.deepEqual(init.result.capabilities.resources, {});
    assert.equal(init.result.capabilities.tools.listChanged, true);

    const sessionHeaders = { ...headers, "mcp-session-id": sessionId };
    await fetch(requested, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });

    const listResponse = await fetch(requested, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" })
    });
    const list = await listResponse.json();
    assert.equal(list.result.resources.length, 5);
    assert.deepEqual(
      list.result.resources.map((resource) => resource.uri),
      [
        RENDER_URI,
        CATALOG_URI,
        "ui://sentropic/BarChart/v1",
        "ui://sentropic/BpmnCanvas/v1",
        "ui://sentropic/DecisionDossier/v1"
      ]
    );

    const readResponse = await fetch(requested, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: CATALOG_URI } })
    });
    const read = await readResponse.json();
    assert.equal(read.result.contents[0].mimeType, "application/schema+json");
    assert.ok(read.result.contents[0].text.includes('"catalogId"'));

    const missingResponse = await fetch(requested, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "resources/read",
        params: { uri: "ui://sentropic/none/v1" }
      })
    });
    const missing = await missingResponse.json();
    assert.equal(missing.error.code, -32002);
  } finally {
    if (started?.kind === "started") await started.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

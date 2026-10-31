import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startCentralMcpServer, H2A_MCP_CENTRAL_ENDPOINT_ENV, loadUiRenderAssets } from "../dist/index.js";

async function withCentral(env, run) {
  const directory = mkdtempSync(join(tmpdir(), "h2a-ui-sessions-"));
  const runtimeBase = join(directory, "run", String(process.getuid()));
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  const listener = createServer();
  let started;
  try {
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const endpoint = `http://127.0.0.1:${listener.address().port}/mcp`;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    started = await startCentralMcpServer({ root: join(directory, "store"), runtimeBase,
      env: { ...env, [H2A_MCP_CENTRAL_ENDPOINT_ENV]: endpoint } });
    assert.equal(started.kind, "started");
    const marker = JSON.parse(readFileSync(started.markerPath, "utf8"));
    let id = 0;
    async function request(method, params, session) {
      const response = await fetch(endpoint, { method: "POST", headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        authorization: `Bearer ${marker.token}`, ...(session ? { "mcp-session-id": session } : {})
      }, body: JSON.stringify({ jsonrpc: "2.0", ...(method === "notifications/initialized" ? {} : { id: ++id }), method, params }) });
      assert.ok(response.ok, `${method}: HTTP ${response.status}`);
      return { session: response.headers.get("mcp-session-id"), body: response.status === 202 ? null : await response.json() };
    }
    async function connect() {
      const { session } = await request("initialize", { protocolVersion: "2025-06-18",
        capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
        clientInfo: { name: "ui-session-test", version: "1" } });
      assert.ok(session);
      await request("notifications/initialized", {}, session);
      return session;
    }
    await run({ connect, request });
  } finally {
    if (listener.listening) await new Promise(resolve => listener.close(resolve));
    if (started?.kind === "started") await started.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("central HTTP keeps the last rendered component per connection, including new sessions", async () => {
  const assets = await loadUiRenderAssets();
  await withCentral({}, async ({ connect, request }) => {
    const a = await connect();
    const b = await connect();
    const call = async (session, name, args) => (await request("tools/call", { name, arguments: args }, session)).body.result;
    for (const [session, component] of [[a, "DecisionDossier"], [b, "BarChart"]]) {
      const root = assets.catalog.components[component]["x-sentropic"].example;
      assert.equal((await call(session, "render", { contract: "1.0", root })).isError, undefined);
    }
    const intent = name => ({ event: "intent", name, target: "item-1", context: {} });
    assert.equal((await call(a, "submit_intent", intent("choose-option"))).isError, undefined);
    assert.equal((await call(b, "submit_intent", intent("select"))).isError, undefined);
    assert.equal((await call(b, "submit_intent", intent("choose-option"))).isError, true);
    const c = await connect();
    const unknown = await call(c, "submit_intent", intent("select"));
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent.diagnostics[0].path, "/context/component");
  });
});

test("central HTTP resources use the injected environment for theme, locale and watermark gate", async () => {
  const secret = "CANARY-CENTRAL-GATE-c1f6";
  await withCentral({ H2A_UI_THEME: "forge", H2A_UI_COLOR_SCHEME: "dark", H2A_UI_LOCALE: "fr-CA",
    SENTROPIC_BPMN_WATERMARK_LICENSE: secret, SENTROPIC_BPMN_WATERMARK_REFERENCE: "PUBLIC-CENTRAL-REF" }, async ({ connect, request }) => {
    const session = await connect();
    const { body } = await request("resources/read", { uri: "ui://sentropic/BarChart/v1" }, session);
    const html = body.result.contents[0].text;
    const config = JSON.parse(html.match(/id="st-host-config">([\s\S]*?)<\/script>/)[1]);
    assert.equal(config.theme, "forge");
    assert.equal(config.colorScheme, "dark");
    assert.equal(config.locale, "fr-CA");
    assert.equal(config.bpmn.watermark.license, "PUBLIC-CENTRAL-REF");
    assert.equal(html.includes(secret), false);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readInlineModule } from "../dist/runtime/mcp/ui-render/inline.js";

import {
  CATALOG_MIME_TYPE,
  createUiRenderResources,
  loadUiRenderAssets,
  negotiateUiExtension,
  serverUiExtensionCapability,
  UI_MIME_TYPE,
  UnknownResourceError
} from "../dist/index.js";

/**
 * json-render L3.2 — SEP-1865 negotiation (h2a spec §2.1) and the ui://
 * resource surface (§3): a client has negotiated io.modelcontextprotocol/ui
 * only when it advertises the MCP App mime type; the 5 pinned resource
 * descriptors are listed; resources/read assembles the shell HTML with the
 * vendored core, the per-component chunk and #st-host-config, serves the
 * exact pinned catalog text under a2ui://, and refuses every other URI.
 */

const CANARY = "CANARY-NEGOTIATION-SECRET-DO-NOT-EMIT-b41c";
const RENDER_URI = "ui://sentropic/render/v1";
const CATALOG_URI = "a2ui://sentropic/catalog/v1";
const PILOT_CSP = { resourceDomains: ["https://cdn.jsdelivr.net"], connectDomains: [] };

const VENDOR = new URL("../vendor/design-system-elements/", import.meta.url);

let assets;
test.before(async () => {
  assets = await loadUiRenderAssets();
});

test("negotiateUiExtension: negotiated only for a ui extension advertising the MCP App mime type", () => {
  assert.deepEqual(negotiateUiExtension(undefined), { negotiated: false, mimeTypes: [] });
  assert.deepEqual(negotiateUiExtension({}), { negotiated: false, mimeTypes: [] });
  assert.deepEqual(negotiateUiExtension({ capabilities: {} }), { negotiated: false, mimeTypes: [] });
  assert.deepEqual(
    negotiateUiExtension({
      capabilities: { extensions: { "io.modelcontextprotocol/ui": null } }
    }),
    { negotiated: false, mimeTypes: [] }
  );
  assert.deepEqual(
    negotiateUiExtension({
      capabilities: {
        extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/plain"] } }
      }
    }),
    { negotiated: false, mimeTypes: [] }
  );
  const negotiated = negotiateUiExtension({
    capabilities: {
      extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [UI_MIME_TYPE, "text/html"] } }
    }
  });
  assert.equal(negotiated.negotiated, true);
  assert.deepEqual(negotiated.mimeTypes, [UI_MIME_TYPE]);
});

test("serverUiExtensionCapability advertises exactly the MCP App mime type", () => {
  assert.deepEqual(serverUiExtensionCapability, { mimeTypes: ["text/html;profile=mcp-app"] });
});

test("listResources returns the 5 pinned descriptors with the pilot CSP declaration", () => {
  const resources = createUiRenderResources({ assets, env: {} });
  const { resources: list } = resources.listResources();
  assert.deepEqual(
    list.map((resource) => resource.uri),
    [
      "ui://sentropic/render/v1",
      "a2ui://sentropic/catalog/v1",
      "ui://sentropic/BarChart/v1",
      "ui://sentropic/BpmnCanvas/v1",
      "ui://sentropic/DecisionDossier/v1"
    ]
  );
  const render = list[0];
  assert.equal(render.name, "Sentropic Design-System JSON Renderer (v1)");
  assert.equal(render.mimeType, UI_MIME_TYPE);
  assert.deepEqual(render._meta.ui.csp, PILOT_CSP);
  const catalog = list[1];
  assert.equal(catalog.name, "Sentropic Design-System Elements Catalogue (v1)");
  assert.equal(catalog.mimeType, CATALOG_MIME_TYPE);
  assert.equal(catalog._meta, undefined);
  for (const id of ["BarChart", "BpmnCanvas", "DecisionDossier"]) {
    const perComponent = list.find((resource) => resource.uri === `ui://sentropic/${id}/v1`);
    assert.equal(perComponent.mimeType, UI_MIME_TYPE);
    assert.deepEqual(perComponent._meta.ui.csp, PILOT_CSP);
  }
});

test("readResource render/v1: an oversized combined closure explicitly directs to per-component tools", () => {
  const resources = createUiRenderResources({ assets, env: {} });
  const { contents } = resources.readResource(RENDER_URI);
  assert.equal(contents.length, 1);
  const [content] = contents;
  assert.equal(content.uri, RENDER_URI);
  assert.equal(content.mimeType, UI_MIME_TYPE);
  assert.deepEqual(content._meta.ui.csp, PILOT_CSP);
  assert.ok(content.text.startsWith("<!DOCTYPE html>"));
  assert.ok(content.text.includes('<script type="application/json" id="st-host-config">'));
  assert.ok(content.text.includes('"theme":"sent-tech"'));
  assert.match(content.text, /data-st-resource-degraded="true"/);
  for (const name of ["BarChart", "DecisionDossier", "BpmnCanvas"]) assert.ok(content.text.includes(`render_${name}`));
  assert.ok(Buffer.byteLength(content.text) < 960 * 1024);
  const bar = resources.readResource("ui://sentropic/BarChart/v1").contents[0];
  assert.ok(bar.text.includes(readInlineModule(assets, "BarChart")));
  // The SEP-1865 shell protocol (h2a spec §3.3).
  for (const method of ["ui/initialize", "ui/notifications/tool-input", "ui/notifications/tool-result", "host-context-changed", "submit_intent", "st-intent"]) assert.ok(bar.text.includes(method));
  assert.ok(bar.text.includes('"events":{"BarChart":["select"]'));
});

test("readResource per-component: core plus only the requested component's chunk", () => {
  const resources = createUiRenderResources({ assets, env: {} });
  const focusChunk = readInlineModule(assets, "DecisionDossier");
  const dossier = resources.readResource("ui://sentropic/DecisionDossier/v1").contents[0];
  assert.equal(dossier.mimeType, UI_MIME_TYPE);
  assert.ok(dossier.text.includes(focusChunk), "the complete focus closure is inlined");
  const bar = resources.readResource("ui://sentropic/BarChart/v1").contents[0];
  assert.ok(bar.text.includes(readInlineModule(assets, "BarChart")));
  assert.equal(
    bar.text.includes(focusChunk),
    false,
    "BarChart's resource must not inline another component's chunk"
  );
  const bpmn = resources.readResource("ui://sentropic/BpmnCanvas/v1").contents[0];
  assert.match(bpmn.text, /data-st-resource-degraded="true"/);
  assert.match(bpmn.text, /non-UI text fallback/);
});

test("readResource a2ui catalog: the exact pinned catalog text", () => {
  const resources = createUiRenderResources({ assets, env: {} });
  const [content] = resources.readResource(CATALOG_URI).contents;
  assert.equal(content.uri, CATALOG_URI);
  assert.equal(content.mimeType, CATALOG_MIME_TYPE);
  assert.equal(content.text, assets.catalogText);
});

test("readResource unknown URI refuses with the typed unknown-resource error", () => {
  const resources = createUiRenderResources({ assets, env: {} });
  assert.throws(() => resources.readResource("ui://sentropic/other/v1"), UnknownResourceError);
  assert.throws(
    () => resources.readResource("file:///etc/passwd"),
    (error) => {
      assert.ok(error instanceof UnknownResourceError);
      assert.match(error.message, /Resource not found: file:\/\/\/etc\/passwd/);
      return true;
    }
  );
});

test("W3/W4: the watermark reference is emitted only through the gated host config; the license never", () => {
  const resources = createUiRenderResources({
    assets,
    env: {
      SENTROPIC_BPMN_WATERMARK_LICENSE: CANARY,
      SENTROPIC_BPMN_WATERMARK_REFERENCE: "REF-PUBLIC-2026"
    }
  });
  const html = resources.readResource(RENDER_URI).contents[0].text;
  assert.ok(html.includes('"bpmn":{"watermark":{"license":"REF-PUBLIC-2026"}}'));
  assert.equal(html.includes(CANARY), false, "the license secret leaked into the shell HTML");
});

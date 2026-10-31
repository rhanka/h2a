import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMcpServer,
  createUiRenderModule,
  fallbackContent,
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  UI_RENDER_RESOURCE_URI,
  UI_RENDER_TOOL_NAMES,
  utf8ByteLength
} from "../dist/index.js";

const CANARY = "CANARY-TOOLS-SECRET-DO-NOT-EMIT-77e2";
const NEGOTIATED = { negotiated: true, mimeTypes: ["text/html;profile=mcp-app"] };
const NOT_NEGOTIATED = { negotiated: false, mimeTypes: [] };

function firstText(result) {
  assert.ok(Array.isArray(result.content) && result.content.length > 0);
  const [item] = result.content;
  assert.equal(item.type, "text");
  return item.text;
}

test("tools/list: the seven ui-render descriptors match the spec _meta and input schemas", async () => {
  const module = await createUiRenderModule();
  const tools = module.tools.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [...UI_RENDER_TOOL_NAMES].sort()
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const render = byName.get("render");
  assert.ok(render);
  assert.deepEqual(render._meta?.ui, {
    resourceUri: "ui://sentropic/render/v1",
    visibility: ["model", "app"],
    csp: { resourceDomains: ["https://cdn.jsdelivr.net"], connectDomains: [] }
  });
  // The render input schema is the normative envelope schema, verbatim.
  assert.deepEqual(render.inputSchema, module.assets.envelopeSchema);
  assert.equal(render.annotations?.readOnlyHint, true);

  const barChart = byName.get("render_BarChart");
  assert.ok(barChart);
  assert.deepEqual(barChart._meta?.ui, {
    resourceUri: "ui://sentropic/BarChart/v1",
    visibility: ["model", "app"],
    csp: { resourceDomains: ["https://cdn.jsdelivr.net"], connectDomains: [] }
  });
  assert.deepEqual(barChart.inputSchema, module.assets.schemas.BarChart);

  const submitIntent = byName.get("submit_intent");
  assert.ok(submitIntent);
  assert.deepEqual(submitIntent._meta?.ui, { visibility: ["app"] });
  assert.deepEqual(submitIntent.inputSchema, {
    type: "object",
    additionalProperties: false,
    required: ["event", "name", "target", "context"],
    properties: {
      event: { const: "intent" },
      name: { type: "string", enum: ["select", "open", "choose-option", "comment"] },
      target: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        description: "Identifier of the selected/targeted item (e.g. bar label key or option id)."
      },
      context: {
        type: "object",
        additionalProperties: true,
        description: "Structured intent context (e.g. component name, question targetRef, annotation, value)."
      }
    }
  });

  const listComponents = byName.get("list_components");
  assert.ok(listComponents);
  assert.deepEqual(listComponents.inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false
  });
  assert.deepEqual(listComponents._meta?.ui, { visibility: ["model", "app"] });

  const getSchema = byName.get("get_schema");
  assert.ok(getSchema);
  assert.deepEqual(getSchema.inputSchema, {
    type: "object",
    additionalProperties: false,
    required: ["component"],
    properties: {
      component: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        description: "Catalogued component name (BarChart, BpmnCanvas, DecisionDossier)."
      }
    }
  });
});

test("list_components: returns the catalogue trio with the pinned summaries", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool("list_components", {}, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  assert.deepEqual(result.structuredContent, {
    catalogId: module.assets.catalog.catalogId,
    components: [
      {
        name: "BarChart",
        element: "st-bar-chart",
        contract: "1.0",
        engine: "core",
        summary:
          "Categorical bar chart with optional reference lines, shaded bands, goal line, annotations, and bar selection."
      },
      {
        name: "BpmnCanvas",
        element: "st-bpmn-canvas",
        contract: "1.0",
        engine: "lazy:bpmn-canvas",
        summary: "Read-only BPMN 2.0 process diagram viewer rendering F1 moddle JSON documents."
      },
      {
        name: "DecisionDossier",
        element: "st-decision-dossier",
        contract: "1.0",
        engine: "lazy:focus",
        summary: "Read-only decision-dossier snapshot published by @sentropic/focus."
      }
    ]
  });
  const lines = firstText(result).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    "BarChart (contract 1.0, engine core): Categorical bar chart with optional reference lines, shaded bands, goal line, annotations, and bar selection."
  );
});

test("get_schema: returns the standalone schema and example envelope, capped at 256 KiB", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool("get_schema", { component: "BarChart" }, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  const entry = module.assets.catalog.components.BarChart;
  const expectedExample = {
    catalogId: module.assets.catalog.catalogId,
    contract: entry["x-sentropic"].contract,
    root: entry["x-sentropic"].example
  };
  assert.deepEqual(result.structuredContent, {
    catalogId: module.assets.catalog.catalogId,
    schema: module.assets.schemas.BarChart,
    example: expectedExample
  });
  const text = firstText(result);
  assert.ok(utf8ByteLength(text) <= 262_144, "get_schema content respects the 256 KiB cap");
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed, result.structuredContent);
});

test("get_schema: an unknown component refuses with the typed unknown-component diagnostic", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool("get_schema", { component: "Foo" }, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "unknown-component");
  assert.equal(diagnostic.path, "/root/component");
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.source, "catalog");
  assert.deepEqual(diagnostic.detail, { component: "Foo" });
  assert.match(firstText(result), /no catalogued component is named Foo/);
});

test("render: a valid negotiated BarChart envelope echoes envelope + diagnostics and a bounded summary", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  const envelope = {
    catalogId: module.assets.catalog.catalogId,
    contract: "1.0",
    root: { ...example, id: "root" }
  };
  const result = module.tools.callTool("render", envelope, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  assert.deepEqual(result.structuredContent, { envelope, diagnostics: [] });
  const text = firstText(result);
  assert.match(text, /^Rendered BarChart \(contract 1\.0\)/);
  assert.match(text, /ui:\/\/sentropic\/render\/v1/);
  assert.ok(utf8ByteLength(text) <= 4096, "render content respects the 4 KiB cap");
});

test("render: an invalid envelope is refused with isError and a diagnostics summary", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool(
    "render",
    { contract: "1.0", root: { id: "root", component: "BarChart" }, props: {}, fallbackText: "x" },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const { diagnostics } = result.structuredContent;
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].code, "schema-violation");
  assert.match(firstText(result), /schema-violation/);
  assert.match(firstText(result), /\/props/);
});

test("render: a non-negotiated BarChart client receives the markdown table and the self-contained SVG fallback", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  const envelope = { contract: "1.0", root: { ...example, id: "root" } };
  const result = module.tools.callTool("render", envelope, { uiCapability: NOT_NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  assert.deepEqual(result.structuredContent, { envelope, diagnostics: [] });
  assert.equal(result.content.length, 2);
  const table = result.content[0].text;
  assert.ok(table.includes("# Revenue (M€)"), table);
  assert.ok(table.includes("| label | value |"), table);
  assert.ok(table.includes("| Q1 | 12 |"), table);
  assert.ok(utf8ByteLength(table) <= 4096);
  const svg = result.content[1].text;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), svg.slice(0, 60));
  assert.ok(svg.includes('viewBox="0 0 600 320"'));
  assert.ok(svg.includes("Q1"));
  assert.ok(svg.includes("Q3"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(!svg.includes("<script"));
  assert.ok(utf8ByteLength(svg) <= 32768);
});

test("render_BpmnCanvas: catalogue example passes semantics in UI and fallback modes", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BpmnCanvas["x-sentropic"].example;
  const envelope = { contract: "1.0", root: { ...example, id: "root" } };
  for (const capability of [NOT_NEGOTIATED, NEGOTIATED]) {
    for (const tool of ["render", "render_BpmnCanvas"]) {
      const result = module.tools.callTool(tool, envelope, { uiCapability: capability });
      assert.ok(result);
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent.diagnostics, []);
      if (!capability.negotiated) assert.equal(firstText(result), fallbackContent("BpmnCanvas", envelope.root)[0].text);
    }
  }
});

test("render_BpmnCanvas: invalid F1 type and unresolved reference fail in the owning semantic port", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BpmnCanvas["x-sentropic"].example;
  const documents = [
    { ...example.document, $type: "bpmn:UnknownType" },
    { ...example.document, rootElements: [{ $type: "bpmn:Process", id: "p", flowElements: [
      { $type: "bpmn:SequenceFlow", id: "f", sourceRef: "missing", targetRef: "missing" }
    ] }] }
  ];
  for (const document of documents) {
    const result = module.tools.callTool("render_BpmnCanvas", {
      contract: "1.0", root: { ...example, id: "root", document }
    }, { uiCapability: NOT_NEGOTIATED });
    assert.equal(result.isError, true);
    const diagnostic = result.structuredContent.diagnostics[0];
    assert.equal(diagnostic.code, "semantic-invalid");
    assert.equal(diagnostic.source, "bpmn-canvas");
    assert.match(diagnostic.path, /^\/root\/document/);
    assert.ok(["unknown-type", "unresolved-reference"].includes(diagnostic.detail.code));
  }
});

test("fallback: the BPMN text summary is deterministic and bounded", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BpmnCanvas["x-sentropic"].example;
  const root = { ...example, id: "root" };
  const summary = fallbackContent("BpmnCanvas", root)[0].text;
  assert.ok(summary.includes("definitions-1"), summary);
  assert.ok(summary.includes("bpmn:Definitions x 1"), summary);
  assert.ok(summary.includes("https://example.com/bpmn"), summary);
  assert.equal(fallbackContent("BpmnCanvas", root)[0].text, summary);
  assert.ok(utf8ByteLength(summary) <= 4096);
});

test("render_BpmnCanvas: an envelope naming another component is refused", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  const result = module.tools.callTool(
    "render_BpmnCanvas",
    { contract: "1.0", root: { ...example, id: "root" } },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "schema-violation");
  assert.equal(diagnostic.path, "/root/component");
});

test("render_DecisionDossier: a non-negotiated client receives the bounded markdown dossier", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.DecisionDossier["x-sentropic"].example;
  const envelope = { contract: "1.0", root: { ...example, id: "root" } };
  const result = module.tools.callTool("render_DecisionDossier", envelope, { uiCapability: NOT_NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  const markdown = firstText(result);
  assert.ok(markdown.includes("# Decision: adopt the JSON render standard"), markdown.slice(0, 120));
  assert.ok(markdown.includes("Subject: Adopt the JSON render standard for design-system rendering"));
  assert.ok(markdown.includes("Which rendering contract do we adopt?"));
  assert.ok(markdown.includes("- Adopt the JSON render standard (opt-json) → q1"));
  assert.ok(utf8ByteLength(markdown) <= 65536);
});

test("render: above the inline threshold the echo becomes envelopeSha256", async () => {
  const module = await createUiRenderModule({ inlineLimitBytes: 64 });
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  const envelope = { contract: "1.0", root: { ...example, id: "root" } };
  const result = module.tools.callTool("render", envelope, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.envelope, undefined);
  assert.match(result.structuredContent.envelopeSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.structuredContent.diagnostics, []);
});

test("submit_intent: a whitelisted intent is forwarded and acknowledged", async () => {
  const received = [];
  const module = await createUiRenderModule({
    onIntent: (intent, context) => received.push({ intent, context })
  });
  const intent = {
    event: "intent",
    name: "select",
    target: "Q2",
    context: { component: "BarChart", value: 18 }
  };
  const result = module.tools.callTool("submit_intent", intent, { uiCapability: NEGOTIATED });
  assert.ok(result);
  assert.ok(!result.isError);
  assert.equal(firstText(result), "Intent recorded: select on Q2");
  assert.ok(utf8ByteLength(firstText(result)) <= 1024);
  assert.deepEqual(result.structuredContent, { ok: true, intent });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].intent, intent);
  assert.equal(received[0].context?.uiCapability?.negotiated, true);
});

test("submit_intent: without context.component the last rendered component is used", async () => {
  const module = await createUiRenderModule();
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  module.tools.callTool(
    "render",
    { contract: "1.0", root: { ...example, id: "root" } },
    { uiCapability: NEGOTIATED }
  );
  const result = module.tools.callTool(
    "submit_intent",
    { event: "intent", name: "select", target: "Q1", context: {} },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.ok(!result.isError);
  assert.equal(firstText(result), "Intent recorded: select on Q1");
});

test("submit_intent: BpmnCanvas refuses every intent (empty whitelist)", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool(
    "submit_intent",
    { event: "intent", name: "open", target: "x", context: { component: "BpmnCanvas" } },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "schema-violation");
  assert.equal(diagnostic.path, "/name");
  assert.equal(diagnostic.source, "catalog");
});

test("submit_intent: a name outside the component whitelist is refused", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool(
    "submit_intent",
    { event: "intent", name: "select", target: "q1", context: { component: "DecisionDossier" } },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "schema-violation");
  assert.equal(diagnostic.detail.component, "DecisionDossier");
});

test("submit_intent: malformed intent input is refused with schema-violation", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool(
    "submit_intent",
    { event: "intent", name: "select" },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "schema-violation");
  assert.match(diagnostic.path, /^\/(target|context)$/);
});

test("submit_intent: with no rendered component known the intent is refused", async () => {
  const module = await createUiRenderModule();
  const result = module.tools.callTool(
    "submit_intent",
    { event: "intent", name: "select", target: "Q1", context: {} },
    { uiCapability: NEGOTIATED }
  );
  assert.ok(result);
  assert.equal(result.isError, true);
  const diagnostic = result.structuredContent?.diagnostics[0];
  assert.equal(diagnostic.code, "schema-violation");
  assert.equal(diagnostic.path, "/context/component");
});

test("W3/W4 canary: no tool result ever carries the license secret", async () => {
  const module = await createUiRenderModule({
    env: {
      SENTROPIC_BPMN_WATERMARK_LICENSE: CANARY,
      SENTROPIC_BPMN_WATERMARK_REFERENCE: "REF-PUBLIC-2026"
    }
  });
  const example = module.assets.catalog.components.BarChart["x-sentropic"].example;
  const calls = [
    module.tools.callTool("list_components", {}, { uiCapability: NEGOTIATED }),
    module.tools.callTool("get_schema", { component: "BpmnCanvas" }, { uiCapability: NEGOTIATED }),
    module.tools.callTool(
      "render",
      { contract: "1.0", root: { ...example, id: "root" } },
      { uiCapability: NOT_NEGOTIATED }
    ),
    module.tools.callTool(
      "submit_intent",
      { event: "intent", name: "select", target: "Q1", context: { component: "BarChart" } },
      { uiCapability: NEGOTIATED }
    )
  ];
  for (const result of calls) {
    assert.ok(result);
    assert.ok(!JSON.stringify(result).includes(CANARY));
  }
});

test("server composition: createMcpServer exposes the ui-render tools and routes calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-uirender-tools-"));
  try {
    const module = await createUiRenderModule();
    const server = createMcpServer({ root, storeInitialize: false, uiRender: module });
    const tools = server.listTools();
    assert.equal(tools.length, H2A_CLI_MCP_TOOL_DESCRIPTORS.length + UI_RENDER_TOOL_NAMES.length);
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of UI_RENDER_TOOL_NAMES) assert.ok(names.has(name), `${name} is listed`);
    const result = server.callTool("list_components", {}, { uiCapability: NEGOTIATED });
    assert.ok("content" in result && Array.isArray(result.content));
    const structured = result.structuredContent;
    assert.equal(structured.catalogId, module.assets.catalog.catalogId);
    const unknown = server.callTool("get_schema", { component: "Nope" }, { uiCapability: NEGOTIATED });
    assert.equal(unknown.isError, true);
    // A server WITHOUT the module keeps the historical tool surface.
    const bare = createMcpServer({ root, storeInitialize: false });
    assert.equal(bare.listTools().length, H2A_CLI_MCP_TOOL_DESCRIPTORS.length);
    assert.deepEqual(bare.callTool("render", {}, { uiCapability: NEGOTIATED }), {
      error: "unknown tool: render"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("McpToolDescriptor: tools carry the spec _meta.ui shape", async () => {
  const module = await createUiRenderModule();
  const descriptors = module.tools.listTools();
  const render = descriptors.find((tool) => tool.name === "render");
  assert.ok(render?._meta?.ui?.resourceUri === UI_RENDER_RESOURCE_URI);
});

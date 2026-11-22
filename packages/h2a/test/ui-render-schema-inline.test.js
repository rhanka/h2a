import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createMcpServer,
  createUiRenderModule,
  DEFAULT_EXTERNAL_UI_SCHEMAS,
  findNonLocalSchemaRefs,
  findSchemaRefCycles,
  inlineExternalSchemaRefs,
  runMcpStdio
} from "../dist/index.js";

const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020.js");

function compileWithExternal(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const ext of DEFAULT_EXTERNAL_UI_SCHEMAS) {
    ajv.addSchema(ext);
  }
  return ajv.compile(schema);
}

function compileStandalone(schema) {
  // Zero external schemas registered: fails immediately if any non-local $ref remains.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function buildComponentFixtures(assets, component) {
  const example = structuredClone(assets.catalog.components[component]["x-sentropic"].example);
  const baseRoot = { ...example, id: "root" };
  const catalogId = assets.catalog.catalogId;

  const missingRequiredProp = component === "BarChart" ? "data" : "document";
  const rootWithoutRequired = structuredClone(baseRoot);
  delete rootWithoutRequired[missingRequiredProp];

  const rootWithoutId = structuredClone(baseRoot);
  delete rootWithoutId.id;

  return [
    {
      name: `${component}: minimal valid example envelope`,
      value: { contract: "1.0", root: baseRoot },
      expectedValid: true
    },
    {
      name: `${component}: valid envelope with catalogId, mode, weight, and accessibility`,
      value: {
        catalogId,
        contract: "1.0",
        mode: "snapshot",
        root: {
          ...baseRoot,
          weight: 2,
          accessibility: { label: `${component} label`, description: `${component} description` }
        }
      },
      expectedValid: true
    },
    {
      name: `${component}: invalid — missing root.id (from ComponentCommon)`,
      value: { contract: "1.0", root: rootWithoutId },
      expectedValid: false
    },
    {
      name: `${component}: invalid — numeric root.id (from ComponentCommon/ComponentId)`,
      value: { contract: "1.0", root: { ...baseRoot, id: 42 } },
      expectedValid: false
    },
    {
      name: `${component}: invalid — unknown root property (unevaluatedProperties: false)`,
      value: { contract: "1.0", root: { ...baseRoot, unexpectedExtraProp: true } },
      expectedValid: false
    },
    {
      name: `${component}: invalid — accessibility with DataBinding object`,
      value: {
        contract: "1.0",
        root: { ...baseRoot, accessibility: { label: { path: "/a/b" } } }
      },
      expectedValid: false
    },
    {
      name: `${component}: invalid — accessibility with FunctionCall object`,
      value: {
        contract: "1.0",
        root: { ...baseRoot, accessibility: { label: { call: "format", returnType: "string" } } }
      },
      expectedValid: false
    },
    {
      name: `${component}: invalid — accessibility with extra property`,
      value: {
        contract: "1.0",
        root: { ...baseRoot, accessibility: { label: "ok", extra: "no" } }
      },
      expectedValid: false
    },
    {
      name: `${component}: invalid — missing required component property (${missingRequiredProp})`,
      value: { contract: "1.0", root: rootWithoutRequired },
      expectedValid: false
    },
    {
      name: `${component}: invalid — wrong root.component discriminator`,
      value: { contract: "1.0", root: { ...baseRoot, component: "OtherComponent" } },
      expectedValid: false
    },
    {
      name: `${component}: invalid — bad contract format`,
      value: { contract: "v1", root: baseRoot },
      expectedValid: false
    },
    {
      name: `${component}: invalid — unknown top-level envelope property`,
      value: { contract: "1.0", root: baseRoot, props: {} },
      expectedValid: false
    }
  ];
}

test("invariant: no exported MCP tool schema (in-process or stdio tools/list) contains a non-local $ref", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-schema-inline-"));
  try {
    const uiRender = createUiRenderModule();
    const server = createMcpServer({ root, storeInitialize: false, uiRender });
    const inProcessTools = server.listTools();
    assert.ok(inProcessTools.length > 0, "server exposes tools");

    for (const tool of inProcessTools) {
      const nonLocal = findNonLocalSchemaRefs(tool.inputSchema);
      assert.deepEqual(
        nonLocal,
        [],
        `tool ${tool.name} inputSchema must have only local #/$defs refs, found: ${JSON.stringify(nonLocal)}`
      );
      const cycles = findSchemaRefCycles(tool.inputSchema);
      assert.deepEqual(
        cycles,
        [],
        `tool ${tool.name} inputSchema must have zero $ref cycles, found: ${JSON.stringify(cycles)}`
      );
      // Every exported inputSchema must compile standalone without external schemas.
      assert.doesNotThrow(
        () => compileStandalone(tool.inputSchema),
        `tool ${tool.name} inputSchema failed standalone Ajv 2020-12 compilation`
      );
    }

    // Also verify the actual JSON-RPC tools/list wire output of runMcpStdio.
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let buffered = "";
    stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
    });
    const done = runMcpStdio({ root, stdin, stdout, stderr });
    stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
    stdin.end();
    await done;

    const responses = buffered
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const listResponse = responses.find((msg) => msg.id === 1);
    assert.ok(listResponse?.result?.tools?.length >= inProcessTools.length);

    for (const tool of listResponse.result.tools) {
      const nonLocal = findNonLocalSchemaRefs(tool.inputSchema);
      assert.deepEqual(
        nonLocal,
        [],
        `stdio tools/list tool ${tool.name} has non-local $ref: ${JSON.stringify(nonLocal)}`
      );
      const cycles = findSchemaRefCycles(tool.inputSchema);
      assert.deepEqual(
        cycles,
        [],
        `stdio tools/list tool ${tool.name} has $ref cycle: ${JSON.stringify(cycles)}`
      );
      assert.doesNotThrow(
        () => compileStandalone(tool.inputSchema),
        `stdio tools/list tool ${tool.name} failed standalone Ajv 2020-12 compilation`
      );
    }

    // get_schema must also return self-contained cycle-free standalone schemas.
    for (const component of Object.keys(uiRender.assets.schemas)) {
      const res = uiRender.tools.callTool("get_schema", { component });
      assert.ok(res && !res.isError);
      const nonLocal = findNonLocalSchemaRefs(res.structuredContent.schema);
      assert.deepEqual(nonLocal, [], `get_schema(${component}) has non-local $ref`);
      const cycles = findSchemaRefCycles(res.structuredContent.schema);
      assert.deepEqual(cycles, [], `get_schema(${component}) has $ref cycle`);
      assert.doesNotThrow(() => compileStandalone(res.structuredContent.schema));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic equivalence: raw vendored schemas vs inlined exported schemas produce identical validation results", () => {
  const uiRender = createUiRenderModule();
  const byName = new Map(uiRender.tools.listTools().map((tool) => [tool.name, tool]));

  for (const component of Object.keys(uiRender.assets.schemas)) {
    const rawSchema = uiRender.assets.schemas[component];
    const exportedTool = byName.get(`render_${component}`);
    assert.ok(exportedTool, `render_${component} is exported`);

    // Sanity check: the raw vendored schema DOES contain the remote A2UI $ref
    // and fails standalone compilation (proving this test catches the real bug).
    assert.ok(
      findNonLocalSchemaRefs(rawSchema).length > 0,
      `raw ${component} schema should carry the external A2UI $ref`
    );
    assert.throws(() => compileStandalone(rawSchema));

    // The exported schema has zero non-local $refs, zero cycles, no dead DynamicValue, and compiles standalone.
    assert.deepEqual(findNonLocalSchemaRefs(exportedTool.inputSchema), []);
    assert.deepEqual(findSchemaRefCycles(exportedTool.inputSchema), []);
    assert.equal(
      exportedTool.inputSchema.$defs?.DynamicValue,
      undefined,
      `render_${component} must purge unreachable DynamicValue from $defs`
    );

    const validateBefore = compileWithExternal(rawSchema);
    const validateAfter = compileStandalone(exportedTool.inputSchema);

    // Closed Ajv equivalence contract (L4 §3.1): on all component fixtures without
    // FunctionCall.args, strict (instancePath, keyword) error shape equality holds.
    for (const fixture of buildComponentFixtures(uiRender.assets, component)) {
      const validBefore = Boolean(validateBefore(fixture.value));
      const validAfter = Boolean(validateAfter(fixture.value));
      assert.equal(validBefore, fixture.expectedValid, `before: ${fixture.name}`);
      assert.equal(validAfter, validBefore, `before/after mismatch for ${fixture.name}`);
      if (!validBefore) {
        const beforeErrors = (validateBefore.errors ?? []).map((e) => `${e.instancePath}:${e.keyword}`).sort();
        const afterErrors = (validateAfter.errors ?? []).map((e) => `${e.instancePath}:${e.keyword}`).sort();
        assert.deepEqual(afterErrors, beforeErrors, `error shape mismatch for ${fixture.name}`);
      }
    }
  }
});

test("semantic equivalence: ComponentCommon transitive closure (DataBinding, FunctionCall/DynamicValue recursion, empty anyFunction)", () => {
  const rawSchema = {
    $id: "https://example.test/component-common-probe.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    allOf: [
      { $ref: "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/ComponentCommon" }
    ],
    unevaluatedProperties: false
  };

  const inlined = inlineExternalSchemaRefs(rawSchema);
  assert.deepEqual(findNonLocalSchemaRefs(inlined), []);
  assert.deepEqual(findSchemaRefCycles(inlined), []);
  assert.equal(inlined.$defs?.DynamicValue, undefined, "unreachable DynamicValue purged");
  assert.deepEqual(inlined.$defs?.FunctionCall?.properties?.args, { type: "object" });

  const validateBefore = compileWithExternal(rawSchema);
  const validateAfter = compileStandalone(inlined);

  // Closed Ajv equivalence contract (L4 §3.1): nested cases under FunctionCall.args
  // guarantee strict boolean equivalence (both false) because FunctionCall is always
  // unsatisfiable via anyFunction: { not: {} }.
  const cases = [
    { label: "id only", value: { id: "c1" }, expected: true },
    { label: "literal accessibility strings", value: { id: "c1", accessibility: { label: "L", description: "D" } }, expected: true },
    { label: "DataBinding accessibility label", value: { id: "c1", accessibility: { label: { path: "/title" } } }, expected: true },
    { label: "DataBinding with extra prop rejected", value: { id: "c1", accessibility: { label: { path: "/title", extra: 1 } } }, expected: false },
    { label: "FunctionCall rejected by empty anyFunction", value: { id: "c1", accessibility: { label: { call: "upper", returnType: "string" } } }, expected: false },
    {
      label: "nested recursive FunctionCall in args rejected",
      value: {
        id: "c1",
        accessibility: {
          label: { call: "outer", returnType: "string", args: { x: { call: "inner" } } }
        }
      },
      expected: false
    },
    {
      label: "nested invalid DataBinding inside FunctionCall.args rejected (boolean equivalence)",
      value: {
        id: "c1",
        accessibility: {
          label: { call: "outer", returnType: "string", args: { x: { path: "/bad", extra: 1 } } }
        }
      },
      expected: false
    },
    { label: "missing id rejected", value: { accessibility: { label: "L" } }, expected: false },
    { label: "non-string id rejected", value: { id: 123 }, expected: false },
    { label: "unevaluated extra property rejected", value: { id: "c1", stray: true }, expected: false }
  ];

  for (const item of cases) {
    const before = Boolean(validateBefore(item.value));
    const after = Boolean(validateAfter(item.value));
    assert.equal(before, item.expected, `before: ${item.label}`);
    assert.equal(after, before, `before/after mismatch: ${item.label}`);
  }
});

test("inlineExternalSchemaRefs: collision-free $defs allocation, immutability, unregistered ref refusal, and property named $ref", () => {
  const schemaWithCollision = {
    $id: "https://example.test/collision.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
      ComponentCommon: { type: "object", properties: { custom: { type: "number" } } }
    },
    allOf: [
      { $ref: "#/$defs/ComponentCommon" },
      { $ref: "https://a2ui.org/specification/v0_9_1/common_types.json#/$defs/ComponentCommon" }
    ]
  };
  const snapshotBefore = JSON.stringify(schemaWithCollision);
  const inlined = inlineExternalSchemaRefs(schemaWithCollision);
  assert.equal(JSON.stringify(schemaWithCollision), snapshotBefore, "input schema is never mutated");
  assert.deepEqual(findNonLocalSchemaRefs(inlined), []);
  assert.deepEqual(inlined.$defs.ComponentCommon, schemaWithCollision.$defs.ComponentCommon);
  assert.ok(inlined.$defs.ComponentCommon__1, "colliding external def gets a deterministic disambiguated name");
  assert.equal(inlined.allOf[0].$ref, "#/$defs/ComponentCommon");
  assert.equal(inlined.allOf[1].$ref, "#/$defs/ComponentCommon__1");
  const validate = compileStandalone(inlined);
  assert.equal(validate({ id: "root", custom: 1 }), true);
  assert.equal(validate({ custom: 1 }), false);
  assert.equal(validate({ id: "root", custom: "bad" }), false);

  // Unregistered external schema throws fast rather than leaking a remote $ref.
  assert.throws(
    () =>
      inlineExternalSchemaRefs({
        type: "object",
        properties: { x: { $ref: "https://unregistered.example/other.json#/$defs/Foo" } }
      }),
    /is not registered/
  );

  // Property literally named "$ref" and data literals must not be flagged by findNonLocalSchemaRefs.
  const literalSchema = {
    type: "object",
    properties: {
      $ref: { type: "string" },
      url: { const: "https://example.com/not-a-ref" }
    },
    default: { $ref: "https://example.com/default-value" },
    "x-sentropic": { example: { $ref: "https://example.com/example" } }
  };
  assert.deepEqual(findNonLocalSchemaRefs(literalSchema), []);

  // Relative non-fragment $ref IS flagged.
  assert.deepEqual(
    findNonLocalSchemaRefs({ oneOf: [{ $ref: "catalog.json#/$defs/anyFunction" }] }),
    [{ path: "/oneOf/0", ref: "catalog.json#/$defs/anyFunction" }]
  );
});

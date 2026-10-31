import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  A2UI_CATALOG_RESOURCE_URI,
  UI_RENDER_REGISTRY_ENTRY,
  UI_RENDER_RESOURCE_URI,
  UI_RENDER_TOOL_NAMES,
  uiRenderManifestAssetJson,
  uiRenderProviderManifest
} from "../dist/index.js";

/**
 * json-render L3.4 — the cluster-mesh RegistryEntry descriptor for
 * sentropic.ui-render (h2a spec §8.3.2) behind the seam: the registry
 * path (PR #354, @sentropic/cluster-mesh/mcp/registry) is not on main,
 * so the normative entry and provider manifest are exported from the
 * ui-render module, ready to be wired into packages/h2a/registry/
 * entries.v1.json and sentropic-daemon.ts when that branch lands.
 */

const VENDOR = new URL("../vendor/design-system-elements/", import.meta.url);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const FIVE_RESOURCE_URIS = [
  "ui://sentropic/render/v1",
  "a2ui://sentropic/catalog/v1",
  "ui://sentropic/BarChart/v1",
  "ui://sentropic/BpmnCanvas/v1",
  "ui://sentropic/DecisionDossier/v1"
];

const DEFAULT_PROFILE_TOOLS = ["list_components", "get_schema", "render", "submit_intent"];

test("registry entry: the sentropic.ui-render descriptor matches the normative §8.3.2 shape", () => {
  assert.equal(UI_RENDER_REGISTRY_ENTRY.format, "sentropic.registry-entry/v1");
  assert.equal(UI_RENDER_REGISTRY_ENTRY.contractVersion, "1.1.4");
  assert.equal(UI_RENDER_REGISTRY_ENTRY.kind, "mcp");
  assert.equal(UI_RENDER_REGISTRY_ENTRY.id, "sentropic.ui-render");
  assert.equal(UI_RENDER_REGISTRY_ENTRY.name, "ui-render");
  assert.equal(
    UI_RENDER_REGISTRY_ENTRY.description,
    "Design-system JSON_RENDER MCP module (ui://sentropic/render/v1): component catalogue, " +
      "standalone JSON schemas, 9-step envelope validation, and sandboxed SEP-1865 MCP App rendering."
  );
  assert.equal(UI_RENDER_REGISTRY_ENTRY.entryVersion, "1.0.0");
  assert.deepEqual(UI_RENDER_REGISTRY_ENTRY.publisher, {
    packageName: "@sentropic/h2a",
    packageVersion: "0.98.7"
  });
  assert.deepEqual(UI_RENDER_REGISTRY_ENTRY.compatibility, {
    entryContract: "1.1.4",
    packages: [{ name: "@sentropic/focus", range: "0.5.0" }],
    schemaProfiles: ["sentropic.parameters/2020-12-bounded-v1"],
    requiredHostFeatures: ["stdio"],
    optionalHostFeatures: ["streamable-http", "mcp-app-ui"]
  });
  assert.deepEqual(UI_RENDER_REGISTRY_ENTRY.bindings, []);
});

test("registry entry: the parameters schema is the bounded mode enum with pilot-inline default", () => {
  const parameters = UI_RENDER_REGISTRY_ENTRY.parameters;
  assert.equal(parameters.schemaVersion, "1.0.0");
  assert.equal(parameters.schema.$id, "urn:sentropic:registry:parameters:sentropic.ui-render:1.0.0");
  assert.deepEqual(parameters.schema.required, ["mode"]);
  assert.equal(parameters.schema.additionalProperties, false);
  assert.deepEqual(parameters.schema.properties.mode.enum, [
    "pilot-inline",
    "pilot-per-component",
    "cdn-sri"
  ]);
  assert.deepEqual(parameters.defaults, { mode: "pilot-inline" });
});

test("registry entry: the pinned asset digests match the vendored build on disk", () => {
  const assets = UI_RENDER_REGISTRY_ENTRY.assets;
  assert.equal(assets.length, 3);
  assert.deepEqual(
    assets.map((asset) => asset.role),
    ["manifest", "catalog-schema", "envelope-schema"]
  );
  const catalogDigest = sha256(readFileSync(new URL("catalog.json", VENDOR)));
  const envelopeDigest = sha256(readFileSync(new URL("envelope.json", VENDOR)));
  assert.deepEqual(assets[1], {
    role: "catalog-schema",
    path: "vendor/design-system-elements/catalog.json",
    mediaType: "application/schema+json",
    sha256: catalogDigest
  });
  assert.deepEqual(assets[2], {
    role: "envelope-schema",
    path: "vendor/design-system-elements/envelope.json",
    mediaType: "application/schema+json",
    sha256: envelopeDigest
  });
  assert.equal(catalogDigest, "f2358a8f96cdf28949d1b17f7c29c287201efb53c6b8ba709b4a27165206a36c");
  assert.equal(envelopeDigest, "6bf3351ba45c90a0dd3b40a7e7eddf019e72379a4551acc07a89f4436fc6cf2e");
});

test("registry entry: the manifest asset digest is the sha256 of the canonical manifest JSON", () => {
  const manifestAsset = UI_RENDER_REGISTRY_ENTRY.assets[0];
  assert.deepEqual(
    { role: manifestAsset.role, path: manifestAsset.path, mediaType: manifestAsset.mediaType },
    { role: "manifest", path: "registry/manifest.ui-render.json", mediaType: "application/json" }
  );
  assert.equal(manifestAsset.sha256, sha256(uiRenderManifestAssetJson("pilot-inline")));
  assert.match(manifestAsset.sha256, /^[0-9a-f]{64}$/);
});

test("registry entry: mcp block pins connector, transports and the two read-only capability profiles", () => {
  const mcp = UI_RENDER_REGISTRY_ENTRY.mcp;
  assert.equal(mcp.manifestAsset, "registry/manifest.ui-render.json");
  assert.deepEqual(mcp.connectorIds, ["h2a-ui-render"]);
  assert.deepEqual(mcp.protocolVersions, ["2025-06-18"]);
  assert.deepEqual(
    mcp.transportProfiles.map((profile) => [profile.id, profile.mode, profile.requiredHostFeatures]),
    [
      ["shared-central-stdio", "in-process", ["stdio"]],
      ["hosted-read-only-http", "streamable-http", ["streamable-http"]]
    ]
  );
  assert.deepEqual(
    mcp.capabilityProfiles.map((profile) => profile.id),
    ["default", "per-component-fallback"]
  );
  for (const profile of mcp.capabilityProfiles) {
    assert.equal(profile.readOnly, true, `${profile.id} must be read-only`);
    assert.deepEqual(profile.prompts, []);
    assert.deepEqual(profile.resources, FIVE_RESOURCE_URIS);
  }
  assert.deepEqual(mcp.capabilityProfiles[0].tools, DEFAULT_PROFILE_TOOLS);
  assert.deepEqual(mcp.capabilityProfiles[1].tools, [...UI_RENDER_TOOL_NAMES].sort());
});

test("registry entry: the SEP-1865 ui extension is declared and nothing is required", () => {
  assert.deepEqual(UI_RENDER_REGISTRY_ENTRY.extensions, {
    "io.modelcontextprotocol/ui": {
      resourceUri: "ui://sentropic/render/v1",
      mimeTypes: ["text/html;profile=mcp-app"]
    }
  });
  assert.deepEqual(UI_RENDER_REGISTRY_ENTRY.requiredExtensions, []);
});

test("provider manifest: read-only resources and tools per mode", () => {
  for (const mode of ["pilot-inline", "pilot-per-component", "cdn-sri"]) {
    const manifest = uiRenderProviderManifest(mode);
    assert.equal(manifest.providerId, "sentropic.ui-render");
    assert.equal(manifest.appId, "@sentropic/h2a");
    assert.deepEqual(manifest.connectorIds, ["h2a-ui-render"]);
    assert.deepEqual(
      manifest.resources.map((resource) => resource.uri),
      FIVE_RESOURCE_URIS
    );
    for (const resource of manifest.resources) {
      assert.equal(resource.mutability, "read-only", `${mode}: ${resource.uri}`);
      assert.equal(resource.mutatesExternalSystem, false);
      assert.deepEqual(resource.idempotency, { required: false });
    }
    for (const tool of manifest.tools) {
      assert.equal(tool.readOnly, true, `${mode}: ${tool.name}`);
    }
    const toolNames = manifest.tools.map((tool) => tool.name);
    if (mode === "pilot-per-component") {
      assert.deepEqual(toolNames, [...UI_RENDER_TOOL_NAMES].sort());
    } else {
      assert.deepEqual(toolNames, DEFAULT_PROFILE_TOOLS);
    }
  }
});

test("provider manifest: the shell resource carries the pilot CSP and the catalogue pins the catalog id", () => {
  const manifest = uiRenderProviderManifest("pilot-inline");
  const render = manifest.resources.find((resource) => resource.uri === UI_RENDER_RESOURCE_URI);
  assert.deepEqual(render._meta, {
    ui: { csp: { resourceDomains: ["https://cdn.jsdelivr.net"], connectDomains: [] } }
  });
  const catalog = manifest.resources.find((resource) => resource.uri === A2UI_CATALOG_RESOURCE_URI);
  assert.equal(
    catalog.name,
    "Sentropic Design-System Elements Catalogue (v1)"
  );
});

test("provider manifest: canonical asset JSON is stable and ends with a newline", () => {
  const json = uiRenderManifestAssetJson("pilot-inline");
  assert.equal(json, JSON.stringify(uiRenderProviderManifest("pilot-inline"), null, 2) + "\n");
  assert.equal(json, uiRenderManifestAssetJson("pilot-inline"));
  assert.ok(json.endsWith("}\n"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.providerId, "sentropic.ui-render");
});

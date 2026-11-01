import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  A2UI_CATALOG_RESOURCE_URI,
  createUiRenderResources,
  loadUiRenderAssets,
  UI_RENDER_RESOURCE_URI,
  utf8ByteLength
} from "../dist/index.js";
import { buildShellHtml } from "../dist/runtime/mcp/ui-render/resources.js";
import { buildResourceHostConfig, serializeHostConfigScript } from "../dist/runtime/mcp/ui-render/watermark.js";
import { gzipOfflineResource, OFFLINE_GZIP } from "../../../scripts/ui-render-offline-gzip.mjs";

/**
 * json-render CDN-3 — AC-L3 measurement (h2a spec §10.2 & §6.6/DS §8.3):
 * the default (`auto` → `cdn-sri`) resources are measured against the DS
 * `<= 2 MiB` raw budget and the h2a `<= 960 KiB` raw (`1 MiB` JSON-RPC
 * frame) ceiling, the gzip budgets (`<= 150 kB`, DS §6.6) are recorded,
 * and the BarChart/DecisionDossier zero-external-request property is
 * verified statically (no network-triggering element, no network call
 * site; the only fetchable jsDelivr URL is the `#st-host-config`
 * assetBase data island). The retained offline bundles are verified
 * under `H2A_UI_RENDER_OFFLINE=1`. The Playwright sandbox run and the
 * reference-host captures (U-1/U-5/U-12/U-13/U-16/U-20) need real
 * hosts and stay OPEN; the committed measurement record is
 * `fixtures/ui-render-ac-l3/offline-measurement.v1.json`.
 */

const VENDOR = new URL("../vendor/design-system-elements/", import.meta.url);
const MEASUREMENT = new URL("../fixtures/ui-render-ac-l3/offline-measurement.v1.json", import.meta.url);

const DS_RAW_BUDGET = 2_097_152; // DS §8.3/§8.4: <= 2 MiB raw
const H2A_RAW_BUDGET = 960 * 1024; // h2a: <= 960 KiB raw
const FRAME_BUDGET = 1_048_576; // MCP_MAX_FRAME_BYTES
const CORE_GZIP_BUDGET = 150 * 1024; // DS §6.6: core + BarChart <= 150 kB gzip
const sha256 = text => createHash("sha256").update(text).digest("hex");

const RESOURCE_URIS = [
  UI_RENDER_RESOURCE_URI,
  A2UI_CATALOG_RESOURCE_URI,
  "ui://sentropic/BarChart/v1",
  "ui://sentropic/BpmnCanvas/v1",
  "ui://sentropic/DecisionDossier/v1"
];

let resources;
let sizes;
test.before(async () => {
  const assets = await loadUiRenderAssets();
  resources = createUiRenderResources({ assets, env: {} });
  sizes = new Map(
    RESOURCE_URIS.map((uri) => {
      const text = resources.readResource(uri).contents[0].text;
      const component = uri.split("/")[3];
      const candidate = uri.startsWith("ui://") ? buildShellHtml(assets,
        serializeHostConfigScript(buildResourceHostConfig({})), component === "render" ? undefined : component) : text;
      const gzip = gzipOfflineResource(text);
      const completeGzip = gzipOfflineResource(candidate);
      assert.equal(gunzipSync(gzip).toString("utf8"), text);
      assert.equal(gunzipSync(completeGzip).toString("utf8"), candidate);
      return [uri, { raw: utf8ByteLength(text), gzip: gzip.length,
        completeRaw: Buffer.byteLength(candidate), completeGzip: completeGzip.length,
        rawSha256: sha256(text), completeSha256: sha256(candidate) }];
    })
  );
});

test("measurement: every pilot resource fits the DS 2 MiB and h2a 960 KiB raw ceilings", () => {
  assert.equal(sizes.size, 5);
  for (const [uri, { raw }] of sizes) {
    assert.ok(raw > 0, `${uri} is empty`);
    assert.ok(raw <= DS_RAW_BUDGET, `${uri} exceeds the DS 2 MiB raw budget: ${raw}`);
    assert.ok(raw <= H2A_RAW_BUDGET, `${uri} exceeds the h2a 960 KiB raw ceiling: ${raw}`);
  }
});

test("measurement: every resources/read JSON-RPC response fits the 1 MiB frame ceiling", () => {
  for (const [uri] of sizes) {
    const encoded = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 1, result: resources.readResource(uri) }));
    assert.ok(encoded <= FRAME_BUDGET, `${uri} framed response exceeds MCP_MAX_FRAME_BYTES: ${encoded}`);
  }
});

test("measurement: the core+BarChart shell gzip fits the DS 150 kB budget", () => {
  const { gzip } = sizes.get("ui://sentropic/BarChart/v1");
  assert.ok(gzip <= CORE_GZIP_BUDGET, `core+BarChart gzip exceeds 150 kB: ${gzip}`);
  const nativeGzip = gzipSync(resources.readResource("ui://sentropic/BarChart/v1").contents[0].text).length;
  assert.ok(nativeGzip <= CORE_GZIP_BUDGET, `native core+BarChart gzip exceeds 150 kB: ${nativeGzip}`);
});

test("zero-external: the core/BarChart shell loads no external resource", () => {
  const html = resources.readResource("ui://sentropic/BarChart/v1").contents[0].text;
  assert.equal((html.match(/<script[^>]*\bsrc=/gi) || []).length, 0, "external script src");
  assert.equal((html.match(/<(link|img|iframe|source|video|audio|track|embed|object)\b/gi) || []).length, 0, "network-triggering element");
  assert.equal((html.match(/\bsrcset=/gi) || []).length, 0, "srcset attribute");
  for (const callSite of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) {
    assert.equal((html.match(new RegExp(callSite.replace("(", "\\("), "g")) || []).length, 0, `network call site ${callSite}`);
  }
});

test("zero-external: the only jsDelivr URL is the #st-host-config assetBase data island", () => {
  const html = resources.readResource("ui://sentropic/BarChart/v1").contents[0].text;
  const island = html.match(
    /<script type="application\/json" id="st-host-config">([\s\S]*?)<\/script>/
  );
  assert.ok(island, "no #st-host-config island");
  const config = JSON.parse(island[1]);
  assert.equal(typeof config.assetBase, "string");
  assert.ok(config.assetBase.startsWith("https://cdn.jsdelivr.net/"));
  const withoutIsland = html.replace(island[0], "");
  // The offline fallback diagnostic prose names the CDN domain (§5.2); only
  // fetchable https:// URLs count as external requests.
  assert.equal((withoutIsland.match(/https:\/\/cdn\.jsdelivr\.net/g) || []).length, 0, "jsDelivr URL outside the host-config island");
});

test("record: the committed offline measurement matches the vendored build and passes the ceilings", () => {
  const record = JSON.parse(readFileSync(fileURLToPath(MEASUREMENT), "utf8"));
  const catalogDigest = createHash("sha256")
    .update(readFileSync(new URL("catalog.json", VENDOR)))
    .digest("hex");
  const sriDigest = createHash("sha256")
    .update(readFileSync(new URL("dist/browser/sri.json", VENDOR)))
    .digest("hex");
  assert.equal(record.vendored.catalogSha256, catalogDigest);
  assert.equal(record.vendored.sriSha256, sriDigest);
  assert.equal(record.vendored.catalogSha256, "f2358a8f96cdf28949d1b17f7c29c287201efb53c6b8ba709b4a27165206a36c");
  assert.equal(record.vendored.sriSha256, "0979a58b9c10fc9d02189ac20d43f070a645e897e5966b5b4ddfcf93b2bc9193");
  assert.equal(record.vendored.packageVersion, "0.1.0");
  assert.equal(record.budgets.dsRaw, DS_RAW_BUDGET);
  assert.equal(record.budgets.h2aRaw, H2A_RAW_BUDGET);
  assert.equal(record.budgets.frame, FRAME_BUDGET);
  assert.equal(record.budgets.coreGzip, CORE_GZIP_BUDGET);
  assert.deepEqual(record.compression, OFFLINE_GZIP);
  for (const measured of record.resources) {
    const live = sizes.get(measured.uri);
    assert.ok(live, `${measured.uri} not served`);
    assert.ok(measured.rawBytes <= record.budgets.dsRaw, `${measured.uri} recorded above the DS budget`);
    assert.ok(measured.rawBytes <= record.budgets.h2aRaw, `${measured.uri} recorded above the h2a ceiling`);
    assert.equal(measured.rawBytes, live.raw, `${measured.uri}: stale raw size`);
    assert.equal(measured.gzipBytes, live.gzip, `${measured.uri}: stale gzip size`);
    assert.equal(measured.completeRawBytes, live.completeRaw);
    assert.equal(measured.completeGzipBytes, live.completeGzip);
    assert.equal(measured.rawSha256, live.rawSha256, `${measured.uri}: stale served content`);
    assert.equal(measured.completeSha256, live.completeSha256, `${measured.uri}: stale complete content`);
    const served = resources.readResource(measured.uri).contents[0].text;
    assert.equal(measured.degraded, served.includes('data-st-resource-degraded="true"'), `${measured.uri}: stale degraded flag`);
    if (measured.degraded) assert.match(served, /data-st-resource-degraded="true"/);
  }
  const combined = record.resources.find((r) => r.uri === UI_RENDER_RESOURCE_URI);
  assert.equal(combined.role, "combined-cdn-shell");
  assert.equal(combined.degraded, false);
  assert.equal(record.zeroExternalRequests.scriptSrc, 0);
  assert.equal(record.zeroExternalRequests.networkElements, 0);
  assert.equal(record.zeroExternalRequests.networkCallSites, 0);
  assert.equal(record.zeroExternalRequests.jsdelivrOnlyInHostConfig, true);
  assert.ok(Array.isArray(record.open) && record.open.length > 0, "the offline record must name the open real-host items");
});

test("offline-retained: H2A_UI_RENDER_OFFLINE=1 keeps the complete inline bundles without jsDelivr", async () => {
  const offline = createUiRenderResources({ assets: await loadUiRenderAssets(), env: { H2A_UI_RENDER_OFFLINE: "1" } });
  for (const uri of ["ui://sentropic/BarChart/v1", "ui://sentropic/DecisionDossier/v1"]) {
    const text = offline.readResource(uri).contents[0].text;
    assert.equal(text.includes('data-st-resource-degraded="true"'), false, `${uri} renders offline`);
  }
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1"]) {
    const text = offline.readResource(uri).contents[0].text;
    assert.match(text, /data-st-resource-degraded="true"/, `${uri} degrades at the default ceiling`);
  }
  const raised = createUiRenderResources({
    assets: await loadUiRenderAssets(),
    env: { H2A_UI_RENDER_OFFLINE: "1" },
    inlineMaxBytes: 2_097_152
  });
  for (const uri of [UI_RENDER_RESOURCE_URI, "ui://sentropic/BpmnCanvas/v1"]) {
    const text = raised.readResource(uri).contents[0].text;
    assert.equal(text.includes('data-st-resource-degraded="true"'), false, `${uri} serves complete offline`);
    assert.ok(Buffer.byteLength(text) > H2A_RAW_BUDGET, `${uri} is the complete bundle`);
    assert.ok(Buffer.byteLength(text) <= DS_RAW_BUDGET, `${uri} fits the DS 2 MiB budget`);
  }
});

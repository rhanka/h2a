import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  A2UI_CATALOG_RESOURCE_URI,
  createUiRenderResources,
  loadUiRenderAssets,
  UI_RENDER_RESOURCE_URI,
  utf8ByteLength
} from "../dist/index.js";

/**
 * json-render L3.5 (offline part) — AC-L3 measurement (h2a spec §10.2
 * & §6.6/DS §8.3): the pilot resources are measured against the DS
 * `<= 2 MiB` raw budget and the h2a `<= 960 KiB` raw (`1 MiB`
 * JSON-RPC frame) ceiling, the core+BarChart gzip budget (`<= 150 kB`,
 * DS §6.6) is recorded, and the core/BarChart zero-external-request
 * property is verified statically (no network-triggering element, no
 * network call site; the only jsDelivr URL is the `#st-host-config`
 * assetBase data island). The Playwright sandbox run and the
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
  resources = createUiRenderResources({ assets });
  sizes = new Map(
    RESOURCE_URIS.map((uri) => {
      const text = resources.readResource(uri).contents[0].text;
      return [uri, { raw: utf8ByteLength(text), gzip: gzipSync(Buffer.from(text, "utf8")).length }];
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
  for (const [uri, { raw }] of sizes) {
    const encoded = raw + 512; // JSON-RPC envelope overhead around the text contents
    assert.ok(encoded <= FRAME_BUDGET, `${uri} framed response exceeds MCP_MAX_FRAME_BYTES: ${encoded}`);
  }
});

test("measurement: the core+BarChart shell gzip fits the DS 150 kB budget", () => {
  const { gzip } = sizes.get(UI_RENDER_RESOURCE_URI);
  assert.ok(gzip <= CORE_GZIP_BUDGET, `core+BarChart gzip exceeds 150 kB: ${gzip}`);
});

test("zero-external: the core/BarChart shell loads no external resource", () => {
  const html = resources.readResource(UI_RENDER_RESOURCE_URI).contents[0].text;
  assert.equal((html.match(/<script[^>]*\bsrc=/gi) || []).length, 0, "external script src");
  assert.equal((html.match(/<(link|img|iframe|source|video|audio|track|embed|object)\b/gi) || []).length, 0, "network-triggering element");
  assert.equal((html.match(/\bsrcset=/gi) || []).length, 0, "srcset attribute");
  for (const callSite of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) {
    assert.equal((html.match(new RegExp(callSite.replace("(", "\\("), "g")) || []).length, 0, `network call site ${callSite}`);
  }
});

test("zero-external: the only jsDelivr URL is the #st-host-config assetBase data island", () => {
  const html = resources.readResource(UI_RENDER_RESOURCE_URI).contents[0].text;
  const island = html.match(
    /<script type="application\/json" id="st-host-config">([\s\S]*?)<\/script>/
  );
  assert.ok(island, "no #st-host-config island");
  const config = JSON.parse(island[1]);
  assert.equal(typeof config.assetBase, "string");
  assert.ok(config.assetBase.startsWith("https://cdn.jsdelivr.net/"));
  const withoutIsland = html.replace(island[0], "");
  assert.equal((withoutIsland.match(/cdn\.jsdelivr\.net/g) || []).length, 0, "jsDelivr URL outside the host-config island");
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
  assert.equal(record.vendored.sriSha256, "03e5a2fb85181d3ea6fe427c4edd253975974b15a546c6f5d6b271893c694c4b");
  assert.equal(record.budgets.dsRaw, DS_RAW_BUDGET);
  assert.equal(record.budgets.h2aRaw, H2A_RAW_BUDGET);
  assert.equal(record.budgets.frame, FRAME_BUDGET);
  assert.equal(record.budgets.coreGzip, CORE_GZIP_BUDGET);
  for (const measured of record.resources) {
    const live = sizes.get(measured.uri);
    assert.ok(live, `${measured.uri} not served`);
    assert.ok(measured.rawBytes <= record.budgets.dsRaw, `${measured.uri} recorded above the DS budget`);
    assert.ok(measured.rawBytes <= record.budgets.h2aRaw, `${measured.uri} recorded above the h2a ceiling`);
    assert.ok(measured.gzipBytes <= record.budgets.coreGzip, `${measured.uri} gzip recorded above the DS core budget`);
  }
  const combined = record.resources.find((r) => r.uri === UI_RENDER_RESOURCE_URI);
  assert.equal(combined.role, "combined-pilot-shell");
  assert.equal(record.zeroExternalRequests.scriptSrc, 0);
  assert.equal(record.zeroExternalRequests.networkElements, 0);
  assert.equal(record.zeroExternalRequests.networkCallSites, 0);
  assert.equal(record.zeroExternalRequests.jsdelivrOnlyInHostConfig, true);
  assert.ok(Array.isArray(record.open) && record.open.length > 0, "the offline record must name the open real-host items");
});

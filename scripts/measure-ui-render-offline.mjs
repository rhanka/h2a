import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipOfflineResource, OFFLINE_GZIP } from "./ui-render-offline-gzip.mjs";
import { createUiRenderResources, loadUiRenderAssetsSync } from "../packages/h2a/dist/index.js";
import { buildShellHtml } from "../packages/h2a/dist/runtime/mcp/ui-render/resources.js";
import { buildResourceHostConfig, serializeHostConfigScript } from "../packages/h2a/dist/runtime/mcp/ui-render/watermark.js";

const file = new URL("../packages/h2a/fixtures/ui-render-ac-l3/offline-measurement.v1.json", import.meta.url);
const previous = readFileSync(file, "utf8");
const record = JSON.parse(previous);
const sha256 = text => createHash("sha256").update(text).digest("hex");
record.compression = OFFLINE_GZIP;
const assets = loadUiRenderAssetsSync();
const resources = createUiRenderResources({ assets, env: {} });
for (const entry of record.resources) {
  const text = resources.readResource(entry.uri).contents[0].text;
  const component = entry.uri.split("/")[3];
  const complete = entry.uri.startsWith("ui://") ? buildShellHtml(assets,
    serializeHostConfigScript(buildResourceHostConfig({})), component === "render" ? undefined : component) : text;
  Object.assign(entry, {
    rawBytes: Buffer.byteLength(text), gzipBytes: gzipOfflineResource(text).length,
    completeRawBytes: Buffer.byteLength(complete), completeGzipBytes: gzipOfflineResource(complete).length,
    rawSha256: sha256(text), completeSha256: sha256(complete),
    degraded: Buffer.byteLength(complete) > record.budgets.h2aRaw
  });
  console.log(`${entry.uri}: served ${entry.rawBytes}, complete ${entry.completeRawBytes}, complete gzip ${entry.completeGzipBytes}, degraded ${entry.degraded}`);
}
record.coreBarChartGzip = record.resources.find(entry => entry.uri.includes("/BarChart/")).gzipBytes;
record.zeroExternalRequests.dynamicImportSites = 0;
record.zeroExternalRequests.dynamicImportNote = "Each complete entry bundles its transitive static and dynamic imports, including both theme chunks; modulePreload is disabled. Sandboxed DOM-free linking covers all four complete entries. Combined and BPMN resources explicitly degrade above 960 KiB; no chunk is truncated.";
record.inlineThreshold.decision = "Envelope echo threshold unchanged; resources/read independently enforces 960 KiB on complete HTML. Combined resource directs to per-component tools; BPMN also exceeds the cap and explicitly requires non-UI text fallback. Host caps remain U-1.";
const serialized = JSON.stringify(record, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (serialized !== previous) throw new Error("stale offline measurement: run node scripts/measure-ui-render-offline.mjs");
} else writeFileSync(file, serialized);

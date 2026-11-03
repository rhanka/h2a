#!/usr/bin/env node
/**
 * R5 publisher envelopes: emits the package-owned `registry/entries.v1.json`
 * wrappers plus their manifest assets for `@sentropic/h2a` (coordination
 * only: `sentropic.h2a`) and `@sentropic/track` (`sentropic.track`).
 *
 * Source of truth for tool bytes: the built runtime descriptors
 * (H2A_CLI_MCP_TOOL_DESCRIPTORS minus the composed Track surface, and the
 * Track package's own READ_TOOLS). Asset sha256 values are computed over the
 * exact emitted bytes. With `--check`, verifies the committed files are
 * byte-identical instead of writing (packaging-gate mode).
 *
 * Normative envelope/parameter shapes: contract registry-entry-contract-v8
 * §§3.2/5.4 (contractVersion 1.1.4, exact §5.4 parameter bodies).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHECK = process.argv.includes("--check");

const pkg = (dir) => JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));

const h2aTools = (await import(join(ROOT, "packages/h2a/dist/runtime/mcp/tools.js"))).H2A_CLI_MCP_TOOL_DESCRIPTORS;
const trackTools = (await import(join(ROOT, "packages/track/dist/mcp/serve.js"))).TRACK_READ_TOOL_DESCRIPTORS;

const coordinationTools = h2aTools.filter((t) => !t.name.startsWith("track_"));
const composedTrackNames = h2aTools.filter((t) => t.name.startsWith("track_")).map((t) => t.name);
if (JSON.stringify(composedTrackNames) !== JSON.stringify(trackTools.map((t) => t.name))) {
  throw new Error("registry entries: composed Track surface drifted from @sentropic/track descriptors");
}

// Hosted coordination-read subset: contract §5.2 target surface (order kept).
const HOSTED_COORDINATION_READS = [
  "h2a_discover_instances",
  "h2a_read_payload",
  "h2a_identity_status",
  "h2a_discover_sessions",
  "h2a_nhi_inventory",
  "h2a_nhi_report",
  "h2a_conflict_posture",
  "h2a_blockage_list"
];
for (const name of HOSTED_COORDINATION_READS) {
  if (!coordinationTools.some((t) => t.name === name)) {
    throw new Error(`registry entries: hosted coordination read is not a base capability: ${name}`);
  }
}

const asManifestTool = (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema });
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const emit = (rel, text) => {
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  if (CHECK) {
    if (readFileSync(full, "utf8") !== text) {
      throw new Error(`registry entries stale: run node scripts/generate-registry-entries.mjs — ${rel}`);
    }
    return { rel, sha256: sha256(text) };
  }
  writeFileSync(full, text);
  return { rel, sha256: sha256(text) };
};

const h2aPkg = pkg("packages/h2a");
const trackPkg = pkg("packages/track");

const h2aManifest = {
  providerId: "sentropic.h2a",
  version: "1.0.0",
  appId: "@sentropic/h2a",
  tools: coordinationTools.map(asManifestTool),
  resources: [],
  prompts: []
};
const trackManifest = {
  providerId: "sentropic.track",
  version: "1.0.0",
  appId: "@sentropic/track",
  tools: trackTools.map(asManifestTool),
  resources: [],
  prompts: []
};

const h2aManifestText = `${JSON.stringify(h2aManifest, null, 2)}\n`;
const trackManifestText = `${JSON.stringify(trackManifest, null, 2)}\n`;
const h2aManifestOut = emit("packages/h2a/registry/manifest.h2a.json", h2aManifestText);
const trackManifestOut = emit("packages/track/registry/manifest.track.json", trackManifestText);

const h2aEntry = {
  format: "sentropic.registry-entry/v1",
  contractVersion: "1.1.4",
  kind: "mcp",
  id: "sentropic.h2a",
  name: "h2a",
  description: "h2a coordination MCP: instances, negotiations, inbox, drive consent, loops and blockages over the shared central or hosted read-only transports.",
  entryVersion: "1.0.0",
  publisher: { packageName: "@sentropic/h2a", packageVersion: h2aPkg.version },
  compatibility: {
    entryContract: "1.1.4",
    packages: [{ name: "@sentropic/h2a-runtime", range: "0.98.5" }],
    schemaProfiles: ["sentropic.parameters/2020-12-bounded-v1"],
    requiredHostFeatures: ["stdio"],
    optionalHostFeatures: ["streamable-http"]
  },
  parameters: {
    schemaVersion: "1.1.0",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:sentropic:registry:parameters:sentropic.h2a:1.1.0",
      type: "object",
      additionalProperties: false,
      required: ["mode", "serviceBindingRef"],
      properties: {
        mode: { enum: ["shared-central", "hosted-read-only"] },
        serviceBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
      }
    },
    defaults: { mode: "shared-central" }
  },
  bindings: [
    { key: "h2a-local-central", contract: "h2a.central-attachment/v2", required: true },
    { key: "h2a-attachment-workspace", contract: "h2a.workspace/v1", required: true },
    { key: "h2a-hosted-service", contract: "h2a.hosted-service/v1", required: false }
  ],
  assets: [
    { role: "manifest", path: "registry/manifest.h2a.json", mediaType: "application/json", sha256: h2aManifestOut.sha256 }
  ],
  mcp: {
    manifestAsset: "registry/manifest.h2a.json",
    connectorIds: ["h2a-coordination"],
    transportProfiles: [
      { id: "shared-central-stdio", mode: "binding", bindingKey: "h2a-local-central", protocolVersions: ["2025-06-18"], requiredHostFeatures: ["stdio"] },
      { id: "hosted-read-only-http", mode: "streamable-http", protocolVersions: ["2025-06-18"], requiredHostFeatures: ["streamable-http"] }
    ],
    protocolVersions: ["2025-06-18"],
    capabilityProfiles: [
      { id: "shared-central", tools: coordinationTools.map((t) => t.name), resources: [], prompts: [], readOnly: false },
      { id: "hosted-read-only", tools: HOSTED_COORDINATION_READS, resources: [], prompts: [], readOnly: true }
    ]
  }
};

const trackEntry = {
  format: "sentropic.registry-entry/v1",
  contractVersion: "1.1.4",
  kind: "mcp",
  id: "sentropic.track",
  name: "track",
  description: "Track read-only MCP: report, snapshot, query, validation and provenance reads over the per-request authorized repository.",
  entryVersion: "1.0.0",
  publisher: { packageName: "@sentropic/track", packageVersion: trackPkg.version },
  compatibility: {
    entryContract: "1.1.4",
    packages: [],
    schemaProfiles: ["sentropic.parameters/2020-12-bounded-v1"],
    requiredHostFeatures: ["stdio"],
    optionalHostFeatures: ["streamable-http"]
  },
  parameters: {
    schemaVersion: "1.0.0",
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:sentropic:registry:parameters:sentropic.track:1.0.0",
      type: "object",
      additionalProperties: false,
      required: ["access", "repositoryBindingRef"],
      properties: {
        access: { const: "read-only" },
        repositoryBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
      }
    },
    defaults: { access: "read-only" }
  },
  bindings: [
    { key: "h2a-attachment-workspace", contract: "h2a.workspace/v1", required: true }
  ],
  assets: [
    { role: "manifest", path: "registry/manifest.track.json", mediaType: "application/json", sha256: trackManifestOut.sha256 }
  ],
  mcp: {
    manifestAsset: "registry/manifest.track.json",
    connectorIds: ["track-read"],
    transportProfiles: [
      { id: "attachment-stdio", mode: "binding", bindingKey: "h2a-attachment-workspace", protocolVersions: ["2025-06-18"], requiredHostFeatures: ["stdio"] },
      { id: "hosted-read-only-http", mode: "streamable-http", protocolVersions: ["2025-06-18"], requiredHostFeatures: ["streamable-http"] }
    ],
    protocolVersions: ["2025-06-18"],
    capabilityProfiles: [
      { id: "read-only", tools: trackTools.map((t) => t.name), resources: [], prompts: [], readOnly: true }
    ]
  }
};

if (h2aEntry.description.length > 280 || trackEntry.description.length > 280) {
  throw new Error("registry entries: description exceeds the 280-character limit");
}

emit("packages/h2a/registry/entries.v1.json", `${JSON.stringify({ format: "sentropic.registry-package/v1", entries: [h2aEntry] }, null, 2)}\n`);
emit("packages/track/registry/entries.v1.json", `${JSON.stringify({ format: "sentropic.registry-package/v1", entries: [trackEntry] }, null, 2)}\n`);
console.log(`registry entries: h2a ${coordinationTools.length} coordination tools, track ${trackTools.length} read tools${CHECK ? " (check)" : ""}`);

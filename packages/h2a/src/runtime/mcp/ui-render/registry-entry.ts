/**
 * The cluster-mesh registry seam (h2a spec §8.3): the normative
 * `sentropic.ui-render` RegistryEntry descriptor and its
 * AppMcpProviderManifest, exported from the ui-render module. The
 * registry path the spec names — `@sentropic/cluster-mesh/mcp/registry`
 * (`createMcpRegistry`) reached through `packages/h2a/src/registry/` —
 * is not on main (cluster-mesh 0.16.0 has no mcp/registry export), so
 * this module is the seam: PR #354 wires these values into
 * `packages/h2a/registry/entries.v1.json` (entries[1]) and
 * `sentropic-daemon.ts` verbatim, without re-deriving anything. The
 * entry is 100% read-only (`readOnly: true`, `mutability:
 * "read-only"`, `mutatesExternalSystem: false`), so it stays admissible
 * in both the `shared-central` and `hosted-read-only` profiles.
 */

import { createHash } from "node:crypto";

import { UI_RENDER_TOOL_NAMES } from "./tools.js";
import { PILOT_RESOURCE_DOMAIN } from "./types.js";

/** The render mode of the pilot shell (§8.3.2 parameters enum). */
export type UiRenderMode = "pilot-inline" | "pilot-per-component" | "cdn-sri";

/** All render modes in declaration order (§8.3.2). */
export const UI_RENDER_MODES: readonly UiRenderMode[] = [
  "pilot-inline",
  "pilot-per-component",
  "cdn-sri"
];

/** The provider id of the ui-render module in the cluster-mesh MCP registry. */
export const UI_RENDER_PROVIDER_ID = "sentropic.ui-render";

/** The connector id the ui-render provider is dispatched under (§8.3.2). */
export const UI_RENDER_CONNECTOR_ID = "h2a-ui-render";

/** The registry-relative path of the provider manifest asset (§8.3.2). */
export const UI_RENDER_MANIFEST_ASSET_PATH = "registry/manifest.ui-render.json";

/** The five pinned resource URIs, in list order (§3). */
const RESOURCE_URIS = [
  "ui://sentropic/render/v1",
  "a2ui://sentropic/catalog/v1",
  "ui://sentropic/BarChart/v1",
  "ui://sentropic/BpmnCanvas/v1",
  "ui://sentropic/DecisionDossier/v1"
] as const;

/** The pilot CSP declaration the shell resource carries (DS §6.4 U-12). */
const PILOT_CSP = { resourceDomains: [PILOT_RESOURCE_DOMAIN], connectDomains: [] } as const;

/** A cluster-mesh CapabilityResource descriptor for one pinned URI. */
export interface UiRenderCapabilityResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mutability: "read-only";
  readonly mutatesExternalSystem: false;
  readonly idempotency: { readonly required: false };
  readonly _meta?: Readonly<Record<string, unknown>>;
}

/** A read-only CapabilityTool descriptor of the ui-render provider. */
export interface UiRenderCapabilityTool {
  readonly name: string;
  readonly readOnly: true;
}

/** The AppMcpProviderManifest of `sentropic.ui-render` (§8.3.3). */
export interface UiRenderProviderManifest {
  readonly providerId: string;
  readonly appId: string;
  readonly connectorIds: readonly string[];
  readonly resources: readonly UiRenderCapabilityResource[];
  readonly tools: readonly UiRenderCapabilityTool[];
}

/** The pinned resource names (§3.1/§3.2 and the per-component shells). */
const RESOURCE_NAMES: Readonly<Record<(typeof RESOURCE_URIS)[number], string>> = {
  "ui://sentropic/render/v1": "Sentropic Design-System JSON Renderer (v1)",
  "a2ui://sentropic/catalog/v1": "Sentropic Design-System Elements Catalogue (v1)",
  "ui://sentropic/BarChart/v1": "Sentropic BarChart Component Shell (v1)",
  "ui://sentropic/BpmnCanvas/v1": "Sentropic BpmnCanvas Component Shell (v1)",
  "ui://sentropic/DecisionDossier/v1": "Sentropic DecisionDossier Component Shell (v1)"
};

/** The pinned resource descriptions (§3). */
const RESOURCE_DESCRIPTIONS: Readonly<Record<(typeof RESOURCE_URIS)[number], string>> = {
  "ui://sentropic/render/v1":
    "Sandboxed SEP-1865 MCP App shell hosting @sentropic/design-system-elements.",
  "a2ui://sentropic/catalog/v1":
    "Machine-readable JSON Schema 2020-12 component catalogue of the design system.",
  "ui://sentropic/BarChart/v1": "Per-component MCP App shell mounting <st-bar-chart>.",
  "ui://sentropic/BpmnCanvas/v1": "Per-component MCP App shell mounting <st-bpmn-canvas>.",
  "ui://sentropic/DecisionDossier/v1": "Per-component MCP App shell mounting <st-decision-dossier>."
};

/**
 * The tool set one mode exposes: the default profile
 * (`list_components`, `get_schema`, `render`, `submit_intent`), plus the
 * `render_<id>` tools when the mode is `pilot-per-component` (§8.3.3).
 */
export function uiRenderToolNamesForMode(mode: UiRenderMode): readonly string[] {
  const base = ["list_components", "get_schema", "render", "submit_intent"];
  return mode === "pilot-per-component" ? [...UI_RENDER_TOOL_NAMES].sort() : base;
}

/**
 * The AppMcpProviderManifest of `sentropic.ui-render` for one mode:
 * read-only resources and tools, never mutating, never holding tenant
 * secrets, and never requiring a signing key (§8.5).
 */
export function uiRenderProviderManifest(mode: UiRenderMode = "pilot-inline"): UiRenderProviderManifest {
  const resources: UiRenderCapabilityResource[] = RESOURCE_URIS.map((uri) => ({
    uri,
    name: RESOURCE_NAMES[uri],
    description: RESOURCE_DESCRIPTIONS[uri],
    mutability: "read-only",
    mutatesExternalSystem: false,
    idempotency: { required: false },
    ...(uri === "ui://sentropic/render/v1" ? { _meta: { ui: { csp: PILOT_CSP } } } : {})
  }));
  const tools: UiRenderCapabilityTool[] = uiRenderToolNamesForMode(mode).map((name) => ({
    name,
    readOnly: true
  }));
  return Object.freeze({
    providerId: UI_RENDER_PROVIDER_ID,
    appId: "@sentropic/h2a",
    connectorIds: Object.freeze([UI_RENDER_CONNECTOR_ID]),
    resources: Object.freeze(resources),
    tools: Object.freeze(tools)
  });
}

/**
 * The canonical bytes of the manifest asset file: 2-space JSON plus a
 * trailing newline. The registry sync script (PR #354) re-pins the
 * sha256 of these bytes into `entries.v1.json` when it materializes
 * `packages/h2a/registry/manifest.ui-render.json`; computing it here
 * keeps the entry honest until that script lands on main.
 */
export function uiRenderManifestAssetJson(mode: UiRenderMode = "pilot-inline"): string {
  return `${JSON.stringify(uiRenderProviderManifest(mode), null, 2)}\n`;
}

/** The sha256 of the canonical manifest asset bytes for one mode. */
export function uiRenderManifestAssetSha256(mode: UiRenderMode = "pilot-inline"): string {
  return createHash("sha256").update(uiRenderManifestAssetJson(mode), "utf8").digest("hex");
}

/** The normative RegistryEntry descriptor (h2a spec §8.3.2, frozen). */
export const UI_RENDER_REGISTRY_ENTRY: Readonly<Record<string, unknown>> = Object.freeze({
  format: "sentropic.registry-entry/v1",
  contractVersion: "1.1.4",
  kind: "mcp",
  id: UI_RENDER_PROVIDER_ID,
  name: "ui-render",
  description:
    "Design-system JSON_RENDER MCP module (ui://sentropic/render/v1): component catalogue, " +
    "standalone JSON schemas, 9-step envelope validation, and sandboxed SEP-1865 MCP App rendering.",
  entryVersion: "1.0.0",
  publisher: Object.freeze({
    packageName: "@sentropic/h2a",
    packageVersion: "0.98.7"
  }),
  compatibility: Object.freeze({
    entryContract: "1.1.4",
    packages: Object.freeze([Object.freeze({ name: "@sentropic/focus", range: "0.5.0" })]),
    schemaProfiles: Object.freeze(["sentropic.parameters/2020-12-bounded-v1"]),
    requiredHostFeatures: Object.freeze(["stdio"]),
    optionalHostFeatures: Object.freeze(["streamable-http", "mcp-app-ui"])
  }),
  parameters: Object.freeze({
    schemaVersion: "1.0.0",
    schema: Object.freeze({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:sentropic:registry:parameters:sentropic.ui-render:1.0.0",
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["mode"]),
      properties: Object.freeze({
        mode: Object.freeze({
          enum: Object.freeze([...UI_RENDER_MODES])
        })
      })
    }),
    defaults: Object.freeze({ mode: "pilot-inline" })
  }),
  bindings: Object.freeze([]),
  assets: Object.freeze([
    Object.freeze({
      role: "manifest",
      path: UI_RENDER_MANIFEST_ASSET_PATH,
      mediaType: "application/json",
      sha256: uiRenderManifestAssetSha256("pilot-inline")
    }),
    Object.freeze({
      role: "catalog-schema",
      path: "vendor/design-system-elements/catalog.json",
      mediaType: "application/schema+json",
      sha256: "f2358a8f96cdf28949d1b17f7c29c287201efb53c6b8ba709b4a27165206a36c"
    }),
    Object.freeze({
      role: "envelope-schema",
      path: "vendor/design-system-elements/envelope.json",
      mediaType: "application/schema+json",
      sha256: "6bf3351ba45c90a0dd3b40a7e7eddf019e72379a4551acc07a89f4436fc6cf2e"
    })
  ]),
  mcp: Object.freeze({
    manifestAsset: UI_RENDER_MANIFEST_ASSET_PATH,
    connectorIds: Object.freeze([UI_RENDER_CONNECTOR_ID]),
    transportProfiles: Object.freeze([
      Object.freeze({
        id: "shared-central-stdio",
        mode: "in-process",
        protocolVersions: Object.freeze(["2025-06-18"]),
        requiredHostFeatures: Object.freeze(["stdio"])
      }),
      Object.freeze({
        id: "hosted-read-only-http",
        mode: "streamable-http",
        protocolVersions: Object.freeze(["2025-06-18"]),
        requiredHostFeatures: Object.freeze(["streamable-http"])
      })
    ]),
    protocolVersions: Object.freeze(["2025-06-18"]),
    capabilityProfiles: Object.freeze([
      Object.freeze({
        id: "default",
        tools: Object.freeze(uiRenderToolNamesForMode("pilot-inline")),
        resources: Object.freeze([...RESOURCE_URIS]),
        prompts: Object.freeze([]),
        readOnly: true
      }),
      Object.freeze({
        id: "per-component-fallback",
        tools: Object.freeze(uiRenderToolNamesForMode("pilot-per-component")),
        resources: Object.freeze([...RESOURCE_URIS]),
        prompts: Object.freeze([]),
        readOnly: true
      })
    ])
  }),
  extensions: Object.freeze({
    "io.modelcontextprotocol/ui": Object.freeze({
      resourceUri: "ui://sentropic/render/v1",
      mimeTypes: Object.freeze(["text/html;profile=mcp-app"])
    })
  }),
  requiredExtensions: Object.freeze([])
});

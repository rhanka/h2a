/**
 * The ui:// render tool surface (h2a spec §4; DS spec §8.2, §8.3):
 * `list_components`, `get_schema`, `render`, the per-component fallback
 * `render_<id>` tools, and `submit_intent`. Every result is a transport-
 * shaped `{ content, structuredContent?, isError? }` — `structuredContent`
 * carries the machine view (envelope echo + diagnostics) while `content`
 * stays within the DS §8.2 byte caps so the model-visible surface is always
 * bounded.
 */

import { createHash } from "node:crypto";

import type { UiRenderAssets, UiRenderCatalogEntry } from "./assets.js";
import { fallbackContent, formatDiagnosticsSummary, truncateUtf8Bytes } from "./fallback.js";
import type { UiRenderValidator } from "./validation.js";
import { utf8ByteLength } from "./validation.js";
import {
  PILOT_RESOURCE_DOMAIN,
  type IntentEvent,
  type UiExtensionCapability,
  type UiRenderCallContext,
  type UiRenderDiagnostic
} from "./types.js";
import type { McpToolDescriptor } from "../tools.js";
import type { McpTransportResult } from "../server.js";

/** Every tool name the module owns (h2a spec §4.1). */
export const UI_RENDER_TOOL_NAMES = [
  "list_components",
  "get_schema",
  "render",
  "render_BarChart",
  "render_BpmnCanvas",
  "render_DecisionDossier",
  "submit_intent"
] as const;

/** The pinned catalogue summaries of the normative component trio (§4.2.1). */
const COMPONENT_SUMMARIES: Readonly<Record<string, string>> = {
  BarChart:
    "Categorical bar chart with optional reference lines, shaded bands, goal line, annotations, and bar selection.",
  BpmnCanvas: "Read-only BPMN 2.0 process diagram viewer rendering F1 moddle JSON documents.",
  DecisionDossier: "Read-only decision-dossier snapshot published by @sentropic/focus."
};

/** The intent names the §4.6 schema admits. */
const INTENT_NAMES = ["select", "open", "choose-option", "comment"] as const;

/** The §4.6 intent input schema, verbatim. */
const INTENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["event", "name", "target", "context"],
  properties: {
    event: { const: "intent" },
    name: { type: "string", enum: [...INTENT_NAMES] },
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
} as const;

/** The consumer invoked by submit_intent (the future decision-inject seam). */
export type UiRenderIntentConsumer = (
  intent: IntentEvent,
  context?: UiRenderCallContext
) => void;

/** Options of `createUiRenderTools`. */
export interface CreateUiRenderToolsOptions {
  readonly assets: UiRenderAssets;
  readonly validator: UiRenderValidator;
  /** Optional server-configured intent consumer (DS §8.2 & §11.2 criterion 4). */
  readonly onIntent?: UiRenderIntentConsumer;
  /**
   * The envelope-echo threshold: above it `structuredContent` carries
   * `envelopeSha256` instead of the envelope. Defaults to the h2a frame
   * ceiling minus 16 KiB (never triggering `boundCallToolResult`). The
   * L3.5 offline measurement (fixtures/ui-render-ac-l3) kept this
   * default: every pilot resource fits the 1 MiB frame with the echo;
   * fixing the value from real-host caps (U-1) stays open.
   */
  readonly inlineLimitBytes?: number;
}

/** The tools handlers for one module. */
export interface UiRenderTools {
  listTools(): McpToolDescriptor[];
  /** Returns undefined when `name` is not a ui-render tool. */
  callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    context?: UiRenderCallContext
  ): McpTransportResult | undefined;
}

/** The x-sentropic metadata block of one catalogue entry. */
function sentropicOf(entry: UiRenderCatalogEntry | undefined): {
  readonly contract?: unknown;
  readonly element?: unknown;
  readonly engine?: unknown;
  readonly events?: unknown;
  readonly status?: unknown;
  readonly example?: unknown;
} {
  return entry?.["x-sentropic"] as ReturnType<typeof sentropicOf>;
}

/** One closed §4.5 diagnostic, as emitted by the tools themselves. */
function diagnostic(
  code: string,
  path: string,
  message: string,
  detail?: Record<string, unknown>
): UiRenderDiagnostic {
  return {
    code,
    path,
    message,
    severity: "error",
    source: "catalog",
    ...(detail !== undefined ? { detail } : {})
  };
}

/** A refused tool result: bounded summary text + diagnostics. */
function refused(args: {
  diagnostics: UiRenderDiagnostic[];
  envelope?: unknown;
  envelopeSha256?: string;
}): McpTransportResult {
  return {
    content: [{ type: "text", text: formatDiagnosticsSummary(args.diagnostics) }],
    isError: true,
    structuredContent: {
      ...(args.envelopeSha256 !== undefined
        ? { envelopeSha256: args.envelopeSha256 }
        : { envelope: args.envelope }),
      diagnostics: args.diagnostics
    }
  };
}

export function createUiRenderTools(options: CreateUiRenderToolsOptions): UiRenderTools {
  const { assets, validator } = options;
  const inlineLimitBytes =
    options.inlineLimitBytes ?? 1_048_576 - 16_384; // resolveFrameBudget default − 16 KiB (§5.2)
  const components = Object.keys(assets.catalog.components);
  const perComponentUri = (component: string): string => `ui://sentropic/${component}/v1`;
  /** Per-connection intent fallback (§4.2.4); closed sessions can be collected. */
  const sessionStates = new WeakMap<object, { lastRenderedComponent?: string }>();
  const defaultConnection = {};
  function sessionState(context?: UiRenderCallContext): { lastRenderedComponent?: string } {
    const key = context ?? defaultConnection;
    let state = sessionStates.get(key);
    if (state === undefined) {
      state = {};
      sessionStates.set(key, state);
    }
    return state;
  }

  function cspDeclaration(): { resourceDomains: string[]; connectDomains: [] } {
    return { resourceDomains: [PILOT_RESOURCE_DOMAIN], connectDomains: [] };
  }

  function listTools(): McpToolDescriptor[] {
    const descriptors: McpToolDescriptor[] = [
      {
        name: "list_components",
        description: "List the catalogued design-system components (name, element, contract, engine, summary).",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        _meta: { ui: { visibility: ["model", "app"] } }
      },
      {
        name: "get_schema",
        description:
          "Return the standalone JSON Schema and the single example envelope of one catalogued component.",
        inputSchema: {
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
        },
        annotations: { readOnlyHint: true },
        _meta: { ui: { visibility: ["model", "app"] } }
      },
      {
        name: "render",
        description:
          "Validate and render one SEP-1865 envelope (the arguments ARE the envelope: optional catalogId, contract, optional mode, root) through the linked ui:// resource.",
        inputSchema: assets.envelopeSchema as unknown as McpToolDescriptor["inputSchema"],
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: "ui://sentropic/render/v1",
            visibility: ["model", "app"],
            csp: cspDeclaration()
          }
        }
      },
      {
        name: "submit_intent",
        description:
          "Record an intent event dispatched by a rendered component (e.g. a bar selection) and forward it to the configured consumer.",
        inputSchema: INTENT_INPUT_SCHEMA as unknown as McpToolDescriptor["inputSchema"],
        annotations: { readOnlyHint: true },
        _meta: { ui: { visibility: ["app"] } }
      }
    ];
    for (const component of components) {
      const schema = assets.schemas[component];
      if (schema === undefined) continue; // a workspace overlay may miss per-component schemas
      descriptors.push({
        name: `render_${component}`,
        description: `Validate and render a ${component} envelope through the single-component ${perComponentUri(component)} resource.`,
        inputSchema: schema as unknown as McpToolDescriptor["inputSchema"],
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: perComponentUri(component),
            visibility: ["model", "app"],
            csp: cspDeclaration()
          }
        }
      });
    }
    return descriptors;
  }

  function listComponents(): McpTransportResult {
    const lines: string[] = [];
    const listed: { name: string; element: string; contract: string; engine: string; summary: string; status?: string }[] = [];
    for (const [name, entry] of Object.entries(assets.catalog.components)) {
      const sentropic = sentropicOf(entry);
      const contract = typeof sentropic?.contract === "string" ? sentropic.contract : "";
      const engine = typeof sentropic?.engine === "string" ? sentropic.engine : "";
      const element = typeof sentropic?.element === "string" ? sentropic.element : "";
      const summary = COMPONENT_SUMMARIES[name] ?? "";
      const status = typeof sentropic?.status === "string" ? sentropic.status : undefined;
      listed.push(status === undefined ? { name, element, contract, engine, summary } : { name, element, contract, engine, summary, status });
      const statusPart = status === undefined ? "" : `, status: ${status}`;
      lines.push(`${name} (contract ${contract}, engine ${engine}${statusPart}): ${summary}`);
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { catalogId: assets.catalog.catalogId, components: listed }
    };
  }

  function getSchema(component: string): McpTransportResult {
    const entry = assets.catalog.components[component] as UiRenderCatalogEntry | undefined;
    if (entry === undefined) {
      return refused({
        diagnostics: [
          diagnostic(
            "unknown-component",
            "/root/component",
            `no catalogued component is named ${component}`,
            { component }
          )
        ]
      });
    }
    if (sentropicOf(entry)?.status === "unknown") {
      return refused({
        diagnostics: [
          diagnostic(
            "component-unavailable",
            "/root/component",
            `${component} is catalogued as a placeholder (x-sentropic.status "unknown") and cannot render`,
            { component }
          )
        ]
      });
    }
    const schema = assets.schemas[component];
    if (schema === undefined) {
      return refused({
        diagnostics: [
          diagnostic(
            "unknown-component",
            "/root/component",
            `no standalone schema is vendored for ${component}`,
            { component }
          )
        ]
      });
    }
    const example = {
      catalogId: assets.catalog.catalogId,
      contract: sentropicOf(entry)?.contract,
      root: sentropicOf(entry)?.example
    };
    const structuredContent = { catalogId: assets.catalog.catalogId, schema, example };
    return {
      content: [
        {
          type: "text",
          text: truncateUtf8Bytes(JSON.stringify(structuredContent, null, 2), 262_144)
        }
      ],
      structuredContent
    };
  }

  /** Assembles the success result of render / render_<id> for one negotiation state. */
  function renderSuccess(
    args: Record<string, unknown>,
    diagnostics: readonly UiRenderDiagnostic[],
    structuredContent: Record<string, unknown>,
    component: string,
    resourceUri: string,
    negotiated: boolean
  ): McpTransportResult {
    if (negotiated) {
      const text = truncateUtf8Bytes(
        `Rendered ${component} (contract ${
          (args as { contract?: unknown }).contract ?? ""
        }); the host displays ${resourceUri}.`,
        4096
      );
      return { content: [{ type: "text", text }], structuredContent };
    }
    return {
      content: fallbackContent(component, (args as { root?: unknown }).root),
      structuredContent
    };
  }

  function submitIntent(
    args: Record<string, unknown> | undefined,
    context?: UiRenderCallContext
  ): McpTransportResult {
    const intent = args ?? {};
    // §4.6 structural validation.
    if (intent.event !== "intent") {
      return refused({
        diagnostics: [diagnostic("schema-violation", "/event", "event must be the constant \"intent\"")]
      });
    }
    const name = intent.name;
    if (typeof name !== "string" || !(INTENT_NAMES as readonly string[]).includes(name)) {
      return refused({
        diagnostics: [
          diagnostic(
            "schema-violation",
            "/name",
            `name must be one of ${INTENT_NAMES.join(", ")}`,
            { found: String(name) }
          )
        ]
      });
    }
    const target = intent.target;
    if (typeof target !== "string" || target.length < 1 || target.length > 256) {
      return refused({
        diagnostics: [
          diagnostic("schema-violation", "/target", "target must be a string of 1..256 characters")
        ]
      });
    }
    const intentContext = intent.context;
    if (intentContext === null || typeof intentContext !== "object" || Array.isArray(intentContext)) {
      return refused({
        diagnostics: [diagnostic("schema-violation", "/context", "context must be an object")]
      });
    }
    // Component resolution: context.component, else the last rendered component.
    const contextComponent = (intentContext as { component?: unknown }).component;
    const component =
      typeof contextComponent === "string"
        ? contextComponent
        : sessionState(context).lastRenderedComponent;
    if (component === undefined) {
      return refused({
        diagnostics: [
          diagnostic(
            "schema-violation",
            "/context/component",
            "no rendered component is known for this session; pass context.component",
            { component }
          )
        ]
      });
    }
    const entry = assets.catalog.components[component];
    const events = sentropicOf(entry)?.events;
    const permitted = Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [];
    if (!(permitted as readonly string[]).includes(name)) {
      return refused({
        diagnostics: [
          diagnostic(
            "schema-violation",
            "/name",
            `"${name}" is not a permitted intent for ${component}`,
            { component, permitted }
          )
        ]
      });
    }
    const intentEvent: IntentEvent = {
      event: "intent",
      name,
      target,
      context: intentContext as Record<string, unknown>
    };
    options.onIntent?.(intentEvent, context);
    return {
      content: [
        { type: "text", text: truncateUtf8Bytes(`Intent recorded: ${name} on ${target}`, 1024) }
      ],
      structuredContent: { ok: true, intent: intentEvent }
    };
  }

  function callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    context?: UiRenderCallContext
  ): McpTransportResult | undefined {
    if (name === "list_components") return listComponents();
    if (name === "get_schema") {
      const component = args?.component;
      if (typeof component !== "string" || component.length === 0) {
        return refused({
          diagnostics: [diagnostic("schema-violation", "/component", "component is required")]
        });
      }
      return getSchema(component);
    }
    if (name === "render") {
      return handleRender(undefined, "ui://sentropic/render/v1", args, context);
    }
    if (name === "submit_intent") return submitIntent(args, context);
    for (const component of components) {
      if (name === `render_${component}`) {
        return handleRender(component, perComponentUri(component), args, context);
      }
    }
    return undefined;
  }

  /** The shared render / render_<id> pipeline (§4.2.3). */
  function handleRender(
    pinnedComponent: string | undefined,
    resourceUri: string,
    args: Record<string, unknown> | undefined,
    context?: UiRenderCallContext
  ): McpTransportResult {
    const envelope = args ?? {};
    const rootComponent =
      envelope.root && typeof envelope.root === "object"
        ? (envelope.root as { component?: unknown }).component
        : undefined;
    if (pinnedComponent !== undefined && typeof rootComponent === "string" && rootComponent !== pinnedComponent) {
      return refused({
        diagnostics: [
          diagnostic(
            "schema-violation",
            "/root/component",
            `render_${pinnedComponent} renders ${pinnedComponent} envelopes, not ${rootComponent}`,
            { expected: pinnedComponent, found: rootComponent }
          )
        ],
        envelope
      });
    }
    const diagnostics = [...validator.validate(envelope)];
    const hasError = diagnostics.some((item) => item.severity === "error");
    if (!hasError && typeof rootComponent === "string") {
      sessionState(context).lastRenderedComponent = rootComponent;
    }
    const serialized = JSON.stringify(envelope);
    const structuredContent =
      utf8ByteLength(serialized) > inlineLimitBytes
        ? {
            envelopeSha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
            diagnostics
          }
        : { envelope, diagnostics };
    if (hasError) {
      return {
        content: [{ type: "text", text: formatDiagnosticsSummary(diagnostics) }],
        isError: true,
        structuredContent
      };
    }
    return renderSuccess(
      envelope,
      diagnostics,
      structuredContent,
      typeof rootComponent === "string" ? rootComponent : "",
      resourceUri,
      context?.uiCapability?.negotiated === true
    );
  }

  return { listTools, callTool };
}

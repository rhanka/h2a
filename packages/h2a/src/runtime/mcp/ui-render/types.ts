/**
 * json-render L3 — the ui:// render module's shared types (DS spec §4, §6.5,
 * §8; h2a spec §1.2, §3, §4). The diagnostic shape is the CLOSED §4.5 set of
 * the JSON_RENDER standard: ten codes, five sources, one RFC 6901 `path`
 * into the envelope, `detail` for machine extras.
 */

/** The SEP-1865 MCP App resource MIME type. */
export const UI_MIME_TYPE = "text/html;profile=mcp-app";

/** The A2UI component-catalogue resource MIME type. */
export const CATALOG_MIME_TYPE = "application/schema+json";

/** The single CDN origin the pilot asset rule allows (DS §6.4, U-12). */
export const PILOT_RESOURCE_DOMAIN = "https://cdn.jsdelivr.net";

/** The closed §4.5 diagnostic code set. */
export type DiagnosticCode =
  | "unknown-component"
  | "component-unavailable"
  | "unsupported-contract"
  | "unsupported-mode"
  | "schema-violation"
  | "semantic-invalid"
  | "payload-too-large"
  | "host-capability-missing"
  | "engine-load-failed"
  | "watermark-refused";

/** The closed §4.5 diagnostic source set (`diagram-core` is reserved for DS L8). */
export type DiagnosticSource = "catalog" | "host" | "focus" | "bpmn-canvas" | "diagram-core";

/** The single §4.5 diagnostic shape. */
export interface UiRenderDiagnostic {
  readonly code: DiagnosticCode | (string & {});
  /** RFC 6901 JSON Pointer into the envelope ("" for the envelope itself). */
  readonly path: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly source: DiagnosticSource;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * A finding of an injected semantic port (§4.3 item 2). `pointer` is RFC 6901
 * RELATIVE TO THE PAYLOAD; the envelope validator anchors it into the envelope.
 */
export interface SemanticFinding {
  readonly code: string;
  readonly message: string;
  readonly pointer?: string;
  readonly severity: "error" | "warning";
}

/** The engines that can own a component's semantics (§4.3 item 2). */
export type EngineSource = "focus" | "bpmn-canvas" | "diagram-core";

/** The injected binding to one owning runtime (§4.3 item 2). */
export interface SemanticPort {
  readonly source: EngineSource;
  validate(payload: unknown): readonly SemanticFinding[];
}

/** The §4.6 intent event the mounted element dispatches (`st-intent`). */
export interface IntentEvent {
  readonly event: "intent";
  readonly name: string;
  readonly target: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/** SEP-1865 CSP domains a host must allow for the MCP App resource. */
export interface UiCspDeclaration {
  readonly resourceDomains: readonly string[];
  readonly connectDomains: readonly string[];
}

/** The `io.modelcontextprotocol/ui` capability as negotiated per connection. */
export interface UiExtensionCapability {
  readonly negotiated: boolean;
  readonly mimeTypes: readonly string[];
}

/** One `resources/list` entry (MCP `Resource`). */
export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  readonly _meta?: {
    readonly ui?: {
      readonly csp?: UiCspDeclaration;
    };
  };
}

/** One `resources/read` content entry (MCP `ResourceContents` with text). */
export interface McpResourceContents {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
  readonly _meta?: {
    readonly ui?: {
      readonly csp?: UiCspDeclaration;
    };
  };
}

export interface McpReadResourceResult {
  readonly contents: readonly McpResourceContents[];
}

/** A typed `resources/read` refusal (-32002) for an unknown URI. */
export class UnknownResourceError extends Error {
  constructor(public readonly uri: string) {
    super(`Resource not found: ${uri}`);
    this.name = "UnknownResourceError";
  }
}

/** Per-call context threaded by the transports (h2a spec §1.2). */
export interface UiRenderCallContext {
  readonly uiCapability?: UiExtensionCapability;
}

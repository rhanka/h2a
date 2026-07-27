/**
 * Internal groundwork for a principal-scoped third-party MCP broker.
 *
 * This module deliberately has no stdio, HTTP, or public h2a MCP wiring. The
 * future gateway owns authenticated ingress and turns its authenticated `sub`
 * into an AuthenticatedPrincipal before it creates this broker.
 */

declare const authenticatedPrincipalBrand: unique symbol;
declare const secretRefBrand: unique symbol;

/** A subject established by the broker ingress, never an agent tool argument. */
export type AuthenticatedPrincipal = string & {
  readonly [authenticatedPrincipalBrand]: "AuthenticatedPrincipal";
};

/**
 * Opaque vault reference. This is the only credential-shaped value in the
 * broker types: it names server-held material, it does not contain that
 * material.
 */
export type SecretRef = string & { readonly [secretRefBrand]: "SecretRef" };

/** Construct server-side opaque values at trusted integration boundaries. */
export function authenticatedPrincipal(sub: string): AuthenticatedPrincipal {
  return sub as AuthenticatedPrincipal;
}

/** Construct a server-side vault handle; no credential value is accepted. */
export function secretRef(ref: string): SecretRef {
  return ref as SecretRef;
}

export interface RegistryToolInputSchema {
  readonly type: "object";
  readonly properties: {
    readonly query: {
      readonly type: "string";
      readonly description?: string;
    };
  };
  readonly required: readonly ["query"];
  readonly additionalProperties: false;
}

/** The complete tool shape an agent may receive from this module. */
export interface AgentVisibleRegistryTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: RegistryToolInputSchema;
}

/** The only agent-supplied shape accepted by this one-server increment. */
export interface AgentVisibleRegistryArguments {
  readonly query: string;
}

/** The reviewed, agent-visible result shape for the one read-only mail operation. */
export interface AgentVisibleRegistryOutput {
  readonly kind: "mail.search.result";
  readonly messages: readonly {
    readonly id: string;
    readonly subject: string;
  }[];
}

/**
 * Adapter-side reviewed data. This is intentionally not the object returned to
 * an agent: the broker constructs the closed AgentVisibleRegistryOutput DTO.
 */
export interface ReviewedMailSearchResult {
  readonly messages: readonly {
    readonly id: string;
    readonly subject: string;
  }[];
}

/** A reviewed, pinned descriptor. It is never learned from upstream tools/list. */
export interface ReviewedRegistryServer {
  readonly id: string;
  readonly tools: readonly AgentVisibleRegistryTool[];
}

/**
 * Server-side authorization record. `secretRef` is intentionally opaque and
 * is absent from every agent-visible result type below.
 */
export interface ConnectorGrant {
  readonly connectorRef: string;
  readonly serverId: string;
  readonly secretRef: SecretRef;
  readonly mayUseToolNames: readonly string[];
  readonly active: boolean;
}

export interface Established<T> {
  readonly kind: "established";
  readonly state: "success";
  readonly value: T;
  readonly asOf: string;
}

/**
 * A non-success resolution is intentionally open-ended. Broker code recognizes
 * only the positive `established` state, so a newly added failure state cannot
 * be mistaken for an established empty collection.
 */
export interface NonEstablishedResolution {
  readonly kind: string;
  readonly state: "failure";
  readonly source: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly observedAt: string;
}

export type RegistryResolution<T> = Established<T> | NonEstablishedResolution;

export function established<T>(value: T, asOf = new Date().toISOString()): Established<T> {
  return { kind: "established", state: "success", value, asOf };
}

export function isEstablished<T>(resolution: RegistryResolution<T>): resolution is Established<T> {
  return resolution.kind === "established" && resolution.state === "success" && "value" in resolution;
}

export interface PrincipalGrantResolver {
  resolve(principal: AuthenticatedPrincipal): RegistryResolution<readonly ConnectorGrant[]>;
}

/** Executor-only call: the opaque secret reference never enters agent-visible types. */
export interface RegistryUpstreamAdapter {
  invoke(input: {
    readonly connectorRef: string;
    readonly secretRef: SecretRef;
    readonly tool: AgentVisibleRegistryTool;
    readonly arguments: AgentVisibleRegistryArguments;
    readonly correlationId: string;
  }): RegistryResolution<ReviewedMailSearchResult>;
}

export interface RegistryAuditEvent {
  readonly principalRef: string;
  readonly connectorRef: string | undefined;
  readonly toolName: string | undefined;
  readonly outcome:
    | "listed"
    | "called"
    | "unavailable"
    | "not_authorized"
    | "invalid_arguments";
  readonly correlationId: string | undefined;
  readonly observedAt: string;
}

export interface PrincipalScopedRegistryBrokerOptions {
  readonly principal: AuthenticatedPrincipal;
  readonly catalogue: readonly ReviewedRegistryServer[];
  readonly grantResolver: PrincipalGrantResolver;
  readonly adapters: Readonly<Record<string, RegistryUpstreamAdapter>>;
  readonly audit?: (event: RegistryAuditEvent) => void;
  readonly now?: () => string;
}

export interface RegistryToolsEstablished {
  readonly kind: "established";
  readonly tools: readonly AgentVisibleRegistryTool[];
  readonly asOf: string;
}

export type RegistryUnavailableSource =
  | "catalogue"
  | "binding"
  | "grant"
  | "credential"
  | "upstream"
  | "adapter";

export type RegistryUnavailableCode =
  | "source_unavailable"
  | "upstream_timeout"
  | "upstream_protocol_error"
  | "adapter_not_available";

export interface RegistryUnavailable {
  readonly kind: "unavailable";
  readonly source: RegistryUnavailableSource;
  readonly code: RegistryUnavailableCode;
  readonly retryable: boolean;
  readonly observedAt: string;
}

/** The only two possible discovery results: established (including empty), or unavailable. */
export type RegistryToolsResult = RegistryToolsEstablished | RegistryUnavailable;

export interface RegistryCallCompleted {
  readonly kind: "completed";
  readonly output: AgentVisibleRegistryOutput;
}

export interface RegistryNotAuthorized {
  readonly kind: "not_authorized";
}

export interface RegistryInvalidArguments {
  readonly kind: "invalid_arguments";
}

export type RegistryCallResult =
  | RegistryCallCompleted
  | RegistryUnavailable
  | RegistryNotAuthorized
  | RegistryInvalidArguments;

export interface PrincipalScopedRegistryBroker {
  /** Returns only this principal's effective mayUse projection, never the catalogue or grants. */
  listTools(): RegistryToolsResult;
  /** Re-resolves grants before every call; a previous list is never authorization. */
  callTool(input: {
    readonly name: string;
    readonly arguments: AgentVisibleRegistryArguments;
    readonly correlationId: string;
  }): RegistryCallResult;
}

type EffectiveTool = {
  readonly grant: ConnectorGrant;
  readonly tool: AgentVisibleRegistryTool;
};

function unavailableSource(source: string): RegistryUnavailableSource {
  if (
    source === "catalogue" ||
    source === "binding" ||
    source === "grant" ||
    source === "credential" ||
    source === "upstream" ||
    source === "adapter"
  ) {
    return source;
  }
  return "upstream";
}

function unavailableCode(code: string): RegistryUnavailableCode {
  if (
    code === "upstream_timeout" ||
    code === "upstream_protocol_error" ||
    code === "adapter_not_available"
  ) {
    return code;
  }
  return "source_unavailable";
}

function unavailable(resolution: NonEstablishedResolution): RegistryUnavailable {
  return {
    kind: "unavailable",
    source: unavailableSource(resolution.source),
    code: unavailableCode(resolution.code),
    retryable: resolution.retryable,
    observedAt: resolution.observedAt
  };
}

function failed(
  source: string,
  observedAt: string,
  code = "source_unavailable",
  retryable = true
): NonEstablishedResolution {
  return {
    kind: "unexpected_failure",
    state: "failure",
    source,
    code,
    retryable,
    observedAt
  };
}

function hasAgentVisibleArguments(value: unknown): value is AgentVisibleRegistryArguments {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "query" in value &&
    typeof (value as { query?: unknown }).query === "string"
  );
}

function toAgentVisibleOutput(value: unknown): AgentVisibleRegistryOutput | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("messages" in value) ||
    !Array.isArray(value.messages)
  ) {
    return undefined;
  }
  const messages: Array<{ id: string; subject: string }> = [];
  for (const message of value.messages) {
    if (
      typeof message !== "object" ||
      message === null ||
      typeof (message as { id?: unknown }).id !== "string" ||
      typeof (message as { subject?: unknown }).subject !== "string"
    ) {
      return undefined;
    }
    messages.push({
      id: (message as { id: string }).id,
      subject: (message as { subject: string }).subject
    });
  }
  return { kind: "mail.search.result", messages };
}

function effectiveTools(
  catalogue: readonly ReviewedRegistryServer[],
  resolution: RegistryResolution<readonly ConnectorGrant[]>
): Established<readonly EffectiveTool[]> | NonEstablishedResolution {
  if (!isEstablished(resolution)) {
    return resolution;
  }

  const servers = new Map(catalogue.map((server) => [server.id, server]));
  const effective: EffectiveTool[] = [];
  for (const grant of resolution.value) {
    if (!grant.active) continue;
    const server = servers.get(grant.serverId);
    if (!server) continue;
    const allowed = new Set(grant.mayUseToolNames);
    for (const tool of server.tools) {
      if (allowed.has(tool.name)) {
        effective.push({ grant, tool });
      }
    }
  }
  return established(effective, resolution.asOf);
}

/**
 * Creates one broker projection for one ingress-authenticated principal.
 * The caller supplies the principal at construction time, not as agent data.
 */
export function createPrincipalScopedRegistryBroker(
  options: PrincipalScopedRegistryBrokerOptions
): PrincipalScopedRegistryBroker {
  const now = options.now ?? (() => new Date().toISOString());

  function audit(
    outcome: RegistryAuditEvent["outcome"],
    connectorRef: string | undefined,
    toolName: string | undefined,
    correlationId: string | undefined
  ): void {
    options.audit?.({
      principalRef: options.principal,
      connectorRef,
      toolName,
      outcome,
      correlationId,
      observedAt: now()
    });
  }

  function resolveEffectiveTools(): Established<readonly EffectiveTool[]> | NonEstablishedResolution {
    try {
      return effectiveTools(options.catalogue, options.grantResolver.resolve(options.principal));
    } catch {
      return failed("grant", now());
    }
  }

  return {
    listTools(): RegistryToolsResult {
      const resolved = resolveEffectiveTools();
      if (!isEstablished(resolved)) {
        const result = unavailable(resolved);
        audit("unavailable", undefined, undefined, undefined);
        return result;
      }
      const tools = resolved.value.map(({ tool }) => tool);
      audit("listed", undefined, undefined, undefined);
      return { kind: "established", tools, asOf: resolved.asOf };
    },

    callTool(input): RegistryCallResult {
      if (!hasAgentVisibleArguments(input.arguments)) {
        audit("invalid_arguments", undefined, input.name, input.correlationId);
        return { kind: "invalid_arguments" };
      }
      const resolved = resolveEffectiveTools();
      if (!isEstablished(resolved)) {
        const result = unavailable(resolved);
        audit("unavailable", undefined, input.name, input.correlationId);
        return result;
      }

      const selected = resolved.value.find(({ tool }) => tool.name === input.name);
      if (!selected) {
        audit("not_authorized", undefined, input.name, input.correlationId);
        return { kind: "not_authorized" };
      }

      const adapter = options.adapters[selected.grant.serverId];
      if (!adapter) {
        const result: RegistryUnavailable = {
          kind: "unavailable",
          source: "adapter",
          code: "adapter_not_available",
          retryable: false,
          observedAt: now()
        };
        audit("unavailable", selected.grant.connectorRef, input.name, input.correlationId);
        return result;
      }

      let upstream: RegistryResolution<ReviewedMailSearchResult>;
      try {
        upstream = adapter.invoke({
          connectorRef: selected.grant.connectorRef,
          secretRef: selected.grant.secretRef,
          tool: selected.tool,
          arguments: input.arguments,
          correlationId: input.correlationId
        });
      } catch {
        upstream = failed("upstream", now());
      }
      if (!isEstablished(upstream)) {
        const result = unavailable(upstream);
        audit("unavailable", selected.grant.connectorRef, input.name, input.correlationId);
        return result;
      }

      const output = toAgentVisibleOutput(upstream.value);
      if (!output) {
        const result = unavailable(failed("upstream", now(), "upstream_protocol_error", false));
        audit("unavailable", selected.grant.connectorRef, input.name, input.correlationId);
        return result;
      }

      audit("called", selected.grant.connectorRef, input.name, input.correlationId);
      return { kind: "completed", output };
    }
  };
}

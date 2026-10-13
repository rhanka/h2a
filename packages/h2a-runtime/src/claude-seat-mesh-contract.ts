/**
 * Local structural mirror of the Claude seat contract from the mesh
 * package baseline (0.25.0): access projection, CLI request/event shapes,
 * runner interface, and host attestations.
 *
 * The gateway-eradication contract forbids source references to the mesh
 * package, so this module duplicates the shapes instead of importing them.
 * Type-only duplication: identical structure, zero runtime coupling. If the
 * mesh baseline moves, update this mirror together with the version noted
 * here; the seat tests pin every shape this mirror carries.
 */

/** In-process secret boundary. Never serialize this input into logs, argv or env. */
export interface ClaudeCodeAccessProjection {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
  readonly accountType?: "individual" | "organization" | string;
  readonly organizationId?: string;
  readonly orgId?: string;
  readonly organization?: string;
  readonly isIndividual?: boolean;
}

export type ClaudeCodeCliContent = {
  type: "text";
  text: string;
} | {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
} | {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export interface ClaudeCodeCliRequest {
  readonly modelId: string;
  readonly messages: readonly {
    role: "user" | "assistant";
    content: readonly ClaudeCodeCliContent[];
  }[];
  readonly tools?: readonly {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }[];
}

/** Normalized by the trusted host; raw CLI output must never cross this seam. */
export type ClaudeCodeCliEvent = {
  type: "text_delta";
  text: string;
} | {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
} | {
  type: "result";
  finishReason: "stop" | "length" | "tool_calls";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
} | {
  type: "error";
};

export interface ClaudeCodeCliRunner {
  /** Abort/iterator return kills and reaps children; result certifies cleanup. */
  run(input: {
    access: ClaudeCodeAccessProjection;
    request: ClaudeCodeCliRequest;
    signal: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent>;
}

/** Trusted host attestations, never inferred from the installed CLI version. */
export interface ClaudeCodeCliCapabilities {
  readonly protocol: "claude-code-stream-json-v1";
  readonly cliVersion: string;
  readonly source: string;
  readonly qualificationRef: string;
  readonly history?: string;
  readonly tools?: string;
}

/** Structural facade surface the seat gate probes (pre-acquire seam only). */
export interface ClaudeSeatFacadeLike {
  readonly createPreAcquireRoutePlanner?: unknown;
  readonly setPreAcquireAttemptHook?: unknown;
}

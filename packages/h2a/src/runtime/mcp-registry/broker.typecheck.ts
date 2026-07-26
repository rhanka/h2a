import type {
  AgentVisibleRegistryOutput,
  ReviewedMailSearchResult,
  RegistryToolInputSchema,
  RegistryUnavailable
} from "./broker.js";

const reviewedInput: RegistryToolInputSchema = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false
};

const reviewedOutput: AgentVisibleRegistryOutput = {
  kind: "mail.search.result",
  messages: [{ id: "message-1", subject: "Quarterly report" }]
};

void reviewedInput;
void reviewedOutput;

const rejectedCredentialSchema: RegistryToolInputSchema = {
  type: "object",
  properties: {
    query: { type: "string" },
    // @ts-expect-error The agent-visible input type cannot gain a credential field.
    accessToken: { type: "string" }
  },
  required: ["query"],
  additionalProperties: false
};

const rejectedCredentialOutput: AgentVisibleRegistryOutput = {
  kind: "mail.search.result",
  messages: [],
  // @ts-expect-error The agent-visible result type cannot gain a credential field.
  accessToken: "never-a-credential"
};

void rejectedCredentialSchema;
void rejectedCredentialOutput;

const rejectedAdapterResult: ReviewedMailSearchResult = {
  messages: [],
  // @ts-expect-error The adapter result type cannot carry a credential field.
  accessToken: "never-a-credential"
};

void rejectedAdapterResult;

const rejectedDiagnostic: RegistryUnavailable = {
  kind: "unavailable",
  // @ts-expect-error Agent-visible failures use a closed source vocabulary.
  source: "upstream response included fake-access-token",
  // @ts-expect-error Agent-visible failures use a closed code vocabulary.
  code: "fake-access-token",
  retryable: true,
  observedAt: "2026-07-26T12:00:00.000Z"
};

void rejectedDiagnostic;

import {
  H2A_ENVELOPE_TYPES,
  H2A_PROTOCOL,
  H2A_ROLES,
  H2A_VERSION,
  type H2AActorRef,
  type H2AEnvelope,
  type H2AEnvelopeType
} from "./types.js";

type CreateEnvelopeInput<TBody> = Omit<
  H2AEnvelope<TBody>,
  "protocol" | "version" | "createdAt"
> & {
  createdAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvelopeType(value: unknown): value is H2AEnvelopeType {
  return typeof value === "string" && H2A_ENVELOPE_TYPES.includes(value as H2AEnvelopeType);
}

function isActorRef(value: unknown): value is H2AActorRef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.instance === "string" &&
    typeof value.scope === "string" &&
    typeof value.role === "string" &&
    H2A_ROLES.includes(value.role as H2AActorRef["role"]) &&
    (value.mandate === undefined || typeof value.mandate === "string")
  );
}

export function createEnvelope<TBody>(
  input: CreateEnvelopeInput<TBody>
): H2AEnvelope<TBody> {
  return {
    protocol: H2A_PROTOCOL,
    version: H2A_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...input
  };
}

export function isH2AEnvelope<TBody = unknown>(
  value: unknown
): value is H2AEnvelope<TBody> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.protocol === H2A_PROTOCOL &&
    value.version === H2A_VERSION &&
    typeof value.id === "string" &&
    isEnvelopeType(value.type) &&
    isActorRef(value.actor) &&
    "body" in value &&
    typeof value.createdAt === "string"
  );
}

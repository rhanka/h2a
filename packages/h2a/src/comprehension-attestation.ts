import { computeHash } from "./canonical.js";
import { H2A_ATTESTER_COMPREHENSION_RIGHT, H2A_AUTHORITY_MATRIX } from "./authority.js";
import { verifyCanonical } from "./signature.js";
import type { H2AEnvelope, H2ARole, H2ASignature } from "./types.js";

export const H2A_COMPREHENSION_ATTESTATION_BODY_KIND =
  "comprehension-attestation" as const;

export interface H2AComprehensionAttestation {
  kind: typeof H2A_COMPREHENSION_ATTESTATION_BODY_KIND;
  subject: string;
  dossierHash: string;
  at: string;
}

export interface BuildComprehensionAttestationInput {
  subject: string;
  dossier?: unknown;
  dossierHash?: string;
  at?: string;
}

export type H2APublicKeyRing =
  | readonly string[]
  | Readonly<Record<string, string | readonly string[]>>;

const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publicKeysFor(subject: string, keyring: H2APublicKeyRing): readonly string[] {
  if (Array.isArray(keyring)) {
    return keyring.filter((key) => typeof key === "string" && key.length > 0);
  }
  const keyed = (keyring as Readonly<Record<string, string | readonly string[]>>)[subject];
  if (Array.isArray(keyed)) {
    return keyed.filter((key) => typeof key === "string" && key.length > 0);
  }
  if (typeof keyed === "string" && keyed.length > 0) {
    return [keyed];
  }
  return [];
}

function isSignature(value: unknown): value is H2ASignature {
  return (
    isRecord(value) &&
    typeof value.by === "string" &&
    typeof value.alg === "string" &&
    typeof value.value === "string"
  );
}

export function buildComprehensionAttestation(
  input: BuildComprehensionAttestationInput
): H2AComprehensionAttestation {
  const subject = input.subject.trim();
  if (subject.length === 0) {
    throw new Error("comprehension-attestation: subject is required");
  }
  const dossierHash =
    input.dossierHash ?? (input.dossier !== undefined ? computeHash(input.dossier) : undefined);
  if (typeof dossierHash !== "string" || !SHA256_HASH_PATTERN.test(dossierHash)) {
    throw new Error("comprehension-attestation: dossierHash must be a sha256:<hex> hash");
  }
  return {
    kind: H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
    subject,
    dossierHash,
    at: input.at ?? new Date().toISOString()
  };
}

export function isComprehensionAttestation(
  value: unknown
): value is H2AComprehensionAttestation {
  return (
    isRecord(value) &&
    value.kind === H2A_COMPREHENSION_ATTESTATION_BODY_KIND &&
    typeof value.subject === "string" &&
    value.subject.trim().length > 0 &&
    typeof value.dossierHash === "string" &&
    SHA256_HASH_PATTERN.test(value.dossierHash) &&
    typeof value.at === "string" &&
    value.at.length > 0
  );
}

export function canAttestComprehension(
  role: H2ARole,
  rights: readonly string[] = []
): boolean {
  const allowed = H2A_AUTHORITY_MATRIX[H2A_ATTESTER_COMPREHENSION_RIGHT].roles;
  if (!allowed.includes(role)) return false;
  if (role === "AGENTS") {
    return rights.includes(H2A_ATTESTER_COMPREHENSION_RIGHT);
  }
  return role === "PRINCIPAL" || role === "EXECUTIF" || role === "MANDATAIRE";
}

export function verifyComprehensionAttestation(
  envelope: unknown,
  publicKeys: H2APublicKeyRing
): boolean {
  try {
    if (!isRecord(envelope) || !isComprehensionAttestation(envelope.body)) {
      return false;
    }
    const typed = envelope as unknown as H2AEnvelope<H2AComprehensionAttestation>;
    const signatures = Array.isArray(typed.signatures)
      ? typed.signatures.filter(isSignature)
      : [];
    if (signatures.length === 0) {
      return false;
    }
    const subject = typed.body.subject;
    const candidates = signatures.filter((signature) => signature.by === subject);
    if (candidates.length === 0) {
      return false;
    }
    const keys = publicKeysFor(subject, publicKeys);
    if (keys.length === 0) {
      return false;
    }
    return candidates.some((signature) =>
      keys.some((publicKeyPem) => verifyCanonical(typed.body, signature, publicKeyPem))
    );
  } catch {
    return false;
  }
}

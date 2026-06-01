import { computeHash } from "./canonical.js";
import {
  isComprehensionAttestation,
  verifyComprehensionAttestation,
  type H2APublicKeyRing
} from "./comprehension-attestation.js";
import {
  derivePostureConflit,
  isH2ADeclarationInteret,
  type H2ADeclarationInteret,
  type H2APostureConflitResult
} from "./conflit-interet.js";
import {
  deriveDecisionDossier,
  type H2ADecisionDossier
} from "./decision-dossier.js";
import type { H2AJournalEntry } from "./journal.js";
import type { H2ANegotiationRecord } from "./types.js";

export const H2A_POSTURES_CONFIANCE = [
  "etablie",
  "reservee",
  "non-etablie"
] as const;

export const H2A_CONFIANCE_REASONS = [
  "attention-not-attested",
  "undisclosed-collective-conflict",
  "disclosed-collective-conflict"
] as const;

export type H2APostureConfiance = (typeof H2A_POSTURES_CONFIANCE)[number];
export type H2AConfianceReason = (typeof H2A_CONFIANCE_REASONS)[number];

export interface H2APostureConfianceResult {
  readonly postureConfiance: H2APostureConfiance;
  readonly dossierHash: string;
  readonly attentionAttested: boolean;
  readonly noUndisclosedCollectiveConflict: boolean;
  readonly missingAttestations: readonly string[];
  readonly staleAttestations: readonly string[];
  readonly undisclosedConflicts: readonly string[];
  readonly disclosedConflicts: readonly H2APostureConflitResult[];
  readonly reasons: readonly H2AConfianceReason[];
}

export interface DerivePostureConfianceInput {
  readonly record: H2ANegotiationRecord;
  readonly journal?: readonly H2AJournalEntry<unknown>[];
  readonly dossier?: H2ADecisionDossier;
  readonly declarations?: readonly H2ADeclarationInteret[];
  readonly attestations?: readonly unknown[];
  readonly publicKeys?: H2APublicKeyRing;
  readonly deciders?: readonly string[];
  readonly subjectScopes?: Readonly<Record<string, readonly string[]>>;
  readonly controleFlags?: readonly string[];
  readonly decisionScopes?: readonly string[];
  readonly now?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectDeclarations(
  journal: readonly H2AJournalEntry<unknown>[],
  explicit: readonly H2ADeclarationInteret[]
): H2ADeclarationInteret[] {
  return [
    ...journal.map((entry) => entry.body).filter(isH2ADeclarationInteret),
    ...explicit
  ];
}

function collectControleFlags(
  journal: readonly H2AJournalEntry<unknown>[],
  explicit: readonly string[]
): string[] {
  const subjects = new Set<string>();
  for (const subject of explicit) {
    if (subject.length > 0) subjects.add(subject);
  }
  for (const entry of journal) {
    if (entry.actor.role !== "CONTROL") continue;
    const body = isRecord(entry.body) ? entry.body : undefined;
    if (!body) continue;
    const subject = body.subject;
    if (typeof subject !== "string" || subject.length === 0) continue;
    if (
      body.kind === "postureConflit" ||
      body.kind === "conflitInteret" ||
      body.postureConflit === "conflit-declarable" ||
      body.conflitInteret === true
    ) {
      subjects.add(subject);
    }
  }
  return [...subjects].sort();
}

function collectAttestations(
  journal: readonly H2AJournalEntry<unknown>[],
  explicit: readonly unknown[]
): unknown[] {
  return [
    ...journal.filter((entry) => isComprehensionAttestation(entry.body)),
    ...explicit
  ];
}

function hasDeclaration(
  subject: string,
  declarations: readonly H2ADeclarationInteret[]
): boolean {
  return declarations.some(
    (declaration) => declaration.subject === subject && declaration.interets.length > 0
  );
}

function validAttestation(
  attestation: unknown,
  subject: string,
  publicKeys: H2APublicKeyRing
): boolean {
  if (!isRecord(attestation) || !isComprehensionAttestation(attestation.body)) {
    return false;
  }
  if (attestation.body.subject !== subject) return false;
  return verifyComprehensionAttestation(attestation, publicKeys);
}

function attestationDossierHash(attestation: unknown): string | undefined {
  if (!isRecord(attestation) || !isComprehensionAttestation(attestation.body)) {
    return undefined;
  }
  return attestation.body.dossierHash;
}

export function derivePostureConfiance(
  input: DerivePostureConfianceInput
): H2APostureConfianceResult {
  const journal = input.journal ?? [];
  const declarations = collectDeclarations(journal, input.declarations ?? []);
  const controleFlags = collectControleFlags(journal, input.controleFlags ?? []);
  const dossier =
    input.dossier ??
    deriveDecisionDossier({
      record: input.record,
      journal,
      declarations,
      subjectScopes: input.subjectScopes,
      controleFlags,
      now: input.now
    });
  const dossierHash = computeHash(dossier);
  const deciders = [...(input.deciders ?? input.record.requiredSigners ?? [])].sort();
  const keyring: H2APublicKeyRing = input.publicKeys ?? {};
  const attestations = collectAttestations(journal, input.attestations ?? []);

  const missingAttestations: string[] = [];
  const staleAttestations: string[] = [];
  for (const decider of deciders) {
    const validForSubject = attestations.filter((attestation) =>
      validAttestation(attestation, decider, keyring)
    );
    const hasCurrent = validForSubject.some(
      (attestation) => attestationDossierHash(attestation) === dossierHash
    );
    if (!hasCurrent) missingAttestations.push(decider);
    if (
      !hasCurrent &&
      validForSubject.some((attestation) => attestationDossierHash(attestation) !== dossierHash)
    ) {
      staleAttestations.push(decider);
    }
  }

  const disclosedConflicts: H2APostureConflitResult[] = [];
  const undisclosedConflicts: string[] = [];
  for (const decider of deciders) {
    const declared = hasDeclaration(decider, declarations);
    const controlFlagged = controleFlags.includes(decider);
    const posture = derivePostureConflit(decider, {
      declarations,
      ownScopes: input.subjectScopes?.[decider] ?? [],
      decisionScopes: input.decisionScopes ?? [input.record.scope],
      signers: input.record.requiredSigners ?? [],
      controleFlags
    });

    if (posture.postureConflit === "conflit-declarable" && declared) {
      disclosedConflicts.push(posture);
      continue;
    }
    if ((posture.postureConflit === "conflit-declarable" || controlFlagged) && !declared) {
      undisclosedConflicts.push(decider);
    }
  }

  const attentionAttested = missingAttestations.length === 0;
  const noUndisclosedCollectiveConflict = undisclosedConflicts.length === 0;
  const reasons: H2AConfianceReason[] = [];
  if (!attentionAttested) reasons.push("attention-not-attested");
  if (!noUndisclosedCollectiveConflict) {
    reasons.push("undisclosed-collective-conflict");
  }
  if (disclosedConflicts.length > 0) reasons.push("disclosed-collective-conflict");

  const postureConfiance: H2APostureConfiance =
    !attentionAttested || !noUndisclosedCollectiveConflict
      ? "non-etablie"
      : disclosedConflicts.length > 0
        ? "reservee"
        : "etablie";

  return {
    postureConfiance,
    dossierHash,
    attentionAttested,
    noUndisclosedCollectiveConflict,
    missingAttestations,
    staleAttestations,
    undisclosedConflicts,
    disclosedConflicts,
    reasons
  };
}

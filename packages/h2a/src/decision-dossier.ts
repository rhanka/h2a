import { computeHash } from "./canonical.js";
import {
  derivePostureConflit,
  isH2ADeclarationInteret,
  type H2ADeclarationInteret,
  type H2APostureConflit,
  type H2APostureConflitContext,
  type H2APostureConflitResult
} from "./conflit-interet.js";
import type { H2AJournalEntry } from "./journal.js";
import type { H2ANegotiationRecord } from "./types.js";

export const H2A_DECISION_DOSSIER_KIND = "decision-dossier" as const;

export const H2A_DECISION_DOSSIER_RANK_REASONS = [
  "conflit-declarable",
  "masque-impact-collectif",
  "amends-signed-artifact",
  "cross-scope-aval",
  "missing-success-criteria"
] as const;

export type H2ADecisionDossierRankReason =
  (typeof H2A_DECISION_DOSSIER_RANK_REASONS)[number];

export interface H2ADecisionDossierItem {
  readonly subject: string;
  readonly rank: number;
  readonly reasons: readonly H2ADecisionDossierRankReason[];
  readonly postureConflit: H2APostureConflit;
  readonly criteres: H2APostureConflitResult["criteres"];
  readonly disclosureMode: H2APostureConflitResult["disclosureMode"];
  readonly masqueImpactCollectif: boolean;
  readonly crossScopeAval: boolean;
  readonly amendsSignedArtifact: boolean;
  readonly missingSuccessCriteria: boolean;
}

export interface H2ADecisionDossier {
  readonly kind: typeof H2A_DECISION_DOSSIER_KIND;
  readonly negotiationId: string;
  readonly scope: string;
  readonly artifactHash?: string;
  readonly subjects: readonly string[];
  readonly rankReasons: typeof H2A_DECISION_DOSSIER_RANK_REASONS;
  readonly items: readonly H2ADecisionDossierItem[];
  readonly generatedAt?: string;
}

export interface DeriveDecisionDossierInput {
  readonly record: H2ANegotiationRecord;
  readonly journal?: readonly H2AJournalEntry<unknown>[];
  readonly declarations?: readonly H2ADeclarationInteret[];
  readonly subjectScopes?: Readonly<Record<string, readonly string[]>>;
  readonly controleFlags?: readonly string[];
  readonly now?: string;
}

export interface H2APresenterBias {
  readonly subject: string;
  readonly biased: boolean;
  readonly posture: H2APostureConflitResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyRecord(entry: H2AJournalEntry<unknown>): Record<string, unknown> | undefined {
  return isRecord(entry.body) ? entry.body : undefined;
}

function artifactFromEntry(entry: H2AJournalEntry<unknown>): unknown {
  const body = bodyRecord(entry);
  if (!body || !("artifact" in body)) return undefined;
  return body.artifact;
}

function artifactHash(artifact: unknown): string | undefined {
  return artifact === undefined ? undefined : computeHash(artifact);
}

function currentArtifact(
  record: H2ANegotiationRecord,
  journal: readonly H2AJournalEntry<unknown>[]
): unknown {
  if (record.currentArtifactHash) {
    for (let i = journal.length - 1; i >= 0; i--) {
      const artifact = artifactFromEntry(journal[i]);
      if (artifact !== undefined && artifactHash(artifact) === record.currentArtifactHash) {
        return artifact;
      }
    }
  }

  for (let i = journal.length - 1; i >= 0; i--) {
    const artifact = artifactFromEntry(journal[i]);
    if (artifact !== undefined) return artifact;
  }
  return undefined;
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
    const body = bodyRecord(entry);
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

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0) target.add(value);
}

function decisionScopes(
  record: H2ANegotiationRecord,
  artifact: unknown
): readonly string[] {
  const scopes = new Set<string>();
  addString(scopes, record.scope);
  const artifactRecord = isRecord(artifact) ? artifact : undefined;
  if (artifactRecord) {
    addString(scopes, artifactRecord.scope);
    addString(scopes, artifactRecord.aval);
    addString(scopes, artifactRecord.scopeAval);
  }
  return [...scopes].sort();
}

function artifactHasCrossScopeAval(artifact: unknown): boolean {
  const artifactRecord = isRecord(artifact) ? artifact : undefined;
  return typeof artifactRecord?.aval === "string" && artifactRecord.aval.length > 0;
}

function artifactAmendsSignedArtifact(artifact: unknown): boolean {
  const artifactRecord = isRecord(artifact) ? artifact : undefined;
  return (
    artifactRecord?.kind === "AMENDMENT" &&
    typeof artifactRecord.baseArtifactHash === "string" &&
    artifactRecord.baseArtifactHash.length > 0
  );
}

function artifactMissingSuccessCriteria(artifact: unknown): boolean {
  const artifactRecord = isRecord(artifact) ? artifact : undefined;
  if (artifactRecord?.kind !== "ENGAGEMENT") return false;
  const successCriteria = artifactRecord.successCriteria;
  return !Array.isArray(successCriteria) || successCriteria.length === 0;
}

function orderedReasons(
  flags: Readonly<Record<H2ADecisionDossierRankReason, boolean>>
): H2ADecisionDossierRankReason[] {
  return H2A_DECISION_DOSSIER_RANK_REASONS.filter((reason) => flags[reason]);
}

function compareReasonVectors(
  a: readonly H2ADecisionDossierRankReason[],
  b: readonly H2ADecisionDossierRankReason[]
): number {
  for (const reason of H2A_DECISION_DOSSIER_RANK_REASONS) {
    const aHas = a.includes(reason);
    const bHas = b.includes(reason);
    if (aHas !== bHas) return aHas ? -1 : 1;
  }
  return 0;
}

export function deriveDecisionDossier(
  input: DeriveDecisionDossierInput
): H2ADecisionDossier {
  const journal = input.journal ?? [];
  const declarations = collectDeclarations(journal, input.declarations ?? []);
  const controleFlags = collectControleFlags(journal, input.controleFlags ?? []);
  const artifact = currentArtifact(input.record, journal);
  const currentArtifactHash = artifactHash(artifact);
  const scopes = decisionScopes(input.record, artifact);
  const crossScopeAval = artifactHasCrossScopeAval(artifact);
  const amendsSignedArtifact = artifactAmendsSignedArtifact(artifact);
  const missingSuccessCriteria = artifactMissingSuccessCriteria(artifact);

  const subjects = new Set<string>();
  for (const signer of input.record.requiredSigners ?? []) subjects.add(signer);
  for (const declaration of declarations) subjects.add(declaration.subject);
  for (const subject of controleFlags) subjects.add(subject);

  const unrated = [...subjects].sort().map((subject) => {
    const posture = derivePostureConflit(subject, {
      declarations,
      ownScopes: input.subjectScopes?.[subject] ?? [],
      decisionScopes: scopes,
      signers: input.record.requiredSigners ?? [],
      controleFlags
    });
    const reasons = orderedReasons({
      "conflit-declarable": posture.postureConflit === "conflit-declarable",
      "masque-impact-collectif": posture.masqueImpactCollectif,
      "amends-signed-artifact": amendsSignedArtifact,
      "cross-scope-aval": crossScopeAval,
      "missing-success-criteria": missingSuccessCriteria
    });
    return {
      subject,
      rank: 0,
      reasons,
      postureConflit: posture.postureConflit,
      criteres: posture.criteres,
      disclosureMode: posture.disclosureMode,
      masqueImpactCollectif: posture.masqueImpactCollectif,
      crossScopeAval,
      amendsSignedArtifact,
      missingSuccessCriteria
    };
  });

  const ranked = unrated
    .sort((a, b) => {
      const countDelta = b.reasons.length - a.reasons.length;
      if (countDelta !== 0) return countDelta;
      const vectorDelta = compareReasonVectors(a.reasons, b.reasons);
      if (vectorDelta !== 0) return vectorDelta;
      return a.subject.localeCompare(b.subject);
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));

  return {
    kind: H2A_DECISION_DOSSIER_KIND,
    negotiationId: input.record.id,
    scope: input.record.scope,
    artifactHash: currentArtifactHash,
    subjects: [...subjects].sort(),
    rankReasons: H2A_DECISION_DOSSIER_RANK_REASONS,
    items: ranked,
    ...(input.now ? { generatedAt: input.now } : {})
  };
}

export function evaluatePresenterBias(
  presenter: string,
  context: H2APostureConflitContext = {}
): H2APresenterBias {
  const posture = derivePostureConflit(presenter, context);
  return {
    subject: presenter,
    biased: posture.postureConflit === "conflit-declarable",
    posture
  };
}

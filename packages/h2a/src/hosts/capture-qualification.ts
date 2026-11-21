import { readFileSync } from "node:fs";

export const QUALIFIED_CLIS = ["claude", "codex", "gemini", "vibe", "agy", "muse"] as const;
export type QualifiedCli = (typeof QUALIFIED_CLIS)[number];

export type HookConfigLevel = "project" | "user";
export type MessageCaptureMode = "direct" | "deferred" | "not-covered";
export type CaptureModeResult = MessageCaptureMode | "unqualified";
export type NativeQuestionCapture = "hooked" | "gap";

export type HumanSessionEvidence =
  | "none"
  | {
      readonly source: "env" | "payload";
      readonly name: string;
      readonly interactiveValue: string;
    };

export type SubAgentMarker =
  | "never-fires"
  | "none"
  | {
      readonly source: "payload";
      readonly path: string;
      readonly rule: "non-null" | "true" | "present";
    };

export interface TranscriptEvidence {
  readonly readable: boolean;
  readonly location: string | null;
  readonly format: string | null;
}

export interface CaptureQualificationEntry {
  readonly cli: QualifiedCli;
  readonly cliVersion: string;
  readonly qualifiedOn: string;
  readonly hookPoint: string | null;
  readonly hookConfigLevel: HookConfigLevel;
  readonly messageCapture: MessageCaptureMode;
  readonly witnessSentDigest: string | null;
  readonly witnessReceivedDigest: string | null;
  readonly payloadTextKey: string | null;
  readonly payloadSessionKey: string | null;
  readonly payloadFolderKey: string | null;
  readonly payloadTranscriptKey: string | null;
  readonly humanSessionEvidence: HumanSessionEvidence;
  readonly subAgentMarker: SubAgentMarker;
  readonly transcript: TranscriptEvidence;
  readonly nativeQuestionCapture: NativeQuestionCapture;
  readonly questionPayloadShape: string;
  readonly reason: string;
  readonly evidence: string;
}

export interface CaptureQualificationTable {
  readonly schema: 1;
  readonly entries: readonly CaptureQualificationEntry[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVIDENCE_PREFIX = "docs/plan/track-owner-table-3q/evidence/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function assertHumanSessionEvidence(value: unknown, label: string): HumanSessionEvidence {
  if (value === "none") return "none";
  if (!isRecord(value)) throw new Error(`${label}: humanSessionEvidence must be "none" or an object`);
  if (value.source !== "env" && value.source !== "payload") {
    throw new Error(`${label}: humanSessionEvidence.source must be "env" or "payload"`);
  }
  if (!isNonEmptyString(value.name) || !isNonEmptyString(value.interactiveValue)) {
    throw new Error(`${label}: humanSessionEvidence requires non-empty name and interactiveValue`);
  }
  return { source: value.source, name: value.name, interactiveValue: value.interactiveValue };
}

function assertSubAgentMarker(value: unknown, label: string): SubAgentMarker {
  if (value === "never-fires" || value === "none") return value;
  if (!isRecord(value)) throw new Error(`${label}: subAgentMarker must be "never-fires", "none", or a payload rule`);
  if (value.source !== "payload") throw new Error(`${label}: subAgentMarker.source must be "payload"`);
  if (!isNonEmptyString(value.path)) throw new Error(`${label}: subAgentMarker.path must be a non-empty string`);
  if (value.rule !== "non-null" && value.rule !== "true" && value.rule !== "present") {
    throw new Error(`${label}: subAgentMarker.rule must be "non-null", "true", or "present"`);
  }
  return { source: "payload", path: value.path, rule: value.rule };
}

function assertTranscript(value: unknown, label: string): TranscriptEvidence {
  if (!isRecord(value)) throw new Error(`${label}: transcript must be an object`);
  if (typeof value.readable !== "boolean") throw new Error(`${label}: transcript.readable must be boolean`);
  if (!isNullableString(value.location) || !isNullableString(value.format)) {
    throw new Error(`${label}: transcript.location and transcript.format must be string or null`);
  }
  return { readable: value.readable, location: value.location, format: value.format };
}

function assertDigest(value: unknown, field: string, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new Error(`${label}: ${field} must be null or a 64-char lowercase hex sha256 digest`);
  }
  return value;
}

export function validateCaptureQualification(raw: unknown): CaptureQualificationTable {
  if (!isRecord(raw) || raw.schema !== 1 || !Array.isArray(raw.entries)) {
    throw new Error("capture qualification table incompatible: expected { schema: 1, entries: [...] }");
  }
  const seen = new Set<string>();
  const entries: CaptureQualificationEntry[] = [];
  for (const item of raw.entries) {
    if (!isRecord(item)) throw new Error("capture qualification entry must be an object");
    if (typeof item.cli !== "string" || !(QUALIFIED_CLIS as readonly string[]).includes(item.cli)) {
      throw new Error(`capture qualification entry has unknown cli "${String(item.cli)}"`);
    }
    const cli = item.cli as QualifiedCli;
    if (!isNonEmptyString(item.cliVersion)) throw new Error(`${cli}: cliVersion must be a non-empty string`);
    const label = `${cli}@${item.cliVersion}`;
    if (seen.has(label)) throw new Error(`duplicate capture qualification entry for ${label}`);
    seen.add(label);

    if (typeof item.qualifiedOn !== "string" || !ISO_DATE.test(item.qualifiedOn)) {
      throw new Error(`${label}: qualifiedOn must be YYYY-MM-DD`);
    }
    if (!isNullableString(item.hookPoint)) throw new Error(`${label}: hookPoint must be string or null`);
    if (item.hookConfigLevel !== "project" && item.hookConfigLevel !== "user") {
      throw new Error(`${label}: hookConfigLevel must be "project" or "user"`);
    }
    if (
      item.messageCapture !== "direct" &&
      item.messageCapture !== "deferred" &&
      item.messageCapture !== "not-covered"
    ) {
      throw new Error(`${label}: messageCapture must be "direct", "deferred", or "not-covered"`);
    }

    const witnessSentDigest = assertDigest(item.witnessSentDigest, "witnessSentDigest", label);
    const witnessReceivedDigest = assertDigest(item.witnessReceivedDigest, "witnessReceivedDigest", label);

    for (const key of ["payloadTextKey", "payloadSessionKey", "payloadFolderKey", "payloadTranscriptKey"] as const) {
      if (!isNullableString(item[key])) throw new Error(`${label}: ${key} must be string or null`);
    }

    const humanSessionEvidence = assertHumanSessionEvidence(item.humanSessionEvidence, label);
    const subAgentMarker = assertSubAgentMarker(item.subAgentMarker, label);
    const transcript = assertTranscript(item.transcript, label);

    if (item.nativeQuestionCapture !== "hooked" && item.nativeQuestionCapture !== "gap") {
      throw new Error(`${label}: nativeQuestionCapture must be "hooked" or "gap"`);
    }
    if (!isNonEmptyString(item.questionPayloadShape)) {
      throw new Error(`${label}: questionPayloadShape must be a non-empty string`);
    }
    if (!isNonEmptyString(item.reason)) throw new Error(`${label}: reason must be a non-empty string`);
    if (typeof item.evidence !== "string" || !item.evidence.startsWith(EVIDENCE_PREFIX) || item.evidence.includes("..")) {
      throw new Error(`${label}: evidence must be a path under ${EVIDENCE_PREFIX}`);
    }

    if (item.messageCapture === "direct") {
      if (!witnessSentDigest || !witnessReceivedDigest || witnessSentDigest !== witnessReceivedDigest) {
        throw new Error(`${label}: direct classification refused because witness digests are missing or differ`);
      }
      if (subAgentMarker === "none") {
        throw new Error(`${label}: direct classification refused because subAgentMarker is "none"`);
      }
      if (!isNonEmptyString(item.payloadTextKey)) {
        throw new Error(`${label}: direct classification refused because payloadTextKey is missing`);
      }
    }

    entries.push({
      cli,
      cliVersion: item.cliVersion,
      qualifiedOn: item.qualifiedOn,
      hookPoint: item.hookPoint as string | null,
      hookConfigLevel: item.hookConfigLevel,
      messageCapture: item.messageCapture,
      witnessSentDigest,
      witnessReceivedDigest,
      payloadTextKey: item.payloadTextKey as string | null,
      payloadSessionKey: item.payloadSessionKey as string | null,
      payloadFolderKey: item.payloadFolderKey as string | null,
      payloadTranscriptKey: item.payloadTranscriptKey as string | null,
      humanSessionEvidence,
      subAgentMarker,
      transcript,
      nativeQuestionCapture: item.nativeQuestionCapture,
      questionPayloadShape: item.questionPayloadShape,
      reason: item.reason,
      evidence: item.evidence
    });
  }
  return { schema: 1, entries };
}

let cached: CaptureQualificationTable | undefined;

export function loadCaptureQualification(options: { readonly reload?: boolean } = {}): CaptureQualificationTable {
  if (!cached || options.reload) {
    const raw = JSON.parse(
      readFileSync(new URL("../../fixtures/capture-qualification.json", import.meta.url), "utf8")
    ) as unknown;
    cached = validateCaptureQualification(raw);
  }
  return cached;
}

export function findCaptureQualification(
  cli: string,
  version: string,
  table: CaptureQualificationTable = loadCaptureQualification()
): CaptureQualificationEntry | undefined {
  return table.entries.find((entry) => entry.cli === cli && entry.cliVersion === version);
}

export function captureModeFor(
  cli: string,
  version: string,
  table: CaptureQualificationTable = loadCaptureQualification()
): CaptureModeResult {
  const entry = findCaptureQualification(cli, version, table);
  return entry ? entry.messageCapture : "unqualified";
}

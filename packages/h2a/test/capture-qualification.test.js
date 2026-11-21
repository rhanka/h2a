import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  sanitizeCaptureEvidence,
  sanitizeEvidenceDocument,
  scanEvidenceForLeaks
} from "../scripts/qualification-capture.mjs";

const FIXTURE_URL = new URL("../fixtures/capture-qualification.json", import.meta.url);
const LOADER_URL = new URL("../dist/hosts/capture-qualification.js", import.meta.url);
const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/plan/track-owner-table-3q/evidence");
const EXPECTED_CLIS = ["claude", "codex", "gemini", "vibe", "agy", "muse"];
const HEX64 = /^[0-9a-f]{64}$/;

function readRawFixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8"));
}

async function loadModule() {
  return import(LOADER_URL.href);
}

test("a CLI is classified direct only when its recorded witness phrase is byte-identical at the hook output and a sub-agent call can be told apart (T3q-a)", async () => {
  const raw = readRawFixture();
  const { validateCaptureQualification, captureModeFor } = await loadModule();
  const table = validateCaptureQualification(raw);

  for (const entry of table.entries) {
    if (entry.messageCapture === "direct") {
      assert.match(entry.witnessSentDigest ?? "", HEX64, `${entry.cli}: witnessSentDigest must be sha256 hex`);
      assert.match(entry.witnessReceivedDigest ?? "", HEX64, `${entry.cli}: witnessReceivedDigest must be sha256 hex`);
      assert.equal(
        entry.witnessReceivedDigest,
        entry.witnessSentDigest,
        `${entry.cli}: direct requires byte-identical witness digests`
      );
      assert.ok(
        typeof entry.payloadTextKey === "string" && entry.payloadTextKey.length > 0,
        `${entry.cli}: direct requires a payloadTextKey`
      );
      assert.notEqual(
        entry.subAgentMarker,
        "none",
        `${entry.cli}: direct requires sub-agent differentiation (never-fires or payload marker)`
      );
    }
  }

  // Validator must refuse direct entries with mismatched digests or subAgentMarker: "none".
  const mismatched = structuredClone(raw);
  mismatched.entries[0] = {
    ...mismatched.entries[0],
    messageCapture: "direct",
    witnessSentDigest: "a".repeat(64),
    witnessReceivedDigest: "b".repeat(64),
    payloadTextKey: "prompt",
    subAgentMarker: "never-fires"
  };
  assert.throws(
    () => validateCaptureQualification(mismatched),
    /digest/i,
    "validator must refuse a direct entry whose witness digests differ"
  );

  const noSubAgentMarker = structuredClone(raw);
  noSubAgentMarker.entries[0] = {
    ...noSubAgentMarker.entries[0],
    messageCapture: "direct",
    witnessSentDigest: "a".repeat(64),
    witnessReceivedDigest: "a".repeat(64),
    payloadTextKey: "prompt",
    subAgentMarker: "none"
  };
  assert.throws(
    () => validateCaptureQualification(noSubAgentMarker),
    /sub-?agent/i,
    "validator must refuse a direct entry with subAgentMarker: none"
  );

  // Unqualified versions must never be treated as direct.
  for (const cli of EXPECTED_CLIS) {
    assert.equal(captureModeFor(cli, "0.0.0-unqualified", table), "unqualified");
  }
});

test("a CLI whose delivery is not proven is classified deferred or not covered, with its reason (T3q-b)", async () => {
  const raw = readRawFixture();
  const { validateCaptureQualification, captureModeFor } = await loadModule();
  const table = validateCaptureQualification(raw);

  const byCli = new Map(table.entries.map((entry) => [entry.cli, entry]));
  for (const cli of EXPECTED_CLIS) {
    assert.ok(byCli.has(cli), `missing qualification entry for CLI ${cli}`);
  }
  assert.equal(table.entries.length, EXPECTED_CLIS.length, "expected exactly the six CLIs");

  for (const entry of table.entries) {
    assert.ok(typeof entry.cliVersion === "string" && entry.cliVersion.length > 0, `${entry.cli}: cliVersion required`);
    assert.ok(typeof entry.qualifiedOn === "string" && entry.qualifiedOn.length > 0, `${entry.cli}: qualifiedOn required`);
    assert.ok(["project", "user"].includes(entry.hookConfigLevel), `${entry.cli}: hookConfigLevel must be project or user`);
    assert.ok(
      ["direct", "deferred", "not-covered"].includes(entry.messageCapture),
      `${entry.cli}: invalid messageCapture ${entry.messageCapture}`
    );
    assert.ok(typeof entry.reason === "string" && entry.reason.trim().length > 0, `${entry.cli}: reason required`);
    assert.ok(
      typeof entry.evidence === "string" && entry.evidence.startsWith("docs/plan/track-owner-table-3q/evidence/"),
      `${entry.cli}: evidence must live under docs/plan/track-owner-table-3q/evidence/`
    );

    const digestsMatch =
      typeof entry.witnessSentDigest === "string" &&
      HEX64.test(entry.witnessSentDigest) &&
      entry.witnessSentDigest === entry.witnessReceivedDigest;
    const subAgentDifferentiated = entry.subAgentMarker !== "none";

    if (!digestsMatch || !subAgentDifferentiated) {
      assert.ok(
        entry.messageCapture === "deferred" || entry.messageCapture === "not-covered",
        `${entry.cli}: unproven delivery must be deferred or not-covered, got ${entry.messageCapture}`
      );
    }

    if (entry.reason !== "not yet probed") {
      const evidenceAbs = resolve(REPO_ROOT, entry.evidence);
      assert.ok(existsSync(evidenceAbs), `${entry.cli}: evidence file missing at ${entry.evidence}`);
    }

    assert.equal(captureModeFor(entry.cli, entry.cliVersion, table), entry.messageCapture);
  }
});

test("native question capture is qualified per CLI or recorded as a gap, with the payload shape observed (T3q-c)", async () => {
  const raw = readRawFixture();
  const { validateCaptureQualification } = await loadModule();
  const table = validateCaptureQualification(raw);

  const byCli = new Map(table.entries.map((entry) => [entry.cli, entry]));
  for (const cli of EXPECTED_CLIS) {
    const entry = byCli.get(cli);
    assert.ok(entry, `missing entry for ${cli}`);
    assert.ok(
      entry.nativeQuestionCapture === "hooked" || entry.nativeQuestionCapture === "gap",
      `${cli}: nativeQuestionCapture must be hooked or gap`
    );
    assert.ok(
      typeof entry.questionPayloadShape === "string" && entry.questionPayloadShape.trim().length > 0,
      `${cli}: questionPayloadShape must describe what the tool-call hook receives or why it is a gap`
    );
    assert.equal(typeof entry.transcript.readable, "boolean", `${cli}: transcript.readable must be boolean`);
  }
});

test("all evidence/*.json files match capture-qualification.json, are deterministically sanitized, and contain zero leaks (C1/C3)", async () => {
  const raw = readRawFixture();
  const { validateCaptureQualification } = await loadModule();
  const table = validateCaptureQualification(raw);

  const onDiskFiles = readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.deepEqual(
    onDiskFiles,
    EXPECTED_CLIS.map((cli) => `${cli}.json`).sort(),
    "evidence directory must contain exactly the six CLI JSON files"
  );

  for (const entry of table.entries) {
    const evidenceAbs = resolve(REPO_ROOT, entry.evidence);
    assert.ok(existsSync(evidenceAbs), `${entry.cli}: evidence file missing at ${entry.evidence}`);
    const rawText = readFileSync(evidenceAbs, "utf8");
    const doc = JSON.parse(rawText);

    // Consistency between fixture and evidence file.
    assert.equal(doc.schema, 1, `${entry.cli}: evidence schema must be 1`);
    assert.equal(doc.cli, entry.cli, `${entry.cli}: evidence cli mismatch`);
    assert.equal(doc.cliVersion, entry.cliVersion, `${entry.cli}: evidence cliVersion mismatch`);
    assert.equal(doc.qualifiedOn, entry.qualifiedOn, `${entry.cli}: evidence qualifiedOn mismatch`);
    assert.equal(doc.hookPoint, entry.hookPoint, `${entry.cli}: evidence hookPoint mismatch`);
    assert.equal(doc.hookConfigLevel, entry.hookConfigLevel, `${entry.cli}: evidence hookConfigLevel mismatch`);
    assert.equal(doc.classification, entry.messageCapture, `${entry.cli}: evidence classification mismatch`);
    assert.equal(
      doc.witnessProbe?.sentDigest,
      entry.witnessSentDigest,
      `${entry.cli}: evidence witnessProbe.sentDigest must match fixture witnessSentDigest`
    );
    assert.equal(
      doc.witnessProbe?.receivedDigest,
      entry.witnessReceivedDigest,
      `${entry.cli}: evidence witnessProbe.receivedDigest must match fixture witnessReceivedDigest`
    );
    assert.equal(doc.witnessProbe?.sentBytes, 92, `${entry.cli}: witness phrase must be the agreed 92-byte synthetic witness`);
    assert.equal(doc.witnessProbe?.receivedBytes, 92, `${entry.cli}: receivedBytes must match the agreed 92-byte witness`);
    assert.equal(doc.witnessProbe?.payloadTextKey, entry.payloadTextKey, `${entry.cli}: payloadTextKey mismatch`);
    assert.equal(doc.witnessProbe?.payloadSessionKey, entry.payloadSessionKey, `${entry.cli}: payloadSessionKey mismatch`);
    assert.equal(doc.witnessProbe?.payloadFolderKey, entry.payloadFolderKey, `${entry.cli}: payloadFolderKey mismatch`);
    assert.equal(doc.witnessProbe?.payloadTranscriptKey, entry.payloadTranscriptKey, `${entry.cli}: payloadTranscriptKey mismatch`);
    assert.equal(doc.transcriptProbe?.readable, entry.transcript.readable, `${entry.cli}: transcript.readable mismatch`);
    assert.equal(doc.transcriptProbe?.location, entry.transcript.location, `${entry.cli}: transcript.location mismatch`);
    assert.equal(doc.transcriptProbe?.format, entry.transcript.format, `${entry.cli}: transcript.format mismatch`);
    assert.equal(
      doc.nativeQuestionProbe?.nativeQuestionCapture,
      entry.nativeQuestionCapture,
      `${entry.cli}: nativeQuestionCapture mismatch`
    );
    assert.deepEqual(doc.subAgentProbe?.subAgentMarker, entry.subAgentMarker, `${entry.cli}: subAgentMarker mismatch`);
    assert.deepEqual(
      doc.interactiveVsHeadless?.selectedHumanSessionEvidence,
      entry.humanSessionEvidence,
      `${entry.cli}: humanSessionEvidence mismatch`
    );

    // Deterministic sanitizer provenance and idempotence.
    assert.equal(
      doc.sanitization?.method,
      "packages/h2a/scripts/qualification-capture.mjs#sanitizeCaptureEvidence",
      `${entry.cli}: evidence must be generated by sanitizeCaptureEvidence`
    );
    assert.equal(doc.sanitization?.version, 1, `${entry.cli}: evidence sanitization version must be 1`);
    const reSanitized = sanitizeEvidenceDocument(doc, { cli: entry.cli });
    assert.deepEqual(reSanitized, doc, `${entry.cli}: evidence must be idempotent under sanitizeEvidenceDocument`);
    assert.deepEqual(
      sanitizeCaptureEvidence(doc, { cli: entry.cli }),
      doc,
      `${entry.cli}: evidence must be idempotent under sanitizeCaptureEvidence`
    );
    assert.equal(
      JSON.stringify(reSanitized, null, 2) + "\n",
      rawText,
      `${entry.cli}: evidence file on disk must match canonical output of sanitizeEvidenceDocument`
    );

    // Zero-leak scan across secrets, home paths, UUIDs, emails, internal hosts, and non-agreed message text.
    const scan = scanEvidenceForLeaks(doc);
    assert.equal(
      scan.ok,
      true,
      `${entry.cli}: evidence failed anti-leak scan: ${JSON.stringify(scan.findings)}`
    );
  }

  // Verify the anti-leak scanner catches every forbidden class (fails on any hit).
  const baseline = JSON.parse(readFileSync(resolve(EVIDENCE_DIR, "claude.json"), "utf8"));
  const syntheticLeaks = [
    ["home-path", (d) => { d.reason = "failed at /home/alice/.vibe/logs/vibe.log"; }],
    ["home-path-macos", (d) => { d.reason = "failed at /Users/bob/src/client-repo"; }],
    ["home-path-slug", (d) => { d.transcriptProbe.location = "~/.claude/projects/-home-alice-repo/s.jsonl"; }],
    ["tmp-path", (d) => { d.projectConfigPath = "/tmp/h2a-3q-claude-abc/.claude/settings.json"; }],
    ["raw-uuid", (d) => { d.transcriptProbe.location = "~/.claude/projects/<encoded-cwd>/123e4567-e89b-12d3-a456-426614174000.jsonl"; }],
    ["secret-github", (d) => { d.reason = "leaked ghp_1234567890abcdef1234567890abcdef1234"; }],
    ["secret-provider-sk", (d) => { d.reason = "leaked sk-ant-api03-abcdefghijklmnopqrstuvwx123456"; }],
    ["secret-aws", (d) => { d.reason = "leaked AKIAIOSFODNN7EXAMPLE"; }],
    ["secret-pem", (d) => { d.reason = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"; }],
    ["secret-bearer", (d) => { d.reason = "Authorization: Bearer supersecretvalue123456"; }],
    ["secret-url-creds", (d) => { d.reason = "https://alice:hunter2@proxy.example.com/v1"; }],
    ["email", (d) => { d.reason = "contact owner@example.com for details"; }],
    ["internal-host", (d) => { d.reason = "connected to api.prod.internal at 10.24.0.8"; }],
    ["raw-message-key", (d) => { d.witnessProbe.receivedText = "real owner message text"; }],
    ["raw-prompt-key", (d) => { d.witnessProbe.prompt = "non-agreed owner prompt"; }],
    ["raw-witness-text", (d) => { d.reason = "h2a-3q-witness-deadbeef: raw witness phrase"; }],
    ["non-agreed-witness-bytes", (d) => { d.witnessProbe.sentBytes = 250; }],
    ["attribution-trailer", (d) => { d.reason = "Co-Authored-By: Bot <bot@example.com>"; }]
  ];

  for (const [label, mutate] of syntheticLeaks) {
    const dirty = structuredClone(baseline);
    mutate(dirty);
    const res = scanEvidenceForLeaks(dirty);
    assert.equal(res.ok, false, `anti-leak scanner must fail on synthetic case: ${label}`);
    assert.ok(res.findings.length > 0, `expected findings for synthetic case: ${label}`);
  }
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FIXTURE_URL = new URL("../fixtures/capture-qualification.json", import.meta.url);
const LOADER_URL = new URL("../dist/hosts/capture-qualification.js", import.meta.url);
const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
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

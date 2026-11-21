import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildWitnessPhrase,
  compareWitnessBytes,
  diffInteractiveVsHeadless,
  runCaptureProbe,
  scanTranscriptForWitness
} from "../scripts/qualification-capture.mjs";

function createStandInCli(dir, { alterByte = false } = {}) {
  const scriptPath = join(dir, "standin-cli.mjs");
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const configPath = process.argv[2];
let witness = process.argv[3];
if (${JSON.stringify(alterByte)}) {
  witness = witness.slice(0, -1) + (witness.endsWith("X") ? "Y" : "X");
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const cmd = cfg.hooks.UserPromptSubmit[0].command;
const payload = {
  session_id: "standin-session-1",
  cwd: process.cwd(),
  transcript_path: process.cwd() + "/transcript.jsonl",
  prompt: witness,
  parent_session_id: null
};
const res = spawnSync(cmd, { shell: true, input: JSON.stringify(payload), encoding: "utf8" });
process.stdout.write(res.stdout || "");
process.exit(res.status ?? 0);
`,
    { mode: 0o755 }
  );
  return scriptPath;
}

test("probe harness verifies byte-identical witness delivery against a stand-in CLI and detects a single changed byte", (t) => {
  const workDir = mkdtempSync(join(tmpdir(), "h2a-3q-standin-"));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const witness = buildWitnessPhrase("fixed01");
  assert.match(witness, /café/);
  assert.match(witness, /\n/);
  assert.match(witness, /"quoted"/);
  assert.match(witness, /'single'/);
  assert.match(witness, /\\/);
  assert.match(witness, /日本語/);

  const faithfulCli = createStandInCli(workDir, { alterByte: false });
  const exactRun = runCaptureProbe({
    cli: "standin",
    witness,
    command: faithfulCli,
    baseTmpDir: workDir
  });
  assert.equal(exactRun.exitCode, 0, exactRun.spawnError ?? "");
  assert.equal(exactRun.recordCount, 1);
  assert.equal(exactRun.comparison.byteIdentical, true);
  assert.equal(exactRun.comparison.receivedDigest, exactRun.comparison.sentDigest);
  assert.equal(exactRun.comparison.firstDiffByteOffset, -1);
  assert.equal(exactRun.inspected.payloadTextKey, "prompt");
  assert.equal(exactRun.inspected.payloadSessionKey, "session_id");
  assert.equal(exactRun.inspected.payloadFolderKey, "cwd");
  assert.equal(exactRun.inspected.payloadTranscriptKey, "transcript_path");
  assert.deepEqual(exactRun.inspected.subAgentFields, [
    { path: "parent_session_id", valueType: "null", nonNull: false }
  ]);

  // Single-byte alteration must fail comparison and report the exact byte offset.
  const alteredCli = createStandInCli(workDir, { alterByte: true });
  const badRun = runCaptureProbe({
    cli: "standin",
    witness,
    command: alteredCli,
    baseTmpDir: workDir
  });
  assert.equal(badRun.exitCode, 0);
  assert.equal(badRun.recordCount, 1);
  assert.equal(badRun.comparison.byteIdentical, false);
  assert.notEqual(badRun.comparison.receivedDigest, badRun.comparison.sentDigest);
  assert.ok(badRun.comparison.firstDiffByteOffset >= 0);

  // Direct byte comparison catches single-byte UTF-8 change in the middle.
  const directDiff = compareWitnessBytes("hello café", "hello cafè");
  assert.equal(directDiff.byteIdentical, false);
  assert.notEqual(directDiff.receivedDigest, directDiff.sentDigest);
  assert.equal(directDiff.firstDiffByteOffset, Buffer.from("hello caf", "utf8").length + 1);
});

test("probe harness scans end-of-turn transcripts and diffs interactive vs headless captures", (t) => {
  const workDir = mkdtempSync(join(tmpdir(), "h2a-3q-transcript-"));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const witness = buildWitnessPhrase("tx01");
  const transcriptPath = join(workDir, "session.jsonl");
  writeFileSync(transcriptPath, JSON.stringify({ role: "user", content: witness }) + "\n", "utf8");

  const found = scanTranscriptForWitness([transcriptPath], witness);
  assert.equal(found.readable, true);
  assert.equal(found.format, "jsonl");
  assert.equal(found.witnessByteIdentical, true);

  const alteredPath = join(workDir, "altered.jsonl");
  writeFileSync(alteredPath, JSON.stringify({ role: "user", content: witness + "!" }) + "\n", "utf8");
  const notExact = scanTranscriptForWitness([alteredPath], witness);
  assert.equal(notExact.readable, true);
  assert.equal(notExact.witnessByteIdentical, false);

  const diff = diffInteractiveVsHeadless(
    { safeEnv: { CLAUDE_CODE_ENTRYPOINT: "cli", TERM: "xterm-256color" }, payloadShape: { mode: "interactive" } },
    { safeEnv: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", TERM: "dumb" }, payloadShape: { mode: "headless" } }
  );
  assert.deepEqual(diff.envDiffs, [
    { name: "CLAUDE_CODE_ENTRYPOINT", interactiveValue: "cli", headlessValue: "sdk-cli" },
    { name: "TERM", interactiveValue: "xterm-256color", headlessValue: "dumb" }
  ]);
  assert.deepEqual(diff.payloadDiffs, [
    { name: "mode", interactiveValue: "interactive", headlessValue: "headless" }
  ]);
});

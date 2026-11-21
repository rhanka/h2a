import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SAFE_ENV_ALLOWLIST,
  buildSanitizedProbeSummary,
  buildWitnessPhrase,
  compareWitnessBytes,
  diffInteractiveVsHeadless,
  filterSafeEnv,
  runCaptureProbe,
  sanitizeCaptureEvidence,
  scanEvidenceForLeaks,
  scanTranscriptForWitness
} from "../scripts/qualification-capture.mjs";

const HARNESS_SCRIPT = fileURLToPath(new URL("../scripts/qualification-capture.mjs", import.meta.url));

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

test("sanitizeCaptureEvidence deterministically normalizes paths, UUIDs, and value-based secrets and is idempotent (C1)", () => {
  const ctx = {
    cli: "vibe",
    home: "/home/alice",
    projectDir: "/home/alice/work/h2a-3q-vibe-xyz123",
    baseTmpDir: "/home/alice/work",
    vibeHome: "/home/alice/work/h2a-3q-vibe-xyz123/.vibe-home",
    xdgDataHome: "/home/alice/work/h2a-3q-vibe-xyz123/.xdg-data",
    witness: "h2a-3q-witness-abcd1234: café"
  };

  const dirty = {
    cli: "vibe",
    projectConfigPath: "/home/alice/work/h2a-3q-vibe-xyz123/.vibe/hooks.toml",
    signedInRunOutcome: {
      error: "OSError: [Errno 30] Read-only file system: '/home/alice/.vibe/logs/vibe.log'"
    },
    spawnError: "spawn failed for /Users/bob/bin/cli with https://alice:s3cret@proxy.corp.internal/api?api_key=abc123456789",
    transcript: {
      readable: true,
      format: "jsonl",
      witnessByteIdentical: true,
      matchedIn: "/home/alice/work/h2a-3q-vibe-xyz123/.vibe-home/logs/session/unified/123e4567-e89b-12d3-a456-426614174000/journal/001.jsonl"
    },
    claudeTranscript: "/home/alice/.claude/projects/-home-alice-src-secretclient/987e6543-e21b-12d3-a456-426614174000.jsonl",
    notes: [
      "ghp_1234567890abcdef1234567890abcdef1234",
      "sk-ant-api03-abcdefghijklmnopqrstuvwx123456",
      "AKIAIOSFODNN7EXAMPLE",
      "glpat-abcdefghijklmnopqrstuv",
      "xoxb-1234567890-abcdef123456",
      "hf_abcdefghijklmnopqrstuvwxyz1234",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "Authorization: Bearer topsecretvalue987654",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----",
      "S3_SECRET_KEY=liveovhvalue123",
      "owner@example.com",
      "10.0.42.7",
      "h2a-3q-witness-abcd1234: café"
    ],
    receivedText: "must be stripped completely",
    prompt: "must also be stripped"
  };

  const once = sanitizeCaptureEvidence(dirty, ctx);
  const twice = sanitizeCaptureEvidence(once, ctx);
  assert.deepEqual(twice, once, "sanitizeCaptureEvidence must be deterministic and idempotent");

  assert.equal(once.projectConfigPath, "<throwaway-project>/.vibe/hooks.toml");
  assert.equal(once.signedInRunOutcome.error, "OSError: [Errno 30] Read-only file system: '~/.vibe/logs/vibe.log'");
  assert.equal(once.transcript.matchedIn, "$VIBE_HOME/logs/session/unified/<session_id>/journal/001.jsonl");
  assert.equal(once.claudeTranscript, "~/.claude/projects/<encoded-cwd>/<session_id>.jsonl");
  assert.equal(Object.hasOwn(once, "receivedText"), false);
  assert.equal(Object.hasOwn(once, "prompt"), false);

  const serialized = JSON.stringify(once);
  for (const forbidden of [
    "alice",
    "bob",
    "secretclient",
    "123e4567",
    "987e6543",
    "ghp_",
    "sk-ant-",
    "AKIA",
    "glpat-",
    "xoxb-",
    "hf_",
    "eyJhbGci",
    "topsecretvalue",
    "PRIVATE KEY",
    "liveovhvalue",
    "owner@example.com",
    "s3cret",
    "abc123456789",
    "corp.internal",
    "10.0.42.7",
    "h2a-3q-witness-"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `sanitized output must not contain ${forbidden}`);
  }

  const scan = scanEvidenceForLeaks(once, { home: "/home/alice" });
  assert.equal(scan.ok, true, `sanitized output must pass anti-leak scan: ${JSON.stringify(scan.findings)}`);

  // agy maps UUIDs to <conversationId>.
  const agyClean = sanitizeCaptureEvidence(
    { location: "/home/alice/.gemini/antigravity-cli/brain/123e4567-e89b-12d3-a456-426614174000/.system_generated/logs/transcript_full.jsonl" },
    { cli: "agy", home: "/home/alice" }
  );
  assert.equal(
    agyClean.location,
    "~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl"
  );
});

test("safeEnv and diffInteractiveVsHeadless enforce a closed allow-list plus value-based sanitization (C2)", (t) => {
  assert.equal(SAFE_ENV_ALLOWLIST.has("CLAUDE_CODE_SESSION_ATTENDED"), true);
  for (const excluded of [
    "CLAUDE_PROJECT_DIR",
    "CODEX_THREAD_ID",
    "CODEX_WORKSPACE_ROOT",
    "GEMINI_PROJECT_DIR",
    "VIBE_CWD",
    "VIBE_HOME",
    "MUSE_SESSION_ID",
    "CODEX_EXTRA_HEADERS",
    "VIBE_HTTP_PROXY"
  ]) {
    assert.equal(SAFE_ENV_ALLOWLIST.has(excluded), false, `${excluded} must not be in SAFE_ENV_ALLOWLIST`);
  }

  const filtered = filterSafeEnv(
    {
      CLAUDE_CODE_SESSION_ATTENDED: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_PROJECT_DIR: "/home/alice/client-repo",
      CODEX_THREAD_ID: "123e4567-e89b-12d3-a456-426614174000",
      VIBE_HOME: "/home/alice/.vibe",
      MUSE_SESSION_ID: "sess-secret-999",
      CODEX_EXTRA_HEADERS: "Authorization: Bearer secret99999999",
      VIBE_HTTP_PROXY: "http://user:pass@proxy.internal:8080",
      TERM: "xterm-256color ghp_1234567890abcdef1234567890abcdef1234"
    },
    { home: "/home/alice" }
  );
  assert.deepEqual(Object.keys(filtered).sort(), ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ATTENDED", "TERM"]);
  assert.equal(filtered.CLAUDE_CODE_SESSION_ATTENDED, "1");
  assert.equal(filtered.TERM.includes("ghp_"), false);

  // diffInteractiveVsHeadless must also drop non-allowlisted vars and sanitize values.
  const diff = diffInteractiveVsHeadless(
    {
      safeEnv: {
        CLAUDE_CODE_SESSION_ATTENDED: "1",
        CLAUDE_PROJECT_DIR: "/home/alice/interactive",
        CODEX_EXTRA_HEADERS: "Authorization: Bearer secret12345678"
      },
      payloadShape: { cwd: "/home/alice/project" }
    },
    {
      safeEnv: {
        CLAUDE_CODE_SESSION_ATTENDED: "0",
        CLAUDE_PROJECT_DIR: "/home/alice/headless",
        CODEX_EXTRA_HEADERS: "Authorization: Bearer other12345678"
      },
      payloadShape: { cwd: "/home/alice/other" }
    },
    { home: "/home/alice" }
  );
  assert.deepEqual(diff.envDiffs, [
    { name: "CLAUDE_CODE_SESSION_ATTENDED", interactiveValue: "1", headlessValue: "0" }
  ]);
  assert.equal(JSON.stringify(diff).includes("/home/alice"), false);

  // Probe hook itself must enforce the closed allow-list and never copy non-allowlisted CLI_* env vars.
  const workDir = mkdtempSync(join(tmpdir(), "h2a-3q-c2-"));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const standin = createStandInCli(workDir);
  const run = runCaptureProbe({
    cli: "standin",
    witness: buildWitnessPhrase("c2env01"),
    command: standin,
    baseTmpDir: workDir,
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ATTENDED: "1",
      CLAUDE_PROJECT_DIR: "/home/alice/client-repo",
      CODEX_THREAD_ID: "123e4567-e89b-12d3-a456-426614174000",
      VIBE_CUSTOM_HEADERS: "Authorization: Bearer livevalue123456"
    }
  });
  assert.equal(run.safeEnv.CLAUDE_CODE_SESSION_ATTENDED, "1");
  assert.equal(Object.hasOwn(run.safeEnv, "CLAUDE_PROJECT_DIR"), false);
  assert.equal(Object.hasOwn(run.safeEnv, "CODEX_THREAD_ID"), false);
  assert.equal(Object.hasOwn(run.safeEnv, "VIBE_CUSTOM_HEADERS"), false);
});

test("probe workspace, .probe-records.jsonl, and --out enforce 0700/0600 permissions and sanitized output (C1/C4)", (t) => {
  const workDir = mkdtempSync(join(tmpdir(), "h2a-3q-c4-"));
  t.after(() => rmSync(workDir, { recursive: true, force: true }));

  const nestedTmp = join(workDir, "nested-tmp");
  const standin = createStandInCli(workDir);
  const witness = buildWitnessPhrase("c4perm01");
  const run = runCaptureProbe({
    cli: "standin",
    witness,
    command: standin,
    baseTmpDir: nestedTmp,
    keepWorkspace: true
  });
  const projectDir = dirname(run.hookScript);
  t.after(() => rmSync(projectDir, { recursive: true, force: true }));

  const recordPath = join(projectDir, ".probe-records.jsonl");
  assert.equal(statSync(nestedTmp).mode & 0o777, 0o700, "baseTmpDir must be created with 0700");
  assert.equal(statSync(projectDir).mode & 0o777, 0o700, "projectDir must be 0700");
  assert.equal(statSync(recordPath).mode & 0o777, 0o600, ".probe-records.jsonl must be written 0600");
  assert.equal(statSync(run.hookScript).mode & 0o777, 0o700, ".probe-hook.mjs must be 0700");

  // Summary built for --out must sanitize matchedIn, spawnError, and omit receivedText.
  const summary = buildSanitizedProbeSummary(
    {
      ...run,
      spawnError: `spawn failed in ${homedir()}/secret-dir`,
      transcript: {
        readable: true,
        format: "jsonl",
        witnessByteIdentical: true,
        sentDigest: run.comparison.sentDigest,
        matchedIn: `${projectDir}/123e4567-e89b-12d3-a456-426614174000.jsonl`
      }
    },
    { cli: "standin", projectDir, baseTmpDir: nestedTmp, home: homedir(), witness }
  );
  assert.equal(summary.transcript.matchedIn, "<throwaway-project>/<session_id>.jsonl");
  assert.equal(summary.spawnError.includes(homedir()), false);
  assert.equal(Object.hasOwn(summary.inspected ?? {}, "receivedText"), false);
  assert.equal(scanEvidenceForLeaks(summary).ok, true);

  // CLI --sanitize-evidence must write output with 0600 and clean a dirty evidence fixture.
  const dirtyFile = join(workDir, "dirty-evidence.json");
  const outFile = join(workDir, "clean-evidence.json");
  writeFileSync(
    dirtyFile,
    JSON.stringify({
      schema: 1,
      cli: "vibe",
      signedInRunOutcome: { error: "OSError: [Errno 30] Read-only file system: '/home/alice/.vibe/logs/vibe.log'" },
      transcriptProbe: { location: "/home/alice/.vibe/logs/session/unified/123e4567-e89b-12d3-a456-426614174000/journal/001.jsonl" }
    }),
    "utf8"
  );
  const cliRes = spawnSync(
    process.execPath,
    [HARNESS_SCRIPT, "--sanitize-evidence", dirtyFile, "--out", outFile],
    { encoding: "utf8", env: { ...process.env, TMPDIR: workDir, TMP: workDir, TEMP: workDir } }
  );
  assert.equal(cliRes.status, 0, cliRes.stderr);
  assert.equal(statSync(outFile).mode & 0o777, 0o600, "--out file must be written 0600");
  const cleaned = JSON.parse(readFileSync(outFile, "utf8"));
  assert.equal(cleaned.signedInRunOutcome.error, "OSError: [Errno 30] Read-only file system: '~/.vibe/logs/vibe.log'");
  assert.equal(scanEvidenceForLeaks(cleaned).ok, true);
});

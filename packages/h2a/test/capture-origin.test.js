import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatSignedDriveInstruction, formatWakeLine } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(HERE, "../hooks/capture-origin.mjs");
const BUILT_TRACK_BIN = resolve(HERE, "../../track/dist/cli/bin.js");
const QUALIFICATION_PATH = resolve(HERE, "../fixtures/capture-qualification.json");

const QUALIFICATION = JSON.parse(readFileSync(QUALIFICATION_PATH, "utf8"));

async function loadClassifier() {
  return import(new URL("../hooks/capture-origin.mjs", import.meta.url).href);
}

async function loadTrackBinResolver() {
  return import(new URL("../hooks/track-bin.mjs", import.meta.url).href);
}

async function loadCoreLedger() {
  return import(new URL("../dist/runtime/drumbeat/injection-ledger.js", import.meta.url).href);
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runTrack(cwd, args, env, stdin) {
  return spawnSync(process.execPath, [BUILT_TRACK_BIN, ...args], {
    cwd,
    env,
    input: stdin,
    encoding: "utf8",
  });
}

test("T3b-a: a line injected by wake, drive, restart, relaunch or an initial prompt is never attributed to the owner", async (t) => {
  const { classifyOrigin, readInjectionLedger } = await loadClassifier();

  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  const wakeLine = formatWakeLine(
    [
      {
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:1",
        type: "event",
        actor: { instance: "codex:peer", role: "AGENTS", scope: "scope:default" },
        body: { kind: "message", topic: "status", text: "ping" },
        createdAt: "2026-11-21T10:00:00.000Z",
      },
    ],
    "2026-11-21T10:00:00.000Z",
  );

  const driveLine = formatSignedDriveInstruction({
    from: "claude:lead",
    to: "codex:worker",
    instruction: "Read your inbox and execute the assigned task.",
    nonce: "nonce-t3ba",
    at: "2026-11-21T10:00:00.000Z",
    privateKeyPem,
  });

  const restartLine = "[h2a restart] resume after update";

  const markerCases = [
    { name: "wake (marker)", cli: "claude", text: wakeLine },
    { name: "drive (marker)", cli: "claude", text: driveLine },
    { name: "restart (marker)", cli: "claude", text: restartLine },
  ];

  await t.test("marker paths (wake, drive, restart)", () => {
    for (const c of markerCases) {
      const result = classifyOrigin({
        cli: c.cli,
        payload: { prompt: c.text, session_id: "sess-marker", cwd: "/repo" },
        env: {
          H2A_SESSION_CLASS: "human",
          CLAUDE_CODE_SESSION_ATTENDED: "1",
        },
        qualification: QUALIFICATION,
        ledger: [],
      });
      assert.equal(result.origin, "injected", `${c.name}: expected injected, got ${result.origin} (${result.reason})`);
      assert.notEqual(result.origin, "owner");
      assert.ok(typeof result.reason === "string" && result.reason.length > 0 && !result.reason.includes("\n"));
    }
  });

  await t.test("ledger paths (relaunch, initial prompt, wake-request, paste, nudge)", async () => {
    const { recordInjection } = await loadCoreLedger();
    const stateRoot = makeTempDir("h2a-t3ba-state-");
    try {
      const envWithState = { XDG_STATE_HOME: stateRoot, HOME: stateRoot };
      const nowMs = Date.parse("2026-11-21T10:05:00.000Z");

      const ledgerCases = [
        {
          name: "relaunch continuation (ledger, tmux)",
          cli: "claude",
          text:
            "Continue working autonomously on the standing objective in this resumed conversation. Re-read the latest user request, identify the next incomplete step, and act on it now. Do not stop at the input prompt or wait for another nudge.",
          sessionKey: "tmux:h2a-relaunch",
        },
        {
          name: "initial prompt (ledger, native)",
          cli: "claude",
          text: "Implement delivery lot 3b attribution strictly from the plan.",
          sessionKey: "native:h2a-initial",
        },
        {
          name: "wake-request watcher (ledger, tmux)",
          cli: "codex",
          text: "h2a inbox read --instance codex:worker --root /workspace/.h2a",
          sessionKey: "tmux:h2a-wake-req",
        },
        {
          name: "native paste with CRLF normalization (ledger, native)",
          cli: "claude",
          text: "Verify the migration plan\r\nand report any blocked step.\n",
          receivedText: "Verify the migration plan\nand report any blocked step.",
          sessionKey: "native:h2a-paste",
        },
        {
          name: "tmux sendKeysLiteral nudge (ledger, tmux)",
          cli: "codex",
          text: "continue",
          sessionKey: "tmux:h2a-nudge",
        },
      ];

      for (const c of ledgerCases) {
        recordInjection(c.sessionKey, c.text, { env: envWithState, now: nowMs });
        const ledger = readInjectionLedger(c.sessionKey, { env: envWithState, now: nowMs + 5_000 });
        assert.ok(ledger.length >= 1, `${c.name}: expected ledger entry to be recorded`);

        const result = classifyOrigin({
          cli: c.cli,
          payload: { prompt: c.receivedText ?? c.text, session_id: "sess-1", cwd: "/repo" },
          env: {
            H2A_SESSION_CLASS: "human",
            CLAUDE_CODE_SESSION_ATTENDED: "1",
          },
          qualification: QUALIFICATION,
          ledger,
          now: nowMs + 5_000,
        });

        assert.equal(result.origin, "injected", `${c.name}: expected injected, got ${result.origin} (${result.reason})`);
        assert.notEqual(result.origin, "owner");
        assert.ok(typeof result.reason === "string" && result.reason.length > 0 && !result.reason.includes("\n"));
      }

      // Expired ledger entry (> 120s) is ignored: identical human message after window is owner when proven human.
      recordInjection("native:h2a-expired", "same short line", { env: envWithState, now: nowMs });
      const expiredLedger = readInjectionLedger("native:h2a-expired", {
        env: envWithState,
        now: nowMs + 121_000,
      });
      assert.equal(expiredLedger.length, 0, "entries older than 120s must be ignored on read");
      const afterExpiry = classifyOrigin({
        cli: "claude",
        payload: { prompt: "same short line", session_id: "sess-exp", cwd: "/repo" },
        env: { H2A_SESSION_CLASS: "human" },
        qualification: QUALIFICATION,
        ledger: expiredLedger,
        now: nowMs + 121_000,
      });
      assert.equal(afterExpiry.origin, "owner");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});

test("T3b-b: a message from a sub-agent is never attributed to the owner", async () => {
  const { classifyOrigin } = await loadClassifier();

  const subagentQual = {
    schema: 1,
    entries: [
      {
        cli: "vibe",
        payloadTextKey: "prompt",
        humanSessionEvidence: { source: "env", name: "VIBE_INTERACTIVE", interactiveValue: "1" },
        subAgentMarker: { source: "payload", path: "parent_session_id", rule: "non-null" },
      },
      {
        cli: "custom-bool",
        payloadTextKey: "prompt",
        humanSessionEvidence: "none",
        subAgentMarker: { source: "payload", path: "meta.is_subagent", rule: "true" },
      },
      {
        cli: "custom-present",
        payloadTextKey: "prompt",
        humanSessionEvidence: "none",
        subAgentMarker: { source: "payload", path: "agent.parentId", rule: "present" },
      },
    ],
  };

  // rule: non-null (matches Vibe root parent_session_id != null)
  const vibeSub = classifyOrigin({
    cli: "vibe",
    payload: { prompt: "Inspect the auth module", session_id: "child-1", parent_session_id: "parent-1" },
    env: { H2A_SESSION_CLASS: "human", VIBE_INTERACTIVE: "1" },
    qualification: subagentQual,
    ledger: [],
  });
  assert.equal(vibeSub.origin, "subagent");

  // parent_session_id: null is top-level, not subagent
  const vibeTop = classifyOrigin({
    cli: "vibe",
    payload: { prompt: "Inspect the auth module", session_id: "top-1", parent_session_id: null },
    env: { H2A_SESSION_CLASS: "human" },
    qualification: subagentQual,
    ledger: [],
  });
  assert.equal(vibeTop.origin, "owner");

  // rule: true (nested dotted path)
  const boolSub = classifyOrigin({
    cli: "custom-bool",
    payload: { prompt: "Run sub-task", meta: { is_subagent: true } },
    env: { H2A_SESSION_CLASS: "human" },
    qualification: subagentQual,
    ledger: [],
  });
  assert.equal(boolSub.origin, "subagent");

  // rule: present
  const presentSub = classifyOrigin({
    cli: "custom-present",
    payload: { prompt: "Run sub-task", agent: { parentId: "p-9" } },
    env: { H2A_SESSION_CLASS: "human" },
    qualification: subagentQual,
    ledger: [],
  });
  assert.equal(presentSub.origin, "subagent");
});

test("T3b-c: a message from a background or delegated session is never attributed to the owner", async () => {
  const { classifyOrigin } = await loadClassifier();

  const delegated = classifyOrigin({
    cli: "claude",
    payload: { prompt: "Run nightly check", session_id: "job-s1", cwd: "/repo" },
    env: {
      REMOTE_JOB_ID: "job-nightly-42",
      H2A_SESSION_CLASS: "human",
      CLAUDE_CODE_SESSION_ATTENDED: "1",
    },
    qualification: QUALIFICATION,
    ledger: [],
  });
  assert.equal(delegated.origin, "background");

  const bg = classifyOrigin({
    cli: "claude",
    payload: { prompt: "Run background lane", session_id: "bg-s1", cwd: "/repo" },
    env: {
      H2A_SESSION_CLASS: "background",
      CLAUDE_CODE_SESSION_ATTENDED: "1",
    },
    qualification: QUALIFICATION,
    ledger: [],
  });
  assert.equal(bg.origin, "background");
});

test("T3b-d: an origin the evidence does not prove is doubtful, and a doubtful capture is never quoted by the table", async () => {
  const { classifyOrigin, executeHook } = await loadClassifier();
  const { resolveTrackBin } = await loadTrackBinResolver();

  // Case 1: no session class and no qualified interactive sign
  const noProofCodex = classifyOrigin({
    cli: "codex",
    payload: { prompt: "Ajoute une colonne de statut", session_id: "s-manual", cwd: "/repo" },
    env: {},
    qualification: QUALIFICATION,
    ledger: [],
  });
  assert.equal(noProofCodex.origin, "doubtful");

  const noProofClaudeUnattended = classifyOrigin({
    cli: "claude",
    payload: { prompt: "Ajoute une colonne de statut", session_id: "s-manual", cwd: "/repo" },
    env: {},
    qualification: QUALIFICATION,
    ledger: [],
  });
  assert.equal(noProofClaudeUnattended.origin, "doubtful");

  // Positive control: Claude with qualified interactive env IS owner
  const qualifiedClaude = classifyOrigin({
    cli: "claude",
    payload: { prompt: "Ajoute une colonne de statut", session_id: "s-human", cwd: "/repo" },
    env: { CLAUDE_CODE_SESSION_ATTENDED: "1" },
    qualification: QUALIFICATION,
    ledger: [],
  });
  assert.equal(qualifiedClaude.origin, "owner");

  // Case 2: session class present with unknown value (must NOT fall through to qualified sign)
  for (const badClass of ["interactive", "HUMAN", "", "unknown"]) {
    const unknownClass = classifyOrigin({
      cli: "claude",
      payload: { prompt: "Texte quelconque", session_id: "s-bad", cwd: "/repo" },
      env: { H2A_SESSION_CLASS: badClass, CLAUDE_CODE_SESSION_ATTENDED: "1" },
      qualification: QUALIFICATION,
      ledger: [],
    });
    assert.equal(unknownClass.origin, "doubtful", `H2A_SESSION_CLASS=${JSON.stringify(badClass)} must yield doubtful`);
  }

  // Case 3: unparsable payload (even with H2A_SESSION_CLASS=human)
  for (const badPayload of ["{not-json", "", "null", "42", "[1,2,3]", null, undefined]) {
    const unparsable = classifyOrigin({
      cli: "claude",
      payload: badPayload,
      env: { H2A_SESSION_CLASS: "human", CLAUDE_CODE_SESSION_ATTENDED: "1" },
      qualification: QUALIFICATION,
      ledger: [],
    });
    assert.equal(unparsable.origin, "doubtful", `unparsable payload ${String(badPayload)} must yield doubtful`);
  }

  // Track binary resolution: never looks at cwd or bare track on PATH
  const scratch = makeTempDir("h2a-t3bd-e2e-");
  try {
    const decoyCwd = join(scratch, "decoy-cwd");
    const decoyBinDir = join(decoyCwd, "node_modules", "@sentropic", "track", "dist", "cli");
    mkdirSync(decoyBinDir, { recursive: true });
    writeFileSync(join(decoyBinDir, "bin.js"), "#!/usr/bin/env node\n", "utf8");
    const fakePathDir = join(scratch, "fake-path");
    mkdirSync(fakePathDir, { recursive: true });
    writeFileSync(join(fakePathDir, "track"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const unresolved = resolveTrackBin({
      env: { PATH: fakePathDir, HOME: scratch },
      fromDir: "/nonexistent/h2a-isolated-hook-dir",
      globalPrefix: null,
    });
    assert.equal(unresolved, undefined, "resolveTrackBin must never fall back to bare track on PATH or cwd");

    // Resolution order: TRACK_BIN > ancestor walk-up > global npm prefix
    const fakeGlobalPrefix = join(scratch, "global-prefix");
    const globalBin = join(fakeGlobalPrefix, "lib", "node_modules", "@sentropic", "track", "dist", "cli", "bin.js");
    mkdirSync(dirname(globalBin), { recursive: true });
    writeFileSync(globalBin, "#!/usr/bin/env node\n", "utf8");
    assert.equal(
      resolveTrackBin({ env: {}, fromDir: "/nonexistent/h2a-isolated-hook-dir", globalPrefix: fakeGlobalPrefix }),
      globalBin,
      "global npm prefix resolves when TRACK_BIN and ancestor walk-up are absent",
    );
    const ancestorRoot = join(scratch, "ancestor-root");
    const ancestorBin = join(ancestorRoot, "node_modules", "@sentropic", "track", "dist", "cli", "bin.js");
    const nestedFrom = join(ancestorRoot, "packages", "h2a", "hooks");
    mkdirSync(dirname(ancestorBin), { recursive: true });
    mkdirSync(nestedFrom, { recursive: true });
    writeFileSync(ancestorBin, "#!/usr/bin/env node\n", "utf8");
    assert.equal(
      resolveTrackBin({ env: {}, fromDir: nestedFrom, globalPrefix: fakeGlobalPrefix }),
      ancestorBin,
      "ancestor walk-up takes priority over global npm prefix",
    );
    assert.equal(
      resolveTrackBin({ env: { TRACK_BIN: BUILT_TRACK_BIN }, fromDir: nestedFrom, globalPrefix: fakeGlobalPrefix }),
      BUILT_TRACK_BIN,
      "TRACK_BIN takes priority over ancestor walk-up and global npm prefix",
    );

    // End-to-end through the hook script and the built Track CLI reader on a temp state home
    const project = join(scratch, "project");
    const stateHome = join(scratch, "state");
    const homeDir = join(scratch, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(stateHome, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    const baseEnv = {
      PATH: process.env.PATH ?? "",
      HOME: homeDir,
      XDG_STATE_HOME: stateHome,
      TRACK_STATE_HOME: stateHome,
      TRACK_BIN: BUILT_TRACK_BIN,
      TMPDIR: scratch,
    };

    const initRes = runTrack(project, ["init"], baseEnv);
    assert.equal(initRes.status, 0, initRes.stderr);

    const doubtfulText = "Verifier la pagination de la table de suivi";
    const hookPayload = JSON.stringify({
      prompt: doubtfulText,
      session_id: "manual-codex-1",
      cwd: project,
    });

    // Run capture-origin.mjs as a CLI hook with no H2A_SESSION_CLASS (codex has no qualified human sign)
    const hookRes = spawnSync(process.execPath, [HOOK_PATH, "--cli", "codex"], {
      cwd: project,
      env: baseEnv,
      input: hookPayload,
      encoding: "utf8",
    });
    assert.equal(hookRes.status, 0, `hook must always exit 0: ${hookRes.stderr}`);
    assert.equal(hookRes.stdout, "", "hook must print nothing on stdout");

    // Inspect captured entry via built Track CLI
    const listRes = runTrack(project, ["capture", "list", "--format", "json"], baseEnv);
    assert.equal(listRes.status, 0, listRes.stderr);
    const listed = JSON.parse(listRes.stdout);
    const entries = Array.isArray(listed) ? listed : listed.entries ?? listed.captures ?? [];
    assert.equal(entries.length, 1, `expected 1 captured entry, got ${JSON.stringify(listed)}`);
    assert.equal(entries[0].origin, "doubtful");

    // Classify as new-demand and render owner table
    const classifyRes = runTrack(
      project,
      ["capture", "classify", entries[0].id, "--as", "new-demand", "--title", "Pagination table"],
      baseEnv,
    );
    assert.equal(classifyRes.status, 0, classifyRes.stderr);

    const reportRes = runTrack(project, ["report", "--owner-table"], baseEnv);
    assert.equal(reportRes.status, 0, reportRes.stderr);
    assert.match(reportRes.stdout, /origine non prouvée/);
    assert.ok(reportRes.stdout.includes(doubtfulText), "doubtful demand text must appear in the table");
    assert.ok(
      !reportRes.stdout.includes(`« ${doubtfulText} »`),
      `doubtful capture must NEVER be quoted in the owner table:\n${reportRes.stdout}`,
    );

    // Missing Track binary: hook reports on stderr, prints nothing on stdout, exits 0
    const missingBinOutcome = executeHook({
      cli: "codex",
      rawInput: hookPayload,
      env: { PATH: "", HOME: homeDir, XDG_STATE_HOME: stateHome, TMPDIR: scratch },
      resolveBin: () => undefined,
    });
    assert.equal(missingBinOutcome.exitCode, 0, "missing Track binary must never block CLI (exit 0)");
    assert.equal(missingBinOutcome.stdout, "", "missing Track binary must print nothing on stdout");
    assert.ok(missingBinOutcome.stderr.trim().length > 0, "missing Track binary must report on stderr");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("T3b-e: native-terminal human activity does not change the classification", async () => {
  const { classifyOrigin, digestInjectionText } = await loadClassifier();

  const nowMs = Date.parse("2026-11-21T10:10:00.000Z");

  // 1. Injected line (ledger) + native-terminal human-activity signals -> still injected
  const injectedWithNtActivity = classifyOrigin({
    cli: "claude",
    payload: {
      prompt: "continue working now",
      session_id: "nt-1",
      native_terminal_human_activity: true,
      last_human_input_at: nowMs + 900,
    },
    env: {
      H2A_NATIVE_TERMINAL: "1",
      H2A_NATIVE_PTY_SESSION: "h2a-nt-demo",
      H2A_SESSION_CLASS: "human",
      CLAUDE_CODE_SESSION_ATTENDED: "1",
      H2A_NATIVE_HUMAN_ACTIVITY_AT: String(nowMs + 900),
    },
    qualification: QUALIFICATION,
    ledger: [{ at: nowMs, digest: digestInjectionText("continue working now") }],
    now: nowMs + 1_000,
  });
  assert.equal(injectedWithNtActivity.origin, "injected");

  // 2. Unproven session + native-terminal human-activity signals -> still doubtful (never upgraded to owner)
  const unprovenWithNtActivity = classifyOrigin({
    cli: "codex",
    payload: {
      prompt: "A manual line with native terminal activity",
      session_id: "nt-2",
      native_terminal_human_activity: true,
      last_human_input_at: nowMs + 900,
    },
    env: {
      H2A_NATIVE_TERMINAL: "1",
      H2A_NATIVE_PTY_SESSION: "h2a-nt-other",
      H2A_NATIVE_HUMAN_ACTIVITY_AT: String(nowMs + 900),
    },
    qualification: QUALIFICATION,
    ledger: [],
    now: nowMs + 1_000,
  });
  assert.equal(unprovenWithNtActivity.origin, "doubtful");

  // 3. Background session + native-terminal human-activity signals -> still background
  const bgWithNtActivity = classifyOrigin({
    cli: "claude",
    payload: {
      prompt: "Background task line",
      session_id: "nt-3",
      native_terminal_human_activity: true,
      last_human_input_at: nowMs + 900,
    },
    env: {
      H2A_NATIVE_TERMINAL: "1",
      H2A_NATIVE_PTY_SESSION: "h2a-nt-bg",
      H2A_SESSION_CLASS: "background",
      H2A_NATIVE_HUMAN_ACTIVITY_AT: String(nowMs + 900),
    },
    qualification: QUALIFICATION,
    ledger: [],
    now: nowMs + 1_000,
  });
  assert.equal(bgWithNtActivity.origin, "background");
});

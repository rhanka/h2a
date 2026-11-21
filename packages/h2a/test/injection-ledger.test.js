import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INJECTION_LEDGER_WINDOW_MS as HOOK_WINDOW_MS,
  classifyOrigin,
  digestInjectionText as hookDigest,
  normalizeInjectionText as hookNormalize,
  readInjectionLedger as hookReadLedger,
  resolveInjectionLedgerDir as hookResolveDir,
  sessionKeyFileName as hookFileName,
} from "../hooks/capture-origin.mjs";
import {
  INJECTION_LEDGER_WINDOW_MS as CORE_WINDOW_MS,
  digestInjectionText as coreDigest,
  normalizeInjectionText as coreNormalize,
  readInjectionLedger as coreReadLedger,
  recordInjection as coreRecordInjection,
  resolveInjectionLedgerDir as coreResolveDir,
  resolveInjectionLedgerPath as coreResolvePath,
  sessionKeyFileName as coreFileName,
} from "../dist/runtime/drumbeat/injection-ledger.js";
import { tmuxSendSubmit } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = resolve(HERE, "../fixtures/injection-ledger-vectors.json");
const VECTORS = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

test("core writer and hook reader agree on every shared session-key and text digest vector", () => {
  assert.equal(CORE_WINDOW_MS, VECTORS.windowMs);
  assert.equal(HOOK_WINDOW_MS, VECTORS.windowMs);

  for (const v of VECTORS.sessionKeys) {
    assert.equal(coreFileName(v.sessionKey), v.fileName);
    assert.equal(hookFileName(v.sessionKey), v.fileName);
  }

  for (const v of VECTORS.texts) {
    assert.equal(coreNormalize(v.raw), v.normalized);
    assert.equal(hookNormalize(v.raw), v.normalized);
    assert.equal(coreDigest(v.raw), v.digest);
    assert.equal(hookDigest(v.raw), v.digest);
  }

  assert.equal(
    coreResolveDir({ HOME: "/fake/home" }),
    "/fake/home/.local/state/h2a/injected",
  );
  assert.equal(
    hookResolveDir({ HOME: "/fake/home" }),
    "/fake/home/.local/state/h2a/injected",
  );
});

test("core writer enforces 0700/0600 modes, stores no raw text, and hook reader agrees on timed sequences", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-core-ledger-"));
  try {
    const env = { XDG_STATE_HOME: root, HOME: root };
    const secretText = "core-writer-never-persists-raw-text-on-disk";
    const entry = coreRecordInjection("tmux:h2a-demo", secretText, {
      env,
      now: 1_700_000_000_000,
    });
    assert.ok(entry);

    const dir = coreResolveDir(env);
    const filePath = coreResolvePath("tmux:h2a-demo", env);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);

    const rawFile = readFileSync(filePath, "utf8");
    assert.ok(!rawFile.includes(secretText), "ledger file must hold no raw text");
    const lines = rawFile.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      at: 1_700_000_000_000,
      digest: coreDigest(secretText),
    });

    // Shared timed sequences: core writer writes -> both core reader and hook reader (and classifyOrigin) agree!
    for (const seq of VECTORS.timedSequences) {
      const seqDir = mkdtempSync(join(root, "seq-"));
      const seqEnv = { XDG_STATE_HOME: seqDir, HOME: root };

      for (const write of seq.writes) {
        coreRecordInjection(seq.sessionKey, write.text, {
          env: seqEnv,
          now: write.at,
        });
      }

      if (seq.expectedRemainingCountAfterWrites !== undefined) {
        const written = readFileSync(coreResolvePath(seq.sessionKey, seqEnv), "utf8");
        const remaining = written.trim().split("\n").filter(Boolean);
        assert.equal(remaining.length, seq.expectedRemainingCountAfterWrites, seq.name);
      }

      for (const query of seq.queries) {
        const wantDigest = hookDigest(query.text);
        const coreEntries = coreReadLedger(seq.sessionKey, { env: seqEnv, now: query.at });
        const hookEntries = hookReadLedger(seq.sessionKey, { env: seqEnv, now: query.at });

        assert.deepEqual(hookEntries, coreEntries, `${seq.name} @ ${query.at}: hook & core reader must agree`);
        assert.equal(
          hookEntries.some((e) => e.digest === wantDigest),
          query.expectedMatch,
          `${seq.name} @ ${query.at}`,
        );

        const verdict = classifyOrigin({
          cli: "claude",
          payload: { prompt: query.text, session_id: "s-vec", cwd: "/repo" },
          env: { H2A_SESSION_CLASS: "human" },
          ledger: hookEntries,
          now: query.at,
        });
        assert.equal(
          verdict.origin,
          query.expectedMatch ? "injected" : "owner",
          `${seq.name} @ ${query.at}: classifyOrigin mismatch`,
        );
      }
    }

    // tmuxSendSubmit records into the session ledger and capture-origin classifies it as injected
    const prevXdg = process.env.XDG_STATE_HOME;
    const submitState = mkdtempSync(join(root, "submit-"));
    process.env.XDG_STATE_HOME = submitState;
    try {
      const calls = [];
      const rt = {
        run(file, args) {
          calls.push([file, ...args]);
          return true;
        },
      };
      const line = "resume drumbeat session";
      assert.equal(tmuxSendSubmit(rt, "h2a-drum:0.0", line), true);
      assert.equal(calls.length, 3);
      const ledger = hookReadLedger("tmux:h2a-drum", {
        env: { XDG_STATE_HOME: submitState, HOME: root },
      });
      assert.equal(ledger.some((e) => e.digest === hookDigest(line)), true);
      const verdict = classifyOrigin({
        cli: "claude",
        payload: { prompt: line, session_id: "s-drum", cwd: "/repo" },
        env: { H2A_SESSION_CLASS: "human" },
        ledger,
      });
      assert.equal(verdict.origin, "injected");
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevXdg;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

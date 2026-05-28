import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearEscalation,
  drumbeatTick,
  listEscalations,
  recordEscalation,
  recordStop,
  markRelanced,
  runCli
} from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-escal-"));
}

test("recordEscalation upserts to PRINCIPAL/alert by default; clear removes it", () => {
  const root = freshRoot();
  try {
    const rec = recordEscalation(root, { instance: "claude:p1", reason: "relance-exhausted", relanceCount: 3 });
    assert.equal(rec.to, "PRINCIPAL");
    assert.equal(rec.channel, "alert");
    assert.equal(rec.relanceCount, 3);
    assert.equal(listEscalations(root).length, 1);

    // upsert (not pile up)
    recordEscalation(root, { instance: "claude:p1", reason: "relance-exhausted", relanceCount: 4 });
    assert.equal(listEscalations(root).length, 1);
    assert.equal(listEscalations(root)[0].relanceCount, 4);

    clearEscalation(root, "claude:p1");
    assert.equal(listEscalations(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("drumbeatTick escalates an exhausted agent via onExhausted (anti-loop cap)", async () => {
  const root = freshRoot();
  try {
    // Record a stop and push it over the relance cap.
    recordStop(root, { instance: "codex:p2", workStatus: "out-of-tokens" });
    markRelanced(root, "codex:p2");
    markRelanced(root, "codex:p2");
    markRelanced(root, "codex:p2"); // relanceCount = 3 = cap

    const escalated = [];
    const neverRelaunch = { relance: () => true };
    const result = await drumbeatTick(root, neverRelaunch, {
      maxRelances: 3,
      onExhausted: (entry) => {
        recordEscalation(root, {
          instance: entry.instance,
          reason: "relance-exhausted",
          relanceCount: entry.relanceCount
        });
        escalated.push(entry.instance);
      }
    });
    assert.deepEqual([...result.exhausted], ["codex:p2"]);
    assert.deepEqual(escalated, ["codex:p2"]);
    assert.equal(listEscalations(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a drumbeat escalations lists the open escalations; clear resolves them", () => {
  const root = freshRoot();
  try {
    recordEscalation(root, { instance: "gemini:p3", reason: "relance-exhausted", relanceCount: 3 });
    let out = "";
    runCli(["drumbeat", "escalations", "--root", root], {
      stdout: { write: (c) => void (out += c) },
      stderr: { write: () => {} }
    });
    const list = JSON.parse(out);
    assert.equal(list.length, 1);
    assert.equal(list[0].instance, "gemini:p3");
    assert.equal(list[0].to, "PRINCIPAL");

    // drumbeat clear also clears the escalation (clean resume).
    runCli(["drumbeat", "clear", "--root", root, "--instance", "gemini:p3"], {
      stdout: { write: () => {} },
      stderr: { write: () => {} }
    });
    assert.equal(listEscalations(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

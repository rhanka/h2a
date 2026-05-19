import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

function setupNegotiation(root, dir) {
  runCli(["init", "--root", root], captureStreams(dir));
  runCli(
    [
      "negotiate",
      "open",
      "--root",
      root,
      "--json",
      JSON.stringify({
        id: "nego-typed",
        scope: "scope:engagement/x",
        parties: ["a", "b"],
        subject: "engagement",
        status: "draft",
        requiredSigners: ["a", "b"]
      })
    ],
    captureStreams(dir)
  );
}

test("h2a negotiate offer appends a propose event with the artifact body", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-typed-"));
  const root = join(dir, ".h2a");
  try {
    setupNegotiation(root, dir);

    const out = captureStreams(dir);
    const rc = runCli(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-typed",
        "--instance",
        "a",
        "--event-id",
        "evt-offer-1",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", goal: "ship" })
      ],
      out
    );
    assert.equal(rc, 0);
    const entry = JSON.parse(out.stdoutText);
    assert.equal(entry.type, "propose");
    assert.equal(entry.actor.instance, "a");
    assert.equal(entry.body.artifact.goal, "ship");
    assert.equal(entry.sequence, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate counter appends a counter event chained to the previous", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-typed-"));
  const root = join(dir, ".h2a");
  try {
    setupNegotiation(root, dir);

    runCli(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "nego-typed",
        "--instance",
        "a",
        "--event-id",
        "evt-1",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", goal: "v1" })
      ],
      captureStreams(dir)
    );

    const out = captureStreams(dir);
    runCli(
      [
        "negotiate",
        "counter",
        "--root",
        root,
        "--id",
        "nego-typed",
        "--instance",
        "b",
        "--event-id",
        "evt-2",
        "--artifact",
        JSON.stringify({ kind: "ENGAGEMENT", goal: "v1.1" })
      ],
      out
    );
    const entry = JSON.parse(out.stdoutText);
    assert.equal(entry.type, "counter");
    assert.equal(entry.actor.instance, "b");
    assert.equal(entry.sequence, 1);
    assert.match(entry.prevHash, /^sha256:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate offer rejects unknown negotiation id", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-typed-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const out = captureStreams(dir);
    const rc = runCli(
      [
        "negotiate",
        "offer",
        "--root",
        root,
        "--id",
        "ghost",
        "--instance",
        "a",
        "--artifact",
        JSON.stringify({})
      ],
      out
    );
    assert.equal(rc, 1);
    assert.match(out.stderrText, /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate offer requires --id --instance --artifact", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["negotiate", "offer", "--id", "x"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--id.*--instance.*--artifact/);
});

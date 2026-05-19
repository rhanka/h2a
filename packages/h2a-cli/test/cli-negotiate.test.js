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

test("h2a negotiate open writes state.json and rejects re-open", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-neg-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const record = {
      id: "nego-001",
      scope: "scope:engagement/ship-v1",
      parties: ["conductor:01", "conductor:02"],
      subject: "contract",
      status: "draft",
      requiredSigners: ["conductor:01", "conductor:02"]
    };

    const open = captureStreams(dir);
    const rc = runCli(
      ["negotiate", "open", "--root", root, "--json", JSON.stringify(record)],
      open
    );
    assert.equal(rc, 0);
    assert.match(open.stdoutText, /"id": "nego-001"/);

    const dup = captureStreams(dir);
    const rc2 = runCli(
      ["negotiate", "open", "--root", root, "--json", JSON.stringify(record)],
      dup
    );
    assert.equal(rc2, 1);
    assert.match(dup.stderrText, /already open/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate status transitions the record", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-neg-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));
    runCli(
      [
        "negotiate",
        "open",
        "--root",
        root,
        "--json",
        JSON.stringify({
          id: "nego-002",
          scope: "scope:x",
          parties: ["a"],
          subject: "policy",
          status: "draft",
          requiredSigners: ["a"]
        })
      ],
      captureStreams(dir)
    );

    const status = captureStreams(dir);
    const rc = runCli(
      ["negotiate", "status", "--root", root, "--id", "nego-002", "--status", "proposed"],
      status
    );
    assert.equal(rc, 0);
    const parsed = JSON.parse(status.stdoutText);
    assert.equal(parsed.status, "proposed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate event + journal produces a chained journal", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-neg-"));
  const root = join(dir, ".h2a");
  try {
    runCli(["init", "--root", root], captureStreams(dir));

    const baseEvent = {
      id: "evt-001",
      type: "propose",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:x" },
      body: { offer: 1 },
      createdAt: "2026-05-18T00:00:00.000Z"
    };

    const e1 = captureStreams(dir);
    runCli(
      [
        "negotiate",
        "event",
        "--root",
        root,
        "--id",
        "nego-003",
        "--json",
        JSON.stringify(baseEvent)
      ],
      e1
    );
    const entry1 = JSON.parse(e1.stdoutText);
    assert.equal(entry1.sequence, 0);

    const e2 = captureStreams(dir);
    runCli(
      [
        "negotiate",
        "event",
        "--root",
        root,
        "--id",
        "nego-003",
        "--json",
        JSON.stringify({ ...baseEvent, id: "evt-002", type: "counter", body: { offer: 2 } })
      ],
      e2
    );
    const entry2 = JSON.parse(e2.stdoutText);
    assert.equal(entry2.sequence, 1);
    assert.equal(entry2.prevHash, entry1.contentHash);

    const journal = captureStreams(dir);
    runCli(["negotiate", "journal", "--root", root, "--id", "nego-003"], journal);
    const list = JSON.parse(journal.stdoutText);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, "evt-001");
    assert.equal(list[1].id, "evt-002");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a negotiate <unknown> errors with usage hint", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["negotiate", "bogus"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /Unknown negotiate subcommand/);
});

test("h2a negotiate event requires --id and --json", () => {
  const streams = captureStreams("/tmp");
  const rc = runCli(["negotiate", "event"], streams);
  assert.equal(rc, 1);
  assert.match(streams.stderrText, /--id .*--json/);
});

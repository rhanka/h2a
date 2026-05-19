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

function run(argv, cwd) {
  const streams = captureStreams(cwd);
  const rc = runCli(argv, streams);
  return { rc, stdout: streams.stdoutText, stderr: streams.stderrText };
}

test("end-to-end: 1 PRINCIPAL + 3 CONDUCTORS register, negotiate, mailbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-e2e-"));
  const root = join(dir, ".h2a");
  try {
    assert.equal(run(["init", "--root", root], dir).rc, 0);

    const principal = {
      id: "human:antoine",
      instance: "human:antoine",
      roles: ["PRINCIPAL"],
      scopes: ["scope:principal/antoine"],
      capabilities: ["decide"],
      endpoints: [{ kind: "local-files", uri: `file://${root}` }],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    assert.equal(
      run(["register", "--root", root, "--json", JSON.stringify(principal)], dir).rc,
      0
    );

    for (let i = 1; i <= 3; i++) {
      const id = `conductor:0${i}`;
      const reg = {
        id,
        instance: id,
        roles: ["CONDUCTOR"],
        scopes: ["scope:principal/antoine"],
        principal: "human:antoine",
        capabilities: ["negotiate"],
        endpoints: [{ kind: "local-files", uri: `file://${root}` }],
        publicKeys: [],
        acceptedPolicies: [],
        createdAt: "2026-05-18T00:00:00.000Z"
      };
      assert.equal(
        run(["register", "--root", root, "--json", JSON.stringify(reg)], dir).rc,
        0
      );
    }

    const discovered = run(["discover", "--root", root, "--role", "CONDUCTOR"], dir);
    const conductors = JSON.parse(discovered.stdout);
    assert.equal(conductors.length, 3);

    const record = {
      id: "nego-ship-v1",
      scope: "scope:engagement/ship-v1",
      parties: ["conductor:01", "conductor:02"],
      subject: "engagement",
      status: "draft",
      requiredSigners: ["conductor:01", "conductor:02"]
    };
    assert.equal(
      run(["negotiate", "open", "--root", root, "--json", JSON.stringify(record)], dir).rc,
      0
    );

    const event1 = {
      id: "evt-001",
      type: "propose",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: record.scope },
      body: { artifact: { kind: "ENGAGEMENT", goal: "ship v1" } },
      createdAt: "2026-05-18T00:01:00.000Z"
    };
    const event2 = {
      ...event1,
      id: "evt-002",
      type: "counter",
      actor: { instance: "conductor:02", role: "CONDUCTOR", scope: record.scope },
      body: { artifact: { kind: "ENGAGEMENT", goal: "ship v1 by 2026-06-30" } },
      createdAt: "2026-05-18T00:02:00.000Z"
    };

    assert.equal(
      run(
        ["negotiate", "event", "--root", root, "--id", "nego-ship-v1", "--json", JSON.stringify(event1)],
        dir
      ).rc,
      0
    );
    assert.equal(
      run(
        ["negotiate", "event", "--root", root, "--id", "nego-ship-v1", "--json", JSON.stringify(event2)],
        dir
      ).rc,
      0
    );

    const journal = JSON.parse(
      run(["negotiate", "journal", "--root", root, "--id", "nego-ship-v1"], dir).stdout
    );
    assert.equal(journal.length, 2);
    assert.equal(journal[0].sequence, 0);
    assert.equal(journal[1].prevHash, journal[0].contentHash);

    assert.equal(
      run(
        ["negotiate", "status", "--root", root, "--id", "nego-ship-v1", "--status", "accepted"],
        dir
      ).rc,
      0
    );

    const inboxEnvelope = {
      protocol: "sentropic.h2a",
      version: "0.1",
      id: "env-001",
      type: "event",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: record.scope },
      target: { instance: "human:antoine" },
      body: { note: "negotiation accepted, awaiting principal ack" },
      createdAt: "2026-05-18T00:03:00.000Z"
    };
    assert.equal(
      run(
        ["inbox", "put", "--root", root, "--instance", "human:antoine", "--json", JSON.stringify(inboxEnvelope)],
        dir
      ).rc,
      0
    );
    const inbox = JSON.parse(
      run(["inbox", "read", "--root", root, "--instance", "human:antoine"], dir).stdout
    );
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].id, "env-001");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

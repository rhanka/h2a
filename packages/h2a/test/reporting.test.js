import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  H2A_REPORT_CONTEXT_MAX_BYTES,
  H2A_REPORT_CONTEXT_MAX_ENTRIES,
  readH2AReportContext
} from "../dist/index.js";

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "h2a-reporting-")));
  const workspace = join(dir, "repo");
  const outside = join(dir, "outside");
  const store = join(dir, "bus", ".h2a");
  for (const path of [workspace, outside, store, join(store, "presence")]) {
    mkdirSync(path, { recursive: true });
  }
  return { dir, workspace, outside, store };
}

function session(id, instance, workspacePath) {
  return {
    sessionId: id,
    instance,
    host: "claude",
    startedAt: "2026-07-14T10:00:00.000Z",
    heartbeatAt: "2026-07-14T10:01:00.000Z",
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    workStatus: "working",
    workspace: {
      id: `ws:${id}`,
      path: workspacePath,
      host: "claude",
      label: "repo"
    }
  };
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

test("report-context is read-only, realpath-scoped, ordinal and never emits inbox bodies", () => {
  const f = fixture();
  try {
    writeJson(join(f.store, "presence", "inside.json"), session("inside", "claude:inside:abc", f.workspace));
    writeJson(join(f.store, "presence", "outside.json"), session("outside", "claude:outside:def", f.outside));
    writeJson(join(f.store, "presence", "relative.json"), session("relative", "claude:relative:ghi", "."));
    const malformed = join(f.store, "presence", "malformed.json");
    writeFileSync(malformed, "{not-json\n", "utf8");

    const loopDir = join(f.store, "loops", "loop-inside");
    writeJson(join(loopDir, "state.json"), {
      id: "loop-inside",
      ownerSystem: "h2a",
      name: "Inside loop",
      goal: "Ship the scoped report",
      status: "running",
      repos: [{ path: f.workspace }],
      refs: [],
      agents: [{ id: "a", host: "claude", role: "review", placement: "local", status: "working", h2aInstance: "claude:inside:abc" }],
      policy: {},
      createdAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T10:01:00.000Z"
    });
    writeJson(join(f.store, "loops", "loop-outside", "state.json"), {
      id: "loop-outside",
      ownerSystem: "h2a",
      name: "Outside loop",
      goal: "MUST_NOT_LEAK_OUTSIDE",
      status: "running",
      repos: [{ path: f.outside }],
      refs: [],
      agents: [],
      policy: {},
      createdAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T10:01:00.000Z"
    });
    const outsideLink = join(f.workspace, "outside-link");
    symlinkSync(f.outside, outsideLink);
    writeJson(join(f.store, "loops", "loop-symlink", "state.json"), {
      id: "loop-symlink",
      ownerSystem: "h2a",
      name: "Symlink escape",
      goal: "MUST_NOT_LEAK_SYMLINK",
      status: "running",
      repos: [{ path: outsideLink }],
      refs: [], agents: [], policy: {},
      createdAt: "2026-07-14T10:00:00.000Z", updatedAt: "2026-07-14T10:01:00.000Z"
    });

    writeJson(join(f.store, "blockage", "claude__inside__abc.json"), {
      instance: "claude:inside:abc",
      scope: "scope:repo",
      reason: "waiting on review",
      needs: "owner decision",
      raisedAt: "2026-07-14T10:02:00.000Z"
    });
    writeJson(join(f.store, "blockage", "claude__outside__def.json"), {
      instance: "claude:outside:def",
      scope: "scope:outside",
      reason: "MUST_NOT_LEAK_BLOCKAGE",
      raisedAt: "2026-07-14T10:02:00.000Z"
    });
    writeJson(join(f.store, "inbox", "claude__inside__abc", "env-1.json"), {
      protocol: "sentropic.h2a",
      version: "0.1",
      id: "env-1",
      type: "event",
      actor: { instance: "claude:peer:xyz", role: "AGENTS", scope: "scope:repo" },
      body: { promptInjection: "MUST_NOT_LEAK_INBOX_BODY", secret: "token-value" },
      createdAt: "2026-07-14T10:03:00.000Z"
    });

    const beforeMalformed = readFileSync(malformed, "utf8");
    const output = readH2AReportContext({ storeRoot: f.store, workspaceRoot: f.workspace });
    const serialized = JSON.stringify(output);

    assert.deepEqual(Object.keys(output), ["schema", "storeRoot", "workspaceRoot", "entries", "omitted"]);
    assert.equal(output.schema, "h2a.report-context/v1");
    assert.equal(output.storeRoot, resolve(f.store));
    assert.equal(output.workspaceRoot, resolve(f.workspace));
    assert.equal(output.omitted, 0);
    assert.deepEqual(output.entries.map((entry) => entry.ref), [...output.entries.map((entry) => entry.ref)].sort());
    assert.ok(output.entries.some((entry) => entry.kind === "loop"));
    assert.ok(output.entries.some((entry) => entry.kind === "session"));
    assert.ok(output.entries.some((entry) => entry.kind === "blockage"));
    assert.ok(output.entries.some((entry) => entry.kind === "inbox-metadata"));
    assert.doesNotMatch(serialized, /MUST_NOT_LEAK|token-value|promptInjection/);
    assert.equal(readFileSync(malformed, "utf8"), beforeMalformed, "malformed presence must not be repaired/deleted");
    assert.ok(existsSync(malformed));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("report-context enforces count/byte caps and reports omitted entries", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 125; i++) {
      const id = String(i).padStart(3, "0");
      writeJson(join(f.store, "presence", `${id}.json`), session(id, `claude:agent-${id}:abc`, f.workspace));
    }
    const output = readH2AReportContext({ storeRoot: f.store, workspaceRoot: f.workspace });
    assert.equal(output.entries.length, H2A_REPORT_CONTEXT_MAX_ENTRIES);
    assert.equal(output.omitted, 25);
    assert.ok(Buffer.byteLength(JSON.stringify(output), "utf8") <= H2A_REPORT_CONTEXT_MAX_BYTES);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("report-context rejects relative workspace roots", () => {
  const f = fixture();
  try {
    assert.throws(
      () => readH2AReportContext({ storeRoot: f.store, workspaceRoot: "." }),
      /absolute path/
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("report-context excludes mixed-workspace loops and never launders external blockages", () => {
  const f = fixture();
  try {
    const insideA = join(f.workspace, "repo-a");
    const insideB = join(f.workspace, "repo-b");
    mkdirSync(insideA, { recursive: true });
    mkdirSync(insideB, { recursive: true });
    writeJson(
      join(f.store, "presence", "ambiguous-inside.json"),
      session("ambiguous-inside", "claude:ambiguous:ghi", f.workspace)
    );
    writeJson(
      join(f.store, "presence", "ambiguous-outside.json"),
      session("ambiguous-outside", "claude:ambiguous:ghi", f.outside)
    );
    writeJson(
      join(f.store, "presence", "multi-inside-a.json"),
      session("multi-inside-a", "claude:multi-inside:jkl", insideA)
    );
    writeJson(
      join(f.store, "presence", "multi-inside-b.json"),
      session("multi-inside-b", "claude:multi-inside:jkl", insideB)
    );
    writeJson(join(f.store, "loops", "mixed", "state.json"), {
      id: "mixed",
      ownerSystem: "h2a",
      name: "Mixed loop",
      goal: "OUTSIDE_PROJECT_CONFIDENTIAL",
      status: "running",
      repos: [{ path: f.workspace }, { path: f.outside }],
      refs: [],
      agents: [
        {
          id: "inside",
          host: "claude",
          role: "review",
          placement: "local",
          status: "working",
          h2aInstance: "claude:inside:abc",
          launch: { workspace: f.workspace }
        },
        {
          id: "outside",
          host: "claude",
          role: "review",
          placement: "local",
          status: "working",
          h2aInstance: "claude:outside:def",
          launch: { workspace: f.outside }
        }
      ],
      policy: {},
      createdAt: "2026-07-14T10:00:00.000Z",
      updatedAt: "2026-07-14T10:01:00.000Z"
    });
    writeJson(join(f.store, "blockage", "claude__outside__def.json"), {
      instance: "claude:outside:def",
      scope: "scope:outside",
      reason: "OUTSIDE_BLOCKAGE_SECRET",
      needs: "OUTSIDE_OWNER_SECRET",
      raisedAt: "2026-07-14T10:02:00.000Z"
    });
    writeJson(join(f.store, "blockage", "claude__ambiguous__ghi.json"), {
      instance: "claude:ambiguous:ghi",
      scope: "scope:ambiguous",
      reason: "AMBIGUOUS_BLOCKAGE_SECRET",
      raisedAt: "2026-07-14T10:02:00.000Z"
    });
    writeJson(join(f.store, "blockage", "claude__multi-inside__jkl.json"), {
      instance: "claude:multi-inside:jkl",
      scope: "scope:multi-inside",
      reason: "MULTI_INSIDE_BLOCKAGE_SECRET",
      raisedAt: "2026-07-14T10:02:00.000Z"
    });

    const serialized = JSON.stringify(
      readH2AReportContext({ storeRoot: f.store, workspaceRoot: f.workspace })
    );
    assert.doesNotMatch(serialized, /OUTSIDE_/);
    assert.doesNotMatch(serialized, /AMBIGUOUS_BLOCKAGE_SECRET/);
    assert.doesNotMatch(serialized, /MULTI_INSIDE_BLOCKAGE_SECRET/);
    assert.doesNotMatch(serialized, /claude:outside:def/);
    assert.doesNotMatch(serialized, /h2a:loop:mixed/);
    assert.doesNotMatch(serialized, /h2a:blockage:claude:ambiguous:ghi/);
    assert.doesNotMatch(serialized, /h2a:blockage:claude:multi-inside:jkl/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

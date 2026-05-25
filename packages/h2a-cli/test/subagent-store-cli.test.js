import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-subagent-"));
}

const agent = {
  id: "claude:proj-1",
  instance: "claude:proj-1",
  roles: ["AGENTS"],
  scopes: ["scope:demo"],
  capabilities: ["negotiate", "research"],
  endpoints: [],
  publicKeys: [],
  acceptedPolicies: [],
  createdAt: "2026-05-25T00:00:00.000Z"
};

const binding = (over = {}) => ({
  id: "claude:proj-1~researcher",
  parentInstance: "claude:proj-1",
  name: "researcher",
  createdAt: "2026-05-25T00:00:01.000Z",
  ...over
});

test("registerSubagent persists a binding readable by find/list (DEC-068)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding({ capabilities: ["research"] }));
    assert.ok(store.findSubagent("claude:proj-1~researcher"));
    assert.equal(store.listSubagents().length, 1);
    assert.equal(store.listSubagentsOf("claude:proj-1").length, 1);
    assert.equal(store.listSubagentsOf("claude:other").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerSubagent rejects an unregistered parent", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    assert.throws(() => store.registerSubagent(binding()), /parent not registered/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerSubagent rejects a non-AGENTS parent", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance({ ...agent, roles: ["CONDUCTOR"] });
    assert.throws(() => store.registerSubagent(binding()), /parent-not-agents/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerSubagent rejects capabilities exceeding the parent", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    assert.throws(
      () => store.registerSubagent(binding({ capabilities: ["sign"] })),
      /capabilities-exceed-parent/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerSubagent rejects a duplicate id", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    assert.throws(() => store.registerSubagent(binding()), /already registered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd: () => process.cwd()
    },
    out: () => stdout,
    err: () => stderr
  };
}

test("h2a subagent register + list round-trip via the CLI", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);

    const reg = captureStreams();
    const rcReg = runCli(
      [
        "subagent",
        "register",
        "--root",
        root,
        "--parent",
        "claude:proj-1",
        "--name",
        "researcher",
        "--capabilities",
        "research"
      ],
      reg.streams
    );
    assert.equal(rcReg, 0);
    const regParsed = JSON.parse(reg.out());
    assert.equal(regParsed.ok, true);
    assert.equal(regParsed.id, "claude:proj-1~researcher");

    const ls = captureStreams();
    const rcList = runCli(
      ["subagent", "list", "--root", root, "--parent", "claude:proj-1"],
      ls.streams
    );
    assert.equal(rcList, 0);
    const entries = JSON.parse(ls.out());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "researcher");
    assert.deepEqual(entries[0].capabilities, ["research"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent register on a non-AGENTS parent exits 2 (state error)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance({ ...agent, roles: ["CONDUCTOR"] });
    const cap = captureStreams();
    const rc = runCli(
      ["subagent", "register", "--root", root, "--parent", "claude:proj-1", "--name", "x"],
      cap.streams
    );
    assert.equal(rc, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent register without --parent/--name exits 1", () => {
  const root = freshRoot();
  try {
    const cap = captureStreams();
    const rc = runCli(["subagent", "register", "--root", root, "--name", "x"], cap.streams);
    assert.equal(rc, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

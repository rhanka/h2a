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

const envelope = (id) => ({
  protocol: "sentropic.h2a",
  version: "0.1",
  id,
  type: "propose",
  actor: { instance: "claude:proj-1", role: "AGENTS", scope: "scope:demo" },
  body: { task: "x" },
  createdAt: "2026-05-25T00:00:02.000Z"
});

test("routeToSubagent delivers to a registered subagent's inbox (DEC-070)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("e1"));
    const inbox = store.readInbox("claude:proj-1~researcher");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].id, "e1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routeToSubagent rejects an unregistered subagent", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    assert.throws(
      () => store.routeToSubagent("claude:proj-1~ghost", envelope("e2")),
      /not registered/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("routeToSubagent can target the outbox", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("e3"), "outbox");
    assert.equal(store.readOutbox("claude:proj-1~researcher").length, 1);
    assert.equal(store.readInbox("claude:proj-1~researcher").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSubagentInboxes fans in every subagent of a parent (DEC-070)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding({ id: "claude:proj-1~a", name: "a" }));
    store.registerSubagent(binding({ id: "claude:proj-1~b", name: "b" }));
    store.routeToSubagent("claude:proj-1~a", envelope("ea"));
    const fanIn = store.readSubagentInboxes("claude:proj-1");
    assert.equal(fanIn.length, 2);
    const a = fanIn.find((e) => e.subagent === "claude:proj-1~a");
    const b = fanIn.find((e) => e.subagent === "claude:proj-1~b");
    assert.equal(a.envelopes.length, 1);
    assert.equal(b.envelopes.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent route + inbox fan-in round-trip via the CLI", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());

    const r = captureStreams();
    const rcRoute = runCli(
      [
        "subagent",
        "route",
        "--root",
        root,
        "--to",
        "claude:proj-1~researcher",
        "--json",
        JSON.stringify(envelope("cli-e1"))
      ],
      r.streams
    );
    assert.equal(rcRoute, 0);
    assert.equal(JSON.parse(r.out()).to, "claude:proj-1~researcher");

    const f = captureStreams();
    const rcInbox = runCli(
      ["subagent", "inbox", "--root", root, "--parent", "claude:proj-1"],
      f.streams
    );
    assert.equal(rcInbox, 0);
    const fanIn = JSON.parse(f.out());
    assert.equal(fanIn[0].subagent, "claude:proj-1~researcher");
    assert.equal(fanIn[0].envelopes[0].id, "cli-e1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent route to an unregistered subagent exits 2", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    const cap = captureStreams();
    const rc = runCli(
      [
        "subagent",
        "route",
        "--root",
        root,
        "--to",
        "claude:proj-1~ghost",
        "--json",
        JSON.stringify(envelope("g1"))
      ],
      cap.streams
    );
    assert.equal(rc, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerSubagent + routeToSubagent append audit events (DEC-071)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("a1"));
    store.routeToSubagent("claude:proj-1~researcher", envelope("a2"), "outbox");

    const events = store.readSubagentAudit("claude:proj-1~researcher");
    assert.equal(events.length, 3);
    assert.equal(events[0].type, "registered");
    assert.equal(events[1].type, "routed");
    assert.equal(events[1].envelopeId, "a1");
    assert.equal(events[1].mailbox, "inbox");
    assert.equal(events[2].mailbox, "outbox");
    // every event carries a timestamp + the subagent id
    for (const e of events) {
      assert.equal(e.subagent, "claude:proj-1~researcher");
      assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit survives an inbox pop (it is history, not current state)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("p1"));
    store.popInboxMessage("claude:proj-1~researcher", "p1");
    // fan-in now shows an empty inbox...
    assert.equal(
      store.readSubagentInboxes("claude:proj-1")[0].envelopes.length,
      0
    );
    // ...but the audit still records the routing.
    const routed = store
      .readSubagentAudit("claude:proj-1~researcher")
      .filter((e) => e.type === "routed");
    assert.equal(routed.length, 1);
    assert.equal(routed[0].envelopeId, "p1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSubagentAuditOf aggregates events across a parent's subagents", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding({ id: "claude:proj-1~a", name: "a" }));
    store.registerSubagent(binding({ id: "claude:proj-1~b", name: "b" }));
    store.routeToSubagent("claude:proj-1~a", envelope("x"));
    const all = store.readSubagentAuditOf("claude:proj-1");
    // 2 registered + 1 routed
    assert.equal(all.length, 3);
    assert.equal(all.filter((e) => e.type === "registered").length, 2);
    assert.equal(all.filter((e) => e.type === "routed").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent audit --id lists a subagent's events via the CLI", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("c1"));

    const cap = captureStreams();
    const rc = runCli(
      ["subagent", "audit", "--root", root, "--id", "claude:proj-1~researcher"],
      cap.streams
    );
    assert.equal(rc, 0);
    const events = JSON.parse(cap.out());
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "registered");
    assert.equal(events[1].type, "routed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent audit without --id/--parent exits 1", () => {
  const root = freshRoot();
  try {
    const cap = captureStreams();
    const rc = runCli(["subagent", "audit", "--root", root], cap.streams);
    assert.equal(rc, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("revokeSubagent flips status and refuses further routing (DEC-072)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    assert.equal(store.subagentStatus("claude:proj-1~researcher"), "active");

    store.revokeSubagent("claude:proj-1~researcher", "takeover");
    assert.equal(store.subagentStatus("claude:proj-1~researcher"), "revoked");

    // routing to a revoked subagent is refused
    assert.throws(
      () => store.routeToSubagent("claude:proj-1~researcher", envelope("r1")),
      /revoked/i
    );
    // the revocation is recorded in the audit with its reason
    const revoked = store
      .readSubagentAudit("claude:proj-1~researcher")
      .find((e) => e.type === "revoked");
    assert.ok(revoked);
    assert.equal(revoked.reason, "takeover");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("envelopes routed before revocation stay readable by the parent (takeover)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.routeToSubagent("claude:proj-1~researcher", envelope("keep1"));
    store.revokeSubagent("claude:proj-1~researcher");
    // the parent reclaims pending work via the fan-in
    const fanIn = store.readSubagentInboxes("claude:proj-1");
    assert.equal(fanIn[0].envelopes.length, 1);
    assert.equal(fanIn[0].envelopes[0].id, "keep1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("revoking twice is a state error", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());
    store.revokeSubagent("claude:proj-1~researcher");
    assert.throws(
      () => store.revokeSubagent("claude:proj-1~researcher"),
      /already revoked/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a subagent revoke via CLI; list shows status; later route exits 2", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(agent);
    store.registerSubagent(binding());

    const rev = captureStreams();
    const rcRev = runCli(
      ["subagent", "revoke", "--root", root, "--id", "claude:proj-1~researcher", "--reason", "takeover"],
      rev.streams
    );
    assert.equal(rcRev, 0);
    assert.equal(JSON.parse(rev.out()).status, "revoked");

    const ls = captureStreams();
    runCli(["subagent", "list", "--root", root, "--parent", "claude:proj-1"], ls.streams);
    assert.equal(JSON.parse(ls.out())[0].status, "revoked");

    const rt = captureStreams();
    const rcRoute = runCli(
      [
        "subagent",
        "route",
        "--root",
        root,
        "--to",
        "claude:proj-1~researcher",
        "--json",
        JSON.stringify(envelope("after-revoke"))
      ],
      rt.streams
    );
    assert.equal(rcRoute, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

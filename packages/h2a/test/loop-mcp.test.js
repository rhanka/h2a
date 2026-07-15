import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  handleLoopCreate,
  handleLoopDone,
  handleLoopJoin,
  handleLoopList,
  handleLoopReport,
  handleLoopStatus,
  handleLoopStop
} from "../dist/runtime/mcp/handlers.js";
import { createObjectiveLoop, listLoopEvents, listObjectiveLoops } from "../dist/runtime/loop/index.js";

function freshRoot() {
  return join(mkdtempSync(join(tmpdir(), "h2a-loopmcp-")), ".h2a");
}

test("h2a_loop_list projette les loops (read-only)", () => {
  const root = freshRoot();
  try {
    const one = createObjectiveLoop(root, { name: "one", goal: "g1" }, 123);
    const two = createObjectiveLoop(root, { name: "two", goal: "g2" }, 123);
    const three = createObjectiveLoop(root, { name: "three", goal: "g3" }, 123);
    assert.deepEqual(
      [one.id, two.id, three.id],
      ["loop-3f", "loop-3f-1", "loop-3f-2"],
      "same-millisecond automatic ids are reserved uniquely"
    );
    createObjectiveLoop(root, { id: "fixed", goal: "g4" }, 123);
    assert.throws(
      () => createObjectiveLoop(root, { id: "fixed", goal: "duplicate" }, 123),
      /loop already exists: fixed/
    );
    const res = handleLoopList(root);
    assert.equal(res.kind, "loop-list");
    assert.equal(res.loops.length, 4);
    assert.ok(res.loops.every((l) => typeof l.id === "string" && typeof l.status === "string"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_loop_status renvoie l'état + événements ; erreurs sur loopId manquant/inconnu", () => {
  const root = freshRoot();
  try {
    const loop = createObjectiveLoop(root, { name: "one", goal: "g1" });
    const ok = handleLoopStatus(root, { loopId: loop.id });
    assert.equal(ok.kind, "loop-status");
    assert.equal(ok.loop.id, loop.id);
    assert.ok(Array.isArray(ok.recentEvents));

    assert.ok("error" in handleLoopStatus(root, {}), "loopId manquant → error");
    assert.ok("error" in handleLoopStatus(root, { loopId: "nope" }), "loop inconnu → error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_loop_create/join/report/done/stop write MVP loop events", () => {
  const root = freshRoot();
  try {
    const created = handleLoopCreate(root, {
      id: "mcp-loop",
      goal: "ship",
      instance: "claude:h2a:123",
      agentId: "agent-1"
    });
    assert.equal(created.kind, "loop-created");

    const reported = handleLoopReport(root, { loopId: "mcp-loop", agentId: "agent-1", note: "progress" });
    assert.equal(reported.kind, "loop-reported");

    const done = handleLoopDone(root, { loopId: "mcp-loop", agentId: "agent-1", note: "done" });
    assert.equal(done.kind, "loop-done-declared");
    assert.equal(done.loop.status, "done");

    const stopped = handleLoopStop(root, { loopId: "missing", reason: "x" });
    assert.ok("error" in stopped);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_loop_create refuses accidental empty loops but preserves explicit staged creation", () => {
  const root = freshRoot();
  try {
    const refused = handleLoopCreate(root, { id: "accidental-empty", goal: "ship" });
    assert.ok("error" in refused);
    assert.match(refused.error, /instance|allowEmpty/);
    assert.equal(listObjectiveLoops(root).length, 0, "refusal must happen before persistence");

    const staged = handleLoopCreate(root, { id: "intentional-empty", goal: "ship", allowEmpty: true });
    assert.equal(staged.kind, "loop-created");
    assert.deepEqual(staged.loop.agents, []);

    const enrolled = handleLoopCreate(root, {
      id: "created-enrolled",
      goal: "ship",
      instance: "codex:h2a:abc",
      agentId: "conductor",
      role: "conductor"
    });
    assert.equal(enrolled.kind, "loop-created");
    assert.equal(enrolled.loop.agents[0].id, "conductor");
    assert.equal(enrolled.loop.agents[0].h2aInstance, "codex:h2a:abc");
    assert.deepEqual(
      listLoopEvents(root, "created-enrolled").map((event) => event.type),
      ["loop.created", "loop.agent-joined"]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_loop_report recovers an empty loop only with explicit autoJoin and instance", () => {
  const root = freshRoot();
  try {
    createObjectiveLoop(root, { id: "empty", goal: "ship" });

    const deadEnd = handleLoopReport(root, { loopId: "empty", instance: "codex:h2a:self", note: "started" });
    assert.ok("error" in deadEnd);
    assert.match(deadEnd.error, /h2a_loop_join/);

    const missingIdentity = handleLoopReport(root, { loopId: "empty", note: "started", autoJoin: true });
    assert.ok("error" in missingIdentity);
    assert.match(missingIdentity.error, /instance/);

    const recovered = handleLoopReport(root, {
      loopId: "empty",
      instance: "codex:h2a:self",
      agentId: "conductor",
      note: "started",
      autoJoin: true
    });
    assert.equal(recovered.kind, "loop-reported");
    assert.equal(recovered.loop.agents[0].id, "conductor");
    assert.deepEqual(
      listLoopEvents(root, "empty").map((event) => event.type),
      ["loop.created", "loop.agent-joined", "loop.agent-report"]
    );

    const wrongAgent = handleLoopReport(root, {
      loopId: "empty",
      instance: "claude:h2a:other",
      note: "hijack",
      autoJoin: true
    });
    assert.ok("error" in wrongAgent);
    assert.match(wrongAgent.error, /h2a_loop_join/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_loop_create/join persist only complete, supported launch specs", () => {
  const root = freshRoot();
  const workspace = dirname(root);
  const launch = {
    profile: "codex",
    workspace,
    prompt: "Resume the loop and join agent-1",
    model: "gpt-5.6-terra",
    effort: "xhigh",
    name: "loop-agent-1",
    gateway: "off"
  };
  try {
    const partial = handleLoopCreate(root, {
      id: "partial",
      goal: "ship",
      instance: "codex:h2a:self",
      launch: { ...launch, model: undefined }
    });
    assert.ok("error" in partial);
    assert.match(partial.error, /model/);
    assert.equal(listObjectiveLoops(root).length, 0, "invalid launch must fail before create persistence");

    const unsupported = handleLoopCreate(root, {
      id: "unsupported",
      goal: "ship",
      instance: "gemini:h2a:self",
      launch: { ...launch, profile: "gemini" }
    });
    assert.ok("error" in unsupported);
    assert.match(unsupported.error, /claude or codex/);

    const created = handleLoopCreate(root, {
      id: "launchable",
      goal: "ship",
      instance: "codex:h2a:self",
      agentId: "agent-1",
      launch
    });
    assert.equal(created.kind, "loop-created");
    assert.deepEqual(created.loop.agents[0].launch, launch);

    const configuredLater = handleLoopJoin(root, {
      loopId: "launchable",
      instance: "codex:h2a:self",
      agentId: "agent-1",
      launch
    });
    assert.equal(configuredLater.kind, "loop-joined");

    const changed = handleLoopJoin(root, {
      loopId: "launchable",
      instance: "codex:h2a:self",
      agentId: "agent-1",
      launch: { ...launch, name: "different" }
    });
    assert.ok("error" in changed);
    assert.match(changed.error, /different launch spec/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

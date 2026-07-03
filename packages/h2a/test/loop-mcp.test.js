import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleLoopList, handleLoopStatus } from "../dist/runtime/mcp/handlers.js";
import { createObjectiveLoop } from "../dist/runtime/loop/index.js";

function freshRoot() {
  return join(mkdtempSync(join(tmpdir(), "h2a-loopmcp-")), ".h2a");
}

test("h2a_loop_list projette les loops (read-only)", () => {
  const root = freshRoot();
  try {
    createObjectiveLoop(root, { name: "one", goal: "g1" });
    createObjectiveLoop(root, { name: "two", goal: "g2" });
    const res = handleLoopList(root);
    assert.equal(res.kind, "loop-list");
    assert.equal(res.loops.length, 2);
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

import test from "node:test";
import assert from "node:assert/strict";

// Pure: escalations in an inbox → pending decisions for an agent.
import { pendingDecisionsFromInbox } from "../dist/runtime/loop/engine/adapters.js";

test("une enveloppe escalate → décision en attente {id, forAgent}", () => {
  const out = pendingDecisionsFromInbox(
    [{ id: "e1", type: "escalate" }],
    "agent-1"
  );
  assert.deepEqual(out, [{ id: "e1", forAgent: "agent-1" }]);
});

test("aucune escalate → vide", () => {
  const out = pendingDecisionsFromInbox(
    [{ id: "p1", type: "propose" }, { id: "a1", type: "accept" }, { id: "ev", type: "event" }],
    "agent-1"
  );
  assert.deepEqual(out, []);
});

test("plusieurs escalate → plusieurs décisions ; les autres types ignorés", () => {
  const out = pendingDecisionsFromInbox(
    [
      { id: "e1", type: "escalate" },
      { id: "p1", type: "propose" },
      { id: "e2", type: "escalate" }
    ],
    "a9"
  );
  assert.deepEqual(out, [
    { id: "e1", forAgent: "a9" },
    { id: "e2", forAgent: "a9" }
  ]);
});

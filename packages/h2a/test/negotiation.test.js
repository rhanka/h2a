import assert from "node:assert/strict";
import test from "node:test";

import { assertValidNegotiationState } from "../dist/index.js";

test("assertValidNegotiationState accepts declared negotiation states", () => {
  assert.equal(assertValidNegotiationState("draft"), "draft");
  assert.equal(assertValidNegotiationState("stabilized"), "stabilized");
});

test("assertValidNegotiationState rejects unsupported negotiation states", () => {
  assert.throws(
    () => assertValidNegotiationState("pending"),
    /Unknown negotiation state/
  );
});

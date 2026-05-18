import assert from "node:assert/strict";
import test from "node:test";

import { createEnvelope, isH2AEnvelope } from "../dist/index.js";

test("createEnvelope stamps the canonical protocol fields", () => {
  const envelope = createEnvelope({
    id: "env-001",
    type: "register",
    actor: {
      instance: "conductor:01",
      role: "CONDUCTOR",
      scope: "scope:principal/antoine"
    },
    body: {
      capabilities: ["negotiate"]
    }
  });

  assert.equal(envelope.protocol, "sentropic.h2a");
  assert.equal(envelope.version, "0.1");
  assert.equal(envelope.actor.role, "CONDUCTOR");
  assert.deepEqual(envelope.body, {
    capabilities: ["negotiate"]
  });
});

test("isH2AEnvelope rejects malformed envelopes", () => {
  assert.equal(isH2AEnvelope(null), false);
  assert.equal(
    isH2AEnvelope({
      protocol: "sentropic.h2a",
      version: "0.1",
      id: "env-002"
    }),
    false
  );
});

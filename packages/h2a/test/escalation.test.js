import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_ESCALATION_AUTHORITY_KINDS,
  H2A_ESCALATION_CHANNELS,
  assertEscalationTargetResolved,
  resolveEscalationTarget
} from "../dist/index.js";

const plan = {
  kind: "ENFORCEMENT_PLAN",
  id: "enforcement:program-x",
  scope: "scope:federation/program-x",
  controls: [],
  escalations: [
    {
      trigger: "policy-conflict",
      scope: "scope:federation/program-x",
      channel: "decide",
      authorityKind: "EXECUTIF",
      target: "executif:program-x"
    },
    {
      trigger: "secret-leak",
      scope: "scope:engagement/ship-v1",
      channel: "alert",
      domain: "security",
      authorityKind: "CONTROL",
      target: "control:security"
    },
    {
      trigger: "blocked-local-decision",
      scope: "scope:engagement/ship-v1",
      channel: "decide",
      authorityKind: "PRINCIPAL",
      target: "principal:antoine"
    }
  ],
  triggers: []
};

test("H2A_ESCALATION_* constants expose the DEC-024 target vocabulary", () => {
  assert.deepEqual([...H2A_ESCALATION_CHANNELS], ["advise", "decide", "alert"]);
  assert.deepEqual([...H2A_ESCALATION_AUTHORITY_KINDS], [
    "PRINCIPAL",
    "EXECUTIF",
    "QUORUM",
    "CONTROL",
    "EXTERNAL_AUTHORITY",
    "RECOURSE"
  ]);
});

test("resolveEscalationTarget routes federation decisions to EXECUTIF when declared", () => {
  const result = resolveEscalationTarget(plan, {
    scope: "scope:federation/program-x",
    channel: "decide",
    trigger: "policy-conflict"
  });
  assert.deepEqual(result, {
    ok: true,
    scope: "scope:federation/program-x",
    channel: "decide",
    trigger: "policy-conflict",
    authorityKind: "EXECUTIF",
    target: "executif:program-x",
    source: "enforcement-plan"
  });
});

test("resolveEscalationTarget prefers channel+domain specific CONTROL alert routes", () => {
  const result = resolveEscalationTarget(plan, {
    scope: "scope:engagement/ship-v1",
    channel: "alert",
    trigger: "secret-leak",
    domain: "security"
  });
  assert.equal(result.ok, true);
  assert.equal(result.authorityKind, "CONTROL");
  assert.equal(result.target, "control:security");
  assert.equal(result.domain, "security");
});

test("resolveEscalationTarget uses explicit principal fallback only when plan has no route", () => {
  const result = resolveEscalationTarget(
    plan,
    {
      scope: "scope:engagement/unknown",
      channel: "decide",
      trigger: "blocked-local-decision"
    },
    { fallbackPrincipal: "principal:antoine" }
  );
  assert.deepEqual(result, {
    ok: true,
    scope: "scope:engagement/unknown",
    channel: "decide",
    trigger: "blocked-local-decision",
    authorityKind: "PRINCIPAL",
    target: "principal:antoine",
    source: "fallback-principal"
  });
});

test("resolveEscalationTarget reports unresolved routes instead of inventing an authority", () => {
  const result = resolveEscalationTarget(plan, {
    scope: "scope:engagement/unknown",
    channel: "advise",
    trigger: "needs-help"
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /no escalation target/);
  assert.match(result.issues.join("\n"), /scope:engagement\/unknown/);
});

test("resolveEscalationTarget rejects unknown channels", () => {
  const result = resolveEscalationTarget(plan, {
    scope: "scope:x",
    channel: "page",
    trigger: "x"
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /unknown escalation channel/);
});

test("assertEscalationTargetResolved throws on unresolved targets", () => {
  assert.doesNotThrow(() =>
    assertEscalationTargetResolved(
      resolveEscalationTarget(plan, {
        scope: "scope:federation/program-x",
        channel: "decide",
        trigger: "policy-conflict"
      })
    )
  );
  assert.throws(
    () =>
      assertEscalationTargetResolved(
        resolveEscalationTarget(plan, {
          scope: "scope:engagement/unknown",
          channel: "advise",
          trigger: "needs-help"
        })
      ),
    /no escalation target/
  );
});

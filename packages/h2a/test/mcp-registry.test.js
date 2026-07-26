import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticatedPrincipal,
  createPrincipalScopedRegistryBroker,
  established,
  secretRef
} from "../dist/index.js";

const AS_OF = "2026-07-26T12:00:00.000Z";
const FAKE_SECRET_REF = "vault://test/owner-mail";

const reviewedMailServer = {
  id: "mail-readonly",
  tools: [
    {
      name: "mail.search",
      description: "Search mail for the authenticated principal.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false
      }
    },
  ]
};

function grant(overrides = {}) {
  return {
    connectorRef: "connector:owner-mail",
    serverId: "mail-readonly",
    secretRef: secretRef(FAKE_SECRET_REF),
    mayUseToolNames: ["mail.search"],
    active: true,
    ...overrides
  };
}

function broker({ principal = "39-auth-sub:owner", resolve, invoke, audit } = {}) {
  return createPrincipalScopedRegistryBroker({
    principal: authenticatedPrincipal(principal),
    catalogue: [reviewedMailServer],
    grantResolver: { resolve: resolve ?? (() => established([grant()], AS_OF)) },
    adapters: {
      "mail-readonly": {
        invoke:
          invoke ??
          (() => established({ messages: [] }, AS_OF))
      }
    },
    audit,
    now: () => AS_OF
  });
}

test("principal-scoped broker projects one reviewed mail tool and invokes it with only a secretRef", () => {
  const upstreamCalls = [];
  const audit = [];
  const registry = broker({
    invoke(input) {
      upstreamCalls.push(input);
      return established(
        {
          messages: [{ id: "message-1", subject: "Quarterly report" }]
        },
        AS_OF
      );
    },
    audit(event) {
      audit.push(event);
    }
  });

  const listed = registry.listTools();
  assert.equal(listed.kind, "established");
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["mail.search"]);
  assert.doesNotMatch(JSON.stringify(listed), /connector:owner-mail|vault:\/\/test\/owner-mail/);

  const called = registry.callTool({
    name: "mail.search",
    arguments: { query: "from:finance" },
    correlationId: "corr-1"
  });
  assert.deepEqual(called, {
    kind: "completed",
    output: {
      kind: "mail.search.result",
      messages: [{ id: "message-1", subject: "Quarterly report" }]
    }
  });
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].secretRef, FAKE_SECRET_REF);
  assert.equal(upstreamCalls[0].connectorRef, "connector:owner-mail");
  assert.equal(upstreamCalls[0].tool.name, "mail.search");
  assert.deepEqual(upstreamCalls[0].arguments, { query: "from:finance" });

  // Audit is metadata-only: no credential handle, arguments, or provider result.
  assert.doesNotMatch(JSON.stringify(audit), /vault:\/\/test\/owner-mail|from:finance|Quarterly report/);
  assert.deepEqual(audit.map((event) => event.outcome), ["listed", "called"]);
});

test("an agent sees only its effective mayUse projection, not the server catalogue or another principal grant", () => {
  const resolvedPrincipals = [];
  const resolve = (principal) => {
    resolvedPrincipals.push(principal);
    return established(
      principal === "39-auth-sub:owner" ? [grant()] : [],
      AS_OF
    );
  };
  const owner = broker({ resolve });
  const unbound = broker({ principal: "39-auth-sub:unbound", resolve });

  const ownerTools = owner.listTools();
  const unboundTools = unbound.listTools();
  assert.equal(ownerTools.kind, "established");
  assert.equal(unboundTools.kind, "established");
  assert.deepEqual(ownerTools.tools.map((tool) => tool.name), ["mail.search"]);
  assert.deepEqual(unboundTools.tools, []);
  assert.doesNotMatch(JSON.stringify(ownerTools), /mail-readonly|connector:owner-mail/);
  assert.doesNotMatch(JSON.stringify(unboundTools), /mail-readonly|connector:owner-mail/);
  assert.deepEqual(resolvedPrincipals, ["39-auth-sub:owner", "39-auth-sub:unbound"]);
});

test("a source failure is unavailable, never an established empty mayUse set", () => {
  const registry = broker({
    // This deliberately uses a status the broker does not enumerate. The
    // positive established check must still classify it as unavailable.
    resolve: () => ({
      kind: "future_upstream_transport_failure",
      state: "failure",
      source: "upstream",
      code: "upstream_timeout",
      retryable: true,
      observedAt: AS_OF
    })
  });

  const result = registry.listTools();
  assert.deepEqual(result, {
    kind: "unavailable",
    source: "upstream",
    code: "upstream_timeout",
    retryable: true,
    observedAt: AS_OF
  });
  assert.notEqual(result.kind, "established");
  assert.notDeepEqual(result, { kind: "established", tools: [], asOf: AS_OF });
});

test("unavailable never forwards arbitrary source diagnostics into the agent-visible contract", () => {
  const registry = broker({
    resolve: () => ({
      kind: "future_source_failure",
      state: "failure",
      source: "provider diagnostic fake-access-token",
      code: "provider diagnostic fake-access-token",
      retryable: true,
      observedAt: AS_OF
    })
  });

  const result = registry.listTools();
  assert.deepEqual(result, {
    kind: "unavailable",
    source: "upstream",
    code: "source_unavailable",
    retryable: true,
    observedAt: AS_OF
  });
  assert.doesNotMatch(JSON.stringify(result), /fake-access-token/);
});

test("a revoked grant is checked again at call time after a tool list", () => {
  let active = true;
  let invocations = 0;
  const registry = broker({
    resolve: () => established([grant({ active })], AS_OF),
    invoke: () => {
      invocations += 1;
      return established({ messages: [] }, AS_OF);
    }
  });

  assert.equal(registry.listTools().kind, "established");
  active = false;
  assert.deepEqual(
    registry.callTool({ name: "mail.search", arguments: { query: "inbox" }, correlationId: "corr-revoked" }),
    { kind: "not_authorized" }
  );
  assert.equal(invocations, 0);
});

test("an upstream invocation failure is returned as unavailable rather than a business empty result", () => {
  const registry = broker({
    invoke: () => ({
      kind: "new_adapter_failure_state",
      state: "failure",
      source: "upstream",
      code: "upstream_protocol_error",
      retryable: false,
      observedAt: AS_OF
    })
  });

  assert.deepEqual(
    registry.callTool({ name: "mail.search", arguments: { query: "inbox" }, correlationId: "corr-upstream" }),
    {
      kind: "unavailable",
      source: "upstream",
      code: "upstream_protocol_error",
      retryable: false,
      observedAt: AS_OF
    }
  );
});

test("thrown resolver and upstream failures become unavailable rather than escaping or fabricating empty", () => {
  const resolverOutage = broker({
    resolve: () => {
      throw new Error("resolver outage containing fake-access-token");
    }
  });
  assert.deepEqual(resolverOutage.listTools(), {
    kind: "unavailable",
    source: "grant",
    code: "source_unavailable",
    retryable: true,
    observedAt: AS_OF
  });

  const upstreamOutage = broker({
    invoke: () => {
      throw new Error("upstream outage containing fake-access-token");
    }
  });
  assert.deepEqual(
    upstreamOutage.callTool({ name: "mail.search", arguments: { query: "inbox" }, correlationId: "corr-throw" }),
    {
      kind: "unavailable",
      source: "upstream",
      code: "source_unavailable",
      retryable: true,
      observedAt: AS_OF
    }
  );
});

test("a successful empty provider result stays completed and is distinguishable from unavailable", () => {
  const registry = broker({
    invoke: () => established({ messages: [] }, AS_OF)
  });
  assert.deepEqual(
    registry.callTool({ name: "mail.search", arguments: { query: "inbox" }, correlationId: "corr-empty" }),
    { kind: "completed", output: { kind: "mail.search.result", messages: [] } }
  );
});

test("the broker rebuilds its closed agent result and rejects credential-shaped request fields", () => {
  let invocations = 0;
  const registry = broker({
    invoke: () => {
      invocations += 1;
      return established(
        {
          messages: [],
          // A JavaScript adapter can violate its declared type. This field must
          // never become part of the agent DTO.
          accessToken: "fake-access-token"
        },
        AS_OF
      );
    }
  });

  assert.deepEqual(
    registry.callTool({ name: "mail.search", arguments: { query: "inbox" }, correlationId: "corr-closed" }),
    { kind: "completed", output: { kind: "mail.search.result", messages: [] } }
  );
  assert.equal(invocations, 1);

  assert.deepEqual(
    registry.callTool({
      name: "mail.search",
      arguments: { query: "inbox", accessToken: "fake-access-token" },
      correlationId: "corr-invalid"
    }),
    { kind: "invalid_arguments" }
  );
  assert.equal(invocations, 1);
});

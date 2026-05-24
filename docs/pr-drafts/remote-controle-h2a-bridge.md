# PR draft — h2a bridge schema for `@sentropic/remote-controle`

> Source: `@sentropic/h2a` v0.1.22, DEC-059. This document is a *draft* of the PR text + the schema file to add to `../remote/packages/protocol/`. It is NOT applied automatically — it lives here so the maintainer of `remote-controle` can review and adapt before opening the PR upstream.

## Target

Repository: `rhanka/remote-controle` (path: `../remote/` on this developer's machine).
Branch suggestion: `feat/h2a-bridge-schema`.
Affected paths:

- `packages/protocol/src/schemas/h2a-bridge.ts` (new file).
- `packages/protocol/src/index.ts` (re-export the new schema).
- `packages/protocol/src/types.ts` (re-export the inferred type).
- `docs/decisions/<date>-h2a-bridge.md` (new DEC mirror in remote-controle).

## Why

`@sentropic/h2a@0.1.22` (DEC-058 + DEC-059) ships a Kubernetes sidecar manifest renderer that runs `h2a mcp-serve` inside a `remote-controle` session Pod, plus a formal contract describing what the sidecar expects from the host. Today the contract is documented in h2a's `docs/k8s-sidecar.md` only; nothing in `remote-controle`'s codebase validates it. This PR adds the missing schema so the contract is enforced symmetrically.

## What the contract says (5 clauses)

```ts
// packages/protocol/src/schemas/h2a-bridge.ts
import { REMOTE_SCHEMA_BASE_URL } from "../constants.js";

export const h2aBridgeProfileSchema = {
  $id: `${REMOTE_SCHEMA_BASE_URL}/h2a-bridge-profile.schema.json`,
  title: "H2AHostBridgeProfile",
  type: "object",
  additionalProperties: false,
  required: [
    "hostId",
    "label",
    "identity",
    "lifecycle",
    "resourceLimits",
    "disclosure",
    "authBoundary",
    "references"
  ],
  properties: {
    hostId: { type: "string", const: "remote-controle" },
    label: { type: "string", minLength: 1 },

    identity: {
      type: "object",
      additionalProperties: false,
      required: ["instanceTemplate", "envVarMap", "hostHint"],
      properties: {
        instanceTemplate: {
          type: "string",
          const: "remote-controle:${SESSION_ID}"
        },
        envVarMap: {
          type: "object",
          additionalProperties: false,
          required: ["instance", "host", "root"],
          properties: {
            instance: { type: "string", const: "H2A_INSTANCE" },
            host: { type: "string", const: "H2A_HOST" },
            root: { type: "string", const: "H2A_ROOT" }
          }
        },
        hostHint: { type: "string", const: "remote-controle" }
      }
    },

    lifecycle: {
      type: "object",
      additionalProperties: false,
      required: ["stateMap", "description"],
      properties: {
        stateMap: {
          type: "object",
          additionalProperties: {
            type: "string",
            enum: ["opening", "live", "draining", "closed", "expired"]
          },
          required: ["provisioning", "running", "terminating", "ended"]
        },
        description: { type: "string" }
      }
    },

    resourceLimits: {
      type: "object",
      additionalProperties: false,
      required: ["reflected", "enforced"],
      properties: {
        reflected: { type: "boolean" },
        enforced: { type: "boolean", const: false },
        reflectedAs: { type: "string" }
      }
    },

    disclosure: {
      type: "object",
      additionalProperties: false,
      required: ["workspaceBoundary", "crossWorkspace"],
      properties: {
        workspaceBoundary: { type: "string" },
        crossWorkspace: {
          type: "string",
          enum: ["deferred", "supported", "n/a"]
        },
        crossWorkspaceReference: { type: "string" }
      }
    },

    authBoundary: {
      type: "object",
      additionalProperties: false,
      required: ["transport", "enforcement"],
      properties: {
        transport: { type: "string" },
        enforcement: { type: "string" }
      }
    },

    references: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
      minItems: 1
    }
  }
} as const;
```

## How `remote-controle` would adopt it

1. **Add the schema** (file above) under `packages/protocol/src/schemas/`.
2. **Re-export** from `packages/protocol/src/index.ts`:
   ```ts
   import { h2aBridgeProfileSchema } from "./schemas/h2a-bridge.js";
   export type H2AHostBridgeProfile = FromSchema<typeof h2aBridgeProfileSchema>;
   ```
3. **Validate** at session creation time. When `k8s-orchestrator` builds a session Pod with an h2a sidecar, it should look up the canonical profile and pass the identity env vars exactly as the schema requires. A small helper `getH2ABridgeProfile()` can hard-code the only V1 profile (`remote-controle`).
4. **Mirror DEC** in `remote-controle/docs/decisions/<date>-h2a-bridge.md` referencing h2a's DEC-059.

## Versioning

- h2a side: shipped in `@sentropic/h2a@0.1.22`. Any future schema change to the bridge profile requires a new DEC + a minor bump.
- remote-controle side: this PR is the V1 baseline. Both projects agree to cross-reference DECs for future bridge changes.

## Backward compatibility

This is a **new** schema; no existing remote-controle code paths are affected. The existing session/sidecar lifecycle keeps working — this PR only adds explicit validation.

## Open questions for `remote-controle` reviewer

- Should the schema live in `packages/protocol/src/schemas/` (consistent with `session.ts`, `actor.ts`) or under a new `bridges/` subdir if more host bridges are anticipated?
- Should `H2AHostBridgeProfile` be exposed through the operator UI (so an operator can confirm at runtime which h2a version a session is bridged to)?
- Is `getH2ABridgeProfile()` a function of `packages/protocol` (pure) or `packages/k8s-orchestrator` (where it gets actually instantiated)?

## Once merged

- h2a's `docs/k8s-sidecar.md` adds a note linking to the schema PR.
- Subsequent h2a releases that change the bridge contract open paired PRs in both repos.

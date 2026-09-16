# Cluster-mesh backend for h2a send — PR #267

The owner selected 0.98.0 for the cluster-mesh backend and N2 reception gate.
The existing 0.97.1 local send contract stays the default.

- D1: Share existing recipient resolution, active-key checks and signed H2A
  envelope construction. Select `local|cluster-mesh` using `--backend` on
  `h2a send` / `h2a mcp-serve`, `backend` on `h2a_send`, or the deployment
  default `H2A_MESSAGE_BACKEND`. Local calls retain their synchronous results.
- D2: Use the actual `ClusterMeshMessageClient` from pinned 0.10.1. Send the
  signed H2A envelope as its message, with kind `text`. Only the mesh receiver
  deposits it into the recipient inbox. A successful send reports transport
  acceptance (`messageId`), not receiver processing or successful wake.
- D3: The deployment supplies `ClusterMeshMessagingPort` and authenticated
  `MessagingProductContext`. 0.10.1 supplies a port and bounded local store,
  not a network transport. `H2A_CLUSTER_MESH_MODULE` names an absolute trusted
  deployment module exporting `createMessaging({root, instance})`, returning
  `{store, context}`. Configure it in the launcher environment, never tool
  arguments. Its factory may connect to an existing authenticated service;
  a fresh in-memory store per CLI process cannot deliver across processes.
- D4: h2a derives the custody signer from its active local Ed25519 identity.
  `issuerId` is the sender instance; `keyId` is SHA-256 of its DER SPKI public
  key. Both peers must register each other's public keys in their local h2a
  registries. The transport context principal must match the signing identity.
- D5 (N2): After `receiveMessages`, check issuer/sender/recipient binding and
  `messageEnvelopeSignaturePayload` with upstream `verifyCustodySignature`,
  resolving only active peer keys. Check the nested H2A signature and matching
  actor/target before persisting, notifying, waking, or acknowledging. A poison
  message is rejected without throwing and valid later messages still drain.
  Rejected deliveries are not acknowledged as processed and retain the mesh
  visibility lease/retry behavior. The upstream client likewise skips malformed
  wire envelopes. No local inbox entry is created for either case.
- D6: The MCP sidecar drains for its auto-open identity with serialized polling;
  existing inbox notification/wake handling sees only verified envelopes.
  Existing inbox read/pop tools continue to work. Acknowledgement follows
  persistence; retries reuse the signed envelope id (at-least-once transport).
- D7: Root `npm test` and an explicit CI messaging step exercise the real store,
  compiled CLI across an HTTP/process boundary, MCP async replies, rejection of
  tampered envelopes, continuation after poison, and the unchanged local path.
- D8: Run the existing release script for 0.98.0 after the feature commit and
  green verification. Push the branch with an explicit lease. No merge or tag
  push. The script's local annotated tag is only a local release-prep artifact.

## Published-package compatibility

0.10.1 contains `runtime/custody-crypto.js` but omits `verifyCustodySignature`
from the root exports. h2a resolves that file relative to the installed package
entrypoint and calls the upstream verifier. No cryptographic implementation is
copied. The real N2 tests exercise that exact installed function.

## Review evidence

Two complementary review launches (Claude host, requested gpt-5.6-terra and
gpt-5.6-sol, xhigh) were refused by automatic approval review because gateway
code transfer was not explicitly approved. No peer consensus is claimed.

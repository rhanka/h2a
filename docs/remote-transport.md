# Remote transport (signed-bearer)

> V2 transport auth (DEC-032), implemented by DEC-073→077. Ships in `@sentropic/h2a-cli@>=0.2.9`.

V1 coordination is filesystem-local: agents share a `<root>/.h2a/` store (directly, or across Pods via the [K8s tenant](./k8s-tenant.md)). The remote transport lets an agent on one host hand a signed envelope to an h2a instance on **another** host over HTTP, without the two sharing a filesystem.

## Trust model: the channel is not trusted

The transport moves bytes; it does **not** establish trust. Every guarantee rides in the envelope and is verified by the receiver:

- **Provenance** — the envelope is signed (ed25519) by its emitter (`actor.instance`). The signature covers the whole envelope except its own `signatures` array (DEC-073), so the body, target, id and timestamp are all authenticated.
- **Freshness / no replay** — the receiver checks the envelope's `createdAt` against a window and dedups on its `id` (DEC-074), so a captured envelope cannot be re-sent.

This is the **signed-bearer** model: the bearer (envelope) is self-authenticating end-to-end, so it survives relays and brokers and needs no PKI/mTLS. (mTLS, if you want channel confidentiality, is an optional deployment-layer add-on — terminate TLS at your ingress; it is orthogonal to the envelope auth.)

## End-to-end flow

```
emitter                                   receiver (h2a remote serve)
  signEnvelope(env, {by, privateKeyPem})    ──HTTP POST──▶  acceptRemoteEnvelope:
                                                              1. well-formed envelope?
                                                              2. has target.instance?
                                                              3. signature by actor.instance
                                                                 verifies vs registry key?
                                                              4. fresh & not replayed?
                                                              └─▶ store.putInboxMessage(target, env)
```

Anything that fails maps to an HTTP status: `202` accepted, `400` malformed/no-target/no-signature, `401` unknown-key/bad-signature, `409` replayed, `422` stale/out-of-window.

## Run a receiver

```bash
h2a remote serve --root /path/to/workspace
# h2a remote serve: listening on http://127.0.0.1:8787/h2a/envelopes (root …)
```

- **Binds `127.0.0.1` by default.** A network listener should not be world-reachable implicitly; expose it explicitly with `--host 0.0.0.0` (behind your own ingress/TLS).
- `--port` (default `8787`), `--path` (default `/h2a/envelopes`).
- The receiver authenticates each envelope's signer against the local registry's `publicKeys` — a sender with no registered key is refused (`401`). Register peers (and their public keys) with `h2a register` first.

## Send to a peer

```bash
h2a remote send \
  --url http://peer.example:8787/h2a/envelopes \
  --instance claude:proj-1 \
  --private-key ./claude-proj-1.pkcs8.pem \
  --json "$(cat envelope.json)"
```

It signs the envelope as `--instance` with `--private-key`, POSTs it, prints `{ status, body }`, and exits `0` on a 2xx, `1` otherwise. Generate a keypair with `h2a keys generate`.

## Key rotation (DEC-078/079)

The receiver authenticates a sender against the **active** public keys for that instance: the keys in its registration plus a per-instance **keyring** (`registry/keys.jsonl`, append-only), minus any revoked. Crucially, a signature is accepted if it verifies against *any* active key — which is what makes zero-downtime rotation possible.

```bash
# inspect the active keys for an instance
h2a keys list --instance claude:proj-1

# rotate IN: add a new key (both old and new now verify — overlap window)
h2a keys add --instance claude:proj-1 --public-key ./claude-new.pub.pem

# … switch the sender to the new private key …

# rotate OUT: revoke the old key (the receiver stops accepting it immediately)
h2a keys revoke --instance claude:proj-1 --public-key ./claude-old.pub.pem
```

Because verification reads the derived active set, a `revoke` takes effect everywhere at once — no server restart, no registration rewrite. Revoking a key that is not currently active is a state error (exit 2).

## Using it as a library

The pieces are exported from `@sentropic/h2a` (pure crypto) and `@sentropic/h2a-cli` (transport):

| Function | Package | Role |
|---|---|---|
| `signEnvelope` / `verifyEnvelopeSignature` | `@sentropic/h2a` | provenance (DEC-073) |
| `checkEnvelopeFreshness` / `createReplayGuard` | `@sentropic/h2a` | anti-replay (DEC-074) |
| `acceptRemoteEnvelope` | `@sentropic/h2a-cli` | receive-side trust boundary (DEC-075) |
| `createRemoteServer` / `remoteServerForStore` | `@sentropic/h2a-cli` | HTTP listener (DEC-076/077) |
| `sendRemoteEnvelope` | `@sentropic/h2a-cli` | sign + POST client (DEC-076) |

`acceptRemoteEnvelope` takes `resolvePublicKey`, `guard` and `deliver` as callbacks, so you can plug in any key source, replay store or delivery sink — the HTTP server is just one wiring of it.

## Limits / out of scope

- **No channel encryption built in.** Envelope auth is end-to-end; if you need confidentiality on the wire, put the receiver behind TLS (reverse proxy) — the loopback default keeps you from accidentally exposing plaintext HTTP.
- **In-memory replay guard.** Dedup state is per-process. A multi-process/broker deployment that fans out to several verifiers would need a shared seen-set — a later refinement.
- **No broker/relay yet.** This is point-to-point HTTP. A network broker (Scenario C of [DEC-056](../DECISIONS.md#dec-056--instruction-note-k8s-deployment--remote-interop)) is a separate, deferred workstream.

## Related

- [DEC-073…077](../DECISIONS.md) — the signed-bearer transport-auth slices.
- [`docs/k8s-tenant.md`](./k8s-tenant.md) — shared-store coordination across Pods (the filesystem alternative to remote transport).
- [`docs/subagents.md`](./subagents.md) — addressable subagents (a sender/recipient may be a `parent~name` subagent address).

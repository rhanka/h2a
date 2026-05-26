# SysML v2 interop — specification & plan

> Specifies facet §3 of [`evaluations/sysml-v2.md`](../evaluations/sysml-v2.md): let `h2a` **govern** SysML v2 model deliverables by referencing immutable model commits in signed envelopes, reusing the shipped signed-bearer transport (DEC-073→077). **Status: planned (not built).** Decision recorded in DEC-081.

## Goal & non-goals

**Goal** — a recipient can verify *who committed to which exact SysML v2 model state, under which authority*, without h2a moving the model. An h2a stabilized `CONTRACT`/`ENGAGEMENT` references a SysML v2 element at an immutable commit; the envelope signature transitively pins that model state.

**Non-goals** — h2a does **not** move model bytes, does **not** merge models, does **not** implement the SysML v2 API server, and does **not** replace the SysML repository's own auth. It *references, verifies, and governs*.

## The SysML v2 API & Services in one paragraph

A versioned, git-like model repository (OMG Systems Modeling API & Services PSM): `Project` → immutable `Commit` → `Branch`/`Tag`, with `Element`/`Relationship` resources and a query API. Commits are immutable and content-addressable — the same property h2a relies on for `artifactHash`.

## Specification

### 1. `H2ASysmlRef` — the model reference

A pure, serializable reference to a SysML v2 element at a frozen state:

```
H2ASysmlRef {
  kind: "sysmlv2";
  apiBase?: string;     // repository base URL (omit if implied by context)
  project: string;      // Project id
  commit: string;       // immutable Commit id  -> freezes the state
  element?: string;     // optional Element id (omit = whole project at commit)
  elementHash?: string; // optional canonical hash of the element (content integrity, see §4)
}
```

- Lives in core (`@sentropic/h2a`) as a type + a total `validateSysmlRef` / `sysmlRefEquals`. No I/O.
- Because `commit` is immutable, a signature over an artifact that embeds the ref **pins** the model state without copying it.

### 2. Embedding in artifacts / envelopes

An `ENGAGEMENT` or `CONTRACT` body may carry `subject: { sysmlRef: H2ASysmlRef }`. The existing canonical hashing (DEC-035) and envelope signing (DEC-073) cover the ref, so:

> signing the envelope = signing the claim *"I, this actor, commit to model state {project, commit, element} under this engagement"*.

No new signing path — the ref is ordinary signed content.

### 3. Provenance alignment (no duplication)

- The **SysML commit chain** is the model-side provenance (what the model is).
- The **h2a negotiation journal** is the governance-side provenance (who offered/countered/signed, referencing commits).
- They compose: h2a journals *the act*, the repository journals *the content*. The h2a `artifactHash` may equal or include the commit id.

### 4. Content verification — two trust levels

- **(a) commit-trust (default)**: trust the API's immutability guarantee; verifying the envelope signature + the commit id is enough.
- **(b) content-integrity (hardening)**: the adapter re-fetches the element via the API, canonical-hashes it, and checks it against `elementHash` embedded at sign time. Detects a repository that violates immutability or a wrong `apiBase`.

### 5. Disclosure via views

A `CONTROL`/recipient reads the referenced model through a **filtered API query** or a SysML `view`; the h2a disclosure mode (DEC-045: full/redacted/evidence/hash-only) selects the query scope. The envelope may carry a `disclosure` hint. Maps controlled disclosure onto SysML's native viewpoint/view mechanism.

### 6. Auth boundary

Two independent boundaries: **(i)** h2a authority — who may *sign* the engagement (mandate/keys, DEC-078); **(ii)** SysML API access — credentials to *read* the repository, held out-of-band by the adapter. h2a never embeds API credentials in envelopes. A signed engagement asserts authority; it does not grant repository access.

### 7. Adapter boundary (2-package rule held)

A runtime module `packages/h2a-cli/src/runtime/sysml/` (no third package):

- `resolveSysmlElement(ref, { apiBase, auth, fetchImpl? })` → fetch element via API & Services.
- `hashSysmlElement(element)` → canonical hash for trust-level (b).
- `buildSysmlRef(...)` / `verifyEnvelopeSysmlRef(envelope, opts)` → fetch + re-hash + compare.

Pure ref types stay in core; all I/O stays in the cli runtime adapter.

## Plan (ordered slices)

| Slice | Deliverable | Package | Depends on |
|---|---|---|---|
| **S1** | `H2ASysmlRef` type + `validateSysmlRef`/`sysmlRefEquals` (pure) | `@sentropic/h2a` | DEC-035/073 |
| **S2** | `runtime/sysml/` adapter: `resolveSysmlElement` + `hashSysmlElement` (mock-API tested) | `@sentropic/h2a-cli` | S1, API & Services PSM |
| **S3** | `verifyEnvelopeSysmlRef` (commit-trust + content-integrity) + CLI `h2a sysml verify` | `@sentropic/h2a-cli` | S2, DEC-073/074 |
| **S4** | disclosure mode → API query scope mapping (views) | `@sentropic/h2a-cli` | S2, DEC-045 |

- **Versioning**: S1 adds public core surface → minor bump; S2-S4 patch/minor as shipped.
- **Reuses unchanged**: signed envelopes (073), anti-replay (074), remote transport (077) — the interop adds *reference + verification*, not a new transport.

## Open questions (to resolve before S1)

1. **Granularity**: reference per `element` or per `commit` (whole project)? (default: allow both; `element` optional.)
2. **API auth model**: token/OAuth held by the adapter — config shape and where it lives.
3. **Branch/merge**: when two engagements touch the same elements on different branches, how does stabilization relate to a repository merge? (likely out of scope for V1 interop — reference commits only, no merge orchestration.)
4. **Element canonicalization**: which serialization to hash for trust-level (b) — the API JSON element, or a normalized form?

## Related

- [`evaluations/sysml-v2.md`](../evaluations/sysml-v2.md) — the four-facet evaluation (this spec deepens §3).
- [`docs/remote-transport.md`](./remote-transport.md) — the signed-bearer transport this interop rides on.
- DEC-073→077 (transport auth), DEC-035 (canonical hashing), DEC-045 (disclosure), DEC-081 (this plan).

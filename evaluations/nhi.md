# Complementary evaluation — h2a × Non-Human Identity (OWASP NHI Top 10 / NIST)

> A *complementary* evaluation (not an org track A-E): how `h2a` maps onto **Non-Human Identity (NHI)** security guidance. [← library](./README.md) · **Status: draft, pending triple-review** (see [BACKLOG](./BACKLOG.md)).

Agents, service accounts, API keys and workloads now outnumber human identities ~100:1. **Non-Human Identity (NHI)** security is the discipline of authenticating, scoping, rotating and offboarding these machine identities. h2a coordinates **AI-agent** instances — themselves NHIs — so it sits squarely in this space.

## The standards landscape (what to align with)

- **No dedicated NIST NHI standard exists** (as of 2026-05). **NIST SP 800-207** (Zero Trust Architecture) explicitly flags **Non-Person Entities (NPE) / NHI** — service accounts, AI agents, API keys, OAuth apps — as an **open challenge**: authenticating, managing and auditing them in a ZTA is unsolved at the spec level.
- **NIST CSF 2.0** (govern · identify · protect · detect · respond · recover) is the framework an NHI strategy maps to; the new **govern** function is where NHI ownership/accountability lives.
- The concrete, actionable de-facto standard is the **OWASP Non-Human Identities Top 10 (2025)** (relayed/standardized by the Cloud Security Alliance). It ranks the ten most critical NHI risks by exploitability/prevalence/impact.

⇒ h2a aligns with **NIST SP 800-207 / CSF 2.0** at the framing level and maps concretely against the **OWASP NHI Top 10**.

## Where h2a sits

```mermaid
flowchart LR
  subgraph H2A["h2a mechanisms"]
    A[ed25519 signed envelopes<br/>verify-on-receipt]
    B[mandate {instance,role,scope,rights}<br/>+ subagent caps ⊆ parent]
    C[key rotation add/list/revoke]
    D[subagent + key revocation]
    E[scopes · K8s tenant · disclosure]
  end
  A --> NHI4[NHI4 Insecure Auth]
  B --> NHI5[NHI5 Overprivileged]
  C --> NHI7[NHI7 Long-Lived Secrets]
  D --> NHI1[NHI1 Improper Offboarding]
  E --> NHI8[NHI8 Env Isolation]
```

## OWASP NHI Top 10 (2025) — h2a coverage

| # | OWASP NHI risk | h2a relevance | Coverage |
|---|---|---|---|
| NHI1 | Improper Offboarding | subagent revocation (DEC-072), key revocation (DEC-079) | ✅ partial — h2a revokes a subagent/key cleanly; full cross-system deprovisioning is out of scope |
| NHI2 | Secret Leakage | envelopes never carry secrets; private keys held out-of-band, only signatures travel (DEC-073) | ~ by design — no secret store; avoids embedding credentials |
| NHI3 | Vulnerable Third-Party NHI | contracted-role model (D_SAFE, DEC-080) + bounded mandates | ~ — mandates bound a third-party agent's blast radius; no software-composition scanning |
| NHI4 | Insecure Authentication | **ed25519 signed envelopes + verify-on-receipt + multi-key** (DEC-073/075/078) | ✅ strong — cryptographic, channel-independent identity proof |
| NHI5 | Overprivileged NHI | **mandate `{instance,role,scope,rights}`**, subagent capabilities ⊆ parent (DEC-068), authority matrix | ✅ strong — least-privilege by construction |
| NHI6 | Insecure Cloud Deployment Config | K8s tenant binds loopback/RWX+lease (DEC-067); `remote serve` 127.0.0.1 default (DEC-077) | ~ partial — secure defaults in the deploy renderers |
| NHI7 | Long-Lived Secrets | **zero-downtime key rotation** add→overlap→revoke (DEC-078/079) | ✅ strong — rotation is first-class |
| NHI8 | Environment Isolation | first-class scopes, K8s namespace tenant, disclosure profiles (DEC-045) | ~ — scope/tenant isolation; not full runtime env isolation |
| NHI9 | NHI Reuse | per-instance identity + per-subagent addressing `parent~name` (DEC-068) + per-key | ✅ partial — distinct addressable identities discourage shared/reused NHIs |
| NHI10 | Human Use of NHIs | role separation (human `PRINCIPAL` vs agent `AGENTS`), mandate = explicit delegation, signed provenance + journal | ~ — provenance records who/what acted; does not by itself prevent a human wielding an NHI key |

## Gaps (honest)

- **Secrets management** (NHI2) and **SCA / third-party vetting** (NHI3) are **out of h2a's scope** — h2a assumes keys are provisioned/stored elsewhere (it consumes ed25519 keys, it is not a vault).
- **Discovery/inventory** of NHIs (a core NHI program need) is partial: h2a's registry lists *its* instances/subagents, not the org's whole machine-identity estate.
- **Human-use prevention** (NHI10) is observational (provenance), not preventive.
- NHI8 isolation is scope/tenant-level, not workload-runtime-level.

## Compatibility hypothesis

h2a is **strong on the identity-and-authority axes** the OWASP NHI Top 10 emphasizes — authentication (NHI4), least privilege (NHI5), rotation (NHI7), offboarding (NHI1), reuse (NHI9) — because those are exactly its primitives (ed25519 signatures, mandates, keyring, subagent/key revocation). It is **partial on deployment/isolation** (NHI6/8) and **deliberately out of scope on secrets-management/SCA** (NHI2/3). So h2a is best positioned as the **agent-identity governance layer** within an NHI program, aligned with NIST SP 800-207 / CSF 2.0, **not** as a secrets vault or NHI-inventory platform. No new role or artifact is required to claim this coverage.

## References

- OWASP **Non-Human Identities Top 10 (2025)** — [owasp.org/www-project-non-human-identities-top-10](https://owasp.org/www-project-non-human-identities-top-10/2025/) (CSA endorsement: [cloudsecurityalliance.org](https://cloudsecurityalliance.org/blog/2025/06/30/introducing-the-owasp-nhi-top-10-standardizing-non-human-identity-security)).
- NIST **SP 800-207** *Zero Trust Architecture* — flags NPE/NHI as an open challenge.
- NIST **Cybersecurity Framework 2.0** — govern/identify/protect/detect/respond/recover.

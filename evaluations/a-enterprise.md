# Use-case A — Traditional enterprise

> Topology: **hierarchy** (with contractual + regulatory overlays). [← library](./README.md)

An enterprise with supplier, employee and client contracts, investors, shareholders, regulation, public administrations and taxes.

## Diagram

```mermaid
flowchart TD
  SH[Shareholders / Investors<br/>PARTY + reserved AUTHORITY] -. appoints/constrains .-> EXEC
  EXEC[EXECUTIF — top management<br/>umbrella scope]
  EXEC --> P1[PRINCIPAL — BU / product owner]
  EXEC --> P2[PRINCIPAL — other domain]
  P1 --> C1[CONDUCTOR — operational manager]
  C1 --> AG1[AGENTS — employees / AI agents]
  REG[External CONTROL — regulator / tax authority] -. imposed POLICY + audit .-> EXEC
  CTRL[Internal CONTROL — legal / compliance / finance] -. audit / veto .-> P1
  SUP[Supplier — external mini-org] == framework CONTRACT ==> P1
  CLI[Client — external mini-org] == client CONTRACT ==> P1
  P1 -. derived ENGAGEMENTS .-> AG1
```

## Mapping

| Real-world element | `h2a` mapping | Notes |
|---|---|---|
| Company / enterprise | Mini-organization or umbrella activity | Global EXECUTIF + several domain PRINCIPALs. |
| CEO / top management | `EXECUTIF` | Carries umbrella accountability, arbitrates across domains. |
| BU head / product owner | local `PRINCIPAL` | Owns a perimeter, its engagements and agents. |
| Operational managers | `CONDUCTOR` or local `PRINCIPAL` by authority | The pilot is a conductor; the budget/scope owner is a principal. |
| Employees | human `AGENTS` bound by `BINDING` | Employment contract = durable policy/constraint + mission engagements. |
| Suppliers | external mini-organizations | Supplier contract = framework CONTRACT + derived ENGAGEMENTS. |
| Clients | external mini-orgs or external PRINCIPALs | Client contract = CONTRACT + service/delivery ENGAGEMENTS. |
| Investors | PARTY with reserved RIGHTS, sometimes AUTHORITY | No implicit operational authority. |
| Shareholders | capital PARTY + reserved AUTHORITY | Appoint/constrain EXECUTIF via bylaws, without piloting day-to-day. |
| Regulators / administrations | external CONTROL or public EXECUTIF | Impose policies; receive alerts/reports. |
| Taxes | imposed legal POLICY + recurring OBLIGATION + tax CONTROL | Filings/payments = recurring engagements with evidence. |

## Contracts vs policies

- **Supplier**: framework CONTRACT + security/quality/payment/confidentiality policies, instantiates ENGAGEMENTS (SOW, orders, deliveries).
- **Employee**: employment CONTRACT + durable policies (rights, confidentiality, working time) + role bindings + mission engagements.
- **Client**: client CONTRACT + SLA, rights, responsibilities, delivery engagements.
- **Investment/shareholding**: governance CONTRACT/POLICY + decision rights + occasional engagements (fundraising, reporting, board).
- **Regulation/taxes**: imposed external POLICY, controlled by legal/tax CONTROL; executed via filing/payment/audit engagements.

## 15-CONDUCTORS case

An executive owner steering 15 operational leads (the star topology of [use-case D](./d-principal-15-conductors.md), applied inside the enterprise):

- Each CONDUCTOR has a bounded MANDATE: budget, domain, signing rights, accepted policies.
- Inter-conductor contracts = internal ENGAGEMENTS or internal service CONTRACTS.
- The PRINCIPAL does not receive 105 bilateral conflicts: common policies, signing thresholds and domain controls filter escalations.
- Periodic obligations (taxes, reporting) = recurring OBLIGATIONS, not mere tasks.

## Gaps

- An external actor imposing a policy without being a member.
- Durable framework contract vs operational engagement.
- Budget, payment, taxation, periodic obligations.
- Conflict between internal policy and external regulation.
- How shareholders/investors influence EXECUTIF without piloting day-to-day.
- Termination, confidentiality, IP, compensation in employment contracts.

## Compatibility hypothesis

Holds if `POLICY` is first-class and an `ENGAGEMENT` can reference internal, contractual and external policies. The enterprise is not a single tree: it is a set of scopes governed by EXECUTIF, local PRINCIPALs, internal and external CONTROLs. The umbrella scope's owning `PRINCIPAL` is the board/shareholder body that appoints (and reserves `AUTHORITY` over) the `EXECUTIF`.

**Nearest built-in profile**: **`A_ENTERPRISE`** (machine-readable as `H2A_ABC_MODEL_PROFILES`, verified by `auditAbcModelCompatibility('A_ENTERPRISE')` — DEC-041). **Deltas vs a pure tree**: an external `CONTROL` (regulator/tax authority); imposed external `POLICY`; supplier/client `CONTRACT`s with external `PRINCIPAL`s; shareholder reserved `AUTHORITY`; recurring `ENGAGEMENT`s (filings/payments).

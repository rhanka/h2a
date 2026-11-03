# MH-L2 ratifications — owner 2026-10-12

Source: supplied `DECISIONS-owner.md`, owner task and spec v7 §§8.2,
8.6–8.7, 11.2, 12 and 14. These decisions supersede pending proposals.

| Decision | Ratified contract | Gate / owner |
|---|---|---|
| QF = A+B | External launcher for first protected installation; npm bin router from 0.98.8, loading selected absolute entry in the same process. L2 integrates entry and starters; bootstrap/adoption/npm lifecycle remain MH-L6. | MH-L6 |
| QC | Publish 0.98.8 outside npm latest, opt-in until real Claude U07/U11 qualification; promote afterwards. No publication in L2. | MH-L8 / conductor |
| R4 | Confined independent third-party conductor reviews count as lot review. Installed h2a/MCP dispatch is forbidden. | Conductor reviews exact pushed L2 SHA |
| R5 | Real Claude qualification belongs to MH-L8, not L1/L2. Production qualification stays empty. | MH-L8 |

R3–R5 are resolved for starting L2. R6 (final .6 byte freeze) remains a
conductor integration/release gate; owner explicitly authorizes L2 from
`5cb66f7e`. Neither ratification nor nominal tests attest release readiness.

Node 22/24 only. Gateway moves to .8. No installed h2a, real host state,
unrelated processes, Python, full suite or main mutation.

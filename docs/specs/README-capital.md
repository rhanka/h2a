# Imported specification and review archive

These 95 files preserve specifications, analyses, change tables, summaries,
owner quotes and reviewer outputs copied verbatim from temporary session storage.
Historical absolute links and review verdicts remain unchanged; a review describes
the revision it examined, not necessarily the current implementation.

**Rule: specs and reviews live in docs/, never in a session scratchpad.**

Source shorthand used below:

- `S` = `/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985`
- `H` = `/home/antoinefa/src/h2a/tmp/h-cond`

| Repository directory | Contents | Original source | Track items cited |
| --- | --- | --- | --- |
| [focus-edit-return](focus-edit-return/) | Editing/paragraph-diff specs v1–v3, two analyses, change tables, summaries, owner quotes and case notes (11 files) | `S/fedit/` | `01M58NV0RBPTDA5R87BH5PAJRV` (WP20) |
| [cross-cli-messaging](cross-cli-messaging/) | Cross-CLI messaging specs v1–v3, change tables and summary (6 files) | `S/xclifix/` | None cited |
| [mcp-lane-remediation](mcp-lane-remediation/) | MCP lane remediation specs v1–v2, change table and summary (4 files) | `S/mcpfix/` | See MCP references below |
| [pty-b-batch-handover](pty-b-batch-handover/) | PTY batch/handover specs v1–v3, change tables, pre-B amendment and summary (7 files) | `S/pty-b/` | None cited |
| [pty-restore-injection](pty-restore-injection/) | Astra and Wonder analyses of PTY restore/injection (2 files) | `H/ptybugs/` | `01M5A9G9ESXD5RM0T7K0DJ12QM`, `01M5A9CAZ75BNCP73B0JCA9H4J`, `01M5A9CGQJV44H4XYK4XCT8TPV` |
| [gateway-default-direct](gateway-default-direct/) | Astra and Wonder analyses of direct/gateway defaults (2 files) | `H/gwdef/` | See gateway references below |
| [../reviews/focus-edit-return](../reviews/focus-edit-return/) | Verbatim reviewer outputs; verdict on first line (4 files) | `S/cffe{a,s,3a,3s}-last.md` | None cited |
| [../reviews/cross-cli-messaging](../reviews/cross-cli-messaging/) | Verbatim spec and implementation reviews; verdict on first line (6 files) | `S/cfxc{a,s,3a,3s}-last.md`, `S/rvc379{a,s}-last.md` | None cited |
| [../reviews/mcp-lane-remediation](../reviews/mcp-lane-remediation/) | Verbatim spec and implementation reviews; verdict on first line (6 files) | `S/cfmc{a,s}-last.md`, `S/rvc{354,355}{a,s}-last.md` | None cited |
| [../reviews/pty-b-batch-handover](../reviews/pty-b-batch-handover/) | Verbatim pre-B amendment reviews; verdict on first line (2 files) | `S/rvpreb{a,s}-last.md` | None cited |

The remaining scratchpad import adds these 25 specification and analysis files:

| Repository directory | Contents | Original source |
| --- | --- | --- |
| [dossier-diagrams-v3](dossier-diagrams-v3/) | Dossier diagram specs v1–v3, two change tables, Astra/Sol analyses and summary (8 files) | `S/diag2/` |
| [velocity-estimator](velocity-estimator/) | Velocity estimator specs v1–v2, change table, Astra/Sol analyses and summary (6 files) | `S/velo/`, excluding `sample/h2a-20prs.json` |
| [vuln-fix-activation](vuln-fix-activation/) | Vulnerability-fix activation specs v1–v2, change table, Astra/Sol analyses and summary (6 files) | `S/act371/`, excluding generated `dossier/` |
| [seat-availability-mcp](seat-availability-mcp/) | Seat availability/MCP analyses and Sentropic anchors (3 files) | `S/seatmcp/` |
| [native-h2a-cli](native-h2a-cli/) | Native h2a CLI Astra/Wonder analyses (2 files) | `S/cli/analysis-*.md` |

The following 20 root-level reviewer outputs were also copied verbatim. Each pair
was matched through its corresponding `S/brief-<name>.txt`, whose `KIND: review`
and named target establish the relationship; filenames alone were not used.

| Repository directory | Source review files | Matching briefs | Why matched |
| --- | --- | --- | --- |
| [../reviews/dossier-diagrams-v3](../reviews/dossier-diagrams-v3/) | `S/rvdiaga-last.md`, `S/rvdiags-last.md` | `S/brief-rvdiaga.txt`, `S/brief-rvdiags.txt` | Review `diag2/SPEC_EVOL_DOSSIER_DIAGRAMS.md` (v1) |
| Same | `S/atdiaga-last.md`, `S/atdiags-last.md` | `S/brief-atdiaga.txt`, `S/brief-atdiags.txt` | Confirm `diag2/SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md` |
| Same | `S/rv377a-last.md`, `S/rv377s-last.md` | `S/brief-rv377a.txt`, `S/brief-rv377s.txt` | Review PR #377 implementing the diagram v3 spec |
| [../reviews/velocity-estimator](../reviews/velocity-estimator/) | `S/rvveloa-last.md`, `S/rvvelos-last.md` | `S/brief-rvveloa.txt`, `S/brief-rvvelos.txt` | Review `velo/SPEC_EVOL_VELOCITY_ESTIMATOR.md` (v1) |
| Same | `S/cfveloa-last.md`, `S/cfvelos-last.md` | `S/brief-cfveloa.txt`, `S/brief-cfvelos.txt` | Confirm velocity v2 against earlier findings |
| Same | `S/atveloa-last.md`, `S/atvelos-last.md` | `S/brief-atveloa.txt`, `S/brief-atvelos.txt` | Confirm velocity v2 with required spec/hash output |
| Same | `S/rvtaa-last.md`, `S/rvtas-last.md` | `S/brief-rvtaa.txt`, `S/brief-rvtas.txt` | Review proposed engram time-reference amendments to velocity L0-D fixtures, explicitly citing the velocity v2 spec |
| [../reviews/vuln-fix-activation](../reviews/vuln-fix-activation/) | `S/rv371a-last.md`, `S/rv371s-last.md` | `S/brief-rv371a.txt`, `S/brief-rv371s.txt` | Review `act371/SPEC_EVOL_VULN_FIX_ACTIVATION.md` (v1) |
| Same | `S/cf371a-last.md`, `S/cf371s-last.md` | `S/brief-cf371a.txt`, `S/brief-cf371s.txt` | Confirm activation v2 against earlier findings |
| Same | `S/at371a-last.md`, `S/at371s-last.md` | `S/brief-at371a.txt`, `S/brief-at371s.txt` | Confirm activation v2 with required spec/hash output |

No matching root-level review outputs were found for seat availability/MCP or the
native CLI. Analysis, spec-authoring and code-execution `*-last.md` files are not
review outputs and were not imported. Briefs remain source metadata, not imports.

Exclusions from the remaining import:

- `S/velo/sample/h2a-20prs.json`: contains personal author email addresses found
  by the complementary pattern scan. The entire file was excluded, not redacted.
- `S/act371/dossier/`: generated HTML, screenshots, execution evidence and a
  copied Focus implementation/kit; outside this specification-only archive.
  Its `preuves/kit-check.log` is runtime noise as well.
- Runtime noise (`*.log`, `*.done`, `run-*.sh`) is excluded. No such files occur
  in the imported specification/analysis directories outside the omitted dossier.

The following are all Track item IDs cited in the initial six imported spec directories,
including historical references; they do not imply current status or ownership.

MCP references:
`01M515FVQC1M8D17BADRTH8Z6Z`, `01KTST4ASW2DYD2R76VM1DBF37`,
`01M0KMX0N8HYQPA74PENBR90QF`, `01M53PPTH6EAPPFKZRF78V7T6Q`,
`01M53PQ5C10XEV6M7W0ZWBMTBX`, `01KTT31AZVYPVH9VGRN7PVAYDF`,
`01KTST4Y13EEVZWN2GXC071D4W`, `01KV41H39HE2220KYGJ9NMMF5R`,
`01KTST53F1CNBDXTWKPGDF0YAJ`, `01KXDPBQY1X66M7ZRK72D34S56`,
`01M51R4ZFXJVPVFFWM1RABQ8YP`, `01KWVM4Z972ZAFK6TKW753ZBR1`,
`01M53PQCDA68QTYXY4Q6D6JB0S`, `01KTQC2JK2Y3T7R8GQ6EQNHSJ5`,
`01KWVM4ZD4ADJQ70J1NEH7R6W1`, `01KYQ5KJWXFBRK2M2ZC8T1E221`,
`01KYQ5KK3Z8ZGN4Q1VSMKXWJGR`, `01KYQ5KKTDWJZN270VYPK19C4Y`,
`01KYQWKM5DJF3GTD1E6TFVYB7T`, `01M38WT0XG2KVRJ4HN28XETYNE`.

Gateway references:
`01M5AANHQWK4RZRCXT5VVA2CM6`, `01M53PQ37XZ9RFT6HQ0NG1RQ0P`,
`01KYSTGGF57MET8WETDDV6G1W4`, `01M2GY6BNED8RPXY23GRBA74SN`,
`01KYR2J6M1ANHFC7YG184R7HYC`, `01KYR1N47P97GC5BPF5P4X35NW`,
`01KYR59E09FWGPHZ024WYKBWQY`, `01M2GY3KYGGWKQXVPJKVX30691`.

All imported files were checked with Gitleaks 8.30.1 and a complementary scan for
credentials, private-key material and private email addresses: no sensitive
content was detected in the retained files. For the remaining import, Gitleaks
reported no leaks across all 46 candidates; the complementary scan identified the
excluded velocity sample above. The 45 retained imports and this updated README
were scanned again before commit. No runtime-only files were imported. Imported
bytes were verified against their source SHA-256 hashes; historical links and
verdicts were preserved.

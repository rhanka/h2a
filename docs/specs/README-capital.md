# Imported specification and review archive

These 50 files preserve specifications, analyses, change tables, summaries,
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

The following are all Track item IDs cited in the respective imported directories,
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
content was detected. No runtime-only files were present in the import.

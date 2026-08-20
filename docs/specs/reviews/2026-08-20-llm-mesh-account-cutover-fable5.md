---
status: completed
review-author-host: codex
review-author-model: gpt-5.6-sol
review-author-effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: xhigh
transport: direct-anthropic-api-key
target-ref: 30faefc5600cfe05075b235e874c98e32f9540fd
lens: adversarial-correctness-security-compatibility-release-readiness
correction-validation-ref: aacaccc68f3495b49c75229a74373a452cf01c8d
---

# Fable 5 adversarial review — llm-mesh account cutover

The reviewer inspected the exact target commit against `origin/main`, covering
the specification, implementation, tests, migration contract, credential
handling, and release readiness.

## Transport attempts

- Attempt 1 reached the first-party `claude-fable-5` API using the paid API-key
  path, but the model returned a `reasoning_extraction` safeguard refusal before
  producing review content. Cost reported by Claude Code: USD 0.0633175. This is
  recorded as a failed transport attempt, not as a review verdict.
- Attempt 2 used a shorter neutral prompt but retained a structured reasoning
  field; the same safeguard refused it before review content. Cost reported by
  Claude Code: USD 0.033924. This is also a failed transport attempt, not a
  review verdict.
- Attempt 3 removed structured output but still used a multi-turn tool review;
  the same safeguard refused the continuation before producing review content.
  This is also a failed transport attempt, not a review verdict.
- Attempt 4 supplied the complete committed patch in one read-only request.
  Claude Code attested the first-party canonical model `claude-fable-5`, one
  completed model turn, and a cost of USD 2.812806. This attempt produced the
  review below.

## Verdict

**GO**, with five minor findings and no blocker, high, or medium finding.

## Findings and reconciliation

1. **Fresh required-gateway launch lacked a direct test.** Accepted. All
   `injectLlmMeshGatewayEnv` call sites were audited; launch/resume/restore paths
   catch or propagate the exception before spawn. A fresh `h2a run claude
   --gw` test now proves exit 1 and no launch when gateway startup fails.
2. **Required mode could print “Claude may ask for login” before failing.**
   Accepted. The fallback warning is now gated out when mode is `gateway`; the
   new test pins its absence.
3. **The spec overstated exact parent-environment restoration.** Accepted. D3
   now distinguishes long-lived job helpers, which restore exactly, from the
   short-lived interactive launch process.
4. **The BRANCH.md allowed scope omitted necessarily changed files.** Accepted.
   The exact runtime, CLI, fixture, and review paths are now declared.
5. **Top-level llm-mesh help retained the legacy local-mesh wording.** Accepted.
   Runtime help and its golden fixture now say “Sentropic llm-mesh gateway and
   account enrollment”.

## Validation after reconciliation

- Runtime Vitest: 67/67 passed across gateway, wiring, and environment suites.
- CLI/doctor Node tests: 23/23 passed after rebuilding `dist`.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

The same first-party Fable 5 model then received only the correction patch at
`aacaccc68f3495b49c75229a74373a452cf01c8d`. It returned **GO**, confirmed all
five findings resolved, and reported no new blocker. Claude Code reported USD
0.4205675 for this closure call. Claims in that response about commands run are
not used as evidence; the commands and results listed above were executed by
the coordinator in the checkout.

## Residual limitations retained from the review

- The root CI runner is the merge gate; package-local Vitest was therefore run
  explicitly in addition to `npm test`.
- Claude direct UAT reached native account authentication but the account's
  weekly provider quota prevented a completed response.
- The real gateway marker UAT proves routing and response, while resume and
  continuation behavior remain primarily covered by unit tests in this cutover.
- Old registry rows containing unknown `accountId` rely on normal JSON
  structural parsing; the field has no runtime consumer after this patch.

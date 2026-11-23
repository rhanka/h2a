---
name: test
description: Use when adding or evolving tests for a feature/bugfix, or when asked for a change-risk (CRAP) score — applies the sentropic test-pyramid, change-risk score, scoped-test loop, environment isolation, and AI-flaky policy.
---

# harness/test

Native sentropic testing discipline (NOT "tdd" ritual — the act is `test`). Open it with
`harness test [<scope>] [--category unit|integration|e2e] [--watch]` (records a WorkEvent), then follow
the loop.

## Pyramid

70% unit · 20% integration · 10% e2e. Test behaviour, not implementation — query by user-visible
elements (text/role/label) over test ids. Names: "should <behaviour> when <condition>".

## Change risk (CRAP)

The pyramid sets the mix of tests. The change-risk score says where tests are missing. A function is
risky to change when it is both complex and under-tested:

    CRAP = complexity² × (1 − coverage)³ + complexity

`complexity` is the cyclomatic complexity: 1 + the decision points of the function. `coverage` is the
share of the function's own lines the automated tests run, from 0 to 1; a function no test calls has 0.
Fully covered, the score equals the complexity. Not covered at all, it is complexity² + complexity.

- Measure the functions your diff touches, not the repository.
- Over 30: to fix. A function you add, or make more complex, ends at or under 30.
- Between 10 and 30: worth a look. Say so in review; it never blocks.
- To get under 30, add tests first. Split the function only when the lot already rewrites it. Strict
  scope still applies.
- A function that was already over 30, and that you did not make more complex, is reported and left.
  It is existing debt: `harness/code-debt` handles it on the owner's request, outside your lot. Above
  a complexity of 30, tests alone cannot bring the score down.
- Switches. A `case` that only delegates is not counted: no decision, and one statement that returns a
  value, calls a function, or throws. So route a new branch through a delegating `case` and put its
  logic in a function of its own, which is measured like any other. A chain of
  `if (x === "a") return …` has no such exemption: when the lot already rewrites the function, write
  the new branch as a `case`; converting an existing chain is a lot of its own. Never add a
  single-branch `switch`.
- The score counts lines run, not checks made. A test that runs code without asserting behaviour lowers
  the number and proves nothing.

Use the repository's change-risk command when it has one. The H2A reference implementation —
`npm run crap` — is delivered separately. Without a command, report the score as `not measured`: this
skill states the rule; it does not prove a number nobody computed.

## Scoped-test loop (while developing)

Run ONLY the test under evolution, on a dedicated test ENV — never `dev`:

- API: `make test-api-<suite> SCOPE=tests/<file>.spec.ts ENV=test-<slug>`
- UI: `make test-ui SCOPE=tests/<file>.spec.ts ENV=test-<slug>`
- E2E: `make test-e2e E2E_SPEC=tests/<file>.spec.ts API_PORT=… UI_PORT=… MAILDEV_UI_PORT=… ENV=e2e-<slug>`

Full gates only at end of lot/branch: `make test-api`, `make test-ui`, `make clean test-e2e`. Read the
change-risk table at that same point, once per lot.

## Environment isolation (MANDATORY)

- NEVER run test campaigns on `ENV=dev` — afterEach hooks purge real data.
- Branch tests live in the isolated worktree on `ENV=test-<slug>` / `ENV=e2e-<slug>`; `ENV` is the LAST
  make argument.
- NEVER add timeouts to make a flaky e2e pass — a timeout failure is a real bug (bad selector, race,
  regression). UI waits are <2s except AI generation.

## AI-flaky allowlist (non-blocking)

Only accept non-systematic provider/network/model nondeterminism, and only with ≥1 success on the same
commit + command. Record the exact command + failing file + failure signature in `BRANCH.md` and get
explicit user sign-off before merge. Everything else is blocking.

## CI is authority

CI was green on main → any branch failure IS a branch problem; never claim "pre-existing". Decide:
evolution (adapt the test) or regression (fix the code). Local-green / CI-red → trust CI.

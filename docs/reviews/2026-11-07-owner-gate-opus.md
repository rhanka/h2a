---
status: completed
reviewer-host: claude
reviewer-model: claude-opus-5-5
reviewer-effort: max
target-ref: working tree from db4857950
target-diff-sha256: cc97198ad49c1f40a88073a67a1bb4f98d5b5f13e74c7b1fb88ef275b85d58ae
lens: owner-gate correctness, authorization and operational completeness
---

# Independent owner-gate review

Designer: Astra, gpt-6-astra, max (explicit owner assignment).
Reviewer selection: explicit owner assignment, one independent Opus 5.5 max review.
This is not a multi-peer consensus claim.

The confinement exposes no h2a launch MCP and forbids the installed h2a binary.
The requested reviewer is launched directly with the Claude CLI in safe/restricted
mode, only Read/Glob/Grep tools, no MCP/custom hooks and no session persistence.
Model/effort are requested parameters, not an attestation of provider routing.

# Owner gates: blind review of the spec and skills

**Verdict: CHANGES**

There are two blockers (P1-1, P1-2). The marker design itself holds up: the field goes inside the signed `body`, old local, remote and mesh receivers accept extra body fields, the sender rejects unknown arguments without silently dropping the marker, and C is labelled unshipped throughout. The present-decision cap is kept by a mandatory link at `SKILL.md:64`, and the installers copy that asset for every host.

## Findings

### P1-1 — Reminders sent to a blocked target session can answer the owner's question
- **Where:** `packages/h2a/skills/harness/using-harness/SKILL.md:49-50` ("if one remains open, remind through h2a"); `packages/h2a/skills/h2a/SKILL.md:49-51`; `docs/specs/2026-11-07-SPEC_EVOL_owner-gate-native-question.md:131-133` and `:473`.
- **Runtime evidence:**
  - `packages/h2a/src/runtime/mcp/notifications.ts:238-243` and `drive/inbox-wake.ts:60-79`: every new envelope triggers a wake.
  - `runtime/drive/index.ts:522-529`, `loop/engine/adapters.ts:670-674` and `drumbeat/relaunchers.ts:158-166`: the tmux wake types the line, then presses Enter twice.
  - `packages/h2a-runtime/src/native-terminal/op.ts:1037-1049`: the native-terminal wake writes the line plus a carriage return.
  - `packages/h2a-runtime/src/prompt-delivery.ts:19-21,43-44,109-112`: modal detection exists only in launch prompt delivery.
- **Consequence:** The conductor is told to message a session whose agent is blocked inside the very question it is reminding about. Each message makes h2a type a wake line plus Enter into the open dialog. The only guard checks for recent human activity, and that check passes exactly when the owner is away. The repo's own notes say host choice dialogs swallow pasted text and confirm on Enter. A 15-minute reminder can therefore select the highlighted option, or submit the wake line as free text: an owner answer nobody gave. It also cannot reach an owner who isn't watching that session, which is how the incident happened.
- **Correction (L1):**
  - While a gate question is open or its state is unknown, send nothing to the target session and do not enroll it in a ticking loop.
  - Send reminders and escalations to where the owner actually is: the conductor's own native question, or a designated owner-facing session. The message names the gate and the required session, and is an alert only.
  - Ask for a re-raise only after the target has reported that the question failed, closed, or never displayed.
- **L2 acceptance (RED/GREEN):** A fake host shows an open owner-gate question (and a generic `› 1.` / "enter to select" dialog), then receives an inbox envelope and a loop wake.
  - RED (today): a line and Enter are injected.
  - GREEN: the wake is deferred with a recorded reason, no keystroke is written, and the dialog is unchanged.

### P1-2 — Neither lot owns reminder execution, and the documents disagree about which lot does
- **Where:**
  - EVOL `:16`, `:121`, `:146-148`, `:309-310`, `:440-441`, `:476`.
  - `BRANCH.md:2900-2901`, `:2910-2911`; `docs/reviews/2026-11-07-owner-gate-validation.md:3-5`.
  - h2a SKILL `:40-41`, `:276-280`.
  - Runtime: `loop/index.ts:227-236`, `loop/engine/adapters.ts:302-308,324-326`, `loop/engine/decision.ts:194-200`.
- **Consequence:**
  - The documents contradict each other. The EVOL puts reminders in this PR ("executing conductor procedure") and rules out a scheduler in C. BRANCH and the validation note put "durable reminders" / "per-gate runtime reminder handling" in L2.
  - In practice, the executor is an agent with no timer. The only existing wake source is the loop controller. It is opt-in, needs idle evidence, sends a generic "reprends l'objectif" line, and shares a durable `maxRelaunches` budget (default 3) with launches.
  - After about three wakes, nobody runs due checks or the deadline escalation. A gate bound only to Track has no wake source at all.
  - "Assign a running reminder executor" can be satisfied by an agent naming itself. That brings back the incident: hours with no follow-up.
  - The L2 follow-up tests (`:476`) describe behaviour that no listed code seam implements.
- **Correction (L1):**
  - A qualified executor is something that wakes the conductor at `nextReminderAt`, whose liveness can be observed, and whose budget covers the cadence. State that the loop controller alone does not qualify.
  - If none exists, record `reminders-unavailable` and alert the owner immediately in an owner-facing session, with the gate, required session and deadline. Report requirement B as unmet for that gate.
  - Change "enforce … durable follow-up" to "instruct" in `BRANCH.md:2900-2901`, and align `:2910-2911` and validation `:3-5` with the EVOL.
- **Correction (L2):** Name the component that computes due checks and emits re-raise, remind and escalate actions, and state its budget relative to the relaunch budget.
- **L2 acceptance (RED/GREEN):** With an injected clock and an idle conductor:
  - due checks keep firing for more than `maxRelaunches` intervals;
  - a restart produces one overdue check, not a burst;
  - the deadline escalates;
  - checks stop once a close is recorded.

### P2-1 — A gate recorded only in a loop note becomes unwritable and hard to find
- **Where:** EVOL `:138-139`, `:150-151`, `:459`; h2a SKILL `:276-280`; `loop/index.ts:664,751,791-795,806-811`; `mcp/handlers.ts:1601-1608`; `loop/engine/tick.ts:66-76`.
- **Consequence:**
  - In this lot, a loop binding is just an `h2a_loop_report` note.
  - `loop done` closes a loop without refs immediately, and `stop` always applies. After that, report (also refused when the loop is `blocked`) and join both fail.
  - So attempts, reminders, handover and closure can no longer be recorded, and no successor can enroll. This breaks acceptance case 5.
  - `h2a_loop_status` returns only the last 10 events, and every tick journals one. A running controller pushes the gate note out of view after ten ticks.
- **Correction:**
  - Make the explicit Track pending item the authoritative record, with the loop note as a pointer. Otherwise, require rebinding to Track before any `done`/`stop`, and immediately when a loop becomes terminal.
  - Specify how a restarted conductor finds its open gates: a stable Track query, plus `h2a loop logs` for history.

### P2-2 — Session routing is undefined for sibling sessions and for targets that aren't live
- **Where:** h2a SKILL `:248-251`, `:256-257`, `:372-376`; EVOL `:118`, `:171-181`; `mcp/handlers.ts:358-361`; `mcp/tools.ts:309`; `mcp/notifications.ts:226-243`.
- **Consequence:**
  - The inbox is per instance, so every concurrent session of that instance gets the arrival and the wake.
  - Nothing stops a non-required session from raising or popping the gate. A sibling can show the GO where it cannot count, or remove the request.
  - MCP `h2a_send` refuses a target that isn't live (`recipient_not_live`), and the method has no branch for this. A CLI deposit for a dormant target would be picked up by a later, different session of the same instance.
- **Correction:**
  - Record the target's h2a `sessionId` from discover, plus the host's native session id when exposed.
  - The receiver compares it with the `sessionId` from `h2a_identity_status`. On a mismatch or unknown identity it does not raise, record or pop, and reports `wrong-session` or `session-unverified`.
  - For a session-bound gate, `recipient_not_live` means immediate escalation where the owner is, and no dormant deposit.
- **L2 acceptance (RED/GREEN):** With two live sessions of one instance, only the required session classifies the envelope as a `request`. The sibling neither pops it nor records an attempt.

### P2-3 — The receiver can create a second binding, or ask about actions outside its own work
- **Where:** h2a SKILL `:36-37`, `:248-250`; EVOL `:63-64`, `:108-110`, `:336-340`; `loop/index.ts:769-770`.
- **Consequence:**
  - "Persist the pending binding" / "create/reuse" lets a target that can't reach the conductor's ledger create a second Track item or loop note. That breaks the "exactly one authoritative binding" rule and Track's single-writer discipline. It also writes into another repo, which L2 forbids (`:337-338`).
  - Writing into the conductor's loop requires `h2a_loop_join`, which enrolls the target for loop wakes (see P1-1).
  - Nothing checks that the gated action belongs to the target's own pending work. Any signed peer can get a peer-written GO shown to the owner.
- **Correction:**
  - The receiver verifies the binding reference and the conductor named in it.
  - It confirms the action is within its current task; otherwise it reports `boundary-mismatch` and asks nothing.
  - It reports by signed reply, and the conductor stays the single writer.
  - It creates a binding only for a gate it discovered itself. A missing or unreadable reference means `binding-unverified` plus escalation, never a new binding.

### P2-4 — The skills drop the `peer-reported` evidence level, and closure can't be carried out in L1
- **Where:** h2a SKILL `:45-52`; using-harness `:45-53`; `present-decision/assets/owner-gates.md:19-22`; EVOL `:79-84`, `:122`, `:382-388`, `:453-454`, `:477`.
- **Consequence:**
  - In L1, a conductor in another session has no accepted way to inspect the target host's record: there is no adapter yet, and transcript scraping is excluded. A target blocked in a question can't report until the owner answers.
  - The skills demand a "trace" but only know verified/unverified. Agents will either upgrade a peer message carrying tool, call id and timestamp to "verified" (claimed evidence), or escalate every gate the moment it is created.
  - Acceptance case 2 (`:453-454`) cannot be met in L1.
  - Closure has no accepted positive source in L1, and the L2 closure tests only cover negative cases.
- **Correction:**
  - Copy the spec's four evidence levels (missing, unavailable, peer-reported, trace-verified) into all three skill texts.
  - In L1, cross-session evidence tops out at `peer-reported`. Record it as such; it triggers the owner alert, not "verified".
  - The target sends a report before a blocking call, and another after the answer quoting the tool result.
  - The conductor may close follow-up on a peer-reported answer recorded in the binding. That answer never authorizes any action outside the required session.
  - Reword acceptance case 2 to "records the best available evidence level".
  - For L2, define the positive closing artifact (an adapter-verified answer in the required session, plus the binding outcome) and add a GREEN test for it.

### P2-5 — The owner can answer from places where the answer cannot count
- **Where:** track-report `:269-275` together with `:294-300`; present-decision `SKILL.md:91-92`; h2a SKILL `:54-56`; `owner-gates.md:25-27`; EVOL `:166-167`, `:305-307`.
- **Consequence:**
  - The track report still invites a `vas y` / `D1 A` reply in the conductor's session. Recording `track decision select` from that reply marks a session-bound GO in Track without the required-session answer, and the owner believes they've answered.
  - A relay that uses the `OWNER GATE` text convention makes the receiving session run the full procedure and offer GO/NO-GO in the wrong session.
  - The spec allows an "explicit rebind" of the required session but doesn't say who may authorize it, so a conductor could rebind the gate to its own session.
- **Correction:**
  - Show session-bound gates without a reply slot: "answer in <session>; question status <level>".
  - Forbid `track decision select` or `outcome` on them except from the required session's answer.
  - Label relays `OWNER GATE ALERT <id> — answer in <session>`, with acknowledge-only options.
  - Require an explicit owner answer to rebind a session-bound gate.

### P2-6 — `contractDigest` freezes fields that change during normal follow-up
- **Where:** EVOL `:211`, `:215`, `:358-361`, `:377-380`, `:135-136`.
- **Consequence:** Conductor, reminder executor and cadence, and escalation deadline are frozen within a revision, and a request must satisfy `conductor === actor`. A conductor handover, a replaced reminder executor, or an owner deferral therefore either conflicts within the revision or forces a new revision, which means a duplicate dialog for the owner.
- **Correction:** Freeze only what the owner sees and answers: id, revision, purpose, owner, host and native session, binding, closeCondition, dossier. Treat conductor, reminder and escalation fields as recorded binding updates.
- **L2 acceptance (GREEN):** A handover and a deferral keep the same `contractDigest` and make no new native call.

### P3-1 — "First admission" for freshness is undefined
- **Where:** EVOL `:342-346`; `packages/h2a/src/replay.ts:22-23`.
- **Consequence:** If the 5-minute freshness window is applied when the agent reads its inbox, any request queued behind a busy turn arrives stale. That adds a round trip before the question can be raised.
- **Correction:** Define admission as the receiving sidecar's first observation of the envelope, recorded per envelope id. Later reads classify from that record plus the signature.
- **L2 acceptance:** An admitted request read 30 minutes later still activates; an old request that was never admitted is stale.

### P3-2 — Nothing pins the mandatory asset link
- **Where:** present-decision `SKILL.md:64`; `packages/track/src/cli/present-decision-skill.test.ts:50-53`; validation `:21`.
- **Consequence:** The 850-word cap now depends on this one link, and the budget is nearly used up (drafts at 857 and 851 words failed). Nothing fails if a later edit drops the link to save words, and the gate procedure would silently disappear from present-decision.
- **Correction:** Add a test assertion that `SKILL.md` references `assets/owner-gates.md` and that the asset keeps its core clauses: native question, binding, evidence, closure.

## What this review did not verify

- I read the working tree and `review-target.diff` only. The diff's content matches the files I read, but I did not compute its SHA-256 or check it against the stated hash.
- I ran no commands, builds or tests. The validation note's results (the 850-word count, 44 and 84 passing tests) are not confirmed here.
- I exercised no host. The claim that an injected line plus Enter answers an open native question comes from the injection code and the repo's own dialog notes, not from observing Claude, Codex or any other host. Skill text and real host behaviour are different levels of evidence.
- I did not read owner runtime state, the installed build, or the untracked review stub.
- The owner requested this review from Claude Opus 5.5 at max effort; this artifact makes no other claim about model identity.

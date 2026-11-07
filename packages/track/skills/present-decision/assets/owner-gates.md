# Pending owner gates

An owner gate is a pending owner GO, signature or decision that blocks a session's work now.
A decision that blocks nothing now is not a gate. Record it for async review, with no native question
and no reminders. Reuse an existing owner authorization when it covers the action.

Ask at once in the required session. Show the shortest complete stakes dossier: action and boundary,
why this session, options and consequences, recommendation and a small diagram. Then invoke that
host's native question tool from `native-questions.md`. Do not wait for a status report or a polished
HTML dossier. A status-table row, “type this in another session” or a Track decision card is not a
native question.

Before a blocking question, the conductor records the gate in Track as a decision titled
`OWNER GATE <id>`. The record names the owner, conductor, target session, deadline, reminder cadence,
executor status, evidence level and close condition. Use agreed timing. Otherwise remind every
15 minutes and set the deadline 30 minutes after creation. Time never approves or cancels a gate.
If the record cannot be written, alert the owner at once and keep the action blocked.

Evidence levels are `missing`, `unavailable`, `peer-reported` and `trace-verified`. Across sessions,
evidence stays `peer-reported` in this lot. A delivery, a wake or `decision-raised:<id>` proves no
question. If no native tool is available, show the limitation, record `unavailable` and alert the
owner.

The conductor sends nothing to the target while the gate question is open or its state is unknown.
A reminder is an owner alert, never input typed into the target. The conductor raises it as
`OWNER GATE ALERT <id>` in its own session, with options that only acknowledge. It re-raises at the
target only after the target or the owner reports that the question failed, closed or is not
displayed. Without a qualified reminder timer, it records `reminders-unavailable` and alerts the
owner at once.

Close only on the owner's attributable answer in the required session and any required signature,
or on an explicit owner cancellation or supersession. Record GO and NO-GO distinctly. Never record
the outcome from a report reply, an alert acknowledgement or a `D1 A` line in another session. A
deferral stays pending with the next reminder the owner chose. A peer signature, a timeout or a
finished loop is not approval. For cross-session delivery and follow-up, apply
**Owner gates across sessions** in the h2a skill.

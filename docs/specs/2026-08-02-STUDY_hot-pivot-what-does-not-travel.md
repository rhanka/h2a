# STUDY — Hot pivot workstation → k8s: the question dissolves, and what is left is identity

- **Author** — `arch` (WP6). **Date** — 2026-08-02.
- **Commissioned by** — the owner, routed via `runtime`. Third of three studies.
- **Recommendation** — **stop asking how to move a session; ask what does not travel.**
  The answer is measured below, and it is not the terminal.
- **Length warning, deliberately.** In Study 1 I predicted this study would shrink once
  *the terminal is a view* was established. It did. A short study here is the finding, not a
  shortfall — had it stayed long, that would have meant Study 1's conclusion was wrong.

Every load-bearing claim is tagged `[MEASURED]` (by me, on the refs and stores named) or
`[JUDGMENT]`. Where a measurement is missing and belongs to another lane, §5 says so and names the
owner. I do not fill those gaps with reasoning.

---

## 1. The question, and why it dissolves

The brief asked: *can a hot session pivot from the workstation to k8s, and what does it cost?*

`[JUDGMENT]` That question presumes the session is a thing that can be picked up and carried. Study 1
settled the upstream question by measurement — **the terminal is a view, not the session**;
conversation state lives in a transcript file at the CLI host, and `claude --resume <uuid>` reloads
it. Once that is established, "moving the session" stops being a terminal problem and becomes a
question about **which artifacts are bound to the machine they were created on**.

So the deciding question, and the analogue of Study 1's *view or session*:

> **What does not travel — and does anything even record that it cannot?**

---

## 2. What travels, what does not

`[MEASURED]` On the live store (`~/src/a2a-cli/`) and on `origin/main`, 2026-08-02:

| artifact | scoping | travels? |
|---|---|---|
| `workspaceId` | derived from the repo: `sha256(sorted root commits + worktreeRelPath)` | **yes** — it is a property of the repository, not of the host |
| the transcript file | a per-project `.jsonl` at the CLI host | yes, if the file is moved with it |
| `providerSessionId`, `instance`, `agentUuid` | opaque identifiers in the binding record | yes, they are strings |
| the identity binding | a line in `identity/bindings.jsonl`, inside a local store directory | **only by copying the store** — see §3 |
| private keys | 192 keypairs under `<store>/keys/` | only by copying the store |
| the inbox | 74 boxes, 986 envelopes under `<store>/inbox/` | only by copying the store |
| the session lease | **machine-scoped by design**, filed beside `registry.json`, under no repo | **no, and correctly so** |
| presence / heartbeat | live process observation | no |
| the tmux attachment | a view | no — and Study 1 says that is fine |

`[MEASURED]` The session lease is the one artifact that is *explicitly* machine-scoped, and its own
header says why: the concurrency pool is contended by sessions from several repos on one machine, so
a lease filed in one repo's `.track/` cannot arbitrate it, and repo-scoping would make pool
correctness depend on repo identity, *which derives*. That reasoning is sound and this study does not
disturb it. **The lease is the good case: it knows what it is scoped to.**

---

## 3. The finding: the binding's machine scoping is implicit in its location

`[MEASURED]` A binding record has exactly six fields, present on all 192 records in the live store:

```
{host, providerSessionId, workspaceId, instance, agentUuid, at}
```

`host` is `"claude"` on **all 192** — it is the *CLI kind*, not the machine. A probe for `machine`,
`bootId`, `hostname`, `node`, `fqdn` and `mac` across the whole file returns **0 occurrences of
each**. Positive control: the field census is complete and non-empty (each of the six fields appears
192/192), so the absence is a measurement and not a failed search.

`[JUDGMENT]` So an identity binding **does not record which machine it lives on**. Today that is
harmless, and there is even a respectable argument for it: the store is machine-local, so the store's
location *is* the scoping, and a field would be redundant.

That argument holds exactly as long as the store does not move. **A pivot is a move of the store.**
The operation dissolves the only thing that scoped the binding, and nothing in the record notices.
Copy the store to a pod and every binding arrives asserting a `workspaceId` that legitimately travels
and a `host` that says only `claude` — indistinguishable from a binding minted there.

`[JUDGMENT]` This is the same shape as the finding that runs through all three studies, arriving by a
door I did not expect:

> **A guarantee that rests on an unstated precondition is not a guarantee — it is a habit that has
> not yet been contradicted.**

The lease states its precondition (machine-scoped, and says so in its first line). The binding does
not. That is the whole difference, and it is the difference between the two artifacts surviving the
same operation.

---

## 4. Recommendation

`[JUDGMENT]` Three, ordered, and none of them is "build a pivot".

1. **Do not design a pivot yet.** The cost of moving a *view* is small and Study 1 established that
   the terminal is one. The cost that is not yet known is what a moved *binding* asserts on arrival,
   and that is §3, not a terminal problem.
2. **Make the binding state its own scope before anything moves.** If a binding is machine-scoped,
   the record should say so; if it is not, then it must be valid after a move, and that is a claim
   somebody has to make deliberately. Today neither is stated, so the question cannot even be
   answered by reading the data. This is the cheap, reversible gesture, and it is a precondition of
   evaluating any pivot — not a consequence of one.
3. **Keep the lease out of it.** It is machine-scoped on purpose and it should stay behind. A pivot
   that carries the lease would carry a pool arbitration that means nothing on the destination.

---

## 5. What I did not measure, and whose it is

`[JUDGMENT]` This study is deliberately half-open, and naming the gaps is more useful than closing
them with reasoning.

- **Whether a k8s-hosted CLI can resume a transcript at all** — not measured. That is the load-bearing
  runtime question and it belongs to `runtime` (WP5) with `portal` (WP12) for the remote surface. If
  the answer is no, §4.1 stops being a recommendation and becomes moot.
- **What the remote orchestrator does with identity today** — not measured. `packages/remote-k8s-orchestrator`
  exists; I did not read it. Owner: `runtime` / `portal`.
- **Whether two stores already hold colliding bindings** — not measured. The boxes are fragmented
  across at least three roots (`~/src/a2a-cli/inbox` is the live one; `~/src/h2a/.h2a/inbox` and
  `~/h2a-workspace/.h2a/inbox` hold others, some stale). I measured **one** store. A collision across
  the existing three would mean §3's risk is not hypothetical but already realised, and that is worth
  knowing before any pivot. I state it as unmeasured rather than implying either answer.
- **The security posture of moving keys** — out of scope here and it belongs to WP15. Study 2 already
  says the local posture precedes any remote surface; that ordering constraint applies to a pivot
  exactly as it applies to cowork.

**Where the measurements stop.** One store, one date, `origin/main` of this repository. The binding
census is a census of the file as it stands; it does not prove that no other code path writes a
machine field elsewhere. I checked the record, not every writer.

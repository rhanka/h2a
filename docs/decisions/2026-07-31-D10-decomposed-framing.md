# D10, reframed as choices a person can make

D10 is really about how lasting notes—things an AI agent writes down so it can use them in later conversations—should behave when several agents work on one project. We must choose how those notes are put in order, whether they travel with a copied project, what happens to notes from turns a user later removes, and whether agents doing different jobs share them. These choices decide whether an agent can tell which note came first, carry memory into a fresh copy of the project, avoid treating discarded work as current, and share useful knowledge without mixing notes that should stay separate.

One related question is outside these four choices: **when should an agent save a note?** The older D10 page also asked that—for example, whether to save after a set number of turns—and it remains open. This document does not answer it.

## 1. How much order must the memory preserve?

**Question: Must the memory put notes in order only within one conversation, or also across conversations and across different AI agents?**

### Option A — Number the turns in each conversation

- **What it means:** Each conversation has turn 1, turn 2, turn 3, and so on.
- **The agent could:** tell which of two notes came first when both came from the same conversation.
- **The agent could not:** compare turn 3 from one conversation with turn 7 from another, or reliably tell which of two conflicting notes from different agents is newer.
- **Concrete cost:** This is the smallest change: each note needs the conversation it came from and its turn number. Adding order across agents later would require changing old notes, and the original writing times might be impossible to recover.

### Option B — Record both the turn number and the date and clock time

- **What it means:** A note keeps its order inside its own conversation and also records when it was added to the shared memory.
- **The agent could:** follow the order inside one conversation, compare notes from different agents, and better judge which of two conflicting notes is newer.
- **The agent could not:** always know when a real-world event happened merely from the time the note was written; that would still need separate information when it matters.
- **Concrete cost:** Every note needs both pieces of information. The system must handle older notes that lack one of them, equal times, and machines whose clocks disagree.

**Why this is a real choice:** The Graphify team, which owns the part that stores the memory, tested turn numbers and found that they order only one conversation. Two agents can both have a turn 1, so a date and clock time is needed to compare their notes. The memory team's separate review reached the same result: the two kinds of order solve different problems. The earlier choice to detect conflicting notes also requires knowing which note was written later.

**Memory team's recommendation:** The measurements lean toward **Option B, recording both**, because turn numbers give the clearest order inside one conversation while a date and clock time is needed across agents. This is the memory team's reading of the evidence, not a settled fact or a decision already made.

**Who can decide:** The owner can choose the behavior the product needs. Recording and using the extra information also changes Graphify, so it cannot be imposed without agreement from the person authorized to decide for Graphify.

## 2. Where should the memory be kept?

**Question: Should a fresh copy of the project's code bring its memory with it, or should the memory stay only in Graphify, a separate always-running place that holds the memory?**

### Option A — Keep the memory only outside the code

- **What it means:** The memory lives in Graphify and is not saved with the project's code.
- **The agent could:** use one current copy of the memory without keeping it in step with another copy saved with the code.
- **The agent could not:** recover the memory from a fresh copy of the code alone or give a collaborator the memory merely by giving them the code.
- **Concrete cost:** The team must make backups, move them where they will be safe, and test that they can be restored. Graphify can currently replace the whole memory at once but cannot yet add one note at a time, so that ability must be built before it can serve as a continually updated memory.

### Option B — Save the whole current memory with the code

- **What it means:** Each saved version of the code also carries the full memory as it stood at that point.
- **The agent could:** recover that memory from a fresh copy of the project and inspect how the saved memory changed alongside the code.
- **The agent could not:** avoid clashes when different agents save different copies, or avoid the project growing as the memory grows.
- **Concrete cost:** The team must build rules and tools to merge competing copies. One measured Graphify data set was about 54 megabytes (MB) against a current limit of about 52 MB—roughly 1.6 MB too large—so size is already a problem.

### Option C — Use Graphify for daily work and save a smaller recovery copy with the code

- **What it means:** Graphify holds the current working memory; from time to time the project saves a smaller, well-defined copy that is sufficient to rebuild or recover it.
- **The agent could:** add and read current notes from one working place while still carrying a usable memory with a fresh copy of the project.
- **The agent could not:** promise that the saved copy contains the very latest note, or avoid every clash when two people update that saved copy.
- **Concrete cost:** The teams must define exactly what the recovery copy contains, when it is refreshed, and how it is compared with a newer working memory. Graphify must also be able to rebuild the same result reliably and add individual notes instead of replacing everything.

**Why this is a real choice:** The owner explicitly said that having memory saved with the code is valuable, but also warned about keeping that copy in step with the working copy and merging memories from several agent jobs. Graphify measured both a current size limit and the lack of one-note-at-a-time writing. The merged memory study therefore leaves all three paths open rather than treating the earlier checkbox as a decision.

**Memory team's recommendation:** The measurements lean toward **Option C, an always-on working memory plus a smaller recovery copy**, because the owner wants the memory to travel with a copied project while the measured Graphify data already exceeds the current size limit. This is an early reading, not a proven answer: Graphify must still show that it can add individual notes and rebuild the same memory without losing or changing notes.

**Who can decide:** The owner decides whether carrying memory with the code is worth the extra work. Graphify must supply the storage and recovery facts. A choice here does not require Graphify to do that work until the person authorized to decide for Graphify agrees.

## 3. What should happen when a conversation is rewound?

**Question: When someone goes back to an earlier turn and removes the later turns, what should happen to memory notes created during those removed turns?**

### Option A — Erase those notes

- **What it means:** The memory is made to look as though the removed turns never happened.
- **The agent could:** show a small, simple current memory containing only the path the user kept.
- **The agent could not:** explain why an earlier decision was made, recover a useful note from the discarded path, or show that a once-believed note was later withdrawn.
- **Concrete cost:** Every stored copy must remove the same notes. A missed copy can bring a discarded note back, while a successful deletion permanently loses the history.

### Option B — Keep the notes but mark them as no longer current

- **What it means:** The notes remain in the history, but ordinary searches ignore them unless someone asks to see discarded paths.
- **The agent could:** reconstruct what happened, explain past decisions, and avoid treating a note from a removed turn as current.
- **The agent could not:** keep the history as small or as simple as deletion would.
- **Concrete cost:** Every search and every saved copy must respect the "no longer current" mark. The memory grows, and a faulty search could accidentally show a discarded note as current.

### Option C — Keep the removed notes on a separate path

- **What it means:** Rewinding starts a new version of the conversation; notes from the old version and the new version remain separate.
- **The agent could:** return to either version, compare them, and preserve both possible histories.
- **The agent could not:** safely treat both versions as one current memory without being told which version to use.
- **Concrete cost:** Every note must keep the version it belongs to. The system must prevent the two versions from being mixed by mistake and needs rules for combining them later, if that is ever allowed.

**Why this is a real choice:** The owner's D10 note explicitly raised rewinding but did not choose a result. The merged memory study confirms that erasing a note loses history, while keeping a withdrawn note preserves the explanation but makes every later search more careful. Keeping two separate versions is a third choice only if rewind is meant to let the user revisit both. The earlier choice to keep a history of memory changes also makes silent deletion a consequential exception, not a harmless detail.

**Memory team's recommendation:** There is no direct measurement that settles what the user should see. The earlier choice to keep a history makes **Option B** fit an ordinary rewind better. If rewind is meant to create two separate versions that a user can revisit, **Option C** fits that meaning better. This is the memory team's interpretation, not a measured fact and not the owner's decision.

**Who can decide:** The owner decides what a user should see after rewinding. Graphify decides how to make that behavior reliable, so the mechanism needs agreement from the person authorized to decide for Graphify.

## 4. What should agents doing different jobs share?

**Question: When AI agents do different jobs on the same project, should they share all memory, keep separate memories, or share only selected notes?**

### Option A — Give every agent one shared memory

- **What it means:** An architect, a coordinator, and other agent jobs all read and write the same memory.
- **The agent could:** immediately use useful notes written by another kind of agent and avoid copying common project facts.
- **The agent could not:** naturally keep job-specific or sensitive notes apart, or avoid irrelevant notes merely because another job produced them.
- **Concrete cost:** The teams must build rules for who may read or change each note and prevent private or irrelevant information from appearing in the wrong place.

### Option B — Keep a separate memory for each kind of job

- **What it means:** Each kind of agent sees only the memory made for its job unless something is copied across on purpose.
- **The agent could:** keep job-specific context isolated and search a smaller set of notes.
- **The agent could not:** learn automatically from another job's work or know that another memory already contains a newer, conflicting note.
- **Concrete cost:** Common facts are duplicated, separate copies can disagree, and the teams must build a safe way to copy or compare notes when sharing is needed.

### Option C — Share a common project memory and keep additional job-specific sections

- **What it means:** Every agent gets agreed project facts, while each kind of job can also keep notes that are not shared with everyone.
- **The agent could:** reuse common decisions without giving every note to every agent.
- **The agent could not:** make sharing automatic without a rule that says which notes are common and which are limited to one job.
- **Concrete cost:** Each note needs a clear sharing label. The teams must build access rules, a way to move a note between sections, and checks that prevent a limited note from leaking into the common memory.

**Why this is a real choice:** The owner's D10 note names several agent jobs that may need distinct memories and also raises sharing between them. The merged memory study says this is still open: it has not chosen separation, full sharing, or a mixed arrangement. This choice also changes what must happen when someone restores a saved project copy while newer notes already exist elsewhere.

**Memory team's recommendation:** The measurements do not tell us how much separation people need, so the memory team has no measured winner. **Option C** may balance reuse and separation, but presenting it as the measured answer would overstate the evidence.

**Who can decide:** This is **not the owner's decision alone**. The h2a team, which defines AI agent identities and job boundaries, must agree. For coding jobs, the harness team, which defines those jobs, must agree too. Graphify must agree to the storage and access rules. The owner can state the desired sharing behavior, but cannot promise work from those other teams by choosing an option here.

## Sources used

- The owner's D10 note in `docs/decisions/2026-07-25-agent-memory-owner-answers-v2.json`.
- The D9 and D10 sections, ownership map, and open-choice sections in `docs/specs/2026-07-25-h2a-agent-memory-merged-design.md`.
- The Graphify measurements and the memory team's independent review summarized in `tmp/BRIEF-d10-framing.md`.

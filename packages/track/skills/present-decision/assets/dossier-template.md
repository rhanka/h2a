# Decision <subject> — <decision object>

Default delivery: Focus design-system portable HTML, never a claude.ai artifact.
Create `dossier.json` with `h2a focus template -o dossier.json`; replace every example, then
run `h2a focus build dossier.json -o dossier.html`. Include a relevant ecosystem diagram
(`ecosystem:overview`, `ecosystem:models`, `ecosystem:knowledge`, `ecosystem:interfaces`).
Use the following as the content checklist for the document sections, not an alternative renderer.

> Title: one short line, plain words, no slogan/thesis. HTML `<title>` identical to visible title;
> small type (at most 1.25rem), thin band, never a hero.
> Reading budget: <total minutes, proportional to stakes>; <number of questions>.
> Each question below is self-contained and readable in 2 minutes, including options/recommendation
> (aim for at most 400 words). Use plain words; explain acronyms; replace opaque codes with names.

## Question — <explicit choice and boundary>

**Owner request (<date>, <source>):** “<literal relevant passage>”
**What changes for you:** <benefit, risk borne by the owner, why their decision is needed>.

**Context:** <current behavior and representative problem/scenario; affected people and constraints>.
**Facts [FACT]:** <decisive evidence with source>. **Assumptions / unknowns:** <what remains uncertain>.

**Diagram:** <show the decision's flow, options or consequences before calling the native question tool>.

| Option | Choice | Owner consequence: main benefit and drawback | Cost / rollback |
| --- | --- | --- | --- |
| A | <plain name> | <one line> | <brief> |
| B | <plain name> | <one line> | <brief> |

Use 2–4 short options with an honest case for each, including rejected alternatives.
State every implied choice; no nested sub-options. If another decision is needed, give it its own
self-contained question within the declared total budget. Explain dependencies between questions.

**Recommendation [JUDGMENT]:** <one option and decisive reason>.
**Strongest objection / what would overturn it:** <brief>.
**Failure scenario:** <how this could fail and the owner's exposure>.
**Presenter convenience:** <what helps the agent; any divergence from owner value>.

**Request trace / acceptance:** <each demand → option or criterion; explicit gaps/departures>.
**Answer needed:** <smallest concrete choice>.
Use the exposed native question tool after presenting this dossier; never a bare text question.
If unavailable, explain the limitation and leave the decision pending.

Supporting evidence: <optional links; no choices or material risks hidden here>.
Required reviews: <independent Codex + Opus findings/disagreement for complex design, if applicable>.
Run `self-audit.md`; mark **Incomplete** for missing necessary input/review, and request input, not approval.

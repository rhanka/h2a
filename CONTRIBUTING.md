# Contributing to h2a

Thanks for contributing. This document records the conventions every committed
change in this repository must follow.

## Language policy

**All committed artifacts are English-first.** This applies to code,
comments, docs, specs, plans, `DECISIONS.md`, commit messages, READMEs, and
every other file tracked in git.

There are only three permitted exceptions where French may appear in a
committed file:

1. **Verbatim raw user / PRINCIPAL intentions.** Text explicitly attributed as
   a direct quote — for example lines marked `> **Verbatim (PRINCIPAL)**:` or
   French wrapped in `« … »` (or `"…"`) and attributed to the user — is kept in
   French, untouched, so the original intent is never lost. The
   *interpretation, analysis, or summary around such a quote must be written in
   English.* (`INTENTION.md` shows the canonical pattern: the user verbatim is
   preserved with an English translation and a pointer to the French source in
   git history.)
2. **Explicit translations.** Clearly labelled translation pairs (an English
   line accompanied by its French source, marked as such).
3. **Deliberate frozen lexicon tokens.** These are intentional French/neutral
   proper nouns, *not* franglais, and must not be anglicised:
   - the roles `PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`,
     `MANDATAIRE`;
   - the EVO-9 trust-concept names `VALEUR`, `ATTENTION`, `INTÉRÊT`,
     `MUTUALISATION`, `CONFIANCE`;
   - the French definitions inside `VOCABULARY.md`, where French is the lexicon
     by design;
   - established domain tokens that are also code identifiers / CLI flags
     (e.g. `relance`, `relauncher`, `--max-relances`). These are part of the
     stable API surface; renaming them is a separate, deliberate decision (a
     new `DEC-NNN`), not a language-hygiene edit.

Anything else — French prose, French code comments, French sentences, or
anglicism hybrids ("franglais") mixed into otherwise-English files — is a
defect to fix. Translate the meaning faithfully into clear English; do not
rewrite the structure.

When you are unsure whether a French passage is one of the three permitted
cases above, **leave it unchanged and flag it for human review** rather than
guess.

## Other conventions

- Any new requirement → add to `SPEC.md` (continuous `REQ-NNN` numbering).
- Any new decision → add to `DECISIONS.md` (continuous `DEC-NNN`, append-only).
- Any concept rename → new `DEC-NNN` + a version bump of `VOCABULARY.md`.
- **No co-authoring trailers.** Do not add `Co-Authored-By` or any AI
  attribution to commits in this repository.
- Release: see [`docs/release.md`](./docs/release.md).

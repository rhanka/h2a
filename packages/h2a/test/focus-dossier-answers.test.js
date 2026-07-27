// Where a Focus dossier answer lives, and what happens when two copies disagree.
//
// These tests exist because of a real loss: the owner opened the agent-memory dossier and their seven
// committed answers — with six verbatim notes — were NOT THERE. Nothing was lost in git; the page simply
// read answers out of revision-scoped `localStorage` and showed an empty dossier on any browser that did
// not happen to hold that key. The verification that preceded the incident SEEDED localStorage from the
// committed JSON and then read it back: it proved the reader worked, not that the data was there. A
// control that supplies its own input proves nothing about the user's situation.
//
// So every test below starts from NO browser state, exactly as a fresh profile does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  collectAnsweredOnly,
  diffAgainstCommitted,
  isEmptyAnswerState,
  projectAnswerSet,
  readDraft,
  reconcileAnswerState
} from "../../../apps/focus/src/lib/dossier-answers.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ANSWERS_FILE = join(
  REPO_ROOT,
  "docs",
  "decisions",
  "2026-07-25-agent-memory-owner-answers.json"
);

/** The owner's real committed answers — the actual file, never a fixture that agrees with us by design. */
const committedJson = JSON.parse(readFileSync(ANSWERS_FILE, "utf8"));

/** The revision-2 dossier: D1–D7 carried over, D8–D13 added since. */
const decisions = [
  { key: "D1", options: [{ key: "hybride" }, { key: "autre" }] },
  { key: "D2", options: [{ key: "graphe-ontologique-corpus" }] },
  { key: "D3", options: [{ key: "ecriture-gatee" }] },
  { key: "D4", options: [{ key: "bi-temporelle" }] },
  { key: "D5", options: [{ key: "embarque-local" }] },
  { key: "D6", options: [{ key: "crdt-append-log" }] },
  { key: "D7", options: [{ key: "activememory-ctx" }] },
  { key: "D8", options: [{ key: "a" }] },
  { key: "D9", options: [{ key: "a" }] },
  { key: "D10", options: [{ key: "a" }] },
  { key: "D11", options: [{ key: "a" }] },
  { key: "D12", options: [{ key: "a" }] },
  { key: "D13", options: [{ key: "a" }] }
];
const REVISION = "agent-memory-2026-07-25";

test("the committed file still holds seven answers and six verbatim notes", () => {
  // Guards the premise of every other test: if the source of truth is emptied or reshaped, these tests
  // must fail loudly rather than keep passing against nothing.
  const keys = Object.keys(committedJson.answers);
  assert.deepEqual(keys, ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
  const withNotes = keys.filter((k) => committedJson.answers[k].note.length > 0);
  assert.equal(withNotes.length, 6, "D7 legitimately has no note; the other six do");
  assert.equal(committedJson.answers.D7.note, "");
  assert.match(committedJson.answers.D1.note, /graphify/);
});

test("a fresh browser — no storage at all — shows D1..D7 WITH their notes", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const reconciled = reconcileAnswerState(null, committed, committedJson);

  assert.equal(reconciled.origin, "committed");
  assert.deepEqual(reconciled.divergences, []);
  assert.deepEqual(Object.keys(reconciled.state.selections), [
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7"
  ]);
  // The notes are the reasoning. An answer set that restores seven options and no notes has restored the
  // labels and dropped the thinking.
  assert.deepEqual(Object.keys(reconciled.state.notes), ["D1", "D2", "D3", "D4", "D5", "D6"]);
  assert.equal(reconciled.state.notes.D1, committedJson.answers.D1.note);
  assert.equal(reconciled.state.notes.D6, committedJson.answers.D6.note);
});

test("an EMPTY stored draft counts as no draft — this is the exact bug that lost the answers", () => {
  // The previous page wrote `{}` into localStorage on every mount. A browser that had merely OPENED the
  // dossier therefore held a present-but-empty draft, and "present" was treated as authoritative.
  const emptyDraft = readDraft({}, {}, decisions);
  assert.ok(isEmptyAnswerState(emptyDraft));

  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const reconciled = reconcileAnswerState(emptyDraft, committed, committedJson);

  assert.equal(reconciled.origin, "committed");
  assert.equal(Object.keys(reconciled.state.notes).length, 6);
});

test("a corrupt draft cannot shadow the committed set", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  for (const junk of [null, undefined, "nope", 42, []]) {
    const draft = readDraft(junk, junk, decisions);
    const reconciled = reconcileAnswerState(draft, committed, committedJson);
    assert.equal(reconciled.origin, "committed", `junk draft ${JSON.stringify(junk)} must not win`);
    assert.equal(Object.keys(reconciled.state.notes).length, 6);
  }
});

test("a draft that DISAGREES is shown, but never silently — the divergence is named with both values", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  // What a real draft looks like: the committed set as loaded, with one answer edited on top of it.
  const draft = readDraft(
    { ...committed.state.selections, D1: "autre" },
    { ...committed.state.notes, D1: "j'ai changé d'avis" },
    decisions
  );

  const reconciled = reconcileAnswerState(draft, committed, committedJson);

  assert.equal(reconciled.origin, "draft");
  // Only D1 diverges: D2 matches the committed answer exactly and must not cry wolf.
  assert.deepEqual(
    reconciled.divergences.map((d) => d.key),
    ["D1"]
  );
  const d1 = reconciled.divergences[0];
  assert.equal(d1.committedOption, "hybride");
  assert.equal(d1.draftOption, "autre");
  assert.equal(d1.committedNote, committedJson.answers.D1.note);
  assert.equal(d1.draftNote, "j'ai changé d'avis");
});

test("a PARTIAL stale draft is flagged on every answer it is missing, not quietly accepted", () => {
  // A draft left behind by the old page can hold two answers where git holds seven. Displaying it without
  // comment would show five empty cards that are answered in the repository — the original loss, again.
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const draft = readDraft({ D1: "hybride" }, { D1: committedJson.answers.D1.note }, decisions);

  const reconciled = reconcileAnswerState(draft, committed, committedJson);

  assert.equal(reconciled.origin, "draft");
  assert.deepEqual(
    reconciled.divergences.map((d) => d.key),
    ["D2", "D3", "D4", "D5", "D6", "D7"],
    "every answer the draft lacks is named"
  );
  // And each divergence carries the committed value, so the reader sees what the repository holds.
  const d2 = reconciled.divergences.find((d) => d.key === "D2");
  assert.equal(d2.committedNote, committedJson.answers.D2.note);
  assert.equal(d2.draftNote, "");
});

test("losing only the NOTE counts as divergence — the option is just its label", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const draft = readDraft({ D3: "ecriture-gatee" }, {}, decisions);
  const divergences = diffAgainstCommitted(draft, committed.state, committedJson);
  assert.ok(divergences.some((d) => d.key === "D3" && d.draftNote === ""));
});

test("answering a card ADDED since is an addition, not a disagreement", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const draft = readDraft(
    { ...committed.state.selections, D8: "a" },
    { ...committed.state.notes, D8: "réponse à une carte nouvelle" },
    decisions
  );
  const reconciled = reconcileAnswerState(draft, committed, committedJson);
  assert.deepEqual(reconciled.divergences, [], "D8 is not covered by the committed set");
  assert.equal(reconciled.state.notes.D8, "réponse à une carte nouvelle");
});

test("the revision carry-over is reported as 7 carried and D8..D13 added since, never as loss", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  assert.equal(committed.report.applied.length, 7);
  assert.deepEqual(committed.report.missingDecisions, [], "nothing in the set fell off this revision");
  assert.deepEqual(committed.report.staleOptions, []);
  assert.deepEqual(committed.report.unanswered, ["D8", "D9", "D10", "D11", "D12", "D13"]);
  assert.equal(committed.report.revisionMismatch, true, "answers are keyed to -24, dossier is -25");
});

test("a committed answer whose decision disappeared is REPORTED, not dropped in silence", () => {
  const shrunk = decisions.filter((d) => d.key !== "D6");
  const committed = projectAnswerSet(committedJson, shrunk, REVISION);
  assert.deepEqual(committed.report.missingDecisions, ["D6"]);
  assert.ok(!("D6" in committed.state.notes));
});

test("a committed answer whose OPTION disappeared keeps the note and reports the stale selection", () => {
  const mutated = decisions.map((d) => (d.key === "D4" ? { key: "D4", options: [{ key: "autre" }] } : d));
  const committed = projectAnswerSet(committedJson, mutated, REVISION);
  assert.deepEqual(committed.report.staleOptions, ["D4 → bi-temporelle"]);
  assert.equal(committed.state.notes.D4, committedJson.answers.D4.note, "the reasoning survives");
  assert.ok(!("D4" in committed.state.selections));
});

test("what leaves for the CLI carries every note, verbatim", () => {
  const committed = projectAnswerSet(committedJson, decisions, REVISION);
  const outgoing = collectAnsweredOnly(committed.state, decisions);

  assert.equal(outgoing.length, 7, "seven answered decisions leave together");
  assert.equal(outgoing.filter((a) => a.note.length > 0).length, 6);
  for (const answer of outgoing) {
    const source = committedJson.answers[answer.decisionKey];
    assert.equal(answer.optionKey, source.option);
    assert.equal(answer.note, source.note.trim());
  }
});

test("no answer set at all degrades to an honest empty, never to invented answers", () => {
  const reconciled = reconcileAnswerState(null, projectAnswerSet(null, decisions, REVISION), null);
  assert.equal(reconciled.origin, "empty");
  assert.deepEqual(reconciled.state, { selections: {}, notes: {} });
});

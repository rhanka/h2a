/**
 * Unit specs for the `/track` read binding (Focus-M1 L2).
 *
 * Reads a REAL `@sentropic/track` event log (`tests/.track/events.jsonl`) through a `TrackReader`
 * and asserts the binding maps a real `canevas(workspace, { baselineCommit, decisionId }).dossier`
 * + `amendmentTrace(decisionId)` into a concrete `DecisionDossierDocument` with the CORRECTED
 * shapes:
 *   - `DecisionDossierView = { id, title, workspace, outcome, dossier }` (no top-level comprehension);
 *   - `Outcome = 'pending'|'go'|'no-go'|'deferred'`;
 *   - `ComprehensionEvidence` NESTED under `dossier.artifacts[] (kind:'h2a-decision-dossier').comprehension[]`;
 *   - the anti-confused-deputy invariant: the comprehension `subject` (the NAMED attester) is NOT
 *     the channel principal that merely relayed the write;
 *   - `amendmentTrace` ordered by seq, machine origin never laundered.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  DecisionNotFoundError,
  EXPECTED_TRACK_READ_MAJOR,
  readDecisionDossier,
  toDecisionDossierDocument,
} from "../src/track/index.js";
import { TrackReader } from "@sentropic/track/read";
import { renderHtml, renderMd, renderTerminal } from "../src/index.js";
import type { HtmlRenderHooks } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = mkdtempSync(join(tmpdir(), "focus-read-fixture-"));
const eventsPath = join(fixtureDir, "events.jsonl");
copyFileSync(join(here, ".track", "events.jsonl"), eventsPath);
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
const DECISION_ID = "01JFOCUSDECISION00000000000";
const READ_AT = "2026-06-21T12:00:00.000Z";
const query = {
  workspace: "focus",
  baselineCommit: "deadbeefcafebabedeadbeefcafebabedeadbeef",
  decisionId: DECISION_ID,
};

const hooks: HtmlRenderHooks = {
  renderMarkdown: (md) => `<md>${md}</md>`,
  sanitizeHtml: (html) => `<!--sanitized-->${html}`,
};

describe("readDecisionDossier (real @sentropic/track/read binding)", () => {
  const doc = readDecisionDossier(eventsPath, query, READ_AT);

  it("binds against a contract whose major matches the expected one", () => {
    const reader = new TrackReader(eventsPath);
    const major = Number.parseInt(reader.contractVersion.split(".")[0] ?? "", 10);
    expect(major).toBe(EXPECTED_TRACK_READ_MAJOR);
  });

  it("maps a real DecisionDossierView into a concrete decision-dossier document", () => {
    expect(doc.ref).toBe(DECISION_ID);
    // subject is derived from the view.workspace (the corrected shape carries id/title/workspace).
    expect(doc.subject).toBe("focus");
    expect(doc.title).toBe("Should focus bind to @sentropic/track/read at L2?");
  });

  it("projects the dossier (context + qa + options + outcome) into typed FocusNodes", () => {
    const kinds = doc.sections.map((s) => s.kind);
    expect(kinds).toEqual([
      "prose", // context
      "question", // qa-comprehension
      "question", // qa-clock
      "optionSet", // options
      "outcome", // terminal outcome node
    ]);
    const outcome = doc.sections[doc.sections.length - 1];
    expect(outcome.kind).toBe("outcome");
    if (outcome.kind === "outcome") {
      expect(outcome.modality).toBe("decision");
      // Outcome 'go' → a GO statement (the corrected Outcome union maps to a statement).
      expect(outcome.statement).toContain("GO");
    }
  });

  it("maps the selected option to an 'accept' annotation and carries the recommendation rationale", () => {
    const optionSet = doc.sections.find((s) => s.kind === "optionSet");
    expect(optionSet?.kind).toBe("optionSet");
    if (optionSet?.kind === "optionSet") {
      const selected = optionSet.options.find(
        (o) => o.label === "Bind to the versioned /read subpath",
      );
      expect(selected?.annotation).toBe("accept");
      expect(selected?.annotationComment).toContain("versioned /read");
      const other = optionSet.options.find(
        (o) => o.label === "Bind to the non-versioned barrel",
      );
      expect(other?.annotation).toBe("none");
    }
  });

  it("carries comprehension evidence from the NESTED dossier artifact (not a top-level sibling)", () => {
    expect(doc.provenance.comprehensionEvidence).toBeDefined();
    expect(doc.provenance.comprehensionEvidence?.subject).toBe("architect");
    expect(doc.provenance.comprehensionEvidence?.dossierHash).toContain("sha256:");
    expect(doc.provenance.comprehensionEvidence?.signature).toBe(
      "sig:architect-attestation",
    );
  });

  it("upholds the anti-confused-deputy invariant: attester subject != channel relayer principal", () => {
    // The artifact arrived over a relay channel whose prov.principal is 'relay-gateway', but the
    // comprehension subject is the NAMED attester/decider 'architect'. The binding must surface the
    // attester, never launder the origin into the relayer.
    expect(doc.provenance.comprehensionEvidence?.subject).toBe("architect");
    expect(doc.provenance.comprehensionEvidence?.subject).not.toBe(
      "relay-gateway",
    );
  });

  it("carries the amendment trace ordered by seq (machine origin never laundered)", () => {
    // Three amendment events on the decision aggregate: decision.artifact-added (seq 2) and
    // decision.outcome (seq 3) are amendment-trace kinds (decision.created is NOT). Ordered by seq.
    expect(doc.amendmentTrace.length).toBeGreaterThanOrEqual(2);
    const summaries = doc.amendmentTrace.map((s) => s.summary);
    // The outcome step comes after the artifact-added step (seq ordering preserved).
    const artifactIdx = summaries.findIndex((s) => s.includes("artifact-added"));
    const outcomeIdx = summaries.findIndex((s) => s.includes("GO"));
    expect(artifactIdx).toBeGreaterThanOrEqual(0);
    expect(outcomeIdx).toBeGreaterThan(artifactIdx);
    // Every recorded step here is human-proposed (prov.proposed=false → origin 'human').
    for (const step of doc.amendmentTrace) {
      expect(step.author).toContain("(human)");
    }
  });

  it("preserves legacy data but blocks its presentation until readability information exists", () => {
    expect(doc.title).toContain("Should focus bind");
    expect(doc.readability).toBeUndefined();
    for (const render of [renderTerminal, renderMd, (value: typeof doc) => renderHtml(value, hooks)]) {
      expect(() => render(doc)).toThrow(/owner request/);
    }
  });

  it("throws DecisionNotFoundError for an unknown decision id", () => {
    expect(() =>
      readDecisionDossier(
        eventsPath,
        { ...query, decisionId: "01JNOSUCHDECISION0000000000" },
        READ_AT,
      ),
    ).toThrow(DecisionNotFoundError);
  });
});

describe("toDecisionDossierDocument (pure mapper over the real read types)", () => {
  it("maps a legacy optionless read dossier without comprehension evidence", () => {
    const doc = toDecisionDossierDocument(
      {
        id: "01JBARE000000000000000000000",
        title: "Bare decision",
        workspace: "focus",
        outcome: "pending",
        // Explicit legacy-read fixture: this pure mapper must render history that
        // predates the fail-closed Track writer; it is never submitted to Track.
        dossier: { context: "no artifacts", options: [], qa: [] },
      },
      [],
      { source: "test", readAt: READ_AT, cursor: "count:0" },
    );
    expect(doc.provenance.comprehensionEvidence).toBeUndefined();
    expect(doc.amendmentTrace).toHaveLength(0);
    // context prose + terminal outcome node only.
    expect(doc.sections.map((s) => s.kind)).toEqual(["prose", "outcome"]);
  });
});

describe("readable Track projection", () => {
  it("preserves the supplied presentation fields and renders all surfaces", () => {
    const dossier = JSON.parse(readFileSync(new URL("./readable-track.fixture.json", import.meta.url), "utf8"));
    const doc = toDecisionDossierDocument({ id: "shed", title: "Choose the garden shed location", workspace: "ws:opaque", outcome: "pending", dossier }, [], { source: "fixture", readAt: READ_AT, cursor: "count:1" });
    expect(doc.subject).toBe(dossier.subject);
    expect(doc.readability).toEqual(dossier.readability);
    expect(doc.sections).toContainEqual(expect.objectContaining({ kind: "question", ...dossier.qa[0] }));
    for (const render of [renderTerminal, renderMd, (value: typeof doc) => renderHtml(value, hooks)]) {
      expect(render(doc)).toContain("A short walk and a clear terrace view.");
    }
  });

  it("keeps each question's explicit options and recommendation together", () => {
    const dossier = JSON.parse(readFileSync(new URL("./readable-track.fixture.json", import.meta.url), "utf8"));
    dossier.qa.push({
      id: "q-visit", question: "When should we visit the possible spots?",
      context: "Both days are free; choose the day that suits your schedule.",
      readingTimeMinutes: 1, recommendedOptionId: "visit-now",
      recommendedAnswer: "Visit this week, so the work can start sooner.",
    });
    dossier.options.push(
      { id: "visit-now", title: "Visit this week", summary: "Start work sooner.", questionId: "q-visit" },
      { id: "visit-later", title: "Visit next week", summary: "Keep this week free.", questionId: "q-visit" },
    );
    const doc = toDecisionDossierDocument(
      { id: "shed", title: "Choose the garden shed location", workspace: "garden", outcome: "pending", dossier },
      [], { source: "fixture", readAt: READ_AT, cursor: "count:1" },
    );
    expect(doc.sections.filter((s) => s.kind === "optionSet").map((s) => [s.questionId, s.options.map((o) => o.id)]))
      .toEqual([["q-spot", ["a", "b"]], ["q-visit", ["visit-now", "visit-later"]]]);
    const text = renderMd(doc);
    expect(text.indexOf("Back of the garden")).toBeLessThan(text.indexOf("When should we visit"));
    expect(text).toContain("préco: Visit this week, so the work can start sooner.");
  });
});

/**
 * Unit specs for the FocusSnapshot render-core (Focus-M1 L1).
 *
 * Asserts: the fixture maps to a `DecisionDossierDocument`; terminal/MD/HTML render the
 * structure; the amendment trace renders on all three; affordances appear as DISABLED metadata;
 * diagrams fall back to a fenced/`<pre>`/text block (no diagram adapter); markdown is injected
 * (MD passthrough, HTML via the host hook) and HTML is sanitized via the host hook.
 */

import { describe, expect, it } from "vitest";

import { renderHtml, renderMd, renderTerminal } from "../src/index.js";
import type { HtmlRenderHooks } from "../src/index.js";
import { decisionDossierFixture } from "./fixture.data.js";
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';

it('should preserve source, citation, annex and section bindings in every export', () => {
  const evidence = evidenceFixture();
  evidence.annexes[0].summary = 'A literal <img onerror=bad()> is evidence.';
  for (const text of [renderMd(evidence), renderTerminal(evidence), renderHtml(evidence, hooks)]) {
    expect(text).toContain('Preuve distante');
    expect(text).toContain('long:12–13');
    expect(text).toContain('Détail des pièces');
    expect(text).toContain('3 sources');
    expect(text).toContain('late');
  }
  expect(renderHtml(evidence, hooks)).not.toContain('<img onerror=bad()>');
});

const doc = {
  ...decisionDossierFixture,
  readability: {
    ownerRequestQuote: "Keep the renderer private until a real consumer needs a public package.",
    stakes: "Publishing early commits us to supporting an interface before a user has tried it.",
    stakesLevel: "medium" as const,
    readingBudgetMinutes: 4,
    glossary: [
      { term: "M1", definition: "First delivery stage: a reusable document renderer." },
      { term: "L1", definition: "First step: render fixed example documents." },
      { term: "L4", definition: "Fourth step: add authorized live changes." },
    ],
  },
  sections: decisionDossierFixture.sections.map((section) => {
    if (section.kind === "prose") return {
      ...section,
      markdown: "## Context\n\nIn short: The decision-dossier is the **first** focus type. This stage is fixture-driven with no track dependency.",
    };
    if (section.kind === "question") return {
      ...section, context: "A private package lets us try the interface before making a public support commitment.",
      readingTimeMinutes: 2, recommendedOptionId: "opt-private",
    };
    if (section.kind === "optionSet") return {
      ...section, questionId: "q-publish", options: section.options.map((option, index) => ({
        ...option, consequence: ["Try the interface without a public support commitment.", "Commit to supporting a public interface now.", "Keep one copy inside the application, making reuse harder."][index],
      })),
    };
    if (section.kind === "outcome") return { ...section, questionId: "q-publish", statement: section.statement.replace("PRIVATE", "private").replace(";", ":") };
    return section;
  }),
};

// A trivial host markdown hook (NOT marked — proves injection). Wraps content in a marker.
const hooks: HtmlRenderHooks = {
  renderMarkdown: (md) => `<md>${md}</md>`,
  sanitizeHtml: (html) => `<!--sanitized-->${html}`,
};

describe("renderTerminal", () => {
  const out = renderTerminal(doc);

  it("renders the header, subject and outcome", () => {
    expect(out).toContain("Should focus ship a private render-core first?");
    expect(out).toContain("subject: Focus-M1 L1 render-core packaging");
    expect(out).toContain("Outcome [decision]:");
  });

  it("renders the question with its préco and the validated state", () => {
    expect(out).toContain("Q: Publish @sentropic/focus at L1?  [validated]");
    expect(out).toContain("préco:");
  });

  it("renders option annotations including accept/reject/comment", () => {
    expect(out).toContain("(accept) Private app-local package");
    expect(out).toContain("(reject) Publish immediately");
    expect(out).toContain("(comment) Inline in @sentropic/cli");
  });

  it("renders the amendment trace", () => {
    expect(out).toContain("Amendment trace:");
    expect(out).toContain("Reframed decision-dossier as the first focus type.");
  });

  it("renders the diagram as a text fallback (no adapter)", () => {
    expect(out).toContain("Diagram (mermaid)");
    expect(out).toContain("| flowchart LR");
  });

  it("renders affordances as disabled metadata", () => {
    expect(out).toContain("Affordances (read-only snapshot):");
    expect(out).toContain("[disabled] Ratify the decision");
  });
});

describe("renderMd", () => {
  const out = renderMd(doc);

  it("renders an H1 title and the meta line", () => {
    expect(out).toContain("# Should focus ship a private render-core first?");
    expect(out).toContain("subject: Focus-M1 L1 render-core packaging");
  });

  it("emits prose markdown verbatim by default (injection, no transform)", () => {
    expect(out).toContain("## Context");
    expect(out).toContain("**first** focus type");
  });

  it("applies an optional host renderMarkdown hook when provided", () => {
    const transformed = renderMd(doc, {
      renderMarkdown: (md) => md.toUpperCase(),
    });
    expect(transformed).toContain("## CONTEXT");
  });

  it("renders the diagram as a fenced code block (fallback)", () => {
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart LR");
    expect(out).toContain("```");
  });

  it("renders the amendment trace section", () => {
    expect(out).toContain("### Amendment trace");
    expect(out).toContain("Split M1 into L1..L4");
  });

  it("renders affordances as disabled metadata", () => {
    expect(out).toContain("### Affordances (read-only snapshot)");
    expect(out).toContain("_(disabled)_");
  });
});

describe("renderHtml", () => {
  const out = renderHtml(doc, hooks);

  it("should fold the glossary while preserving every term and its anchor", () => {
    expect(out).toContain('<details class="focus-glossary"><summary>Glossary (3 terms)</summary>');
    expect(out).not.toMatch(/<details[^>]*\bopen\b/);
    for (const entry of doc.readability.glossary) {
      expect(out).toContain(`<dt id="glossary-${encodeURIComponent(entry.term)}">${entry.term}</dt>`);
      expect(out).toContain(`<dd>${entry.definition}</dd>`);
    }
  });

  it("should omit an empty glossary and use the singular for one term", () => {
    const plain = JSON.parse(JSON.stringify(doc).replace(/\b(?:M1|L1|L4)\b/g, 'stage'));
    plain.readability.glossary = [{ term: 'stage', definition: 'A delivery step.' }];
    const single = renderHtml(plain, hooks);
    expect(single).toContain('Glossary (1 term)');
    plain.readability.glossary = [];
    const empty = renderHtml(plain, hooks);
    expect(empty).not.toContain('<details class="focus-glossary"');
  });

  it("runs the whole document through the host sanitize hook", () => {
    expect(out.startsWith("<!--sanitized-->")).toBe(true);
  });

  it("renders the document article and header", () => {
    expect(out).toContain('<article class="focus-document"');
    expect(out).toContain("<h1>Should focus ship a private render-core first?</h1>");
  });

  it("injects markdown via the host renderMarkdown hook (no marked dep)", () => {
    expect(out).toContain("<md>## Context");
  });

  it("renders option annotations as data attributes", () => {
    expect(out).toContain('data-annotation="accept"');
    expect(out).toContain('data-annotation="reject"');
    expect(out).toContain('data-annotation="comment"');
  });

  it("renders the diagram as a <pre> fallback (no adapter)", () => {
    expect(out).toContain('class="focus-diagram"');
    expect(out).toContain('class="language-mermaid"');
    expect(out).toContain("flowchart LR");
  });

  it("renders the amendment trace section", () => {
    expect(out).toContain('class="focus-amendment-trace"');
    expect(out).toContain("Split M1 into L1..L4");
  });

  it("renders affordances as aria-disabled metadata", () => {
    expect(out).toContain('class="focus-affordance"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-affordance="ratifyOutcome"');
  });

  it("escapes renderer-emitted text content", () => {
    expect(out).toContain("ref: <code>decision:focus-render-core</code>");
  });
});

describe("1.1.0 / 2.1.0 reference diagram, inputs[], completionCriterion & escaping (A5, A9, A21)", () => {
  const refDoc = {
    ...doc,
    sections: doc.sections.map((section) => {
      if (section.kind === "prose") {
        return {
          ...section,
          inputs: [
            { ref: "spec-s0", kind: "artifact", label: "Validated framing" },
            { ref: "engram:raw-id", kind: "engram" },
          ],
          completionCriterion: "Framing reviewed with the owner.",
        };
      }
      if (section.kind === "question") {
        return {
          ...section,
          inputs: [{ ref: "bench-q1", kind: "benchmark", label: "Latency report" }],
          completionCriterion: "Choice recorded by the owner.",
        };
      }
      if (section.kind === "diagram") {
        return {
          kind: "diagram" as const,
          id: section.id,
          targetRef: section.targetRef,
          alt: "Architecture\nmap across stages.",
          sourceRef: "engram:roadmap-```-gantt",
          renderComponent: "GanttChart",
        };
      }
      return section;
    }),
  };

  it("A5 & A9 & A21: renderMd, renderHtml and renderTerminal emit §4.6 fallback, inputs/criterion lines, lengthened fences and collapsed newlines", () => {
    const md = renderMd(refDoc);
    expect(md).toContain("- Input: Validated framing (`spec-s0`)");
    expect(md).toContain("- Input: engram:raw-id (`engram:raw-id`)");
    expect(md).toContain("**Completion criterion:** Framing reviewed with the owner.");
    expect(md).toContain("- Input: Latency report (`bench-q1`)");
    expect(md).toContain("**Completion criterion:** Choice recorded by the owner.");
    expect(md).toContain("_Architecture map across stages._\n\n````\nGanttChart: engram:roadmap-```-gantt\n````");

    const html = renderHtml(refDoc, hooks);
    expect(html).toContain('<ul class="focus-inputs"><li><span class="focus-input-label">Validated framing</span> <code>spec-s0</code></li><li><span class="focus-input-label">engram:raw-id</span> <code>engram:raw-id</code></li></ul>');
    expect(html).toContain('<p class="focus-completion-criterion">Framing reviewed with the owner.</p>');
    expect(html).toContain('<ul class="focus-inputs"><li><span class="focus-input-label">Latency report</span> <code>bench-q1</code></li></ul>');
    expect(html).toContain('<p class="focus-completion-criterion">Choice recorded by the owner.</p>');
    expect(html).toContain('<figure class="focus-diagram" data-render-component="GanttChart" data-source-ref="engram:roadmap-```-gantt"><figcaption>Architecture\nmap across stages.</figcaption><pre><code>GanttChart: engram:roadmap-```-gantt</code></pre></figure>');

    const term = renderTerminal(refDoc);
    expect(term).toContain("  Input: Validated framing (spec-s0)");
    expect(term).toContain("  Input: engram:raw-id (engram:raw-id)");
    expect(term).toContain("  Completion: Framing reviewed with the owner.");
    expect(term).toContain("  Input: Latency report (bench-q1)");
    expect(term).toContain("  Completion: Choice recorded by the owner.");
    expect(term).toContain("Diagram (GanttChart) — Architecture map across stages. [engram:roadmap-```-gantt]");
  });
});

/**
 * Unit specs for the FocusSnapshot render-core (Focus-M1 L1).
 *
 * Asserts: the fixture maps to a `DecisionDossierDocument`; terminal/MD/HTML render the
 * structure; the amendment trace renders on all three; affordances appear as DISABLED metadata;
 * diagrams fall back to a fenced/`<pre>`/text block (no diagram adapter); markdown is injected
 * (MD passthrough, HTML via the host hook) and HTML is sanitized via the host hook.
 */

import { describe, expect, it } from "vitest";

import { FOCUS_THEME_MAX_CSS_BYTES, renderHtml, renderMd, renderTerminal } from "../src/index.js";
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
    expect(text).toContain('context → [1]');
    expect(text).toContain('[1] Preuve distante');
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

const EXPECTED_MAIN_RENDER_HTML =
  "<!--sanitized--><article class=\"focus-document\" data-ref=\"decision:focus-render-core\"><header class=\"focus-header\"><h1>Should focus ship a private render-core first?</h1><p class=\"focus-meta\">subject: Focus-M1 L1 render-core packaging · ref: <code>decision:focus-render-core</code> · cursor: <code>v7</code></p></header><section class=\"focus-readability\"><h2>Owner request</h2><blockquote>Keep the renderer private until a real consumer needs a public package.</blockquote><h2>Stakes</h2><p>Publishing early commits us to supporting an interface before a user has tried it.</p><p>Reading budget: 4 min (medium stakes)</p><style>@media print { .focus-glossary { color: #000; background: #fff; } .focus-glossary::details-content { display: block; content-visibility: visible; } }</style><details class=\"focus-glossary\"><summary>Glossary (3 terms)</summary><dl><dt id=\"glossary-M1\">M1</dt><dd>First delivery stage: a reusable document renderer.</dd><dt id=\"glossary-L1\">L1</dt><dd>First step: render fixed example documents.</dd><dt id=\"glossary-L4\">L4</dt><dd>Fourth step: add authorized live changes.</dd></dl></details></section><section class=\"focus-prose\"><md>## Context\n\nIn short: The decision-dossier is the **first** focus type. This stage is fixture-driven with no track dependency.</md></section><section class=\"focus-question\"><p class=\"focus-q\"><strong>Q:</strong> Publish @sentropic/focus at L1? <em>(validated)</em></p><p class=\"focus-context\">A private package lets us try the interface before making a public support commitment.</p><p class=\"focus-reading-time\">Reading time: 2 min</p><p class=\"focus-preco\">préco: Private app-local package — No — keep it private until a real consumer wires it.</p><p class=\"focus-answer\">answer: No.</p></section><section class=\"focus-optionset\"><h3>Options — Packaging strategy</h3><ul><li class=\"focus-option\" data-annotation=\"accept\"><strong>Private app-local package</strong><p class=\"focus-consequence\">Try the interface without a public support commitment.</p><div class=\"focus-option-body\">private: true, extract later</div></li><li class=\"focus-option\" data-annotation=\"reject\"><strong>Publish immediately</strong><p class=\"focus-consequence\">Commit to supporting a public interface now.</p> <span class=\"focus-option-comment\">— Violates the real-consumption rule.</span></li><li class=\"focus-option\" data-annotation=\"comment\"><strong>Inline in @sentropic/cli</strong><p class=\"focus-consequence\">Keep one copy inside the application, making reuse harder.</p> <span class=\"focus-option-comment\">— Loses the reusable boundary.</span></li></ul></section><figure class=\"focus-diagram\" data-syntax=\"mermaid\"><figcaption>Read track, build FocusDocument, render to a surface.</figcaption><pre><code class=\"language-mermaid\">flowchart LR\n  track --&gt; focus --&gt; render</code></pre></figure><section class=\"focus-outcome\" data-modality=\"decision\"><h3>Outcome (decision)</h3><p>Ship a private @sentropic/focus render-core first: publish only after a real consumer wires it.</p></section><section class=\"focus-amendment-trace\"><h3>Amendment trace</h3><ol><li><code>2026-06-20T10:00:00Z</code> <strong>owner</strong> — Reframed decision-dossier as the first focus type.</li><li><code>2026-06-21T09:00:00Z</code> <strong>conductor</strong> — Split M1 into L1..L4; L1 is the fixture-driven render-core.</li></ol></section><section class=\"focus-affordances\"><h3>Affordances (read-only snapshot)</h3><ul><li class=\"focus-affordance\" data-affordance=\"ratifyOutcome\" data-target=\"decision:focus-render-core:outcome\" aria-disabled=\"true\"><del>Ratify the decision</del> <span class=\"focus-affordance-meta\">ratifyOutcome → decision:focus-render-core:outcome (disabled)</span></li><li class=\"focus-affordance\" data-affordance=\"amendSpec\" data-target=\"decision:focus-render-core\" aria-disabled=\"true\"><del>Amend the spec</del> <span class=\"focus-affordance-meta\">amendSpec → decision:focus-render-core (disabled)</span></li></ul></section></article>";

describe("renderHtml theme CSS options", () => {
  it("produces byte-identical HTML to main 581c63eede when theme options are omitted", () => {
    const withoutOptions = renderHtml(doc, hooks);
    const withEmptyOptions = renderHtml(doc, hooks, {});
    expect(withoutOptions).toBe(EXPECTED_MAIN_RENDER_HTML);
    expect(withEmptyOptions).toBe(EXPECTED_MAIN_RENDER_HTML);
    expect(withoutOptions).not.toContain("data-focus-theme");
    expect(withoutOptions).not.toContain("data-theme=");
  });

  it("inlines valid CSS in <style data-focus-theme> after base styles and supports data: URLs", () => {
    const css = [
      `:root { --st-semantic-surface-default: #111827; }`,
      `.focus-document { background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"); }`,
      `.a { background-image: image-set("data:image/png;base64,AA" 1x, url("data:image/png;base64,BB") 2x); }`,
      `.b { background-image: -webkit-image-set(url(data:image/png;base64,AA) 1x); }`,
      `.c { background-image: image("data:image/png;base64,AA"); }`,
      `.d { background-image: cross-fade(50% "data:image/png;base64,AA", url("data:image/png;base64,BB")); }`,
      `.e { background-image: src("data:image/png;base64,AA"); }`,
    ].join("\n");
    const html = renderHtml(doc, hooks, { themeCss: css });
    const baseStyleIdx = html.indexOf("<style>");
    const themeStyleIdx = html.indexOf("<style data-focus-theme>");
    expect(baseStyleIdx).toBeGreaterThan(-1);
    expect(themeStyleIdx).toBeGreaterThan(baseStyleIdx);
    expect(html).toContain(`<style data-focus-theme>${css}</style>`);
    expect(html).not.toContain("data-theme=");
  });

  it("sets data-theme on root element only when themeId is provided", () => {
    const css = `[data-theme="devmtl"] { --st-semantic-surface-default: #0f172a; }`;
    const themed = renderHtml(doc, hooks, { themeCss: css, themeId: "devmtl" });
    expect(themed).toContain('<article class="focus-document" data-ref="decision:focus-render-core" data-theme="devmtl">');
    expect(themed).toContain(`<style data-focus-theme>${css}</style>`);
  });

  it("refuses @import, non-data url(...), unsafe image functions, </style, oversized CSS, and invalid themeId", () => {
    const badCssCases = [
      `@import "https://evil.example/a.css";`,
      `@IMPORT url('other.css');`,
      `body { @\\69 mport "evil.css"; }`,
      `body { background: url(https://evil.example/bg.png); }`,
      `body { background: url('/assets/bg.png'); }`,
      `body { background: url(./rel.png); }`,
      `body { background: url(); }`,
      `body { background: u\\72 l("https://evil.example/bg.png"); }`,
      `body{background-image:image-set("https://example.invalid/a.png" 1x)}`,
      `main{background-image:-webkit-image-set("https://example.invalid/b.png" 1x)}`,
      `:root{--leak:"https://example.invalid/c.png"} body{background-image:image-set(var(--leak) 1x)}`,
      `body{background-image:IMAGE-SET("https://example.invalid/a.png" 1x)}`,
      `body{background-image:\\69 mage-set("https://example.invalid/a.png" 1x)}`,
      `body{background-image:-webkit-\\69 mage-set("https://example.invalid/b.png" 1x)}`,
      `body{background-image:image("https://example.invalid/d.png")}`,
      `body{background-image:cross-fade("https://example.invalid/e.png", "data:image/png;base64,AA")}`,
      `body{background-image:src("https://example.invalid/f.png")}`,
      `body{background-image:\\73 rc("https://example.invalid/f.png")}`,
      `body{background-image:image-set("data:image/png;base64,AA" 1x, "https://example.invalid/g.png" 2x)}`,
      `body{background-image:image-set(\\76 ar(--leak) 1x)}`,
      `body{background-image:image-set(env(FOO) 1x)}`,
      `body{background-image:image-set(attr(data-bg) 1x)}`,
      `/* </style><script>alert(1)</script> */`,
      `:root { color: red; }</STYLE>`,
      `/* ${"a".repeat(FOCUS_THEME_MAX_CSS_BYTES)} */`,
    ];
    for (const css of badCssCases) {
      expect(() => renderHtml(doc, hooks, { themeCss: css })).toThrow();
    }
    expect(() => renderHtml(doc, hooks, { themeCss: ":root{}", themeId: 'bad"id' })).toThrow();
  });
});

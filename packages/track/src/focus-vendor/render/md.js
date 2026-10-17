/**
 * Markdown renderer (Focus-M1 L1).
 *
 * Renders a `DecisionDossierDocument` to a Markdown string. Read-only FocusSnapshot:
 * affordances appear as disabled metadata; diagrams fall back to a FENCED code block
 * (```mermaid / ```plantuml — no diagram adapter). Prose markdown is emitted verbatim
 * (or passed through an optional host `renderMarkdown` hook for normalization).
 */
import { preparePresentation } from "./presentation.js";
const renderQuestion = (q) => {
    const lines = [`**Q:** ${q.question} _(${q.state})_`];
    if (q.context !== undefined)
        lines.push(q.context);
    if (q.readingTimeMinutes !== undefined)
        lines.push(`Reading time: ${q.readingTimeMinutes} min`);
    if (q.recommendedAnswer !== undefined) {
        lines.push(`- préco: ${q.recommendedAnswer}`);
    }
    if (q.answer !== undefined) {
        lines.push(`- answer: ${q.answer}`);
    }
    return lines.join("\n");
};
const renderOptionSet = (s) => {
    const head = s.title !== undefined ? `### Options — ${s.title}` : "### Options";
    const opts = s.options.map((o) => {
        const mark = o.annotation === "none" ? "[ ]" : `[${o.annotation}]`;
        const comment = o.annotationComment !== undefined ? ` — ${o.annotationComment}` : "";
        const body = o.body !== undefined ? `\n  ${o.body}` : "";
        return `- ${mark} **${o.label}** — ${o.consequence ?? ""}${comment}${body}`;
    });
    return [head, ...opts].join("\n");
};
const renderAmendmentTrace = (steps) => {
    if (steps.length === 0)
        return "### Amendment trace\n\n_(none)_";
    const lines = steps.map((st, i) => `${i + 1}. \`${st.at}\` **${st.author}** — ${st.summary}`);
    return ["### Amendment trace", "", ...lines].join("\n");
};
const renderDiagram = (d) => [`_${d.alt}_`, "", "```" + d.syntax, d.source, "```"].join("\n");
const renderNode = (node, hooks) => {
    switch (node.kind) {
        case "prose":
            return hooks.renderMarkdown !== undefined
                ? hooks.renderMarkdown(node.markdown)
                : node.markdown;
        case "question":
            return renderQuestion(node);
        case "optionSet":
            return renderOptionSet(node);
        case "outcome":
            return `### Outcome (${node.modality})\n\n${node.statement}`;
        case "amendmentTrace":
            return renderAmendmentTrace(node.steps);
        case "diagram":
            return renderDiagram(node);
    }
};
const renderAffordances = (affordances) => {
    if (affordances.length === 0)
        return "";
    const lines = affordances.map((a) => `- ~~${a.label}~~ \`${a.name}\` → \`${a.targetRef}\` _(disabled)_`);
    return ["### Affordances (read-only snapshot)", "", ...lines].join("\n");
};
/** Render a decision-dossier document to a Markdown string. */
export const renderMd = (doc, hooks = {}) => {
    doc = preparePresentation(doc);
    const r = doc.readability;
    const blocks = [
        `# ${doc.title}`,
        `> subject: ${doc.subject}  ·  ref: \`${doc.ref}\`  ·  cursor: \`${doc.cursor}\``,
    ];
    blocks.push(`### Owner request\n\n${r.ownerRequestQuote.split("\n").map((line) => `> ${line}`).join("\n")}`);
    blocks.push(`### Stakes\n\n${r.stakes}\n\nReading budget: ${r.readingBudgetMinutes} min (${r.stakesLevel} stakes)`);
    if (r.glossary?.length)
        blocks.push("### Glossary\n\n" + r.glossary.map((entry) => `- **${entry.term}**: ${entry.definition}`).join("\n"));
    for (const node of doc.sections) {
        blocks.push(renderNode(node, hooks));
    }
    blocks.push(renderAmendmentTrace(doc.amendmentTrace));
    const affordances = renderAffordances(doc.interactions);
    if (affordances !== "")
        blocks.push(affordances);
    return blocks.join("\n\n") + "\n";
};

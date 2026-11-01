/**
 * Non-`ui://` client fallbacks and bounded text formatting (h2a spec §5.1;
 * DS spec §8.1, §8.3): a client that did not negotiate
 * `io.modelcontextprotocol/ui` still receives a deterministic, useful
 * rendering of the validated envelope — a Markdown table plus a
 * self-contained SVG for BarChart, a typed text summary for BpmnCanvas, and
 * a bounded Markdown dossier for DecisionDossier. Every fallback is pure,
 * script-free, external-font-free, and byte-capped at the DS §8.2 bounds.
 */

import { utf8ByteLength } from "./validation.js";

/** Truncates `text` at a UTF-8 codepoint boundary so it fits `maxBytes`. */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let bytes = 0;
  let cut = 0;
  for (const char of text) {
    const size = utf8ByteLength(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    cut += char.length;
  }
  return text.slice(0, cut);
}

/** Bounded one-line-per-diagnostic summary for a refused envelope (§4.5). */
export function formatDiagnosticsSummary(
  diagnostics: readonly {
    readonly code?: unknown;
    readonly path?: unknown;
    readonly message?: unknown;
  }[]
): string {
  const lines = [`Envelope refused with ${diagnostics.length} diagnostic(s):`];
  for (const diagnostic of diagnostics) {
    lines.push(
      `- ${String(diagnostic.path ?? "")}: ${String(diagnostic.code ?? "schema-violation")}: ${String(
        diagnostic.message ?? ""
      )}`
    );
  }
  return truncateUtf8Bytes(lines.join("\n"), 4096);
}

/** Escapes the five XML metacharacters of one text run. */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Escapes the Markdown metacharacters of one cell/label run. */
function escapeMarkdownCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** The `(label, value)` pairs of a BarChart root, defensively typed. */
function barChartData(root: unknown): { label: string; value: number }[] {
  const data = (root as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const pairs: { label: string; value: number }[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const label = (item as { label?: unknown }).label;
    const value = (item as { value?: unknown }).value;
    pairs.push({
      label: typeof label === "string" ? label : "",
      value: typeof value === "number" && Number.isFinite(value) ? value : 0
    });
  }
  return pairs;
}

/** Deterministic Markdown table of a BarChart root (DS §8.1, ≤ 4 KiB). */
export function barChartMarkdownTable(root: unknown): string {
  const label = (root as { label?: unknown })?.label;
  const lines: string[] = [];
  if (typeof label === "string" && label.length > 0) {
    lines.push(`# ${label}`);
  }
  lines.push("| label | value |");
  lines.push("| --- | --- |");
  for (const pair of barChartData(root)) {
    lines.push(`| ${escapeMarkdownCell(pair.label)} | ${pair.value} |`);
  }
  return truncateUtf8Bytes(lines.join("\n"), 4096);
}

/**
 * Deterministic self-contained SVG of a BarChart root (DS §8.1, ≤ 32 KiB):
 * fixed viewBox `0 0 600 320`, bars scaled to the maximum value, labels and
 * values, zero `<script>` and zero external references.
 */
export function barChartSvg(root: unknown): string {
  const label = (root as { label?: unknown })?.label;
  const data = barChartData(root);
  const width = 600;
  const height = 320;
  const plotLeft = 40;
  const plotRight = 560;
  const plotTop = 48;
  const plotBottom = 264;
  const maxValue = data.reduce((max, pair) => Math.max(max, pair.value), 0);
  const span = Math.max(1, data.length);
  const slot = (plotRight - plotLeft) / span;
  const barWidth = Math.max(4, Math.floor(slot * 0.6));
  const scale = maxValue > 0 ? (plotBottom - plotTop) / maxValue : 0;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">`);
  if (typeof label === "string" && label.length > 0) {
    parts.push(
      `<text x="${plotLeft}" y="24" font-family="sans-serif" font-size="16">${escapeXml(label)}</text>`
    );
  }
  parts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#999999" stroke-width="1"/>`
  );
  data.forEach((pair, index) => {
    const barHeight = Math.max(0, Math.round(pair.value * scale));
    const x = plotLeft + Math.round(index * slot + (slot - barWidth) / 2);
    const y = plotBottom - barHeight;
    parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#4a7ebb"/>`);
    parts.push(
      `<text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-family="sans-serif" font-size="12">${escapeXml(
        String(pair.value)
      )}</text>`
    );
    parts.push(
      `<text x="${x + barWidth / 2}" y="${plotBottom + 18}" text-anchor="middle" font-family="sans-serif" font-size="12">${escapeXml(
        pair.label
      )}</text>`
    );
  });
  parts.push("</svg>");
  return truncateUtf8Bytes(parts.join(""), 32768);
}

/** Counts every `$type` occurrence in a BPMN F1 document, recursively. */
function countBpmnElementTypes(document: unknown, counts = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(document)) {
    for (const item of document) countBpmnElementTypes(item, counts);
    return counts;
  }
  if (document === null || typeof document !== "object") return counts;
  const record = document as { $type?: unknown; [key: string]: unknown };
  if (typeof record.$type === "string") {
    counts.set(record.$type, (counts.get(record.$type) ?? 0) + 1);
  }
  for (const value of Object.values(record)) countBpmnElementTypes(value, counts);
  return counts;
}

/** Deterministic text summary of a BpmnCanvas root document (DS §8.1, ≤ 4 KiB). */
export function bpmnCanvasTextSummary(root: unknown): string {
  const document = (root as { document?: unknown })?.document;
  const record = document as
    | { $type?: unknown; id?: unknown; targetNamespace?: unknown }
    | undefined;
  const type = typeof record?.$type === "string" ? record.$type : "unknown";
  const id = typeof record?.id === "string" ? record.id : "(no id)";
  const namespace =
    typeof record?.targetNamespace === "string" ? record.targetNamespace : "(no targetNamespace)";
  const counts = [...countBpmnElementTypes(document).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const countLines = counts.map(([name, count]) => `${name} x ${count}`).join(", ");
  const lines = [
    `BpmnCanvas document ${id} ($type ${type}, targetNamespace ${namespace}).`,
    counts.length > 0 ? `Element counts: ${countLines}.` : "Element counts: (empty document)."
  ];
  return truncateUtf8Bytes(lines.join("\n"), 4096);
}

/** Renders one scalar field of an unknown-shape section, defensively. */
function sectionScalarLine(section: Record<string, unknown>, key: string): string | undefined {
  const value = section[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `- ${key}: ${String(value)}`;
  }
  return undefined;
}

/** Deterministic Markdown rendering of a DecisionDossier root document (DS §8.1, ≤ 64 KiB). */
export function decisionDossierMarkdown(root: unknown): string {
  const document = (root as { document?: unknown })?.document;
  const record = document as
    | {
        title?: unknown;
        subject?: unknown;
        ref?: unknown;
        sections?: unknown;
        amendmentTrace?: unknown;
        provenance?: unknown;
      }
    | undefined;
  const lines: string[] = [];
  if (typeof record?.title === "string") lines.push(`# ${record.title}`);
  if (typeof record?.subject === "string") lines.push(`Subject: ${record.subject}`);
  if (typeof record?.ref === "string") lines.push(`Ref: ${record.ref}`);
  const provenance = record?.provenance as { source?: unknown; readAt?: unknown } | undefined;
  if (provenance && typeof provenance.source === "string") {
    lines.push(`Provenance: ${provenance.source}${typeof provenance.readAt === "string" ? ` (read ${provenance.readAt})` : ""}`);
  }
  if (Array.isArray(record?.sections)) {
    for (const section of record.sections) {
      if (section === null || typeof section !== "object") continue;
      const entry = section as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id : "(no id)";
      const kind = typeof entry.kind === "string" ? entry.kind : "section";
      lines.push(``);
      lines.push(`## ${kind} ${id}`);
      for (const key of ["state", "targetRef", "decision"]) {
        const line = sectionScalarLine(entry, key);
        if (line !== undefined) lines.push(line);
      }
      if (typeof entry.question === "string") lines.push(``);
      if (typeof entry.question === "string") lines.push(entry.question);
      if (typeof entry.title === "string") lines.push(`Title: ${entry.title}`);
      if (Array.isArray(entry.options)) {
        for (const option of entry.options) {
          if (option === null || typeof option !== "object") continue;
          const opt = option as Record<string, unknown>;
          const label = typeof opt.label === "string" ? opt.label : "(unlabelled)";
          const optionId = typeof opt.id === "string" ? opt.id : "(no id)";
          const target = typeof opt.targetRef === "string" ? opt.targetRef : "(no target)";
          lines.push(`- ${label} (${optionId}) → ${target}`);
        }
      }
      for (const key of ["text", "outcome", "summary"].sort()) {
        const line = sectionScalarLine(entry, key);
        if (line !== undefined && key !== "question") lines.push(line);
      }
    }
  }
  lines.push(``);
  lines.push("## Amendment trace");
  if (Array.isArray(record?.amendmentTrace) && record.amendmentTrace.length > 0) {
    for (const entry of record.amendmentTrace) {
      if (entry === null || typeof entry !== "object") continue;
      lines.push(`- ${JSON.stringify(entry)}`);
    }
  } else {
    lines.push("- (empty)");
  }
  return truncateUtf8Bytes(lines.join("\n"), 65536);
}

/** The deterministic non-UI fallback content items for one validated root (§5.1). */
export function fallbackContent(component: string, root: unknown): { type: "text"; text: string }[] {
  switch (component) {
    case "BarChart":
      return [
        { type: "text", text: barChartMarkdownTable(root) },
        { type: "text", text: barChartSvg(root) }
      ];
    case "BpmnCanvas":
      return [{ type: "text", text: bpmnCanvasTextSummary(root) }];
    case "DecisionDossier":
      return [{ type: "text", text: decisionDossierMarkdown(root) }];
    default:
      return [
        {
          type: "text",
          text: truncateUtf8Bytes(
            `The envelope validated, but this client did not negotiate the ui extension and ${component} declares no non-UI fallback.`,
            4096
          )
        }
      ];
  }
}

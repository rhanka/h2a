import { readFileSync } from 'node:fs';
import path from 'node:path';
import { r as repoRoot } from '../../../../chunks/h2a-bus.js-WrEfPDF2.js';
import { l as loadAgentMemoryMatrix, a as loadAgentMemoryDossier } from '../../../../chunks/agent-memory-dossier.js-BUU7sUNp.js';

const ANSWERS_PATH = path.join("docs", "decisions", "2026-07-25-agent-memory-owner-answers.json");
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function parseAnswerSet(raw, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed;
  const dossier = asString(record.dossier);
  const revision = asString(record.revision);
  if (!dossier || !revision) return null;
  const rawAnswers = record.answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) return null;
  const answers = {};
  for (const [key, value] of Object.entries(rawAnswers)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value;
    answers[key] = {
      option: asString(entry.option),
      // An empty note is a legitimate answer (D7 has none) — keep the key, keep the distinction.
      note: typeof entry.note === "string" ? entry.note : ""
    };
  }
  return {
    source,
    dossier,
    revision,
    capturedAt: asString(record.capturedAt),
    capturedFrom: asString(record.capturedFrom),
    status: asString(record.status),
    answers
  };
}
function loadAgentMemoryAnswerSet() {
  const file = path.join(repoRoot(), ANSWERS_PATH);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return parseAnswerSet(raw, ANSWERS_PATH);
}
const load = () => ({
  dossier: loadAgentMemoryDossier(),
  matrix: loadAgentMemoryMatrix(),
  // The committed answer set, so the dossier can be replayed as an acceptance scenario. `null` when
  // the file is unreachable — the page then says replay is unavailable rather than faking answers.
  answerSet: loadAgentMemoryAnswerSet()
});

var _page_server_ts = /*#__PURE__*/Object.freeze({
  __proto__: null,
  load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-Bs7s0O2l.js.map

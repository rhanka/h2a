import { readFileSync } from 'node:fs';
import path from 'node:path';
import { r as resolveTarget, a as repoRoot } from '../../../../chunks/h2a-bus.js-4eIbfmJH.js';
import { l as loadAgentMemoryMatrix, a as loadAgentMemoryDossier } from '../../../../chunks/agent-memory-dossier.js-nmFG_rgx.js';

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
const load = () => {
  const resolution = resolveTarget(repoRoot());
  return {
    dossier: loadAgentMemoryDossier(),
    matrix: loadAgentMemoryMatrix(),
    // The committed answer set: the DEFAULT source of truth for this page, not an opt-in replay. `null`
    // when the file is unreachable — the page then says so rather than showing an empty dossier as if the
    // owner had never answered.
    answerSet: loadAgentMemoryAnswerSet(),
    h2a: {
      target: resolution.target ?? null,
      targetRoot: resolution.targetRoot ?? null,
      reason: resolution.reason,
      ambiguous: resolution.ambiguous,
      roots: resolution.roots,
      binMissing: resolution.binMissing,
      remedy: resolution.remedy ?? null,
      live: resolution.live.map((s) => ({
        instance: s.instance,
        name: s.name ?? null,
        workspace: s.workspace?.path ?? null,
        root: s.root ?? null,
        matchesRepo: resolution.candidates.some((c) => c.instance === s.instance)
      }))
    }
  };
};

var _page_server_ts = /*#__PURE__*/Object.freeze({
  __proto__: null,
  load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-8xBSKTOi.js.map

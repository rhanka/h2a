// The committed answer set for the agent-memory dossier, exposed so the page can REPLAY it.
//
// Why replay at all: the dossier is the acceptance scenario for Focus releases (docs/uat/...). A
// scenario you cannot re-run is a screenshot, not a test — so the owner's real answers live in git
// (docs/decisions/…-owner-answers.json) and get loaded back into the page on demand.
//
// Read at request time from the repo, NOT copied into the app: a copy is a second source of truth and
// would silently drift from the committed answers. When the file is unreachable (packaged deployment
// with no checkout) we return null and the page says replay is unavailable — it never invents answers.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './h2a-bus';

/** One replayable answer: the option that was picked (if any) and the reasoning behind it. */
export interface AnswerSetEntry {
  option: string | null;
  note: string;
}

export interface AnswerSet {
  /** Where it was read from, shown to the human so a replay is never an unexplained mutation. */
  source: string;
  dossier: string;
  /** The dossier revision these answers were captured against — replay is revision-scoped. */
  revision: string;
  capturedAt: string | null;
  capturedFrom: string | null;
  status: string | null;
  answers: Record<string, AnswerSetEntry>;
}

const ANSWERS_PATH = path.join('docs', 'decisions', '2026-07-25-agent-memory-owner-answers.json');

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Parse defensively: a malformed or hand-edited answer file must degrade to "replay unavailable",
 * never to a half-applied replay that quietly loses part of the reasoning.
 */
function parseAnswerSet(raw: string, source: string): AnswerSet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const dossier = asString(record.dossier);
  const revision = asString(record.revision);
  if (!dossier || !revision) return null;

  const rawAnswers = record.answers;
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return null;

  const answers: Record<string, AnswerSetEntry> = {};
  for (const [key, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    answers[key] = {
      option: asString(entry.option),
      // An empty note is a legitimate answer (D7 has none) — keep the key, keep the distinction.
      note: typeof entry.note === 'string' ? entry.note : ''
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

export function loadAgentMemoryAnswerSet(): AnswerSet | null {
  const file = path.join(repoRoot(), ANSWERS_PATH);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return parseAnswerSet(raw, ANSWERS_PATH);
}

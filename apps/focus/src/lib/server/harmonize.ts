// server-only: the AI HARMONIZATION layer — translate free-text item titles into the reader's language.
//
// WHY. track-model.ts already renders every MACHINE label (badges, gate phrases, actors, actions) in
// French. What it CANNOT translate is the FREE TEXT authored by whoever created the item: the item TITLES
// (the "Sujet" of a FAIT / À-FAIRE / DÉCISION / PRÉCO). Those stay in their source language — usually
// English (e.g. "Decisional web canvas …"). This module translates ONLY that free text, on the server,
// before the payload reaches the browser. Machine labels are never touched here.
//
// CONTRACT.
//   - `harmonize(texts, lang)` → a map { original → translated }. Batches ALL cache-misses in ONE LLM call.
//   - PERSISTENT cache (JSON file, key = sha256(model + lang + text)): a text is translated at most once,
//     so steady-state cost/latency ≈ 0.
//   - CHEAP model (default gpt-4o-mini) — this is translation, not reasoning.
//   - GRACEFUL DEGRADATION: no API key / offline / HTTP error / timeout / malformed reply ⇒ the ORIGINAL
//     texts are returned. The page NEVER breaks because of this layer.
//   - Technical identifiers (EVO-10, WP7, DEC-011, h2a, track, ULIDs, paths, code) are preserved verbatim;
//     only the surrounding prose is translated.
//
// The API key is read like the review scripts do: from OPENAI_API_KEY, else from a sentropic .env file.
// It is never logged, never returned, never persisted.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { FocusData } from '$lib/track-model';

const DEFAULT_MODEL = 'gpt-4o-mini';
// Bounded budget for the ONE cold batched call (a full first-render translation of ~50 titles measured
// ~14s on gpt-4o-mini). Steady-state is a full cache hit (no call at all) and incremental new-title batches
// are tiny, so this only ever caps the very first render. On timeout we degrade gracefully to the originals.
const DEFAULT_TIMEOUT_MS = 20000;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function model(): string {
  return process.env.FOCUS_HARMONIZE_MODEL?.trim() || DEFAULT_MODEL;
}

// ---- API key discovery (never logged) ------------------------------------------------------------------

/**
 * Candidate .env files to scan for OPENAI_API_KEY, in order. Overridable via FOCUS_HARMONIZE_ENV_FILE
 * (colon-separated list). Default: the sentropic checkout's `.env` then `.env.prod` under $HOME/src —
 * `homedir()` keeps a username out of the committed source. The raw sk- key currently lives in `.env.prod`.
 */
function candidateEnvFiles(): string[] {
  const explicit = process.env.FOCUS_HARMONIZE_ENV_FILE?.trim();
  if (explicit) return explicit.split(':').filter(Boolean);
  const base = path.join(homedir(), 'src', 'sentropic');
  return [path.join(base, '.env'), path.join(base, '.env.prod')];
}

function readKeyFromEnvFile(file: string): string | undefined {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v) return v;
    }
  } catch {
    /* unreadable/missing file → skip */
  }
  return undefined;
}

function apiKey(): string | undefined {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const f of candidateEnvFiles()) {
    const k = readKeyFromEnvFile(f);
    if (k) return k;
  }
  return undefined;
}

// ---- persistent cache ----------------------------------------------------------------------------------

function cacheFile(lang: string): string {
  const dir =
    process.env.FOCUS_HARMONIZE_CACHE?.trim() || path.join(process.cwd(), '.cache', 'harmonize');
  mkdirSync(dir, { recursive: true });
  // Model is part of the filename AND the hash so switching models never serves a stale translation.
  return path.join(dir, `${model()}.${lang}.json`);
}

/** Cache key = sha256(model + lang + text). Same text under a different lang/model is a distinct entry. */
function keyOf(text: string, lang: string): string {
  return createHash('sha256').update(`${model()}\u0000${lang}\u0000${text}`).digest('hex');
}

function loadCache(file: string): Record<string, string> {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    /* corrupt cache → start fresh */
  }
  return {};
}

// ---- LLM call ------------------------------------------------------------------------------------------

function langName(lang: string): string {
  const names: Record<string, string> = {
    fr: 'French',
    en: 'English',
    es: 'Spanish',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    nl: 'Dutch'
  };
  return names[lang] ?? lang;
}

/** Translate `texts` into `lang` in ONE batched call. Returns an array aligned 1:1 with the input. */
async function callLlm(texts: string[], lang: string, key: string): Promise<string[]> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.FOCUS_HARMONIZE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = langName(lang);
    const system =
      `You are a professional technical translator. Translate each input string into ${target}. ` +
      'PRESERVE verbatim, without translating: work/ticket codes (e.g. EVO-10, WP7, WP-MIG, DEC-011, ' +
      'BR-39l), version numbers, code names, product names, "h2a", "track", "remote", ULIDs, file paths, ' +
      'CLI commands, and any inline code. Translate ONLY the surrounding prose. Keep parentheses and ' +
      'punctuation. If a string is already in ' +
      `${target}, return it unchanged. Do NOT add quotes, numbering, or commentary. ` +
      'Return STRICT JSON of the form {"translations": [...]} with exactly one translated string per ' +
      'input, in the SAME order and SAME count as the input.';
    const user = JSON.stringify({ count: texts.length, texts });

    const resp = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    if (!resp.ok) throw new Error(`openai HTTP ${resp.status}`);
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty completion');
    const parsed = JSON.parse(content) as { translations?: unknown };
    const arr = parsed.translations;
    if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('shape mismatch');
    return arr.map((x) => (typeof x === 'string' ? x : ''));
  } finally {
    clearTimeout(timer);
  }
}

// ---- public API ----------------------------------------------------------------------------------------

/**
 * Translate `texts` into `lang`. Returns a map keyed by the ORIGINAL text → translated text. The map ALWAYS
 * contains every non-empty input (identity when translation is unavailable) so callers can substitute
 * unconditionally. Never throws.
 */
export async function harmonize(
  texts: string[],
  lang = 'fr'
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(texts.map((t) => t ?? ''))].filter((t) => t.trim() !== '');
  for (const t of uniq) out[t] = t; // graceful default = identity
  if (uniq.length === 0) return out;

  const file = cacheFile(lang);
  const cache = loadCache(file);

  const miss: string[] = [];
  for (const t of uniq) {
    const cached = cache[keyOf(t, lang)];
    if (typeof cached === 'string') out[t] = cached;
    else miss.push(t);
  }
  if (miss.length === 0) return out; // full cache hit → zero LLM cost/latency

  const key = apiKey();
  if (!key) return out; // graceful: no key → originals (+ any cache hits)

  try {
    const translated = await callLlm(miss, lang, key);
    let dirty = false;
    miss.forEach((t, i) => {
      const tr = translated[i];
      if (typeof tr === 'string' && tr.trim() !== '') {
        out[t] = tr;
        cache[keyOf(t, lang)] = tr;
        dirty = true;
      }
    });
    if (dirty) {
      try {
        writeFileSync(file, JSON.stringify(cache));
      } catch {
        /* cache write is best-effort */
      }
    }
  } catch {
    /* graceful: offline / timeout / bad reply → keep originals */
  }
  return out;
}

/**
 * Translate the FREE-TEXT title fields of a FocusData payload (item subjects across FAIT / À-FAIRE /
 * DÉCISION / PRÉCO / keystone) into `lang`. Machine labels (badge, gate, actor, action, nature, why) are
 * FRENCH already and are left untouched. One batched call for the whole page. Never throws.
 */
export async function harmonizeFocus(data: FocusData, lang = 'fr'): Promise<FocusData> {
  // Collect EVERY free-text-bearing field. The composed strings (gate / why / summary) embed the raw item
  // title, so they too can carry untranslated English — translate the whole string (machine-French parts are
  // no-ops, the embedded title gets translated). `undefined`/empty are skipped; all cached, so cost is once.
  const texts: string[] = [];
  const push = (s?: string): void => {
    if (s && s.trim() !== '') texts.push(s);
  };
  for (const t of data.todos) {
    push(t.subject);
    push(t.gate);
  }
  for (const p of data.precos) {
    push(p.title);
    push(p.why);
  }
  for (const d of data.decisions) {
    push(d.question);
    push(d.concerns);
    push(d.summary);
  }
  for (const d of data.done) push(d.title);
  if (data.keystone) push(data.keystone.title);

  const map = await harmonize(texts, lang);
  const tr = (s: string): string => map[s] ?? s;
  const trOpt = (s?: string): string | undefined => (s ? (map[s] ?? s) : s);

  return {
    ...data,
    todos: data.todos.map((t) => ({ ...t, subject: tr(t.subject), gate: trOpt(t.gate) })),
    precos: data.precos.map((p) => ({ ...p, title: tr(p.title), why: tr(p.why) })),
    decisions: data.decisions.map((d) => ({
      ...d,
      question: tr(d.question),
      concerns: tr(d.concerns),
      summary: tr(d.summary)
    })),
    done: data.done.map((d) => ({ ...d, title: tr(d.title) })),
    ...(data.keystone ? { keystone: { ...data.keystone, title: tr(data.keystone.title) } } : {})
  };
}

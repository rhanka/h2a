// model-eval: unit tests on a frozen AA free-shape fixture snapshot.
// No network: fetch is injected as a stub, cache/quota live in mkdtemp dirs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  fetchAaIndex,
  isOpusSlug,
  isSeatExhausted,
  loadCache,
  loadQuotaOverrides,
  mapAaToH2a,
  ModelEvalError,
  normalizeAaModel,
  recommend,
  resolveBuildMinIntelligence,
  resolveModelEvalStateDir,
  saveCache
} from "../dist/index.js";

const FIXTURE_DATE = "2026-11-04";

function aaItem(slug, name, intelligence, tokensPerSec) {
  return {
    id: `id-${slug}`,
    name,
    slug,
    release_date: "2026-10-01",
    model_creator: { id: "creator-1", name: "Fixture Labs" },
    evaluations: {
      artificial_analysis_intelligence_index: intelligence,
      artificial_analysis_coding_index: intelligence === null ? null : intelligence - 5,
      artificial_analysis_agentic_index: null
    },
    pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: 8 },
    performance: {
      median_output_tokens_per_second: tokensPerSec,
      median_time_to_first_token_seconds: 1.1,
      median_end_to_end_response_time_seconds: 30
    }
  };
}

/** Frozen free-shape snapshot (mirrors GET /language/models/free `data[]`). */
const FIXTURE_DATA = [
  aaItem("gpt-5-3-codex", "GPT-5.3 Codex", 62, 92),
  aaItem("gpt-5-5-pro", "GPT-5.5 Pro", 58, 61),
  aaItem("gemini-3-7-flash", "Gemini 3.7 Flash", 55, 140),
  aaItem("claude-opus-5", "Claude Opus 5", 71, 45),
  aaItem("mystery-model-x", "Mystery X", 80, 200),
  { name: "Nameless", evaluations: {}, performance: {}, pricing: {} }
];

const FIXTURE_MODELS = FIXTURE_DATA.map(normalizeAaModel).filter((m) => m !== null);
const SOURCE = { endpoint: "aa-api-v2:/language/models/free", fetchedAt: `${FIXTURE_DATE}T12:00:00.000Z` };
const LAUNCH = { name: "eval-check", workspace: "/repo/ws", prompt: "check prompt" };

function freshDir() {
  return mkdtempSync(join(tmpdir(), "model-eval-test-"));
}

test("fixture snapshot normalizes to five entries (nameless item skipped)", () => {
  assert.equal(FIXTURE_MODELS.length, 5);
  const codex = FIXTURE_MODELS.find((m) => m.slug === "gpt-5-3-codex");
  assert.equal(codex.intelligence, 62);
  assert.equal(codex.outputTokensPerSec, 92);
  assert.equal(codex.latencyMs, 1100);
  assert.equal(codex.priceInputPer1M, 2);
});

test("normalizeAaModel nulls missing metrics, rejects missing slug/name", () => {
  assert.equal(normalizeAaModel(null), null);
  assert.equal(normalizeAaModel({ name: "x" }), null);
  const thin = normalizeAaModel({ slug: "s", name: "n" });
  assert.equal(thin.intelligence, null);
  assert.equal(thin.outputTokensPerSec, null);
});

test("normalizeAaModel reloads an already-normalized cache entry losslessly", () => {
  const flat = {
    slug: "gpt-5-3-codex",
    name: "GPT-5.3 Codex",
    intelligence: 62,
    coding: 57,
    outputTokensPerSec: 92,
    latencyMs: 1100,
    priceInputPer1M: 2,
    priceOutputPer1M: 8
  };
  assert.deepEqual(normalizeAaModel(flat), flat);
});

test("mapping: exact wins, prefix matches families, unknown is undefined", () => {
  assert.equal(mapAaToH2a("gpt-5-3-codex").model, "gpt-5.6-terra");
  assert.equal(mapAaToH2a("gpt-5-3-codex").profile, "codex");
  assert.equal(mapAaToH2a("gemini-9-9-zzz").profile, "agy");
  assert.equal(mapAaToH2a("mystery-model-x"), undefined);
  assert.equal(isOpusSlug("claude-opus-5"), true);
  assert.equal(isOpusSlug("gpt-5-3-codex"), false);
});

test("fetchAaIndex follows pagination and counts skipped items", async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, hasKeyHeader: "x-api-key" in init.headers });
    const page = Number(new URL(url).searchParams.get("page"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        intelligence_index_version: 5,
        pagination: { page, has_more: page < 2 },
        data: page === 1 ? FIXTURE_DATA.slice(0, 3) : FIXTURE_DATA.slice(3)
      })
    };
  };
  const { cache, skipped } = await fetchAaIndex("STUB-KEY", stub);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((c) => c.hasKeyHeader), true);
  assert.equal(cache.models.length, 5);
  assert.equal(skipped, 1);
  assert.equal(cache.intelligenceIndexVersion, 5);
  assert.equal(typeof cache.fetchedAt, "string");
});

test("fetchAaIndex maps HTTP errors and network throws to FETCH_FAILED", async () => {
  const badStatus = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(fetchAaIndex("STUB-KEY", badStatus), (error) => {
    assert.ok(error instanceof ModelEvalError);
    assert.equal(error.code, "MODEL_EVAL_FETCH_FAILED");
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /STUB-KEY/);
    return true;
  });
  const boom = async () => {
    throw new Error("socket hang up");
  };
  await assert.rejects(fetchAaIndex("STUB-KEY", boom), (error) => {
    assert.ok(error instanceof ModelEvalError);
    assert.equal(error.code, "MODEL_EVAL_FETCH_FAILED");
    return true;
  });
});

test("cache round-trips through a temp dir; missing cache is NO_SOURCE", () => {
  const dir = freshDir();
  try {
    assert.throws(() => loadCache(dir), (error) => error.code === "MODEL_EVAL_NO_SOURCE");
    const cache = { source: SOURCE.endpoint, fetchedAt: SOURCE.fetchedAt, intelligenceIndexVersion: 5, models: FIXTURE_MODELS };
    const path = saveCache(cache, dir);
    const loaded = loadCache(dir);
    assert.equal(loaded.fetchedAt, SOURCE.fetchedAt);
    assert.equal(loaded.models.length, 5);
    assert.ok(path.startsWith(dir));
    writeFileSync(join(dir, "aa-index.json"), "{nope", "utf8");
    assert.throws(() => loadCache(dir), (error) => error.code === "MODEL_EVAL_BAD_CACHE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quota overrides: missing file is empty, expired seats ignored", () => {
  const dir = freshDir();
  try {
    assert.deepEqual(loadQuotaOverrides(dir), []);
    const overrides = [
      { seat: "codex", until: "2026-11-07T00:00:00.000Z", note: "seat reset" },
      { seat: "argon", until: "2020-01-01T00:00:00.000Z", note: "stale" }
    ];
    writeFileSync(join(dir, "quota-overrides.json"), JSON.stringify({ exhausted: overrides }), "utf8");
    const loaded = loadQuotaOverrides(dir);
    const now = new Date("2026-11-04T12:00:00.000Z");
    assert.ok(isSeatExhausted("codex", loaded, now));
    assert.equal(isSeatExhausted("CODEX", loaded, now).note, "seat reset");
    assert.equal(isSeatExhausted("argon", loaded, now), undefined);
    assert.equal(isSeatExhausted("vibe", loaded, now), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("design: most intelligent author (xhigh) + distinct reviewer, opus+unknown excluded", () => {
  const outcome = recommend({
    role: "design",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    launch: LAUNCH
  });
  assert.equal(outcome.picks.length, 2);
  const [author, reviewer] = outcome.picks;
  assert.equal(author.profile, "codex");
  assert.equal(author.model, "gpt-5.6-terra");
  assert.equal(author.effort, "xhigh");
  assert.equal(author.score.intelligence, 62);
  assert.notEqual(reviewer.model, author.model);
  assert.equal(reviewer.profile, "agy");
  assert.equal(reviewer.effort, "high");
  const reasons = Object.fromEntries(outcome.excluded.map((e) => [e.slug, e.reason]));
  assert.match(reasons["claude-opus-5"], /opus guard/);
  assert.match(reasons["mystery-model-x"], /no mapping row/);
  for (const pick of outcome.picks) {
    assert.equal(pick.source.fetchedAt, SOURCE.fetchedAt);
    assert.equal(pick.mcp.background, true);
    assert.equal(pick.mcp.prompt, LAUNCH.prompt);
    assert.match(pick.cli, /h2a run \S+ \/repo\/ws --model \S+ .*--prompt-stdin/);
  }
  assert.match(author.cli, /--effort xhigh/);
  assert.match(reviewer.cli, /--no-gw/);
  // The API key never appears in rendered output.
  assert.doesNotMatch(JSON.stringify(outcome), /x-api-key|ARTIFICIAL_ANALYSIS_API_KEY/);
});

test("design with one launchable family left is NO_REVIEWER (quota path)", () => {
  const overrides = [{ seat: "agy", until: "2099-01-01T00:00:00.000Z", note: "" }];
  assert.throws(
    () =>
      recommend({ role: "design", models: FIXTURE_MODELS, source: SOURCE, overrides, launch: LAUNCH }),
    (error) => error.code === "MODEL_EVAL_NO_REVIEWER"
  );
});

test("build: fastest above threshold wins; threshold configurable", () => {
  const fast = recommend({ role: "build", models: FIXTURE_MODELS, source: SOURCE, overrides: [], launch: LAUNCH });
  assert.equal(fast.picks.length, 1);
  assert.equal(fast.picks[0].model, "gemini-3.7-flash-high");
  assert.equal(fast.picks[0].score.outputTokensPerSec, 140);
  const strict = recommend({
    role: "build",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    buildMinIntelligence: 60,
    launch: LAUNCH
  });
  assert.equal(strict.picks[0].model, "gpt-5.6-terra");
  assert.throws(
    () =>
      recommend({ role: "build", models: FIXTURE_MODELS, source: SOURCE, overrides: [], buildMinIntelligence: 99, launch: LAUNCH }),
    (error) => error.code === "MODEL_EVAL_NO_CANDIDATE"
  );
});

test("review: model distinct from the author; authorModel required", () => {
  const outcome = recommend({
    role: "review",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    authorModel: "gpt-5.6-terra",
    launch: LAUNCH
  });
  assert.equal(outcome.picks.length, 1);
  assert.notEqual(outcome.picks[0].model, "gpt-5.6-terra");
  assert.throws(
    () => recommend({ role: "review", models: FIXTURE_MODELS, source: SOURCE, overrides: [], launch: LAUNCH }),
    (error) => error.code === "MODEL_EVAL_BAD_INPUT"
  );
});

test("ownerAuthorizedOpus lifts the guard but never invents a launch id", () => {
  const outcome = recommend({
    role: "build",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    ownerAuthorizedOpus: true,
    launch: LAUNCH
  });
  const opus = outcome.excluded.find((e) => e.slug === "claude-opus-5");
  assert.match(opus.reason, /no mapping row/);
});

test("empty index is NO_CANDIDATE", () => {
  assert.throws(
    () => recommend({ role: "build", models: [], source: SOURCE, overrides: [], launch: LAUNCH }),
    (error) => error.code === "MODEL_EVAL_NO_CANDIDATE"
  );
});

test("state dir and build threshold resolve from env with documented defaults", () => {
  const savedState = process.env["MODEL_EVAL_STATE_DIR"];
  const savedIntel = process.env["MODEL_EVAL_BUILD_MIN_INTEL"];
  try {
    process.env["MODEL_EVAL_STATE_DIR"] = "/tmp/eval-state";
    assert.equal(resolveModelEvalStateDir(), "/tmp/eval-state");
    delete process.env["MODEL_EVAL_STATE_DIR"];
    assert.match(resolveModelEvalStateDir(), /model-eval$/);
    process.env["MODEL_EVAL_BUILD_MIN_INTEL"] = "42";
    assert.equal(resolveBuildMinIntelligence(), 42);
    delete process.env["MODEL_EVAL_BUILD_MIN_INTEL"];
    assert.equal(resolveBuildMinIntelligence(), 30);
    assert.equal(resolveBuildMinIntelligence(55), 55);
  } finally {
    if (savedState === undefined) delete process.env["MODEL_EVAL_STATE_DIR"];
    else process.env["MODEL_EVAL_STATE_DIR"] = savedState;
    if (savedIntel === undefined) delete process.env["MODEL_EVAL_BUILD_MIN_INTEL"];
    else process.env["MODEL_EVAL_BUILD_MIN_INTEL"] = savedIntel;
  }
});

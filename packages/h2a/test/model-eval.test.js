// model-eval: unit tests on a frozen AA free-shape fixture snapshot.
// No network: fetch is injected as a stub, cache/quota live in mkdtemp dirs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  fetchAaIndex,
  isOpusSlug,
  isSeatExhausted,
  loadCache,
  loadQuotaOverrides,
  mapAaToH2a,
  MODEL_EVAL_MAPPING,
  ModelEvalError,
  normalizeAaModel,
  recommend,
  renderRunCommand,
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

test("mapping: reviewed exact slugs only, unknown slugs are undefined", () => {
  assert.equal(mapAaToH2a("gpt-5-3-codex").model, "gpt-5.6-terra");
  assert.equal(mapAaToH2a("gpt-5-3-codex").profile, "codex");
  assert.equal(mapAaToH2a("gemini-3-7-flash").model, "gemini-3.7-flash-high");
  assert.equal(mapAaToH2a("gemini-3-7-flash").profile, "agy");
  // No prefix guessing: an unreviewed future slug never maps.
  assert.equal(mapAaToH2a("gemini-9-9-zzz"), undefined);
  // One source slug per launch id: same-launch siblings stay unmapped.
  assert.equal(mapAaToH2a("gpt-5-5-pro"), undefined);
  assert.equal(mapAaToH2a("gpt-5-5-instant-06-26"), undefined);
  assert.equal(mapAaToH2a("mystery-model-x"), undefined);
  assert.equal(isOpusSlug("claude-opus-5"), true);
  assert.equal(isOpusSlug("gpt-5-3-codex"), false);
});

test("mapping: one source slug per launch id (scores are never borrowed)", () => {
  const ids = MODEL_EVAL_MAPPING.map((row) => `${row.profile}/${row.model}`);
  assert.equal(new Set(ids).size, ids.length);
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

test("fetchAaIndex refuses to cache an empty index (FETCH_FAILED, nothing saved)", async () => {
  const empty = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ pagination: { has_more: false }, data: [] })
  });
  await assert.rejects(fetchAaIndex("STUB-KEY", empty), (error) => {
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
    assert.ok(path.startsWith(join(dir, "model-eval")));
    writeFileSync(join(dir, "model-eval", "aa-index.json"), "{nope", "utf8");
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
    mkdirSync(join(dir, "model-eval"), { recursive: true });
    writeFileSync(join(dir, "model-eval", "quota-overrides.json"), JSON.stringify({ exhausted: overrides }), "utf8");
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

test("quota overrides: malformed entries fail closed (BAD_CACHE, never silent)", () => {
  const cases = [
    { exhausted: [{ until: "2099-01-01T00:00:00.000Z" }] },
    { exhausted: [{ seat: "codex" }] },
    { exhausted: [{ seat: "codex", until: "not-a-date" }] },
    { exhausted: ["codex"] },
    { exhausted: [{ seat: "", until: "2099-01-01T00:00:00.000Z" }] }
  ];
  for (const body of cases) {
    const dir = freshDir();
    try {
      mkdirSync(join(dir, "model-eval"), { recursive: true });
      writeFileSync(join(dir, "model-eval", "quota-overrides.json"), JSON.stringify(body), "utf8");
      assert.throws(() => loadQuotaOverrides(dir), (error) => error.code === "MODEL_EVAL_BAD_CACHE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
  // Design launch names are distinct (no mcp/cli collision).
  assert.equal(author.mcp.name, "eval-check-author");
  assert.equal(reviewer.mcp.name, "eval-check-reviewer");
  assert.match(author.cli, /--name eval-check-author/);
  assert.match(reviewer.cli, /--name eval-check-reviewer/);
  // gateway auto (codex) renders no flag; off (agy) renders --no-gw.
  assert.doesNotMatch(author.cli, /--gw|--no-gw/);
  assert.match(reviewer.cli, /--no-gw/);
  assert.equal(author.gateway, "auto");
  assert.equal(reviewer.gateway, "off");
  const reasons = Object.fromEntries(outcome.excluded.map((e) => [e.slug, e.reason]));
  assert.match(reasons["claude-opus-5"], /opus guard/);
  assert.match(reasons["mystery-model-x"], /no mapping row/);
  // Same-launch sibling slug: excluded, never merged into terra's score.
  assert.match(reasons["gpt-5-5-pro"], /no mapping row/);
  for (const pick of outcome.picks) {
    assert.equal(pick.source.fetchedAt, SOURCE.fetchedAt);
    assert.equal(pick.mcp.background, true);
    assert.equal(pick.mcp.prompt, LAUNCH.prompt);
    assert.match(pick.cli, /h2a run \S+ \/repo\/ws --model \S+ .*--prompt-stdin/);
  }
  assert.match(author.cli, /--effort xhigh/);
  // The API key never appears in rendered output.
  assert.doesNotMatch(JSON.stringify(outcome), /x-api-key|ARTIFICIAL_ANALYSIS_API_KEY/);
});

test("design: intelligence exactly 50 is refused (strictly > 50)", () => {
  const flat = FIXTURE_MODELS.map((m) => ({ ...m, intelligence: 50 }));
  assert.throws(
    () => recommend({ role: "design", models: flat, source: SOURCE, overrides: [], launch: LAUNCH }),
    (error) => error.code === "MODEL_EVAL_NO_CANDIDATE"
  );
});

test("build: below-threshold candidates are listed in excluded with a reason", () => {
  const outcome = recommend({
    role: "build",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    buildMinIntelligence: 60,
    launch: LAUNCH
  });
  const reasons = Object.fromEntries(outcome.excluded.map((e) => [e.slug, e.reason]));
  assert.match(reasons["gemini-3-7-flash"], /below threshold/);
});

test("design: launch names stay distinct and within 64 chars on long labels", () => {
  const longLaunch = { ...LAUNCH, name: "x".repeat(60) };
  const outcome = recommend({
    role: "design",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    launch: longLaunch
  });
  const [author, reviewer] = outcome.picks;
  assert.notEqual(author.mcp.name, reviewer.mcp.name);
  for (const pick of outcome.picks) {
    assert.match(pick.mcp.name, /^[A-Za-z0-9_-]{1,64}$/);
  }
});

test("recommend: invalid launch name is BAD_INPUT", () => {
  assert.throws(
    () =>
      recommend({
        role: "build",
        models: FIXTURE_MODELS,
        source: SOURCE,
        overrides: [],
        launch: { ...LAUNCH, name: "not a valid name!" }
      }),
    (error) => error.code === "MODEL_EVAL_BAD_INPUT"
  );
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

test("build: intelligence exactly at the threshold stays eligible (>= floor)", () => {
  const outcome = recommend({
    role: "build",
    models: FIXTURE_MODELS,
    source: SOURCE,
    overrides: [],
    buildMinIntelligence: 55,
    launch: LAUNCH
  });
  assert.equal(outcome.picks[0].model, "gemini-3.7-flash-high");
  assert.equal(outcome.picks[0].score.intelligence, 55);
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

test("review: unscored candidates never win, even when fastest", () => {
  const models = FIXTURE_MODELS.map((m) =>
    m.slug === "gemini-3-7-flash" ? { ...m, intelligence: null, outputTokensPerSec: 9999 } : { ...m }
  );
  const outcome = recommend({
    role: "review",
    models,
    source: SOURCE,
    overrides: [],
    authorModel: "other-model",
    launch: LAUNCH
  });
  assert.equal(outcome.picks[0].model, "gpt-5.6-terra");
  const reasons = Object.fromEntries(outcome.excluded.map((e) => [e.slug, e.reason]));
  assert.match(reasons["gemini-3-7-flash"], /unscored/);
});

test("renderRunCommand: auto gateway renders no flag, required/off render theirs, spaces are quoted", () => {
  const base = { name: "n", workspace: "/repo/ws" };
  assert.equal(
    renderRunCommand("codex", "gpt-5.6-terra", "xhigh", "auto", true, base),
    "h2a run codex /repo/ws --model gpt-5.6-terra --effort xhigh --name n --no-attach --background --json --headless --no-h2a --prompt-stdin"
  );
  assert.match(renderRunCommand("codex", "m", null, "required", true, base), / --gw /);
  assert.match(renderRunCommand("agy", "m", "high", "off", true, base), / --no-gw /);
  const spaced = renderRunCommand("codex", "m", null, "auto", true, { name: "my run", workspace: "/repo/my ws" });
  assert.match(spaced, /'\/repo\/my ws'/);
  assert.match(spaced, /--name 'my run'/);
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
    // The override names the parent state dir; the module appends model-eval/.
    process.env["MODEL_EVAL_STATE_DIR"] = "/tmp/eval-state";
    assert.equal(resolveModelEvalStateDir(), join("/tmp/eval-state", "model-eval"));
    assert.equal(resolveModelEvalStateDir("/tmp/flag-state"), join("/tmp/flag-state", "model-eval"));
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

test("resolveBuildMinIntelligence refuses non-finite input instead of defaulting", () => {
  assert.throws(() => resolveBuildMinIntelligence(NaN), (error) => error.code === "MODEL_EVAL_BAD_INPUT");
  const savedIntel = process.env["MODEL_EVAL_BUILD_MIN_INTEL"];
  try {
    process.env["MODEL_EVAL_BUILD_MIN_INTEL"] = "lots";
    assert.throws(() => resolveBuildMinIntelligence(), (error) => error.code === "MODEL_EVAL_BAD_INPUT");
  } finally {
    if (savedIntel === undefined) delete process.env["MODEL_EVAL_BUILD_MIN_INTEL"];
    else process.env["MODEL_EVAL_BUILD_MIN_INTEL"] = savedIntel;
  }
});

// --- CLI (offline subprocesses against the built dist) ---

const CLI_PATH = fileURLToPath(new URL("../dist/model-eval/cli.js", import.meta.url));

function runCli(args, stateDir, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, TMPDIR: tmpdir() };
  delete env["ARTIFICIAL_ANALYSIS_API_KEY"];
  delete env["MODEL_EVAL_STATE_DIR"];
  delete env["H2A_ROOT"];
  delete env["MODEL_EVAL_BUILD_MIN_INTEL"];
  return spawnSync(process.execPath, [CLI_PATH, ...args, "--state-dir", stateDir], {
    encoding: "utf8",
    env
  });
}

function seedCliCache(stateDir) {
  saveCache(
    { source: SOURCE.endpoint, fetchedAt: SOURCE.fetchedAt, intelligenceIndexVersion: 5, models: FIXTURE_MODELS },
    stateDir
  );
}

test("cli recommend design works offline from a seeded cache", () => {
  const dir = freshDir();
  try {
    seedCliCache(dir);
    const res = runCli(
      ["recommend", "--role", "design", "--name", "eval-check", "--workspace", "/repo/ws"],
      dir
    );
    assert.equal(res.status, 0);
    const outcome = JSON.parse(res.stdout);
    assert.equal(outcome.picks.length, 2);
    assert.notEqual(outcome.picks[0].mcp.name, outcome.picks[1].mcp.name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli rejects bad input with exit 1 (unknown flag, positional, bad name, bad threshold)", () => {
  const dir = freshDir();
  try {
    seedCliCache(dir);
    const base = ["recommend", "--role", "build", "--name", "ok-name", "--workspace", "/repo/ws"];
    assert.equal(runCli([...base, "--nope", "x"], dir).status, 1);
    assert.equal(runCli([...base, "stray-positional"], dir).status, 1);
    assert.equal(
      runCli(["recommend", "--role", "build", "--name", "bad name!", "--workspace", "/repo/ws"], dir).status,
      1
    );
    const badIntel = runCli([...base, "--build-min-intel", "lots"], dir);
    assert.equal(badIntel.status, 1);
    assert.match(badIntel.stderr, /MODEL_EVAL_BAD_INPUT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli status surfaces a corrupt cache instead of hiding it", () => {
  const dir = freshDir();
  try {
    mkdirSync(resolveModelEvalStateDir(dir), { recursive: true });
    writeFileSync(join(resolveModelEvalStateDir(dir), "aa-index.json"), "{corrupt", "utf8");
    const res = runCli(["status"], dir);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /MODEL_EVAL_BAD_CACHE/);
    const missing = runCli(["status"], join(dir, "empty-parent"));
    assert.equal(missing.status, 0);
    assert.match(missing.stdout, /"cache": null/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

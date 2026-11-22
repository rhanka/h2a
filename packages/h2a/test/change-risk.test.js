import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  THRESHOLD_MAX,
  THRESHOLD_WATCH,
  analyzeFileText,
  classifyUnit,
  computeUnitCoverage,
  crapScore,
  loadTypeScript,
  mergeLcovRecords,
  minCoverageForThreshold,
  parseGitDiffHunks,
  parseLcov,
  scanPerimeter,
} from "../scripts/change-risk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const SCRIPT_PATH = resolve(REPO_ROOT, "packages/h2a/scripts/change-risk.mjs");
const ts = loadTypeScript(REPO_ROOT);

function makeTempDir(prefix) {
  const base = process.env.TMPDIR || tmpdir();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

function runGit(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${res.status}): ${res.stderr}`);
  }
  return res.stdout;
}

function initTempGitRepo(prefix = "crap-repo-") {
  const dir = makeTempDir(prefix);
  runGit(dir, ["init", "-b", "main"]);
  runGit(dir, ["config", "user.name", "Test User"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  return dir;
}

function cleanSubtestEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  return env;
}

function runCli(args, { cwd = REPO_ROOT, env = process.env } = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ---------------------------------------------------------------------------
// 1. Formula, thresholds, and known values (Lot 1 criterion 3)
// ---------------------------------------------------------------------------

test("crapScore matches known reference values and owner thresholds", () => {
  assert.equal(THRESHOLD_MAX, 30);
  assert.equal(THRESHOLD_WATCH, 10);

  assert.equal(crapScore(5, 0), 30);
  assert.equal(crapScore(6, 0), 42);
  assert.equal(Number(crapScore(10, 0.42).toFixed(1)), 29.5);
  assert.equal(crapScore(31, 1), 31);

  assert.equal(minCoverageForThreshold(5), 0);
  assert.equal(Number((minCoverageForThreshold(6) * 100).toFixed(1)), 12.6);
  assert.equal(Number((minCoverageForThreshold(7) * 100).toFixed(1)), 22.3);
  assert.equal(Number((minCoverageForThreshold(15) * 100).toFixed(1)), 59.5);
  assert.equal(minCoverageForThreshold(30), 1);
  assert.equal(minCoverageForThreshold(31), null);
});

test("classifyUnit enforces owner Q1 thresholds, strict > comparison, ratchet, and N-A policy", () => {
  // Known coverage
  assert.deepEqual(classifyUnit({ ccCounted: 5, baseCc: null, cov: 1 }), {
    score: 5,
    status: "ok",
    alert: false,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 10, baseCc: null, cov: 1 }), {
    score: 10,
    status: "ok",
    alert: false,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 5, baseCc: null, cov: 0 }), {
    score: 30,
    status: "watch",
    alert: false,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 6, baseCc: null, cov: 0 }), {
    score: 42,
    status: "TO FIX",
    alert: true,
  });
  // Existing function over 30 whose complexity did NOT increase -> debt (never alert)
  assert.deepEqual(classifyUnit({ ccCounted: 35, baseCc: 35, cov: 1 }), {
    score: 35,
    status: "debt",
    alert: false,
  });
  // Existing function over 30 whose complexity increased -> TO FIX (alert)
  assert.deepEqual(classifyUnit({ ccCounted: 36, baseCc: 35, cov: 1 }), {
    score: 36,
    status: "TO FIX",
    alert: true,
  });
  // Coverage N-A policy: CC <= 5 passes, 6..30 is N-A (not alert), > 30 trips ratchet if added/increased
  assert.deepEqual(classifyUnit({ ccCounted: 5, baseCc: null, cov: null }), {
    score: null,
    status: "ok",
    alert: false,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 12, baseCc: null, cov: null }), {
    score: null,
    status: "N-A",
    alert: false,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 31, baseCc: null, cov: null }), {
    score: null,
    status: "TO FIX",
    alert: true,
  });
  assert.deepEqual(classifyUnit({ ccCounted: 31, baseCc: 31, cov: null }), {
    score: null,
    status: "debt",
    alert: false,
  });
});

// ---------------------------------------------------------------------------
// 2. Counted and uncounted constructs (Lot 1 criterion 4 + Carbon NB-1)
// ---------------------------------------------------------------------------

test("every counted decision construct adds +1 and uncounted constructs add 0", () => {
  const src = `
export function withIf(a) { if (a) return 1; return 0; }
export function withFor(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }
export function withForIn(o) { const k = []; for (const x in o) k.push(x); return k; }
export function withForOf(xs) { let s = 0; for (const x of xs) s += x; return s; }
export function withWhile(n) { while (n > 0) n--; return n; }
export function withDoWhile(n) { do { n--; } while (n > 0); return n; }
export function withCatch(f) { try { return f(); } catch { return null; } }
export function withTernary(a) { return a ? 1 : 2; }
export function withNonDelegatingCase(x) {
  switch (x) {
    case "a": { const y = 1; return y + 1; }
    default: return 0;
  }
}
export function withAnd(a, b) { return a && b; }
export function withOr(a, b) { return a || b; }
export function withAndAssign(a, b) { a &&= b; return a; }
export function withOrAssign(a, b) { a ||= b; return a; }

export function uncountedOptionalChain(a) { return a?.b?.[0]?.(); }
export function uncountedNullish(a, b) { return a ?? b; }
export function uncountedNullishAssign(a, b) { a ??= b; return a; }
export function uncountedDefaultOnly(x) {
  switch (x) {
    default: return 1;
  }
}
`;
  const { units } = analyzeFileText("constructs.ts", src, ts);
  const byName = new Map(units.map((u) => [u.name, u]));

  for (const name of [
    "withIf",
    "withFor",
    "withForIn",
    "withForOf",
    "withWhile",
    "withDoWhile",
    "withCatch",
    "withTernary",
    "withNonDelegatingCase",
    "withAnd",
    "withOr",
    "withAndAssign",
    "withOrAssign",
  ]) {
    assert.equal(byName.get(name)?.ccCounted, 2, `${name} should have ccCounted === 2`);
    assert.equal(byName.get(name)?.ccClassic, 2, `${name} should have ccClassic === 2`);
  }

  for (const name of [
    "uncountedOptionalChain",
    "uncountedNullish",
    "uncountedNullishAssign",
    "uncountedDefaultOnly",
  ]) {
    assert.equal(byName.get(name)?.ccCounted, 1, `${name} should have ccCounted === 1`);
    assert.equal(byName.get(name)?.ccClassic, 1, `${name} should have ccClassic === 1`);
  }
});

// ---------------------------------------------------------------------------
// 3. Delegating case exemption and counter-forms (Lot 1 criterion 8 + NB-1)
// ---------------------------------------------------------------------------

test("delegating case clauses are exempted strictly per §4.6 and NB-1", () => {
  const src = `
export function allDelegating(cmd, streams) {
  switch (cmd) {
    case "returnCall": return handleA(streams);
    case "callBreak": handleB(streams); break;
    case "returnConst": return "#f00";
    case "throwErr": throw new Error("boom");
    case "fall1":
    case "fall2":
      return handleC(streams);
    case "blockReturn": {
      return handleD(streams);
    }
    default: return null;
  }
}

export async function asyncDelegating(cmd) {
  switch (cmd) {
    case "a": await runA(); break;
    case "b": return runB();
    default: return;
  }
}

export function caseWithIf(x, attempt) {
  switch (x) {
    case "retry": if (attempt < 3) return again(); break;
    default: return null;
  }
}

export function caseWithTwoStatements(x) {
  switch (x) {
    case "close": flush(); release(); break;
    default: return null;
  }
}

export function caseWithBlockCallback(x) {
  switch (x) {
    case "cb": return run(() => { return 1; });
    default: return null;
  }
}

export function caseWithAssignment(x) {
  let args = [];
  switch (x) {
    case "set": args = [1, 2]; break;
    case "assignCall": args = makeArgs(); break;
    default: break;
  }
  return args;
}

export function fallthroughIntoNonDelegating(x) {
  switch (x) {
    case "a":
    case "b":
      flush();
      release();
      break;
    default: break;
  }
}

export function flatIfNotExempt(x) {
  if (x === "a") return handleA();
  if (x === "b") return handleB();
  return null;
}
`;
  const { units } = analyzeFileText("cases.ts", src, ts);
  const byName = new Map(units.map((u) => [u.name, u]));

  assert.equal(byName.get("allDelegating").ccClassic, 8);
  assert.equal(byName.get("allDelegating").ccCounted, 1);
  assert.equal(byName.get("allDelegating").delegatingCases, 7);

  assert.equal(byName.get("asyncDelegating").ccClassic, 3);
  assert.equal(byName.get("asyncDelegating").ccCounted, 1);

  // case + if => 1 + 1 + 1 = 3
  assert.equal(byName.get("caseWithIf").ccCounted, 3);
  // 2 statements => case counted => 1 + 1 = 2
  assert.equal(byName.get("caseWithTwoStatements").ccCounted, 2);
  // block callback => case counted => 1 + 1 = 2
  assert.equal(byName.get("caseWithBlockCallback").ccCounted, 2);
  // NB-1: assignment cases are NOT delegating => 1 + 2 = 3
  assert.equal(byName.get("caseWithAssignment").ccCounted, 3);
  assert.equal(byName.get("caseWithAssignment").delegatingCases, 0);
  // fall-through into non-delegating => both cases count => 1 + 2 = 3
  assert.equal(byName.get("fallthroughIntoNonDelegating").ccCounted, 3);
  // D10: flat if is NOT exempt => 1 + 2 = 3
  assert.equal(byName.get("flatIfNotExempt").ccCounted, 3);
});

// ---------------------------------------------------------------------------
// 4. Units, anonymous functions, <module>, and get/set accessors (Criterion 7 + NB-1 + Carbon §7.1)
// ---------------------------------------------------------------------------

test("anonymous root functions charge decisions to <module> and never become units", () => {
  const src = `
const items = [1, 2, 3];
items.forEach((x) => {
  if (x > 1) console.log(x);
});
export default (a, b) => {
  if (a && b) return 1;
  return 0;
};
`;
  const { units, moduleUnit } = analyzeFileText("anon-root.ts", src, ts);
  assert.equal(units.length, 0, "anonymous functions must never become units");
  assert.equal(moduleUnit.qname, "<module>");
  // 1 + if(x>1) + if(a && b) + && = 4
  assert.equal(moduleUnit.ccCounted, 4);
});

test("adjacent get/set accessors get distinct names and independent FNDA:0 coverage", () => {
  const dir = makeTempDir("crap-getset-");
  try {
    const modPath = join(dir, "box.mjs");
    const testPath = join(dir, "box.test.mjs");
    const lcovPath = join(dir, "out.lcov");
    writeFileSync(
      modPath,
      [
        "export class Box {",
        "  constructor(v) { this._v = v; }",
        "  get value() {",
        "    if (this._v > 0) return this._v;",
        "    return 0;",
        "  }",
        "  set value(n) {",
        "    if (n < 0 && this._v > 0) { this._v = 0; return; }",
        "    if (n > 100 || n === 42) { this._v = 100; return; }",
        "    this._v = n;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      testPath,
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { Box } from "./box.mjs";',
        'test("calls getter only", () => {',
        "  const b = new Box(5);",
        "  assert.equal(b.value, 5);",
        "});",
        "",
      ].join("\n"),
    );

    const run = spawnSync(
      process.execPath,
      [
        "--experimental-test-coverage",
        "--test",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
        testPath,
      ],
      { cwd: dir, encoding: "utf8", env: cleanSubtestEnv() },
    );
    assert.equal(run.status, 0, `node test failed: ${run.stderr}`);

    const lcov = parseLcov(lcovPath, dir);
    const { units } = analyzeFileText("box.mjs", readFileSync(modPath, "utf8"), ts);
    const byQname = new Map(units.map((u) => [u.qname, u]));
    assert.ok(byQname.has("Box.get value"), "getter must have qname Box.get value");
    assert.ok(byQname.has("Box.set value"), "setter must have qname Box.set value");

    const rec = lcov.get("box.mjs");
    assert.ok(rec, "box.mjs must exist in LCOV");

    const getCov = computeUnitCoverage(byQname.get("Box.get value"), rec);
    const setCov = computeUnitCoverage(byQname.get("Box.set value"), rec);

    assert.ok(getCov.cov > 0, `getter was called and should have >0% cov, got ${getCov.cov}`);
    assert.equal(setCov.cov, 0, `setter was never called and must have 0% cov via FNDA:0, got ${setCov.cov}`);
    assert.equal(setCov.reason, "FNDA:0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5 & 6. B-1: Never-called functions (FNDA:0) and Own-lines isolation (Criteria 5 & 6)
// ---------------------------------------------------------------------------

test("B-1 fixture: never-called functions get 0% and own lines exclude nested named functions", () => {
  const dir = makeTempDir("crap-b1-");
  try {
    const samplePath = join(dir, "sample.mjs");
    const testPath = join(dir, "sample.test.mjs");
    const lcovPath = join(dir, "b1.lcov");

    writeFileSync(
      samplePath,
      `// Case 1 — exported, 4 lines, complexity 6, NEVER called.
export function neverCalledExported(a, b, c) {
  if (a && b) return 1;
  return c ? (a || b ? 2 : 3) : 4;
}

// Case 2 — not exported, column 0, NEVER called.
function neverCalledLocal(a, b) {
  if (a) return 1;
  if (b) return 2;
  return 3;
}

// Case 3 — class method (indented), NEVER called; sibling IS called.
export class Router {
  calledMethod(x) {
    return x ? "yes" : "no";
  }
  neverCalledMethod(a, b) {
    if (a && b) return 1;
    if (a || b) return 2;
    return 3;
  }
}

// Case 4 — exported one-line arrow, complexity 3, NEVER called.
export const neverCalledOneLiner = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// Case 5 — parent called & fully run; nested named child NEVER called.
export function parentRunChildIdle(list) {
  const total = list.length;
  function idleChild(a, b, c) {
    if (a && b) return 1;
    if (b && c) return 2;
    if (a || c) return 3;
    return 4;
  }
  return total > 0 ? total : idleChild;
}

// Case 6 — parent runs first branch only; nested named child runs every line.
export function parentIdleChildRun(flag, value) {
  const busyChild = (n) => {
    const doubled = n * 2;
    const tripled = n * 3;
    const summed = doubled + tripled;
    return summed;
  };
  if (flag) {
    return busyChild(value);
  }
  const a = value + 1;
  const b = value + 2;
  const c = value + 3;
  const d = value + 4;
  return value > 10 ? a + b : c + d;
}

// Case 7 — control: called, partly covered (5/6 = 83%).
export function controlPartlyCovered(x) {
  if (x > 0) {
    return "positive";
  }
  return "other";
}

export const registry = { neverCalledLocal };
`,
    );

    writeFileSync(
      testPath,
      `import { test } from "node:test";
import assert from "node:assert/strict";
import { Router, parentRunChildIdle, parentIdleChildRun, controlPartlyCovered, registry } from "./sample.mjs";

test("calls known subset only", () => {
  assert.equal(new Router().calledMethod(true), "yes");
  assert.equal(parentRunChildIdle([1, 2]), 2);
  assert.equal(parentIdleChildRun(true, 2), 10);
  assert.equal(controlPartlyCovered(1), "positive");
  assert.equal(typeof registry.neverCalledLocal, "function");
});
`,
    );

    const run = spawnSync(
      process.execPath,
      [
        "--experimental-test-coverage",
        "--test",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
        testPath,
      ],
      { cwd: dir, encoding: "utf8", env: cleanSubtestEnv() },
    );
    assert.equal(run.status, 0, `B-1 fixture test failed: ${run.stderr}`);

    const lcov = parseLcov(lcovPath, dir);
    const rec = lcov.get("sample.mjs");
    assert.ok(rec, "sample.mjs must be present in LCOV");

    const { units } = analyzeFileText("sample.mjs", readFileSync(samplePath, "utf8"), ts);
    const byQname = new Map(units.map((u) => [u.qname, u]));

    const check = (qname, expectedCc, expectedCovPct, expectedScore) => {
      const u = byQname.get(qname);
      assert.ok(u, `missing unit ${qname}`);
      assert.equal(u.ccCounted, expectedCc, `${qname} complexity`);
      const res = computeUnitCoverage(u, rec);
      assert.notEqual(res.cov, null, `${qname} coverage should not be null`);
      assert.equal(Math.round(res.cov * 100), expectedCovPct, `${qname} coverage %`);
      assert.equal(Number(crapScore(u.ccCounted, res.cov).toFixed(1)), expectedScore, `${qname} CRAP score`);
    };

    check("neverCalledExported", 6, 0, 42.0);
    check("Router.neverCalledMethod", 5, 0, 30.0);
    check("neverCalledOneLiner", 3, 0, 12.0);
    check("neverCalledLocal", 3, 0, 12.0);
    check("parentRunChildIdle", 2, 100, 2.0);
    check("parentRunChildIdle.idleChild", 7, 0, 56.0);
    check("parentIdleChildRun", 3, 60, 3.6);
    check("parentIdleChildRun.busyChild", 1, 100, 1.0);
    check("controlPartlyCovered", 2, 83, 2.0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("coverage rule 4 guard (declaration line only without FN) and LCOV merge", () => {
  const src = `export function orphan(a, b) {\n  if (a) return 1;\n  if (b) return 2;\n  return 3;\n}\n`;
  const { units } = analyzeFileText("orphan.ts", src, ts);
  const u = units[0];
  const rec = {
    da: new Map([
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 0],
    ]),
    fns: [],
  };
  const cov = computeUnitCoverage(u, rec);
  assert.equal(cov.cov, 0);
  assert.equal(cov.reason, "declaration-line-only");

  // Merging two LCOV maps sums DA hits and FN hits
  const m1 = new Map([["a.ts", { da: new Map([[1, 1], [2, 0]]), fns: [{ line: 1, name: "f", hits: 0 }] }]]);
  const m2 = new Map([["a.ts", { da: new Map([[1, 0], [2, 2]]), fns: [{ line: 1, name: "f", hits: 3 }] }]]);
  const merged = mergeLcovRecords([m1, m2]);
  assert.equal(merged.get("a.ts").da.get(1), 1);
  assert.equal(merged.get("a.ts").da.get(2), 2);
  assert.equal(merged.get("a.ts").fns[0].hits, 3);
});

// ---------------------------------------------------------------------------
// 7. Diff mode (--base) & LCOV vs N-A output (Lot 1 criteria 1 & 2)
// ---------------------------------------------------------------------------

test("diff mode lists only touched units with before/after complexity, N-A required coverage, and LCOV scores", () => {
  const repo = initTempGitRepo("crap-diff-");
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    writeFileSync(
      join(repo, "src/math.mjs"),
      `export function untouched(a, b, c) {
  if (a) return 1;
  if (b) return 2;
  if (c) return 3;
  return 0;
}

export function grown(a) {
  if (a > 0) return 1;
  return 0;
}
`,
    );
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "init"]);

    // Modify `grown` (CC 2 -> 6) and add `added` (CC 7), leaving `untouched` unchanged.
    writeFileSync(
      join(repo, "src/math.mjs"),
      `export function untouched(a, b, c) {
  if (a) return 1;
  if (b) return 2;
  if (c) return 3;
  return 0;
}

export function grown(a, b, c) {
  if (a > 0 && b > 0) return 1;
  if (c > 0 || a < -1) return 2;
  return b ? 3 : 0;
}

export function added(a, b, c) {
  if (a && b) return 1;
  if (b || c) return 2;
  if (a && c) return 3;
  return 0;
}
`,
    );

    const diffRes = runCli(["--base", "HEAD", "--repo", repo, "--json"]);
    assert.equal(diffRes.status, 0, `diff mode failed: ${diffRes.stderr}`);
    const data = JSON.parse(diffRes.stdout);
    const names = data.rows.map((r) => r.qname);
    assert.ok(!names.includes("untouched"), "untouched function must not appear in diff output");
    assert.ok(names.includes("grown"), "modified function must appear");
    assert.ok(names.includes("added"), "added function must appear");

    const grownRow = data.rows.find((r) => r.qname === "grown");
    assert.equal(grownRow.baseCc, 2);
    assert.equal(grownRow.ccCounted, 6);
    assert.equal(grownRow.cov, null);
    assert.equal(grownRow.status, "N-A");
    assert.equal(Math.ceil(grownRow.minCoverage * 100), 13);

    const textRes = runCli(["--base", "HEAD", "--repo", repo]);
    assert.equal(textRes.status, 0, textRes.stderr);
    assert.match(textRes.stdout, /N-A/);
    assert.match(textRes.stdout, /2->6/);
    assert.match(textRes.stdout, /23\s*%/);

    // Now supply an LCOV with 0% coverage on both -> real CRAP scores appear (56.0 and 42.0)
    const lcovPath = join(repo, "tmp-cov.lcov");
    writeFileSync(
      lcovPath,
      [
        "TN:",
        "SF:src/math.mjs",
        "FN:8,grown",
        "FN:14,added",
        "FNDA:0,grown",
        "FNDA:0,added",
        "DA:8,1",
        "DA:9,0",
        "DA:14,1",
        "DA:15,0",
        "end_of_record",
        "",
      ].join("\n"),
    );
    const lcovRes = runCli(["--base", "HEAD", "--repo", repo, "--lcov", lcovPath]);
    assert.equal(lcovRes.status, 0, lcovRes.stderr);
    assert.match(lcovRes.stdout, /56\.0/);
    assert.match(lcovRes.stdout, /42\.0/);
    assert.match(lcovRes.stdout, /TO FIX/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("parseGitDiffHunks parses additions, modifications, and pure deletions", () => {
  const sampleDiff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,0 +11,3 @@",
    "@@ -20,2 +23,0 @@",
    "@@ -30 +31 @@",
  ].join("\n");
  const hunks = parseGitDiffHunks(sampleDiff);
  assert.deepEqual(hunks.get("src/a.ts"), [
    [11, 13],
    [23, 23],
    [31, 31],
  ]);
});

// ---------------------------------------------------------------------------
// 8. Level 1 turnkey --test mode, read-only TMPDIR, sandbox, Vitest N-A (Criterion 9 + NB-2)
// ---------------------------------------------------------------------------

test("turnkey --test runs Node test with coverage even when TMPDIR is read-only, and returns N-A for Vitest", () => {
  const repo = initTempGitRepo("crap-l1-");
  const roTmp = makeTempDir("crap-rotmp-");
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "test"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "tmp/\n");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "l1-fixture", type: "module" }));
    writeFileSync(
      join(repo, "src/calc.mjs"),
      `export function decide(a, b, c) {
  if (a && b) return 1;
  if (b && c) return 2;
  if (a || c) return 3;
  return 0;
}
`,
    );
    writeFileSync(
      join(repo, "test/calc.test.mjs"),
      `import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/calc.mjs";
test("covers all branches", () => {
  assert.equal(decide(1, 1, 0), 1);
  assert.equal(decide(0, 1, 1), 2);
  assert.equal(decide(1, 0, 0), 3);
  assert.equal(decide(0, 0, 0), 0);
});
`,
    );
    writeFileSync(
      join(repo, "test/vitest-sample.test.ts"),
      `import { describe, it, expect } from "vitest";
describe("sample", () => { it("ok", () => { expect(1).toBe(1); }); });
`,
    );
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "init"]);

    // Touch inside `decide` so diff mode sees `decide`
    writeFileSync(
      join(repo, "src/calc.mjs"),
      `export function decide(a, b, c) {
  // touched inside decide
  if (a && b) return 1;
  if (b && c) return 2;
  if (a || c) return 3;
  return 0;
}
`,
    );

    // Make roTmp read-only to verify --test does not rely on a writable system TMPDIR
    chmodSync(roTmp, 0o555);
    const res = runCli(
      ["--base", "HEAD", "--repo", repo, "--test", "test/calc.test.mjs", "--json"],
      {
        cwd: repo,
        env: { ...process.env, TMPDIR: roTmp, TMP: roTmp, TEMP: roTmp },
      },
    );
    assert.equal(res.status, 0, `turnkey --test failed with read-only TMPDIR: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    const decideRow = parsed.rows.find((r) => r.qname === "decide");
    assert.ok(decideRow, "decide should be in rows");
    assert.equal(decideRow.ccCounted, 7);
    assert.equal(Math.round(decideRow.cov * 100), 100);
    assert.equal(Number(decideRow.score.toFixed(1)), 7.0);
    assert.equal(decideRow.status, "ok");

    // Vitest file -> returns N-A cleanly without failing
    const vitestRes = runCli(
      ["--base", "HEAD", "--repo", repo, "--test", "test/vitest-sample.test.ts", "--json"],
      { cwd: repo },
    );
    assert.equal(vitestRes.status, 0, `vitest --test failed: ${vitestRes.stderr}`);
    const vitestData = JSON.parse(vitestRes.stdout);
    assert.equal(vitestData.vitestSkipped, true);
    assert.equal(vitestData.rows.find((r) => r.qname === "decide")?.cov, null);
  } finally {
    chmodSync(roTmp, 0o755);
    rmSync(roTmp, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("turnkey --test re-executes inside scripts/test-sandbox.mjs and auto-imports native-isolation.js (NB-2)", () => {
  const repo = initTempGitRepo("crap-sandbox-");
  const roTmp = makeTempDir("crap-ro-sb-");
  try {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    mkdirSync(join(repo, "packages/h2a/src"), { recursive: true });
    mkdirSync(join(repo, "packages/h2a/test/helpers"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "tmp/\n");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sb-fixture", type: "module" }));
    writeFileSync(
      join(repo, "packages/h2a/src/widget.mjs"),
      `export function widget(a, b) {
  if (a && b) return 1;
  if (a || b) return 2;
  return 0;
}
`,
    );
    writeFileSync(
      join(repo, "packages/h2a/test/helpers/native-isolation.js"),
      `if (process.env.H2A_TEST_STATE_BARRIER !== "1") {
  throw new Error("native-isolation requires H2A_TEST_STATE_BARRIER=1");
}
globalThis.__NATIVE_ISOLATION_PRELOADED = true;
`,
    );
    writeFileSync(
      join(repo, "packages/h2a/test/widget.test.js"),
      `import test from "node:test";
import assert from "node:assert/strict";
import { widget } from "../src/widget.mjs";
test("preloaded native isolation and covers widget", () => {
  assert.equal(globalThis.__NATIVE_ISOLATION_PRELOADED, true);
  assert.equal(widget(1, 1), 1);
  assert.equal(widget(0, 1), 2);
  assert.equal(widget(0, 0), 0);
});
`,
    );
    // Mock test-sandbox.mjs modeling NB-2: creates an ephemeral hostH temp dir inside env.TMPDIR,
    // sets H2A_TEST_STATE_BARRIER=1, runs the command, and deletes the ephemeral dir before returning.
    writeFileSync(
      join(repo, "scripts/test-sandbox.mjs"),
      `import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
const sep = process.argv.indexOf("--");
const cmd = process.argv.slice(sep + 1);
const repoTmp = resolve(process.cwd(), "tmp");
if (!process.env.TMPDIR || !resolve(process.env.TMPDIR).startsWith(repoTmp)) {
  process.stderr.write("expected TMPDIR inside repo tmp/, got: " + process.env.TMPDIR + "\\n");
  process.exit(41);
}
const ephemeral = mkdtempSync(join(process.env.TMPDIR, "ephemeral-h-"));
try {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      H2A_TEST_STATE_BARRIER: "1",
      TMPDIR: ephemeral,
      TMP: ephemeral,
      TEMP: ephemeral,
    },
  });
  process.exit(r.status ?? 1);
} finally {
  rmSync(ephemeral, { recursive: true, force: true });
}
`,
    );

    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "init"]);

    chmodSync(roTmp, 0o555);
    const cleanEnv = { ...process.env, TMPDIR: roTmp, TMP: roTmp, TEMP: roTmp };
    delete cleanEnv.H2A_TEST_STATE_BARRIER;
    const res = runCli(
      [
        "--repo",
        repo,
        "--test",
        "packages/h2a/test/widget.test.js",
        "--file",
        "packages/h2a/src/widget.mjs",
        "--json",
      ],
      { cwd: repo, env: cleanEnv },
    );
    assert.equal(res.status, 0, `sandboxed --test failed: ${res.stderr}`);
    const data = JSON.parse(res.stdout);
    const row = data.rows.find((r) => r.qname === "widget");
    assert.ok(row, "widget must be measured from ephemeral LCOV inside sandbox");
    assert.equal(Math.round(row.cov * 100), 100);
    assert.equal(Number(row.score.toFixed(1)), 5.0);
  } finally {
    chmodSync(roTmp, 0o755);
    rmSync(roTmp, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("turnkey --test maps compiled JS back to TS via --enable-source-maps and includes <module> in all modes", () => {
  const repo = initTempGitRepo("crap-smap-");
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "dist"), { recursive: true });
    mkdirSync(join(repo, "test"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "tmp/\n");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "smap-fixture", type: "module" }));

    const compileWithMap = (source) => {
      const out = ts.transpileModule(source, {
        fileName: "pick.ts",
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          sourceMap: true,
        },
      });
      const mapObj = JSON.parse(out.sourceMapText);
      mapObj.sources = ["../src/pick.ts"];
      writeFileSync(join(repo, "dist/pick.js"), out.outputText);
      writeFileSync(join(repo, "dist/pick.js.map"), JSON.stringify(mapObj));
    };

    const tsSource = `export function pick(x: number, y: number): number {
  if (x > 0 && y > 0) return x + y;
  return 0;
}

export const flag = process.env.X ? 1 : 0;
`;
    const tsFile = join(repo, "src/pick.ts");
    writeFileSync(tsFile, tsSource);
    compileWithMap(tsSource);
    writeFileSync(
      join(repo, "test/pick.test.mjs"),
      `import test from "node:test";
import assert from "node:assert/strict";
import { pick } from "../dist/pick.js";
test("runs pick", () => {
  assert.equal(pick(2, 3), 5);
  assert.equal(pick(0, 3), 0);
});
`,
    );
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "init"]);

    // Modify both `pick` and top-level `flag` so diff mode sees both `pick` and `<module>` (CC=2)
    const editedTs = `export function pick(x: number, y: number): number {
  // touched
  if (x > 0 && y > 0) return x + y;
  return 0;
}

export const flag = process.env.X ? 2 : 0;
`;
    writeFileSync(tsFile, editedTs);
    compileWithMap(editedTs);

    const res = runCli(["--base", "HEAD", "--repo", repo, "--test", "test/pick.test.mjs", "--json"], {
      cwd: repo,
    });
    assert.equal(res.status, 0, `source-map --test failed: ${res.stderr}`);
    const data = JSON.parse(res.stdout);
    const pickRow = data.rows.find((r) => r.qname === "pick");
    const modRow = data.rows.find((r) => r.qname === "<module>");
    assert.ok(pickRow, "pick should be mapped from dist/pick.js back to src/pick.ts");
    assert.equal(Math.round(pickRow.cov * 100), 100);
    assert.ok(modRow, "<module> with CC >= 2 must be included in diff/--test mode (NB-1)");
    assert.equal(modRow.ccCounted, 2);

    // Also verify --all includes <module> and renders human-readable inventory + uncovered list
    writeFileSync(join(repo, "src/App.svelte"), "<script>export let x = 1;</script>\n");
    const allRes = runCli(["--all", "--repo", repo, "--json"], { cwd: repo });
    assert.equal(allRes.status, 0, allRes.stderr);
    const allData = JSON.parse(allRes.stdout);
    assert.ok(allData.rows.some((r) => r.qname === "<module>" && r.file === "src/pick.ts"));
    assert.deepEqual(allData.inventory.uncoveredFiles, ["src/App.svelte"]);

    const allTextRes = runCli(["--all", "--repo", repo, "--top", "5"], { cwd: repo });
    assert.equal(allTextRes.status, 0, allTextRes.stderr);
    assert.match(allTextRes.stdout, /repository inventory/);
    assert.match(allTextRes.stdout, /Uncovered files \(1/);
    assert.match(allTextRes.stdout, /src\/App\.svelte/);

    const helpRes = runCli(["--help"], { cwd: repo });
    assert.equal(helpRes.status, 0, helpRes.stderr);
    assert.match(helpRes.stdout, /Usage: change-risk\.mjs/);

    // When running inside h2a's live test-sandbox (CI), also verify a real built h2a test file end-to-end.
    if (process.env.H2A_TEST_STATE_BARRIER === "1") {
      const h2aRes = runCli([
        "--test",
        "packages/h2a/test/canonical.test.js",
        "--file",
        "packages/h2a/src/canonical.ts",
        "--json",
      ]);
      assert.equal(h2aRes.status, 0, `real h2a --test failed: ${h2aRes.stderr}`);
      const h2aData = JSON.parse(h2aRes.stdout);
      assert.equal(Math.round(h2aData.rows.find((r) => r.qname === "computeHash")?.cov * 100), 100);
      assert.equal(Math.round(h2aData.rows.find((r) => r.qname === "canonicalize")?.cov * 100), 100);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 9. Perimeter, exclusions, .svelte uncovered, --all, and root script (Criteria 10 & 11)
// ---------------------------------------------------------------------------

test("scanPerimeter walks all hand-written JS/TS, skips tests/generated/excluded, and lists .svelte/.vue uncovered", () => {
  const dir = makeTempDir("crap-perim-");
  try {
    for (const d of ["src", "scripts", "hooks", "dist", "test", "docs/plan/old"]) {
      mkdirSync(join(dir, d), { recursive: true });
    }
    writeFileSync(join(dir, "src/app.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src/app.test.ts"), "export const t = 1;\n");
    writeFileSync(join(dir, "src/types.d.ts"), "export type X = number;\n");
    writeFileSync(join(dir, "src/gen.ts"), "// GENERATED — DO NOT EDIT\nexport const g = 1;\n");
    writeFileSync(join(dir, "src/View.svelte"), "<script>let x = 1;</script>\n");
    writeFileSync(join(dir, "src/Card.vue"), "<template></template>\n");
    writeFileSync(join(dir, "scripts/tool.mjs"), "export function run() { return 1; }\n");
    writeFileSync(join(dir, "hooks/guard.mjs"), "if (process.env.X) console.log(1);\n");
    writeFileSync(join(dir, "dist/app.js"), "export const a = 1;\n");
    writeFileSync(join(dir, "test/helper.js"), "export const h = 1;\n");
    writeFileSync(join(dir, "docs/plan/old/frozen.mjs"), "export const f = 1;\n");

    const perim = scanPerimeter(dir, { excludePrefixes: ["docs/plan"] });
    assert.deepEqual(perim.kept.sort(), ["hooks/guard.mjs", "scripts/tool.mjs", "src/app.ts"]);
    assert.deepEqual(perim.generated, ["src/gen.ts"]);
    assert.deepEqual(perim.uncovered.sort(), ["src/Card.vue", "src/View.svelte"]);
    assert.deepEqual(perim.excluded, ["docs/plan/old/frozen.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("root package.json exposes npm run crap pointing to packages/h2a/scripts/change-risk.mjs", () => {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(typeof pkg.scripts.crap, "string");
  assert.match(pkg.scripts.crap, /packages\/h2a\/scripts\/change-risk\.mjs/);
  assert.ok(existsSync(SCRIPT_PATH));
});

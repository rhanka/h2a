// architect skill: the check-mmd.mjs gate on a synthetic fixture, plus plugin packaging.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = fileURLToPath(new URL("../skills/architect/", import.meta.url));
const CHECK = join(SKILL_DIR, "scripts", "check-mmd.mjs");
const FIXTURE = fileURLToPath(new URL("./fixtures/architect/notes.mmd", import.meta.url));
const BASE = readFileSync(FIXTURE, "utf8");
const ENGRAM_PKG = fileURLToPath(new URL("../../../node_modules/@sentropic/engram/", import.meta.url));

function lane(t) {
  const dir = mkdtempSync(join(tmpdir(), "architect-skill-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

function checkText(t, text, args = ["--engram", "lib"], env = {}) {
  const file = join(lane(t), "candidate.mmd");
  writeFileSync(file, text);
  return { file, ...run([file, "--json", ...args], env) };
}

const statusOf = (result) => Object.fromEntries(result.json().stages.map((s) => [s.name, s.status]));
const codesOf = (result, stage) => result.json().stages.find((s) => s.name === stage).diagnostics.map((d) => d.code);

function swap(from, to) {
  return (text) => {
    assert.ok(text.includes(from), `fixture lacks ${JSON.stringify(from)}`);
    return text.replace(from, to);
  };
}

test("the synthetic fixture passes every stage", (t) => {
  const r = checkText(t, BASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = r.json();
  assert.equal(j.ok, true);
  assert.equal(j.complete, true);
  assert.deepEqual(j.stages.map((s) => s.name), ["forbidden", "parse", "canonical", "stage1", "pins", "semantic", "profile"]);
  assert.ok(j.stages.every((s) => s.status === "pass" && s.diagnostics.length === 0));
  assert.equal(j.engine.cli, null);
  assert.match(j.engine.lib, /@sentropic\/engram@/);
});

const FORBIDDEN = {
  "@dl gap": swap("%% @dl stretch true\n", "%% @dl stretch true\n%% @dl gap card-x 40\n"),
  "gap-after": swap("%% @dl group people rows\n", "%% @dl group people rows gap-after 12\n"),
  style: (text) => `${text}style e_rt_cli fill:#f00\n`,
  linkStyle: (text) => `${text}linkStyle 0 stroke:#f00\n`,
  classDef: swap("classDef dashed stroke-dasharray: 5 5", "classDef dashed fill:#ff0"),
  ":::": swap('e_rt_cli["notes"]', 'e_rt_cli["notes"]:::hot'),
  "init directive": (text) => `%%{init: {"flowchart": {"nodeSpacing": 50}}}%%\n${text}`,
  "front matter": (text) => `---\nconfig: {}\n---\n${text}`,
  coordinate: (text) => `${text}e_rt_cli@{ x: 10, y: 20 }\n`,
};

for (const [token, mutate] of Object.entries(FORBIDDEN)) {
  test(`forbidden token ${token} fails the forbidden stage`, (t) => {
    const r = checkText(t, mutate(BASE));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const forbidden = r.json().stages.find((s) => s.name === "forbidden");
    assert.equal(forbidden.status, "fail");
    assert.ok(forbidden.diagnostics.some((d) => d.message.startsWith(`${token}:`)), JSON.stringify(forbidden.diagnostics));
  });
}

test("a gap the engram codec accepts is still refused, by the forbidden stage alone", (t) => {
  const r = checkText(t, FORBIDDEN["@dl gap"](BASE));
  const s = statusOf(r);
  assert.equal(s.forbidden, "fail");
  for (const stage of ["parse", "canonical", "stage1", "pins", "semantic", "profile"]) assert.equal(s[stage], "pass", stage);
});

const STAGE_MUTANTS = [
  ["canonical", "architect-noncanonical", (text) => {
    const host = text.match(/%% @dl entity host workstation\n[^]*?end\n\n/)[0];
    return text.replace(host, "").replace("%% @dl entity system\n", `${host}%% @dl entity system\n`);
  }],
  ["pins", "digest-mismatch", swap("81ed1a11925f9bb1d644a839cad788555ffeea876c8c09d2d0a34d6981e8b344", "81ed1a11925f9bb1d644a839cad788555ffeea876c8c09d2d0a34d6981e8b345")],
  ["semantic", "archi-edge-verb", swap('|"calls · HTTP"|', '|"HTTP"|')],
  ["semantic", "archi-footer-missing", swap('%% @dl rel ob-notes ownedBy e_repo_notes e_act_team\n%% @dl evidence "assertion: synthetic fixture"\n', "")],
  ["stage1", "archi-manifest-invalid", (text) => text.slice(0, text.indexOf("%% @dl view ")) + text.slice(text.indexOf("classDef"))],
  ["profile", "architect-profile-required", swap('%% @dl role "Runs the CLI and the server"\n', "")],
];

for (const [stage, code, mutate] of STAGE_MUTANTS) {
  test(`a ${code} mutant fails the ${stage} stage only`, (t) => {
    const r = checkText(t, mutate(BASE));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const s = statusOf(r);
    for (const [name, status] of Object.entries(s)) assert.equal(status, name === stage ? "fail" : "pass", `${name}: ${r.stdout}`);
    assert.ok(codesOf(r, stage).includes(code), JSON.stringify(codesOf(r, stage)));
  });
}

test("a relation outside the archi@1 matrix fails the profile stage after --write", (t) => {
  const text = swap("%% @dl rel op-ws operatedBy e_host_ws e_act_writer\n",
    '%% @dl rel op-ws operatedBy e_host_ws e_act_writer\n%% @dl evidence "assertion: synthetic fixture"\n%% @dl rel ro-store runsOn e_st_notes e_host_ws\n')(BASE);
  const r = checkText(t, text, ["--engram", "lib", "--write"]);
  assert.equal(r.status, 1);
  const s = statusOf(r);
  assert.equal(s.canonical, "pass");
  assert.equal(s.profile, "fail");
  assert.deepEqual(codesOf(r, "profile"), ["architect-profile-matrix"]);
});

test("--write turns a non-canonical file into the canonical bytes, then passes", (t) => {
  const r = checkText(t, STAGE_MUTANTS[0][2](BASE), ["--engram", "lib", "--write"]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.json().written, true);
  assert.equal(readFileSync(r.file, "utf8"), BASE);
});

test("a parse failure is reported and the later stages are marked not-run", (t) => {
  const r = checkText(t, BASE.replace("%% @dl format engram.archi-mermaid/1\n", ""));
  assert.equal(r.status, 1);
  const j = r.json();
  assert.equal(j.ok, false);
  assert.equal(j.complete, false);
  const parse = j.stages.find((s) => s.name === "parse");
  assert.equal(parse.status, "fail");
  assert.match(parse.diagnostics[0].code, /^mermaid-strict-/);
  for (const s of j.stages.slice(2)) assert.deepEqual([s.status, s.reason], ["not-run", "parse failed"], s.name);
});

test("the text report names each stage, the engine and the result", (t) => {
  const file = join(lane(t), "candidate.mmd");
  writeFileSync(file, FORBIDDEN["@dl gap"](BASE));
  const r = run([file, "--engram", "lib"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /candidate\.mmd:\d+ forbidden architect-forbidden-token @dl gap:/);
  assert.match(r.stdout, /^forbidden: fail \(1\)$/m);
  assert.match(r.stdout, /^profile: pass$/m);
  assert.match(r.stdout, /^engine: @sentropic\/engram@/m);
  assert.match(r.stdout, /^result: fail$/m);
});

test("--print-head prints the governed pins of the fixture head", () => {
  const r = run(["--print-head", "--document", "notes-example", "--owning-repo", "e_repo_notes", "--language", "en", "--legend"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${BASE.split("\n\n")[0]}\n`);
});

test("usage errors exit 2 and an unavailable engram exits 3 with the build hint", (t) => {
  assert.equal(run([]).status, 2);
  assert.equal(run([FIXTURE, "--engram", "nope"]).status, 2);
  assert.equal(run([join(lane(t), "missing.mmd"), "--engram", "lib"]).status, 2);
  const r = run([FIXTURE, "--engram", "lib", "--engram-dist", lane(t)]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /npm run build:server/);
  assert.match(r.stderr, /--engram-dist/);
});

// A stand-in for `engram archi check <f.mmd> [--json] [--allow-gap]` and `engram archi fmt <f.mmd> [--write|--check]` built on the same library.
function fakeEngramCli(t) {
  const bin = join(lane(t), "bin");
  mkdirSync(bin);
  const url = (file) => pathToFileURL(join(ENGRAM_PKG, "dist", file)).href;
  // Dynamic imports only: the extensionless shim must run as CommonJS or ESM, whatever package scope holds TMPDIR.
  writeFileSync(join(bin, "engram"), `#!/usr/bin/env node
(async () => {
  const fs = await import("node:fs");
  const m = await import(${JSON.stringify(url("archi-mermaid.js"))});
  const a = await import(${JSON.stringify(url("archi.js"))});
  const [cmd, sub, ...rest] = process.argv.slice(2);
  if (cmd === "--version") return console.log("0.0.0-test");
  if (cmd !== "archi") process.exit(2);
  if (sub === "--help") return console.log("Commands:\\n  check <f.mmd> [--json] [--allow-gap]\\n  fmt <f.mmd> [--write|--check]");
  const [file, ...flags] = rest;
  if (!file || file.startsWith("-")) { console.error("expected <f.mmd> before flags"); process.exit(2); }
  const text = fs.readFileSync(file, "utf8");
  if (sub === "check") {
    const allowed = new Set(["--json", "--allow-gap"]);
    for (const flag of flags) if (!allowed.has(flag)) { console.error("unknown flag " + flag); process.exit(2); }
    const p = m.parseArchiMermaid(text, { subjectRef: file });
    const diagnostics = p.ok ? [...a.checkArchi(p.value.document, { labels: a.ARCHI_CARDS_CONTENT.labels }, p.value.manifest.language)] : [...p.diagnostics];
    if (p.ok && !flags.includes("--allow-gap") && /^%%\\s*@dl\\s+gap(\\s|$)/m.test(text)) {
      diagnostics.push({ code: "archi-gap-forbidden", severity: "error", message: "@dl gap forbidden", path: "" });
    }
    if (flags.includes("--json")) console.log(JSON.stringify({ ok: diagnostics.length === 0, file, diagnostics }));
    process.exit(diagnostics.length ? 1 : 0);
  }
  if (sub === "fmt") {
    const allowed = new Set(["--write", "--check"]);
    for (const flag of flags) if (!allowed.has(flag)) { console.error("unknown flag " + flag); process.exit(2); }
    if (flags.includes("--write") && flags.includes("--check")) { console.error("--write and --check are mutually exclusive"); process.exit(2); }
    const f = m.formatArchiMermaid(text, { subjectRef: file });
    if (!f.ok) process.exit(1);
    if (flags.includes("--check")) process.exit(f.value === text ? 0 : 1);
    if (flags.includes("--write")) fs.writeFileSync(file, f.value);
    else process.stdout.write(f.value);
    process.exit(0);
  }
  process.exit(2);
})();
`);
  chmodSync(join(bin, "engram"), 0o755);
  return { PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":") };
}

test("the engram CLI is used for check and fmt when it is on PATH", (t) => {
  const env = fakeEngramCli(t);
  const ok = checkText(t, BASE, [], env);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.json().engine.cli, /engram CLI 0\.0\.0-test/);
  assert.match(ok.json().engine.lib, /@sentropic\/engram@/);
  const verb = checkText(t, swap('|"calls · HTTP"|', '|"HTTP"|')(BASE), [], env);
  assert.equal(verb.status, 1);
  assert.deepEqual(codesOf(verb, "semantic"), ["archi-edge-verb"]);
  const unformatted = checkText(t, STAGE_MUTANTS[0][2](BASE), [], env);
  assert.equal(statusOf(unformatted).canonical, "fail");
  const rewritten = checkText(t, STAGE_MUTANTS[0][2](BASE), ["--write"], env);
  assert.equal(rewritten.status, 0, rewritten.stdout + rewritten.stderr);
  assert.equal(rewritten.json().written, true);
  assert.equal(readFileSync(rewritten.file, "utf8"), BASE);
  const gap = checkText(t, FORBIDDEN["@dl gap"](BASE), [], env);
  assert.equal(gap.status, 1);
  assert.equal(statusOf(gap).forbidden, "fail");
  assert.equal(statusOf(gap).semantic, "pass");
  const cliOnly = checkText(t, BASE, ["--engram", "cli"], env);
  assert.equal(cliOnly.status, 0, cliOnly.stdout);
  assert.equal(cliOnly.json().complete, false);
  assert.deepEqual(cliOnly.json().stages.filter((s) => s.status === "not-run").map((s) => s.name), ["stage1", "pins", "profile"]);
});

test("--engram cli without the CLI on PATH exits 3", () => {
  const r = run([FIXTURE, "--engram", "cli"], { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":") });
  assert.equal(r.status, 3, r.stdout + r.stderr);
});

// ---------- packaging ----------
function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

test("the skill ships SKILL.md and the checker only, with a matching name", () => {
  const files = filesUnder(SKILL_DIR).map((f) => relative(SKILL_DIR, f)).sort();
  assert.deepEqual(files, ["SKILL.md", join("scripts", "check-mmd.mjs")]);
  const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(front, "YAML frontmatter with name and description");
  assert.equal(front[1], "architect");
  for (const trigger of ["architecture diagram", "schéma d'archi", "mermaid engram"]) assert.ok(front[2].includes(trigger), trigger);
  assert.match(skill, /DS renderer: pending/);
  assert.ok(skill.includes("engram archi check <f.mmd> [--json] [--allow-gap]"));
  assert.ok(skill.includes("engram archi fmt <f.mmd> [--write|--check]"));
  assert.ok(!skill.includes("--manifest"));
});

test("the checker imports Node built-ins only and never vendors engram", () => {
  const source = readFileSync(CHECK, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env node\n/);
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0 && imports.every((s) => s.startsWith("node:")), JSON.stringify(imports));
  assert.ok(!filesUnder(SKILL_DIR).some((f) => /\.(py|pyw|pyi|pyx)$/i.test(f)));
  assert.ok((statSync(CHECK).size) < 40_000, "the checker stays a small script");
});

test("the fixture is synthetic: every name comes from a closed list", () => {
  const names = [...BASE.matchAll(/\["([^"]*)"\]/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["@example/notes", "@example/notes-core", "Core", "Edge", "Indexer", "Layers", "Notes", "Notes HTTP API",
    "Notes team", "Search", "Workstation", "Writer", "notes", "notes", "notes directory", "notes skill", "notes-server"].sort());
});

test("install-skills renders the architect skill and its checker for Claude and Codex", async (t) => {
  const { runCli } = await import("../dist/index.js");
  for (const host of ["claude", "codex"]) {
    const cwd = lane(t);
    let out = "", err = "";
    const streams = { stdout: { write: (c) => void (out += c) }, stderr: { write: (c) => void (err += c) }, cwd: () => cwd };
    assert.equal(runCli(["install-skills", "--host", host, "--scope", "project"], streams), 0, err);
    const target = join(cwd, `.${host}`, "skills", "architect");
    assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8"));
    assert.equal(readFileSync(join(target, "scripts", "check-mmd.mjs"), "utf8"), readFileSync(CHECK, "utf8"));
    assert.ok(JSON.parse(out).installed.some((f) => f.endsWith(join("architect", "SKILL.md"))));
  }
});

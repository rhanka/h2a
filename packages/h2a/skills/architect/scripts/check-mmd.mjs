#!/usr/bin/env node
// check-mmd.mjs: gate of the architect skill for one engram.archi-mermaid/1 file (profile archi@1).
// Node built-ins only. engram is resolved at run time and never vendored. See ../SKILL.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGRAM = "@sentropic/engram";
const USAGE = `usage:
  node check-mmd.mjs <file.mmd> [--json] [--write] [--engram auto|cli|lib] [--engram-dist <dir>]
  node check-mmd.mjs --print-head --document <id> --owning-repo <e_repo_id> [--language en|fr] [--legend] [--engram-dist <dir>]
exit: 0 pass, 1 diagnostics, 2 usage or I/O error, 3 engram not available`;
const INSTALL_HINT = `engram not found. Either install the h2a plugin with its dependencies (it ships ${ENGRAM}),
or build engram and pass its dist: git clone https://github.com/rhanka/engram && cd engram && npm ci
&& npm --prefix engram-memory run build && npm run build:server, then --engram-dist <engram>/dist (or ENGRAM_DIST=<engram>/dist).`;
const STAGES = ["forbidden", "parse", "canonical", "stage1", "pins", "semantic", "profile"];

function parseArgs(argv) {
  const o = { engram: "auto", language: "en", json: false, write: false, legend: false, printHead: false, file: undefined };
  const takes = { "--engram": "engram", "--engram-dist": "engramDist", "--document": "document", "--owning-repo": "owningRepo", "--language": "language" };
  const flags = { "--json": "json", "--write": "write", "--legend": "legend", "--print-head": "printHead" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takes[a]) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      o[takes[a]] = argv[++i];
    } else if (flags[a]) o[flags[a]] = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else if (o.file === undefined) o.file = a;
    else throw new Error("one file at a time");
  }
  if (!["auto", "cli", "lib"].includes(o.engram)) throw new Error("--engram must be auto, cli or lib");
  if (!["en", "fr"].includes(o.language)) throw new Error("--language must be en or fr");
  if (!o.printHead && o.file === undefined) throw new Error("missing <file.mmd>");
  return o;
}

// ---------- engram resolution ----------
function packageDir(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const pkg = join(dir, "node_modules", "@sentropic", "engram");
    if (existsSync(join(pkg, "package.json"))) return pkg;
    if (dirname(dir) === dir) return undefined;
  }
}

function globalPackageDirs() {
  const r = spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 20000 });
  const root = r.status === 0 ? r.stdout.trim() : "";
  if (!root) return [];
  return [join(root, "@sentropic", "h2a", "node_modules", "@sentropic", "engram"), join(root, "@sentropic", "engram")]
    .filter((dir) => existsSync(join(dir, "package.json")));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function fromPackage(pkg, via) {
  const meta = readJson(join(pkg, "package.json")) ?? {};
  const entry = (sub, file) => join(pkg, meta.exports?.[sub]?.import ?? `./dist/${file}`);
  return { mermaid: entry("./archi-mermaid", "archi-mermaid.js"), archi: entry("./archi", "archi.js"), via, version: meta.version };
}

async function loadLib(distOption) {
  const candidates = [];
  const dist = distOption ?? process.env.ENGRAM_DIST;
  if (dist) {
    const meta = readJson(join(resolve(dist), "..", "package.json"));
    candidates.push({ mermaid: join(resolve(dist), "archi-mermaid.js"), archi: join(resolve(dist), "archi.js"),
      via: `engram dist ${resolve(dist)}`, version: meta?.name === ENGRAM ? meta.version : undefined });
  } else {
    for (const [start, via] of [[HERE, "h2a plugin dependency"], [process.cwd(), "current directory"]]) {
      const pkg = packageDir(start);
      if (pkg) candidates.push(fromPackage(pkg, `${via} ${pkg}`));
    }
    if (candidates.length === 0) for (const pkg of globalPackageDirs()) candidates.push(fromPackage(pkg, `global ${pkg}`));
  }
  const tried = [];
  for (const c of candidates) {
    if (!existsSync(c.mermaid) || !existsSync(c.archi)) { tried.push(`${c.via}: no archi-mermaid.js or archi.js`); continue; }
    let m, a;
    try { [m, a] = await Promise.all([import(pathToFileURL(c.mermaid).href), import(pathToFileURL(c.archi).href)]); } catch (e) {
      tried.push(`${c.via}: ${e.message}`);
      continue;
    }
    const needed = [m.parseArchiMermaid, m.formatArchiMermaid, a.checkArchi, a.checkArchiSourceTriple, a.ARCHI_V1, a.GENERIC_V2];
    if (needed.some((x) => x === undefined)) { tried.push(`${c.via}: missing archi exports`); continue; }
    return { m, a, label: `${ENGRAM}${c.version ? `@${c.version}` : ""} (${c.via})`, tried };
  }
  return { tried };
}

function detectCli() {
  const help = spawnSync("engram", ["archi", "--help"], { encoding: "utf8", timeout: 20000 });
  if (help.error || help.status !== 0 || !/\bcheck\b/.test(help.stdout) || !/\bfmt\b/.test(help.stdout)) return undefined;
  const v = spawnSync("engram", ["--version"], { encoding: "utf8", timeout: 20000 });
  return { label: `engram CLI ${(v.stdout ?? "").trim() || "(version unknown)"}` };
}

function runCli(args) {
  return spawnSync("engram", ["archi", ...args], { encoding: "utf8", timeout: 120000 });
}

// ---------- diagnostics ----------
const own = (code, message, path = "", subjectRef = "") => ({ origin: "h2a-architect", severity: "error", code, message, path, subjectRef });
const lineOf = (d) => { const m = /^\/(\d+)$/.exec(d.path ?? ""); return m ? Number(m[1]) + 1 : undefined; };

// ---------- stage: forbidden (raw text, runs even when the file does not parse) ----------
const LIFECYCLE_CLASSDEF = "classDef dashed stroke-dasharray: 5 5";
const LIFECYCLE_CLASS = /^class e_[a-z][a-z0-9_]*(,e_[a-z][a-z0-9_]*)* dashed$/;
const GEOMETRY = /\b(x|y|w|h|width|height|left|top|right|bottom|pos|position|cardGapX|cardGapY|zoneGapX|zoneGapY|rankGap|gapAfter|nodeSpacing|rankSpacing|padding|diagramPadding|density)\s*[:=]\s*-?\d/i;

function forbiddenTokens(text, file) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    const bare = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const hit = (token, why) => out.push(own("architect-forbidden-token", `${token}: ${why}`, `/${i}`, file));
    if (i === 0 && line === "---") hit("front matter", "Mermaid configuration is never authored; the file starts with `flowchart LR`");
    if (bare.includes("%%{")) hit("init directive", "Mermaid configuration is never authored");
    if (/^%%\s*@dl\s+gap(\s|$)/.test(line)) hit("@dl gap", "spacing overrides are refused by the design system (ds-layout-hints@1)");
    if (/^%%\s*@dl\s+group\s/.test(line) && /\sgap-after(\s|$)/.test(bare)) hit("gap-after", "spacing overrides are refused by the design system (ds-layout-hints@1)");
    if (/^style(\s|$)/.test(line)) hit("style", "styles are presentation; the design system renders");
    if (/^linkStyle(\s|$)/.test(line)) hit("linkStyle", "styles are presentation; the design system renders");
    if (/^classDef(\s|$)/.test(line) && line !== LIFECYCLE_CLASSDEF) hit("classDef", "only the printer's lifecycle class is allowed");
    if (/^class(\s|$)/.test(line) && !LIFECYCLE_CLASS.test(line)) hit("class", "only the printer's lifecycle class is allowed");
    if (bare.includes(":::")) hit(":::", "styles are presentation; the design system renders");
    if (GEOMETRY.test(bare)) hit("coordinate", "geometry (positions, sizes, gaps) is never authored");
  });
  return out;
}

// ---------- stage: canonical ----------
function canonical(m, text, file) {
  const f = m.formatArchiMermaid(text, { subjectRef: file });
  if (!f.ok) return f.diagnostics;
  const again = m.formatArchiMermaid(f.value, { subjectRef: file });
  if (!again.ok || again.value !== f.value) return [own("architect-format-unstable", "formatting the canonical form changed it again", "", file)];
  if (f.value === text) return [];
  const a = text.split("\n"), b = f.value.split("\n");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [own("architect-noncanonical", `not in canonical form from this line (expected ${JSON.stringify(b[i] ?? "<end of file>")}); run with --write`, `/${i}`, file)];
}

// ---------- stage: pins (mirror of engram ingestion stage 2) ----------
const pinOf = (profile) => ({ id: profile.declaration.name, version: `${profile.declaration.version}.0.0`, contentDigest: profile.contentDigest });

function governedPins(a) {
  return { profiles: new Map([[a.ARCHI_V1_PIN.id, a.ARCHI_V1_PIN], ["generic", pinOf(a.GENERIC_V2)]]), cards: a.ARCHI_CARDS_PIN, viewSchema: a.VIEW_SCHEMA_V2_PIN };
}

function pins(a, triple) {
  const { manifest, document, views } = triple;
  const gov = governedPins(a);
  const out = [];
  const same = (p, g, path, what) => {
    if (!p) out.push(own("archi-pin-mismatch", `${what} is missing`, path));
    else if (p.id !== g.id || p.version !== g.version) out.push(own("incompatible_version", `${what} ${p.id}@${p.version} is not ${g.id}@${g.version}`, path));
    else if (p.contentDigest !== g.contentDigest) out.push(own("digest-mismatch", `${what} ${p.id}@${p.version} digest is not the governed one`, path));
  };
  manifest.profilePins.forEach((p, i) => {
    const g = gov.profiles.get(p.id);
    if (!g) out.push(own("incompatible_version", `profile pin ${p.id}@${p.version} is not governed`, `/profilePins/${i}`));
    else same(p, g, `/profilePins/${i}`, "profile pin");
  });
  same(manifest.cardsPin, gov.cards, "/cardsPin", "cards pin");
  same(manifest.viewSchemaPin, gov.viewSchema, "/viewSchemaPin", "view-schema pin");
  const refs = manifest.profilePins.map((p) => `${p.id}@${p.version.split(".")[0]}`);
  if (refs[0] !== "archi@1" || refs.join(",") !== document.profileRefs.join(",")) {
    out.push(own("archi-pin-mismatch", "profile pins must equal the profile lines, in order, archi@1 first", "/profilePins"));
  }
  const usesGeneric = [...Object.values(document.entities), ...Object.values(document.relations)].some((r) => r.profile === "generic@2")
    || views.some((v) => v.legend !== undefined);
  if (usesGeneric && !refs.includes("generic@2")) out.push(own("archi-pin-mismatch", "legend records need `profile generic@2` and its pin", "/profilePins"));
  return out;
}

// ---------- stage: profile (archi@1 and generic@2 declarations exported by engram) ----------
function profile(a, document) {
  const decls = new Map([a.ARCHI_V1.declaration, a.GENERIC_V2.declaration].map((d) => [d.id, d]));
  const out = [];
  const val = (rec, k) => rec.attributes?.[k];
  const checkAttrs = (rec, declared, path) => {
    for (const d of declared) {
      const v = val(rec, d.name);
      if (v === undefined) { if (d.required) out.push(own("architect-profile-required", `${rec.type} ${rec.id} lacks required ${d.name}`, path, rec.id)); continue; }
      const items = d.kind === "collection" ? (v.items ?? []).map((x) => x.value) : [v.value];
      if (d.kind === "collection" && ((d.minItems !== undefined && items.length < d.minItems) || (d.maxItems !== undefined && items.length > d.maxItems))) {
        out.push(own("architect-profile-items", `${rec.id} ${d.name} has ${items.length} items (allowed ${d.minItems ?? 0}..${d.maxItems ?? "any"})`, path, rec.id));
      }
      const rule = d.kind === "collection" ? d.item ?? {} : d;
      for (const s of items) {
        if (typeof s !== "string") continue;
        if (d.values && !d.values.includes(s)) out.push(own("architect-profile-enum", `${rec.id} ${d.name} "${s}" is not one of ${d.values.join("|")}`, path, rec.id));
        if (rule.maxLength !== undefined && s.length > rule.maxLength) out.push(own("architect-profile-length", `${rec.id} ${d.name} has ${s.length} characters (max ${rule.maxLength})`, path, rec.id));
        if (rule.minLength !== undefined && s.length < rule.minLength) out.push(own("architect-profile-length", `${rec.id} ${d.name} is shorter than ${rule.minLength}`, path, rec.id));
        if (rule.pattern && !new RegExp(rule.pattern).test(s)) out.push(own("architect-profile-pattern", `${rec.id} ${d.name} "${s}" does not match ${rule.pattern}`, path, rec.id));
      }
    }
  };
  const typeOf = (id) => document.entities[id]?.type;
  for (const e of Object.values(document.entities)) {
    const et = decls.get(e.profile)?.entityTypes.find((t) => t.id === e.type);
    if (!et) { out.push(own("architect-profile-type", `${e.id} has undeclared type ${e.profile}/${e.type}`, `/entities/${e.id}`, e.id)); continue; }
    checkAttrs(e, et.attributes, `/entities/${e.id}`);
  }
  const parents = new Map();
  for (const r of Object.values(document.relations)) {
    const decl = decls.get(r.profile);
    const rt = decl?.relationTypes.find((t) => t.id === r.type);
    const path = `/relations/${r.id}`;
    if (!rt) { out.push(own("architect-profile-type", `${r.id} has undeclared type ${r.profile}/${r.type}`, path, r.id)); continue; }
    checkAttrs(r, rt.attributes ?? [], path);
    const ends = Object.fromEntries(r.endpoints.map((ep) => [ep.role, ep.target]));
    const matrix = decl.constraints.find((c) => c.kind === "relationship-matrix");
    if (matrix) {
      if (!matrix.tuples.some((t) => t.relationType === r.type && t.sourceType === typeOf(ends.source) && t.targetType === typeOf(ends.target))) {
        out.push(own("architect-profile-matrix", `${r.id} ${r.type} ${typeOf(ends.source)} -> ${typeOf(ends.target)} is not in the ${decl.id} relationship matrix`, path, r.id));
      }
    } else {
      for (const role of rt.roles) {
        const t = typeOf(ends[role.role]);
        if (role.entityTypes && !role.entityTypes.includes(t)) out.push(own("architect-profile-matrix", `${r.id} ${r.type}: ${role.role} ${ends[role.role]} is a ${t}, expected ${role.entityTypes.join("|")}`, path, r.id));
      }
    }
    if (rt.hierarchy) {
      const child = ends[rt.hierarchy.childRole], parent = ends[rt.hierarchy.parentRole], key = `${rt.hierarchy.id} ${child}`;
      if (parents.has(key)) out.push(own("architect-profile-tree", `${child} has two ${rt.hierarchy.id} parents`, path, r.id));
      else parents.set(key, parent);
    }
  }
  for (const decl of decls.values()) {
    for (const c of decl.constraints) {
      if (c.kind === "required-parent") {
        for (const e of Object.values(document.entities)) {
          if (e.profile !== decl.id || !c.childTypes.includes(e.type)) continue;
          const p = parents.get(`${c.hierarchyId} ${e.id}`);
          if (!p || !c.parentFamilyRoots.includes(typeOf(p))) out.push(own("architect-profile-parent", `${e.type} ${e.id} needs a ${c.parentFamilyRoots.join("|")} parent (${c.hierarchyId})`, `/entities/${e.id}`, e.id));
        }
      } else if (c.kind === "acyclic-hierarchy") {
        for (const e of Object.keys(document.entities)) {
          const seen = new Set();
          for (let x = e; x !== undefined; x = parents.get(`${c.hierarchyId} ${x}`)) {
            if (seen.has(x)) { out.push(own("architect-profile-tree", `cycle in ${c.hierarchyId} through ${e}`, `/entities/${e}`, e)); break; }
            seen.add(x);
          }
        }
      }
    }
  }
  return out;
}

// ---------- orchestration ----------
async function check(o) {
  const file = resolve(o.file);
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { return { exit: 2, error: `cannot read ${o.file}: ${e.message}` }; }
  const cli = o.engram === "lib" ? undefined : detectCli();
  if (o.engram === "cli" && !cli) return { exit: 3, error: "engram CLI with `engram archi check` and `engram archi fmt` not found on PATH" };
  const lib = o.engram === "cli" ? { tried: ["not used (--engram cli)"] } : await loadLib(o.engramDist);
  if (!cli && !lib.m) return { exit: 3, error: `${INSTALL_HINT}\ntried: ${lib.tried.join("; ") || "nothing found"}` };
  const before = text;
  if (o.write) {
    if (cli) runCli(["fmt", file, "--write"]);
    else { const f = lib.m.formatArchiMermaid(text, { subjectRef: o.file }); if (f.ok && f.value !== text) writeFileSync(file, f.value); }
    text = readFileSync(file, "utf8");
  }
  const stages = new Map(STAGES.map((s) => [s, { status: "not-run", reason: "", diagnostics: [] }]));
  const put = (name, diagnostics) => stages.set(name, { status: diagnostics.length ? "fail" : "pass", reason: "", diagnostics });
  const skip = (reason) => { for (const [name, s] of stages) if (s.status === "not-run") stages.set(name, { ...s, reason }); };
  put("forbidden", forbiddenTokens(text, o.file));
  const parsed = lib.m?.parseArchiMermaid(text, { subjectRef: o.file });
  if (cli) {
    const c = runCli(["check", file, "--json"]);
    let res;
    try { res = JSON.parse(c.stdout); } catch { return { exit: 2, error: `engram archi check gave no JSON (exit ${c.status}): ${(c.stderr ?? "").trim()}` }; }
    const diags = (res.diagnostics ?? []).filter((d) => d.code !== "archi-gap-forbidden");
    const strict = (d) => String(d.code).startsWith("mermaid-strict-");
    put("parse", diags.filter(strict));
    if (!diags.some(strict)) {
      put("semantic", diags.filter((d) => !strict(d)));
      const f = runCli(["fmt", file, "--check"]);
      put("canonical", f.status === 0 ? [] : [own("architect-noncanonical", `engram archi fmt ${o.file} --check: ${(f.stdout + f.stderr).trim()}; run with --write`, "", o.file)]);
    }
  } else {
    put("parse", parsed.ok ? [] : parsed.diagnostics);
    if (parsed.ok) {
      put("canonical", canonical(lib.m, text, o.file));
      put("semantic", lib.a.checkArchi(parsed.value.document, { labels: lib.a.ARCHI_CARDS_CONTENT.labels }, parsed.value.manifest.language));
    }
  }
  if (stages.get("parse").status === "fail") skip("parse failed");
  else if (!lib.m) skip(`engram library not used (${lib.tried.join("; ") || "nothing found"})`);
  else if (!parsed.ok) put("stage1", [own("architect-engine-skew", `the engram CLI accepts the file but ${lib.label} refuses it: ${parsed.diagnostics[0].message}`, "", o.file)]);
  else {
    put("stage1", lib.a.checkArchiSourceTriple(parsed.value));
    put("pins", pins(lib.a, parsed.value));
    put("profile", profile(lib.a, parsed.value.document));
  }
  const written = text !== before;
  const list = [...stages].map(([name, s]) => ({ name, ...s }));
  const failed = list.some((s) => s.status === "fail");
  return {
    exit: failed ? 1 : 0, file: o.file, ok: !failed, written,
    complete: list.every((s) => s.status !== "not-run"),
    engine: { cli: cli?.label ?? null, lib: lib.label ?? null },
    stages: list,
  };
}

function printHead(lib, o) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(o.document ?? "")) throw new Error("--document must match ^[a-z][a-z0-9-]{0,39}$");
  if (!/^e_[a-z][a-z0-9_]{0,39}$/.test(o.owningRepo ?? "")) throw new Error("--owning-repo must be the EID of a repo entity (e_...)");
  const gov = governedPins(lib.a);
  const profiles = o.legend ? ["archi", "generic"] : ["archi"];
  const pin = (p) => `${p.id} ${p.version} ${p.contentDigest}`;
  return ["flowchart LR", "%% @dl format engram.archi-mermaid/1", `%% @dl document ${o.document}`, "%% @dl schema 1.1", "%% @dl revision 0",
    `%% @dl language ${o.language}`, `%% @dl owning-repo ${o.owningRepo}`,
    ...profiles.map((id) => `%% @dl profile ${id === "archi" ? "archi@1" : "generic@2"}`),
    ...profiles.map((id) => `%% @dl pin profile ${pin(gov.profiles.get(id))}`),
    `%% @dl pin cards ${pin(gov.cards)}`, `%% @dl pin view-schema ${pin(gov.viewSchema)}`].join("\n") + "\n";
}

function report(r) {
  const lines = [];
  for (const s of r.stages) {
    for (const d of s.diagnostics) lines.push(`${r.file}:${lineOf(d) ?? (d.path || "-")} ${s.name} ${d.code} ${d.message}`);
  }
  for (const s of r.stages) lines.push(`${s.name}: ${s.status}${s.diagnostics.length ? ` (${s.diagnostics.length})` : ""}${s.reason ? ` (${s.reason})` : ""}`);
  lines.push(`engine: ${[r.engine.cli, r.engine.lib].filter(Boolean).join(" + ")}`);
  if (r.written) lines.push("written: canonical form");
  lines.push(`result: ${r.ok ? "pass" : "fail"}${r.ok && !r.complete ? " (incomplete: see not-run stages)" : ""}`);
  return lines.join("\n") + "\n";
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n${USAGE}\n`); return 2; }
  if (o.printHead) {
    const lib = await loadLib(o.engramDist);
    if (!lib.m) { process.stderr.write(`${INSTALL_HINT}\n`); return 3; }
    try { process.stdout.write(printHead(lib, o)); return 0; } catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
  }
  const r = await check(o);
  if (r.error) { process.stderr.write(`${r.error}\n`); return r.exit; }
  process.stdout.write(o.json ? `${JSON.stringify(r, null, 2)}\n` : report(r));
  return r.exit;
}

main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exitCode = 2; });

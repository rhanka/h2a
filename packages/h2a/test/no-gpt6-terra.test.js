// Negative routing guard (0.97.9, gpt-6 models): terra must STAY `gpt-5.6-terra`.
// gpt-6-terra is not available on any transport (verified 2026-09-26: HTTP 400 under a
// ChatGPT/Codex account, and its OpenAI-API availability is unverified — 404). sol and luna
// move to gpt-6 via the llm-mesh catalog (alias resolution is owned by llm-mesh, not h2a),
// but terra does not. This guard fails if any h2a path introduces the id `gpt-6-terra`.
// Catalog-level resolution of the "terra" nickname is covered by llm-mesh's own tests, not here.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", ".."); // packages/h2a/test -> repo root
const SELF = fileURLToPath(import.meta.url);
const ROOTS = ["packages", "apps"].map((d) => join(REPO_ROOT, d));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".turbo", ".tsbuild"]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|yml|yaml)$/;
const FORBIDDEN = ["gpt", "6", "terra"].join("-"); // avoid this file matching its own scan

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

test("no h2a path routes terra to gpt-6-terra (terra stays gpt-5.6-terra)", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (file === SELF) continue; // this guard names the forbidden id in its own text
      if (!TEXT_EXT.test(file)) continue;
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes(FORBIDDEN)) hits.push(file.slice(REPO_ROOT.length + 1));
    }
  }
  assert.deepEqual(
    hits,
    [],
    `Found "${FORBIDDEN}" in h2a source — terra must stay gpt-5.6-terra. ` +
      `gpt-6-terra is not available on any transport (verified 2026-09-26: HTTP 400 under Codex, ` +
      `404 on the OpenAI API). Offending file(s): ${hits.join(", ")}`
  );
});

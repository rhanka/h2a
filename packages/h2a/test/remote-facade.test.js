import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// P5: h2a délègue les verbes remote à @sentropic/h2a-runtime en LAZY (import dynamique).
const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

test("RÈGLE D'OR: @sentropic/h2a ne dépend PAS (dur) de remote-runtime/node-pty/aws-sdk", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages/h2a/package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  for (const forbidden of [
    "@sentropic/h2a-runtime",
    "node-pty",
    "@aws-sdk/client-s3",
    "aws-sdk",
    "@kubernetes/client-node"
  ]) {
    assert.ok(
      !deps.includes(forbidden),
      `h2a ne doit JAMAIS avoir ${forbidden} en dependencies (règle d'or)`
    );
  }
});

test("les verbes remote délèguent à @sentropic/h2a-runtime (lazy, monorepo)", () => {
  const res = spawnSync(process.execPath, [BIN, "workspace", "--help"], { encoding: "utf8" });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.match(out, /remote workspace/, "h2a workspace doit déléguer au runtime remote");
  assert.doesNotMatch(out, /Unknown command|Run `h2a --help`/);
});

// ①-fondation loop : RISQUE n°1 du double-consensus = leak d'import runtime hors
// de l'adapter. Le noyau pur (decision.ts) et le shell (tick.ts) ne DOIVENT jamais
// référencer @sentropic/h2a-runtime ; seul adapters.ts y touche, en lazy.
test("RÈGLE D'OR loop: decision.ts/tick.ts sans import runtime ; seul adapters.ts (lazy)", () => {
  const engineDir = join(ROOT, "packages/h2a/src/runtime/loop/engine");
  // Vrais imports (pas les mentions en commentaire) : `from "…"` ou `import("…")`.
  const staticImport = /import[^;]*from\s*["']@sentropic\/h2a-runtime["']/;
  const dynamicLiteral = /import\s*\(\s*["']@sentropic\/h2a-runtime["']\s*\)/;
  for (const f of ["decision.ts", "tick.ts", "execute.ts"]) {
    const src = readFileSync(join(engineDir, f), "utf8");
    assert.doesNotMatch(src, staticImport, `${f}: aucun import statique du runtime (functional core / imperative shell)`);
    assert.doesNotMatch(src, dynamicLiteral, `${f}: aucun import dynamique littéral du runtime`);
  }
  const adapters = readFileSync(join(engineDir, "adapters.ts"), "utf8");
  assert.match(adapters, /@sentropic\/h2a-runtime/, "adapters.ts est le seul point de contact runtime");
  assert.match(adapters, /await import\(RUNTIME_PKG\)/, "adapters.ts charge le runtime en LAZY (specifier variable)");
});

// ①-fondation loop : le registre read-only `agents` (projectRemoteAgents) est exposé
// via h2a en LAZY. On teste par --help (aucun IO tmux/jobs) pour rester CI-robuste.
test("h2a agents délègue au registre read-only du runtime", () => {
  const res = spawnSync(process.execPath, [BIN, "agents", "--help"], { encoding: "utf8" });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.match(
    out,
    /Project remote-visible agents|read-only/,
    "h2a agents doit déléguer au registre agents du runtime"
  );
  assert.doesNotMatch(out, /Unknown command|Run `h2a --help`/);
});

// Parité ② : un verbe remote NON explicitement listé (`jobs`) délègue maintenant
// au runtime via le FALLBACK (avant : "Unknown command: jobs").
test("parité: h2a <verbe remote non-natif> délègue au runtime (fallback)", () => {
  const res = spawnSync(process.execPath, [BIN, "jobs", "--help"], { encoding: "utf8" });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.doesNotMatch(out, /Unknown command: jobs/, "jobs ne doit plus être 'Unknown command'");
  assert.match(out, /jobs|delegated|Usage|remote/i, "h2a jobs doit déléguer au runtime");
});

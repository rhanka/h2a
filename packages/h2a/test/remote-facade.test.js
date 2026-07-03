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

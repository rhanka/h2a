import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const WORKFLOW_FILE = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "no-coauthor-trailer.yml",
);

function extractSection(yml, headerRe) {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => headerRe.test(l));
  if (start === -1) return "";
  const baseIndent = lines[start].match(/^(\s*)/)[1].length;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= baseIndent) break;
    }
    out.push(line);
  }
  return out.join("\n");
}

test("no-coauthor-trailer.yml declares minimal top-level permissions and SHA-pins every third-party action with persist-credentials: false", () => {
  const yml = readFileSync(WORKFLOW_FILE, "utf8");

  // Finding 7: explicit minimal top-level permissions: contents: read, never write.
  const permsBlock = extractSection(yml, /^permissions:\s*$/);
  assert.ok(permsBlock, "workflow must declare a top-level permissions: block");
  assert.match(permsBlock, /^\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(permsBlock, /:\s*write\b/i, "workflow must never request write permissions");

  // Finding 7: every third-party action uses a full 40-char commit SHA (no floating @v4 tags).
  const usesMatches = [...yml.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)];
  assert.ok(usesMatches.length >= 4, `expected >= 4 action uses, got ${usesMatches.length}`);
  for (const m of usesMatches) {
    const ref = m[1];
    assert.match(
      ref,
      /^[^@]+@[0-9a-f]{40}$/,
      `action must be pinned to a full 40-char commit SHA, got: ${ref}`,
    );
  }

  // Finding 7: every actions/checkout step sets persist-credentials: false.
  const lines = yml.split("\n");
  let checkoutCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*uses:\s*actions\/checkout@/.test(lines[i])) {
      checkoutCount++;
      const stepIndent = lines[i].match(/^(\s*)/)[1].length;
      const stepLines = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() !== "") {
          const ind = l.match(/^(\s*)/)[1].length;
          if (ind <= stepIndent) break;
        }
        stepLines.push(l);
      }
      assert.match(
        stepLines.join("\n"),
        /persist-credentials:\s*false/,
        `actions/checkout at line ${i + 1} must set persist-credentials: false`,
      );
    }
  }
  assert.ok(checkoutCount >= 2, "expected checkout steps in both scan-commits and hook-selftest");
});

test("no-coauthor-trailer.yml always emits scan-commits, handles merge_group, supports opt-in bots & skip no-op, and avoids unsafe patterns", () => {
  const yml = readFileSync(WORKFLOW_FILE, "utf8");

  // Finding 2: scan-commits has NO job-level if: so callers can always require it.
  const scanJob = extractSection(yml, /^  scan-commits:\s*$/);
  assert.ok(scanJob, "scan-commits job must exist");
  const scanJobHeader = scanJob.split(/^\s{4}steps:\s*$/m)[0];
  assert.doesNotMatch(
    scanJobHeader,
    /^\s{4}if:/m,
    "scan-commits must not have a job-level if: that suppresses its check run",
  );
  assert.match(yml, /^\s+skip:\s*$/m, "workflow_call must declare optional skip boolean input");
  assert.match(
    scanJob,
    /if:\s*\$\{\{\s*inputs\.skip\s*==\s*true\s*\}\}/,
    "scan-commits must emit a conclusive no-op step when skip is true",
  );

  // Finding 3: opt-in allowed-bot-identities input, defaulting to empty (owner-only default).
  const botInputBlock = extractSection(yml, /^\s+allowed-bot-identities:\s*$/);
  assert.ok(botInputBlock, "workflow_call must declare allowed-bot-identities input");
  assert.match(botInputBlock, /default:\s*""/, "allowed-bot-identities must default to empty string");
  assert.match(scanJob, /ALLOWED_BOT_IDENTITIES:/);

  // Finding 4: merge_group trigger and env wiring.
  const onBlock = extractSection(yml, /^on:\s*$/);
  assert.match(onBlock, /^\s+merge_group:\s*$/m, "workflow must trigger on merge_group");
  assert.match(onBlock, /checks_requested/, "merge_group must listen to checks_requested");
  assert.match(scanJob, /MG_BASE_SHA:\s*\$\{\{\s*github\.event\.merge_group\.base_sha\s*\}\}/);
  assert.match(scanJob, /MG_HEAD_SHA:\s*\$\{\{\s*github\.event\.merge_group\.head_sha\s*\}\}/);

  // Finding 5: default branch ref passed for stacked-PR exclusion of already-landed origin/main commits.
  assert.match(
    scanJob,
    /DEFAULT_BRANCH:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/,
  );

  // Finding 6: vendored GitHub web-flow PGP public key block + TMPDIR under runner.temp (never /tmp).
  assert.match(scanJob, /-----BEGIN PGP PUBLIC KEY BLOCK-----/);
  assert.match(scanJob, /968479A1AFF927E37D1A566BB5690EEEBB952194/);
  assert.match(scanJob, /5DE3E0509C47EA3CF04A42D34AEE18F83AFDEB23/);
  assert.match(scanJob, /TMPDIR:\s*\$\{\{\s*runner\.temp\s*\}\}/);

  // Finding 7: workflow-command escaping and zero ${{ }} inside run: blocks.
  assert.match(scanJob, /function escapeGithubCommand\b/);
  const runBlockMatch = scanJob.match(/run:\s*\|\n([\s\S]*?)\n\s+EOF/);
  assert.ok(runBlockMatch, "scan-commits inline node script must exist");
  assert.doesNotMatch(
    runBlockMatch[1],
    /\$\{\{/,
    "inline script must never interpolate GitHub expressions directly in run:",
  );

  // Confinement & hygiene invariants.
  assert.doesNotMatch(yml, /\/tmp\//, "workflow must never touch /tmp");
  assert.doesNotMatch(yml, /\bpython\d*\b/i, "workflow must never invoke python");

  // Keep hook-selftest intact and running workflow-shape test too.
  const selftestJob = extractSection(yml, /^  hook-selftest:\s*$/);
  assert.ok(selftestJob, "hook-selftest job must remain intact for h2a required checks");
  assert.match(selftestJob, /packages\/h2a\/test\/trailer-guard\.test\.js/);
  assert.match(selftestJob, /packages\/h2a\/test\/no-coauthor-workflow-shape\.test\.js/);
});

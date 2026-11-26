import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

import { checkFocusArtifact } from "@sentropic/focus/artifact";
import { runCli } from "../dist/index.js";
import { parseNativeToml } from "../dist/hosts/native-toml.js";

const REPO_ROOT = new URL("../../../", import.meta.url);
const FOCUS_SKILL_URL = new URL("../../focus/skills/focus/SKILL.md", import.meta.url);
const PRESENT_DECISION_DIR = new URL("../../track/skills/present-decision/", import.meta.url);
const DECISION_DOSSIER_SKILL_URL = new URL("../skills/decision-dossier/SKILL.md", import.meta.url);
const CLAUDE_PLUGIN_URL = new URL("../.claude-plugin/plugin.json", import.meta.url);
const CODEX_PLUGIN_URL = new URL("../.codex-plugin/plugin.json", import.meta.url);
const PROMPTS_FIXTURE_URL = new URL("./fixtures/decision-dossier-prompts.json", import.meta.url);
const GENERATOR_SCRIPT = new URL("../../../scripts/generate-plugin-declarations.mjs", import.meta.url).pathname;

const START_MARKER = "<!-- FOCUS-WRITING-START -->";
const END_MARKER = "<!-- FOCUS-WRITING-END -->";

const FORBIDDEN_WRITING_PATTERNS = [
  /\bh2a\b/i,
  /\bh2a_focus_\w+/i,
  /\bfocus\s+(?:template|check|build|publish|get|status|serve|feedback)\b/i,
  /\btrack\s+decision\b/i,
  /\bartifacts_\w+\b/i,
  /\bnode\s+packages\//i,
  /\bsentropic\.h2a\b/i
];

function extractBoundedWritingBlock(markdown, label) {
  const start = markdown.indexOf(START_MARKER);
  assert.notEqual(start, -1, `${label}: missing ${START_MARKER}`);
  assert.equal(
    markdown.indexOf(START_MARKER, start + START_MARKER.length),
    -1,
    `${label}: duplicate ${START_MARKER}`
  );
  const end = markdown.indexOf(END_MARKER);
  assert.notEqual(end, -1, `${label}: missing ${END_MARKER}`);
  assert.equal(
    markdown.indexOf(END_MARKER, end + END_MARKER.length),
    -1,
    `${label}: duplicate ${END_MARKER}`
  );
  assert.ok(end > start, `${label}: ${END_MARKER} must follow ${START_MARKER}`);
  return markdown.slice(start + START_MARKER.length, end);
}

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

test("focus/SKILL.md delimits a neutral writing block with FOCUS-WRITING-START/FOCUS-WRITING-END while naive full extraction fails neutrality", () => {
  const focusSkill = readFileSync(FOCUS_SKILL_URL, "utf8");

  // Proof that naive extraction of focus/SKILL.md leaks CLI commands / h2a references.
  assert.ok(
    FORBIDDEN_WRITING_PATTERNS.some((pattern) => pattern.test(focusSkill)),
    "naive full extraction of focus/SKILL.md must fail neutrality (outside the bounded block)"
  );

  const writingBlock = extractBoundedWritingBlock(focusSkill, "packages/focus/skills/focus/SKILL.md");
  assert.ok(writingBlock.trim().length > 200, "writing block must carry the full writing rules");
  assert.match(writingBlock, /ownerRequestQuote/);
  assert.match(writingBlock, /stakesLevel/);
  assert.match(writingBlock, /readingBudgetMinutes/);
  assert.match(writingBlock, /anti-wall-of-text/);
  assert.match(writingBlock, /diagramResolver/);

  for (const pattern of FORBIDDEN_WRITING_PATTERNS) {
    assert.doesNotMatch(
      writingBlock,
      pattern,
      `bounded writing block in focus/SKILL.md must be tool/command-neutral (matched ${pattern})`
    );
  }
});

test("decision-dossier SKILL.md exists, embeds the Écrire block byte-for-byte, keeps Quand as a pointer, and stays MCP-only in Faire", () => {
  assert.equal(existsSync(DECISION_DOSSIER_SKILL_URL), true, "packages/h2a/skills/decision-dossier/SKILL.md must exist");
  const focusSkill = readFileSync(FOCUS_SKILL_URL, "utf8");
  const dossierSkill = readFileSync(DECISION_DOSSIER_SKILL_URL, "utf8");

  assert.match(dossierSkill, /^---\r?\n[\s\S]*?^name:\s*decision-dossier\s*$[\s\S]*?^description:\s*\S+[\s\S]*?\r?\n---/m);

  // Byte-exact Écrire block imported from focus/SKILL.md.
  const sourceBlock = extractBoundedWritingBlock(focusSkill, "packages/focus/skills/focus/SKILL.md");
  const copiedBlock = extractBoundedWritingBlock(dossierSkill, "packages/h2a/skills/decision-dossier/SKILL.md");
  assert.equal(
    Buffer.compare(Buffer.from(sourceBlock, "utf8"), Buffer.from(copiedBlock, "utf8")),
    0,
    "decision-dossier Écrire block must be byte-identical to focus/SKILL.md writing block"
  );
  for (const pattern of FORBIDDEN_WRITING_PATTERNS) {
    assert.doesNotMatch(copiedBlock, pattern, `copied Écrire block must stay neutral (matched ${pattern})`);
  }

  // Quand section: pointer to present-decision without copying its criteria table or full checklist.
  assert.match(dossierSkill, /present-decision/);
  assert.match(dossierSkill, /decide-and-trace|decide \+ trace|décision tracée/i);
  assert.match(dossierSkill, /quick ask|question rapide/i);
  assert.doesNotMatch(dossierSkill, /\|\s*Owner criterion\s*\|\s*Request\/source\s*\|/);

  // Faire section: MCP tools only, covering full lifecycle + Step 4 safety rules.
  const afterWriting = dossierSkill.slice(dossierSkill.indexOf(END_MARKER) + END_MARKER.length);
  for (const requiredTool of [
    /h2a_focus_template/,
    /h2a_focus_check/,
    /h2a_focus_build/,
    /h2a_focus_submit_build/,
    /h2a_focus_build_result/,
    /h2a_focus_get/,
    /h2a_focus_status/,
    /artifact_comments_/,
    /h2a_send/
  ]) {
    assert.match(afterWriting, requiredTool, `Faire section must reference MCP tool ${requiredTool}`);
  }
  assert.doesNotMatch(afterWriting, /\bh2a_focus_publish\b/, "Faire section must not reference non-existent h2a_focus_publish tool");

  // No shell CLI invocations for h2a focus in Faire.
  assert.doesNotMatch(afterWriting, /\bnode\s+packages\/h2a\/dist\/bin\.js\b/);
  assert.doesNotMatch(afterWriting, /\bh2a\s+focus\s+(?:template|check|build|publish|get|status|serve|feedback)\b/);

  // Single Track writer handoff + response line boundary.
  assert.match(afterWriting, /Track/i);
  assert.match(afterWriting, /response line|ligne de réponse/i);
  assert.match(afterWriting, /never records?|ne vaut jamais|does not record/i);

  // Step 4 safety rules: announce federation/space, keep restricted, no automatic publish on time-series render.
  assert.match(afterWriting, /federation/i);
  assert.match(afterWriting, /space|workspace/i);
  assert.match(afterWriting, /restricted/);
  assert.match(afterWriting, /time-series|temporal|temporel/i);
  assert.match(afterWriting, /never auto|no automatic|aucun envoi automatique|do not automatically/i);

  // Generator check must pass byte-identically.
  execFileSync(process.execPath, [GENERATOR_SCRIPT, "--check"], {
    cwd: REPO_ROOT.pathname,
    stdio: "pipe"
  });
});

test("present-decision removes h2a tools while preserving the Q8 criteria table and response-line boundary", () => {
  const files = ["SKILL.md", "assets/dossier-template.md", "assets/self-audit.md"];
  for (const rel of files) {
    const content = readFileSync(new URL(rel, PRESENT_DECISION_DIR), "utf8");
    assert.doesNotMatch(content, /\bh2a_focus_\w+/, `present-decision/${rel} must not name h2a focus MCP tools`);
    assert.doesNotMatch(content, /\bh2a\s+focus\b/, `present-decision/${rel} must not name h2a focus CLI commands`);
  }

  const skill = readFileSync(new URL("SKILL.md", PRESENT_DECISION_DIR), "utf8");
  assert.match(skill, /assets\/owner-criteria\.template\.md/);
  assert.match(skill, /never a claude\.ai artifact/i);
  assert.match(skill, /bound[- ]surface|surface liée/i);
  assert.match(skill, /standalone|autonome/i);
  assert.match(skill, /response line|ligne de réponse/i);
  assert.match(skill, /never record approval|never records? (?:a )?decision/i);

  const criteria = readFileSync(new URL("assets/owner-criteria.template.md", PRESENT_DECISION_DIR), "utf8");
  assert.match(criteria, /\|\s*Owner criterion\s*\|\s*Request\/source\s*\|\s*Addressed by\s*\|\s*Gap or departure\s*\|/);
});

test("templates and skill texts never impose En bref, In short or En mots simples", () => {
  const banned = /En bref|In short|En mots simples/;
  for (const url of [
    new URL("../focus-kit/dossier.template.json", import.meta.url),
    new URL("../focus-kit/dossier.evidence.template.json", import.meta.url),
  ]) {
    assert.doesNotMatch(readFileSync(url, "utf8"), banned, `${url.pathname} must not impose a takeaway label`);
  }
  const skillTexts = [FOCUS_SKILL_URL, DECISION_DOSSIER_SKILL_URL];
  for (const rel of ["SKILL.md", "assets/dossier-template.md", "assets/self-audit.md", "assets/native-questions.md", "assets/owner-gates.md", "assets/owner-criteria.template.md"]) {
    skillTexts.push(new URL(rel, PRESENT_DECISION_DIR));
  }
  for (const url of skillTexts) {
    assert.doesNotMatch(readFileSync(url, "utf8"), banned, `${url.pathname} must never generate a takeaway label`);
  }
});

test("present-decision never pins a diagram variant to a page width", () => {
  // Variant selection is measured per diagram (focus-kit/src/diagram-fit.js):
  // "wide near 800" contradicts it and turns the 800 px self-audit check into a false failure.
  for (const rel of ["SKILL.md", "assets/dossier-template.md", "assets/self-audit.md"]) {
    const url = new URL(rel, PRESENT_DECISION_DIR);
    assert.doesNotMatch(readFileSync(url, "utf8"), /wide near 800/, `${url.pathname} must not pin a variant to a page width`);
  }
});

test("decision-dossier skill is declared by plugin manifests and installable across hosts", () => {
  const claudeManifest = JSON.parse(readFileSync(CLAUDE_PLUGIN_URL, "utf8"));
  const codexManifest = JSON.parse(readFileSync(CODEX_PLUGIN_URL, "utf8"));
  assert.equal(claudeManifest.skills, "./skills/");
  assert.equal(codexManifest.skills, "./skills/");

  const focusWriting = extractBoundedWritingBlock(readFileSync(FOCUS_SKILL_URL, "utf8"), "focus/SKILL.md");

  for (const host of ["claude", "codex", "gemini", "agy", "muse", "vibe"]) {
    const cwd = mkdtempSync(join(tmpdir(), `h2a-decision-dossier-${host}-`));
    try {
      const streams = captureStreams(cwd);
      const rc = runCli(["install-skills", "--host", host, "--scope", "project"], streams);
      assert.equal(rc, 0, `${host}: ${streams.stderrText}`);
      const report = JSON.parse(streams.stdoutText);
      const h2aSource = report.sources.find((s) => s.source === "h2a");
      assert.ok(
        h2aSource?.skills?.some((s) => s.name === "decision-dossier"),
        `${host}: decision-dossier must be reported under h2a source`
      );
      const isToml = host === "gemini" || host === "agy";
      const installedPath = report.installed.find((p) =>
        isToml ? p.endsWith(`${sep}decision-dossier.toml`) : p.endsWith(`${sep}decision-dossier${sep}SKILL.md`)
      );
      assert.ok(installedPath, `${host}: expected decision-dossier installed artifact`);
      const raw = readFileSync(installedPath, "utf8");
      const content = isToml ? parseNativeToml(raw).prompt : raw;
      assert.equal(
        Buffer.compare(
          Buffer.from(extractBoundedWritingBlock(content, `${host} installed decision-dossier`), "utf8"),
          Buffer.from(focusWriting, "utf8")
        ),
        0,
        `${host}: installed decision-dossier must preserve byte-exact writing block`
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test("frozen 20-prompt evaluation corpus covers decision/report/evidence/diagram and HTML rendering alone never establishes gate validity", () => {
  assert.equal(existsSync(PROMPTS_FIXTURE_URL), true, "test/fixtures/decision-dossier-prompts.json must exist");
  const corpus = JSON.parse(readFileSync(PROMPTS_FIXTURE_URL, "utf8"));
  assert.equal(corpus.schemaVersion, 1);
  assert.ok(Array.isArray(corpus.prompts), "corpus.prompts must be an array");
  assert.equal(corpus.prompts.length, 20, "corpus must contain exactly 20 frozen prompts");

  const ids = new Set();
  const categories = new Map();
  for (const item of corpus.prompts) {
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0 && !ids.has(item.id), `duplicate or empty prompt id: ${item.id}`);
    ids.add(item.id);
    assert.ok(["decision", "report", "evidence", "diagram"].includes(item.category), `unexpected category: ${item.category}`);
    categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
    assert.ok(["fr", "en"].includes(item.locale), `unexpected locale: ${item.locale}`);
    assert.ok(["decision", "report"].includes(item.expectedDocumentType), `unexpected documentType: ${item.expectedDocumentType}`);
    assert.equal(typeof item.prompt, "string");
    assert.ok(item.prompt.trim().length >= 30, `prompt ${item.id} is too short`);
  }

  for (const requiredCategory of ["decision", "report", "evidence", "diagram"]) {
    assert.ok((categories.get(requiredCategory) ?? 0) >= 4, `category ${requiredCategory} must be well represented`);
  }

  // Gate authority proof: HTML output alone is never validity; invalid JSON fails checkFocusArtifact.
  const invalidDoc = {
    ref: "collision-id",
    subject: "Invalid sample",
    title: "Invalid sample — gate must refuse",
    hash: "draft:1",
    cursor: "draft:1",
    readability: {
      ownerRequestQuote: "Check that the gate rejects collisions.",
      stakes: "Avoid accepting broken anchors.",
      stakesLevel: "low",
      readingBudgetMinutes: 2
    },
    sections: [
      { kind: "prose", id: "collision-id", targetRef: "collision-id", markdown: "En bref : Collision sur doc.ref." }
    ],
    interactions: [],
    provenance: { source: "test:gate", readAt: "2026-11-21T00:00:00Z" },
    amendmentTrace: []
  };
  const gateVerdict = checkFocusArtifact(invalidDoc);
  assert.equal(gateVerdict.ok, false, "invalid dossier must be refused by checkFocusArtifact");
  assert.ok(
    gateVerdict.issues.some((i) => i.code === "focus-anchor-equals-document-ref"),
    "gate must report structured R6 refusal"
  );
});

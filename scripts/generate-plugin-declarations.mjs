#!/usr/bin/env node
/**
 * Interim h2a-owned plugin declaration renderer (LOT-4B, RQ-16): emits the
 * generated host assets referenced by the shipped plugin manifests,
 * `packages/h2a/.claude-plugin/registry.mcp.json` and
 * `packages/h2a/.codex-plugin/registry.mcp.json`.
 *
 * Single source of truth: the bridge command shape comes from the built
 * `renderBridgeEntry` (same function the file-mechanism installer uses) —
 * one rendering path, not two. The declared executable is the interim
 * `h2a registry-bridge` (RQ-16); the final `sentropic-registry` executable
 * stays R7a. Generated files are never hand-edited: with `--check`, verifies
 * the committed files are byte-identical instead of writing (same discipline
 * as `generate-registry-entries.mjs --check`). `--host <claude|codex>`
 * renders a single host; any other host is refused before any write.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const hostFlag = argv.indexOf("--host");
const ONLY_HOST = hostFlag === -1 ? null : argv[hostFlag + 1];

const HOSTS = ["claude", "codex"];
if (ONLY_HOST !== null && !HOSTS.includes(ONLY_HOST)) {
  console.error(`generate-plugin-declarations: unsupported_host: unknown plugin host ${JSON.stringify(ONLY_HOST)}: expected one of ${HOSTS.join(", ")}`);
  process.exit(2);
}

const FOCUS_WRITING_START = "<!-- FOCUS-WRITING-START -->";
const FOCUS_WRITING_END = "<!-- FOCUS-WRITING-END -->";

function extractFocusWritingBlock(markdown, label) {
  const start = markdown.indexOf(FOCUS_WRITING_START);
  const end = markdown.indexOf(FOCUS_WRITING_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`${label} must contain ${FOCUS_WRITING_START} followed by ${FOCUS_WRITING_END}`);
  }
  if (markdown.indexOf(FOCUS_WRITING_START, start + FOCUS_WRITING_START.length) !== -1) {
    throw new Error(`${label} contains more than one ${FOCUS_WRITING_START} marker`);
  }
  if (markdown.indexOf(FOCUS_WRITING_END, end + FOCUS_WRITING_END.length) !== -1) {
    throw new Error(`${label} contains more than one ${FOCUS_WRITING_END} marker`);
  }
  return {
    start,
    end,
    block: markdown.slice(start + FOCUS_WRITING_START.length, end)
  };
}

function syncDecisionDossierWritingBlock() {
  const focusSkillPath = join(ROOT, "packages/focus/skills/focus/SKILL.md");
  const dossierSkillPath = join(ROOT, "packages/h2a/skills/decision-dossier/SKILL.md");
  const source = readFileSync(focusSkillPath, "utf8");
  const target = readFileSync(dossierSkillPath, "utf8");
  const { block } = extractFocusWritingBlock(source, focusSkillPath);
  const targetBounds = extractFocusWritingBlock(target, dossierSkillPath);
  const rendered =
    target.slice(0, targetBounds.start + FOCUS_WRITING_START.length) +
    block +
    target.slice(targetBounds.end);
  if (CHECK) {
    if (target !== rendered) {
      console.error(`generate-plugin-declarations: ${dossierSkillPath} writing block differs from ${focusSkillPath}; run without --check to regenerate`);
      process.exit(1);
    }
    return;
  }
  if (target !== rendered) {
    writeFileSync(dossierSkillPath, rendered);
  }
}

syncDecisionDossierWritingBlock();

const { renderBridgeEntry } = await import(join(ROOT, "packages/h2a/dist/registry/host-bootstrap.js"));

const subdir = (host) => (host === "claude" ? ".claude-plugin" : ".codex-plugin");

for (const host of ONLY_HOST === null ? HOSTS : [ONLY_HOST]) {
  const { entry } = renderBridgeEntry(host, { profile: "default" });
  // No --lock: plugin declarations carry host/profile only; the lock resolves
  // at serve time to the per-host/profile default (RQ-17). For Claude Code,
  // invoke through the plugin's self-contained Node shim via ${CLAUDE_PLUGIN_ROOT}
  // so narrowed login PATHs (missing ~/.npm-global/bin) still locate the trusted
  // h2a executable. Codex CLI does not expand ${CLAUDE_PLUGIN_ROOT} in MCP args,
  // so Codex keeps the direct h2a command (backed by ~/.local/bin/h2a from
  // bootstrap install / doctor --repair).
  const serverEntry = host === "claude"
    ? {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs", ...entry.h2a.args]
      }
    : {
        command: entry.h2a.command,
        args: entry.h2a.args
      };
  const asset = {
    mcpServers: {
      h2a: serverEntry
    }
  };
  const text = `${JSON.stringify(asset, null, 2)}\n`;
  const path = join(ROOT, "packages/h2a", subdir(host), "registry.mcp.json");
  if (CHECK) {
    const current = readFileSync(path, "utf8");
    if (current !== text) {
      console.error(`generate-plugin-declarations: ${path} differs from the renderer output; run without --check to regenerate`);
      process.exit(1);
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * SPEC 0.98.5 R9 — qualification gate for the versioned recovery runbook.
 *
 * The runbook `docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md` is
 * the net for the cases the automatic migration (R3) does not cover in
 * routine: a durably unreadable machine-id, and pre-0.98.2 rows without a
 * machine anchor. This test asserts the runbook is QUALIFIED (read and
 * verified BEFORE validation), not merely written:
 *
 *   (i)   every command is listed with its expected effect and requires NO
 *         functional host;
 *   (ii)  the pinned paths of the spec's model exist in the runbook (`.owner`
 *         sidecar, socket, lock-id, registry);
 *   (iii) the runbook documents the persistent machine-id-unreadable refusal
 *         and distinguishes the TWO outcomes: identity restored -> automatic
 *         takeover by R3; NOT restored -> the recovery is announced BLOCKED.
 *         A runbook that claims a takeover without restoring the machine
 *         identity fails here.
 *
 * Runs via `npm test` (packages/h2a/test discovery) — a red here blocks every
 * gate. No silent skip: an absent or unreadable runbook is a FAILURE.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const RUNBOOK_PATH = resolve(
  REPO_ROOT,
  "docs",
  "runbooks",
  "2026-10-11-recuperation-parc-0.98.2-0.98.4.md",
);
let SOURCE;
try {
  SOURCE = readFileSync(RUNBOOK_PATH, "utf8");
} catch (error) {
  assert.fail(`the pinned runbook must exist and be readable at ${RUNBOOK_PATH}: ${error.message}`);
}

/** Every bash-fenced command block, in document order. */
const COMMAND_BLOCKS = [...SOURCE.matchAll(/```bash\n([^\n]*)\n```/g)].map((match) => ({
  command: match[1],
  index: match.index,
}));

test("the runbook is a non-empty document with commands to qualify", () => {
  assert.ok(SOURCE.length > 500, "the runbook must be a real document, not a stub");
  assert.ok(COMMAND_BLOCKS.length >= 8, "the runbook must list its one-liner commands explicitly");
});

test("R9 (i): every command is a one-liner with a stated expected effect", () => {
  for (const block of COMMAND_BLOCKS) {
    assert.ok(
      block.command.trim().length > 0,
      "an empty fenced command is not a command",
    );
    const rest = SOURCE.slice(block.index + block.command.length);
    const effectIndex = rest.indexOf("Effet attendu :");
    assert.ok(
      effectIndex !== -1 && effectIndex < 400,
      `command \`${block.command}\` must be followed by an 'Effet attendu :' annotation within the same section`,
    );
  }
});

test("R9 (i): no command requires a functional host", () => {
  for (const block of COMMAND_BLOCKS) {
    assert.ok(
      !/^\s*h2a\b/.test(block.command) && !/(^|\s|npx\s+)h2a\s+(run|connect|register|serve|mcp-serve|start)\b/.test(block.command),
      `command \`${block.command}\` must be executable WITHOUT a functional host: no h2a CLI verb may appear in the runbook's commands`,
    );
  }
});

test("R9 (ii): the pinned paths of the spec's model appear with full names", () => {
  const pinned = [
    "$XDG_RUNTIME_DIR/h2a-nt/native-terminal.sock",
    "native-terminal.sock.owner",
    ".h2a-native-terminal.lock-id",
    "$HOME/.config/sentropic/h2a/registry.json",
    "/run/user/1000/h2a-nt",
  ];
  for (const path of pinned) {
    assert.ok(
      SOURCE.includes(path),
      `the runbook must name the exact path ${path} — a recovery procedure that does not name its files cannot be executed`,
    );
  }
});

test("R9: archive-by-rename — the runbook never deletes, only renames", () => {
  for (const block of COMMAND_BLOCKS) {
    assert.ok(
      !/\brm\b/.test(block.command),
      `command \`${block.command}\` deletes a file: the runbook pins ARCHIVING by timestamped rename, never deletion`,
    );
  }
  const archives = COMMAND_BLOCKS.filter((block) => /\bmv\b/.test(block.command));
  assert.ok(archives.length >= 2, "the runbook must contain rename (mv) commands archiving to a timestamped directory");
  assert.ok(
    SOURCE.includes("date +%Y%m%dT%H%M%S") || /h2a-recovery-\$?\{?stamp/.test(SOURCE),
    "the archive must be timestamped, so it is auditable and never overwrites a previous archive",
  );
});

test("R9 (iii): the machine-id-unreadable case documents the coded refusal and the TWO outcomes", () => {
  const phaseZero = SOURCE.slice(0, SOURCE.indexOf("## Phase 1"));
  assert.ok(phaseZero.length > 200, "the machine-id prerequisite must be Phase 0, BEFORE the safety preconditions");
  assert.ok(
    phaseZero.includes("systemd-machine-id-setup"),
    "the runbook must give the restoration command (systemd-machine-id-setup) for a durably unreadable machine-id",
  );
  assert.ok(
    phaseZero.includes("^[0-9a-f]{32}$"),
    "the runbook must pin the machine-id format regex (^[0-9a-f]{32}$, non-zero)",
  );
  assert.ok(
    /BLOQU/.test(phaseZero),
    "the runbook must announce explicitly that the recovery stays BLOCKED while the machine identity is not restored",
  );
  assert.ok(
    phaseZero.includes("reprise automatique"),
    "the restored-identity outcome must be stated: automatic takeover (R3) with no manual file manipulation",
  );
  // The two outcomes must be DISTINGUISHED, and archiving must never be
  // presented as a takeover: the refusal (R3.6) survives any rename.
  const archivePhase = SOURCE.slice(SOURCE.indexOf("## Phase 3"), SOURCE.indexOf("## Phase 4"));
  assert.ok(
    !archivePhase.includes("reprise automatique"),
    "the archive phase must NOT claim an automatic takeover: without a restored machine identity the coded refusal persists",
  );
  assert.ok(
    SOURCE.includes("l'archivage ne rétablit PAS") || SOURCE.includes("ne change RIEN à la lisibilité"),
    "the runbook must state that archiving does NOT restore machine-id readability",
  );
});

test("R9: post-recovery verification of the loaded versions is part of the runbook", () => {
  const verifyPhase = SOURCE.slice(SOURCE.indexOf("## Phase 4"));
  assert.ok(
    verifyPhase.includes("require.resolve('@sentropic/h2a-runtime/package.json')"),
    "the post-recovery verification must prove the loaded runtime PATH",
  );
  assert.ok(
    verifyPhase.includes(".version"),
    "the post-recovery verification must prove the loaded runtime VERSION",
  );
  assert.ok(
    COMMAND_BLOCKS.filter((block) => block.command.includes("require.resolve")).length >= 2,
    "the path and version proofs must be executable one-liners, not prose",
  );
});

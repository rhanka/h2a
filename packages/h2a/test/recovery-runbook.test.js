/**
 * SPEC 0.98.5 R9 — qualification gate for the versioned recovery runbook.
 *
 * The runbook `docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md` is
 * the net for the cases the automatic migration (R3) does not cover in
 * routine: a durably unreadable machine-id, pre-0.98.2 rows without a machine
 * anchor, rows of a foreign machine. This test asserts the runbook is
 * QUALIFIED (read and verified BEFORE validation), not merely written:
 *
 *   (i)   every command is listed with its expected effect and requires NO
 *         functional host;
 *   (ii)  the pinned paths of the spec's model exist in the runbook (`.owner`
 *         sidecar, socket, lock-id, registry);
 *   (iii) the runbook documents the machine-id-unreadable refusal and
 *         distinguishes the outcomes — and does so with FIXTURES: the round-2
 *         review mutated the outcomes (announcing a takeover without a
 *         restored identity) and every assertion stayed green. The outcome
 *         contract is now a pure function probed with mutated documents.
 *   (iv)  the R9 deprecation commands of the three lockstep packages are
 *         prepared (range >=0.98.1 <=0.98.4, executed only AFTER 0.98.5
 *         validation, track NOT deprecated), and the 0.98.1 defect is
 *         documented distinctly from the post-reboot brick.
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

/**
 * The Phase-0 outcome contract as a PURE function over a runbook source, so
 * the negative controls below can probe MUTATED documents and observe them go
 * red. Round-2 review finding: the old prose-level assertions (the document
 * contains "reprise automatique" somewhere and "BLOQU" somewhere) stayed green
 * when the outcomes were inverted — both words survive an inversion.
 */
function outcomeFailures(source) {
  const failures = [];
  const phaseZero = source.slice(0, source.indexOf("## Phase 1"));
  if (!phaseZero.includes("systemd-machine-id-setup")) {
    failures.push("the restoration command (systemd-machine-id-setup) is missing from Phase 0");
  }
  if (!phaseZero.includes("^[0-9a-f]{32}$")) {
    failures.push("the machine-id format regex (^[0-9a-f]{32}$, non-zero) is missing from Phase 0");
  }
  if (!/BLOQU/.test(phaseZero)) {
    failures.push("the runbook must announce explicitly that the recovery stays BLOCKED without a restored identity");
  }
  const bullets = phaseZero.split("\n").filter((line) => line.startsWith("- **Issue"));
  const restored = bullets.find((b) => b.includes("machine-id rétabli") && !b.includes("NON rétabli"));
  if (!restored) {
    failures.push("no restored-identity outcome bullet");
  } else {
    if (!/rows-attribuables/.test(restored)) {
      failures.push(
        "the automatic takeover is promised on identity restoration ALONE: R1 keeps unanchored/foreign rows foreign-frame, so the promise must be conditioned on rows attributable to the same machine",
      );
    }
    if (!restored.includes("reprise automatique")) {
      failures.push("the restored-identity outcome must state the automatic takeover (R3)");
    }
  }
  const exception = bullets.find((b) => /rows-non-attribuables/.test(b));
  if (!exception) {
    failures.push("no exception outcome for unattributable rows (pre-0.98.2, or foreign machine)");
  } else {
    if (!/foreign-frame/.test(exception)) {
      failures.push("the exception outcome must name the foreign-frame verdict (R1)");
    }
    if (!/REFUS/.test(exception)) {
      failures.push("the exception outcome must state that the automatic takeover is REFUSED");
    }
    if (!/Phase 3/.test(exception)) {
      failures.push("the exception outcome must route to the Phase 3 archive procedure");
    }
  }
  const blocked = bullets.find((b) => b.includes("NON rétabli"));
  if (!blocked || !/BLOQU/.test(blocked)) {
    failures.push("the not-restored outcome must be announced BLOCKED");
  }
  return failures;
}

test("R9 (iii): the real runbook distinguishes the outcomes — takeover ONLY on restored identity AND attributable rows", () => {
  assert.deepEqual(outcomeFailures(SOURCE), []);
});

test("R9 (iii) fixtures: the review's outcome mutations must fail here", () => {
  // Mutation 1 — the line-52 promise: takeover as soon as the machine-id is
  // restored, without conditioning it on attributable rows.
  const unconditional = SOURCE.replace(
    " et rows attribuables à cette même machine (Commande 2.2 : `rows-attribuables:N`)",
    "",
  );
  assert.notEqual(unconditional, SOURCE, "fixture 1 must actually mutate the runbook");
  assert.ok(outcomeFailures(unconditional).length > 0, "an unconditioned takeover promise must fail");

  // Mutation 2 — the inverted outcome: recovery announced WITHOUT a restored
  // machine identity (labels swapped between the restored and blocked bullets).
  const inverted = SOURCE
    .replace("**Issue 1 — machine-id rétabli", "**Issue 1 — machine-id NON rétabli")
    .replace("**Issue 3 — machine-id NON rétabli", "**Issue 3 — machine-id rétabli");
  assert.notEqual(inverted, SOURCE, "fixture 2 must actually mutate the runbook");
  assert.ok(outcomeFailures(inverted).length > 0, "an inverted machine-id outcome must fail");

  // Mutation 3 — laundering: the exception bullet grants the automatic
  // takeover even for unattributable rows.
  const laundering = SOURCE.replace(
    "la reprise automatique est REFUSÉE",
    "la reprise automatique est ACCORDÉE",
  );
  assert.notEqual(laundering, SOURCE, "fixture 3 must actually mutate the runbook");
  assert.ok(outcomeFailures(laundering).length > 0, "a takeover granted over foreign-frame rows must fail");
});

test("R9: the registry rows are qualified PER ROW against the local machine-id, never by a global count", () => {
  assert.ok(
    SOURCE.includes("rows-attribuables") && SOURCE.includes("rows-non-attribuables"),
    "the runbook must distinguish attributable from unattributable rows with distinct outcomes",
  );
  assert.ok(
    !/grep -c 'pgidMachineId'/.test(SOURCE),
    "a global grep count does not qualify each row: one anchored row would mask N unanchored ones (review finding, runbook line 86)",
  );
  const qualifier = COMMAND_BLOCKS.find((block) => block.command.includes("rows-attribuables"));
  assert.ok(
    qualifier,
    "the per-row qualification must be an executable one-liner, not prose",
  );
});

test("R9: archiving renames each resource ON ITS OWN filesystem (timestamped, never rm)", () => {
  for (const block of COMMAND_BLOCKS) {
    assert.ok(
      !/\brm\b/.test(block.command),
      `command \`${block.command}\` deletes a file: the runbook pins ARCHIVING by timestamped rename, never deletion`,
    );
  }
  const archives = COMMAND_BLOCKS.filter((block) => /\bmv\b/.test(block.command));
  assert.ok(archives.length >= 2, "the runbook must contain rename (mv) commands archiving to a timestamped name");
  assert.ok(
    SOURCE.includes("date +%Y%m%dT%H%M%S") || /h2a-recovery-\$?\{?stamp/.test(SOURCE),
    "the archive must be timestamped, so it is auditable and never overwrites a previous archive",
  );
  // The review reproduced it with two filesystems: a cross-device mv COPIES
  // then deletes — dev/ino change, the archived file is no longer the
  // original. Every archive rename must stay in the source's own directory.
  for (const block of archives) {
    const operands = [...block.command.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(
      operands.length >= 2,
      `archive rename must quote its operands: \`${block.command}\``,
    );
    const [src, dst] = operands;
    assert.ok(
      src && dst,
      `archive rename must have a source and a destination: \`${block.command}\``,
    );
    assert.equal(
      src.slice(0, src.lastIndexOf("/")),
      dst.slice(0, dst.lastIndexOf("/")),
      `archive rename must stay on the source's own filesystem (same parent directory): cross-device mv copies then deletes — \`${block.command}\``,
    );
  }
  assert.ok(
    /copie puis efface|copie puis supprime/.test(SOURCE) && /dev/.test(SOURCE) && /ino/.test(SOURCE),
    "the runbook must state WHY: a cross-device mv is a copy+delete, not a rename (dev/ino change)",
  );
});

test("R9 (iii): the machine-id-unreadable case keeps the coded refusal through any rename", () => {
  const phaseZero = SOURCE.slice(0, SOURCE.indexOf("## Phase 1"));
  assert.ok(phaseZero.length > 200, "the machine-id prerequisite must be Phase 0, BEFORE the safety preconditions");
  assert.ok(
    /BLOQU/.test(phaseZero),
    "the runbook must announce explicitly that the recovery stays BLOCKED while the machine identity is not restored",
  );
  assert.ok(
    phaseZero.includes("reprise automatique"),
    "the restored-identity outcome must be stated: automatic takeover (R3) with no manual file manipulation",
  );
  // Archiving must never be presented as a takeover: the refusal (R3.6)
  // survives any rename.
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

test("R9: post-recovery verification anchors to the install prefix ACTUALLY used, not an example", () => {
  // The review reproduced the smoke-side defect and noted the runbook had the
  // same shape: a resolution anchored to a hard-coded example prefix. The
  // proof must run from the prefix of the h2a binary the PATH actually
  // resolves — the effectively used one.
  const proofs = COMMAND_BLOCKS.filter((block) => block.command.includes("require.resolve('@sentropic/h2a-runtime/package.json')"));
  assert.ok(
    proofs.length >= 2,
    "the path and version proofs must be executable one-liners, not prose",
  );
  for (const proof of proofs) {
    assert.ok(
      proof.command.includes("command -v h2a"),
      `the proof must anchor to the actually-installed prefix via the resolved h2a binary, not an example path: \`${proof.command}\``,
    );
  }
  const verifyPhase = SOURCE.slice(SOURCE.indexOf("## Phase 4"));
  assert.ok(
    verifyPhase.includes("require.resolve('@sentropic/h2a-runtime/package.json')"),
    "the post-recovery verification must prove the loaded runtime PATH",
  );
  assert.ok(
    verifyPhase.includes(".version"),
    "the post-recovery verification must prove the loaded runtime VERSION",
  );
});

test("R9: the three lockstep deprecation commands are prepared, range-pinned, post-validation only, track excluded", () => {
  for (const pkg of ["@sentropic/h2a", "@sentropic/h2a-runtime", "@sentropic/h2a-cli"]) {
    const command = COMMAND_BLOCKS.find((block) => block.command.includes(`npm deprecate '${pkg}@`));
    assert.ok(
      command,
      `the prepared npm deprecate command for ${pkg} must be listed as a one-liner with its expected effect`,
    );
    assert.ok(
      command.command.includes(">=0.98.1 <=0.98.4"),
      `the deprecation range for ${pkg} is pinned by R9: >=0.98.1 <=0.98.4`,
    );
  }
  assert.ok(
    !SOURCE.includes("npm deprecate '@sentropic/track"),
    "track is NOT deprecated (R9): no deprecate command may target it",
  );
  const deprecation = SOURCE.slice(SOURCE.indexOf("## Déprecation"));
  assert.ok(
    /APRÈS validation|après validation/.test(deprecation),
    "the commands are prepared but executed only AFTER the validation of 0.98.5 — never before",
  );
  assert.ok(
    /défaut distinct|défaut DISTINCT/.test(deprecation),
    "the 0.98.1 defect must be documented distinctly from the post-reboot brick",
  );
  assert.ok(
    /0\.98\.1/.test(deprecation) && /journal-writer|fuite/.test(deprecation),
    "the distinct 0.98.1 defect must be named (the native journal-writer IPC leak), not merely referenced",
  );
  assert.ok(
    /brique post-reboot|post-reboot/.test(deprecation) && /0\.98\.2/.test(deprecation),
    "the post-reboot brick scope (0.98.2-0.98.4) must stay distinct from the 0.98.1 defect",
  );
});

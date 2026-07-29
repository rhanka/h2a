// Guards for the grouped command map (`h2a explain`) and for the runtime's
// grouped `--help`.
//
// The point of these tests is DRIFT: a map that silently stops covering the
// command set is worse than no map, because a human trusts it. So every core
// verb must be classified, and the runtime verb list this map documents must
// still match the runtime's actual top-level commands.
//
// Note: `packages/h2a-runtime/src/*.test.ts` are NOT executed by `npm test`
// (scripts/run-tests.mjs only discovers packages/h2a/test and
// packages/focus-interactive/test). The runtime-side assertions therefore live
// here, driven through the built runtime, so they actually run in CI.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  H2A_CLI_VERB_CONTRACTS,
  H2A_COMMAND_GROUPS,
  H2A_COMMAND_MAP_CORE_FIRST_WORDS,
  H2A_COMMAND_MAP_RUNTIME_VERBS,
  buildCommandMap,
  coreGroupForFirstWord,
  renderCommandMap,
  runCli
} from "../dist/index.js";
import { TRACK_FACADE_VERBS } from "../dist/cli.js";

const ROOT = process.cwd();
const H2A_BIN = join(ROOT, "packages/h2a/dist/bin.js");
const RUNTIME_BIN = join(ROOT, "packages/h2a-runtime/dist/index.js");
const TRACK_VERBS = [...TRACK_FACADE_VERBS];

function captureStreams() {
  let stdoutText = "";
  let stderrText = "";
  return {
    stdout: { write: (chunk) => { stdoutText += chunk; return true; } },
    stderr: { write: (chunk) => { stderrText += chunk; return true; } },
    cwd: () => ROOT,
    get stdoutText() { return stdoutText; },
    get stderrText() { return stderrText; }
  };
}

test("every frozen contract verb is classified into a group", () => {
  const classified = new Set(H2A_COMMAND_MAP_CORE_FIRST_WORDS);
  const unclassified = [
    ...new Set(
      H2A_CLI_VERB_CONTRACTS.map((c) => c.verb.split(" ")[0]).filter(
        (word) => !classified.has(word)
      )
    )
  ];
  assert.deepEqual(
    unclassified,
    [],
    `these contract first-words have no group in cli-command-map.ts: ${unclassified.join(", ")}`
  );
});

test("the map classifies no verb into a group it does not declare", () => {
  const declared = new Set(H2A_COMMAND_GROUPS.map((g) => g.id));
  for (const section of buildCommandMap(TRACK_VERBS)) {
    assert.ok(declared.has(section.group.id), `undeclared group ${section.group.id}`);
  }
});

test("the map covers every contract verb and every Track facade verb, once each", () => {
  const entries = buildCommandMap(TRACK_VERBS).flatMap((s) => s.entries);
  const coreVerbs = entries.filter((e) => e.origin === "core").map((e) => e.verb);
  assert.deepEqual(
    [...coreVerbs].sort(),
    H2A_CLI_VERB_CONTRACTS.map((c) => c.verb).sort()
  );
  assert.deepEqual(
    entries.filter((e) => e.origin === "track").map((e) => e.verb).sort(),
    [...TRACK_VERBS].sort()
  );
  // No duplicate lines: a human scanning the map must not see a verb twice.
  const all = entries.map((e) => e.verb);
  assert.equal(new Set(all).size, all.length, "duplicate verb in the command map");
});

test("renderCommandMap prints one line per group and one line per verb", () => {
  const rendered = renderCommandMap(TRACK_VERBS);
  const lines = rendered.split("\n");
  for (const section of buildCommandMap(TRACK_VERBS)) {
    const heading = `${section.group.heading} — ${section.group.intention}`;
    assert.equal(
      lines.filter((l) => l === heading).length,
      1,
      `group heading must appear exactly once: ${section.group.heading}`
    );
    for (const entry of section.entries) {
      const verbLines = lines.filter((l) =>
        l.startsWith(`  h2a ${entry.verb} `) || l === `  h2a ${entry.verb}`
      );
      assert.ok(verbLines.length >= 1, `no line for verb ${entry.verb}`);
      // One line per verb: never wrapped onto a second line.
      for (const line of verbLines) assert.ok(!line.includes("\n"));
    }
  }
  // The map names its own source, so a reader can check the grouping's authority.
  assert.match(rendered, /docs\/cli-help-grouping-vocabulary\.md/);
});

test("h2a explain exits 0 with non-empty text and does not touch stderr", () => {
  const streams = captureStreams();
  assert.equal(runCli(["explain"], streams), 0);
  assert.equal(streams.stderrText, "");
  assert.ok(streams.stdoutText.length > 0);
  assert.match(streams.stdoutText, /grouped command map/);
});

test("h2a explain is a NEW verb: it does not shadow --help or bare h2a", () => {
  const help = captureStreams();
  runCli(["--help"], help);
  const bare = captureStreams();
  runCli([], bare);
  const explain = captureStreams();
  runCli(["explain"], explain);
  // DEC-034: no argv is help. Unchanged.
  assert.equal(bare.stdoutText, help.stdoutText);
  assert.notEqual(explain.stdoutText, help.stdoutText);
  // And the front door advertises the new affordance.
  assert.match(help.stdoutText, /h2a explain/);
});

test("h2a --help still renders the flat usage reference it always did", () => {
  const streams = captureStreams();
  assert.equal(runCli(["--help"], streams), 0);
  const out = streams.stdoutText;
  assert.match(out, /Human-to-agent coordination CLI/);
  assert.match(out, /^Usage:$/m);
  // The mailbox block used to be nested under "Auto-propagation (DEC-033):",
  // which describes only offer/counter/sign/event causation. It now has its own
  // heading; the usage lines themselves are unchanged.
  assert.match(out, /^Mailboxes, local services and host wiring:$/m);
  assert.match(out, /^ {2}h2a inbox put --instance/m);
});

const runtimeBuilt = existsSync(RUNTIME_BIN);

function runtimeTopLevelCommands() {
  const result = spawnSync(process.execPath, [RUNTIME_BIN, "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
  const output = result.stdout || "";
  const names = [];
  for (const line of output.split("\n")) {
    // Command rows are indented two spaces; the term is `name|alias [options] <args>`.
    const match = /^ {2}([a-z][a-z0-9-]*)(\||\s|$)/.exec(line);
    if (match && !line.startsWith("  -")) names.push(match[1]);
  }
  return { names, output };
}

test(
  "the map documents exactly the runtime's top-level commands",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const { names } = runtimeTopLevelCommands();
    assert.deepEqual(
      [...new Set(names)].sort(),
      [...new Set(H2A_COMMAND_MAP_RUNTIME_VERBS)].sort(),
      "cli-command-map.ts RUNTIME_VERBS drifted from the runtime's actual commands"
    );
  }
);

test(
  "the runtime help groups every command by intention, none left in the default bucket",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const { output } = runtimeTopLevelCommands();
    // Commander's default heading must be gone: every command has a group.
    assert.doesNotMatch(output, /^Commands:$/m, "a command is still ungrouped");
    for (const heading of [
      "Start — begin, return to, or end a work session:",
      "Observe — see what is running and what needs attention:",
      "Coordinate — hand work to agents and talk to peers:",
      "Set up — connect this host, its credentials, and diagnostics:",
      "Recover & supervise sessions (advanced):",
      "Transport & bridges (compatibility — not the session front door):",
      "Help:"
    ]) {
      assert.ok(output.includes(heading), `missing group heading: ${heading}`);
    }
    // The stale pre-consolidation description must not come back.
    assert.doesNotMatch(output, /Wrap a local agent CLI/);
    assert.match(output, /The unified sentropic CLI and core/);
    // Honest about what h2a is not.
    assert.match(output, /it is not itself an agent/);
  }
);

test(
  "grouping changed the heading layout only — every command term survives verbatim",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    const { output } = runtimeTopLevelCommands();
    // A regrouping that dropped or renamed a command term would be a behaviour
    // change dressed as a layout change. Pin the terms Commander renders.
    for (const term of [
      "claude|claude-code [options] [commandArgs...]",
      "check|smoke [options] <profile>",
      "relay|h2a",
      "run [options] <profile> [path]",
      "forward [options] <sessionId> <podPort> [localPort]",
      "help [command]"
    ]) {
      assert.ok(output.includes(term), `command term lost from help: ${term}`);
    }
  }
);

test("h2a explain works through the real bin, exit 0", () => {
  const result = spawnSync(process.execPath, [H2A_BIN, "explain"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
  assert.match(result.stdout, /^h2a — grouped command map$/m);
  // It must NOT have been routed to the heavy runtime.
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /requiert le runtime h2a|runtime incompatible|unknown command/i
  );
});

// ---------------------------------------------------------------------------
// Guards added in review. Each one exists because a claim was being made at a
// rung weaker than the claim itself: a citation with no reachable artifact, a
// comment asserting a test that was never written, two hand-written counts with
// no gate, and an invariant that held only because of statement order.
// They are APPENDED so the line numbers cited in source comments stay valid.
// ---------------------------------------------------------------------------

test("every doc path cited by the grouping modules and by `h2a explain` resolves", () => {
  // The defect this replaces: `h2a explain` printed the path of a design study
  // that exists on no git ref, and a test asserted that string was present — the
  // citation enforced, the cited artifact absent. Now the pointer must resolve.
  //
  // Scoped deliberately to the files this feature owns plus its rendered output.
  // It is NOT a repo-wide rule: other modules cite spec paths under docs/specs/
  // with their own history, and silently widening this guard would make it look
  // like the whole repo is covered when it is not.
  const owned = [
    "packages/h2a/src/cli-command-map.ts",
    "packages/h2a/src/cli-contract.ts",
    "packages/h2a-runtime/src/cli-help-groups.ts",
    "docs/cli-help-grouping-vocabulary.md"
  ];
  const sources = owned.map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), "utf8") }));
  sources.push({ rel: "renderCommandMap() output", text: renderCommandMap(TRACK_VERBS) });

  const dangling = [];
  for (const { rel, text } of sources) {
    for (const cited of new Set(text.match(/\bdocs\/[A-Za-z0-9._/-]+\.md\b/gu) ?? [])) {
      if (!existsSync(join(ROOT, cited))) dangling.push(`${rel} -> ${cited}`);
    }
  }
  assert.deepEqual(dangling, [], `cited doc path does not exist: ${dangling.join("; ")}`);

  // And every warrant is present, not merely named — with the list of passages
  // DERIVED MECHANICALLY, not hand-curated.
  //
  // The previous version of this check ran off a list someone maintained by
  // hand, and that is exactly why it passed while the modules quoted "Do not
  // teach it as the session front door." from a section that does not contain
  // it: nobody had added that phrase to the list. A curated list only checks
  // what someone remembered. Same argument that took `explain`'s core entries
  // off a hand-written list and onto the frozen contract.
  //
  // The convention: a study quotation in a grouping module is written as a
  // Markdown blockquote inside a comment (`// > …`). This harvests every one of
  // them and requires it to appear in the vendored doc. Adding a new quotation
  // to a comment therefore adds it to this guard automatically; quoting
  // something that was never vendored fails here.
  const runs = harvestStudyQuotations();
  const lineCount = runs.reduce((n, run) => n + run.lines.length, 0);
  assert.ok(
    lineCount >= 20,
    `expected the grouping modules to carry many marked quotations, found ${lineCount} — has the "// >" convention been dropped?`
  );
  // Strip the doc's own Markdown blockquote markers BEFORE normalizing: the
  // vendored passages are quoted line by line as `> …`, so leaving the markers
  // in would put a stray ">" between every pair of words that a source comment
  // wrapped across two lines, and a correctly-vendored quotation would look
  // missing.
  const vocabNorm = normalizeQuote(
    readFileSync(join(ROOT, "docs/cli-help-grouping-vocabulary.md"), "utf8")
      .split("\n")
      .map((line) => line.replace(/^\s*>\s?/u, ""))
      .join("\n")
  );

  // A marked run is accepted if the WHOLE run appears (a quotation the comment
  // wrapped across lines) or if EVERY line appears on its own (a run of separate
  // one-line quotations, e.g. consecutive table rows). Only lines that fail both
  // are reported, so neither authoring style produces a false miss.
  const unvendored = [];
  for (const run of runs) {
    if (vocabNorm.includes(normalizeQuote(run.lines.map((l) => l.text).join(" ")))) continue;
    for (const line of run.lines) {
      if (!vocabNorm.includes(normalizeQuote(line.text))) {
        unvendored.push(`${run.file}:${line.line} -> ${line.text}`);
      }
    }
  }
  assert.deepEqual(
    unvendored,
    [],
    `a grouping module quotes text that docs/cli-help-grouping-vocabulary.md does not vendor:\n  ${unvendored.join("\n  ")}`
  );
});

/**
 * Normalize for comparison: collapse whitespace (so a comment's line wrapping
 * cannot cause a false miss) and fold typographic quotes to ASCII (the study
 * uses curly quotes; source comments use straight ones — a difference of
 * rendering, not of wording).
 */
function normalizeQuote(text) {
  return text
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Harvest `// > …` blockquote lines from the modules that cite the study,
 * grouped into maximal runs of consecutive marked lines. Lines that are only an
 * ellipsis, or shorter than 12 characters, are elision markers rather than
 * quotations and are skipped.
 */
function harvestStudyQuotations() {
  const files = [
    "packages/h2a-runtime/src/cli-help-groups.ts",
    "packages/h2a/src/cli-command-map.ts"
  ];
  const runs = [];
  for (const rel of files) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    let current = null;
    lines.forEach((raw, i) => {
      const m = /^\s*(?:\/\/|\*)\s*>\s?(.*\S)\s*$/u.exec(raw);
      const text = m?.[1];
      const usable = text !== undefined && text.length >= 12 && !/^[….\s]+$/u.test(text);
      if (!usable) {
        current = null;
        return;
      }
      if (current === null) {
        current = { file: rel, lines: [] };
        runs.push(current);
      }
      current.lines.push({ line: i + 1, text });
    });
  }
  return runs;
}

test("the fallback bucket is not a semantic bucket", () => {
  // A fallback that borrows a semantic label produces a confidently wrong answer
  // instead of an obviously missing one. `UNCLASSIFIED` must therefore stay
  // distinct from `LLM_LOCAL`, and must stay empty.
  const ids = H2A_COMMAND_GROUPS.map((g) => g.id);
  assert.ok(ids.includes("UNCLASSIFIED"), "the fallback group must exist");
  assert.ok(ids.includes("LLM_LOCAL"), "the LLM bucket must exist");
  assert.notEqual(
    H2A_COMMAND_GROUPS.find((g) => g.id === "UNCLASSIFIED").heading,
    H2A_COMMAND_GROUPS.find((g) => g.id === "LLM_LOCAL").heading,
    "the fallback must not borrow the LLM bucket's heading"
  );
  // The fallback TARGET, pinned directly. Without this the choice of fallback is
  // unobservable — every frozen verb is classified today, so swapping the `??`
  // to a semantic bucket changed nothing any test could see. (Measured: that
  // mutation survived the whole suite before this assertion existed.)
  assert.equal(
    coreGroupForFirstWord("no-such-verb-zzz"),
    "UNCLASSIFIED",
    "an unclassified core verb must fall back to the semantics-free bucket, not a labelled one"
  );

  // Empty today: nothing renders under it, because the completeness test above
  // fails first. If this fires, a frozen verb has no group entry.
  const fallback = buildCommandMap(TRACK_VERBS).find((s) => s.group.id === "UNCLASSIFIED");
  assert.equal(
    fallback,
    undefined,
    `verbs fell through to UNCLASSIFIED: ${(fallback?.entries ?? []).map((e) => e.verb).join(", ")}`
  );
});

test("the announced CLI verb counts match the golden fixture", () => {
  // Two hand-written counts that `scripts/check-public-contract.sh` never reads —
  // it computes its own count dynamically. So they could go stale silently.
  //
  // They DID. This comment used to predict it in the future tense; it happened.
  // PR #30 took the contract 97 -> 98 with `keys prove-control` and merged first;
  // rebasing this branch onto it merged cli-verbs.json, the contract and
  // `expected[]` cleanly to 99 while these two prose numbers stayed at 98 — a
  // conflict-free rebase leaving the published contract wrong. This test caught
  // it on the next run. Kept in the past tense so the worked example survives.
  //
  // Placed at the test rung rather than in the shell gate on purpose: ci.yml's
  // contract job is already red on main for an unrelated reason (16 track_* tools
  // missing from the MCP golden), and a gate that is already red cannot newly
  // catch anything. This suite does run.
  const golden = JSON.parse(
    readFileSync(join(ROOT, "docs/contracts/golden/cli-verbs.json"), "utf8")
  );
  const actual = golden.length;

  // The golden fixture must itself match the live contract.
  assert.equal(actual, H2A_CLI_VERB_CONTRACTS.length, "cli-verbs.json drifted from the contract");

  const readme = readFileSync(join(ROOT, "docs/contracts/golden/README.md"), "utf8");
  const readmeCount = /\*\*`cli-verbs\.json`\*\*[^\n]*?les (\d+) verbes/u.exec(readme);
  assert.ok(readmeCount, "could not find the announced verb count in golden/README.md");
  assert.equal(
    Number(readmeCount[1]),
    actual,
    `golden/README.md announces ${readmeCount[1]} CLI verbs but cli-verbs.json has ${actual}`
  );

  const matrix = JSON.parse(
    readFileSync(join(ROOT, "docs/contracts/golden/version-matrix.json"), "utf8")
  );
  const matrixCount = /^(\d+)/u.exec(matrix.compat.cliVerbs);
  assert.ok(matrixCount, "could not parse compat.cliVerbs in version-matrix.json");
  assert.equal(
    Number(matrixCount[1]),
    actual,
    `version-matrix.json compat.cliVerbs says ${matrixCount[1]} but cli-verbs.json has ${actual}`
  );
});

const RUNTIME_GROUPS_MOD = join(ROOT, "packages/h2a-runtime/dist/cli-help-groups.js");

test(
  "no runtime command is listed in two intention groups",
  { skip: existsSync(RUNTIME_GROUPS_MOD) ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  async () => {
    // There is no structural backstop for this: HEADING_BY_COMMAND is a Map, so a
    // name in two groups is silently deduped to the LAST one and simply renders
    // under the wrong heading. The drift test compares sorted UNIQUE names and
    // would not notice. A duplicate listing is a real authoring mistake, so it
    // gets an explicit guard rather than a comment claiming one exists.
    const { H2A_RUNTIME_HELP_GROUPS } = await import(pathToFileURL(RUNTIME_GROUPS_MOD).href);
    const seen = new Map();
    for (const group of H2A_RUNTIME_HELP_GROUPS) {
      for (const name of group.commands) {
        seen.set(name, [...(seen.get(name) ?? []), group.id]);
      }
    }
    const duplicated = [...seen.entries()]
      .filter(([, groups]) => groups.length > 1)
      .map(([name, groups]) => `${name} in ${groups.join(" + ")}`);
    assert.deepEqual(duplicated, [], `command listed in more than one help group: ${duplicated.join("; ")}`);
  }
);

test(
  "the group override passes through headings it does not own, so subcommand help is intact",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    // WHAT THIS PINS, and what it deliberately does not.
    //
    // Review raised that `program.configureHelp({ groupItems })` in index.ts is
    // silently order-dependent: `_helpConfiguration` is copied to children by
    // `copyInheritedSettings` AT REGISTRATION, so placing the call after all
    // registration means subcommands do not inherit `groupItems`.
    //
    // The inheritance claim is true. The claim that it is what keeps subcommand
    // help correct is NOT: hoisting the call to before registration was measured
    // and every help output — top level, `run`, `account`, `jobs`, `relay` — came
    // back BYTE-IDENTICAL. So there is nothing observable to pin about placement,
    // and a test asserting otherwise would be a guard that can never fire.
    //
    // The reason it is inert is itself a real invariant, and THAT is worth
    // pinning: `groupRuntimeHelpItems` re-emits any heading absent from
    // `H2A_RUNTIME_HELP_GROUP_HEADINGS` unchanged, in its original relative
    // order. `Options:` is such a heading.
    //
    // The pass-through is pinned on the TOP-LEVEL help, which is the only help
    // that uses our override — measured: replacing the pass-through loop with a
    // no-op removes `Options:`, `-V, --version` and `-h, --help` from
    // `h2a --help` entirely, while every SUBCOMMAND help stays byte-identical
    // (they do not inherit `groupItems`). Nothing in the suite caught that before
    // this test.
    const top = runtimeTopLevelCommands().output;
    assert.match(top, /^Options:$/mu, "the group override swallowed Commander's own Options: heading");
    assert.match(top, /^\s+-V, --version/mu, "top-level --help lost the version option line");
    assert.match(top, /^\s+-h, --help/mu, "top-level --help lost the help option line");

    // Secondary, and honestly labelled: subcommand help is checked as a
    // regression net only. It passes today regardless of the override, because
    // subcommands do not inherit `groupItems` at all. It would start carrying
    // weight if the `configureHelp` call above were ever hoisted.
    for (const [command, expected] of [
      ["run", ["Options:"]],
      ["account", ["Options:", "Commands:"]],
      ["jobs", ["Options:", "Commands:"]],
      ["relay", ["Options:", "Commands:"]]
    ]) {
      const result = spawnSync(process.execPath, [RUNTIME_BIN, command, "--help"], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, NO_COLOR: "1" }
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
      const out = result.stdout || "";
      assert.match(out, new RegExp(`^Usage: h2a ${command}`, "mu"));
      for (const heading of expected) {
        assert.match(
          out,
          new RegExp(`^${heading}$`, "mu"),
          `h2a ${command} --help lost Commander's own "${heading}" heading — groupRuntimeHelpItems stopped passing through headings it does not own`
        );
      }
    }
  }
);

test("the file:line citations in cli-help-groups.ts point at the tests they name", () => {
  // Closing the loop the whole review is about: a citation should not be able to
  // rot. `cli-help-groups.ts` names two guards by `file:line`; line numbers drift
  // whenever this file is edited, so this asserts each cited line really is the
  // `test(` call for the named test. If it fires, fix the citation — do not
  // delete this test.
  const EXPECTED = {
    181: "the runtime help groups every command by intention, none left in the default bucket",
    456: "no runtime command is listed in two intention groups"
  };
  const groupsSrc = readFileSync(
    join(ROOT, "packages/h2a-runtime/src/cli-help-groups.ts"),
    "utf8"
  );
  const cited = [
    ...new Set(
      [...groupsSrc.matchAll(/cli-command-map\.test\.js:(\d+)/gu)].map((m) => Number(m[1]))
    )
  ].sort((a, b) => a - b);
  assert.deepEqual(
    cited,
    Object.keys(EXPECTED).map(Number).sort((a, b) => a - b),
    "cli-help-groups.ts cites line numbers this guard does not know about"
  );

  const selfLines = readFileSync(join(ROOT, "packages/h2a/test/cli-command-map.test.js"), "utf8").split("\n");
  for (const [line, name] of Object.entries(EXPECTED)) {
    const n = Number(line);
    assert.equal(selfLines[n - 1], "test(", `cli-command-map.test.js:${n} is not a test( call`);
    assert.equal(
      selfLines[n].trim(),
      `"${name}",`,
      `cli-command-map.test.js:${n} no longer declares "${name}" — the citation in cli-help-groups.ts is stale`
    );
  }
});

// ---------------------------------------------------------------------------
// Round-4 guards. Both exist because a property was MEASURED rather than
// GUARDED: a one-time measurement says the code was right once, which is not
// the same as keeping it right. Appended, so the line numbers cited in source
// comments stay valid.
// ---------------------------------------------------------------------------

const HELP_FIXTURE = join(ROOT, "packages/h2a/test/fixtures/runtime-help-commands.json");

/**
 * Parse the runtime entrypoint's `--help` into one record per command row:
 * the intention group it renders under, its Commander term, and its
 * description. Option rows are excluded (they live under `Options:`), and a
 * wrapped description is reported rather than silently truncated.
 */
function parseRuntimeHelpRows(output) {
  const rows = [];
  let heading = null;
  let wrapped = false;
  for (const line of output.split("\n")) {
    if (/^\S.*:$/u.test(line)) {
      heading = line;
      continue;
    }
    if (line.trim() === "") continue;
    if (heading === "Options:") continue;
    const m = /^ {2}(\S(?:.*?\S)?) {2,}(\S.*)$/u.exec(line);
    if (m) rows.push({ group: heading, term: m[1], description: m[2] });
    else if (/^ {3,}\S/u.test(line) && heading !== null) wrapped = true;
  }
  return { rows, wrapped };
}

test(
  "every runtime command term AND description is pinned by a committed fixture",
  { skip: runtimeBuilt ? false : "packages/h2a-runtime/dist absent (run npx tsc -b)" },
  () => {
    // WHY THIS EXISTS. Review measured all 46 terms byte-identical across the
    // regrouping — once, by hand. The earlier test pinned SIX terms and no
    // descriptions, so nothing kept the other 40 (or any description) true
    // tomorrow. A one-time measurement is not a guard; this is the guard.
    //
    // VOCABULARY, deliberately precise. This pins PER-COMMAND ROWS only. The
    // top-level ROOT DESCRIPTION *did* change in this PR, by design, and is
    // therefore NOT in the `commands` fixture — it is asserted separately below
    // against `rootDescriptionContains`. Conflating the two would either
    // freeze a line we meant to change or let 46 lines drift unnoticed.
    const fixture = JSON.parse(readFileSync(HELP_FIXTURE, "utf8"));
    const { output } = runtimeTopLevelCommands();
    const { rows, wrapped } = parseRuntimeHelpRows(output);

    // If Commander ever wraps a description, the parser above would drop the
    // continuation and this guard would quietly weaken. Refuse instead.
    assert.equal(
      wrapped,
      false,
      "a command description wrapped onto a second line; the fixture parser would truncate it"
    );
    assert.equal(fixture.descriptionsWrapped, false, "fixture was generated from wrapped output");

    assert.equal(
      rows.length,
      fixture.commandCount,
      `runtime help now renders ${rows.length} command rows, fixture pins ${fixture.commandCount}`
    );
    // deepEqual over the whole array: term, description AND group, in order.
    assert.deepEqual(
      rows,
      fixture.commands,
      "runtime help command rows drifted from packages/h2a/test/fixtures/runtime-help-commands.json"
    );

    // The root description is top-level prose, pinned separately and loosely:
    // it is the line this PR intentionally rewrote.
    const root = output.split("\n").slice(0, 10).join(" ");
    for (const needle of fixture.rootDescriptionContains) {
      assert.ok(root.includes(needle), `root description no longer contains: ${needle}`);
    }
  }
);

/**
 * Extract the hand-maintained `expected` verb array from cli-contract.test.js.
 * That array is a test-local literal with comments in it, so it is parsed from
 * source rather than imported. A parse failure is an assertion failure, never a
 * silently-skipped check.
 */
function readExpectedVerbArray() {
  const src = readFileSync(join(ROOT, "packages/h2a/test/cli-contract.test.js"), "utf8");
  const start = src.indexOf("const expected = [");
  assert.notEqual(start, -1, "could not locate `const expected = [` in cli-contract.test.js");
  const open = src.indexOf("[", start);
  const close = src.indexOf("\n  ];", open);
  assert.notEqual(close, -1, "could not locate the end of the `expected` array");
  const literal = src.slice(open, close + 4).replace(/^\s*\/\/[^\n]*$/gmu, "");
  let parsed;
  try {
    parsed = JSON.parse(literal.replace(/,(\s*\])/u, "$1"));
  } catch (err) {
    assert.fail(`could not parse the \`expected\` array literal: ${err.message}`);
  }
  assert.ok(Array.isArray(parsed) && parsed.length > 0, "`expected` parsed to something unusable");
  return parsed;
}

test("the golden verb SET matches the contract and `expected[]`, not merely its size", () => {
  // WHY THIS EXISTS, and what the previous guard could not see. The count guard
  // asserts cardinality: len(golden) === len(contract), plus the two prose
  // numbers. Cardinality is blind to the mutations that keep it constant —
  // SWAP one verb for another, or DUPLICATE one while DROPPING another, and 100
  // stays 100. `expected[]` was not compared against the golden by anything at
  // all: cli-contract.test.js compares it to the contract, and nothing closed
  // the third edge of the triangle.
  //
  // Review recomputed set equality by hand and got a clean result. That was the
  // REVIEWER computing, not a test that fires next time. This is the test.
  //
  // Not delegated to scripts/check-public-contract.sh on purpose: that job is
  // already red on main for an unrelated reason (16 track_* tools missing from
  // the MCP golden), and a gate that is already red cannot newly catch anything.
  const golden = JSON.parse(
    readFileSync(join(ROOT, "docs/contracts/golden/cli-verbs.json"), "utf8")
  );
  const contract = H2A_CLI_VERB_CONTRACTS.map((c) => c.verb);
  const expected = readExpectedVerbArray();

  // 1. No duplicates. A duplicate plus a drop preserves length AND, if only
  //    sorted-set comparison were used, could hide a missing verb.
  const dupes = golden.filter((v, i) => golden.indexOf(v) !== i);
  assert.deepEqual([...new Set(dupes)], [], `cli-verbs.json contains duplicate verbs: ${dupes.join(", ")}`);

  // 2. Sorted. The golden is generated sorted and diffed as text by the shell
  //    gate; an unsorted golden is a spurious-diff generator.
  assert.deepEqual(golden, [...golden].sort(), "cli-verbs.json is no longer sorted");

  // 3. Set equality on all three edges, as multisets (sorted arrays), so a swap
  //    is caught even though it preserves the count.
  assert.deepEqual(
    [...golden].sort(),
    [...contract].sort(),
    "cli-verbs.json and H2A_CLI_VERB_CONTRACTS describe different verb sets"
  );
  assert.deepEqual(
    [...golden].sort(),
    [...expected].sort(),
    "cli-verbs.json and the `expected` array in cli-contract.test.js describe different verb sets"
  );

  // 4. And the two hand-written prose counts, so all five artifacts are covered
  //    by one directly-executed test rather than by three that each see a part.
  const readme = readFileSync(join(ROOT, "docs/contracts/golden/README.md"), "utf8");
  const readmeCount = /\*\*`cli-verbs\.json`\*\*[^\n]*?les (\d+) verbes/u.exec(readme);
  assert.ok(readmeCount, "could not find the announced verb count in golden/README.md");
  assert.equal(Number(readmeCount[1]), golden.length, "golden/README.md announces the wrong count");

  const matrix = JSON.parse(
    readFileSync(join(ROOT, "docs/contracts/golden/version-matrix.json"), "utf8")
  );
  assert.equal(
    Number(/^(\d+)/u.exec(matrix.compat.cliVerbs)?.[1]),
    golden.length,
    "version-matrix.json compat.cliVerbs announces the wrong count"
  );
});

test("h2a explain rejects argv it does not implement", () => {
  // Review measured this verb returning the map with exit 0 for `explain foo`,
  // `explain --json`, `explain --root /tmp` — the contract declaring no flags
  // while the binary accepted anything. A successful-looking result for
  // unimplemented input is worse than an error: `explain --json | jq` got prose
  // and exit 0.
  for (const argv of [
    ["explain", "foo"],
    ["explain", "--json"],
    ["explain", "--root", "/tmp"],
    ["explain", "--group", "start"],
    ["explain", "foo", "bar", "--baz"]
  ]) {
    const streams = captureStreams();
    assert.equal(runCli(argv, streams), 1, `${argv.join(" ")} must be a usage error`);
    assert.equal(streams.stdoutText, "", `${argv.join(" ")} must print nothing on stdout`);
    assert.match(streams.stderrText, /unsupported argument/u);
    assert.match(streams.stderrText, /usage: h2a explain \[--help\]/u);
  }

  // Accepted spellings, all printing the same map with exit 0.
  const bare = captureStreams();
  assert.equal(runCli(["explain"], bare), 0);
  for (const flag of ["--help", "-h"]) {
    const streams = captureStreams();
    assert.equal(runCli(["explain", flag], streams), 0, `explain ${flag} must succeed`);
    assert.equal(streams.stdoutText, bare.stdoutText, `explain ${flag} must print the same map`);
    assert.equal(streams.stderrText, "");
  }

  // The contract and the binary must agree — that was the actual defect.
  const contract = H2A_CLI_VERB_CONTRACTS.find((c) => c.verb === "explain");
  assert.ok(contract, "the explain contract entry vanished");
  assert.deepEqual([...contract.exitCodes].sort(), [0, 1], "contract must declare the usage-error exit");
  assert.deepEqual([...contract.optionalFlags], ["help"], "contract must declare --help as the only flag");
  assert.deepEqual([...contract.requiredFlags], []);
});

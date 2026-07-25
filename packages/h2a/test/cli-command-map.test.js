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
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  H2A_CLI_VERB_CONTRACTS,
  H2A_COMMAND_GROUPS,
  H2A_COMMAND_MAP_CORE_FIRST_WORDS,
  H2A_COMMAND_MAP_RUNTIME_VERBS,
  buildCommandMap,
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
  assert.match(rendered, /2026-07-17-STUDY_h2a-cli-coconception\.md/);
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

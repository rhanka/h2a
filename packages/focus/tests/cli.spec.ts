/**
 * Unit specs for the read-only Focus CLI driver (`@sentropic/focus/cli`, Focus-M1 L3).
 *
 * Runs the CLI `run([...])` end-to-end against the L2 `.track` fixture event log
 * (`tests/.track/events.jsonl`, decision `01JFOCUSDECISION00000000000`, workspace `focus`) for each
 * `--format` (terminal / md / html), asserting legacy dossiers refuse presentation with readable
 * diagnostics and no stdout. Also asserts the non-zero exit codes + clear stderr message on a missing
 * decision-id, an unknown decision, a missing --workspace, and an unknown --format. READ-ONLY: the
 * CLI never writes a track event (the fixture is unchanged between runs).
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { Track, EventStore } from "@sentropic/track";

import { run } from "../src/cli/index.js";
import { validateDecisionDossierForPresentation } from "../src/validation/index.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as new (opts: { strict: boolean }) => {
  compile: (schema: unknown) => ((value: unknown) => boolean) & { errors: unknown[] | null };
};
const validateV1Schema = new Ajv2020({ strict: false }).compile(
  require("../schemas/decision-dossier-document.v1.schema.json"),
);

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = mkdtempSync(join(tmpdir(), "focus-read-fixture-"));
const eventsPath = join(fixtureDir, "events.jsonl");
copyFileSync(join(here, ".track", "events.jsonl"), eventsPath);
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
const DECISION_ID = "01JFOCUSDECISION00000000000";

/** Capture stdout + stderr into buffers so the CLI can be asserted without touching globals. */
function capture(): {
  out: string;
  err: string;
  deps: { out: (t: string) => void; error: (t: string) => void };
} {
  const sink = { out: "", err: "" };
  return {
    get out() {
      return sink.out;
    },
    get err() {
      return sink.err;
    },
    deps: {
      out: (t: string) => {
        sink.out += t;
      },
      error: (t: string) => {
        sink.err += `${t}\n`;
      },
    },
  };
}

const baseArgs = (format: string): string[] => [
  DECISION_ID,
  "--workspace",
  "focus",
  "--events-path",
  eventsPath,
  "--format",
  format,
];

describe("focus CLI — blocks legacy decision presentation without inventing missing information", () => {
  it.each(["terminal", "md", "html", "json"])("refuses %s with an actionable diagnostic and no stdout", async (format) => {
    const c = capture();
    expect(await run(baseArgs(format), c.deps)).toBe(1);
    expect(c.out).toBe("");
    expect(c.err).toContain("owner request");
    expect(c.err).toContain("$.readability.ownerRequestQuote");
  });
  it("also enforces the gate for the default terminal presentation", async () => {
    const c = capture();
    expect(await run([DECISION_ID, "--workspace", "focus", "--events-path", eventsPath], c.deps)).toBe(1);
    expect(c.out).toBe("");
    expect(c.err).toContain("missing_owner_request");
  });
});

describe("focus CLI — error handling (non-zero + clear stderr)", () => {
  it("exits 2 with a usage message when the <decision-id> is missing", async () => {
    const c = capture();
    const code = await run(["--workspace", "focus", "--events-path", eventsPath], c.deps);
    expect(code).toBe(2);
    expect(c.err).toContain("Missing <decision-id>");
    expect(c.out).toBe("");
  });

  it("exits 2 with a usage message when --workspace is missing", async () => {
    const c = capture();
    const code = await run([DECISION_ID, "--events-path", eventsPath], c.deps);
    expect(code).toBe(2);
    expect(c.err).toContain("Missing --workspace");
  });

  it("exits 2 with a usage message on an unknown --format", async () => {
    const c = capture();
    const code = await run(
      [DECISION_ID, "--workspace", "focus", "--events-path", eventsPath, "--format", "pdf"],
      c.deps,
    );
    expect(code).toBe(2);
    expect(c.err).toContain('Unknown --format "pdf"');
  });

  it("exits 3 with a not-found message on an unknown decision id", async () => {
    const c = capture();
    const code = await run(
      [
        "01JNOSUCHDECISION0000000000",
        "--workspace",
        "focus",
        "--events-path",
        eventsPath,
        "--format",
        "terminal",
      ],
      c.deps,
    );
    expect(code).toBe(3);
    expect(c.err).toContain("not found");
    expect(c.out).toBe("");
  });
});

describe("focus CLI — readable Track decisions", () => {
  it.each(["terminal", "md", "html", "default"])("renders %s, escapes HTML and leaves the log untouched", async (format) => {
    const path = join(mkdtempSync(join(fixtureDir, "readable-" + format + "-")), "events.jsonl");
    const track = new Track(new EventStore(path), { by: "owner" });
    const target = track.createItem({ kind: "feature", title: "Garden shed", workspace: "garden" });
    const dossier = JSON.parse(readFileSync(new URL("./readable-track.fixture.json", import.meta.url), "utf8"));
    const id = track.createDecision({ decisionKind: "orientation", title: "Choose the garden shed location", workspace: "garden", targets: [target], dossier });
    const before = readFileSync(path, "utf8");
    const c = capture();
    const args = [id, "--workspace", "garden", "--events-path", path];
    if (format !== "default") args.push("--format", format);
    expect(await run(args, c.deps)).toBe(0);
    expect(c.err).toBe("");
    expect(c.out).toContain("Choose the garden shed location");
    expect(c.out).toContain(dossier.readability.ownerRequestQuote);
    expect(c.out).toContain("A short walk and a clear terrace view.");
    expect(c.out).toContain("préco: Along the side wall, because");
    if (format === "html") {
      expect(c.out).toContain('&lt;script&gt;alert("shed")&lt;/script&gt; &amp; comfort');
      expect(c.out).not.toContain('<script>');
    }
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("focus CLI — --format json (U-19)", () => {
  it("emits a presentation-validated v1 DecisionDossierDocument and leaves the log untouched", async () => {
    const path = join(mkdtempSync(join(fixtureDir, "readable-json-")), "events.jsonl");
    const track = new Track(new EventStore(path), { by: "owner" });
    const target = track.createItem({ kind: "feature", title: "Garden shed", workspace: "garden" });
    const dossier = JSON.parse(readFileSync(new URL("./readable-track.fixture.json", import.meta.url), "utf8"));
    const id = track.createDecision({ decisionKind: "orientation", title: "Choose the garden shed location", workspace: "garden", targets: [target], dossier });
    const before = readFileSync(path, "utf8");
    const c = capture();
    expect(await run([id, "--workspace", "garden", "--events-path", path, "--format", "json"], c.deps)).toBe(0);
    expect(c.err).toBe("");
    expect(c.out.endsWith("}\n")).toBe(true);
    const doc = JSON.parse(c.out) as Record<string, unknown>;
    // v1 is selected by the ABSENCE of schemaVersion (decision-dossier-document.v2.schema.json).
    expect("schemaVersion" in doc).toBe(false);
    expect(doc.title).toBe("Choose the garden shed location");
    expect(validateDecisionDossierForPresentation(doc).ok).toBe(true);
    expect(validateV1Schema(doc), JSON.stringify(validateV1Schema.errors)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

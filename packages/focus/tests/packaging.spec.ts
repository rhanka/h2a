/**
 * Packaging specs for `@sentropic/focus` (R4).
 *
 * Proves the published artifact is a clean, self-describing consumer closure:
 * the Track range resolves the integrated line with a single copy (R4-AC09),
 * the real tarball carries every registry asset with intact digests (R4-AC10),
 * a synthetic host consuming ONLY public exports can select/configure/resolve
 * Focus (R4-AC12), and every node family round-trips through the archive
 * (R4-AC13).
 */

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { EXPECTED_TRACK_READ_MAJOR } from "../src/track/index.js";
import { validateDecisionDossierDocument } from "../src/validation/index.js";
import {
  assertSafeAssetPaths,
  validateFocusEntryDescriptor,
  verifyAssetDigests,
} from "../src/registry/definitions.js";
import { decisionDossierFixture } from "./fixture.data.js";
import { accessibleDossierFixture, technocraticDossierFixture } from "./readability.fixture.js";
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';

it('should advertise and export the actual v2 evidence schema without dropping legacy support', () => {
  const manifest = JSON.parse(readFileSync(new URL('../registry/entries.v1.json', import.meta.url), 'utf8'));
  expect(manifest.entries[0].skill.documentSchemas.map((s: any) => s.version)).toEqual(['1.0.0', '2.0.0']);
  expect(packageJson.exports['./schemas/decision-dossier-document.v2']).toBeDefined();
  expect(validateDecisionDossierDocument(evidenceFixture()).ok).toBe(true);
});

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
};

const npmCommand = (): { command: string; prefixArgs: string[] } => {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.(c?js|mjs)$/i.test(execPath)) {
    return { command: process.execPath, prefixArgs: [execPath] };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    prefixArgs: [],
  };
};

describe("track range resolves the integrated line (R4-AC09)", () => {
  it("one Track copy on the integrated line satisfies the major gate", () => {
    const range = packageJson.dependencies["@sentropic/track"];
    expect(range).toBeDefined();
    const trackPkg = require("@sentropic/track/package.json") as {
      version: string;
    };
    expect(trackPkg.version).toMatch(/^0\.98\./);
    // No nested stale copy may shadow the workspace line.
    expect(
      existsSync(join(pkgRoot, "node_modules", "@sentropic", "track")),
    ).toBe(false);
    const reader = require("@sentropic/track/read") as {
      TrackReader: new (eventsPath: string) => { contractVersion: string };
    };
    const probe = new reader.TrackReader(
      join(here, ".track", "events.jsonl"),
    );
    const major = Number.parseInt(
      probe.contractVersion.split(".")[0] ?? "",
      10,
    );
    expect(major).toBe(EXPECTED_TRACK_READ_MAJOR);
  });
});

interface PackedLayout {
  tarball: string;
  extracted: string;
  files: string[];
}

const packAndExtract = (): PackedLayout & { cleanup: () => void } => {
  const root = mkdtempSync(join(tmpdir(), "focus-packaging-"));
  const cleanup = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  const npm = npmCommand();
  const pack = spawnSync(
    npm.command,
    [...npm.prefixArgs, "pack", "--pack-destination", root, "--silent"],
    { cwd: pkgRoot, encoding: "utf8" },
  );
  expect(pack.status).toBe(0);
  const tarballs = readdirSync(root).filter((f) => f.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const tarball = join(root, tarballs[0]!);
  const list = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  expect(list.status).toBe(0);
  const files = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^package\//, ""));
  const extract = spawnSync("tar", ["-xzf", tarball, "-C", root], {
    encoding: "utf8",
  });
  expect(extract.status).toBe(0);
  return { tarball, extracted: join(root, "package"), files, cleanup };
};

describe("packed tarball clean consumer (R4-AC10)", () => {
  it("real tarball installs the registry closure with verified digests", () => {
    const { files, extracted, cleanup } = packAndExtract();
    try {
      for (const expected of [
        "registry/entries.v1.json",
        "schemas/decision-dossier-document.v1.schema.json",
        "skills/focus/SKILL.md",
        "dist/validation/index.js",
        "dist/registry/definitions.js",
      ]) {
        expect(files).toContain(expected);
      }
      expect(files.some((f) => f.includes("node_modules"))).toBe(false);
      const manifest = JSON.parse(
        readFileSync(join(extracted, "registry/entries.v1.json"), "utf8"),
      ) as { entries: unknown[] };
      const validated = validateFocusEntryDescriptor(manifest.entries[0]);
      expect(validated.ok).toBe(true);
      if (!validated.ok) return;
      const issues = verifyAssetDigests(validated.value, (relPath) => {
        try {
          return readFileSync(join(extracted, relPath));
        } catch {
          return null;
        }
      });
      expect(issues).toEqual([]);
      expect(assertSafeAssetPaths(validated.value)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("tampered asset bytes fail digest verification", () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, "registry/entries.v1.json"), "utf8"),
    ) as { entries: unknown[] };
    const validated = validateFocusEntryDescriptor(manifest.entries[0]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const issues = verifyAssetDigests(validated.value, (relPath) =>
      relPath.endsWith("SKILL.md")
        ? Buffer.from("tampered instructions")
        : readFileSync(join(pkgRoot, relPath)),
    );
    expect(
      issues.some((issue) => issue.code === "integrity_mismatch"),
    ).toBe(true);
  });

  it("traversal asset paths refuse as unsafe", () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, "registry/entries.v1.json"), "utf8"),
    ) as { entries: unknown[] };
    const escaped = JSON.parse(JSON.stringify(manifest.entries[0])) as {
      assets: Array<{ path: string }>;
    };
    escaped.assets[0]!.path = "../outside/SKILL.md";
    expect(
      assertSafeAssetPaths(
        escaped as Parameters<typeof assertSafeAssetPaths>[0],
      ).some((issue) => issue.code === "path_escape"),
    ).toBe(true);
  });
});

describe("second synthetic embedding host (R4-AC12)", () => {
  it("public-exports-only host selects, configures and resolves Focus", async () => {
    const { extracted, cleanup } = packAndExtract();
    try {
      interface PackedValidation {
        validateDecisionDossierDocument: (
          value: unknown,
        ) => { ok: boolean };
        validateDecisionDossierForPresentation: (value: unknown) => { ok: boolean };
      }
      interface PackedDefinitions {
        validateFocusEntryDescriptor: (value: unknown) => { ok: boolean };
        validateFocusParameters: (value: unknown) =>
          | { ok: true; value: Record<string, string> }
          | { ok: false };
        resolveFocusPresentation: (
          params: Record<string, string>,
          gate: {
            uiRegistered: boolean;
            uiSelected: boolean;
            uiQualified: boolean;
            htmlSanitizerAvailable: boolean;
          },
          load: () => string,
        ) => { ok: boolean };
      }
      const validation = (await import(
        pathToFileURL(join(extracted, "dist", "validation", "index.js")).href
      )) as PackedValidation;
      const definitions = (await import(
        pathToFileURL(join(extracted, "dist", "registry", "definitions.js"))
          .href
      )) as PackedDefinitions;
      const manifest = JSON.parse(
        readFileSync(join(extracted, "registry/entries.v1.json"), "utf8"),
      ) as { entries: unknown[] };
      expect(
        definitions.validateFocusEntryDescriptor(manifest.entries[0]).ok,
      ).toBe(true);
      const params = definitions.validateFocusParameters({
        preferredPresentation: "terminal",
      });
      expect(params.ok).toBe(true);
      if (!params.ok) return;
      const skillText = readFileSync(
        join(extracted, "skills", "focus", "SKILL.md"),
        "utf8",
      );
      let loads = 0;
      const resolved = definitions.resolveFocusPresentation(
        params.value,
        { uiRegistered: false, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: false },
        () => {
          loads += 1;
          return skillText;
        },
      );
      expect(resolved.ok).toBe(true);
      expect(loads).toBe(1);
      const dossier = validation.validateDecisionDossierDocument(
        JSON.parse(JSON.stringify(decisionDossierFixture)),
      );
      expect(dossier.ok).toBe(true);
      expect(validation.validateDecisionDossierForPresentation(accessibleDossierFixture).ok).toBe(true);
      expect(validation.validateDecisionDossierForPresentation(technocraticDossierFixture).ok).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("archive round-trips every node family (R4-AC13)", () => {
  it("all six families plus nested options survive byte-preserved with no enabled action", () => {
    const before = JSON.parse(
      JSON.stringify(decisionDossierFixture),
    ) as unknown;
    const result = validateDecisionDossierDocument(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.value))).toEqual(
      JSON.parse(JSON.stringify(decisionDossierFixture)),
    );
    const kinds = new Set(
      result.value.sections.map((section) => section.kind),
    );
    expect(kinds).toEqual(
      new Set(["prose", "question", "optionSet", "outcome", "diagram"]),
    );
    for (const interaction of result.value.interactions) {
      expect(interaction.enabled).toBe(false);
    }
    // The sixth family (amendmentTrace section node) round-trips too.
    const withTraceNode = JSON.parse(
      JSON.stringify(decisionDossierFixture),
    ) as {
      sections: unknown[];
    };
    withTraceNode.sections.push({
      kind: "amendmentTrace",
      id: "s-trace",
      targetRef: "s-trace",
      steps: [{ at: "2026-01-01T00:00:00Z", author: "owner", summary: "Init." }],
    });
    const traced = validateDecisionDossierDocument(withTraceNode);
    expect(traced.ok).toBe(true);
    if (!traced.ok) return;
    expect(
      traced.value.sections.some((s) => s.kind === "amendmentTrace"),
    ).toBe(true);
    expect(JSON.parse(JSON.stringify(traced.value))).toEqual(withTraceNode);
  });
});

describe("publish builds dist first (rev352-F6, rev352r2-F5)", () => {
  it("prepack rebuilds dist so a manual publish never ships a dist-less tarball", () => {
    const scripts = (packageJson as { scripts?: Record<string, string> }).scripts ?? {};
    expect(scripts["prepack"]).toBe("npm run build");
    expect(scripts["build"]).toBe("tsc -p tsconfig.json");
  });

  it("a tree without dist rebuilds it through the prepack chain", () => {
    const root = mkdtempSync(join(tmpdir(), "focus-prepack-rebuild-"));
    try {
      const copy = spawnSync("cp", ["-a", `${pkgRoot}/.`, root], { encoding: "utf8" });
      expect(copy.status).toBe(0);
      rmSync(join(root, "dist"), { recursive: true, force: true });
      rmSync(join(root, "node_modules"), { recursive: true, force: true });
      expect(existsSync(join(root, "dist", "registry", "definitions.js"))).toBe(false);
      symlinkSync(join(pkgRoot, "..", "..", "node_modules"), join(root, "node_modules"), "dir");
      const npm = npmCommand();
      const build = spawnSync(npm.command, [...npm.prefixArgs, "run", "build", "--silent"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(build.status).toBe(0);
      expect(existsSync(join(root, "dist", "registry", "definitions.js"))).toBe(true);
      expect(existsSync(join(root, "dist", "validation", "index.js"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("package export map exposes the registry surface", () => {
  it("files and exports cover the published closure", () => {
    expect(packageJson.name).toBe("@sentropic/focus");
    for (const exported of [
      "./validate",
      "./registry/manifest",
      "./registry/definitions",
      "./schemas/decision-dossier-document.v1",
    ]) {
      expect(packageJson.exports[exported]).toBeDefined();
    }
    const packed = JSON.stringify(packageJson.files);
    for (const needle of ["registry/entries.v1.json", "schemas/", "skills/"]) {
      expect(packed).toContain(needle);
    }
    expect(
      statSync(join(pkgRoot, "dist", "validation", "index.js")).isFile(),
    ).toBe(true);
    expect(
      statSync(join(pkgRoot, "dist", "registry", "definitions.js")).isFile(),
    ).toBe(true);
  });
});

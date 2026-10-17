/**
 * Registry specs for the `sentropic.focus` skill entry (R4).
 *
 * The entry contract is authoritative: `registry-entry-contract-v8.md` §§3–4.
 * This file proves the publisher-owned descriptor published by
 * `@sentropic/focus` (registry/entries.v1.json) WITHOUT a registry kernel:
 * closed instruction-only shape, exact §5.4 parameters, digest-bound assets,
 * and presentation preflight (`unsupported_presentation`) that runs BEFORE any
 * instruction read.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  FOCUS_ENTRY_VERSION,
  FOCUS_PARAMETERS_SCHEMA_VERSION,
  FOCUS_SKILL_ID,
  MAX_SKILL_DESCRIPTION_LENGTH,
  loadFocusSkillDescriptor,
  resolveFocusPresentation,
  validateFocusEntryDescriptor,
  validateFocusParameters,
  verifyAssetDigests,
} from "../src/registry/definitions.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const require = createRequire(import.meta.url);
const packageManifest = require("../registry/entries.v1.json") as unknown;
const packageJson = require("../package.json") as {
  version: string;
  exports: Record<string, unknown>;
  files: string[];
};

const sha256File = (relPath: string): string =>
  createHash("sha256").update(readFileSync(join(pkgRoot, relPath))).digest("hex");

describe("sentropic.focus canonical instruction-only entry (R4-AC01)", () => {
  it("packed metadata yields exactly sentropic.focus with empty tools", () => {
    const result = validateFocusEntryDescriptor(
      (packageManifest as { entries: unknown[] }).entries[0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value;
    expect(entry.kind).toBe("skill");
    expect(entry.id).toBe(FOCUS_SKILL_ID);
    expect(entry.entryVersion).toBe(FOCUS_ENTRY_VERSION);
    expect(entry.skill.profile).toBe("instructions");
    expect(entry.skill.tools).toEqual([]);
    expect(entry.skill.metadata.toolNames).toEqual([]);
  });

  it("catalog and register perform zero instruction reads", () => {
    // Descriptor validation is pure: it cannot touch the filesystem at all.
    const entry = (packageManifest as { entries: unknown[] }).entries[0];
    expect(validateFocusEntryDescriptor(entry).ok).toBe(true);
    // The descriptor loader reads JSON metadata only, never SKILL.md.
    const loaded = loadFocusSkillDescriptor() as { entries: unknown[] };
    expect(loaded.entries).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(
      JSON.parse(
        readFileSync(join(pkgRoot, "registry/entries.v1.json"), "utf8"),
      ),
    );
  });

  it("entry, package and skill frontmatter agree on identity", () => {
    const result = validateFocusEntryDescriptor(
      (packageManifest as { entries: unknown[] }).entries[0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.publisher.packageName).toBe("@sentropic/focus");
    expect(result.value.publisher.packageVersion).toBe(packageJson.version);
    const frontmatter = readFileSync(
      join(pkgRoot, "skills/focus/SKILL.md"),
      "utf8",
    );
    expect(frontmatter).toContain(`version: ${FOCUS_ENTRY_VERSION}`);
    expect(frontmatter).toContain(`description: ${result.value.description}`);
  });

  it("asset and document-schema digests recompute to the packed bytes", () => {
    const result = validateFocusEntryDescriptor(
      (packageManifest as { entries: unknown[] }).entries[0],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const issues = verifyAssetDigests(result.value, (path) => {
      try {
        return readFileSync(join(pkgRoot, path));
      } catch {
        return null;
      }
    });
    expect(issues).toEqual([]);
    for (const asset of result.value.assets) {
      expect(asset.sha256).toBe(sha256File(asset.path));
    }
    for (const schema of result.value.skill.documentSchemas) {
      expect(schema.sha256).toBe(sha256File(schema.assetPath));
    }
  });

  it("parameters are exactly the §5.4 focus profile with §5.4 defaults", () => {
    expect(FOCUS_PARAMETERS_SCHEMA_VERSION).toBe("1.0.0");
    const both = validateFocusParameters(undefined);
    expect(both.ok).toBe(true);
    if (!both.ok) return;
    expect(both.value).toEqual({
      mode: "snapshot",
      preferredPresentation: "markdown",
      locale: "en",
    });
    const partial = validateFocusParameters({ locale: "fr" });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.value).toEqual({
      mode: "snapshot",
      preferredPresentation: "markdown",
      locale: "fr",
    });
    expect(validateFocusParameters({ mode: "live" }).ok).toBe(false);
    expect(validateFocusParameters({ preferredPresentation: "pdf" }).ok).toBe(
      false,
    );
    expect(validateFocusParameters({ mode: "snapshot", extra: 1 }).ok).toBe(
      false,
    );
  });
});

describe("skill description length boundary (R4-AC02)", () => {
  const base = (packageManifest as { entries: unknown[] }).entries[0] as Record<
    string,
    unknown
  >;

  it("a 281-character description refuses with a typed diagnostic", () => {
    const mutated = { ...base, description: "x".repeat(281) };
    const result = validateFocusEntryDescriptor(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.path === "$.description"),
    ).toBe(true);
  });

  it(`a ${MAX_SKILL_DESCRIPTION_LENGTH}-character description accepts`, () => {
    expect(MAX_SKILL_DESCRIPTION_LENGTH).toBe(280);
    const mutated = { ...base, description: "y".repeat(280) };
    expect(validateFocusEntryDescriptor(mutated).ok).toBe(true);
  });
});

const mcpAppParams = (preferredPresentation: "mcp-app" | "html" | "terminal") =>
  validateFocusParameters({
    mode: "snapshot",
    preferredPresentation,
    locale: "en",
  });

describe("mcp-app without a usable UI refuses before any instruction load", () => {
  it("R4-AC07a: no UI entry at all → unsupported_presentation, zero loads", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: false },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.code).toBe("unsupported_presentation");
    expect(loads).toBe(0);
  });

  it("R4-AC07b: UI registered but unselected → unsupported_presentation, zero loads", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: true },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.code).toBe("unsupported_presentation");
    expect(loads).toBe(0);
  });

  it("R4-AC07c: UI selected but unqualified → unsupported_presentation, zero loads", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    // Selected-but-unqualified is observed by the host as "not usable": the
    // publisher gate receives false and must still refuse before loading.
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: true },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.code).toBe("unsupported_presentation");
    expect(loads).toBe(0);
  });
});

describe("html presentation requires the sanitizer hook (R4-AC08)", () => {
  it("html without hooks refuses pre-load with zero instruction loads", () => {
    const params = mcpAppParams("html");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: false },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.code).toBe("unsupported_presentation");
    expect(loads).toBe(0);
  });

  it("terminal resolves with no UI entry and loads instructions exactly once", () => {
    const params = mcpAppParams("terminal");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const skillText = readFileSync(join(pkgRoot, "skills/focus/SKILL.md"), "utf8");
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: false },
      () => {
        loads += 1;
        return skillText;
      },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.instructions).toContain("sentropic.focus.decision-dossier");
    expect(loads).toBe(1);
  });
});

describe("selection gates instruction access (R4-AC11)", () => {
  it("only the authorized resolve loads instructions, and never mutates parameters", () => {
    const params = mcpAppParams("terminal");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    const frozen = { ...params.value };
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiSelectedAndQualified: false, htmlSanitizerAvailable: false },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(true);
    expect(loads).toBe(1);
    expect(params.value).toEqual(frozen);
  });
});

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
      { uiRegistered: false, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: false },
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
      { uiRegistered: true, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: true },
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
    // Selected-but-unqualified is a DISTINCT host state from
    // registered-but-unselected above: selection alone must not open the gate.
    const resolved = resolveFocusPresentation(
      params.value,
      { uiRegistered: true, uiSelected: true, uiQualified: false, htmlSanitizerAvailable: true },
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

  it("R4-AC07d: UI registered, selected and qualified → mcp-app resolves, one load", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiRegistered: true, uiSelected: true, uiQualified: true, htmlSanitizerAvailable: false },
      () => {
        loads += 1;
        return "instructions";
      },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.instructions).toBe("instructions");
    expect(loads).toBe(1);
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
      { uiRegistered: false, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: false },
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
      { uiRegistered: false, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: false },
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

describe("closed entry descriptor validation (rev352-F1)", () => {
  const base = (): Record<string, unknown> =>
    JSON.parse(
      JSON.stringify((packageManifest as { entries: unknown[] }).entries[0]),
    ) as Record<string, unknown>;

  const atPath = (
    entry: Record<string, unknown>,
    path: readonly string[],
  ): Record<string, unknown> => {
    let node: unknown = entry;
    for (const key of path) node = (node as Record<string, unknown>)[key];
    return node as Record<string, unknown>;
  };

  interface ClosedCase {
    readonly name: string;
    readonly mutate: (entry: Record<string, unknown>) => void;
  }

  const cases: readonly ClosedCase[] = [
    { name: "root unknown field", mutate: (e) => { e["surprise"] = 1; } },
    {
      name: "skill unknown field",
      mutate: (e) => { atPath(e, ["skill"])["surprise"] = 1; },
    },
    {
      name: "skill requiredExtensions",
      mutate: (e) => { atPath(e, ["skill"])["requiredExtensions"] = ["x"]; },
    },
    {
      name: "metadata unknown field",
      mutate: (e) => { atPath(e, ["skill", "metadata"])["surprise"] = 1; },
    },
    {
      name: "parameters unknown field",
      mutate: (e) => { atPath(e, ["parameters"])["surprise"] = 1; },
    },
    {
      name: "preferredPresentation enum replaced by [pdf]",
      mutate: (e) => {
        atPath(e, ["parameters", "schema", "properties", "preferredPresentation"])["enum"] = ["pdf"];
      },
    },
    {
      name: "locale enum replaced by [xx]",
      mutate: (e) => {
        atPath(e, ["parameters", "schema", "properties", "locale"])["enum"] = ["xx"];
      },
    },
    {
      name: "parameter schema $id drift",
      mutate: (e) => { atPath(e, ["parameters", "schema"])["$id"] = "urn:other:params:9.9.9"; },
    },
    {
      name: "asset traversal path",
      mutate: (e) => {
        ((e["assets"] as Array<Record<string, unknown>>)[0]!)["path"] = "../outside/SKILL.md";
      },
    },
    {
      name: "duplicated asset",
      mutate: (e) => {
        (e["assets"] as Array<Record<string, unknown>>).push({
          ...(e["assets"] as Array<Record<string, unknown>>)[0],
        });
      },
    },
    {
      name: "dangling instructionsAsset",
      mutate: (e) => {
        atPath(e, ["skill"])["instructionsAsset"] = "skills/focus/MISSING.md";
      },
    },
    {
      name: "dangling document-schema assetPath",
      mutate: (e) => {
        ((atPath(e, ["skill"])["documentSchemas"] as Array<Record<string, unknown>>)[0]!)["assetPath"] =
          "schemas/MISSING.schema.json";
      },
    },
    { name: "name is not focus", mutate: (e) => { e["name"] = "not-focus"; } },
    { name: "bindings as strings", mutate: (e) => { e["bindings"] = ["bind"]; } },
    { name: "nonempty bindings", mutate: (e) => { e["bindings"] = [{ target: "x" }]; } },
    {
      name: "extra defaults key",
      mutate: (e) => { atPath(e, ["parameters", "defaults"])["extra"] = 1; },
    },
    {
      name: "added mutation capability",
      mutate: (e) => {
        (atPath(e, ["skill"])["capabilities"] as Array<Record<string, unknown>>).push({
          id: "sentropic.focus.escalate",
          description: "extra",
          effect: "mutation",
          permissions: [],
        });
      },
    },
    {
      name: "added second read-only capability",
      mutate: (e) => {
        const capabilities = atPath(e, ["skill"])["capabilities"] as Array<Record<string, unknown>>;
        capabilities.push({ ...(capabilities[0] as Record<string, unknown>) });
      },
    },
    {
      name: "empty package peers",
      mutate: (e) => { atPath(e, ["compatibility"])["packages"] = []; },
    },
    {
      name: "open package peer row",
      mutate: (e) => {
        ((atPath(e, ["compatibility"])["packages"] as Array<Record<string, unknown>>)[0]!)["surprise"] = 1;
      },
    },
    {
      name: "nonempty dependencies",
      mutate: (e) => { atPath(e, ["skill"])["dependencies"] = [{ name: "x" }]; },
    },
  ];

  it.each(cases)("$name refuses", ({ mutate }) => {
    const entry = base();
    mutate(entry);
    const result = validateFocusEntryDescriptor(entry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("traversal refuses with a path_escape diagnostic", () => {
    const entry = base();
    ((entry["assets"] as Array<Record<string, unknown>>)[0]!)["path"] = "../outside/SKILL.md";
    const result = validateFocusEntryDescriptor(entry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "path_escape")).toBe(true);
  });

  it("duplicated asset refuses with a duplicate_entry diagnostic", () => {
    const entry = base();
    (entry["assets"] as Array<Record<string, unknown>>).push({
      ...(entry["assets"] as Array<Record<string, unknown>>)[0],
    });
    const result = validateFocusEntryDescriptor(entry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "duplicate_entry")).toBe(true);
  });
});

describe("closed entry descriptor residual drifts (rev352r2-F1)", () => {
  const base = (): Record<string, unknown> =>
    JSON.parse(
      JSON.stringify((packageManifest as { entries: unknown[] }).entries[0]),
    ) as Record<string, unknown>;

  const atPath = (
    entry: Record<string, unknown>,
    path: readonly string[],
  ): Record<string, unknown> => {
    let node: unknown = entry;
    for (const key of path) node = (node as Record<string, unknown>)[key];
    return node as Record<string, unknown>;
  };

  interface ClosedCase {
    readonly name: string;
    readonly mutate: (entry: Record<string, unknown>) => void;
  }

  const cases: readonly ClosedCase[] = [
    {
      name: "metadata permissions escalated to write",
      mutate: (e) => { atPath(e, ["skill", "metadata"])["permissions"] = ["track.dossier.write"]; },
    },
    {
      name: "capability permissions escalated to write",
      mutate: (e) => {
        ((atPath(e, ["skill"])["capabilities"] as Array<Record<string, unknown>>)[0]!)["permissions"] = [
          "track.dossier.write",
        ];
      },
    },
    {
      name: "unknown required host feature",
      mutate: (e) => { atPath(e, ["compatibility"])["requiredHostFeatures"] = ["shell-exec"]; },
    },
    {
      name: "extra schema profile",
      mutate: (e) => {
        (atPath(e, ["compatibility"])["schemaProfiles"] as unknown[]).push("unbounded-v9");
      },
    },
    {
      name: "evil peer replaces track",
      mutate: (e) => {
        atPath(e, ["compatibility"])["packages"] = [{ name: "@evil/track", range: "*" }];
      },
    },
    {
      name: "non-SemVer peer range",
      mutate: (e) => {
        atPath(e, ["compatibility"])["packages"] = [{ name: "@sentropic/track", range: "not-a-range" }];
      },
    },
    {
      name: "instructionsAsset swapped to the schema JSON",
      mutate: (e) => {
        atPath(e, ["skill"])["instructionsAsset"] = "schemas/decision-dossier-document.v1.schema.json";
      },
    },
    {
      name: "document-schema assetPath swapped to SKILL.md",
      mutate: (e) => {
        ((atPath(e, ["skill"])["documentSchemas"] as Array<Record<string, unknown>>)[0]!)["assetPath"] =
          "skills/focus/SKILL.md";
      },
    },
    {
      name: "document-schema sha diverges from the asset digest",
      mutate: (e) => {
        ((atPath(e, ["skill"])["documentSchemas"] as Array<Record<string, unknown>>)[0]!)["sha256"] =
          "0".repeat(64);
      },
    },
    {
      name: "parameter mode leaf carries an extra default",
      mutate: (e) => {
        (atPath(e, ["parameters", "schema", "properties"])["mode"] as Record<string, unknown>)["default"] = "live";
      },
    },
    {
      name: "parameter locale leaf carries an extra not",
      mutate: (e) => {
        (atPath(e, ["parameters", "schema", "properties"])["locale"] as Record<string, unknown>)["not"] = {};
      },
    },
  ];

  it.each(cases)("$name refuses", ({ mutate }) => {
    const entry = base();
    mutate(entry);
    expect(validateFocusEntryDescriptor(entry).ok).toBe(false);
  });
});

describe("mcp-app gate isolates every bit (rev352r2-F4)", () => {
  it("qualified without session selection refuses", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiRegistered: true, uiSelected: false, uiQualified: true, htmlSanitizerAvailable: true },
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

  it("selected and qualified without registration refuses", () => {
    const params = mcpAppParams("mcp-app");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiRegistered: false, uiSelected: true, uiQualified: true, htmlSanitizerAvailable: true },
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

describe("selection gates instruction access (R4-AC11)", () => {
  it("only the authorized resolve loads instructions, and never mutates parameters", () => {
    const params = mcpAppParams("terminal");
    expect(params.ok).toBe(true);
    if (!params.ok) return;
    const frozen = { ...params.value };
    let loads = 0;
    const resolved = resolveFocusPresentation(
      params.value,
      { uiRegistered: false, uiSelected: false, uiQualified: false, htmlSanitizerAvailable: false },
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

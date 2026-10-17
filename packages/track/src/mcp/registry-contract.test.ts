import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, root), "utf8")) as unknown;
const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("R5 track registry entry (contract §§3.2/5.4)", () => {
  it("ships a closed sentropic.track envelope at contract 1.1.4", () => {
    const wrapper = readJson("registry/entries.v1.json") as {
      format: string;
      entries: Array<Record<string, unknown>>;
    };
    expect(wrapper.format).toBe("sentropic.registry-package/v1");
    expect(wrapper.entries).toHaveLength(1);
    const entry = wrapper.entries[0] as Record<string, unknown>;
    expect(entry["format"]).toBe("sentropic.registry-entry/v1");
    expect(entry["contractVersion"]).toBe("1.1.4");
    expect(entry["kind"]).toBe("mcp");
    expect(entry["id"]).toBe("sentropic.track");
    expect(entry["entryVersion"]).toMatch(/^\d+\.\d+\.\d+$/);
    const here = readJson("package.json") as { version: string };
    expect((entry["publisher"] as { packageVersion: string }).packageVersion).toBe(here.version);
  });

  it("declares the exact §5.4 read-only parameter profile", () => {
    const wrapper = readJson("registry/entries.v1.json") as {
      entries: Array<{ parameters: unknown }>;
    };
    expect(wrapper.entries[0].parameters).toEqual({
      schemaVersion: "1.0.0",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:sentropic:registry:parameters:sentropic.track:1.0.0",
        type: "object",
        additionalProperties: false,
        required: ["access", "repositoryBindingRef"],
        properties: {
          access: { const: "read-only" },
          repositoryBindingRef: { type: "string", minLength: 1, maxLength: 96, pattern: "^[a-z0-9][a-z0-9._-]*$" }
        }
      },
      defaults: { access: "read-only" }
    });
  });

  it("owns the exact Track read surface once, with pinned asset bytes", () => {
    const wrapper = readJson("registry/entries.v1.json") as {
      entries: Array<{
        assets: Array<{ path: string; sha256: string }>;
        mcp: { manifestAsset: string; capabilityProfiles: Array<{ id: string; tools: string[]; readOnly: boolean }> };
      }>;
    };
    const entry = wrapper.entries[0];
    for (const asset of entry.assets) {
      const bytes = readFileSync(new URL(asset.path, root));
      expect(sha256(bytes)).toBe(asset.sha256);
    }
    const manifest = readJson(entry.mcp.manifestAsset) as {
      providerId: string;
      tools: Array<{ name: string }>;
      resources: unknown[];
      prompts: unknown[];
    };
    expect(manifest.providerId).toBe("sentropic.track");
    const profile = entry.mcp.capabilityProfiles.find((p) => p.id === "read-only");
    expect(profile?.readOnly).toBe(true);
    expect(profile?.tools).toEqual(manifest.tools.map((t) => t.name));
    expect(new Set(profile?.tools).size).toBe(profile?.tools.length);
  });
});

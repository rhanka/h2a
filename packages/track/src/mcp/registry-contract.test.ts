import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("resolves the packaged manifest identically through the module export and the asset file", async () => {
    const mod = (await import("../../dist/registry/manifest.js")) as {
      trackRegistryPackageManifest: { entries: Array<{ id: string; mcp: { manifestAsset: string } }> };
    };
    const exported = mod.trackRegistryPackageManifest.entries[0] as { id: string; mcp: { manifestAsset: string } };
    expect(exported.id).toBe("sentropic.track");
    const asset = readJson(exported.mcp.manifestAsset) as { tools: Array<{ name: string }> };
    const direct = readJson("registry/manifest.track.json") as { tools: Array<{ name: string }> };
    expect(asset).toEqual(direct);
    const names = direct.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
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

  it("LOT-6 F-10: the packed tarball carries the registry assets with identical bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "track-l6-pack-"));
    try {
      const out = execFileSync("npm", ["pack", "--json", "--pack-destination", dir], {
        cwd: new URL("../../", import.meta.url).pathname,
        encoding: "utf8",
        timeout: 120000
      });
      const packed = JSON.parse(out) as Array<{ filename: string }>;
      expect(packed).toHaveLength(1);
      const tgz = join(dir, packed[0].filename);
      const names = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean);
      for (const asset of ["registry/entries.v1.json", "registry/manifest.track.json", "dist/registry/manifest.js"]) {
        expect(names.some((n) => n === `package/${asset}`)).toBe(true);
      }
      const extract = mkdtempSync(join(tmpdir(), "track-l6-unpack-"));
      try {
        execFileSync("tar", ["-xzf", tgz, "-C", extract]);
        const fromTar = (rel: string): string =>
          readFileSync(join(extract, "package", rel), "utf8");
        expect(fromTar("registry/manifest.track.json")).toBe(
          readFileSync(new URL("../../registry/manifest.track.json", import.meta.url), "utf8")
        );
        expect(fromTar("registry/entries.v1.json")).toBe(
          readFileSync(new URL("../../registry/entries.v1.json", import.meta.url), "utf8")
        );
      } finally {
        rmSync(extract, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

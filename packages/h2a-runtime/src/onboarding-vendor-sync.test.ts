/**
 * onboarding-core vendor sync guard (mirrors agy-claude-vendor-sync.test.ts).
 *
 * `src/onboarding-core.ts` is a vendored copy of
 * `packages/h2a/src/runtime/onboarding-core.ts` (core owns canonical source).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(HERE, "onboarding-core.ts");
const CANONICAL = join(HERE, "..", "..", "h2a", "src", "runtime", "onboarding-core.ts");

function stripProvenanceHeader(source: string): string {
  const lines = source.split("\n");
  let index = 0;
  while (index < lines.length && (lines[index]!.startsWith("//") || lines[index]!.trim() === "")) {
    index++;
  }
  return lines.slice(index).join("\n");
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    specs.push(match[1]!);
  }
  return specs;
}

describe("onboarding-core vendor sync", () => {
  it("keeps the vendored body identical to the canonical core copy", () => {
    const vendored = readFileSync(VENDORED, "utf8");
    const canonical = readFileSync(CANONICAL, "utf8");
    expect(stripProvenanceHeader(vendored)).toBe(stripProvenanceHeader(canonical));
  });

  it("keeps both copies free of non-node imports (no package edge)", () => {
    for (const file of [VENDORED, CANONICAL]) {
      const specs = importSpecifiers(readFileSync(file, "utf8"));
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(spec.startsWith("node:")).toBe(true);
      }
    }
  });
});

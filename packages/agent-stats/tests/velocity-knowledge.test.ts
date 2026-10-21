import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkApplicability, exportKnowledge, importKnowledge } from "../src/velocity/knowledge.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "velocity-l5-kn-"));
  tempDirs.push(dir);
  return dir;
}

describe("velocity T-V23 pin applicability", () => {
  it("marks digest or fingerprint change without erasing history", () => {
    tempRoot();
    const locked = { digest: "sha256:" + "a".repeat(64), fingerprint: { model: "a", ci: "old" } };
    const changed = checkApplicability({
      lockedDigest: locked.digest,
      currentDigest: "sha256:" + "b".repeat(64),
      lockedFingerprint: locked.fingerprint,
      currentFingerprint: { model: "a", ci: "new" },
    });
    expect(changed.applicability).toBe("conditional-historical");
    expect(changed.historyPreserved).toBe(true);
    const same = checkApplicability({
      lockedDigest: locked.digest,
      currentDigest: locked.digest,
      lockedFingerprint: locked.fingerprint,
      currentFingerprint: locked.fingerprint,
    });
    expect(same.applicability).toBe("applicable");
  });

  it("never lets an old snapshot bound a new regime", () => {
    tempRoot();
    const result = checkApplicability({
      lockedDigest: "sha256:" + "a".repeat(64),
      currentDigest: "sha256:" + "b".repeat(64),
      lockedFingerprint: { regime: "old" },
      currentFingerprint: { regime: "new" },
      allowOldSnapshot: false,
    });
    expect(result.boundsNewRegime).toBe(false);
  });
});

describe("velocity T-V24 separate authorities", () => {
  it("never admits engram memory and never mutates Track realization", () => {
    tempRoot();
    const exported = exportKnowledge({
      observations: [{ id: "1", value: 100 }],
      memory: { admitted: [{ lesson: "x" }], denied: [], stale: [], superseded: [] },
    });
    expect(exported.observations).toHaveLength(1);
    expect(exported.memoryAdmitted).toBe(0);
    expect(exported.trackMutated).toBe(false);
  });

  it("ignores stale, denied and superseded memory and works with memory absent", () => {
    tempRoot();
    const exported = exportKnowledge({
      observations: [{ id: "1", value: 100 }],
      memory: { admitted: [], denied: [{ lesson: "d" }], stale: [{ lesson: "s" }], superseded: [{ lesson: "p" }] },
    });
    expect(exported.observations[0].value).toBe(100);
    const absent = exportKnowledge({ observations: [{ id: "1", value: 100 }] });
    expect(absent.observations).toHaveLength(1);
    const imported = importKnowledge(exported.manifest, exported.observations);
    expect(imported.observations).toHaveLength(1);
  });
});

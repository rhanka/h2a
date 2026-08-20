import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectLegacyAccountArtifacts } from "../dist/index.js";

test("doctor reports legacy account-pool files by existence only", () => {
  const home = mkdtempSync(join(tmpdir(), "h2a-legacy-account-doctor-"));
  try {
    const state = join(home, ".sentropic");
    mkdirSync(state, { recursive: true });
    const credentialFile = join(state, "accounts-tokens.json");
    writeFileSync(credentialFile, "this is deliberately not JSON and must not be parsed\n");

    const diagnostic = inspectLegacyAccountArtifacts(home);

    assert.equal(diagnostic.ok, true);
    assert.equal(diagnostic.inert, true);
    assert.deepEqual(diagnostic.found, [credentialFile]);
    assert.match(diagnostic.message, /back them up/);
    assert.match(diagnostic.message, /h2a llm-mesh account enroll/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

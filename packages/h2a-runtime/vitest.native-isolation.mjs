import { afterEach } from "vitest";
import {
  ensureWorkerEnvironment,
  isPathWithinAttestedRoot,
  verifySandboxConfinement,
} from "../../scripts/test-sandbox-contract.mjs";

// Lot L0 (D16): verify confinement BEFORE evaluating any test or product
// module, then allocate a distinct per-worker root R/w-* (or I/w-* under
// IDLOCK_LANE) so sibling Vitest workers never collide and no suite can
// write to owner paths by omission.
const receipt = verifySandboxConfinement(process.env);
ensureWorkerEnvironment(receipt, process.env, { forceNewWorker: true, tag: "w-vitest-" });

const { assertNoNativeTestSpawnViolations } = await import(
  "../h2a/test/helpers/native-isolation.js"
);

// A production catch must not turn an unsafe test launch into a passing probe,
// and a suite must not redirect HOME/XDG_STATE_HOME back to owner state.
afterEach(() => {
  assertNoNativeTestSpawnViolations();
  for (const key of ["HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "TMPDIR"]) {
    const val = process.env[key];
    if (val && !isPathWithinAttestedRoot(val, receipt)) {
      throw new Error(`REFUSING test environment escape after test: ${key}=${val}`);
    }
  }
});

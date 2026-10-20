import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  assertConfinedTestEnvironment,
  assertNoNativeTestSpawnViolations,
  installNativeTestEnvironment,
  nativeQualificationRoot,
  nativeTestEnvironment,
} from "../h2a/test/helpers/native-isolation.js";

// Lot L0: this setup runs before any test-module code is evaluated.
// Refuse an unconfined invocation first (missing attestation or barrier),
// then establish one per-worker temp environment (HOME, XDG_*, TMPDIR,
// H2A_* roots) so suites with no explicit isolation still run on worker
// temp state — never on owner paths.
assertConfinedTestEnvironment(process.env);
{
  const workerRoot = mkdtempSync(join(nativeQualificationRoot, "vitest-w-"));
  // nativeTestEnvironment sets TMPDIR under the worker root (os.tmpdir()
  // follows TMPDIR), so child temp files stay inside the worker root.
  installNativeTestEnvironment(nativeTestEnvironment(workerRoot));
}

// A production catch must not turn an unsafe test launch into a passing probe.
afterEach(assertNoNativeTestSpawnViolations);

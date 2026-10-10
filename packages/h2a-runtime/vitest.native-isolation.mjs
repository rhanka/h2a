import { afterEach } from "vitest";
import { assertNoNativeTestSpawnViolations } from "../h2a/test/helpers/native-isolation.js";

// A production catch must not turn an unsafe test launch into a passing probe.
afterEach(assertNoNativeTestSpawnViolations);

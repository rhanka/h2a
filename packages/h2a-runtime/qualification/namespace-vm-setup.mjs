import { afterEach } from "vitest";
import { installVmFixture } from "../../../scripts/run-namespace-qualification.mjs";

const api = installVmFixture(process.env);

afterEach(() => {
  api.assertNoNativeTestSpawnViolations();
});

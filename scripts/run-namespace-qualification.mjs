// T10 requires real PID/network namespaces. Failure to create them fails the job.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
const root = mkdtempSync("/tmp/h2a-qual-");
const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
  "packages/h2a-runtime/qualification/namespace-publication.test.ts"], {
  env: { ...process.env, H2A_TEST_QUALIFICATION_ROOT: root }, stdio: "inherit",
});
child.once("error", error => { process.stderr.write(`${error}\n`); process.exitCode = 1; });
child.once("close", code => { rmSync(root, { recursive: true, force: true }); process.exitCode = code ?? 1; });

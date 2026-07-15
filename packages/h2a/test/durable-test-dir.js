import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Create an explicit repo-local workspace for tests that exercise loop launch specs. */
export function durableTestDir(prefix) {
  const configured = process.env.H2A_TEST_DURABLE_ROOT;
  const root = configured
    ? resolve(configured)
    : join(REPO_ROOT, "tmp", "test-runtime", "durable");
  if (configured && !isAbsolute(configured)) {
    throw new Error("H2A_TEST_DURABLE_ROOT must be absolute");
  }
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}

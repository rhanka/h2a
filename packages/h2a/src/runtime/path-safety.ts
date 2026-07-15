import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True when an existing path resolves inside the operating system's temp root. */
export function isOsTemporaryPath(candidate: string): boolean {
  return isWithin(realpathSync(tmpdir()), realpathSync(candidate));
}

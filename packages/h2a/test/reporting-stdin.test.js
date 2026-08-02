import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { readUtf8Stdin } from "../dist/runtime/reporting/stdin.js";

async function* chunkedInput() {
  yield Buffer.from("{\"schema\":");
  await new Promise((resolve) => setImmediate(resolve));
  yield "\"track.ai-report.context-envelope/v1\"}";
}

test("should consume a chunked report envelope from stdin", async () => {
  assert.equal(
    await readUtf8Stdin(chunkedInput()),
    "{\"schema\":\"track.ai-report.context-envelope/v1\"}"
  );
});

test("should consume a piped report envelope without a synchronous fd read", {
  // Parked owner decision: a real Windows platform defect (not a flaky test) is deferred under track 01KYJ3Q3V5AW9YR0QMXSGW93RE.
  skip: process.platform === "win32"
}, () => {
  const readerModule = pathToFileURL(new URL("../dist/runtime/reporting/stdin.js", import.meta.url).pathname).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { readUtf8Stdin } from ${JSON.stringify(readerModule)}; process.stdout.write(await readUtf8Stdin());`
    ],
    { input: "{\"schema\":\"track.ai-report.context-envelope/v1\"}", encoding: "utf8" }
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, "{\"schema\":\"track.ai-report.context-envelope/v1\"}");
  assert.equal(child.stderr, "");
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test("should consume a piped report envelope without a synchronous fd read", () => {
  const readerModule = new URL("../dist/runtime/reporting/stdin.js", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { readUtf8Stdin } from ${JSON.stringify(readerModule)}; process.stdout.write(await readUtf8Stdin());`
    ],
    {
      input: "{\"schema\":\"track.ai-report.context-envelope/v1\"}",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  const expectedStdout = "{\"schema\":\"track.ai-report.context-envelope/v1\"}";
  const diagnostics = `child error=${child.error?.stack ?? child.error?.message ?? "none"}; status=${child.status}; signal=${child.signal ?? "none"}; stdout=${JSON.stringify(child.stdout)}; stderr=${JSON.stringify(child.stderr)}`;
  if (child.error !== undefined || child.status !== 0 || child.stdout !== expectedStdout || child.stderr !== "") {
    console.error(`reporting-stdin child failure: ${diagnostics}`);
  }
  assert.equal(child.error, undefined, diagnostics);
  assert.equal(child.status, 0, diagnostics);
  assert.equal(child.stdout, expectedStdout, diagnostics);
  assert.equal(child.stderr, "", diagnostics);
});

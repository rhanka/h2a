import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../../../.dockerignore", import.meta.url), "utf8");

test("Docker builder copies Track's root build helper before npm run build", () => {
  const helperCopy = "COPY scripts/clean-workspace-dist.mjs scripts/";
  const helperCopyIndex = dockerfile.indexOf(helperCopy);
  const buildIndex = dockerfile.indexOf("RUN npm run build");

  assert.notEqual(helperCopyIndex, -1, `Dockerfile must include: ${helperCopy}`);
  assert.ok(helperCopyIndex < buildIndex, "the Track build helper must be copied before npm run build");
  assert.match(
    dockerignore,
    /^!scripts\/clean-workspace-dist\.mjs$/m,
    ".dockerignore must keep the Track build helper in the Docker context",
  );
});

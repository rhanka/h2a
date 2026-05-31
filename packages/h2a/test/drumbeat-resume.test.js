import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DRUMBEAT_RESUME_BODY_KIND,
  parseDrumbeatResumeBody
} from "../dist/index.js";

test("parseDrumbeatResumeBody accepts the D4 resume body", () => {
  const body = {
    kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
    target: "claude:remote",
    reason: "stopped",
    requestedBy: "codex:watch"
  };

  assert.deepEqual(parseDrumbeatResumeBody(body), body);
});

test("parseDrumbeatResumeBody is total and rejects unknown shapes", () => {
  assert.equal(parseDrumbeatResumeBody(undefined), undefined);
  assert.equal(parseDrumbeatResumeBody({ kind: "message" }), undefined);
  assert.equal(
    parseDrumbeatResumeBody({
      kind: H2A_DRUMBEAT_RESUME_BODY_KIND,
      target: "claude:remote",
      requestedBy: "codex:watch"
    }),
    undefined
  );
});

import assert from "node:assert/strict";

export async function waitForIdentity(read, pause = () => new Promise((resolve) => setTimeout(resolve, 10))) {
  // The worker owns the deadline. A registry row can appear before activation;
  // wait for the MCP readiness contract (presence, signer and wake activated).
  for (;;) {
    const status = await read();
    if (status.state === "identity_ready") return status;
    assert.equal(status.state, "identity_pending", JSON.stringify(status));
    assert.ok(status.elapsedMs < status.timeoutMs, JSON.stringify(status));
    await pause();
  }
}

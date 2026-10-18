import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SEAT_CLIS_5, SEAT_PACKAGE_PROVIDER_ID } from "./cli-seat-fixtures.js";
const calls = vi.hoisted(() => ({ consumer: vi.fn(), product: vi.fn() }));
vi.mock("./llm-mesh-accounts.js", async original => ({
  ...await original<typeof import("./llm-mesh-accounts.js")>(),
  enrollSeatConsumerViaFacade: calls.consumer, enrollViaFacade: calls.product,
}));
import { main } from "./index.js";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "seat-command-")); vi.stubEnv("XDG_RUNTIME_DIR", root);
  process.exitCode = undefined;
  for (const fn of [calls.consumer, calls.product]) fn.mockReset().mockResolvedValue({ accountId: "synthetic", provider: "codex", label: "Seat" });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true); vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => { process.exitCode = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
for (const cli of SEAT_CLIS_5) for (const from of ["cli", "token"]) {
  it(`dispatches ${cli} --from ${from} exclusively to the consumer import`, async () => {
    const path = join(root, "selected-profile.json");
    const code = await main(["node", "h2a", "llm-mesh", "account", "enroll", cli, "--from", from, ...(from === "cli" ? ["--seat-profile", path] : [])]);
    expect(code).toBe(0);
    expect(calls.consumer).toHaveBeenCalledExactlyOnceWith(SEAT_PACKAGE_PROVIDER_ID[cli], { from, ...(from === "cli" ? { seatProfile: path } : {}) });
    expect(calls.product).not.toHaveBeenCalled();
  });
}
it.each(["--cli", "--token"])("routes the %s alias to the same consumer circuit", async flag => {
  expect(await main(["node", "h2a", "llm-mesh", "account", "enroll", "codex", flag])).toBe(0);
  expect(calls.consumer).toHaveBeenCalledWith("codex", { from: flag === "--cli" ? "cli" : "token" });
  expect(calls.product).not.toHaveBeenCalled();
});
it("keeps default OAuth on the product enrollment circuit", async () => {
  expect(await main(["node", "h2a", "llm-mesh", "account", "enroll", "codex"])).toBe(0);
  expect(calls.product).toHaveBeenCalled(); expect(calls.consumer).not.toHaveBeenCalled();
});

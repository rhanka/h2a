import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const probe = vi.hoisted(() => vi.fn(() => ({ state: "unknown" })));
vi.mock("./native-host.js", () => ({ nativeSessionState: probe }));
const { acquireLaunchSlot, markLaunchCreation, ownLaunchSlot } = await import("./launch-capacity.js");
let root: string, previous: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "capacity-recovery-")); previous = process.env.XDG_STATE_HOME; process.env.XDG_STATE_HOME = root; probe.mockClear(); });
afterEach(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; rmSync(root, { recursive: true, force: true }); });
const ledger = () => join(root, "h2a", "launch-capacity", "reservations.json");
const put = (slot: Record<string, unknown>) => { mkdirSync(join(root, "h2a", "launch-capacity"), { recursive: true }); writeFileSync(ledger(), JSON.stringify({ slots: { old: { at: 0, state: "launching", residentBytes: 1024, ...slot } } })); };
it("should recover a reservation after its real launcher exits before ownership or creation", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {acquireLaunchSlot} from ${JSON.stringify(fileURLToPath(new URL("./launch-capacity.ts", import.meta.url)))}; if(!acquireLaunchSlot('old',1,1024).acquired)process.exitCode=2;`], { env: process.env });
  const slot = JSON.parse(readFileSync(ledger(), "utf8")).slots.old;
  expect(acquireLaunchSlot("next", 1, 1024).acquired).toBe(true);
  expect(slot.launcher.pid).toBeGreaterThan(0); expect(slot.launcher.start).toMatch(/^\d+$/);
  expect(slot.creationAttempted).toBe(false); expect(probe).not.toHaveBeenCalled();
});
it("should retain a live launcher reservation even when it has no ownership", () => {
  expect(acquireLaunchSlot("old", 1, 1024).acquired).toBe(true);
  expect(acquireLaunchSlot("next", 1, 1024).acquired).toBe(false); expect(probe).not.toHaveBeenCalled();
});
it("should retain a live reservation between ownership installation and create", () => {
  expect(acquireLaunchSlot("old", 1, 1024).acquired).toBe(true);
  ownLaunchSlot("old", [{ name: "h2a-old", generation: "g", incarnation: "i", socketPath: "/private/not-created.sock" }]);
  expect(acquireLaunchSlot("next", 1, 1024).acquired).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});
it("should persist creation only after the exact reservation has ownership", () => {
  expect(acquireLaunchSlot("old", 1, 1024).acquired).toBe(true);
  expect(() => markLaunchCreation("old")).toThrow(/lost ownership/);
  ownLaunchSlot("old", [{ name: "h2a-old", generation: "g", incarnation: "i", socketPath: "/private/owned.sock" }]);
  markLaunchCreation("old");
  expect(JSON.parse(readFileSync(ledger(), "utf8")).slots.old.creationAttempted).toBe(true);
});
for (const slot of [{}, { launcher: { pid: 2147483647, start: "1" }, creationAttempted: true },
  { launcher: { pid: process.pid, start: "1" } }]) {
  it("should retain an unowned reservation without positive non-creation evidence " + JSON.stringify(slot), () => {
    put(slot); expect(acquireLaunchSlot("next", 1, 1024).acquired).toBe(false); expect(probe).not.toHaveBeenCalled();
  });
}
it("should retain a created reservation when the exact host cannot be observed", () => {
  put({ launcher: { pid: 2147483647, start: "1" }, creationAttempted: true,
    ownership: [{ name: "old", generation: "g", incarnation: "i", socketPath: "/private/unknown.sock" }] });
  expect(acquireLaunchSlot("next", 1, 1024).acquired).toBe(false); expect(probe).toHaveBeenCalledTimes(1);
});

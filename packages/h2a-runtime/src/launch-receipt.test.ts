import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const { updateLaunchReceipt } = await import(process.env.QUAL_RECEIPT_MODULE ?? "./launch-receipt.js");

it("should write a fresh receipt when a PID namespace cannot be inspected", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-portability-")), file = join(root, "receipt.json");
  try {
    // Exercise the built receipt writer in a separate process: changing a
    // builtin binding must not affect the test runner or other fixtures.
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const readlink = fs.readlinkSync;
      fs.readlinkSync = function(path, ...args) {
        if (path === "/proc/self/ns/pid") throw Object.assign(new Error("proc unavailable"), { code: "ENOENT" });
        return readlink.call(this, path, ...args);
      };
      syncBuiltinESMExports();
      const { updateLaunchReceipt } = await import(${JSON.stringify(new URL("../dist/launch-receipt.js", import.meta.url).href)});
      updateLaunchReceipt(${JSON.stringify(file)}, "fresh", { state: "launching", submitAttempted: false });
    `], { env: process.env, encoding: "utf8", timeout: 5000 });
    expect(child.stderr).toBe("");
    expect(child.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ token: "fresh", state: "launching" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("should preserve a lock whose PID namespace and birth cannot be established", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-lock-")), file = join(root, "receipt.json");
  try {
    mkdirSync(file + ".lock"); writeFileSync(file + ".lock/owner", "2147483647");
    expect(() => updateLaunchReceipt(file, "test", { submitAttempted: false })).toThrow();
    expect(readFileSync(file + ".lock/owner", "utf8")).toBe("2147483647");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("should reclaim proven dead ownership and preserve the input epoch monotonically", () => {
  const root = mkdtempSync(join(tmpdir(), "receipt-lock-")), file = join(root, "receipt.json");
  try {
    mkdirSync(file + ".lock"); writeFileSync(file + ".lock/owner", JSON.stringify({ pid: process.pid, start: "stale-birth", namespace: readlinkSync("/proc/self/ns/pid") }));
    updateLaunchReceipt(file, "test", { submitAttempted: true, inputEpoch: 4 });
    updateLaunchReceipt(file, "test", { submitAttempted: false, inputEpoch: 2 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ submitAttempted: true, inputEpoch: 4 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

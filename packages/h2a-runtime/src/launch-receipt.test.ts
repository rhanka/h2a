import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { updateLaunchReceipt } = await import(process.env.QUAL_RECEIPT_MODULE ?? "./launch-receipt.js");

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

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

/** setsid/detached does not leave the launching terminal's memory cgroup.
 * Move this host before it creates any PTYs, so children inherit its scope.
 * MemoryHigh is a soft pressure threshold, never a session-killing limit.
 */
export async function isolateNativeTerminalHost(): Promise<{ isolated: boolean; reason?: string }> {
  return isolateScope("native", ["MemoryHigh", "t", String(Math.floor(totalmem() * 0.75))], "avoid");
}

/** Separate every CLI tree from the host and from other human sessions.
 * The default hard ceiling is 8 GiB (or 1/4 of physical RAM on smaller hosts).
 * A lower explicit ceiling supports disposable qualification without pressure
 * on the surrounding machine. Swap is bounded independently.
 */
export async function isolateNativeTerminalSession(): Promise<{ isolated: boolean; reason?: string }> {
  const defaultMax = Math.min(8 * 1024 ** 3, Math.floor(totalmem() / 4));
  const requested = Number(process.env.H2A_NATIVE_SESSION_MEMORY_MAX ?? defaultMax);
  if (!Number.isSafeInteger(requested) || requested < 16 * 1024 ** 2 || requested > defaultMax) {
    return { isolated: false, reason: "invalid H2A_NATIVE_SESSION_MEMORY_MAX" };
  }
  return isolateScope("session", [
    "MemoryHigh", "t", String(Math.floor(requested * 0.8)),
    "MemoryMax", "t", String(requested),
    "MemorySwapMax", "t", "0",
  ], "none");
}

async function isolateScope(kind: "native" | "session", limits: string[], oomPreference: string): Promise<{ isolated: boolean; reason?: string }> {
  if (process.platform !== "linux") return { isolated: false, reason: "systemd scopes require Linux" };
  const unit = `h2a-${kind}-${process.pid}-${randomUUID()}.scope`;
  const result = spawnSync("busctl", [
    "--user", "--timeout=750ms", "call",
    "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
    "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))",
    unit, "fail", String(4 + limits.length / 3),
    "Description", "s", `h2a ${kind} terminal`,
    "Slice", "s", "app.slice",
    "PIDs", "au", "1", String(process.pid),
    "ManagedOOMPreference", "s", oomPreference,
    ...limits,
    "0",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) {
    return { isolated: false, reason: (result.error as NodeJS.ErrnoException | undefined)?.code ?? `systemd request exited ${result.status ?? result.signal}` };
  }
  // StartTransientUnit queues a job. Do not admit PTYs until the kernel
  // confirms the move, rather than treating a queued job as isolation.
  const deadline = Date.now() + 250;
  do {
    try {
      if (readFileSync("/proc/self/cgroup", "utf8").split("\n").some(line => line.endsWith(`/${unit}`))) {
        return { isolated: true };
      }
    } catch { return { isolated: false, reason: "cannot verify host cgroup" }; }
    await delay(10);
  } while (Date.now() < deadline);
  return { isolated: false, reason: "systemd scope move was not confirmed" };
}

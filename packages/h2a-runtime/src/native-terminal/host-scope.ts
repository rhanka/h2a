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
  if (process.platform !== "linux") return { isolated: false, reason: "systemd scopes require Linux" };
  const unit = `h2a-native-${process.pid}-${randomUUID()}.scope`;
  const result = spawnSync("busctl", [
    "--user", "--timeout=750ms", "call",
    "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
    "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))",
    unit, "fail", "5",
    "Description", "s", "h2a native terminal host",
    "Slice", "s", "app.slice",
    "PIDs", "au", "1", String(process.pid),
    "ManagedOOMPreference", "s", "avoid",
    "MemoryHigh", "t", String(Math.floor(totalmem() * 0.75)),
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

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveMemoryScopeSpec,
  type NativeMemoryPolicy,
  type NativeSessionClass,
} from "../onboarding-core.js";

export type SessionScopeOptions = {
  readonly memoryPolicy?: NativeMemoryPolicy;
  readonly sessionClass?: NativeSessionClass;
  readonly slice?: "app.slice" | "h2a-agents.slice";
  readonly oomPreference?: "avoid" | "none";
};

/** setsid/detached does not leave the launching terminal's memory cgroup.
 * Move this host before it creates any PTYs, so children inherit its scope.
 * MemoryHigh is a soft pressure threshold, never a session-killing limit.
 */
export async function isolateNativeTerminalHost(): Promise<{ isolated: boolean; reason?: string }> {
  return isolateScope("native", "app.slice", ["MemoryHigh", "t", String(Math.floor(totalmem() * 0.75))], "avoid");
}

/** Separate every CLI tree from the host and from other human sessions.
 * The default hard ceiling is 8 GiB (or 1/4 of physical RAM on smaller hosts);
 * agy uses 16 GiB (capped at 30% host RAM) with 75% MemoryHigh (12 GiB).
 */
export async function isolateNativeTerminalSession(options: SessionScopeOptions = {}): Promise<{ isolated: boolean; reason?: string }> {
  const spec = resolveMemoryScopeSpec(options);
  const policyMax = spec.defaultMaxBytes;
  const requested = Number(process.env.H2A_NATIVE_SESSION_MEMORY_MAX ?? policyMax);
  if (!Number.isSafeInteger(requested) || requested < 16 * 1024 ** 2 || requested > policyMax) {
    return { isolated: false, reason: "invalid H2A_NATIVE_SESSION_MEMORY_MAX" };
  }
  const slice = options.slice ?? spec.slice;
  const oomPreference = options.oomPreference ?? spec.oomPreference;
  return isolateScope("session", slice, [
    "MemoryHigh", "t", String(Math.floor(requested * spec.highRatio)),
    "MemoryMax", "t", String(requested),
    "MemorySwapMax", "t", "0",
  ], oomPreference);
}

async function isolateScope(
  kind: "native" | "session",
  slice: "app.slice" | "h2a-agents.slice",
  limits: string[],
  oomPreference: string,
): Promise<{ isolated: boolean; reason?: string }> {
  if (process.platform !== "linux") return { isolated: false, reason: "systemd scopes require Linux" };
  const unit = `h2a-${kind}-${process.pid}-${randomUUID()}.scope`;
  const result = spawnSync("busctl", [
    "--user", "--timeout=750ms", "call",
    "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
    "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))",
    unit, "fail", String(4 + limits.length / 3),
    "Description", "s", `h2a ${kind} terminal`,
    "Slice", "s", slice,
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
      const cgroupLines = readFileSync("/proc/self/cgroup", "utf8").split("\n");
      if (cgroupLines.some(line => line.endsWith(`/${unit}`) && (slice === "app.slice" || line.includes(`/${slice}/`)))) {
        return { isolated: true };
      }
    } catch { return { isolated: false, reason: "cannot verify host cgroup" }; }
    await delay(10);
  } while (Date.now() < deadline);
  return { isolated: false, reason: "systemd scope move was not confirmed" };
}

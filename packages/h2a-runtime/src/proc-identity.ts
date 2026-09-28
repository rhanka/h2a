/**
 * The two identifiers that make a PID-based durable record MEANINGFUL to a
 * later reader: the pid NAMESPACE the pids were resolved in, and the BOOT the
 * start-times were measured against.
 *
 * Every pid-recycling proof in native-terminal (`ownerHostStartTime`,
 * `pgidLeaderStartTime` — see native-terminal/host.ts) compares a number
 * persisted earlier with a number read now, and the comparison only means
 * anything while both were taken in the same pid namespace and after the same
 * boot:
 *
 *  - a pid is resolved in the READER's pid namespace, so the same number names
 *    a different process across a namespace boundary (a container that shares
 *    the config home, a CRIU-restored tree);
 *  - `/proc/<pid>/stat`'s `starttime` is expressed in clock ticks since BOOT,
 *    so across a reboot two unrelated processes can carry the same value — and
 *    a persisted pgid means nothing at all once the pid space was reset.
 *
 * So rows record both, and a reader that cannot match both refuses to derive a
 * pid-based proof from them (fail closed) rather than compare numbers from
 * incomparable frames. Lives in its own leaf module because the WRITER of the
 * durable row (registry.ts) and the READER that re-proves it
 * (native-terminal/host.ts) must use the very same definition.
 *
 * Both readers return undefined — never throw — on any read failure or on a
 * non-Linux platform, exactly like `readProcessStartTime`: "unavailable" must
 * stay distinguishable from a value, so a caller can fail closed on it.
 */

import { readFileSync, readlinkSync } from "node:fs";

/**
 * Inode number of this process's pid namespace, read from the
 * `/proc/self/ns/pid` magic symlink (`pid:[4026531836]`). Stable for the life
 * of the namespace and identical for every process in it.
 */
export function readPidNamespaceId(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const link = readlinkSync("/proc/self/ns/pid");
    const inode = /\[(\d+)\]/.exec(link);
    return inode?.[1];
  } catch {
    return undefined;
  }
}

/**
 * The kernel's boot id (`/proc/sys/kernel/random/boot_id`): a random UUID
 * regenerated at every boot, i.e. the epoch every `starttime` above is relative
 * to.
 */
export function readBootId(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

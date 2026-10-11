/**
 * The identifiers that make a PID-based durable record MEANINGFUL to a later
 * reader: the pid NAMESPACE the pids were resolved in, the BOOT the
 * start-times were measured against, and the MACHINE both belong to.
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
 * incomparable frames. ONE mismatch is different, and is separated out by
 * `classifyDurableProcFrame` below: same KNOWN namespace and machine with a
 * DIFFERENT known boot is not an incomparable frame, it is proof that every
 * process the row describes has ended (see `DurableProcFrameVerdict`).
 *
 * Neither of those two identifies a MACHINE. The init pid namespace carries
 * the same fixed inode (`PROC_PID_INIT_INO`, 4026531836) on every Linux
 * kernel, and a boot id is random per boot, so "same namespace, different
 * boot" is exactly what a reader sees for a row written by ANOTHER machine
 * sharing the same registry (a networked `$HOME`) — not only for a row written
 * by a previous boot of this one. Only the machine id (`/etc/machine-id`) tells
 * those apart, so a row records it too, and any proof that rests on "this is
 * the same machine" requires it known and equal on both sides.
 *
 * Lives in its own leaf module because the WRITER of the durable row
 * (registry.ts) and the READER that re-proves it (native-terminal/host.ts)
 * must use the very same definition.
 *
 * Every reader returns undefined — never throws — on any read failure or on a
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

/** Where machine-id(5) lives: systemd's path first, then the D-Bus fallback
 * that systems without systemd provide. */
const MACHINE_ID_PATHS = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

/**
 * This machine's persistent identity: machine-id(5), 32 lowercase hex digits,
 * stable across reboots and distinct per installation.
 *
 * Only a well-formed, non-zero value counts. A container image usually ships
 * the file empty or absent, and systemd writes the literal `uninitialized`
 * during a first boot: both mean "no identity", never an identity every such
 * system would then share.
 *
 * The identity is only as distinct as its provisioning: two machines cloned
 * from one image without regenerating it carry the same id, and no reader can
 * tell them apart (see `#verifyGroupLeaderIdentity` in native-terminal/host.ts
 * for what that leaves out of model).
 */
export function readMachineId(): string | undefined {
  if (process.platform !== "linux") return undefined;
  for (const path of MACHINE_ID_PATHS) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (/^[0-9a-f]{32}$/.test(raw) && !/^0+$/.test(raw)) return raw;
    } catch {
      // Try the next location; none readable means no identity.
    }
  }
  return undefined;
}

/**
 * The complete frame a durable pid/start-time record was taken in: the three
 * anchors above as ONE value, so a reader classifies a record against a frame
 * it read once, coherently, instead of mixing reads taken at different times.
 * Absent fields mean "unknown", never "empty" or "default" (see the module
 * header): a record without an anchor can never be granted a frame-dependent
 * proof from it.
 */
export type DurableProcFrame = Readonly<{
  pidNamespace?: string | undefined;
  bootId?: string | undefined;
  machineId?: string | undefined;
}>;

/**
 * The injectable frame reader: the three SYSTEM readers above, as one typed
 * dependency. Production callers pass nothing and get the real readers; tests
 * that must observe a record from a DIFFERENT frame (a previous boot, another
 * machine) inject a typed fake through this seam — never a public,
 * falsifiable environment variable (an env override would be honored by any
 * stray process, not just by a test).
 */
export type ReadProcessFrame = () => DurableProcFrame;

/** The production `ReadProcessFrame`: the system readers, read together. */
export const readProcessFrame: ReadProcessFrame = () => {
  const pidNamespace = readPidNamespaceId();
  const bootId = readBootId();
  const machineId = readMachineId();
  return {
    ...(pidNamespace !== undefined ? { pidNamespace } : {}),
    ...(bootId !== undefined ? { bootId } : {}),
    ...(machineId !== undefined ? { machineId } : {}),
  };
};

/**
 * Verdict on a durable record's frame, as seen by a later reader. Mirrors the
 * frame logic of `#verifyGroupLeaderIdentity` in native-terminal/host.ts (its
 * `stale-boot` and `foreign-frame` outcomes); the two must stay in lockstep —
 * the same definitions this module exists to guarantee.
 *
 *  - "current": known pid namespace AND known boot id, both equal to the
 *    reader's. Pid- and start-time-based proofs (liveness probes) are
 *    admissible on such a record — and only on such a record. Machine id is
 *    not required: a boot id is random per boot, so an equal known boot inside
 *    an equal known namespace already pins the epoch the numbers were taken
 *    against.
 *  - "stale-boot": same KNOWN pid namespace, same KNOWN machine, DIFFERENT
 *    known boot id. This is not an absence of proof, it is the strongest death
 *    proof available: a reboot ends every process of the boot before it, so
 *    every pid and start-time the record carries is PROVEN dead. A reboot also
 *    resets the pid space, so the recorded numbers may belong to UNRELATED
 *    live processes by now: callers must neither probe the recorded pids (a
 *    probe would read a stranger as the owner) nor signal them, ever.
 *    The machine anchor is what makes the proof admissible: the init pid
 *    namespace has the same inode on every kernel, so "same namespace,
 *    different boot" is also what a record written by ANOTHER machine sharing
 *    the durable store looks like — a machine whose processes may be alive
 *    right now.
 *  - "foreign-frame": everything else — another or unknown pid namespace
 *    (including a namespace change with the same boot id: a pid resolved in
 *    another namespace is a different process, and the change alone proves
 *    nothing in either direction), another or unknown machine, an unknown
 *    boot id, or a record with no anchors at all (a legacy row). Nothing about
 *    the record's processes can be decided from this reader: not that they
 *    survived, not that they are gone. Callers must fail closed.
 */
export type DurableProcFrameVerdict = "current" | "stale-boot" | "foreign-frame";

/**
 * Classify a durable record's frame against the reader's current frame. PURE:
 * both frames are passed in (the caller reads its own frame once, via the
 * `ReadProcessFrame` seam, and reuses it for every record of one decision), so
 * the classification of a set of records can never mix frames read at
 * different times. See `DurableProcFrameVerdict` for what each verdict does
 * and does not license.
 */
export function classifyDurableProcFrame(
  recorded: DurableProcFrame,
  current: DurableProcFrame,
): DurableProcFrameVerdict {
  if (
    recorded.pidNamespace !== undefined &&
    recorded.pidNamespace === current.pidNamespace &&
    recorded.bootId !== undefined &&
    recorded.bootId === current.bootId
  ) {
    return "current";
  }
  const differentKnownBoot =
    recorded.bootId !== undefined &&
    current.bootId !== undefined &&
    recorded.bootId !== current.bootId;
  if (
    differentKnownBoot &&
    recorded.pidNamespace !== undefined &&
    recorded.pidNamespace === current.pidNamespace &&
    recorded.machineId !== undefined &&
    recorded.machineId === current.machineId
  ) {
    return "stale-boot";
  }
  return "foreign-frame";
}

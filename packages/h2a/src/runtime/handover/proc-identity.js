// Reused .6 leaf, Git 0b9cf8862be689380c3bcb6e7cb35dc1e10b5cbf; TypeScript erased only.
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
export function readPidNamespaceId() {
    if (process.platform !== "linux")
        return undefined;
    try {
        const link = readlinkSync("/proc/self/ns/pid");
        const inode = /\[(\d+)\]/.exec(link);
        return inode?.[1];
    }
    catch {
        return undefined;
    }
}
/**
 * The kernel's boot id (`/proc/sys/kernel/random/boot_id`): a random UUID
 * regenerated at every boot, i.e. the epoch every `starttime` above is relative
 * to.
 */
export function readBootId() {
    if (process.platform !== "linux")
        return undefined;
    try {
        const raw = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
        return raw.length > 0 ? raw : undefined;
    }
    catch {
        return undefined;
    }
}
/** Where machine-id(5) lives: systemd's path first, then the D-Bus fallback
 * that systems without systemd provide. */
const MACHINE_ID_PATHS = ["/etc/machine-id", "/var/lib/dbus/machine-id"];
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
export function readMachineId() {
    if (process.platform !== "linux")
        return undefined;
    for (const path of MACHINE_ID_PATHS) {
        try {
            const raw = readFileSync(path, "utf8").trim();
            if (/^[0-9a-f]{32}$/.test(raw) && !/^0+$/.test(raw))
                return raw;
        }
        catch {
            // Try the next location; none readable means no identity.
        }
    }
    return undefined;
}
/**
 * This process's network-namespace inode, read the same way as the pid
 * namespace above (`net:[<inode>]`). Same contract: undefined — never throws
 * — on any read failure or a non-Linux platform.
 */
export function readNetNamespaceId() {
    if (process.platform !== "linux")
        return undefined;
    try {
        const link = readlinkSync("/proc/self/ns/net");
        const inode = /\[(\d+)\]/.exec(link);
        return inode?.[1];
    }
    catch {
        return undefined;
    }
}
/**
 * This process's own start time, `/proc/self/stat` field 22. Anchors on the
 * LAST `") "` for the same reason `readProcessStartTime` in
 * native-terminal/host.ts documents at length (a `comm` can contain spaces
 * and parentheses). Provenance only (see `DurableProcFrame`), so it skips
 * host.ts's uptime sanity check: no proof ever compares this number.
 */
export function readSelfProcessStartTime() {
    if (process.platform !== "linux")
        return undefined;
    try {
        const raw = readFileSync("/proc/self/stat", "utf8");
        const splitAt = raw.lastIndexOf(") ");
        if (splitAt < 0)
            return undefined;
        const starttime = Number(raw.slice(splitAt + 2).split(" ")[19]);
        if (!Number.isFinite(starttime) || starttime < 0)
            return undefined;
        return starttime;
    }
    catch {
        return undefined;
    }
}
/**
 * A positive readable uptime is required for an inode-age proof. Zero,
 * malformed or unreadable uptime leaves the boot instant unknown.
 */
export function readBootTimeMs() {
    if (process.platform !== "linux")
        return undefined;
    try {
        const raw = readFileSync("/proc/uptime", "utf8").trim();
        const seconds = Number(raw.split(/\s+/)[0]);
        return Number.isFinite(seconds) && seconds > 0
            ? Date.now() - seconds * 1000 : undefined;
    }
    catch {
        return undefined;
    }
}
/** The production `ReadProcessFrame`: the system readers, read together. */
export const readProcessFrame = () => {
    const pidNamespace = readPidNamespaceId();
    const bootId = readBootId();
    const machineId = readMachineId();
    const nsNet = readNetNamespaceId();
    const startTime = readSelfProcessStartTime();
    const bootTimeMs = readBootTimeMs();
    return {
        ...(pidNamespace !== undefined ? { pidNamespace } : {}),
        ...(bootId !== undefined ? { bootId } : {}),
        ...(machineId !== undefined ? { machineId } : {}),
        ...(nsNet !== undefined ? { nsNet } : {}),
        ...(startTime !== undefined ? { startTime } : {}),
        ...(bootTimeMs !== undefined ? { bootTimeMs } : {}),
    };
};
/** The kernel writes boot ids (and every writer here copies them verbatim)
 * as 8-4-4-4-12 lowercase hex digits. Anything else in a DURABLE record is a
 * corrupted or fabricated store value, and no proof may be derived from it. */
const WELL_FORMED_BOOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function classifyDurableProcFrame(recorded, current) {
    const valid = (frame) => (frame.bootId === undefined || WELL_FORMED_BOOT_ID_RE.test(frame.bootId)) &&
        (frame.machineId === undefined || (/^[0-9a-f]{32}$/.test(frame.machineId) && !/^0+$/.test(frame.machineId))) &&
        (frame.pidNamespace === undefined || /^\d+$/.test(frame.pidNamespace));
    // Store validation precedes all comparisons. Unknown current anchors also
    // forbid every frame-dependent proof (R1 order 1).
    if (!valid(recorded) || !valid(current) ||
        recorded.machineId === undefined || current.machineId === undefined ||
        current.bootId === undefined || current.pidNamespace === undefined ||
        recorded.machineId !== current.machineId ||
        recorded.pidNamespace !== current.pidNamespace || recorded.bootId === undefined) {
        return "foreign-frame";
    }
    return recorded.bootId === current.bootId ? "current" : "stale-boot";
}

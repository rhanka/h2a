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

import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

/**
 * Inode number of this process's pid namespace, read from the
 * `/proc/self/ns/pid` magic symlink (`pid:[4026531836]`). Stable for the life
 * of the namespace and identical for every process in it.
 */
/**
 * macOS has no pid namespaces: there is a single pid space per boot. The
 * sentinel records that fact, not an inode — it is never a real inode number
 * (inodes are never 0), so a Linux row (real inode) in a darwin reader's
 * frame, or vice versa, always classifies foreign-frame (fail closed).
 */
export const DARWIN_PID_NAMESPACE_SENTINEL = "0";

export function readPidNamespaceId(): string | undefined {
  if (process.platform === "darwin") return DARWIN_PID_NAMESPACE_SENTINEL;
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
  if (process.platform === "darwin") return readDarwinBootId();
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a process's start-time — Linux `/proc/<pid>/stat` field 22
 * ("starttime", clock ticks since boot) — the pid-recycling-proof
 * discriminant: two DIFFERENT processes that ever held the same pid cannot
 * both report the same start-time (barring a read error), which is what
 * makes "pid matches AND start-time matches" a safe proof of "still the
 * same process", not just "some process now owns this pid".
 *
 * Parsing anchors on the LAST occurrence of the two-character sequence ") "
 * rather than a naive whitespace split: field 2 (`comm`, the executable
 * name) is parenthesized and CAN itself contain spaces and parentheses
 * (e.g. a process named "node (pty host)"), which would shift every
 * subsequent field under a plain split — silently reading the wrong number
 * "most of the time" and breaking on the one process with a weird name. That
 * would be a confident wrong answer, worse than no discriminant.
 *
 * After locating the split point, man(5) proc's field 3 ("state") is
 * `rest[0]`; field 22 ("starttime") is therefore `rest[19]`.
 *
 * A mandatory sanity check follows: `starttime` (in clock ticks, USER_HZ=100
 * on Linux) divided by 100 must not exceed the system's current uptime — a
 * process cannot have started in the future relative to boot. If that check
 * fails, the parse is treated as shifted/malformed and this function returns
 * undefined (never answers from a mis-parsed field) rather than guessing.
 *
 * Returns undefined — never throws — on any read/parse failure or on a
 * non-Linux platform (no /proc); callers must treat "unavailable" the same
 * conservative way `posixProcessGroupReaper.isGroupAlive` treats EPERM: as
 * "cannot prove", never as "prove me dead".
 */
export function readProcessStartTime(pid: number): number | undefined {
  if (process.platform === "darwin") return readDarwinProcessStartTime(pid);
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const splitAt = raw.lastIndexOf(") ");
    if (splitAt < 0) return undefined;
    const rest = raw.slice(splitAt + 2).split(" ");
    const starttime = Number(rest[19]);
    if (!Number.isFinite(starttime) || starttime < 0) return undefined;
    const uptimeRaw = readFileSync("/proc/uptime", "utf8");
    const uptimeSeconds = Number(uptimeRaw.trim().split(/\s+/)[0]);
    if (!Number.isFinite(uptimeSeconds) || starttime / 100 > uptimeSeconds) {
      // Sanity check failed: refuse rather than answer from a shifted parse.
      return undefined;
    }
    return starttime;
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
  if (process.platform === "darwin") return readDarwinMachineId();
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
 * IDENTITY anchors above as ONE value, so a reader classifies a record against
 * a frame it read once, coherently, instead of mixing reads taken at different
 * times. Absent fields mean "unknown", never "empty" or "default" (see the
 * module header): a record without an anchor can never be granted a
 * frame-dependent proof from it.
 *
 * The last three fields are PROVENANCE, not identity: they enrich the frame
 * the seam reports (who is reading, in which kernel namespaces, since when)
 * but take no part in any classification — a durable record never carries
 * them.
 */
export type DurableProcFrame = Readonly<{
  pidNamespace?: string | undefined;
  bootId?: string | undefined;
  machineId?: string | undefined;
  /** Inode of this process's NETWORK namespace (`/proc/self/ns/net`). */
  nsNet?: string | undefined;
  /** This process's own start time (`/proc/self/stat` field 22, ticks since boot). */
  startTime?: number | undefined;
  /** The boot instant of this machine, epoch milliseconds (now minus uptime). */
  bootTimeMs?: number | undefined;
}>;

/**
 * This process's network-namespace inode, read the same way as the pid
 * namespace above (`net:[<inode>]`). Same contract: undefined — never throws
 * — on any read failure or a non-Linux platform.
 */
export function readNetNamespaceId(): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const link = readlinkSync("/proc/self/ns/net");
    const inode = /\[(\d+)\]/.exec(link);
    return inode?.[1];
  } catch {
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
export function readSelfProcessStartTime(): number | undefined {
  if (process.platform === "darwin") return readDarwinProcessStartTime(process.pid);
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync("/proc/self/stat", "utf8");
    const splitAt = raw.lastIndexOf(") ");
    if (splitAt < 0) return undefined;
    const starttime = Number(raw.slice(splitAt + 2).split(" ")[19]);
    if (!Number.isFinite(starttime) || starttime < 0) return undefined;
    return starttime;
  } catch {
    return undefined;
  }
}

/**
 * A positive readable uptime is required for an inode-age proof. Zero,
 * malformed or unreadable uptime leaves the boot instant unknown.
 */
export function readBootTimeMs(): number | undefined {
  if (process.platform === "darwin") {
    return readDarwinBootTimeMs();
  }
  if (process.platform !== "linux") return undefined;
  try {
    const raw = readFileSync("/proc/uptime", "utf8").trim();
    const seconds = Number(raw.split(/\s+/)[0]);
    return Number.isFinite(seconds) && seconds > 0
      ? Date.now() - seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The injectable frame reader: the SYSTEM readers above, as one typed
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

/** R1 v5: only complete, valid, equal machine/namespace anchors admit
 * current or stale-boot. The sidecar's legacy migration is local to server.ts;
 * an unanchored durable record always remains foreign-frame. */
export type DurableProcFrameVerdict = "current" | "stale-boot" | "foreign-frame";

export function classifyDurableProcFrame(
  recorded: DurableProcFrame,
  current: DurableProcFrame,
): DurableProcFrameVerdict {
  const valid = (frame: DurableProcFrame) =>
    (frame.bootId === undefined || WELL_FORMED_BOOT_ID_RE.test(frame.bootId)) &&
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

/**
 * macOS product substrate (lot BM): the same proofs as above, read through
 * `/bin/ps` and `ioreg` instead of `/proc`, because the product must publish,
 * attribute and reap on darwin with equivalent fail-closed semantics.
 *
 * Every reader keeps the module contract: a synchronous value or undefined —
 * never a throw — so callers fail closed on "unavailable" exactly like the
 * Linux readers. `ps` is at the fixed path `/bin/ps` (never a PATH lookup)
 * with `LC_ALL=C` so the `lstart` month names parse deterministically.
 */

export type DarwinPsRunner = (args: ReadonlyArray<string>) => string;

function defaultDarwinPsRunner(args: ReadonlyArray<string>): string {
  return execFileSync("/bin/ps", [...args], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
}

// The shared test helper is intentionally read-only and has no Darwin /proc
// directory pins. Preserve its private-root boundary here: register only self
// and descendants discovered through a known parent's child selector, then
// query ps by those explicit PIDs. No qualification process census uses -axo.
function darwinTestProcessRoot(): string | undefined {
  const root = process.env.H2A_TEST_OWNED_PROC_ROOT;
  if (root === undefined) return undefined;
  if (root !== process.env.H2A_TEST_PROC_ROOT || !isAbsolute(root)) throw new Error("invalid private Darwin process view");
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) throw new Error("unsafe private Darwin process view");
  return root;
}
function recordDarwinTestProcess(root: string, pid: number, birth: number): void {
  const receipt = join(root, `darwin-${pid}.json`);
  const temporary = `${receipt}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify({ pid, birth }), { mode: 0o600, flag: "wx" }); renameSync(temporary, receipt); }
  finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}
function rawDarwinBirth(pid: number): number | undefined {
  try { return parsePsLstart(defaultDarwinPsRunner(["-p", String(pid), "-o", "lstart="])); }
  catch { return undefined; }
}
function collectDarwinTestProcessIds(root: string): Set<number> {
  const selfBirth = rawDarwinBirth(process.pid);
  if (selfBirth === undefined) throw new Error("private Darwin observer birth unavailable");
  recordDarwinTestProcess(root, process.pid, selfBirth);
  const pending: number[] = [];
  for (const name of readdirSync(root).filter(name => /^darwin-\d+\.json$/.test(name))) {
    const receipt = JSON.parse(readFileSync(join(root, name), "utf8"));
    if (!Number.isSafeInteger(receipt.pid) || receipt.pid <= 0 || !Number.isFinite(receipt.birth)) throw new Error("invalid private Darwin launch receipt");
    try { process.kill(receipt.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") continue; throw error; }
    if (rawDarwinBirth(receipt.pid) === receipt.birth) pending.push(receipt.pid);
  }
  const owned = new Set<number>();
  for (const pid of pending) {
    if (owned.has(pid)) continue;
    owned.add(pid);
    let children: string;
    try { children = execFileSync("/usr/bin/pgrep", ["-P", String(pid)], { encoding: "utf8", timeout: 15000, env: { ...process.env, LC_ALL: "C" } }); }
    catch (error) { if ((error as { status?: number }).status === 1) continue; throw error; }
    for (const value of children.trim().split(/\s+/).filter(Boolean)) {
      if (!/^[1-9]\d*$/.test(value)) throw new Error("unreadable private Darwin child list");
      const child = Number(value), birth = rawDarwinBirth(child);
      if (birth === undefined) continue; // the selected child already exited
      recordDarwinTestProcess(root, child, birth); pending.push(child);
    }
  }
  return owned;
}

const PS_MONTHS: Readonly<Record<string, number>> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse `ps -o lstart=` output (`Mon Oct 19 10:23:45 2026`) into epoch
 * SECONDS. Pure (fixture-testable): the readers below only fetch the string.
 * Returns undefined on any unparseable input — never a guessed time.
 */
export function parsePsLstart(output: string): number | undefined {
  const match = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/.exec(output.trim());
  if (!match) return undefined;
  const month = PS_MONTHS[match[1]!];
  const day = Number(match[2]);
  const hour = Number(match[3]);
  const minute = Number(match[4]);
  const second = Number(match[5]);
  const year = Number(match[6]);
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 61 || year < 1970 || year > 3000) {
    return undefined;
  }
  return Math.floor(Date.UTC(year, month, day, hour, minute, second) / 1000);
}

/**
 * The pid-recycling discriminant on darwin: process start as epoch seconds.
 * One-second resolution (DECLARED LIMIT): a pid recycled within the same
 * second is indistinguishable from the original process — the documented
 * benign error, same class as `defaultOwnerHostProbe`'s coincident-start-time
 * case on Linux. Units never cross platforms: darwin records and compares
 * only against darwin reads on the same machine.
 */
export function readDarwinProcessStartTime(
  pid: number,
  run: DarwinPsRunner = defaultDarwinPsRunner,
): number | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (run === defaultDarwinPsRunner) {
    try { const root = darwinTestProcessRoot(); if (root && !collectDarwinTestProcessIds(root).has(pid)) return undefined; }
    catch { return undefined; }
  }
  let output: string;
  try {
    output = run(["-p", String(pid), "-o", "lstart="]);
  } catch {
    return undefined;
  }
  return parsePsLstart(output);
}

/**
 * Deterministic boot identity from the start of pid 1 (launchd, alive since
 * boot): same boot ⇒ same value, any reboot ⇒ a different value (reboots
 * span longer than the one-second resolution). Encoded UUID-shaped so the
 * shared frame validator accepts it unchanged — the fixed
 * `00000000-0000-4000-8000` prefix marks it as a darwin boot-instant
 * encoding, never a kernel boot_id. A VM snapshot-restore that reverts the
 * clock is the documented residual (same class as the CRIU case the module
 * header already declares for Linux).
 */
export function darwinBootIdFromEpochSeconds(epochSeconds: number): string {
  const hex = Math.floor(epochSeconds).toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

export function readDarwinBootId(
  run: DarwinPsRunner = defaultDarwinSysctlRunner,
): string | undefined {
  try {
    const id = run(["-n", "kern.bootsessionuuid"]).trim().toLowerCase();
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}
function defaultDarwinSysctlRunner(args: ReadonlyArray<string>): string {
  return execFileSync("/usr/sbin/sysctl", [...args], { encoding: "utf8", timeout: 15000, env: { ...process.env, LC_ALL: "C" } });
}
export function readDarwinBootTimeMs(run: DarwinPsRunner = defaultDarwinSysctlRunner): number | undefined {
  try {
    const match = /sec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)/.exec(run(["-n", "kern.boottime"]));
    if (!match || Number(match[1]) <= 0 || Number(match[2]) >= 1000000) return undefined;
    return Number(match[1]) * 1000 + Number(match[2]) / 1000;
  } catch { return undefined; }
}

/** Parse `ioreg -rd1 -c IOPlatformExpertDevice` for the hardware UUID. Pure. */
export function parseIoPlatformUuid(output: string): string | undefined {
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output);
  if (!match) return undefined;
  const normalized = match[1]!.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(normalized) || /^0+$/.test(normalized)) return undefined;
  return normalized;
}

const IOREG_CANDIDATES = ["/usr/sbin/ioreg", "/usr/bin/ioreg"] as const;

/**
 * This machine's stable identity on darwin: the hardware platform UUID,
 * normalized to the 32-lowercase-hex shape the shared validator already
 * accepts (no validator change). Fixed paths only, never a PATH lookup.
 */
export function readDarwinMachineId(): string | undefined {
  for (const binary of IOREG_CANDIDATES) {
    try {
      const output = execFileSync(binary, ["-rd1", "-c", "IOPlatformExpertDevice"], {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, LC_ALL: "C" },
      });
      const identity = parseIoPlatformUuid(output);
      if (identity !== undefined) return identity;
    } catch {
      // Try the next fixed location; none working means no identity.
    }
  }
  return undefined;
}

export type DarwinProcessTableRow = Readonly<{
  pid: number;
  pgid: number;
  /** First `ps STAT` letter (R/S/Z/T…), the only part the census compares. */
  stat: string;
  /** Full command line as one string (space-joined: see the whitespace limit). */
  args: string;
}>;

/**
 * Parse `ps -axo pid,pgid,stat,args`. Pure. Any non-empty non-header line
 * that does not parse poisons the WHOLE table (returns undefined): a census
 * or scan that silently dropped a row could miss a live member or a live
 * host, and "unavailable" must stay fail-closed, never a partial view.
 */
export function parseDarwinProcessTable(output: string): DarwinProcessTableRow[] | undefined {
  const rows: DarwinProcessTableRow[] = [];
  const lines = output.split("\n");
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!match) return undefined;
    const pid = Number(match[1]);
    const pgid = Number(match[2]);
    const stat = match[3]!;
    if (!Number.isSafeInteger(pid) || pid < 0 || !Number.isSafeInteger(pgid) || pgid < 0 || stat === "") {
      return undefined;
    }
    rows.push({ pid, pgid, stat: stat.slice(0, 1), args: match[4] ?? "" });
  }
  return rows;
}

export function readDarwinProcessTable(
  run: DarwinPsRunner = defaultDarwinPsRunner,
): DarwinProcessTableRow[] | undefined {
  let output: string;
  let owned: Set<number> | undefined;
  try {
    const root = darwinTestProcessRoot();
    if (root) {
      owned = collectDarwinTestProcessIds(root);
      output = run(["-ww", "-p", [...owned].join(","), "-o", "pid,pgid,stat,args"]);
    } else output = run(["-axo", "pid,pgid,stat,args"]);
  } catch {
    return undefined;
  }
  const rows = parseDarwinProcessTable(output);
  return rows && (owned === undefined || rows.every(row => owned!.has(row.pid))) ? rows : undefined;
}

/**
 * The session-token membership read on darwin. macOS `ps` exposes no
 * documented per-process environ keyword, so the BSD-tolerant spellings are
 * attempted in order and every output line is scanned for the token
 * assignment; no spelling yielding it means "unreadable" (undefined), which
 * the reaper treats as membership-unprovable (refuse-and-leak), never as
 * token-verified. The literal names the same variable `host.ts`
 * `H2A_SESSION_TOKEN_ENV_VAR` defines (an import would cycle host ↔
 * proc-identity); a drift breaks loudly toward refusal, never toward a
 * false membership proof.
 */
export function readDarwinProcessSessionToken(
  pid: number,
  run: DarwinPsRunner = defaultDarwinPsRunner,
): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (run === defaultDarwinPsRunner) {
    try { const root = darwinTestProcessRoot(); if (root && !collectDarwinTestProcessIds(root).has(pid)) return undefined; }
    catch { return undefined; }
  }
  const spellings: ReadonlyArray<ReadonlyArray<string>> = [
    ["-p", String(pid), "-E"],
    ["-p", String(pid), "e"],
    ["eww", "-p", String(pid)],
  ];
  for (const args of spellings) {
    let output: string;
    try {
      output = run(args);
    } catch {
      continue;
    }
    for (const line of output.split("\n")) {
      const match = /(?:^|\s)H2A_SESSION_TOKEN=([^\s]+)/.exec(line);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

// Each newly executed runtime registers itself before its parent may disappear.
// Normal product execution has no test view and performs no receipt writes.
if (process.platform === "darwin") {
  const root = darwinTestProcessRoot();
  if (root) {
    const birth = rawDarwinBirth(process.pid);
    if (birth === undefined) throw new Error("private Darwin process birth unavailable");
    recordDarwinTestProcess(root, process.pid, birth);
  }
}

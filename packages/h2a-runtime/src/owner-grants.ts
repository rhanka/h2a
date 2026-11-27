/**
 * Pure `node:*` one-shot human authorization grants (`owner-grants/`) for Q2-2:
 * `central-stop` and `central-compact` only, zero plaintext secrets, bounded
 * TTL (10 s .. 15 m, default 5 m), clock/uptime bounds (NB-5), atomic
 * rename+unlink consumption, EROFS fail-closed handling, and stale purge.
 */

import { randomUUID, randomBytes } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_LOGIN_RE,
  readBootId,
  readMachineId,
  readProcUptimeSeconds,
  readVerifiedJson0600,
  UUID_V4_RE,
  verifyOrCreatePrivateDir,
  writeJsonAtomic0600,
} from "./session-auth.js";

export const OWNER_GRANT_ACTS = ["central-stop", "central-compact"] as const;
export type OwnerGrantAct = (typeof OWNER_GRANT_ACTS)[number];

export const DEFAULT_OWNER_GRANT_TTL_MS = 5 * 60_000;
export const MIN_OWNER_GRANT_TTL_MS = 10_000;
export const MAX_OWNER_GRANT_TTL_MS = 15 * 60_000;
export const MAX_OWNER_GRANT_FUTURE_SKEW_MS = 5_000;
export const STALE_CLAIMING_MS = 30_000;
export const MAX_OWNER_GRANT_REASON_LEN = 200;

export interface OwnerGrant {
  readonly version: 1;
  readonly grantId: string;
  readonly act: OwnerGrantAct;
  readonly actorId: string;
  readonly bootId: string;
  readonly machineId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly issuedUptimeSec?: number | undefined;
  readonly issuerPid: number;
  readonly issuerTty: string | null;
  readonly reason?: string | undefined;
}

export function isOwnerGrantAct(value: string): value is OwnerGrantAct {
  return value === "central-stop" || value === "central-compact";
}

export function isCanonicalOwnerGrantLogin(login: string): boolean {
  return CANONICAL_LOGIN_RE.test(login);
}

/** Parse `<n>s` or `<n>m` into ms within `[10_000, 900_000]`. */
export function parseOwnerGrantTtlMs(raw: string | undefined): { readonly ok: true; readonly ttlMs: number } | { readonly ok: false; readonly error: string } {
  if (raw === undefined || raw === "") {
    return { ok: true, ttlMs: DEFAULT_OWNER_GRANT_TTL_MS };
  }
  const trimmed = raw.trim();
  const match = /^(\d+)(s|m)$/.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error: `invalid --ttl "${raw}": expected <n>s or <n>m (between 10s and 15m)`,
    };
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const ttlMs = unit === "m" ? amount * 60_000 : amount * 1_000;
  if (!Number.isFinite(ttlMs) || ttlMs < MIN_OWNER_GRANT_TTL_MS || ttlMs > MAX_OWNER_GRANT_TTL_MS) {
    return {
      ok: false,
      error: `invalid --ttl "${raw}": must be between 10s (${MIN_OWNER_GRANT_TTL_MS}ms) and 15m (${MAX_OWNER_GRANT_TTL_MS}ms)`,
    };
  }
  return { ok: true, ttlMs };
}

/** Sanitize and bound `--reason` against control chars / bidi overrides (NB-7). */
export function sanitizeOwnerGrantReason(
  raw: string | undefined,
): { readonly ok: true; readonly reason?: string | undefined } | { readonly ok: false; readonly error: string } {
  if (raw === undefined) return { ok: true, reason: undefined };
  const stripped = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, " ")
    .trim();
  if (stripped.length === 0) {
    return { ok: false, error: "--reason must contain printable non-control characters" };
  }
  if (stripped.length > MAX_OWNER_GRANT_REASON_LEN) {
    return {
      ok: false,
      error: `--reason exceeds maximum length (${MAX_OWNER_GRANT_REASON_LEN} chars)`,
    };
  }
  return { ok: true, reason: stripped };
}

export function ownerGrantsDir(runtimeDir: string): string {
  return join(runtimeDir, "owner-grants");
}

export function ownerGrantPath(runtimeDir: string, grantId: string): string {
  return join(ownerGrantsDir(runtimeDir), `${grantId}.json`);
}

export function isValidOwnerGrantShape(value: unknown): value is OwnerGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const g = value as Record<string, unknown>;
  return (
    g["version"] === 1 &&
    typeof g["grantId"] === "string" &&
    UUID_V4_RE.test(g["grantId"]) &&
    typeof g["act"] === "string" &&
    isOwnerGrantAct(g["act"]) &&
    typeof g["actorId"] === "string" &&
    isCanonicalOwnerGrantLogin(g["actorId"]) &&
    typeof g["bootId"] === "string" &&
    g["bootId"].length > 0 &&
    typeof g["machineId"] === "string" &&
    g["machineId"].length > 0 &&
    typeof g["issuedAt"] === "number" &&
    Number.isFinite(g["issuedAt"]) &&
    typeof g["expiresAt"] === "number" &&
    Number.isFinite(g["expiresAt"]) &&
    (g["issuedUptimeSec"] === undefined ||
      (typeof g["issuedUptimeSec"] === "number" && Number.isFinite(g["issuedUptimeSec"]))) &&
    typeof g["issuerPid"] === "number" &&
    Number.isInteger(g["issuerPid"]) &&
    g["issuerPid"] > 0 &&
    (g["issuerTty"] === null || typeof g["issuerTty"] === "string") &&
    (g["reason"] === undefined || typeof g["reason"] === "string")
  );
}

/**
 * Evaluate clock, TTL ceiling, boot/machine, and optional `/proc/uptime` delta
 * bounds for a parsed grant (NB-5).
 */
export function isOwnerGrantValidForContext(
  grant: OwnerGrant,
  context: {
    readonly bootId: string;
    readonly machineId: string;
    readonly now: number;
    readonly uptimeSec?: number | undefined;
    readonly act?: OwnerGrantAct | undefined;
    readonly actorId?: string | undefined;
  },
): boolean {
  if (context.act !== undefined && grant.act !== context.act) return false;
  if (context.actorId !== undefined && grant.actorId !== context.actorId) return false;
  if (grant.bootId !== context.bootId || grant.machineId !== context.machineId) return false;

  const span = grant.expiresAt - grant.issuedAt;
  if (!Number.isFinite(span) || span <= 0 || span > MAX_OWNER_GRANT_TTL_MS) return false;
  if (grant.issuedAt > context.now + MAX_OWNER_GRANT_FUTURE_SKEW_MS) return false;
  if (context.now >= grant.expiresAt) return false;

  if (
    grant.issuedUptimeSec !== undefined &&
    context.uptimeSec !== undefined &&
    Number.isFinite(context.uptimeSec)
  ) {
    if (context.uptimeSec + 5 < grant.issuedUptimeSec) return false;
    const elapsedUptimeMs = (context.uptimeSec - grant.issuedUptimeSec) * 1_000;
    if (elapsedUptimeMs > span + MAX_OWNER_GRANT_FUTURE_SKEW_MS) return false;
  }
  return true;
}

/**
 * Remove expired, foreign-boot, corrupt, or abandoned `*.claiming.*`/`*.tmp`
 * grant files (NB-7). Reserve mutations to `authorize` and owner-mode `doctor` (NB-6).
 */
export function purgeStaleOwnerGrants(
  runtimeDir: string,
  options: {
    readonly now?: number | undefined;
    readonly bootId?: string | undefined;
    readonly machineId?: string | undefined;
    readonly uptimeSec?: number | undefined;
    readonly expectedUid?: number | undefined;
  } = {},
): string[] {
  const dir = ownerGrantsDir(runtimeDir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const now = options.now ?? Date.now();
  const bootId = options.bootId ?? readBootId() ?? "nonlinux-boot";
  const machineId = options.machineId ?? readMachineId();
  const uptimeSec = options.uptimeSec ?? readProcUptimeSeconds();
  const purged: string[] = [];

  for (const name of entries) {
    const full = join(dir, name);
    if (name.endsWith(".tmp") || name.includes(".json.claiming.")) {
      try {
        const st = lstatSync(full);
        if (now - st.mtimeMs >= STALE_CLAIMING_MS || st.isSymbolicLink()) {
          rmSync(full, { force: true });
          purged.push(name);
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    if (!name.endsWith(".json")) continue;
    const read = readVerifiedJson0600<OwnerGrant>(full, options.expectedUid);
    if (
      !read.ok ||
      !isValidOwnerGrantShape(read.value) ||
      !isOwnerGrantValidForContext(read.value, { bootId, machineId, now, uptimeSec })
    ) {
      try {
        rmSync(full, { force: true });
        purged.push(name);
      } catch {
        /* ignore */
      }
    }
  }
  return purged;
}

export function issueOwnerGrant(
  runtimeDir: string,
  input: {
    readonly act: OwnerGrantAct;
    readonly actorId: string;
    readonly ttlMs?: number | undefined;
    readonly reason?: string | undefined;
    readonly issuerPid?: number | undefined;
    readonly issuerTty?: string | null | undefined;
    readonly bootId?: string | undefined;
    readonly machineId?: string | undefined;
    readonly uptimeSec?: number | undefined;
    readonly now?: number | undefined;
    readonly expectedUid?: number | undefined;
  },
): OwnerGrant {
  if (!isOwnerGrantAct(input.act)) {
    throw new Error(`unsupported authorize act: ${String(input.act)}`);
  }
  if (!isCanonicalOwnerGrantLogin(input.actorId)) {
    throw new Error(`invalid canonical login for --for: ${input.actorId}`);
  }
  const ttlMs = input.ttlMs ?? DEFAULT_OWNER_GRANT_TTL_MS;
  if (ttlMs < MIN_OWNER_GRANT_TTL_MS || ttlMs > MAX_OWNER_GRANT_TTL_MS) {
    throw new Error(`grant TTL out of bounds: ${ttlMs}`);
  }
  const uid = input.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const grantsDir = ownerGrantsDir(runtimeDir);
  verifyOrCreatePrivateDir(grantsDir, uid, { createIfMissing: true });

  const now = input.now ?? Date.now();
  const bootId = input.bootId ?? readBootId() ?? "nonlinux-boot";
  const machineId = input.machineId ?? readMachineId();
  const uptimeSec = input.uptimeSec ?? readProcUptimeSeconds();
  purgeStaleOwnerGrants(runtimeDir, { now, bootId, machineId, uptimeSec, expectedUid: uid });

  const grant: OwnerGrant = {
    version: 1,
    grantId: randomUUID(),
    act: input.act,
    actorId: input.actorId,
    bootId,
    machineId,
    issuedAt: now,
    expiresAt: now + ttlMs,
    ...(uptimeSec !== undefined ? { issuedUptimeSec: uptimeSec } : {}),
    issuerPid: input.issuerPid ?? process.pid,
    issuerTty: input.issuerTty ?? null,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
  writeJsonAtomic0600(ownerGrantPath(runtimeDir, grant.grantId), grant);
  return grant;
}

export function listOwnerGrants(
  runtimeDir: string,
  options: {
    readonly now?: number | undefined;
    readonly bootId?: string | undefined;
    readonly machineId?: string | undefined;
    readonly uptimeSec?: number | undefined;
    readonly expectedUid?: number | undefined;
    readonly purgeExpired?: boolean | undefined;
    readonly act?: OwnerGrantAct | undefined;
    readonly actorId?: string | undefined;
  } = {},
): OwnerGrant[] {
  const dir = ownerGrantsDir(runtimeDir);
  const uid = options.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const now = options.now ?? Date.now();
  const bootId = options.bootId ?? readBootId() ?? "nonlinux-boot";
  const machineId = options.machineId ?? readMachineId();
  const uptimeSec = options.uptimeSec ?? readProcUptimeSeconds();

  if (options.purgeExpired) {
    purgeStaleOwnerGrants(runtimeDir, { now, bootId, machineId, uptimeSec, expectedUid: uid });
  }

  let entries: string[];
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o077) !== 0) {
      return [];
    }
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const active: OwnerGrant[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name.includes(".claiming.")) continue;
    const read = readVerifiedJson0600<OwnerGrant>(join(dir, name), uid);
    if (!read.ok || !isValidOwnerGrantShape(read.value)) continue;
    if (
      isOwnerGrantValidForContext(read.value, {
        bootId,
        machineId,
        now,
        uptimeSec,
        act: options.act,
        actorId: options.actorId,
      })
    ) {
      active.push(read.value);
    }
  }
  active.sort((a, b) => a.expiresAt - b.expiresAt);
  return active;
}

export function revokeOwnerGrant(
  runtimeDir: string,
  grantId: string,
  options: { readonly expectedUid?: number | undefined } = {},
): { readonly ok: true; readonly revoked: OwnerGrant } | { readonly ok: false; readonly reason: "invalid-id" | "not-found" | "unsafe" } {
  if (!UUID_V4_RE.test(grantId)) return { ok: false, reason: "invalid-id" };
  const uid = options.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const path = ownerGrantPath(runtimeDir, grantId);
  const read = readVerifiedJson0600<OwnerGrant>(path, uid);
  if (!read.ok) {
    return { ok: false, reason: read.reason === "missing" ? "not-found" : "unsafe" };
  }
  if (!isValidOwnerGrantShape(read.value)) return { ok: false, reason: "unsafe" };
  unlinkSync(path);
  return { ok: true, revoked: read.value };
}

export type ConsumeOwnerGrantResult =
  | { readonly ok: true; readonly grant: OwnerGrant }
  | {
      readonly ok: false;
      readonly code: "owner-authorization-required" | "owner-authorization-unconsumable";
      readonly errnoCode?: string | undefined;
      readonly detail: string;
    };

/**
 * Atomically claim and unlink ONE matching grant BEFORE executing the covered act.
 * Fails closed on EROFS/EACCES (`owner-authorization-unconsumable`) and never skips unlink.
 */
export function consumeOwnerGrantForAct(
  runtimeDir: string,
  input: {
    readonly act: OwnerGrantAct;
    readonly actorId: string;
    readonly now?: number | undefined;
    readonly bootId?: string | undefined;
    readonly machineId?: string | undefined;
    readonly uptimeSec?: number | undefined;
    readonly expectedUid?: number | undefined;
  },
): ConsumeOwnerGrantResult {
  const uid = input.expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const dir = ownerGrantsDir(runtimeDir);
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || (st.mode & 0o777) !== 0o700) {
      return {
        ok: false,
        code: "owner-authorization-required",
        detail: "owner-grants directory is absent or unsafe",
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        code: "owner-authorization-unconsumable",
        errnoCode: code,
        detail: `owner-grants directory unreadable (${code})`,
      };
    }
    return {
      ok: false,
      code: "owner-authorization-required",
      detail: `no active owner grant for ${input.act} (${input.actorId})`,
    };
  }

  const now = input.now ?? Date.now();
  const bootId = input.bootId ?? readBootId() ?? "nonlinux-boot";
  const machineId = input.machineId ?? readMachineId();
  const uptimeSec = input.uptimeSec ?? readProcUptimeSeconds();
  const candidates = listOwnerGrants(runtimeDir, {
    act: input.act,
    actorId: input.actorId,
    now,
    bootId,
    machineId,
    uptimeSec,
    expectedUid: uid,
    purgeExpired: false,
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "owner-authorization-required",
      detail: `no valid owner grant for ${input.act} (${input.actorId})`,
    };
  }

  let sawRace = false;
  for (const candidate of candidates) {
    const srcPath = ownerGrantPath(runtimeDir, candidate.grantId);
    const claimPath = `${srcPath}.claiming.${process.pid}.${randomBytes(4).toString("hex")}`;
    try {
      renameSync(srcPath, claimPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        sawRace = true;
        continue;
      }
      if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
        return {
          ok: false,
          code: "owner-authorization-unconsumable",
          errnoCode: code,
          detail: `cannot consume owner grant in read-only/protected store (${code})`,
        };
      }
      return {
        ok: false,
        code: "owner-authorization-required",
        detail: `failed to claim owner grant: ${(err as Error).message}`,
      };
    }

    let claimed: OwnerGrant | undefined;
    try {
      const verified = readVerifiedJson0600<OwnerGrant>(claimPath, uid);
      if (
        verified.ok &&
        isValidOwnerGrantShape(verified.value) &&
        isOwnerGrantValidForContext(verified.value, {
          bootId,
          machineId,
          now,
          uptimeSec,
          act: input.act,
          actorId: input.actorId,
        })
      ) {
        claimed = verified.value;
      }
    } catch {
      claimed = undefined;
    }

    try {
      unlinkSync(claimPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
        return {
          ok: false,
          code: "owner-authorization-unconsumable",
          errnoCode: code,
          detail: `cannot finalize owner grant removal (${code})`,
        };
      }
      throw err;
    }

    if (claimed) {
      return { ok: true, grant: claimed };
    }
  }

  return {
    ok: false,
    code: "owner-authorization-required",
    detail: sawRace
      ? `owner grant for ${input.act} (${input.actorId}) was already claimed concurrently`
      : `no valid owner grant for ${input.act} (${input.actorId})`,
  };
}

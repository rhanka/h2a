import { createHash } from "node:crypto";

import type {
  StateBeginRecord,
  StateEndRecord,
  StatePartRecord
} from "./types.js";

export const AUTHORITY_SYNC_DEADLINE_MS = 15_000 as const;
export const AUTHORITY_MAX_REVOCATIONS = 4_096 as const;
export const AUTHORITY_MAX_GRANTS = 256 as const;
export const AUTHORITY_MAX_PARTS = 272 as const;
export const AUTHORITY_PART_MAX_ENTRIES = 16 as const;
export const AUTHORITY_ENTRY_MAX_BYTES = 384 as const;
export const AUTHORITY_PART_MAX_BYTES = 6_656 as const;
export const AUTHORITY_RECORD_MAX_BYTES = 8_192 as const;
export const AUTHORITY_ID_MAX_BYTES = 36 as const;
export const AUTHORITY_MESH_TENANT_MAX_BYTES = 64 as const;
export const AUTHORITY_GRANT_MAX_KINDS = 8 as const;
export const AUTHORITY_KIND_MAX_BYTES = 16 as const;

export const AUTHORITY_REVOKED_ACTORS = [
  "user",
  "workspace-admin",
  "org-admin",
  "tenant-admin",
  "node"
] as const;

export type AuthorityRevokedActor = (typeof AUTHORITY_REVOKED_ACTORS)[number];

const REVOKED_ACTOR_SET: ReadonlySet<string> = new Set<string>(AUTHORITY_REVOKED_ACTORS);
const ISO_UTC_24_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface AuthorityRevocationEntry {
  readonly instanceId: string;
  readonly revokedAt: string;
  readonly revokedBy: AuthorityRevokedActor;
}

export interface AuthorityGrantEntry {
  readonly fromMeshId: string;
  readonly fromTenantId: string;
  readonly resourceKinds: readonly string[];
}

export interface TrunkAuthorityState {
  readonly stateRevision: number;
  readonly grants: readonly AuthorityGrantEntry[];
  readonly propagationFenced: boolean;
}

export function isUnescapedAsciiToken(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxBytes) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e || code === 0x22 || code === 0x5c) {
      return false;
    }
  }
  return true;
}

export function isIsoUtc24Timestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24 || !ISO_UTC_24_RE.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function compareBinaryAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareGrantKey(
  a: { readonly fromMeshId: string; readonly fromTenantId: string },
  b: { readonly fromMeshId: string; readonly fromTenantId: string }
): number {
  const meshCmp = compareBinaryAscii(a.fromMeshId, b.fromMeshId);
  if (meshCmp !== 0) return meshCmp;
  return compareBinaryAscii(a.fromTenantId, b.fromTenantId);
}

export interface AuthoritySyncStagerOptions {
  readonly expectedGeneration: number;
  readonly revisionFloor: number;
  readonly canonicalRecordBytes: (record: unknown) => Uint8Array;
  readonly measureJcsBytes: (value: unknown) => number;
}

export type AuthorityStagerStepResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "sync-state-invalid" };

export type AuthorityStagerEndResult =
  | {
      readonly ok: true;
      readonly revocations: readonly AuthorityRevocationEntry[];
      readonly grants: readonly AuthorityGrantEntry[];
      readonly stateRevision: number;
      readonly imageSha256: string;
    }
  | { readonly ok: false; readonly code: "sync-state-invalid" };

export class AuthoritySyncStager {
  readonly #expectedGeneration: number;
  readonly #revisionFloor: number;
  readonly #canonicalRecordBytes: (record: unknown) => Uint8Array;
  readonly #measureJcsBytes: (value: unknown) => number;
  readonly #hash = createHash("sha256");

  #phase: "await-begin" | "await-part" | "await-end" | "done" | "failed" = "await-begin";
  #stateRevision = 0;
  #expectedRevocations = 0;
  #expectedGrants = 0;
  #expectedParts = 0;
  #expectedRevParts = 0;
  #receivedParts = 0;
  #revocations: AuthorityRevocationEntry[] = [];
  #grants: AuthorityGrantEntry[] = [];
  #lastRevocationId: string | null = null;
  #lastGrantKey: { readonly fromMeshId: string; readonly fromTenantId: string } | null = null;

  constructor(options: AuthoritySyncStagerOptions) {
    this.#expectedGeneration = options.expectedGeneration;
    this.#revisionFloor = options.revisionFloor;
    this.#canonicalRecordBytes = options.canonicalRecordBytes;
    this.#measureJcsBytes = options.measureJcsBytes;
  }

  getStateRevision(): number {
    return this.#stateRevision;
  }

  #fail(): { readonly ok: false; readonly code: "sync-state-invalid" } {
    this.#phase = "failed";
    return { ok: false, code: "sync-state-invalid" };
  }

  begin(record: StateBeginRecord): AuthorityStagerStepResult {
    if (this.#phase !== "await-begin") return this.#fail();
    if (record.syncGeneration !== this.#expectedGeneration) return this.#fail();
    if (
      !Number.isSafeInteger(record.stateRevision) ||
      record.stateRevision < 0 ||
      record.stateRevision < this.#revisionFloor
    ) {
      return this.#fail();
    }
    if (
      !Number.isSafeInteger(record.revocationCount) ||
      record.revocationCount < 0 ||
      record.revocationCount > AUTHORITY_MAX_REVOCATIONS
    ) {
      return this.#fail();
    }
    if (
      !Number.isSafeInteger(record.grantCount) ||
      record.grantCount < 0 ||
      record.grantCount > AUTHORITY_MAX_GRANTS
    ) {
      return this.#fail();
    }
    const revParts = Math.ceil(record.revocationCount / AUTHORITY_PART_MAX_ENTRIES);
    const grantParts = Math.ceil(record.grantCount / AUTHORITY_PART_MAX_ENTRIES);
    const totalParts = revParts + grantParts;
    if (record.partCount !== totalParts || totalParts > AUTHORITY_MAX_PARTS) {
      return this.#fail();
    }
    const bytes = this.#canonicalRecordBytes(record);
    if (bytes.byteLength > AUTHORITY_RECORD_MAX_BYTES) return this.#fail();
    this.#hash.update(bytes);

    this.#stateRevision = record.stateRevision;
    this.#expectedRevocations = record.revocationCount;
    this.#expectedGrants = record.grantCount;
    this.#expectedParts = totalParts;
    this.#expectedRevParts = revParts;
    this.#phase = totalParts === 0 ? "await-end" : "await-part";
    return { ok: true };
  }

  part(record: StatePartRecord): AuthorityStagerStepResult {
    if (this.#phase !== "await-part") return this.#fail();
    if (record.syncGeneration !== this.#expectedGeneration) return this.#fail();
    if (record.part !== this.#receivedParts || record.part >= this.#expectedParts) {
      return this.#fail();
    }
    const expectedKind = record.part < this.#expectedRevParts ? "revocations" : "grants";
    if (record.kind !== expectedKind) return this.#fail();

    const pageBytes = this.#canonicalRecordBytes(record);
    if (
      pageBytes.byteLength > AUTHORITY_PART_MAX_BYTES ||
      pageBytes.byteLength > AUTHORITY_RECORD_MAX_BYTES
    ) {
      return this.#fail();
    }

    const entries = record.entries as readonly unknown[];
    if (
      !Array.isArray(entries) ||
      entries.length < 1 ||
      entries.length > AUTHORITY_PART_MAX_ENTRIES
    ) {
      return this.#fail();
    }

    if (expectedKind === "revocations") {
      const isLastRevPage = record.part === this.#expectedRevParts - 1;
      if (!isLastRevPage && entries.length !== AUTHORITY_PART_MAX_ENTRIES) {
        return this.#fail();
      }
      if (this.#revocations.length + entries.length > this.#expectedRevocations) {
        return this.#fail();
      }
      if (isLastRevPage && this.#revocations.length + entries.length !== this.#expectedRevocations) {
        return this.#fail();
      }
      for (const raw of entries) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return this.#fail();
        if (this.#measureJcsBytes(raw) > AUTHORITY_ENTRY_MAX_BYTES) return this.#fail();
        const item = raw as Record<string, unknown>;
        const keys = Object.keys(item);
        if (keys.length !== 3) return this.#fail();
        if (!isUnescapedAsciiToken(item["instanceId"], AUTHORITY_ID_MAX_BYTES)) return this.#fail();
        if (!isIsoUtc24Timestamp(item["revokedAt"])) return this.#fail();
        if (typeof item["revokedBy"] !== "string" || !REVOKED_ACTOR_SET.has(item["revokedBy"])) {
          return this.#fail();
        }
        if (
          this.#lastRevocationId !== null &&
          compareBinaryAscii(this.#lastRevocationId, item["instanceId"]) >= 0
        ) {
          return this.#fail();
        }
        this.#lastRevocationId = item["instanceId"];
        this.#revocations.push({
          instanceId: item["instanceId"],
          revokedAt: item["revokedAt"],
          revokedBy: item["revokedBy"] as AuthorityRevokedActor
        });
      }
    } else {
      const isLastGrantPage = record.part === this.#expectedParts - 1;
      if (!isLastGrantPage && entries.length !== AUTHORITY_PART_MAX_ENTRIES) {
        return this.#fail();
      }
      if (this.#grants.length + entries.length > this.#expectedGrants) {
        return this.#fail();
      }
      if (isLastGrantPage && this.#grants.length + entries.length !== this.#expectedGrants) {
        return this.#fail();
      }
      for (const raw of entries) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return this.#fail();
        if (this.#measureJcsBytes(raw) > AUTHORITY_ENTRY_MAX_BYTES) return this.#fail();
        const item = raw as Record<string, unknown>;
        const keys = Object.keys(item);
        if (keys.length !== 3) return this.#fail();
        if (!isUnescapedAsciiToken(item["fromMeshId"], AUTHORITY_MESH_TENANT_MAX_BYTES)) {
          return this.#fail();
        }
        if (!isUnescapedAsciiToken(item["fromTenantId"], AUTHORITY_MESH_TENANT_MAX_BYTES)) {
          return this.#fail();
        }
        const rawKinds = item["resourceKinds"];
        if (!Array.isArray(rawKinds) || rawKinds.length > AUTHORITY_GRANT_MAX_KINDS) {
          return this.#fail();
        }
        let prevKind: string | null = null;
        for (const k of rawKinds) {
          if (!isUnescapedAsciiToken(k, AUTHORITY_KIND_MAX_BYTES)) return this.#fail();
          if (prevKind !== null && compareBinaryAscii(prevKind, k) >= 0) return this.#fail();
          prevKind = k;
        }
        const curKey = { fromMeshId: item["fromMeshId"], fromTenantId: item["fromTenantId"] };
        if (this.#lastGrantKey !== null && compareGrantKey(this.#lastGrantKey, curKey) >= 0) {
          return this.#fail();
        }
        this.#lastGrantKey = curKey;
        this.#grants.push({
          fromMeshId: item["fromMeshId"],
          fromTenantId: item["fromTenantId"],
          resourceKinds: [...(rawKinds as string[])]
        });
      }
    }

    this.#hash.update(pageBytes);
    this.#receivedParts += 1;
    if (this.#receivedParts === this.#expectedParts) {
      this.#phase = "await-end";
    }
    return { ok: true };
  }

  end(record: StateEndRecord): AuthorityStagerEndResult {
    if (this.#phase !== "await-end") return this.#fail();
    if (record.syncGeneration !== this.#expectedGeneration) return this.#fail();
    if (record.stateRevision !== this.#stateRevision) return this.#fail();
    if (record.partCount !== this.#expectedParts) return this.#fail();
    if (
      this.#receivedParts !== this.#expectedParts ||
      this.#revocations.length !== this.#expectedRevocations ||
      this.#grants.length !== this.#expectedGrants
    ) {
      return this.#fail();
    }
    if (typeof record.imageSha256 !== "string" || !SHA256_HEX_RE.test(record.imageSha256)) {
      return this.#fail();
    }
    const endBytes = this.#canonicalRecordBytes(record);
    if (endBytes.byteLength > AUTHORITY_RECORD_MAX_BYTES) return this.#fail();

    const digest = this.#hash.digest("hex");
    if (digest !== record.imageSha256) return this.#fail();

    this.#phase = "done";
    return {
      ok: true,
      revocations: [...this.#revocations],
      grants: [...this.#grants],
      stateRevision: this.#stateRevision,
      imageSha256: digest
    };
  }
}

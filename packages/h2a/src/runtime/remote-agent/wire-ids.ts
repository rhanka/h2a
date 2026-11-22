/**
 * Pure wire-identifier derivation and validation bounded to <= 36 ASCII bytes
 * per SPEC_EVOL_REMOTE_FASTLANE.md (r11, §§7.2, 6.1).
 */

import { createHash } from "node:crypto";

const CANONICAL_SID_RE = /^[np]-[0-9a-f]{32}$/;
const LEGACY_SID_RE = /^[np]-[0-9a-f]{64}$/;
const WIRE_INSTANCE_ID_RE = /^i-[0-9a-f]{32}$/;
const WIRE_NODE_HEX_RE = /^[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sha256HexUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function nativeCatalogueSid(nativeId: string): string {
  return `n-${sha256HexUtf8(nativeId).slice(0, 32)}`;
}

export function presenceCatalogueSid(presenceSessionId: string): string {
  return `p-${sha256HexUtf8(presenceSessionId).slice(0, 32)}`;
}

export function isCanonicalCatalogueSid(value: string): boolean {
  return typeof value === "string" && CANONICAL_SID_RE.test(value);
}

export function normalizeCatalogueSid(value: string): string | null {
  if (typeof value !== "string") return null;
  if (CANONICAL_SID_RE.test(value)) return value;
  if (LEGACY_SID_RE.test(value)) return value.slice(0, 34);
  return null;
}

export function wireInstanceId(localHandle: string): string {
  return `i-${sha256HexUtf8(localHandle).slice(0, 32)}`;
}

export function isWireInstanceId(value: string): boolean {
  return typeof value === "string" && WIRE_INSTANCE_ID_RE.test(value);
}

export function wireNodeId(stored: string): string | null {
  if (typeof stored !== "string") return null;
  if (WIRE_NODE_HEX_RE.test(stored)) return stored;
  if (stored.startsWith("node:")) {
    const rest = stored.slice(5);
    if (UUID_RE.test(rest)) return rest;
  }
  return null;
}

export function isWireNodeId(value: string): boolean {
  return typeof value === "string" && (WIRE_NODE_HEX_RE.test(value) || UUID_RE.test(value));
}

/**
 * EVO-12 P2 (mode 3, multi-tenant) — map an authenticated 39-auth `sub` to that
 * user's own h2a root, under `<baseRoot>/tenants/<safe(sub)>`. The gateway picks
 * the per-user root after the broker login (so the read-only surface + mirror
 * ingester scope to one user); the single-tenant mode keeps using `baseRoot`.
 *
 * Pure. `safePathSegment` neutralizes path-traversal / unsafe chars in `sub`.
 */
import { join } from "node:path";

import { safePathSegment } from "../../local-files/index.js";

/** Per-tenant h2a root for an authenticated `sub`. */
export function rootForSub(baseRoot: string, sub: string): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("rootForSub: empty sub");
  }
  return join(baseRoot, "tenants", safePathSegment(sub));
}

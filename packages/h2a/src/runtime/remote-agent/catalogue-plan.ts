/**
 * Bounded catalogue projection planning per SPEC_EVOL_REMOTE_FASTLANE.md (r11 §7.2).
 */

import { canonicalTrunkJson, type CatalogueSessionRow } from "./types.js";

export interface CatalogueProjection {
  readonly rows: readonly CatalogueSessionRow[];
  readonly truncatedRows: number;
}

export type CataloguePlan =
  | { readonly kind: "none" }
  | { readonly kind: "snapshot" }
  | {
      readonly kind: "delta";
      readonly removes: readonly string[];
      readonly upserts: readonly CatalogueSessionRow[];
    };

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function catalogueRowsEqual(a: CatalogueSessionRow, b: CatalogueSessionRow): boolean {
  return canonicalTrunkJson(a) === canonicalTrunkJson(b);
}

export function planCatalogueUpdate(
  delivered: CatalogueProjection | null,
  latest: CatalogueProjection
): CataloguePlan {
  if (delivered === null) {
    return { kind: "snapshot" };
  }
  if (delivered.truncatedRows !== latest.truncatedRows) {
    return { kind: "snapshot" };
  }

  const deliveredById = new Map<string, CatalogueSessionRow>();
  for (const row of delivered.rows) {
    deliveredById.set(row.sessionId, row);
  }
  const latestById = new Map<string, CatalogueSessionRow>();
  for (const row of latest.rows) {
    latestById.set(row.sessionId, row);
  }

  if (latest.truncatedRows > 0) {
    if (deliveredById.size !== latestById.size) {
      return { kind: "snapshot" };
    }
    for (const sid of deliveredById.keys()) {
      if (!latestById.has(sid)) {
        return { kind: "snapshot" };
      }
    }
  }

  const removes: string[] = [];
  for (const sid of deliveredById.keys()) {
    if (!latestById.has(sid)) {
      removes.push(sid);
    }
  }
  removes.sort(compareAscii);

  const upserts: CatalogueSessionRow[] = [];
  for (const [sid, nextRow] of latestById.entries()) {
    const prevRow = deliveredById.get(sid);
    if (!prevRow || !catalogueRowsEqual(prevRow, nextRow)) {
      upserts.push(nextRow);
    }
  }
  upserts.sort((a, b) => compareAscii(a.sessionId, b.sessionId));

  if (removes.length === 0 && upserts.length === 0) {
    return { kind: "none" };
  }
  return { kind: "delta", removes, upserts };
}

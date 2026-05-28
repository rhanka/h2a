/**
 * DEC-098 — SysML v2 interop S2 (spec: docs/sysml-interop.md §7, DEC-081). The
 * I/O adapter: fetch a referenced element from the SysML v2 API & Services and
 * canonical-hash it for content-integrity (trust level (b), §4). Pure ref types
 * stay in core (S1); all I/O lives here. The verify path + CLI are S3.
 *
 * Endpoint follows the OMG SysML v2 API & Services REST/HTTP PSM:
 *   GET {apiBase}/projects/{project}/commits/{commit}/elements/{element}
 *
 * The HTTP client is injectable (`fetchImpl`) so the adapter is unit-testable
 * against a mock API with no network. API credentials are held out-of-band and
 * passed per call (`auth`); h2a never embeds them in envelopes (§6).
 */

import { computeHash, type H2ASysmlRef } from "@sentropic/h2a";

/** Minimal subset of the Fetch `Response` the adapter needs (global `fetch` satisfies it). */
export interface SysmlFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type SysmlFetchImpl = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<SysmlFetchResponse>;

export interface ResolveSysmlOptions {
  /** Repository base URL; falls back to `ref.apiBase`. */
  readonly apiBase?: string;
  /** Bearer token for the SysML API (held out-of-band, never in an envelope). */
  readonly auth?: string;
  /** Injected HTTP client; defaults to global `fetch`. */
  readonly fetchImpl?: SysmlFetchImpl;
}

function resolveBase(ref: H2ASysmlRef, options: ResolveSysmlOptions): string {
  const base = options.apiBase ?? ref.apiBase;
  if (!base) {
    throw new Error("resolveSysmlElement: apiBase is required (pass it or set ref.apiBase)");
  }
  return base.replace(/\/+$/, "");
}

/**
 * Fetch the referenced element at its immutable commit. Requires `ref.element`
 * (whole-project resolution — `element` omitted — is a later slice; default
 * documented in docs/loop-decisions.md). Throws on a non-OK HTTP status.
 */
export async function resolveSysmlElement(
  ref: H2ASysmlRef,
  options: ResolveSysmlOptions = {}
): Promise<unknown> {
  if (!ref.element) {
    throw new Error(
      "resolveSysmlElement: ref.element is required (whole-project resolution is not supported yet)"
    );
  }
  const base = resolveBase(ref, options);
  const url = `${base}/projects/${encodeURIComponent(ref.project)}/commits/${encodeURIComponent(
    ref.commit
  )}/elements/${encodeURIComponent(ref.element)}`;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as SysmlFetchImpl | undefined);
  if (!fetchImpl) {
    throw new Error("resolveSysmlElement: no fetch implementation available (pass fetchImpl)");
  }
  const headers = options.auth ? { Authorization: `Bearer ${options.auth}` } : undefined;
  const res = await fetchImpl(url, headers ? { headers } : undefined);
  if (!res.ok) {
    throw new Error(`resolveSysmlElement: ${url} returned HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Canonical hash of a fetched element, for content-integrity (trust level (b)).
 * Reuses the core canonical hashing (DEC-035) so the value is comparable to a
 * `ref.elementHash` embedded at sign time.
 */
export function hashSysmlElement(element: unknown): string {
  return computeHash(element);
}

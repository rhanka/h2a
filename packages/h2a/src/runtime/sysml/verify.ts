/**
 * DEC-099 — SysML v2 interop S3 (spec §4, DEC-081). Verify that an envelope's
 * embedded `H2ASysmlRef` is (a) signed by the claimed actor — **commit-trust**,
 * the default: a valid signature over an immutable commit is enough — and
 * optionally (b) **content-integrity**: re-fetch the element (S2) and check its
 * canonical hash against the `elementHash` embedded at sign time, catching a
 * repository that violated immutability or a wrong `apiBase`.
 */

import {
  isH2ASysmlRef,
  validateSysmlRef,
  verifyEnvelopeSignature,
  type H2AEnvelope,
  type H2ASysmlRef
} from "@sentropic/h2a";

import { hashSysmlElement, resolveSysmlElement, type SysmlFetchImpl } from "./client.js";

/** Extract the ref from the conventional location `body.subject.sysmlRef` (spec §2). */
export function extractSysmlRef(envelope: H2AEnvelope): H2ASysmlRef | undefined {
  const body = envelope.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return undefined;
  const subject = body.subject as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== "object") return undefined;
  const ref = subject.sysmlRef;
  return isH2ASysmlRef(ref) ? ref : undefined;
}

export interface VerifyEnvelopeSysmlOptions {
  /** Public key to verify the envelope signature against (commit-trust). */
  readonly publicKeyPem: string;
  /** Only accept a signature from this signer id. */
  readonly by?: string;
  /** Also re-fetch + re-hash the element and compare to `ref.elementHash`. */
  readonly contentIntegrity?: boolean;
  readonly apiBase?: string;
  readonly auth?: string;
  readonly fetchImpl?: SysmlFetchImpl;
}

export interface VerifyEnvelopeSysmlResult {
  readonly ok: boolean;
  readonly ref?: H2ASysmlRef;
  readonly signatureVerified: boolean;
  readonly contentVerified?: boolean;
  readonly reason?: string;
}

export async function verifyEnvelopeSysmlRef(
  envelope: H2AEnvelope,
  options: VerifyEnvelopeSysmlOptions
): Promise<VerifyEnvelopeSysmlResult> {
  const ref = extractSysmlRef(envelope);
  if (!ref) return { ok: false, signatureVerified: false, reason: "no-sysml-ref" };
  const validation = validateSysmlRef(ref);
  if (!validation.ok) {
    return { ok: false, ref, signatureVerified: false, reason: `invalid-ref:${validation.errors.join(",")}` };
  }
  const signatureVerified = verifyEnvelopeSignature(
    envelope,
    options.publicKeyPem,
    options.by ? { by: options.by } : {}
  );
  if (!signatureVerified) {
    return { ok: false, ref, signatureVerified: false, reason: "signature-failed" };
  }
  // (a) commit-trust: a valid signature over the immutable commit is enough.
  if (!options.contentIntegrity) {
    return { ok: true, ref, signatureVerified: true };
  }
  // (b) content-integrity: re-fetch + re-hash + compare.
  if (!ref.elementHash) {
    return { ok: false, ref, signatureVerified: true, contentVerified: false, reason: "no-element-hash" };
  }
  try {
    const element = await resolveSysmlElement(ref, {
      ...(options.apiBase ? { apiBase: options.apiBase } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    });
    const contentVerified = hashSysmlElement(element) === ref.elementHash;
    return {
      ok: contentVerified,
      ref,
      signatureVerified: true,
      contentVerified,
      ...(contentVerified ? {} : { reason: "content-hash-mismatch" })
    };
  } catch (err) {
    return {
      ok: false,
      ref,
      signatureVerified: true,
      contentVerified: false,
      reason: `fetch-failed:${(err as Error).message}`
    };
  }
}

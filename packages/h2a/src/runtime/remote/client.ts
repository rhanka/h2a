/**
 * HTTP client for signed envelopes (DEC-076), the send side of slice 3b.
 *
 * Signs an envelope (DEC-073) and POSTs it to a remote h2a endpoint. The
 * transport only moves bytes — provenance and freshness are carried in the
 * envelope itself and verified by the receiver (DEC-075).
 */

import { signEnvelope, type H2AEnvelope } from "@sentropic/h2a";

export interface SendRemoteOptions {
  /** Signer instance id recorded in the signature's `by`. */
  by: string;
  /** Signer's ed25519 private-key PEM. */
  privateKeyPem: string;
  /** Optional fetch override (tests / custom agents). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface SendRemoteResult {
  status: number;
  body: unknown;
}

/**
 * Sign `envelope` and POST it as JSON to `url`. Returns the HTTP status and the
 * parsed JSON body (or undefined if the response was not JSON). Network errors
 * propagate to the caller.
 */
export async function sendRemoteEnvelope(
  url: string,
  envelope: H2AEnvelope,
  options: SendRemoteOptions
): Promise<SendRemoteResult> {
  const signed = signEnvelope(envelope, {
    by: options.by,
    privateKeyPem: options.privateKeyPem
  });
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed)
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

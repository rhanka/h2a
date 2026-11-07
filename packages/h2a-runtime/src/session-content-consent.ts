/**
 * Versioned consent successor boundary, pre-SG-R15. Historical v2 records
 * and the N2 action journal are untouched. No pending nonce, consumed proof,
 * ACK, activation or refresh is stored or signed on this surface.
 */
import { CONTENT_POLICY_REFUSAL, type PolicyRefusal } from "./session-content-v3-api.js";

export interface ContentPolicyConsent {
  readonly consumeNonce: (value: unknown) => PolicyRefusal;
  readonly consumeProof: (value: unknown) => PolicyRefusal;
  readonly acceptActivationReceipt: (value: unknown) => PolicyRefusal;
  readonly refreshCapture: (value: unknown) => PolicyRefusal;
  readonly canCapture: () => false;
}

function refuse(_value: unknown): PolicyRefusal {
  return CONTENT_POLICY_REFUSAL;
}

/** No caller acceptance option, callbacks or writable state exists before SG-R15. */
export function createContentPolicyConsent(): ContentPolicyConsent {
  return Object.freeze({
    consumeNonce: refuse,
    consumeProof: refuse,
    acceptActivationReceipt: refuse,
    refreshCapture: refuse,
    canCapture: (): false => false,
  });
}

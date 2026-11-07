/**
 * N4 refusal boundary. SG-R15 has no bilateral receiving ACK, so this is
 * deliberately not a policy verifier implementation. Even coherent signed
 * fixtures refuse before input acquisition; no trust or fence is consulted.
 * Final signature/identity/pending-nonce verification belongs after SG-R15.
 */
import { CONTENT_POLICY_REFUSAL, type PolicyRefusal } from "./session-content-v3-api.js";

export function verifyContentPolicyProof(_value: unknown): PolicyRefusal {
  return CONTENT_POLICY_REFUSAL;
}

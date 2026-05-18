import {
  H2A_NEGOTIATION_STATES,
  type H2ANegotiationState
} from "./types.js";

export function assertValidNegotiationState(
  state: string
): H2ANegotiationState {
  if (H2A_NEGOTIATION_STATES.includes(state as H2ANegotiationState)) {
    return state as H2ANegotiationState;
  }

  throw new Error(`Unknown negotiation state: ${state}`);
}

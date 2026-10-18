/** G4 composition deliberately remains closed: the pinned dependencies have no
 * L8 publication policy contract. Wiring a caller-supplied boolean here would
 * manufacture authority. The collector and session gateway stay independent.
 */
import { createLiveDisclosureAuthority, type LiveDisclosureOptions } from "./live-disclosure.js";

export function createLiveDisclosureHost(options: LiveDisclosureOptions) {
  const authority = createLiveDisclosureAuthority(options);
  return Object.freeze({
    grant: authority.grant,
    revoke: authority.revoke,
    emit: async (_request: unknown) => authority.policyUnavailable(),
  });
}

/**
 * h2a → sentropic session-exposure feed (P1). Read-only, principal-scoped
 * presence/session descriptors. Contract:
 * `docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md`
 * (ratified 2026-07-24).
 *
 * Step 1 = these pure builders only. No HTTP route, no auth, no binding store,
 * no push daemon, no gateway, no UI — each of those is a separate, separately
 * gated step of the plan.
 */
export {
  buildFeedResponse,
  buildInstanceDescriptor,
  buildInstanceDescriptors,
  buildSessionDescriptor,
  buildSessionDescriptors,
  deriveLiveness,
  deriveSessionState,
  rollUpLiveness,
  type BuildFeedInput,
  type BuildInstanceDescriptorOptions,
  type BuildSessionDescriptorOptions,
  type H2AFeedResponse,
  type H2ALivenessState,
  type InstanceDescriptor,
  type SessionDescriptor
} from "./descriptors.js";

export {
  readLocalFeed,
  type FeedPresenceReader,
  type FeedRegistrationSource,
  type ReadLocalFeedOptions
} from "./local.js";

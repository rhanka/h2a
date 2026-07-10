import type { PendingDecision } from "./contract.js";
import type { FeedbackIntent } from "./feedback.js";

export interface FocusSyncSnapshot {
  readonly projectHash: string;
  readonly projectRoot?: string;
  readonly decisions: readonly PendingDecision[];
  readonly readAt: string;
}

export interface FocusSyncClient {
  /** Data-only port. L-C owns auth, transport, Origin/Host checks and IO. */
  readonly read: () => Promise<readonly FocusSyncSnapshot[]>;
  /** Data-only port. This package only emits intents; L-C decides the authoritative backend. */
  readonly submitIntent: (intent: FeedbackIntent) => Promise<FocusSyncAck>;
}

export interface FocusSyncAck {
  readonly accepted: boolean;
  readonly decisionKey: string;
  readonly reason?: string;
}

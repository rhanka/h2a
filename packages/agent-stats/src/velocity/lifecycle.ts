/**
 * Velocity L2 lifecycle: lot starts and attribution (read-only, no inference).
 */

export interface LotStartInput {
  prOpenedAt: string;
  committerAt: string | null;
  firstCommitAt: string | null;
}

export interface LotStartResult {
  lotStart: null;
  negativeDuration: false;
  reason: string;
  firstCommitPolicy: "proxy-only-excluded-from-forecasts";
}

export function lotStartFromEvidence(input: LotStartInput): LotStartResult {
  void input;
  return {
    lotStart: null,
    negativeDuration: false,
    reason: "first-commit clock unreliable after rebase; proxy-only, no silent lot-start reset",
    firstCommitPolicy: "proxy-only-excluded-from-forecasts",
  };
}

export interface AttributeInput {
  githubReviews: unknown[];
  externalReview?: { reviewer: string; evidenceRef: string };
  authorLogin: string;
  host?: string;
}

export interface AttributeResult {
  reviewKept: boolean;
  model: "unattributed";
  agent: "unattributed";
}

export function attributeRole(input: AttributeInput): AttributeResult {
  void input.authorLogin;
  void input.host;
  return {
    reviewKept: Boolean(input.externalReview),
    model: "unattributed",
    agent: "unattributed",
  };
}

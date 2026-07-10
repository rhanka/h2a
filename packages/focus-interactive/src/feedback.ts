import type { DecisionSource } from "./contract.js";

export type FeedbackKind = "accept" | "reject" | "comment" | "answer";

export interface FeedbackIntentBase {
  readonly kind: FeedbackKind;
  readonly decisionKey: string;
  readonly source: DecisionSource;
  readonly createdAt: string;
  readonly note?: string;
}

export interface AcceptIntent extends FeedbackIntentBase {
  readonly kind: "accept";
  readonly optionId?: string;
}

export interface RejectIntent extends FeedbackIntentBase {
  readonly kind: "reject";
  readonly optionId?: string;
}

export interface CommentIntent extends FeedbackIntentBase {
  readonly kind: "comment";
  readonly comment: string;
}

export interface AnswerIntent extends FeedbackIntentBase {
  readonly kind: "answer";
  readonly answer: string;
  readonly optionId?: string;
}

export type FeedbackIntent = AcceptIntent | RejectIntent | CommentIntent | AnswerIntent;

export type FeedbackDraft =
  | Omit<AcceptIntent, "source" | "createdAt">
  | Omit<RejectIntent, "source" | "createdAt">
  | Omit<CommentIntent, "source" | "createdAt">
  | Omit<AnswerIntent, "source" | "createdAt">;

export interface CaptureFeedbackOptions {
  readonly source: DecisionSource;
  readonly now?: () => string;
}

export function captureFeedbackIntent(
  draft: FeedbackDraft,
  options: CaptureFeedbackOptions
): FeedbackIntent {
  const createdAt = options.now?.() ?? new Date().toISOString();
  switch (draft.kind) {
    case "accept":
      return { ...draft, source: options.source, createdAt };
    case "reject":
      return { ...draft, source: options.source, createdAt };
    case "comment":
      if (draft.comment.trim().length === 0) {
        throw new Error("captureFeedbackIntent: comment must be non-empty");
      }
      return { ...draft, source: options.source, createdAt };
    case "answer":
      if (draft.answer.trim().length === 0) {
        throw new Error("captureFeedbackIntent: answer must be non-empty");
      }
      return { ...draft, source: options.source, createdAt };
  }
}

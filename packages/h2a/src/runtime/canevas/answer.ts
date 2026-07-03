// Canevas ③ tranche-3b — IO shell for the reply-bridge. Idempotent (one reply
// per decision, journalled), resolves the escalating instance LIVE before
// delivering (RISK #1: never reply to a stale/wrong session), and writes a
// structured reply-envelope to that instance's inbox.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { listPresence } from "../local-files/presence.js";
import { localStorePaths, safePathSegment } from "../local-files/paths.js";
import { createLocalStore } from "../local-files/store.js";
import { gatherPendingDecisions } from "./gather.js";
import { buildDecisionReplyEnvelope, type ReplyRecord } from "./reply.js";

export type AnswerStatus = "answered" | "already" | "not-found" | "no-live-target" | "invalid";

export interface AnswerResult {
  readonly status: AnswerStatus;
  readonly decisionId: string;
  readonly answerId?: string;
  readonly envelopeId?: string;
  readonly targetInstance?: string;
  readonly reason?: string;
}

export interface PostAnswerDeps {
  readonly now: number;
  readonly envelopeId: string;
}

function repliesDir(root: string): string {
  return join(localStorePaths(root).root, "canevas", "replies");
}
function replyFile(root: string, decisionId: string): string {
  return join(repliesDir(root), `${safePathSegment(decisionId)}.json`);
}

/** True if a reply was already recorded for this decision (idempotence). */
export function hasAlreadyAnswered(root: string, decisionId: string): boolean {
  return existsSync(replyFile(root, decisionId));
}

export function postDecisionAnswer(
  root: string,
  input: { decisionId: string; answerId: string; note?: string },
  deps: PostAnswerDeps
): AnswerResult {
  const { decisionId, answerId } = input;
  if (!decisionId || !answerId) {
    return { status: "invalid", decisionId, reason: "decisionId and answerId are required" };
  }

  // Idempotence — one reply per decision.
  if (hasAlreadyAnswered(root, decisionId)) {
    return { status: "already", decisionId, reason: "decision already answered" };
  }

  // The decision must still be pending.
  const decision = gatherPendingDecisions(root).find((d) => d.id === decisionId);
  if (!decision) return { status: "not-found", decisionId, reason: "decision is not pending" };

  // Resolve the escalating instance LIVE (RISK #1): never deliver to a stale
  // instance — the answer could land in the wrong session.
  const live = listPresence(root).some((s) => s.instance === decision.instance);
  if (!live) {
    return { status: "no-live-target", decisionId, reason: `escalating instance ${decision.instance} is not live` };
  }

  const at = new Date(deps.now).toISOString();
  const envelope = buildDecisionReplyEnvelope({
    decisionId,
    answerId,
    ...(input.note !== undefined ? { note: input.note } : {}),
    targetInstance: decision.instance,
    envelopeId: deps.envelopeId,
    createdAt: at
  });

  createLocalStore({ root }).putInboxMessage(decision.instance, envelope);

  const record: ReplyRecord = {
    decisionId,
    answerId,
    envelopeId: deps.envelopeId,
    targetInstance: decision.instance,
    createdAt: at
  };
  mkdirSync(repliesDir(root), { recursive: true });
  writeFileSync(replyFile(root, decisionId), `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return { status: "answered", decisionId, answerId, envelopeId: deps.envelopeId, targetInstance: decision.instance };
}

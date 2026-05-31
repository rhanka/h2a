/**
 * D4 receive side. A remote relance request is just an inbox envelope; this
 * consumer turns `drumbeat.resume` messages into local relauncher calls.
 */

import {
  H2A_DRUMBEAT_RESUME_BODY_KIND,
  parseDrumbeatResumeBody,
  type H2AEnvelope
} from "@sentropic/h2a";

import {
  createLocalStore,
  type LocalStore
} from "../local-files/store.js";
import {
  markRelanced,
  readDrumbeatEntry
} from "./registry.js";
import type { H2ADrumbeatFinding } from "./scan.js";
import type { H2ARelauncher } from "./watch.js";

export type H2ARelanceInboxSkipReason =
  | "malformed"
  | "target-mismatch"
  | "no-entry"
  | "done"
  | "terminal"
  | "declined"
  | "failed";

export interface H2ARelanceInboxSkip {
  readonly envelopeId: string;
  readonly reason: H2ARelanceInboxSkipReason;
  readonly target?: string;
}

export interface H2ARelanceInboxResult {
  readonly relanced: readonly string[];
  readonly skipped: readonly H2ARelanceInboxSkip[];
}

export interface RelanceFromInboxOptions {
  readonly instances?: readonly string[];
  readonly relauncher: H2ARelauncher;
  readonly store?: LocalStore;
  readonly now?: number;
}

function hasResumeKind(envelope: H2AEnvelope): boolean {
  const body = envelope.body;
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { kind?: unknown }).kind === H2A_DRUMBEAT_RESUME_BODY_KIND
  );
}

function findingFromEntry(entry: NonNullable<ReturnType<typeof readDrumbeatEntry>>): H2ADrumbeatFinding {
  return {
    instance: entry.instance,
    reason: entry.workStatus === "out-of-tokens" ? "out-of-tokens" : "stopped",
    workStatus: entry.workStatus,
    ...(entry.launchContext ? { launchContext: entry.launchContext } : {}),
    relanceCount: entry.relanceCount
  };
}

/**
 * Drain `drumbeat.resume` envelopes from local inboxes. Non-D4 inbox mail is
 * left untouched; malformed or stale D4 messages are popped so they do not
 * poison every future consume pass.
 */
export async function relanceFromInbox(
  root: string,
  options: RelanceFromInboxOptions
): Promise<H2ARelanceInboxResult> {
  const store = options.store ?? createLocalStore({ root });
  const instances = options.instances ?? store.listInstances().map((r) => r.instance);
  const relanced: string[] = [];
  const skipped: H2ARelanceInboxSkip[] = [];

  for (const inboxInstance of instances) {
    for (const envelope of store.readInbox(inboxInstance)) {
      const body = parseDrumbeatResumeBody(envelope.body);
      if (!body) {
        if (hasResumeKind(envelope)) {
          store.popInboxMessage(inboxInstance, envelope.id);
          skipped.push({ envelopeId: envelope.id, reason: "malformed" });
        }
        continue;
      }

      if (body.target !== inboxInstance) {
        store.popInboxMessage(inboxInstance, envelope.id);
        skipped.push({ envelopeId: envelope.id, reason: "target-mismatch", target: body.target });
        continue;
      }

      const entry = readDrumbeatEntry(root, body.target);
      if (!entry) {
        store.popInboxMessage(inboxInstance, envelope.id);
        skipped.push({ envelopeId: envelope.id, reason: "no-entry", target: body.target });
        continue;
      }
      if (entry.workStatus === "done") {
        store.popInboxMessage(inboxInstance, envelope.id);
        skipped.push({ envelopeId: envelope.id, reason: "done", target: body.target });
        continue;
      }
      if (entry.terminal) {
        store.popInboxMessage(inboxInstance, envelope.id);
        skipped.push({ envelopeId: envelope.id, reason: "terminal", target: body.target });
        continue;
      }

      let issued = false;
      let failed = false;
      try {
        issued = await options.relauncher.relance(findingFromEntry(entry));
      } catch {
        failed = true;
      }
      store.popInboxMessage(inboxInstance, envelope.id);
      if (issued) {
        markRelanced(root, body.target, options.now);
        relanced.push(body.target);
      } else {
        skipped.push({
          envelopeId: envelope.id,
          reason: failed ? "failed" : "declined",
          target: body.target
        });
      }
    }
  }

  return { relanced, skipped };
}

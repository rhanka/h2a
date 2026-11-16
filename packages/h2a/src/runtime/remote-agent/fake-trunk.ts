/**
 * In-memory fake trunk endpoint (LH-00). No socket, no dial, no persistence.
 *
 * Used only behind the LH-00 flag in tests with loopback fakes: `openLink`
 * refuses with `remote-control-disabled` before any signature check whenever
 * the flag is off, so a disabled flag cannot start a link or run agent code.
 * Challenge binding to tenant and endpoint and single-use nonces are fixture
 * behaviour only; Q-06 folds the ceremony bounds (caps, lifetime, poll
 * authenticator, nonce size and single use) on the sentropic side.
 */

import { createPublicKey, type KeyObject } from "node:crypto";
import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_REASON } from "./flag.js";
import {
  verifyTrunkAuthPayload,
  type TrunkAuthPayload,
  type TrunkChallenge
} from "./types.js";

export type FakeTrunkOpenResult =
  | { readonly ok: true; readonly linkGeneration: number }
  | { readonly ok: false; readonly reason: string };

interface FixtureKey {
  readonly nodeId: string;
  readonly publicKey: KeyObject;
  readonly enrolmentRef: string;
  readonly fingerprint: string;
}

interface LiveLink {
  readonly linkGeneration: number;
  readonly nodeId: string;
  readonly enrolmentRef: string;
}

export interface FakeTrunkOptions {
  readonly tenantId: string;
  readonly endpoint: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export class FakeTrunkEndpoint {
  readonly #tenantId: string;
  readonly #endpoint: string;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #keys = new Map<string, FixtureKey>();
  readonly #challenges = new Map<string, { readonly challenge: TrunkChallenge; used: boolean }>();
  readonly #links = new Map<number, LiveLink>();
  #generation = 0;

  constructor(options: FakeTrunkOptions) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
    this.#env = options.env ?? process.env;
  }

  registerFixtureKey(input: { readonly nodeId: string; readonly publicKeyPem: string | KeyObject; readonly enrolmentRef: string; readonly fingerprint?: string }): void {
    const publicKey = typeof input.publicKeyPem === "string" ? createPublicKey(input.publicKeyPem) : input.publicKeyPem;
    this.#keys.set(input.enrolmentRef, {
      nodeId: input.nodeId,
      publicKey,
      enrolmentRef: input.enrolmentRef,
      fingerprint: input.fingerprint ?? "fixture-fingerprint"
    });
  }

  issueChallenge(challenge: TrunkChallenge): { readonly ok: true; readonly challenge: TrunkChallenge } | { readonly ok: false; readonly reason: string } {
    if (challenge.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (challenge.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    this.#challenges.set(challenge.nonce, { challenge, used: false });
    return { ok: true, challenge };
  }

  openLink(input: { readonly challenge: TrunkChallenge; readonly payload: TrunkAuthPayload; readonly signature: string }): FakeTrunkOpenResult {
    if (!isRemoteControlEnabled(this.#env)) return { ok: false, reason: REMOTE_CONTROL_DISABLED_REASON };
    const stored = this.#challenges.get(input.payload.nonce);
    if (!stored) return { ok: false, reason: "unknown-challenge" };
    if (stored.used) return { ok: false, reason: "challenge-replayed" };
    if (stored.challenge.tenantId !== this.#tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (stored.challenge.endpoint !== this.#endpoint) return { ok: false, reason: "endpoint-mismatch" };
    if (input.payload.nonce !== stored.challenge.nonce) return { ok: false, reason: "nonce-mismatch" };
    if (input.payload.nodeId !== stored.challenge.nodeId || input.payload.enrolmentRef !== stored.challenge.enrolmentRef) {
      return { ok: false, reason: "identity-mismatch" };
    }
    const fixture = this.#keys.get(input.payload.enrolmentRef);
    if (!fixture) return { ok: false, reason: "unknown-enrolment" };
    if (fixture.nodeId !== input.payload.nodeId) return { ok: false, reason: "identity-mismatch" };
    if (!verifyTrunkAuthPayload(input.payload, input.signature, fixture.publicKey)) {
      return { ok: false, reason: "invalid-signature" };
    }
    stored.used = true;
    this.#generation += 1;
    this.#links.set(this.#generation, { linkGeneration: this.#generation, nodeId: input.payload.nodeId, enrolmentRef: input.payload.enrolmentRef });
    return { ok: true, linkGeneration: this.#generation };
  }

  liveLinkCount(): number {
    return this.#links.size;
  }
}

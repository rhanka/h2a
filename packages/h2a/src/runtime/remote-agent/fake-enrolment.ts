/**
 * In-memory fake enrolment verifier (LH-00). No transport, no token, no
 * persistence. The real ceremony client lands in LH-11 against the published
 * contract vectors; this verifier only proves the flag-off and possession
 * checks in CI.
 */

import { createPublicKey, type KeyObject } from "node:crypto";
import { verifyTrunkAuthPayload } from "./types.js";

export interface FakeEnrolmentRequestPayload {
  readonly nodeId: string;
  readonly publicKeyPem: string;
  readonly deviceName: string;
  readonly nonce: string;
}

export type FakeEnrolmentVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type FakeEnrolmentApproveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

interface NodeRecord {
  readonly publicKey: KeyObject;
  readonly fingerprint: string;
  revoked: boolean;
  approved: boolean;
}

export interface FakeEnrolmentOptions {
  readonly tenantId: string;
  readonly endpoint: string;
}

const OPERATE_ASSURANCE_CLIENT = "urn:sentropic:loa:passkey-fresh";
const OPERATE_ASSURANCE_FACTORS = ["hwk", "user", "mfa"] as const;

export class FakeEnrolmentVerifier {
  readonly #tenantId: string;
  readonly #endpoint: string;
  readonly #nodes = new Map<string, NodeRecord>();

  constructor(options: FakeEnrolmentOptions) {
    this.#tenantId = options.tenantId;
    this.#endpoint = options.endpoint;
  }

  registerNode(input: { readonly nodeId: string; readonly publicKeyPem: string | KeyObject; readonly fingerprint: string }): void {
    const publicKey = typeof input.publicKeyPem === "string" ? createPublicKey(input.publicKeyPem) : input.publicKeyPem;
    this.#nodes.set(input.nodeId, { publicKey, fingerprint: input.fingerprint, revoked: false, approved: false });
  }

  verifyRequest(input: { readonly payload: FakeEnrolmentRequestPayload; readonly signature: string }): FakeEnrolmentVerifyResult {
    const node = this.#nodes.get(input.payload.nodeId);
    if (!node) return { ok: false, reason: "unknown-node" };
    if (node.revoked) return { ok: false, reason: "node-revoked" };
    const payloadRecord: Record<string, unknown> = {
      nodeId: input.payload.nodeId,
      publicKeyPem: input.payload.publicKeyPem,
      deviceName: input.payload.deviceName,
      nonce: input.payload.nonce
    };
    if (!verifyTrunkAuthPayload(payloadRecord, input.signature, node.publicKey)) {
      return { ok: false, reason: "invalid-signature" };
    }
    return { ok: true };
  }

  approve(input: {
    readonly nodeId: string;
    readonly approval: { readonly client: string; readonly acr: string; readonly amr: readonly string[]; readonly authTime: number };
    readonly usages: readonly string[];
  }): FakeEnrolmentApproveResult {
    const node = this.#nodes.get(input.nodeId);
    if (!node) return { ok: false, reason: "unknown-node" };
    if (node.revoked) return { ok: false, reason: "node-revoked" };
    if (input.usages.includes("sessions.operate")) {
      if (input.approval.acr !== OPERATE_ASSURANCE_CLIENT) return { ok: false, reason: "assurance-insufficient" };
      for (const factor of OPERATE_ASSURANCE_FACTORS) {
        if (!input.approval.amr.includes(factor)) return { ok: false, reason: "assurance-insufficient" };
      }
    }
    node.approved = true;
    return { ok: true };
  }

  isLive(nodeId: string): boolean {
    const node = this.#nodes.get(nodeId);
    return node !== undefined && node.approved && !node.revoked;
  }

  revoke(input: { readonly nodeId: string }): void {
    const node = this.#nodes.get(input.nodeId);
    if (node) node.revoked = true;
  }

  tenantId(): string {
    return this.#tenantId;
  }

  endpoint(): string {
    return this.#endpoint;
  }
}

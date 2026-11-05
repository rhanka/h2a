/**
 * Host adapter binding CLI proofs to native terminal sessions (cell N3).
 *
 * Reads the issuing facts (`id`, host `generation`/`incarnation`,
 * `controllerEpoch`, `latestSeq`, PTY `pid`) from the host session table and
 * composes them with the approved admission plus the enrollment, signer and
 * provider metadata. Only wire integer generations from the approved
 * admission ever reach the record; host generation/incarnation strings are
 * never coerced.
 *
 * Lifecycle invalidation is host-local: a proof verifies only while its
 * session is running, on the incarnation it was issued for, and for the
 * current permission mode. Close, replace (same id, new incarnation) or a
 * mode switch refuses the prior proof. No route, no transport, no effect.
 */

import { digestDomain, isGeneration } from "../remote-action-contract.js";
import { VerifyError, type VerifyOptions } from "../remote-action-verifier.js";
import {
  mintCliSessionProof,
  resolveCliProofTarget,
  verifyCliSessionProofBinding,
  type CliProofMintInput,
  type CliProofPermissionMode,
  type CliProofSourceAdmission,
  type SignedCliSessionProof,
} from "../remote-action-cli-proof.js";
import type { NativeTerminalSessionState } from "./host.js";

export type { SignedCliSessionProof } from "../remote-action-cli-proof.js";

/** Structural host surface the authority reads; satisfied by `NativeTerminalHost`. */
export interface CliProofHostReader {
  state(id: string): NativeTerminalSessionState;
}

export type CliProofSessionComposition = Omit<CliProofMintInput, "target"> & {
  admission: CliProofSourceAdmission | null;
};

interface IssuedCliProof {
  incarnation: string;
  permissionMode: CliProofPermissionMode;
  targetDigest: string;
  ownerIssuer: string;
  ownerSub: string;
  approvedRegistrationRef: string;
  approvedRegistrationRevision: number;
  providerId: string;
  providerVersion: string;
  executableDigest: string;
  nativeSessionPublicKeyId: string;
  capabilitiesDigest: string;
  autoApprovePolicyDigest: string | null;
  proofId: string;
  issuedAt: number;
  expiresAt: number;
}

function authorityRefused(message: string): never {
  throw new VerifyError("authority_refused", `native cli-proof authority: ${message}`);
}

export class NativeTerminalActionAuthority {
  readonly #host: CliProofHostReader;
  readonly #issued = new Map<string, IssuedCliProof>();

  constructor(host: CliProofHostReader) {
    this.#host = host;
  }

  #readRunningState(sessionId: string): NativeTerminalSessionState {
    let state: NativeTerminalSessionState;
    try {
      state = this.#host.state(sessionId);
    } catch {
      authorityRefused(`unknown terminal session: ${sessionId}`);
    }
    if (state.status !== "running") {
      authorityRefused(`terminal session is not running: ${sessionId}`);
    }
    return state;
  }

  /**
   * Issue a proof for the live session `sessionId`, binding the host-table
   * facts to the approved admission and composition. Refuses when the host
   * table does not own a running session, and with the typed source-gap code
   * when any approved composition input is missing.
   */
  issueSessionProof(
    sessionId: string,
    composition: CliProofSessionComposition,
    nowMs: number,
  ): SignedCliSessionProof {
    const state = this.#readRunningState(sessionId);
    if (!isGeneration(state.controllerEpoch)) {
      authorityRefused(`terminal session has no controller epoch: ${sessionId}`);
    }
    const target = resolveCliProofTarget(composition.admission, {
      nativeSessionId: state.id,
      controllerEpoch: state.controllerEpoch,
      hostGeneration: state.generation,
      incarnation: state.incarnation,
    });
    const record = mintCliSessionProof({ ...composition, target }, nowMs);
    const provider = composition.provider;
    if (provider === null) {
      // Unreachable: minting refused the missing provider above.
      authorityRefused(`terminal session composition lost its provider: ${sessionId}`);
    }
    const enrollment = composition.enrollment;
    if (enrollment === null) {
      // Unreachable: minting refused the missing enrollment above.
      authorityRefused(`terminal session composition lost its enrollment: ${sessionId}`);
    }
    this.#issued.set(sessionId, {
      incarnation: state.incarnation,
      permissionMode: composition.permissionMode,
      targetDigest: digestDomain("target", target),
      ownerIssuer: composition.owner.issuer,
      ownerSub: composition.owner.sub,
      approvedRegistrationRef: enrollment.approvedRegistrationRef,
      approvedRegistrationRevision: enrollment.approvedRegistrationRevision,
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      executableDigest: provider.executableDigest,
      nativeSessionPublicKeyId: composition.nativeSessionPublicKeyId,
      capabilitiesDigest: composition.capabilitiesDigest,
      autoApprovePolicyDigest: composition.autoApprovePolicyDigest,
      proofId: record.body["proofId"] as string,
      issuedAt: record.body["issuedAt"] as number,
      expiresAt: record.body["expiresAt"] as number,
    });
    return record;
  }

  /**
   * Verify a proof against the live session: running status, issuing
   * incarnation, current permission mode, then the §7 byte binding. A closed
   * or replaced session, a mode switch, or any field mutation refuses.
   */
  verifySessionProof(
    sessionId: string,
    record: unknown,
    options: VerifyOptions,
  ): Record<string, unknown> {
    const state = this.#readRunningState(sessionId);
    const issued = this.#issued.get(sessionId);
    if (issued === undefined) {
      authorityRefused(`no proof issued for terminal session: ${sessionId}`);
    }
    if (state.incarnation !== issued.incarnation) {
      throw new VerifyError(
        "binding_mismatch",
        "native cli-proof authority: session incarnation replaced",
      );
    }
    return verifyCliSessionProofBinding(record, options, {
      targetDigest: issued.targetDigest,
      ownerIssuer: issued.ownerIssuer,
      ownerSub: issued.ownerSub,
      approvedRegistrationRef: issued.approvedRegistrationRef,
      approvedRegistrationRevision: issued.approvedRegistrationRevision,
      providerId: issued.providerId,
      providerVersion: issued.providerVersion,
      executableDigest: issued.executableDigest,
      nativeSessionPublicKeyId: issued.nativeSessionPublicKeyId,
      capabilitiesDigest: issued.capabilitiesDigest,
      permissionMode: issued.permissionMode,
      autoApprovePolicyDigest: issued.autoApprovePolicyDigest,
      proofId: issued.proofId,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
    });
  }

  /**
   * Record a permission-mode switch for a session with a live proof. Prior
   * proofs (issued for the previous mode) refuse from this point on.
   */
  setSessionPermissionMode(sessionId: string, mode: CliProofPermissionMode): void {
    const issued = this.#issued.get(sessionId);
    if (issued === undefined) {
      authorityRefused(`no proof issued for terminal session: ${sessionId}`);
    }
    issued.permissionMode = mode;
  }
}

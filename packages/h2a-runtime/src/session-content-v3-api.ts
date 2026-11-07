/**
 * Pre-SG-R15 content-policy surface. Parsing returns detached, untrusted
 * schema data only. No signature, consent, persistence or capture authority.
 * Types and schema projection follow the pinned r3 records in fixtures.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import { canonicalJson } from "./remote-action-contract.js";
import { policySchema } from "./fixtures/session-content/v3/policy-proof/schemas.js";

export const CONTENT_POLICY_ACCEPTANCE = Object.freeze({
  format: "h2a.session-content-policy/1",
  status: "proposed-bilateral-supplement",
  accepted: false,
  routes: Object.freeze(["grant-fetch","policy-fetch","activation-ack","native-challenge","source-control","policy-intent","policy-confirm","policy-idp"]),
} as const);

export type PolicyRefusal = Readonly<{ ok: false; code: "unsupported_version" }>;
export const CONTENT_POLICY_REFUSAL: PolicyRefusal =
  Object.freeze({ ok: false, code: "unsupported_version" });

export type ContentPolicyV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "policy";
  readonly "policyId": PolicyId;
  readonly "policyRevision": PolicyCounter;
  readonly "bindingId": PolicyId;
  readonly "approvedRegistrationRef": PolicyRevisionRef;
  readonly "projectId": (PolicyId) | (null);
  readonly "sourceBinding": PolicyPolicySourceBinding;
  readonly "channels": {
    readonly "session.events": PolicyRetainedChannel;
    readonly "terminal.live": {
      readonly "enabled": boolean;
    };
    readonly "terminal.cache": PolicyRetainedChannel;
    readonly "native.mirror": {
      readonly "enabled": boolean;
      readonly "retention": ({
        readonly "kind": "none";
      }) | ({
        readonly "kind": "finite";
        readonly "durationMs": number;
      });
      readonly "nativeFormat": (PolicyId) | (null);
      readonly "permittedRangeRef": (PolicyRevisionRef) | (null);
    };
  };
  readonly "createdAt": PolicyTimestamp;
};

export type ContentPolicyNonceV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "policy-nonce";
    readonly "nonceId": PolicyRandomId;
    readonly "nonce": PolicyKey32;
    readonly "proposalId": PolicyRandomId;
    readonly "policyOperationId": PolicyRandomId;
    readonly "purpose": "share" | "amend";
    readonly "target": PolicyTarget;
    readonly "policyDigest": PolicyDigest;
    readonly "priorPolicyDigest": (PolicyDigest) | (null);
    readonly "expectedPolicyRevision": PolicyCounter;
    readonly "sourceDenialFloor": PolicyCounter;
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyIntentV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "policy-intent";
  readonly "policyOperationId": PolicyRandomId;
  readonly "purpose": "share" | "amend";
  readonly "expectedPolicyRevision": PolicyCounter;
  readonly "priorPolicyDigest": (PolicyDigest) | (null);
  readonly "policy": ContentPolicyV1;
};

export type ContentPolicyProposalV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "policy-proposal";
  readonly "proposalId": PolicyRandomId;
  readonly "policyOperationId": PolicyRandomId;
  readonly "purpose": "share" | "amend";
  readonly "target": PolicyTarget;
  readonly "policy": ContentPolicyV1;
  readonly "policyDigest": PolicyDigest;
  readonly "priorPolicyDigest": (PolicyDigest) | (null);
  readonly "expectedPolicyRevision": PolicyCounter;
  readonly "nonce": ContentPolicyNonceV1;
};

export type ContentPolicyChallengeRequestV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "challenge-request";
  readonly "proposalId": PolicyRandomId;
  readonly "policyOperationId": PolicyRandomId;
  readonly "purpose": "share" | "amend";
  readonly "target": PolicyTarget;
  readonly "policyDigest": PolicyDigest;
  readonly "priorPolicyDigest": (PolicyDigest) | (null);
  readonly "expectedPolicyRevision": PolicyCounter;
  readonly "issuedAt": PolicyTimestamp;
  readonly "expiresAt": PolicyTimestamp;
};

export type ContentPolicyNonceAckV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "nonce-ack";
  readonly "proposalId": PolicyRandomId;
  readonly "policyOperationId": PolicyRandomId;
  readonly "nonceDigest": PolicyDigest;
  readonly "status": "committed";
};

export type ContentPolicyEvidenceRequestV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "evidence-request";
  readonly "policyOperationId": PolicyRandomId;
  readonly "proposalId": PolicyRandomId;
  readonly "purpose": "share" | "amend";
  readonly "targetDigest": PolicyDigest;
  readonly "policyDigest": PolicyDigest;
  readonly "priorPolicyDigest": (PolicyDigest) | (null);
  readonly "expectedPolicyRevision": PolicyCounter;
  readonly "nonceId": PolicyRandomId;
  readonly "sid": PolicyId;
  readonly "sessionVersion": PolicyCounter;
  readonly "sessionCredential": string;
};

export type ContentPolicyIdpClaimsV1 = {
  readonly "iss": PolicyId;
  readonly "sub": PolicyId;
  readonly "sid": PolicyId;
  readonly "sessionVersion": PolicyCounter;
  readonly "tenantId": PolicyId;
  readonly "workspaceId": PolicyId;
  readonly "auth_time": PolicyCounter;
  readonly "amr": readonly (PolicyId)[];
  readonly "aud": PolicyId;
  readonly "iat": PolicyCounter;
  readonly "exp": PolicyCounter;
  readonly "jti": PolicyRandomId;
  readonly "policyOperationId": PolicyRandomId;
  readonly "proposalId": PolicyRandomId;
  readonly "purpose": "share" | "amend";
  readonly "targetDigest": PolicyDigest;
  readonly "policyDigest": PolicyDigest;
  readonly "priorPolicyDigest": (PolicyDigest) | (null);
  readonly "expectedPolicyRevision": PolicyCounter;
  readonly "nonceId": PolicyRandomId;
};

export type ContentPolicyIdpEvidenceV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "idp-evidence";
  readonly "compactJws": string;
};

export type ContentPolicyAppAttestationV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "app-attestation";
    readonly "actor": PolicyActor;
    readonly "tenantId": PolicyId;
    readonly "workspaceId": PolicyId;
    readonly "target": PolicyTarget;
    readonly "approvedRegistrationRef": PolicyRevisionRef;
    readonly "policyOperationId": PolicyRandomId;
    readonly "proposalId": PolicyRandomId;
    readonly "purpose": "share" | "amend";
    readonly "policyDigest": PolicyDigest;
    readonly "priorPolicyDigest": (PolicyDigest) | (null);
    readonly "expectedPolicyRevision": PolicyCounter;
    readonly "nonceId": PolicyRandomId;
    readonly "nonce": PolicyKey32;
    readonly "membershipRevision": PolicyCounter;
    readonly "role": "member" | "workspace-admin" | "workspace-owner";
    readonly "ownerConsentRevision": PolicyCounter;
    readonly "sourceDenialFloor": PolicyCounter;
    readonly "sessionEvidenceDigest": PolicyDigest;
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyProofV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "policy-proof";
    readonly "policyOperationId": PolicyRandomId;
    readonly "proposalId": PolicyRandomId;
    readonly "purpose": "share" | "amend";
    readonly "policy": ContentPolicyV1;
    readonly "policyDigest": PolicyDigest;
    readonly "priorPolicyDigest": (PolicyDigest) | (null);
    readonly "expectedPolicyRevision": PolicyCounter;
    readonly "nonce": ContentPolicyNonceV1;
    readonly "idpEvidence": ContentPolicyIdpEvidenceV1;
    readonly "appAttestation": ContentPolicyAppAttestationV1;
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyActivationAckV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "activation-ack";
    readonly "policyOperationId": PolicyRandomId;
    readonly "proposalId": PolicyRandomId;
    readonly "policyId": PolicyId;
    readonly "policyRevision": PolicyCounter;
    readonly "policyDigest": PolicyDigest;
    readonly "nonceId": PolicyRandomId;
    readonly "targetDigest": PolicyDigest;
    readonly "sourceDenialFloor": PolicyCounter;
    readonly "nativeConsumptionRef": PolicyRevisionRef;
    readonly "phase": "native-consumed";
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyActivationReceiptV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "activation-receipt";
  readonly "policyOperationId": PolicyRandomId;
  readonly "proposalId": PolicyRandomId;
  readonly "policyDigest": PolicyDigest;
  readonly "policyRevision": PolicyCounter;
  readonly "activationAckDigest": PolicyDigest;
  readonly "authorityRevision": PolicyCounter;
  readonly "phase": "activation-committed";
  readonly "committedAt": PolicyTimestamp;
  readonly "expiresAt": PolicyTimestamp;
};

export type ContentPolicySubmissionV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "submission";
  readonly "policyOperationId": PolicyRandomId;
  readonly "proposalId": PolicyRandomId;
  readonly "policyDigest": PolicyDigest;
  readonly "state": "pending-native" | "activated";
  readonly "activationReceipt": (ContentPolicyActivationReceiptV1) | (null);
};

export type ContentPolicyCaptureGrantV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "capture-grant";
    readonly "captureGrantId": PolicyRandomId;
    readonly "captureGrantRevision": PolicyCounter;
    readonly "policyId": PolicyId;
    readonly "policyRevision": PolicyCounter;
    readonly "policyDigest": PolicyDigest;
    readonly "priorActivationReceiptDigest": PolicyDigest;
    readonly "target": PolicyTarget;
    readonly "sourceDenialFloor": PolicyCounter;
    readonly "ownerConsentRevision": PolicyCounter;
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyCaptureAckV1 = {
  readonly "body": {
    readonly "format": "h2a.session-content-policy/1";
    readonly "kind": "capture-ack";
    readonly "captureGrantId": PolicyRandomId;
    readonly "captureGrantRevision": PolicyCounter;
    readonly "captureGrantDigest": PolicyDigest;
    readonly "policyDigest": PolicyDigest;
    readonly "targetDigest": PolicyDigest;
    readonly "sourceDenialFloor": PolicyCounter;
    readonly "nativeFenceRef": PolicyRevisionRef;
    readonly "issuedAt": PolicyTimestamp;
    readonly "expiresAt": PolicyTimestamp;
    readonly "status": "accepted";
    readonly "issuer": PolicyId;
    readonly "kid": PolicyId;
  };
  readonly "signature": PolicySignature;
};

export type ContentPolicyCaptureReceiptV1 = {
  readonly "format": "h2a.session-content-policy/1";
  readonly "kind": "capture-receipt";
  readonly "captureGrantId": PolicyRandomId;
  readonly "captureGrantRevision": PolicyCounter;
  readonly "captureGrantDigest": PolicyDigest;
  readonly "captureAckDigest": PolicyDigest;
  readonly "policyDigest": PolicyDigest;
  readonly "targetDigest": PolicyDigest;
  readonly "committedAt": PolicyTimestamp;
  readonly "expiresAt": PolicyTimestamp;
  readonly "status": "committed";
};

export type PolicyId = string;

export type PolicyCounter = number;

export type PolicyRevisionRef = {
  readonly "id": PolicyId;
  readonly "revision": PolicyCounter;
  readonly "digest": PolicyDigest;
};

export type PolicyDigest = string;

export type PolicyPolicySourceBinding = {
  readonly "appMeshId": PolicyId;
  readonly "sourceMeshId": PolicyId;
  readonly "nativeAudience": PolicyId;
  readonly "registrationId": PolicyId;
  readonly "tenantId": PolicyId;
  readonly "workspaceId": PolicyId;
  readonly "bindingId": PolicyId;
  readonly "sourceId": PolicyId;
  readonly "sourceSessionId": PolicyId;
  readonly "nativeSessionId": PolicyId;
  readonly "sourceGeneration": PolicyCounter;
  readonly "bootGeneration": PolicyCounter;
  readonly "custodyEpoch": PolicyCounter;
  readonly "controllerEpoch": PolicyCounter;
};

export type PolicyRetainedChannel = {
  readonly "enabled": boolean;
  readonly "retention": ({
    readonly "kind": "none";
  }) | ({
    readonly "kind": "finite";
    readonly "durationMs": number;
  });
};

export type PolicyTimestamp = number;

export type PolicyRandomId = string;

export type PolicyKey32 = string;

export type PolicyTarget = {
  readonly "appMeshId": PolicyId;
  readonly "sourceMeshId": PolicyId;
  readonly "nativeAudience": PolicyId;
  readonly "registrationId": PolicyId;
  readonly "tenantId": PolicyId;
  readonly "workspaceId": PolicyId;
  readonly "bindingId": PolicyId;
  readonly "sourceId": PolicyId;
  readonly "sourceSessionId": PolicyId;
  readonly "nativeSessionId": PolicyId;
  readonly "sourceGeneration": PolicyCounter;
  readonly "bootGeneration": PolicyCounter;
  readonly "custodyEpoch": PolicyCounter;
  readonly "controllerEpoch": PolicyCounter;
  readonly "connectionId": PolicyId;
  readonly "connectionGeneration": PolicyCounter;
};

export type PolicySignature = {
  readonly "alg": "Ed25519";
  readonly "value": PolicySig64;
};

export type PolicySig64 = string;

export type PolicyActor = {
  readonly "issuer": PolicyId;
  readonly "sub": PolicyId;
  readonly "sid": PolicyId;
  readonly "sessionVersion": PolicyCounter;
};

export interface ContentPolicyRecordMap {
  readonly ContentPolicyV1: ContentPolicyV1;
  readonly ContentPolicyNonceV1: ContentPolicyNonceV1;
  readonly ContentPolicyIntentV1: ContentPolicyIntentV1;
  readonly ContentPolicyProposalV1: ContentPolicyProposalV1;
  readonly ContentPolicyChallengeRequestV1: ContentPolicyChallengeRequestV1;
  readonly ContentPolicyNonceAckV1: ContentPolicyNonceAckV1;
  readonly ContentPolicyEvidenceRequestV1: ContentPolicyEvidenceRequestV1;
  readonly ContentPolicyIdpClaimsV1: ContentPolicyIdpClaimsV1;
  readonly ContentPolicyIdpEvidenceV1: ContentPolicyIdpEvidenceV1;
  readonly ContentPolicyAppAttestationV1: ContentPolicyAppAttestationV1;
  readonly ContentPolicyProofV1: ContentPolicyProofV1;
  readonly ContentPolicyActivationAckV1: ContentPolicyActivationAckV1;
  readonly ContentPolicyActivationReceiptV1: ContentPolicyActivationReceiptV1;
  readonly ContentPolicySubmissionV1: ContentPolicySubmissionV1;
  readonly ContentPolicyCaptureGrantV1: ContentPolicyCaptureGrantV1;
  readonly ContentPolicyCaptureAckV1: ContentPolicyCaptureAckV1;
  readonly ContentPolicyCaptureReceiptV1: ContentPolicyCaptureReceiptV1;
}
export type ContentPolicyRecordName = keyof ContentPolicyRecordMap;

export interface ParsedContentPolicyRecord<N extends ContentPolicyRecordName> {
  readonly status: "parsed-untrusted";
  readonly record: N;
  readonly value: ContentPolicyRecordMap[N];
}

export class ContentPolicyParseError extends Error {
  constructor(readonly code: "invalid_request" | "oversize") {
    super(code);
    this.name = "ContentPolicyParseError";
  }
}

const maxBytes: Readonly<Record<ContentPolicyRecordName, number>> = Object.freeze({
  ContentPolicyV1: 8192,
  ContentPolicyNonceV1: 8192,
  ContentPolicyIntentV1: 8192,
  ContentPolicyProposalV1: 8192,
  ContentPolicyChallengeRequestV1: 8192,
  ContentPolicyNonceAckV1: 8192,
  ContentPolicyEvidenceRequestV1: 16384,
  ContentPolicyIdpClaimsV1: 8192,
  ContentPolicyIdpEvidenceV1: 24576,
  ContentPolicyAppAttestationV1: 8192,
  ContentPolicyProofV1: 65536,
  ContentPolicyActivationAckV1: 8192,
  ContentPolicyActivationReceiptV1: 8192,
  ContentPolicySubmissionV1: 8192,
  ContentPolicyCaptureGrantV1: 8192,
  ContentPolicyCaptureAckV1: 8192,
  ContentPolicyCaptureReceiptV1: 8192,
});
const ajv = new Ajv2020({ strict: true });
ajv.addSchema(policySchema, "policy");

/** This parser grants no authority; operational entry points refuse before parsing. */
export function parseContentPolicyRecord<N extends ContentPolicyRecordName>(
  name: N, value: unknown,
): ParsedContentPolicyRecord<N> {
  if (!Object.hasOwn(maxBytes, name)) throw new ContentPolicyParseError("invalid_request");
  let encoded: string;
  try {
    encoded = canonicalJson(value);
  } catch {
    throw new ContentPolicyParseError("invalid_request");
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes[name]) throw new ContentPolicyParseError("oversize");
  const detached: unknown = JSON.parse(encoded);
  const validate = ajv.getSchema("policy#/$defs/" + name);
  if (!validate || !validate(detached)) throw new ContentPolicyParseError("invalid_request");
  return Object.freeze({ status: "parsed-untrusted", record: name, value: detached as ContentPolicyRecordMap[N] });
}

export { verifyContentPolicyProof } from "./session-content-policy-proof.js";
export { createContentPolicyConsent, type ContentPolicyConsent } from "./session-content-consent.js";

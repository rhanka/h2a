import type { H2AEscalationAuthorityKind } from "./escalation.js";

export const H2A_MULTI_HUMAN_MODE_IDS = [
  "PEER_DIALOGUE",
  "DELEGATED_COORDINATION",
  "SHARED_ENGAGEMENT",
  "FEDERATED_EXECUTIF",
  "CONSORTIUM_QUORUM",
  "PUBLIC_AUTHORITY"
] as const;

export type H2AMultiHumanModeId =
  (typeof H2A_MULTI_HUMAN_MODE_IDS)[number];

export type H2AMultiHumanChannel =
  | "principal-principal"
  | "conductor-conductor"
  | "shared-engagement"
  | "executif-scope"
  | "quorum-governance"
  | "public-authority";

export interface H2AMultiHumanModeDescriptor {
  readonly id: H2AMultiHumanModeId;
  readonly label: string;
  readonly primaryChannel: H2AMultiHumanChannel;
  readonly primaryAuthorityKind: H2AEscalationAuthorityKind;
  readonly requiresSharedEngagement: boolean;
  readonly requiresExecutiveScope: boolean;
  readonly requiresQuorumGovernance: boolean;
  readonly requiresExternalAuthority: boolean;
  readonly summary: string;
}

export interface H2AMultiHumanModeRequest {
  readonly principalCount: number;
  readonly repeatedOperationalCoordination?: boolean;
  readonly sharedCommitments?: boolean;
  readonly executiveScope?: boolean;
  readonly quorumGovernance?: boolean;
  readonly externalAuthority?: boolean;
}

export interface H2AMultiHumanModeSelection {
  readonly ok: true;
  readonly modeId: H2AMultiHumanModeId;
  readonly primaryChannel: H2AMultiHumanChannel;
  readonly primaryAuthorityKind: H2AEscalationAuthorityKind;
  readonly issues: readonly [];
}

export interface H2AMultiHumanModeSelectionFailure {
  readonly ok: false;
  readonly issues: readonly string[];
}

export type H2AMultiHumanModeSelectionResult =
  | H2AMultiHumanModeSelection
  | H2AMultiHumanModeSelectionFailure;

export const H2A_MULTI_HUMAN_MODES = Object.freeze({
  PEER_DIALOGUE: Object.freeze({
    id: "PEER_DIALOGUE",
    label: "peer dialogue",
    primaryChannel: "principal-principal",
    primaryAuthorityKind: "PRINCIPAL",
    requiresSharedEngagement: false,
    requiresExecutiveScope: false,
    requiresQuorumGovernance: false,
    requiresExternalAuthority: false,
    summary:
      "Informal PRINCIPAL-to-PRINCIPAL dialogue between mini-organizations; no shared operational charter yet."
  }),
  DELEGATED_COORDINATION: Object.freeze({
    id: "DELEGATED_COORDINATION",
    label: "delegated coordination",
    primaryChannel: "conductor-conductor",
    primaryAuthorityKind: "PRINCIPAL",
    requiresSharedEngagement: false,
    requiresExecutiveScope: false,
    requiresQuorumGovernance: false,
    requiresExternalAuthority: false,
    summary:
      "Repeated operational coordination delegated to CONDUCTORs while each PRINCIPAL keeps local authority."
  }),
  SHARED_ENGAGEMENT: Object.freeze({
    id: "SHARED_ENGAGEMENT",
    label: "shared engagement",
    primaryChannel: "shared-engagement",
    primaryAuthorityKind: "PRINCIPAL",
    requiresSharedEngagement: true,
    requiresExecutiveScope: false,
    requiresQuorumGovernance: false,
    requiresExternalAuthority: false,
    summary:
      "Shared charter with role bindings, controls, policies, success criteria, and its own journal."
  }),
  FEDERATED_EXECUTIF: Object.freeze({
    id: "FEDERATED_EXECUTIF",
    label: "federated executif",
    primaryChannel: "executif-scope",
    primaryAuthorityKind: "EXECUTIF",
    requiresSharedEngagement: true,
    requiresExecutiveScope: true,
    requiresQuorumGovernance: false,
    requiresExternalAuthority: false,
    summary:
      "A higher scope has an EXECUTIF accountable for the activity without erasing local PRINCIPAL authority."
  }),
  CONSORTIUM_QUORUM: Object.freeze({
    id: "CONSORTIUM_QUORUM",
    label: "consortium quorum",
    primaryChannel: "quorum-governance",
    primaryAuthorityKind: "QUORUM",
    requiresSharedEngagement: true,
    requiresExecutiveScope: false,
    requiresQuorumGovernance: true,
    requiresExternalAuthority: false,
    summary:
      "Peer organizations govern a shared scope through quorum or committee authority instead of one EXECUTIF."
  }),
  PUBLIC_AUTHORITY: Object.freeze({
    id: "PUBLIC_AUTHORITY",
    label: "public authority",
    primaryChannel: "public-authority",
    primaryAuthorityKind: "EXTERNAL_AUTHORITY",
    requiresSharedEngagement: true,
    requiresExecutiveScope: false,
    requiresQuorumGovernance: false,
    requiresExternalAuthority: true,
    summary:
      "A public/regulatory/external authority can impose policy, receive evidence, or route recourse."
  })
} as const satisfies Record<
  H2AMultiHumanModeId,
  H2AMultiHumanModeDescriptor
>);

export function getMultiHumanMode(
  modeId: string
): H2AMultiHumanModeDescriptor | undefined {
  if (!H2A_MULTI_HUMAN_MODE_IDS.includes(modeId as H2AMultiHumanModeId)) {
    return undefined;
  }
  return H2A_MULTI_HUMAN_MODES[modeId as H2AMultiHumanModeId];
}

function selectionFor(
  mode: H2AMultiHumanModeDescriptor
): H2AMultiHumanModeSelection {
  return {
    ok: true,
    modeId: mode.id,
    primaryChannel: mode.primaryChannel,
    primaryAuthorityKind: mode.primaryAuthorityKind,
    issues: []
  };
}

export function selectMultiHumanMode(
  request: H2AMultiHumanModeRequest
): H2AMultiHumanModeSelectionResult {
  if (!Number.isInteger(request.principalCount) || request.principalCount < 2) {
    return {
      ok: false,
      issues: ["multi-human mode requires at least 2 PRINCIPAL scopes"]
    };
  }

  if (request.externalAuthority) {
    return selectionFor(H2A_MULTI_HUMAN_MODES.PUBLIC_AUTHORITY);
  }
  if (request.executiveScope) {
    return selectionFor(H2A_MULTI_HUMAN_MODES.FEDERATED_EXECUTIF);
  }
  if (request.quorumGovernance) {
    return selectionFor(H2A_MULTI_HUMAN_MODES.CONSORTIUM_QUORUM);
  }
  if (request.sharedCommitments) {
    return selectionFor(H2A_MULTI_HUMAN_MODES.SHARED_ENGAGEMENT);
  }
  if (request.repeatedOperationalCoordination) {
    return selectionFor(H2A_MULTI_HUMAN_MODES.DELEGATED_COORDINATION);
  }
  return selectionFor(H2A_MULTI_HUMAN_MODES.PEER_DIALOGUE);
}

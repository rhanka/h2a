// MIRROR (type-only) of @sentropic/cluster-mesh@0.3.0 registration.ts:3-47 + session-contracts.ts:34.
// TODO(A1): replace with `import type { ... } from '@sentropic/cluster-mesh'` once 0.3.0 is published.
// Any drift here vs the published port = compile break by design (keep byte-faithful, incl. `readonly`).

export type RegistrationFailureReason =
  | "missing_registration"
  | "stale_registration"
  | "revoked_registration"
  | "generation_mismatch"
  | "principal_mismatch"
  | "workspace_mismatch"
  | "custody_mismatch"
  | "actuator_unavailable";

export interface ClusterMeshRegistration {
  readonly registrationId: string;
  readonly generationId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly custodyHolderPrincipalId: string;
  readonly custodyEpoch: number;
  readonly actuatorRef: string;
  readonly status: "active" | "revoked" | "lost";
  readonly expiresAt: string;
  readonly leaseExpiresAt: string;
  readonly revokedAt?: string;
  readonly lostAt?: string;
}

export interface ActuationRequest {
  readonly registration: ClusterMeshRegistration;
  readonly action: "drive" | "wake" | "relaunch";
  readonly commandRef: string;
}

export interface ActuationResult {
  readonly effectRef: string;
  readonly actedTargets?: readonly string[];
}

export interface PtyActuatorPort {
  readonly kind: "pty";
  isAvailable(actuatorRef: string): Promise<boolean>;
  actuate(input: ActuationRequest): Promise<ActuationResult>;
}

export interface SessionTargetStatePort {
  inspect(actuatorRef: string): Promise<"alive" | "dead" | "parked" | "unknown">;
}

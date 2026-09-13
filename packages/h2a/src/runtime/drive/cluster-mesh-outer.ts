import type { VerifiedInvocationContextPort } from "@sentropic/contracts";
import type { InvocationReceiptPort } from "@sentropic/events";
import {
  createClusterMeshRuntime,
  createClusterMeshPlugin,
  createRegistrationGate,
  createSessionNamespaceModule,
  type CommandInstructionPort,
  type ClusterMeshConfigInput,
  type ClusterMeshRuntimeStore,
  type DeviceRouteHandlers,
  type RegistrationLookupPort,
  type SessionAuthorSelectionPort,
  type SessionPathProjection,
  type SessionRouteHandlers
} from "@sentropic/cluster-mesh";

import {
  createH2aPtyActuator,
  createH2aSessionTargetState,
  type H2aPtyActuatorDeps
} from "./pty-actuator.js";

export const H2A_CLUSTER_MESH_SESSION_MOUNT_PREFIX = "/auth/session";
const H2A_CLUSTER_MESH_CONTROL_PATH = "/auth/session/control";

/**
 * Pending seam: native drive-line signing must durably resolve and verify the
 * command/registration binding before this port can return an instruction.
 */
export function createH2aCommandInstructionResolver(): CommandInstructionPort {
  return {
    async resolve() {
      return null;
    }
  };
}

export interface H2aClusterMeshOuterDeps {
  readonly generationId: string;
  readonly config: ClusterMeshConfigInput;
  /** Production callers must supply their real verified-context boundary. */
  readonly context: VerifiedInvocationContextPort;
  /** STEP 3 supplies the durable control-plane implementation. */
  readonly registrations: RegistrationLookupPort;
  readonly store: Pick<
    ClusterMeshRuntimeStore,
    "enqueueCommand" | "updateCommand" | "markRegistrationLost"
  >;
  readonly receipts: InvocationReceiptPort;
  readonly handlers: SessionRouteHandlers;
  readonly devices: DeviceRouteHandlers;
  readonly projection: SessionPathProjection;
  readonly author: SessionAuthorSelectionPort;
  /** Defaults to the fail-closed resolver until native signed-drive resolution is wired. */
  readonly instructions?: CommandInstructionPort;
  /** Optional effect dependencies preserve the real adapter while enabling hermetic effects. */
  readonly actuator?: H2aPtyActuatorDeps;
  readonly now?: () => Date;
}

/**
 * Stand up the h2a OUTER authorization path supplied by cluster-mesh.
 *
 * Authorization remains solely in the registration gate. The h2a actuator is
 * invoked only after that gate returns its authorized registration.
 */
export function createH2aClusterMeshOuter(
  input: H2aClusterMeshOuterDeps
) {
  if (`${H2A_CLUSTER_MESH_SESSION_MOUNT_PREFIX}${input.projection.control}` !==
      H2A_CLUSTER_MESH_CONTROL_PATH) {
    throw new Error(
      `session control projection must mount at ${H2A_CLUSTER_MESH_CONTROL_PATH}`
    );
  }
  const pty = createH2aPtyActuator(input.actuator);
  const targets = createH2aSessionTargetState(input.actuator);
  const registration = createRegistrationGate({
    generationId: input.generationId,
    registrations: input.registrations,
    pty,
    now: input.now
  });
  const runtime = createClusterMeshRuntime({
    generationId: input.generationId,
    config: input.config,
    context: input.context,
    registration,
    receipts: input.receipts,
    now: input.now
  });
  const namespaceModule = createSessionNamespaceModule({
    handlers: input.handlers,
    devices: input.devices,
    projection: input.projection,
    control: {
      runtime,
      store: input.store,
      targets,
      instructions: input.instructions ?? createH2aCommandInstructionResolver(),
      author: input.author,
      now: input.now
    }
  });
  const router = createClusterMeshPlugin({
    runtime,
    namespaces: [namespaceModule],
    mounts: { "/session": H2A_CLUSTER_MESH_SESSION_MOUNT_PREFIX }
  });

  return {
    runtime,
    namespaceModule,
    router,
    pty,
    targets,
    mountPrefix: H2A_CLUSTER_MESH_SESSION_MOUNT_PREFIX
  };
}

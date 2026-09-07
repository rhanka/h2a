import type { VerifiedInvocationContextPort } from "@sentropic/contracts";
import type { InvocationReceiptPort } from "@sentropic/events";
import {
  createClusterMeshRuntime,
  createRegistrationGate,
  createSessionNamespaceModule,
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
      author: input.author,
      now: input.now
    }
  });
  const router = namespaceModule.createRouter({
    context: runtime.context,
    receipts: runtime.receiptPort
  });

  return { runtime, namespaceModule, router, pty, targets };
}

import { createHash, createPublicKey, sign } from "node:crypto";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ClusterMeshMessagingPort,
  MessagingProductContext,
  MessageJsonValue,
  ReceivedAgentMessage,
  SendMessageResult
} from "@sentropic/cluster-mesh";
import { isH2AEnvelope, verifyEnvelopeSignature, type H2AEnvelope } from "@sentropic/h2a";
import type { LocalStore } from "./local-files/store.js";
import type { H2ASendMessageBody, H2ASendSigner } from "./send.js";

/** A deployment supplies its authenticated transport, never a tool caller. */
export interface H2aClusterMeshConnection {
  readonly store: ClusterMeshMessagingPort;
  readonly context: MessagingProductContext;
}

export interface H2aClusterMeshMessaging {
  readonly instance: string;
  send(envelope: H2AEnvelope<H2ASendMessageBody>): Promise<SendMessageResult>;
  /** N2 is enforced before persistence, notification, wake or acknowledgement. */
  drain(): Promise<{ accepted: string[]; rejected: string[] }>;
}

function publicMaterial(pem: string) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("cluster-mesh: Ed25519 key required");
  const der = key.export({ format: "der", type: "spki" });
  return {
    publicKeyBase64Url: der.toString("base64url"),
    keyId: createHash("sha256").update(der).digest("hex")
  };
}

export async function createClusterMeshMessaging(
  local: LocalStore,
  identity: H2ASendSigner,
  connection: H2aClusterMeshConnection
): Promise<H2aClusterMeshMessaging> {
  const { ClusterMeshMessageClient, messageEnvelopeSignaturePayload } =
    await import("@sentropic/cluster-mesh");
  // 0.10.1 ships this verifier but omits its root export. Resolve relative to
  // the installed entrypoint; use the upstream implementation, never a copy.
  const cryptoUrl = new URL("./runtime/custody-crypto.js", import.meta.resolve("@sentropic/cluster-mesh"));
  const { verifyCustodySignature } = await import(cryptoUrl.href) as {
    verifyCustodySignature(input: {
      publicKeyBase64Url: string; payload: Uint8Array; signatureBase64Url: string;
    }): boolean;
  };
  if (connection.context.principalId !== identity.instance) {
    throw new Error("cluster-mesh: authenticated principal must match the local signing identity");
  }
  const own = publicMaterial(identity.privateKeyPem);
  const activeKeys = (instance: string) => local.listInstanceKeys(instance);
  const ownKeyIsActive = () => activeKeys(identity.instance).some((pem) => {
    try { return publicMaterial(pem).keyId === own.keyId; } catch { return false; }
  });
  if (!ownKeyIsActive()) throw new Error("cluster-mesh: private key is not active");
  const client = new ClusterMeshMessageClient({
    ...connection,
    issuer: { issuerId: identity.instance, keyId: own.keyId, algorithm: "EdDSA", curve: "Ed25519" },
    signer: {
      async signCanonical(payload) {
        if (!ownKeyIsActive()) throw new Error("cluster-mesh: private key is no longer active");
        return sign(null, payload, identity.privateKeyPem).toString("base64url");
      }
    }
  });

  function verified(message: ReceivedAgentMessage): H2AEnvelope<H2ASendMessageBody> | undefined {
    // One corrupt envelope/key must not abort the remaining deliveries.
    try {
      const outer = message.envelope;
      if (outer.issuer.issuerId !== outer.senderPrincipalId ||
          outer.destination.mailboxId !== identity.instance) return;
      const payload = messageEnvelopeSignaturePayload(outer);
      const trustedKeys = activeKeys(outer.senderPrincipalId).filter((pem) => {
        try {
          const key = publicMaterial(pem);
          return key.keyId === outer.issuer.keyId && verifyCustodySignature({
            publicKeyBase64Url: key.publicKeyBase64Url,
            payload,
            signatureBase64Url: outer.evidence.signatureBase64Url
          });
        } catch { return false; }
      });
      if (trustedKeys.length === 0 || !isH2AEnvelope(outer.message)) return;
      const envelope = outer.message as unknown as H2AEnvelope<H2ASendMessageBody>;
      if (envelope.actor.instance !== outer.senderPrincipalId ||
          envelope.target?.instance !== identity.instance ||
          envelope.type !== "event" || envelope.body.kind !== "message" ||
          envelope.body.topic !== "MESSAGE" || typeof envelope.body.text !== "string" ||
          !trustedKeys.some((pem) => verifyEnvelopeSignature(envelope, pem, { by: outer.senderPrincipalId }))) return;
      return envelope;
    } catch { return; }
  }

  let draining: ReturnType<H2aClusterMeshMessaging["drain"]> | undefined;
  return {
    instance: identity.instance,
    async send(envelope) {
      if (envelope.actor.instance !== identity.instance || !envelope.target?.instance) {
        throw new Error("cluster-mesh: envelope sender/recipient mismatch");
      }
      return client.sendMessage({
        to: envelope.target.instance,
        message: envelope as unknown as MessageJsonValue,
        kind: "text"
      });
    },
    drain() {
      if (draining) return draining;
      draining = (async () => {
        const accepted: string[] = [];
        const rejected: string[] = [];
        for (const message of await client.receiveMessages({ instance: identity.instance })) {
          const envelope = verified(message);
          if (!envelope) {
            rejected.push(message.messageId);
            continue;
          }
          // Persist the original signed envelope. Existing inbox consumers and wake
          // code see only messages that crossed both signature boundaries.
          local.putInboxMessage(identity.instance, envelope);
          const ack = await client.ack(message.messageId);
          if (!ack.ok) throw new Error(`cluster-mesh: acknowledgement failed: ${ack.reason}`);
          accepted.push(message.messageId);
        }
        return { accepted, rejected };
      })().finally(() => { draining = undefined; });
      return draining;
    }
  };
}

export async function loadClusterMeshMessaging(
  local: LocalStore,
  identity: H2ASendSigner,
  modulePath = process.env.H2A_CLUSTER_MESH_MODULE
): Promise<H2aClusterMeshMessaging> {
  if (!modulePath || !isAbsolute(modulePath)) {
    throw new Error("cluster-mesh: H2A_CLUSTER_MESH_MODULE must name an absolute deployment module exporting createMessaging({root, instance})");
  }
  const config = await import(pathToFileURL(modulePath).href);
  if (typeof config.createMessaging !== "function") {
    throw new Error("cluster-mesh: deployment module must export createMessaging({root, instance})");
  }
  const connection = await config.createMessaging({ root: local.paths.root, instance: identity.instance });
  return createClusterMeshMessaging(local, identity, connection);
}

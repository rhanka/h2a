// Offline deployment seam; the real cluster-mesh client, key validation and
// activation run unchanged. No endpoint, credential or network is consulted.
export function createMessaging({ instance }) {
  return {
    context: { principalId: instance, scopes: ['scope:default'],
      policyRevision: 'synthetic-v1', authenticationEvidenceRef: `local-key:${instance}` },
    store: {
      pop: async () => ({ ok: true, outcome: 'empty' }),
      put: async () => ({ ok: false, reason: 'unavailable' }),
      ack: async () => ({ ok: false, reason: 'unavailable' }),
      subscribe: async () => ({ ok: false, reason: 'unavailable' })
    }
  };
}

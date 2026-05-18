# Proposition runtime minimale — plugins, MCP, local-files

> **Statut** : proposition de cadrage, 2026-05-17.
> **Nom recommandé** : `h2a`.
> **Package core recommandé** : `@sentropic/h2a`.

## Principe

Le runtime minimal doit rester un protocole de coordination gouvernée entre humains et agents, pas une dépendance forte à un CLI particulier.

`H2A` est le nom parapluie. Le volet `A2A` peut exister comme sous-surface spécialisée, mais il ne couvre pas à lui seul l'organisation, les mandats et le human-in-the-loop.

Architecture recommandée :

1. **Core library** — `@sentropic/h2a`
   - Types TypeScript et schemas JSON.
   - Validation de `CONTRACT`, `POLICY`, `ENGAGEMENT`, `REGISTRY`, `NEGOTIATION`.
   - Canonicalisation + hash d'artefact.
   - Signatures, amendements, journal append-only.
   - Store local abstrait.

2. **CLI runtime** — `@sentropic/h2a-cli`
   - Regroupe la surface MCP et les adapters hôtes.
   - Modules internes séparés pour `mcp`, `codex`, `claude`, `gemini`.
   - Ne contient pas la sémantique contractuelle ; dépend du core.

3. **Mode local-files bilatéral**
   - Dossier conventionnel `src/{project}/a2a/...`.
   - Fonctionne offline et sans serveur MCP.
   - Un agent lit son inbox, écrit ses propositions et signe les artefacts locaux.

## Use case initial : 1 PRINCIPAL / 15 CONDUCTORS

Topologie :

```text
human:antoine as PRINCIPAL
  ├─ conductor:01
  ├─ conductor:02
  ├─ ...
  └─ conductor:15
```

Flux minimal :

1. Le PRINCIPAL crée le scope racine `scope:principal/antoine`.
2. Chaque CONDUCTOR s'enregistre dans le REGISTRY avec son rôle, ses capabilities, son endpoint et ses policies acceptées.
3. Un CONDUCTOR découvre un autre CONDUCTOR via le REGISTRY.
4. Il ouvre une NEGOTIATION sur un sujet : `CONTRACT`, `POLICY`, `ENGAGEMENT` ou amendement.
5. Les parties échangent offres et contre-offres.
6. La NEGOTIATION se stabilise quand les signataires requis signent le même artefact canonique.
7. Si une incompatibilité apparaît entre contrats, elle est tracée et escaladée au PRINCIPAL, à l'EXECUTIF, à un CONTROL habilité ou à une autre autorité de scope. En V1, aucun médiateur inter-contrat ne résout automatiquement le conflit.

## Primitives MCP minimales

Les noms exacts peuvent évoluer, mais la surface V1 devrait rester petite :

| Tool MCP | Rôle |
|---|---|
| `h2a_register_instance` | Inscrire une INSTANCE dans un REGISTRY. |
| `h2a_discover_instances` | Trouver des acteurs par rôle, scope, capability ou policy acceptée. |
| `h2a_open_negotiation` | Ouvrir une session de NEGOTIATION. |
| `h2a_offer` | Déposer une proposition d'artefact. |
| `h2a_counteroffer` | Répondre par une contre-proposition. |
| `h2a_sign` | Signer une version canonique d'artefact. |
| `h2a_stabilize` | Vérifier signatures/hash et déclarer l'artefact stable. |
| `h2a_inbox` | Lire les messages et demandes adressées à l'acteur courant. |
| `h2a_append_journal` | Ajouter un événement audit append-only. |
| `h2a_escalate` | Déclencher `advise`, `decide` ou `alert`. |

## Structures minimales

```ts
type ActorRegistration = {
  id: string;
  instance: string;
  roles: string[];
  scopes: string[];
  principal?: string;
  conductor?: string;
  capabilities: string[];
  endpoints: Array<{ kind: "mcp" | "local-files" | "remote"; uri: string }>;
  publicKeys: string[];
  acceptedPolicies: string[];
  createdAt: string;
};

type Negotiation = {
  id: string;
  scope: string;
  parties: string[];
  subject: "contract" | "policy" | "engagement" | "amendment";
  status:
    | "draft"
    | "proposed"
    | "countered"
    | "accepted"
    | "rejected"
    | "withdrawn"
    | "expired"
    | "stabilized"
    | "abandoned";
  requiredSigners: string[];
  baseArtifactHash?: string;
  currentArtifactHash?: string;
  deadline?: string;
};

type ContractArtifact = {
  kind: "contract" | "policy" | "engagement" | "amendment";
  id: string;
  version: string;
  scope: string;
  body: unknown;
  hash: string;
  signatures: Array<{
    signer: string;
    role: string;
    mandate: string;
    signedAt: string;
    signature: string;
  }>;
};
```

Enveloppe d'échange minimale :

```ts
type Role =
  | "PRINCIPAL"
  | "EXECUTIF"
  | "CONDUCTOR"
  | "AGENTS"
  | "CONTROL"
  | "MANDATAIRE";

type ArtifactKind = "CONTRACT" | "POLICY" | "ENGAGEMENT" | "AMENDMENT";

type H2AEnvelope = {
  protocol: "sentropic.h2a";
  version: "0.1";
  id: string;
  type:
    | "register"
    | "propose"
    | "accept"
    | "reject"
    | "counter"
    | "withdraw"
    | "event"
    | "escalate";
  actor: { instance: string; role: Role; scope: string; mandate?: string };
  target?: { instance?: string; role?: Role; scope?: string };
  artifactKind?: ArtifactKind;
  contractId?: string;
  policyIds?: string[];
  engagementId?: string;
  negotiationId?: string;
  baseArtifactHash?: string;
  causationId?: string;
  correlationId?: string;
  prevHash?: string;
  body: unknown;
  createdAt: string;
  signatures?: Array<{ by: string; alg: string; value: string }>;
};
```

## Mode local-files

Structure recommandée :

```text
src/{project}/h2a/
  registry/
    instances.jsonl
  contracts/
    {contractId}/contract.json
  policies/
    {policyId}.json
  engagements/
    {engagementId}/
      charter.json
      events.jsonl
      inbox/
        {instanceId}/
      outbox/
        {instanceId}/
      evidence/
  negotiations/
    {negotiationId}/
      state.json
      offers/
      signatures/
      journal.jsonl
  inbox/
    {actorId}/
  outbox/
    {actorId}/
```

Règles :

- Les fichiers d'artefacts stabilisés sont immuables ; toute évolution passe par amendement.
- Les journaux sont append-only.
- Les `inbox/outbox` transportent les mêmes enveloppes que le MCP server.
- Le hash canonique est calculé sur le contenu normalisé hors signatures.
- Les événements portent `causationId`, `correlationId` et `prevHash` pour rendre les divergences auditables entre deux journaux locaux.

## Plugins Codex et Claude

Objectif V1 : adapters minces.

- **Codex / Claude / Gemini** : exposer les opérations H2A via des modules internes de `@sentropic/h2a-cli`.
- **Point commun** : tous les hosts lisent/écrivent les mêmes artefacts et acceptent le même registry.
- **Interdit V1** : mettre la logique de négociation dans un host spécifique. Sinon les intégrations divergent.

Risque principal : les surfaces plugin de Codex, Claude et Gemini peuvent évoluer. Le protocole doit donc considérer MCP et local-files comme les deux contrats de compatibilité stables ; les adapters hôtes restent remplaçables à l'intérieur de `h2a-cli`.

## Commandes CLI probables

```bash
h2a init --project my-project
h2a register --role conductor --principal human:antoine --scope scope:principal/antoine
h2a discover --role conductor --scope scope:principal/antoine
h2a negotiate open --with conductor:02 --subject engagement
h2a negotiate offer --negotiation neg-123 --file engagement.json
h2a negotiate sign --negotiation neg-123 --artifact-hash sha256:...
h2a negotiate stabilize --negotiation neg-123
h2a inbox read --actor conductor:01
```

## Limites V1 assumées

- Pas de médiateur inter-contrat.
- Pas de résolution automatique des conflits de policies.
- Pas de consensus global entre 15 CONDUCTORS.
- Pas de subagents first-class.
- Pas de dépendance obligatoire à un service remote.

Ces limites sont acceptables si le protocole trace les conflits et rend l'escalade actionnable.

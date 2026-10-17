// cli-seat-fixtures.ts
//
// Synthetic L2-s fixtures for the five CLI seats (agy, codex, vibe, muse,
// claude). No real credential, no live call, no home/keyring/network access.
//
// Sentropic contract pin: the envelope constants below are a test-fixture
// copy pinned to sentropic commit
// fb5e92a6ae4928066e181716fdffbfb490b0b4f3,
// packages/llm-mesh/src/enrollment/seat-bundle.ts and
// packages/llm-mesh/tests/enrollment/seat-bundle.test.ts. This pin is the
// authority for the synthetic envelope shape; public L1 consumption belongs
// to the live integration lot. Publication evidence and the upstream package
// coordinates are recorded in docs/cli-seat-l2s.md (no provider dependency here).

export const SENTROPIC_SEAT_CONTRACT_PIN = {
  commit: "fb5e92a6ae4928066e181716fdffbfb490b0b4f3",
  sourceModule: "packages/llm-mesh/src/enrollment/seat-bundle.ts",
  sourceTest: "packages/llm-mesh/tests/enrollment/seat-bundle.test.ts",
  packageVersion: "0.26.1",
  npmLatestObserved: "0.26.0",
  npmObservedAt: "2026-10-17",
  note: "fixture copy; public L1 consumption belongs to the live integration lot",
} as const;

/** Fixture copy of SEAT_BUNDLE_SCHEMA_VERSION (see pin above). */
export const SEAT_BUNDLE_SCHEMA_VERSION = 1 as const;

/** Fixture copy of SEAT_BUNDLE_MAX_BYTES: GitHub repository-secret snapshot limit. */
export const SEAT_BUNDLE_MAX_BYTES = 48 * 1024;

export type SeatCli5 = "agy" | "codex" | "vibe" | "muse" | "claude";

export const SEAT_CLIS_5: readonly SeatCli5[] = ["agy", "codex", "vibe", "muse", "claude"];

export type SeatScenario = "message" | "unavailable" | "loop" | "negotiation";

export const SEAT_SCENARIOS_4: readonly SeatScenario[] = ["message", "unavailable", "loop", "negotiation"];

/** Fixture copy of SEAT_PACKAGE_PROVIDER_ID (see pin above). */
export const SEAT_PACKAGE_PROVIDER_ID: Record<SeatCli5, string> = {
  agy: "cloud-code",
  codex: "codex",
  vibe: "mistral-vibe",
  muse: "muse",
  claude: "claude-code",
};

/** Fixture copy of SEAT_AGY_APPLICATION_TUPLE (see pin above). */
export const SEAT_AGY_APPLICATION_TUPLE = {
  transportProviderId: "antigravity",
  targetProviderId: "cloudcode-pa",
  productAccountSource: "antigravity",
} as const;

export type SeatAuthority = "custodian" | "consumer" | "native-store";
export type SeatCredentialClass = "renewable" | "static-key" | "access-only" | "store-reference";

export interface SyntheticSeatLifecycle {
  epoch: number;
  generation: number;
  operationId: string;
  issuedAt: string;
  providerExpiry?: string;
  localExpiryPolicy: string;
  refreshAuthority: "custody" | "none";
}

export interface SyntheticSeatBundleV1 {
  identity: {
    schemaVersion: 1;
    seatRef: string;
    refreshFamilyRef?: string;
    ownerScope: string;
    cli: SeatCli5;
    packageProviderId: string;
    issuingClientRef: string;
    endpointFamily: string;
    credentialFormatVersion: string;
    nativeCliVersion?: string;
    os?: "linux" | "macos" | "windows";
  };
  provenance: {
    enrollmentSource: "cli";
    accountBinding: string;
    entitlementClass: string;
  };
  authority: SeatAuthority;
  credentialClass: SeatCredentialClass;
  lifecycle: SyntheticSeatLifecycle;
  canonical?: { kind: "renewable-material" | "static-key-material"; materialRef: string };
  nativeUse?: { kind: "access" | "static-key" | "unavailable"; accessRef?: string; reason?: string };
  meshUse: { kind: "access" | "static-key" | "unavailable"; accessRef?: string; reason?: string };
}

/** Synthetic canary prefix: every invented credential stand-in carries it. */
export const SYNTHETIC_CANARY_PREFIX = "H2A-SYNTHETIC-SEAT-CANARY";

export function makeSyntheticCanary(cli: SeatCli5): string {
  return `${SYNTHETIC_CANARY_PREFIX}-${cli}-01`;
}

function baseBundle(cli: SeatCli5, serial = "01"): SyntheticSeatBundleV1 {
  const bundle: SyntheticSeatBundleV1 = {
    identity: {
      schemaVersion: 1,
      seatRef: `seat-synth-${cli}-${serial}`,
      refreshFamilyRef: `family-synth-${cli}-${serial}`,
      ownerScope: "owner-synth-01",
      cli,
      packageProviderId: SEAT_PACKAGE_PROVIDER_ID[cli],
      issuingClientRef: `client-synth-${cli}-${serial}`,
      endpointFamily: `endpoint-synth-${cli}-${serial}`,
      credentialFormatVersion: "v1",
      os: "linux",
    },
    provenance: {
      enrollmentSource: "cli",
      accountBinding: `binding-synth-${cli}-${serial}`,
      entitlementClass: "lab-seat",
    },
    authority: "custodian",
    credentialClass: "renewable",
    lifecycle: {
      epoch: 1,
      generation: 1,
      operationId: `op-synth-${cli}-${serial}`,
      issuedAt: "2026-10-15T00:00:00.000Z",
      localExpiryPolicy: "synthetic-policy-01",
      refreshAuthority: "custody",
    },
    canonical: { kind: "renewable-material", materialRef: `material-synth-${cli}-${serial}` },
    nativeUse: { kind: "access", accessRef: `access-synth-${cli}-${serial}` },
    meshUse: { kind: "access", accessRef: `access-synth-${cli}-${serial}` },
  };
  if (cli === "vibe") {
    bundle.credentialClass = "static-key";
    delete bundle.identity.refreshFamilyRef;
    bundle.lifecycle.refreshAuthority = "none";
    bundle.canonical = { kind: "static-key-material", materialRef: `material-synth-vibe-${serial}` };
    bundle.nativeUse = { kind: "static-key", accessRef: `access-synth-vibe-${serial}` };
    bundle.meshUse = { kind: "static-key", accessRef: `access-synth-vibe-${serial}` };
  }
  return bundle;
}

export type SyntheticBundleOverrides = {
  authority?: SeatAuthority;
  credentialClass?: SeatCredentialClass;
  lifecycle?: Partial<SyntheticSeatLifecycle>;
};

/** Custodian canonical bundle with synthetic (invented) references only. */
export function makeSyntheticSeatBundle(cli: SeatCli5, overrides?: SyntheticBundleOverrides): SyntheticSeatBundleV1 {
  const bundle = baseBundle(cli);
  if (overrides?.authority !== undefined) bundle.authority = overrides.authority;
  if (overrides?.credentialClass !== undefined) bundle.credentialClass = overrides.credentialClass;
  if (overrides?.lifecycle !== undefined) bundle.lifecycle = { ...bundle.lifecycle, ...overrides.lifecycle };
  return bundle;
}

/** Refresh-less consumer projection derived from the synthetic canonical bundle. */
export function makeSyntheticConsumerBundle(cli: SeatCli5, serial = "01"): SyntheticSeatBundleV1 {
  const bundle = baseBundle(cli, serial);
  bundle.authority = "consumer";
  bundle.credentialClass = cli === "vibe" ? "static-key" : "access-only";
  bundle.lifecycle = { ...bundle.lifecycle, refreshAuthority: "none" };
  delete bundle.canonical;
  const kind = cli === "vibe" ? "static-key" : "access";
  bundle.nativeUse = { kind, accessRef: `access-synth-${cli}-${serial}` };
  bundle.meshUse = { kind, accessRef: `access-synth-${cli}-${serial}` };
  return bundle;
}

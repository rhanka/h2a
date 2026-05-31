import { H2A_DISCLOSURE_MODES, type H2ADisclosureMode } from "./disclosure.js";

export const H2A_DECLARATION_INTERET_BODY_KIND = "declaration-interet" as const;

export const H2A_POSTURES_CONFLIT = [
  "none",
  "a-surveiller",
  "conflit-declarable"
] as const;

export const H2A_CRITERES_CONFLIT = [
  "hors-scope-propre",
  "signataire",
  "controle-flag"
] as const;

export type H2APostureConflit = (typeof H2A_POSTURES_CONFLIT)[number];
export type H2ACritereConflit = (typeof H2A_CRITERES_CONFLIT)[number];

export interface H2ADeclarationInteret {
  readonly kind: typeof H2A_DECLARATION_INTERET_BODY_KIND;
  readonly subject: string;
  readonly interets: readonly string[];
  readonly bindings?: readonly string[];
  readonly masqueImpactCollectif?: boolean;
  readonly at: string;
}

export interface H2APostureConflitContext {
  readonly declarations?: readonly H2ADeclarationInteret[];
  readonly ownScopes?: readonly string[];
  readonly decisionScopes?: readonly string[];
  readonly signers?: readonly string[];
  readonly controleFlags?: readonly string[];
}

export interface H2APostureConflitResult {
  readonly subject: string;
  readonly postureConflit: H2APostureConflit;
  readonly criteres: readonly H2ACritereConflit[];
  readonly disclosureMode: H2ADisclosureMode;
  readonly declaration?: H2ADeclarationInteret;
  readonly masqueImpactCollectif: boolean;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isH2ADeclarationInteret(value: unknown): value is H2ADeclarationInteret {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as {
    kind?: unknown;
    subject?: unknown;
    interets?: unknown;
    bindings?: unknown;
    masqueImpactCollectif?: unknown;
    at?: unknown;
  };
  return (
    candidate.kind === H2A_DECLARATION_INTERET_BODY_KIND &&
    typeof candidate.subject === "string" &&
    isStringArray(candidate.interets) &&
    (candidate.bindings === undefined || isStringArray(candidate.bindings)) &&
    (candidate.masqueImpactCollectif === undefined ||
      typeof candidate.masqueImpactCollectif === "boolean") &&
    typeof candidate.at === "string"
  );
}

function latestDeclaration(
  subject: string,
  declarations: readonly H2ADeclarationInteret[]
): H2ADeclarationInteret | undefined {
  for (let i = declarations.length - 1; i >= 0; i--) {
    const declaration = declarations[i];
    if (declaration.subject === subject) return declaration;
  }
  return undefined;
}

function reachesOutsideOwnScope(
  ownScopes: readonly string[],
  decisionScopes: readonly string[],
  bindings: readonly string[]
): boolean {
  const checkedScopes = [...decisionScopes, ...bindings].filter((scope) => scope.length > 0);
  if (checkedScopes.length === 0) return false;
  const own = new Set(ownScopes);
  if (own.size === 0) return true;
  return checkedScopes.some((scope) => !own.has(scope));
}

function knownDisclosureMode(mode: H2ADisclosureMode): H2ADisclosureMode {
  if (!(H2A_DISCLOSURE_MODES as readonly H2ADisclosureMode[]).includes(mode)) {
    throw new Error(`unknown disclosure mode: ${mode}`);
  }
  return mode;
}

export function derivePostureConflit(
  subject: string,
  context: H2APostureConflitContext = {}
): H2APostureConflitResult {
  const declaration = latestDeclaration(subject, context.declarations ?? []);
  if (!declaration || declaration.interets.length === 0) {
    return {
      subject,
      postureConflit: "none",
      criteres: [],
      disclosureMode: knownDisclosureMode("attestation"),
      masqueImpactCollectif: false
    };
  }

  const criteres: H2ACritereConflit[] = [];
  const horsScope = reachesOutsideOwnScope(
    context.ownScopes ?? [],
    context.decisionScopes ?? [],
    declaration.bindings ?? []
  );
  if (horsScope) criteres.push("hors-scope-propre");
  if ((context.signers ?? []).includes(subject)) criteres.push("signataire");
  if ((context.controleFlags ?? []).includes(subject)) criteres.push("controle-flag");

  const postureConflit: H2APostureConflit =
    criteres.length > 0 ? "conflit-declarable" : "a-surveiller";
  const masqueImpactCollectif = declaration.masqueImpactCollectif === true;
  const disclosureMode: H2ADisclosureMode =
    postureConflit === "conflit-declarable" &&
    (masqueImpactCollectif || horsScope || criteres.includes("controle-flag"))
      ? knownDisclosureMode("evidence-package")
      : knownDisclosureMode("attestation");

  return {
    subject,
    postureConflit,
    criteres,
    disclosureMode,
    declaration,
    masqueImpactCollectif
  };
}

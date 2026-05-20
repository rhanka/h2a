import type { H2AEnforcementPlan } from "./types.js";

export const H2A_ESCALATION_CHANNELS = [
  "advise",
  "decide",
  "alert"
] as const;

export const H2A_ESCALATION_AUTHORITY_KINDS = [
  "PRINCIPAL",
  "EXECUTIF",
  "QUORUM",
  "CONTROL",
  "EXTERNAL_AUTHORITY",
  "RECOURSE"
] as const;

export type H2AEscalationChannel = (typeof H2A_ESCALATION_CHANNELS)[number];
export type H2AEscalationAuthorityKind =
  (typeof H2A_ESCALATION_AUTHORITY_KINDS)[number];

export interface H2AEscalationTargetRequest {
  readonly scope: string;
  readonly channel: string;
  readonly trigger?: string;
  readonly domain?: string;
}

export interface H2AEscalationResolveOptions {
  /**
   * Explicit mono-human fallback target. DEC-024 keeps PRINCIPAL as the
   * default only when the caller provides that local principal target.
   */
  readonly fallbackPrincipal?: string;
}

export interface H2AEscalationResolvedTarget {
  readonly ok: true;
  readonly scope: string;
  readonly channel: H2AEscalationChannel;
  readonly trigger?: string;
  readonly domain?: string;
  readonly authorityKind: H2AEscalationAuthorityKind;
  readonly target: string;
  readonly source: "enforcement-plan" | "fallback-principal";
}

export interface H2AEscalationUnresolvedTarget {
  readonly ok: false;
  readonly scope?: string;
  readonly channel?: string;
  readonly trigger?: string;
  readonly domain?: string;
  readonly issues: readonly string[];
}

export type H2AEscalationResolution =
  | H2AEscalationResolvedTarget
  | H2AEscalationUnresolvedTarget;

function isEscalationChannel(value: string): value is H2AEscalationChannel {
  return H2A_ESCALATION_CHANNELS.includes(value as H2AEscalationChannel);
}

function isEscalationAuthorityKind(
  value: unknown
): value is H2AEscalationAuthorityKind {
  return (
    typeof value === "string" &&
    H2A_ESCALATION_AUTHORITY_KINDS.includes(
      value as H2AEscalationAuthorityKind
    )
  );
}

function withOptionalRequestFields(
  base: Omit<H2AEscalationResolvedTarget, "trigger" | "domain">,
  request: H2AEscalationTargetRequest,
  routeDomain?: string
): H2AEscalationResolvedTarget {
  return {
    ...base,
    ...(request.trigger ? { trigger: request.trigger } : {}),
    ...(request.domain && routeDomain === request.domain
      ? { domain: request.domain }
      : {})
  };
}

export function resolveEscalationTarget(
  plan: Pick<H2AEnforcementPlan, "escalations">,
  request: H2AEscalationTargetRequest,
  options: H2AEscalationResolveOptions = {}
): H2AEscalationResolution {
  if (!isEscalationChannel(request.channel)) {
    return {
      ok: false,
      scope: request.scope,
      channel: request.channel,
      trigger: request.trigger,
      domain: request.domain,
      issues: [
        `unknown escalation channel "${request.channel}" (expected advise|decide|alert)`
      ]
    };
  }

  const candidates = plan.escalations
    .map((route, index) => {
      if (typeof route.target !== "string" || route.target.length === 0) {
        return undefined;
      }
      if (route.channel !== undefined && route.channel !== request.channel) {
        return undefined;
      }
      if (route.scope !== undefined && route.scope !== request.scope) {
        return undefined;
      }
      if (request.trigger && route.trigger !== request.trigger) {
        return undefined;
      }
      if (
        request.domain &&
        route.domain !== undefined &&
        route.domain !== request.domain
      ) {
        return undefined;
      }

      let score = 0;
      if (request.domain && route.domain === request.domain) score += 8;
      if (request.trigger && route.trigger === request.trigger) score += 4;
      if (route.scope === request.scope) score += 2;
      if (route.channel === request.channel) score += 1;
      return { route, index, score };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = candidates[0]?.route;
  if (selected) {
    return withOptionalRequestFields(
      {
        ok: true,
        scope: request.scope,
        channel: request.channel,
        authorityKind: isEscalationAuthorityKind(selected.authorityKind)
          ? selected.authorityKind
          : "PRINCIPAL",
        target: selected.target,
        source: "enforcement-plan"
      },
      request,
      selected.domain
    );
  }

  if (options.fallbackPrincipal) {
    return withOptionalRequestFields(
      {
        ok: true,
        scope: request.scope,
        channel: request.channel,
        authorityKind: "PRINCIPAL",
        target: options.fallbackPrincipal,
        source: "fallback-principal"
      },
      request
    );
  }

  return {
    ok: false,
    scope: request.scope,
    channel: request.channel,
    trigger: request.trigger,
    domain: request.domain,
    issues: [
      `no escalation target for scope=${request.scope}, channel=${request.channel}${
        request.trigger ? `, trigger=${request.trigger}` : ""
      }${request.domain ? `, domain=${request.domain}` : ""}`
    ]
  };
}

export function assertEscalationTargetResolved(
  resolution: H2AEscalationResolution
): asserts resolution is H2AEscalationResolvedTarget {
  if (!resolution.ok) {
    throw new Error(
      `Escalation target unresolved: ${resolution.issues.join("; ")}`
    );
  }
}

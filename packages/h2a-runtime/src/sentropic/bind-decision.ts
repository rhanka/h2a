/**
 * sentropic enrollment — Lot 0: the create-or-bind DECISION (C3), pure and dependency-free.
 *
 * Spec: docs/specs/2026-07-11-sentropic-h2a-enrollment.md §4. Decides, for one local h2a workspace
 * (identified by its durable `ws:<sha256>` fingerprint — NOT its name), what to do against the set
 * of sentropic workspaces the caller is authorized to see:
 *   - name ≠ identity: a pre-existing workspace is NEVER auto-adopted by name;
 *   - lookup is scoped to caller-authorized workspaces (NO global first-binding-wins);
 *   - explicit `--to <wsId>` requires workspace ADMIN (viewer/member cannot bind);
 *   - multiple visible bindings for a fingerprint → the caller must select explicitly;
 *   - the (workspaceId, fingerprint) PAIR is what later routes uploads — never the fingerprint alone.
 *
 * This module holds NO IO: the caller passes in the authorized workspaces + visible bindings (which
 * it fetched from the server) and gets a plan back. Capability separation (bind ≠ upload) is a
 * property of the plan consumer, not of this decision.
 */

export type WorkspaceRole = "viewer" | "member" | "admin";

export interface WorkspaceRef {
  workspaceId: string;
  name: string;
  role: WorkspaceRole;
}

/** A recorded (workspace, fingerprint) binding visible to the caller. */
export interface Binding {
  workspaceId: string;
  fingerprint: string;
}

export type BindPlan =
  | { action: "create"; fingerprint: string; suggestedName: string }
  | { action: "bind"; fingerprint: string; workspaceId: string }
  | { action: "already-bound"; fingerprint: string; workspaceId: string }
  | { action: "ambiguous"; fingerprint: string; candidates: string[] }
  | { action: "needs-admin"; fingerprint: string; workspaceId: string }
  | { action: "unknown-target"; fingerprint: string; workspaceId: string };

export interface PlanInput {
  /** the local workspace's durable identity ("ws:<sha256>"). */
  fingerprint: string;
  /** a SUGGESTED display name for a create (name ≠ identity). */
  localName: string;
  /** sentropic workspaces the caller may see — the lookup is scoped to THIS set only. */
  authorizedWorkspaces: ReadonlyArray<WorkspaceRef>;
  /** (workspace, fingerprint) bindings visible to the caller. */
  existingBindings: ReadonlyArray<Binding>;
  /** explicit `--to <workspaceId>` target, if the human named one. */
  explicitTo?: string;
}

/** Stable key for a (workspace, fingerprint) binding — the pair, never the fingerprint alone. */
export function bindingKey(workspaceId: string, fingerprint: string): string {
  return `${workspaceId} ${fingerprint}`;
}

/** The destination a transcript upload routes to — the bound PAIR, not the fingerprint. */
export function uploadRouteTarget(binding: Binding): { workspaceId: string; fingerprint: string } {
  return { workspaceId: binding.workspaceId, fingerprint: binding.fingerprint };
}

/**
 * Plan the create-or-bind for one workspace. Pure. The result is a single explicit action the CLI
 * confirms (batch mode aggregates one plan per workspace into a printed plan + one confirmation).
 */
export function planCreateOrBind(input: PlanInput): BindPlan {
  const { fingerprint, localName, authorizedWorkspaces, existingBindings, explicitTo } = input;
  const authorized = new Map(authorizedWorkspaces.map((w) => [w.workspaceId, w]));

  // Bindings for THIS fingerprint that fall within the caller-authorized set (scoped lookup).
  const scopedMatches = existingBindings.filter(
    (b) => b.fingerprint === fingerprint && authorized.has(b.workspaceId),
  );

  // --- explicit target path: name ≠ identity, admin-gated ---
  if (explicitTo !== undefined) {
    const target = authorized.get(explicitTo);
    if (!target) return { action: "unknown-target", fingerprint, workspaceId: explicitTo };
    if (scopedMatches.some((b) => b.workspaceId === explicitTo)) {
      return { action: "already-bound", fingerprint, workspaceId: explicitTo };
    }
    if (target.role !== "admin") {
      return { action: "needs-admin", fingerprint, workspaceId: explicitTo };
    }
    return { action: "bind", fingerprint, workspaceId: explicitTo };
  }

  // --- auto path: NO global first-wins; decide from the scoped matches only ---
  if (scopedMatches.length === 0) {
    return { action: "create", fingerprint, suggestedName: localName };
  }
  if (scopedMatches.length === 1) {
    return { action: "already-bound", fingerprint, workspaceId: scopedMatches[0]!.workspaceId };
  }
  // multiple visible bindings → the human must select explicitly (never auto-pick).
  return {
    action: "ambiguous",
    fingerprint,
    candidates: scopedMatches.map((b) => b.workspaceId).sort(),
  };
}

/** Batch: one plan per workspace, for a printed plan + one confirmation (C3). */
export function planBatch(inputs: ReadonlyArray<PlanInput>): BindPlan[] {
  return inputs.map(planCreateOrBind);
}

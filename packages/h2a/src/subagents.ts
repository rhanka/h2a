/**
 * First-class SUBAGENTS — addressable binding layer (DEC-008 V2, slice 1).
 *
 * In V1 (DEC-008) a host CLI's subagents are consolidated into the parent
 * AGENTS actor: not individually addressable, not separately audited. V2 makes
 * them addressable so coordination and audit can reference a specific subagent.
 *
 * Design (DEC-068):
 * - A subagent is **not a new role**. It is an addressable actor that acts
 *   under its parent's `AGENTS` role, so the frozen role set and the authority
 *   matrix are untouched — a subagent's signing authority stays exactly the
 *   parent AGENTS authority (consolidated). What V2 adds is *addressability*,
 *   not new authority.
 * - The address encodes the parent: `<parentInstance>~<name>`. The `~`
 *   separator is filesystem-safe (it is not in the `safePathSegment` set
 *   `[:/\<>"|?*]`, DEC-062), so a subagent address round-trips through the
 *   local-files store the same way a plain instance id does.
 *
 * This module is pure: types + total functions, no I/O.
 */

import type { H2AActorRef, H2AActorRegistration } from "./types.js";

/** Separator between a parent instance id and a subagent's local name. */
export const SUBAGENT_ADDRESS_SEPARATOR = "~";

/**
 * A binding records that a named subagent exists under a parent AGENTS
 * instance. It is the audit/discovery record; the addressable identity itself
 * is `id` (see {@link subagentAddress}).
 */
export interface H2ASubagentBinding {
  /** Canonical addressable id: `<parentInstance>~<name>`. */
  readonly id: string;
  /** The parent AGENTS instance this subagent is bound to. */
  readonly parentInstance: string;
  /** Local name, unique within the parent (e.g. "researcher"). */
  readonly name: string;
  /**
   * Optional capability subset. When omitted the subagent inherits the
   * parent's capabilities; when present it MUST be a subset of them (a
   * subagent can never exceed its parent). Validated by
   * {@link validateSubagentBinding}.
   */
  readonly capabilities?: readonly string[];
  readonly createdAt: string;
}

export type H2ASubagentValidationError =
  | "parent-not-agents"
  | "empty-name"
  | "name-contains-separator"
  | "id-address-mismatch"
  | "parent-instance-mismatch"
  | "capabilities-exceed-parent";

export interface H2ASubagentValidation {
  readonly ok: boolean;
  readonly errors: readonly H2ASubagentValidationError[];
}

/** Build the canonical addressable id for a subagent. */
export function subagentAddress(parentInstance: string, name: string): string {
  return `${parentInstance}${SUBAGENT_ADDRESS_SEPARATOR}${name}`;
}

/** True if `id` looks like a subagent address (`parent~name`). */
export function isSubagentAddress(id: string): boolean {
  const i = id.indexOf(SUBAGENT_ADDRESS_SEPARATOR);
  return i > 0 && i < id.length - 1;
}

/**
 * Split a subagent address into its parts. Splits on the **last** separator so
 * a parent instance id may itself contain `~` (the name may not — enforced by
 * {@link validateSubagentBinding}). Returns undefined if `id` is not an address.
 */
export function parseSubagentAddress(
  id: string
): { parentInstance: string; name: string } | undefined {
  const i = id.lastIndexOf(SUBAGENT_ADDRESS_SEPARATOR);
  if (i <= 0 || i >= id.length - 1) return undefined;
  return { parentInstance: id.slice(0, i), name: id.slice(i + 1) };
}

/**
 * Validate a binding against its parent registration. A binding is valid iff:
 * - the parent carries the `AGENTS` role (only AGENTS spawn subagents),
 * - the name is non-empty and free of the address separator,
 * - `id` equals `subagentAddress(parentInstance, name)`,
 * - `parentInstance` matches the parent registration's `instance`,
 * - declared `capabilities` (if any) are a subset of the parent's.
 */
export function validateSubagentBinding(
  binding: H2ASubagentBinding,
  parent: H2AActorRegistration
): H2ASubagentValidation {
  const errors: H2ASubagentValidationError[] = [];

  if (!parent.roles.includes("AGENTS")) errors.push("parent-not-agents");
  if (binding.name.length === 0) errors.push("empty-name");
  if (binding.name.includes(SUBAGENT_ADDRESS_SEPARATOR)) {
    errors.push("name-contains-separator");
  }
  if (binding.id !== subagentAddress(binding.parentInstance, binding.name)) {
    errors.push("id-address-mismatch");
  }
  if (binding.parentInstance !== parent.instance) {
    errors.push("parent-instance-mismatch");
  }
  if (binding.capabilities) {
    const parentCaps = new Set(parent.capabilities);
    if (binding.capabilities.some((c) => !parentCaps.has(c))) {
      errors.push("capabilities-exceed-parent");
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build the actor reference a subagent uses when it participates in
 * coordination. It acts under the parent's `AGENTS` role at the parent's
 * scope; only the addressable `instance` distinguishes it. A `mandate` may be
 * threaded through for traceability.
 */
export function subagentActorRef(
  binding: H2ASubagentBinding,
  options: { scope: string; mandate?: string }
): H2AActorRef {
  return {
    instance: binding.id,
    role: "AGENTS",
    scope: options.scope,
    ...(options.mandate ? { mandate: options.mandate } : {})
  };
}

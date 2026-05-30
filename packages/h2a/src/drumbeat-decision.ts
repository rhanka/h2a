/**
 * Drumbeat D5 (reflexive watchdog) — pure parsing of a decider's verdict. The
 * decider (a CLI-runtime adapter, often a headless host CLI) returns free-ish
 * text containing a JSON object; this turns it into a typed decision. Total —
 * never throws: anything unrecognised maps to the safe default `relance`
 * (mirrors `parseOrgManifest`). No I/O, no dependency.
 */

export const H2A_REFLEXIVE_ACTIONS = ["relance", "finish", "escalate", "reroute"] as const;
export type H2AReflexiveAction = (typeof H2A_REFLEXIVE_ACTIONS)[number];

export interface H2AReflexiveDecision {
  readonly action: H2AReflexiveAction;
  readonly reason?: string;
}

const RELANCE: H2AReflexiveDecision = { action: "relance" };

/** Extract the first balanced top-level `{...}` JSON object from `text`, or undefined. */
function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Parse a decider's output into a typed decision. Unknown/missing action,
 * malformed JSON, or no JSON at all → `{ action: "relance" }` (never throws).
 */
export function parseReflexiveDecision(text: string): H2AReflexiveDecision {
  const json = firstJsonObject(text);
  if (!json) return RELANCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return RELANCE;
  }
  if (typeof parsed !== "object" || parsed === null) return RELANCE;
  const obj = parsed as { action?: unknown; reason?: unknown };
  if (!H2A_REFLEXIVE_ACTIONS.includes(obj.action as H2AReflexiveAction)) return RELANCE;
  return {
    action: obj.action as H2AReflexiveAction,
    ...(typeof obj.reason === "string" ? { reason: obj.reason } : {})
  };
}

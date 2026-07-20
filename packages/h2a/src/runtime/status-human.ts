/**
 * Human-readable `h2a status --human` projection (L2b).
 *
 * PURE + READ-ONLY: this renders already-gathered data to text and touches no
 * store, no process, no clock. The bare `h2a status` JSON contract is UNCHANGED
 * and frozen; `--human` is an opt-in ADDITIONAL view that also surfaces what an
 * operator actually wants at a glance — the h2a sub-agents and the objective
 * loops with their durable-supervisor attendance (attended / unattended /
 * not-applicable). It never mutates or launches anything.
 */

export interface StatusHumanSession {
  readonly instance: string;
  readonly name?: string;
  readonly workStatus?: string;
}

export interface StatusHumanSubagent {
  readonly id: string;
  readonly parentInstance: string;
  readonly status: string;
}

export interface StatusHumanLoop {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** Whether the loop opted into durable auto-ticking (`policy.autoTick`). */
  readonly autoTick: boolean;
  /** `attended` | `unattended` | `not-applicable` (from `loopAttendance`). */
  readonly attendance: string;
}

export interface StatusHumanInput {
  readonly root: string;
  readonly direct: readonly StatusHumanSession[];
  readonly indirect: readonly StatusHumanSession[];
  readonly subagents: readonly StatusHumanSubagent[];
  readonly loops: readonly StatusHumanLoop[];
}

function sessionLine(s: StatusHumanSession, mirrored: boolean): string {
  const marker = mirrored ? "↳" : "●";
  const nm = s.name && s.name.length > 0 ? ` "${s.name}"` : "";
  const ws = s.workStatus && s.workStatus.length > 0 ? s.workStatus : "—";
  return `  ${marker} ${s.instance}${nm} — ${ws}`;
}

// A loop that is unattended while opted-in is the one an operator must notice,
// so it gets a visible marker; everything else is a neutral bullet.
function loopMarker(loop: StatusHumanLoop): string {
  if (loop.attendance === "unattended") return "⚠";
  if (loop.attendance === "attended") return "●";
  return "·";
}

/**
 * Render the opt-in human status view. Deterministic and total: every section
 * prints, showing "(none)" when empty, so missing/partial data never yields a
 * blank or a crash.
 */
export function renderStatusHuman(input: StatusHumanInput): string {
  const lines: string[] = [];
  lines.push(`h2a status — ${input.root}`);

  const total = input.direct.length + input.indirect.length;
  lines.push("");
  lines.push(`Sessions: ${total} (${input.direct.length} direct, ${input.indirect.length} mirrored)`);
  if (total === 0) {
    lines.push("  (none)");
  } else {
    for (const s of input.direct) lines.push(sessionLine(s, false));
    for (const s of input.indirect) lines.push(sessionLine(s, true));
  }

  lines.push("");
  lines.push(`Sub-agents: ${input.subagents.length}`);
  if (input.subagents.length === 0) {
    lines.push("  (none)");
  } else {
    for (const sa of input.subagents) {
      lines.push(`  ${sa.status === "revoked" ? "✗" : "●"} ${sa.id} (parent ${sa.parentInstance}) — ${sa.status}`);
    }
  }

  lines.push("");
  const unattended = input.loops.filter((l) => l.attendance === "unattended").length;
  const suffix = unattended > 0 ? ` — ${unattended} unattended` : "";
  lines.push(`Objective loops: ${input.loops.length}${suffix}`);
  if (input.loops.length === 0) {
    lines.push("  (none)");
  } else {
    for (const l of input.loops) {
      const nm = l.name && l.name.length > 0 ? ` "${l.name}"` : "";
      lines.push(
        `  ${loopMarker(l)} ${l.id}${nm} — ${l.status} · auto-tick ${l.autoTick ? "on" : "off"} · ${l.attendance}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

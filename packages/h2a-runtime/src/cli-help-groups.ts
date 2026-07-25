/**
 * Intention groups for the runtime `h2a --help` command list.
 *
 * WHY
 * ---
 * The runtime registers 46 top-level commands. Commander lists them flat, in
 * registration order, under a single `Commands:` heading — an inventory, not a
 * guide. This module assigns every command to an intention group so a human can
 * find the right command by asking "what am I trying to do?".
 *
 * SOURCE OF THE VOCABULARY
 * ------------------------
 * `docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md` (STUDY rung — proposal
 * only), § "Target command map" → "Daily operator surface — top level", which
 * states verbatim:
 *
 *   > `h2a --help` should render these as a short "Start / Observe / Coordinate /
 *   > Work / Set up" guide, then link to namespaces. It should not print the full
 *   > protocol implementation inventory first.
 *
 * The five daily words below are taken from that sentence, and each group's
 * membership is justified by the study rows named in its comment. Three further
 * groups come from elsewhere in the same study:
 *
 * - `SESSION_RECOVERY` — § "Advanced session controls" (`session recover`,
 *   "Make recovery semantics explicit") plus § "Three loop distinction" #3,
 *   "Process/session supervision loop: heartbeat, lease, crash/stop detection,
 *   and backend recovery".
 * - `TRANSPORT` — § "Specialist namespaces and delegation", last row:
 *   "`h2a remote …` and `h2a relay …` | Quarantined transport/bridge
 *   compatibility … | The primary user journey".
 * - `UNGROUPED` — NOT from the study. An honest catch-all, see its comment.
 *
 * SCOPE
 * -----
 * Help-rendering only. This module is pure data plus two pure functions; it
 * never participates in dispatch. Nothing here changes which command runs, what
 * it prints, or what it exits with. The study's open decisions S1–S6 are
 * deliberately NOT encoded: no group promises an ownership boundary, a rename,
 * a deprecation, or a future spelling.
 */

/** Stable identifiers for the groups, in the order the help renders them. */
export type H2aRuntimeHelpGroupId =
  | "START"
  | "OBSERVE"
  | "COORDINATE"
  | "SET_UP"
  | "SESSION_RECOVERY"
  | "TRANSPORT"
  | "UNGROUPED"
  | "HELP";

export interface H2aRuntimeHelpGroup {
  readonly id: H2aRuntimeHelpGroupId;
  /** Commander help heading. Trailing `:` matches Commander's own headings. */
  readonly heading: string;
  /** Primary command names (Commander `.name()`), not aliases. */
  readonly commands: readonly string[];
}

/**
 * The groups, in render order. Every one of the runtime's top-level commands
 * appears in exactly one `commands` list — asserted by `cli-help-groups.test.ts`.
 */
export const H2A_RUNTIME_HELP_GROUPS: readonly H2aRuntimeHelpGroup[] = [
  {
    // Study rows: "Start a work session" (`h2a run <runtime>`), "Return to one"
    // (`h2a attach <session>`), "End or continue one" (`h2a stop` / `h2a resume`).
    // The seven bare host-adapter names are the shortcut spelling of
    // `h2a run <runtime>`; the study calls `<runtime>` "a host adapter such as
    // `claude`/`codex`".
    id: "START",
    heading: "Start — begin, return to, or end a work session:",
    commands: [
      "run",
      "codex",
      "claude",
      "agy",
      "gemini",
      "mistral",
      "opencode",
      "shell",
      "attach",
      "resume",
      "stop",
    ],
  },
  {
    // Study rows: "See work sessions" (`h2a ls`), "Read its recent activity"
    // (`h2a logs <session>`), "See the big picture" (`h2a status --human`).
    id: "OBSERVE",
    heading: "Observe — see what is running and what needs attention:",
    commands: ["ls", "status", "agents", "diff", "sync-status"],
  },
  {
    // Study rows: "Coordinate directly", "Hand work to an agent" (`h2a delegate`),
    // "Supervise delegated work" (`h2a jobs …`); plus § "Specialist namespaces"
    // row "`h2a loop …`, `h2a conductor …`, `h2a drumbeat …`, `h2a blockage …` |
    // Explicit governance and coordination concepts".
    id: "COORDINATE",
    heading: "Coordinate — hand work to agents and talk to peers:",
    commands: ["delegate", "jobs", "relay", "conductor-launch", "wake-request"],
  },
  {
    // Study rows: "Connect this host" (`h2a connect`), "Enroll with sentropic",
    // "Diagnose" (`h2a doctor`). Credential and endpoint plumbing lives here
    // because the study's rule is "It does not configure a provider account" —
    // these commands set up *this host*, not a provider route.
    id: "SET_UP",
    heading: "Set up — connect this host, its credentials, and diagnostics:",
    commands: [
      "install",
      "connect",
      "disconnect",
      "config",
      "auth",
      "secrets",
      "refresh",
      "workspace",
      "plugin",
      "check",
    ],
  },
  {
    // Study § "Advanced session controls": `session recover <session>` — "Make
    // recovery semantics explicit … This prevents 'resume' from silently
    // promising more than a backend can provide." Also § "Three loop
    // distinction" #3 (process/session supervision).
    //
    // NOTE the runtime's `enroll` is the LIVE-SESSION REGISTRY plumbing that
    // feeds `ls`/`restore`. It is NOT the study's `h2a enroll …` (sentropic
    // enrollment/binding), which does not exist yet. Grouping it by what it
    // actually does keeps the help honest; no rename is implied.
    id: "SESSION_RECOVERY",
    heading: "Recover & supervise sessions (advanced):",
    commands: [
      "restore",
      "relaunch",
      "resume-throttled",
      "layout",
      "rename",
      "enroll",
      "lineage",
    ],
  },
  {
    // Study § "Specialist namespaces and delegation", last row: quarantined
    // transport/bridge compatibility — "Do not teach it as the session front
    // door." These move bytes between here and a session backend.
    id: "TRANSPORT",
    heading: "Transport & bridges (compatibility — not the session front door):",
    commands: ["sync", "sync-files", "forward", "browser", "migrate"],
  },
  {
    // NOT a study group. `account` and `llm-mesh` manage the local LLM account
    // pool and the local gateway/mesh. The study § "Commands deliberately
    // absent" lists exactly these as areas h2a should NOT own: "`h2a gateway`,
    // `h2a provider`, `h2a account`, `h2a catalogue`, or `h2a failover`" and "A
    // command that lists or selects sentropic account pools, raw upstream model
    // identifiers, sticky routing state, or provider audit records."
    //
    // They nevertheless SHIP today. Forcing them into an operator group would
    // launder that contradiction, and hiding them would be dishonest — so they
    // get a labelled catch-all. This is a finding about the command set, not a
    // deprecation: both commands keep working exactly as before.
    id: "UNGROUPED",
    heading:
      "Local LLM account & gateway (outside the 2026-07-17 study's operator grouping):",
    commands: ["account", "llm-mesh"],
  },
  {
    // Commander's built-in help command. Not an operator intention.
    id: "HELP",
    heading: "Help:",
    commands: ["help"],
  },
];

const HEADING_BY_COMMAND: ReadonlyMap<string, string> = new Map(
  H2A_RUNTIME_HELP_GROUPS.flatMap((group) =>
    group.commands.map((name) => [name, group.heading] as const),
  ),
);

/** Render order of the group headings, for the `groupItems` override. */
export const H2A_RUNTIME_HELP_GROUP_HEADINGS: readonly string[] =
  H2A_RUNTIME_HELP_GROUPS.map((group) => group.heading);

/**
 * Heading for a top-level command name, or `undefined` when the command is not
 * classified. An unclassified command keeps Commander's default `Commands:`
 * heading rather than disappearing — a new command is always visible, even
 * before someone groups it.
 */
export function runtimeHelpGroupHeadingFor(name: string): string | undefined {
  return HEADING_BY_COMMAND.get(name);
}

/** Minimal shape this module needs from a Commander command. */
interface HelpGroupableCommand {
  name(): string;
  helpGroup(heading: string): unknown;
}

/**
 * Assign a help group to every top-level command that has one. Called once,
 * after all commands are registered and before `parseAsync`. Purely additive:
 * `helpGroup()` only affects the heading a command is listed under.
 */
export function applyRuntimeHelpGroups(
  commands: readonly HelpGroupableCommand[],
): void {
  for (const command of commands) {
    const heading = runtimeHelpGroupHeadingFor(command.name());
    if (heading !== undefined) command.helpGroup(heading);
  }
}

/**
 * Commander's `Help.groupItems`, reordered.
 *
 * Commander emits groups "in order of appearance in unsortedItems", i.e. command
 * registration order — which would scatter our headings. This override builds
 * the same map, then re-emits it with the declared group headings first, in
 * `H2A_RUNTIME_HELP_GROUPS` order, followed by any other heading in its original
 * relative order.
 *
 * The same method also groups OPTIONS (`Options:` / `Global Options:`). Those
 * headings are not in our order list, so they fall through the
 * "any other heading" branch and keep Commander's behaviour untouched.
 */
export function groupRuntimeHelpItems<T>(
  unsortedItems: readonly T[],
  visibleItems: readonly T[],
  getGroup: (item: T) => string,
): Map<string, T[]> {
  const collected = new Map<string, T[]>();
  // Commander seeds the key order from every item, visible or not.
  for (const item of unsortedItems) {
    const group = getGroup(item);
    if (!collected.has(group)) collected.set(group, []);
  }
  for (const item of visibleItems) {
    const group = getGroup(item);
    const bucket = collected.get(group);
    if (bucket === undefined) collected.set(group, [item]);
    else bucket.push(item);
  }

  const ordered = new Map<string, T[]>();
  for (const heading of H2A_RUNTIME_HELP_GROUP_HEADINGS) {
    const items = collected.get(heading);
    // Commander drops empty groups itself (formatItemList on an empty list
    // renders nothing), but skipping them here keeps the map honest.
    if (items !== undefined && items.length > 0) ordered.set(heading, items);
  }
  for (const [heading, items] of collected) {
    if (!ordered.has(heading)) ordered.set(heading, items);
  }
  return ordered;
}

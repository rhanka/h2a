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
 * `docs/cli-help-grouping-vocabulary.md` — committed in this repo. It vendors, in
 * full and verbatim, the load-bearing passages of an unpublished internal design
 * study (STUDY rung — proposal only) that is on no git ref, so no reader can fetch
 * it; the vendored file is therefore the citable authority, and no source comment
 * or command output prints a path to the study itself. Its excerpt 3 reads:
 *
 *   > `h2a --help` should render these as a short "Start / Observe / Coordinate /
 *   > Work / Set up" guide, then link to namespaces. It should not print the full
 *   > protocol implementation inventory first.
 *
 * The five daily words below are taken from that sentence, and each group's
 * membership is justified by the excerpt named in its comment. Two further groups
 * come from elsewhere in the same vendored set, and one is not a group at all:
 *
 * - `SESSION_RECOVERY` — excerpt 4: `session recover`, "Make recovery semantics
 *   explicit", plus the third of the three loops, "Process/session supervision
 *   loop: heartbeat, lease, crash/stop detection, and backend recovery".
 * - `TRANSPORT` — excerpt 5, last table row: "`h2a remote …` and `h2a relay …` |
 *   Quarantined transport/bridge compatibility … | The primary user journey".
 * - `LLM_LOCAL` — NOT from the study; see excerpt 6 and the group's own comment.
 *   It is a labelled bucket for two commands that ship, not an intention.
 *
 * There is no fallback group on this surface. An unclassified command keeps
 * Commander's default `Commands:` heading, which is exactly what the "none left in
 * the default bucket" test detects — so a missing entry is loud, and never filed
 * under a heading it has not earned.
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
  | "SPECIALIST"
  | "SESSION_RECOVERY"
  | "TRANSPORT"
  | "LLM_LOCAL"
  | "HELP";

export interface H2aRuntimeHelpGroup {
  readonly id: H2aRuntimeHelpGroupId;
  /** Commander help heading. Trailing `:` matches Commander's own headings. */
  readonly heading: string;
  /** Primary command names (Commander `.name()`), not aliases. */
  readonly commands: readonly string[];
}

/**
 * The groups, in render order.
 *
 * Two separate properties hold here, and they are enforced at different strengths.
 * Both rungs are named so neither claim is broader than its evidence. (An earlier
 * revision of this comment cited a single file `cli-help-groups.test.ts` that was
 * never written — a comment asserting a guard that does not exist. Both citations
 * below are to tests that exist and run.)
 *
 * 1. NO COMMAND IS LEFT IN COMMANDER'S DEFAULT BUCKET — enforced.
 *    `packages/h2a/test/cli-command-map.test.js:181`, "the runtime help groups
 *    every command by intention, none left in the default bucket", spawns the
 *    built runtime's `--help` and asserts the output contains no `Commands:`
 *    heading. A command missing from every list below keeps that default heading,
 *    so the test fires. It is in the `.js` suite deliberately: `*.test.ts` under
 *    this package is not executed by `scripts/run-tests.mjs` (nor type-checked —
 *    `tsconfig.json` excludes it), so a `.test.ts` here would be inert.
 *
 * 2. EACH COMMAND APPEARS IN AT MOST ONE `commands` LIST — enforced.
 *    `packages/h2a/test/cli-command-map.test.js:456`, "no runtime command is
 *    listed in two intention groups", imports `H2A_RUNTIME_HELP_GROUPS` from the built
 *    runtime and counts names across groups. This property has NO structural
 *    backstop: `HEADING_BY_COMMAND` below is a `Map`, so a name listed in two
 *    groups is silently deduped to the LAST one, and the drift test compares
 *    sorted UNIQUE names, so it would not notice either. The duplicate would
 *    simply render under the wrong heading. Hence the explicit test.
 *
 * What is NOT enforced, stated rather than implied: nothing checks that a command
 * is in the *right* group. Group membership is a judgement, warranted by
 * `docs/cli-help-grouping-vocabulary.md` and by the per-group comments below.
 */
export const H2A_RUNTIME_HELP_GROUPS: readonly H2aRuntimeHelpGroup[] = [
  {
    // Vendored excerpt 3, § "Daily operator surface — top level", these rows:
    // > | Start a work session | `h2a run <runtime>` |
    // > | Return to one | `h2a attach <session>` |
    // > | End or continue one | `h2a stop <session>` / `h2a resume <session>` |
    //
    // The seven bare host-adapter names are the shortcut spelling of
    // `h2a run <runtime>`; the study calls `<runtime>`:
    // > a host adapter such as `claude`/`codex`
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
    id: "SPECIALIST",
    heading: "Specialist identity tools (advanced):",
    commands: ["identity"],
  },
  {
    // Vendored excerpt 3, § "Daily operator surface — top level", these rows:
    // > | See work sessions | `h2a ls` |
    // > | Read its recent activity | `h2a logs <session>` |
    // > | See the big picture | `h2a status --human` |
    id: "OBSERVE",
    heading: "Observe — see what is running and what needs attention:",
    commands: ["ls", "status", "agents", "diff", "sync-status"],
  },
  {
    // Vendored excerpt 3, § "Daily operator surface — top level", these rows:
    // > | Coordinate directly | `h2a send <peer> <message>` |
    // > | Hand work to an agent | `h2a delegate <runtime> <task>` |
    // > | Supervise delegated work | `h2a jobs …` |
    //
    // plus vendored excerpt 5, § "Specialist namespaces and delegation":
    // > Explicit governance and coordination concepts.
    id: "COORDINATE",
    heading: "Coordinate — hand work to agents and talk to peers:",
    commands: ["delegate", "jobs", "relay", "conductor-launch", "wake-request"],
  },
  {
    // Vendored excerpt 3, § "Daily operator surface — top level", these rows:
    // > | Connect this host | `h2a connect` |
    // > | Enroll with sentropic | `h2a enroll …` |
    // > | Diagnose | `h2a doctor` |
    //
    // Credential and endpoint plumbing lives here because of the `connect` row's
    // boundary — these commands set up *this host*, not a provider route:
    // > It does not configure a provider account.
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
      // Not from the vendored study — `tmux` postdates it. Grouped alongside
      // `config` (which already manages "the local tmux profile") because it
      // is the same kind of work: local tmux naming and status-surface setup
      // on this host, not a provider route or a session lifecycle action.
      "tmux",
    ],
  },
  {
    // Vendored excerpt 4, § "Advanced session controls", the `session recover` row:
    // > Make recovery semantics explicit: byte-faithful restore, host-continuable resume, or best effort.
    //
    // and § "Three loop distinction" #3:
    // > **Process/session supervision loop:** heartbeat, lease, crash/stop detection, and backend recovery.
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
    // TWO sections warrant this heading, and they are not the same section.
    // The earlier comment here attributed the whole heading to excerpt 5, but
    // excerpt 5 does not contain "not the session front door" — that sentence is
    // one section later. Accurate quotation, wrong address; both halves are now
    // vendored against the section that actually carries them.
    //
    // Vendored excerpt 5, § "Specialist namespaces and delegation", last row:
    // > Quarantined transport/bridge compatibility. `relay` is the taught bridge noun.
    // > The primary user journey or any new generic remote-control vocabulary.
    //
    // Vendored excerpt 9, § "Compatibility and migration", the `h2a remote …` row:
    // > Preserve as native transport compatibility namespace. Do not teach it as the session front door.
    //
    // These commands move bytes between here and a session backend.
    id: "TRANSPORT",
    heading: "Transport & bridges (compatibility — not the session front door):",
    commands: ["sync", "sync-files", "forward", "browser", "migrate"],
  },
  {
    // A SEMANTIC bucket for two named, known commands — NOT a fallback. This
    // surface has no fallback group at all (see the header): an unclassified
    // command keeps Commander's default heading and trips the test.
    //
    // Not a study group. `account` and `llm-mesh` manage the local LLM account
    // pool and the local gateway/mesh. Vendored excerpt 6 lists the areas h2a
    // should NOT own:
    // > `h2a gateway`, `h2a provider`, `h2a account`, `h2a catalogue`, or `h2a failover`.
    // > A command that lists or selects sentropic account pools, raw upstream model identifiers, sticky
    //
    // PRECISION the earlier wording lacked. It said the study "lists exactly
    // these", which was true of one command and stranded for the other:
    // `account` is named DIRECTLY by the first bullet; `llm-mesh` is named
    // NOWHERE in the study and is covered by the second bullet only through what
    // it does (multi-account, cross-provider fallback = account pools + failover).
    // The bucket is warranted for both; only one is warranted by name.
    //
    // They nevertheless SHIP today. Forcing them into an operator group would
    // launder that contradiction, and hiding them would be dishonest — so they
    // get a labelled bucket. This is a finding about the command set, not a
    // deprecation: both commands keep working exactly as before.
    id: "LLM_LOCAL",
    heading:
      "Local LLM account & gateway (outside the design study's operator grouping):",
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

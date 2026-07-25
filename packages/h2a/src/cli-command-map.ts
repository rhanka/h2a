/**
 * The grouped h2a command map, rendered by `h2a explain`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `h2a --help` lists its verbs flat, and the lazily-loaded runtime adds 46 more
 * top-level commands of its own. Neither list tells a human which command
 * answers their question. This module groups BOTH surfaces by operator intention
 * and renders one line per group and one line per verb.
 *
 * SOURCE OF THE VOCABULARY
 * ------------------------
 * `docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md` (STUDY rung — proposal
 * only), § "Target command map" → "Daily operator surface — top level":
 *
 *   > `h2a --help` should render these as a short "Start / Observe / Coordinate /
 *   > Work / Set up" guide, then link to namespaces.
 *
 * Those five words are `START`, `OBSERVE`, `COORDINATE`, `WORK`, `SET_UP` below.
 * The remaining groups also come from that study, except the catch-all:
 *
 * - `SPECIALIST` — § "Specialist namespaces and delegation" ("`h2a <domain>
 *   <verb>` exposes a specialist contract without pretending h2a owns that
 *   domain's internals").
 * - `SESSION_RECOVERY` — § "Advanced session controls" (`session recover`) and
 *   § "Three loop distinction" #3 (process/session supervision).
 * - `TRANSPORT` — § "Specialist namespaces and delegation", last row:
 *   quarantined transport/bridge compatibility.
 * - `UNGROUPED` — **not** from the study. See its comment.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a routing table. `bin-routing.ts` keeps its FALLBACK rule (any first word
 * that is not h2a-native goes to the runtime); an allowlist was explicitly
 * rejected by double consensus because "l'allowlist plafonne + dérive". This map
 * is documentation: the core verbs are DERIVED from the frozen contract so they
 * cannot drift, and the runtime verbs are listed here only so one command can
 * show a human the whole front door. If a runtime command is added and not
 * listed here, `h2a explain` under-documents it — nothing breaks, and
 * `test/cli-command-map.test.js` fails loudly.
 *
 * The study's open decisions S1–S6 require sentropic co-validation and are NOT
 * encoded here: no group promises an ownership boundary, a rename, a
 * deprecation, or a future command spelling.
 */

import { H2A_CLI_VERB_CONTRACTS } from "./cli-contract.js";

export type H2ACommandGroupId =
  | "START"
  | "OBSERVE"
  | "COORDINATE"
  | "WORK"
  | "SET_UP"
  | "SPECIALIST"
  | "SESSION_RECOVERY"
  | "TRANSPORT"
  | "UNGROUPED"
  | "HELP";

export interface H2ACommandGroup {
  readonly id: H2ACommandGroupId;
  /** Group title. */
  readonly heading: string;
  /** The operator question this group answers, in one line. */
  readonly intention: string;
}

/** The groups, in render order. */
export const H2A_COMMAND_GROUPS: readonly H2ACommandGroup[] = [
  {
    id: "START",
    heading: "Start",
    intention: "Begin a work session, return to one, or end it."
  },
  {
    id: "OBSERVE",
    heading: "Observe",
    intention: "See what is running, who is reachable, and what needs a human."
  },
  {
    id: "COORDINATE",
    heading: "Coordinate",
    intention: "Hand work to an agent, talk to peers, keep a loop moving."
  },
  {
    id: "WORK",
    heading: "Work",
    intention: "Read or record the work itself (delegated to @sentropic/track)."
  },
  {
    id: "SET_UP",
    heading: "Set up",
    intention: "Connect this host, its credentials and its hosts; diagnose them."
  },
  {
    id: "SPECIALIST",
    heading: "Specialist namespaces",
    intention: "Rare protocol, identity, org and method work — a subsystem owns the detail."
  },
  {
    id: "SESSION_RECOVERY",
    heading: "Recover & supervise sessions (advanced)",
    intention: "Bring dropped or throttled sessions back; keep presence honest."
  },
  {
    id: "TRANSPORT",
    heading: "Transport & bridges (compatibility)",
    intention: "Move bytes to and from a session backend. Not the session front door."
  },
  {
    id: "UNGROUPED",
    // NOT a study group. The study's § "Commands deliberately absent" names
    // exactly these areas as ones h2a should not own: "`h2a gateway`, `h2a
    // provider`, `h2a account`, `h2a catalogue`, or `h2a failover`". They ship
    // today anyway. An honest catch-all beats laundering the contradiction into
    // an operator group, and beats hiding them. Nothing is deprecated: both
    // commands keep working exactly as before.
    heading: "Local LLM account & gateway",
    intention: "Outside the study's operator grouping — it places these with sentropic."
  },
  {
    id: "HELP",
    heading: "Help",
    intention: "Find your way around."
  }
];

/**
 * Group for a CORE verb, keyed by its FIRST WORD. Every distinct first word in
 * `H2A_CLI_VERB_CONTRACTS` appears here; `test/cli-command-map.test.js` fails if
 * a contract verb has no entry, so a new frozen verb cannot land undocumented.
 *
 * First-word granularity is deliberate: `blockage raise|list|resolve` is one
 * coordination concept, not three, and splitting sub-verbs across groups would
 * make the map harder to scan than the flat list it replaces.
 */
const CORE_GROUP_BY_FIRST_WORD: Readonly<Record<string, H2ACommandGroupId>> = {
  // Observe — study rows "See work sessions", "See the big picture".
  discover: "OBSERVE",
  sessions: "OBSERVE",
  status: "OBSERVE",
  canevas: "OBSERVE",

  // Coordinate — study rows "Coordinate directly", "Hand work to an agent",
  // plus § Specialist "`h2a loop …`, `h2a conductor …`, `h2a drumbeat …`,
  // `h2a blockage …` | Explicit governance and coordination concepts" and
  // § Advanced "`h2a message inbox|thread|outbox …`".
  inbox: "COORDINATE",
  outbox: "COORDINATE",
  thread: "COORDINATE",
  drive: "COORDINATE",
  drumbeat: "COORDINATE",
  conductor: "COORDINATE",
  "conductor-launch": "COORDINATE",
  "conductor-launch-check": "COORDINATE",
  loop: "COORDINATE",
  blockage: "COORDINATE",

  // Work — study row "Read or record work | `h2a report` / `h2a decision …` |
  // Curated Track lifts". The Track façade verbs are added separately below.
  "report-context": "WORK",
  "report-ai": "WORK",

  // Set up — study rows "Connect this host", "Diagnose".
  init: "SET_UP",
  register: "SET_UP",
  connect: "SET_UP",
  doctor: "SET_UP",
  hosts: "SET_UP",
  "install-skills": "SET_UP",
  "mcp-serve": "SET_UP",
  "mcp-tools": "SET_UP",
  "track-mcp": "SET_UP",
  upgrade: "SET_UP",
  store: "SET_UP",
  deploy: "SET_UP",

  // Specialist namespaces — study § "Specialist namespaces and delegation":
  // "`h2a negotiate …`, `h2a org …`, `h2a nhi …`, `h2a keys …`, `h2a host …` |
  // Rare protocol, organizational, identity, and host-administration work",
  // "`h2a harness …` | Keep it always namespaced", "`h2a focus web` | Serve the
  // human Focus Web surface".
  negotiate: "SPECIALIST",
  "declare-interest": "SPECIALIST",
  "conflict-posture": "SPECIALIST",
  dossier: "SPECIALIST",
  confiance: "SPECIALIST",
  "attest-comprehension": "SPECIALIST",
  comprehension: "SPECIALIST",
  org: "SPECIALIST",
  coach: "SPECIALIST",
  nhi: "SPECIALIST",
  keys: "SPECIALIST",
  subagent: "SPECIALIST",
  sysml: "SPECIALIST",
  host: "SPECIALIST",
  harness: "SPECIALIST",
  focus: "SPECIALIST",

  // Recover & supervise — study § "Three loop distinction" #3.
  keepalive: "SESSION_RECOVERY",

  // Help.
  "--help": "HELP",
  explain: "HELP"
};

/**
 * Runtime top-level commands, grouped exactly as the runtime's own `--help`
 * groups them (`packages/h2a-runtime/src/cli-help-groups.ts`). Summaries are
 * short restatements, not copies of the runtime's descriptions — read
 * `h2a <verb> --help` for the authoritative text.
 *
 * DOCUMENTATION ONLY. Routing never consults this list.
 */
const RUNTIME_VERBS: readonly {
  readonly group: H2ACommandGroupId;
  readonly verb: string;
  readonly summary: string;
}[] = [
  { group: "START", verb: "run", summary: "Start a local tmux session for a host adapter, in a path." },
  { group: "START", verb: "codex", summary: "Shortcut for `h2a run codex`." },
  { group: "START", verb: "claude", summary: "Shortcut for `h2a run claude` (alias: claude-code)." },
  { group: "START", verb: "agy", summary: "Shortcut for `h2a run agy` (alias: antigravity)." },
  { group: "START", verb: "gemini", summary: "Shortcut for `h2a run gemini` (alias: gemini-cli)." },
  { group: "START", verb: "mistral", summary: "Shortcut for `h2a run mistral` (alias: mistralcli)." },
  { group: "START", verb: "opencode", summary: "Shortcut for `h2a run opencode`." },
  { group: "START", verb: "shell", summary: "Shortcut for `h2a run shell`." },
  { group: "START", verb: "attach", summary: "Attach this terminal to a live local or remote session." },
  { group: "START", verb: "resume", summary: "Resume a known local session from the registry." },
  { group: "START", verb: "stop", summary: "Stop a local (tmux) or remote session." },

  { group: "OBSERVE", verb: "ls", summary: "List sessions — local (tmux) and remote — uniformly." },
  { group: "OBSERVE", verb: "status", summary: "Local sessions + remote sessions + local tool auth." },
  { group: "OBSERVE", verb: "agents", summary: "Read-only projection of remote-visible agents." },
  { group: "OBSERVE", verb: "diff", summary: "Is a session in sync with local (conversation, or --files)?" },
  { group: "OBSERVE", verb: "sync-status", summary: "Last recorded sync result for the current session." },

  { group: "COORDINATE", verb: "delegate", summary: "Hand a task to a live agent in a detached session; returns a job id." },
  { group: "COORDINATE", verb: "jobs", summary: "Supervise delegated agent jobs; drain the queue." },
  { group: "COORDINATE", verb: "relay", summary: "h2a agent-network helpers (alias: `h2a h2a`)." },
  { group: "COORDINATE", verb: "wake-request", summary: "Act on a wake-request envelope by waking the target's pane." },
  { group: "COORDINATE", verb: "conductor-launch", summary: "Act on a conductor-launch-request envelope (shadowed by the core verb)." },

  { group: "SET_UP", verb: "install", summary: "Set the default remote URL and apply the managed tmux profile." },
  { group: "SET_UP", verb: "connect", summary: "Make the control-plane reachable, opening the tunnel if needed." },
  { group: "SET_UP", verb: "disconnect", summary: "Close the managed control-plane tunnel." },
  { group: "SET_UP", verb: "config", summary: "Manage the remote endpoint and the local tmux profile." },
  { group: "SET_UP", verb: "auth", summary: "Inspect and manage the local CLI credentials h2a sends." },
  { group: "SET_UP", verb: "secrets", summary: "Audit the credentials transmitted to remote sessions." },
  { group: "SET_UP", verb: "refresh", summary: "Re-push local credentials to a live session's Secret." },
  { group: "SET_UP", verb: "workspace", summary: "Map this project to a persistent remote workspace." },
  { group: "SET_UP", verb: "plugin", summary: "Install npm plugin packages into the agent CLIs." },
  { group: "SET_UP", verb: "check", summary: "End-to-end probe: create a session, await it, stop it (alias: smoke)." },

  { group: "SESSION_RECOVERY", verb: "restore", summary: "Relaunch the dev sessions in their recorded layout." },
  { group: "SESSION_RECOVERY", verb: "relaunch", summary: "Restart the CLI in sessions that dropped to a shell." },
  { group: "SESSION_RECOVERY", verb: "resume-throttled", summary: "Nudge rate-limited, detached sessions back to life." },
  { group: "SESSION_RECOVERY", verb: "layout", summary: "The layout auto-recorded by `h2a restore`." },
  { group: "SESSION_RECOVERY", verb: "rename", summary: "Rename a session's display name without restarting it." },
  { group: "SESSION_RECOVERY", verb: "enroll", summary: "Live-session registry plumbing that feeds `ls` and `restore`." },
  { group: "SESSION_RECOVERY", verb: "lineage", summary: "Local lineage incarnation lifecycle." },

  { group: "TRANSPORT", verb: "sync", summary: "Copy the conversation log between local and the session Pod." },
  { group: "TRANSPORT", verb: "sync-files", summary: "Push the git workspace to the session Pod incrementally." },
  { group: "TRANSPORT", verb: "forward", summary: "Expose a session Pod port on localhost." },
  { group: "TRANSPORT", verb: "browser", summary: "Open a headful browser inside a session Pod (noVNC)." },
  { group: "TRANSPORT", verb: "migrate", summary: "Round-trip a local session to a remote one and back." },

  { group: "UNGROUPED", verb: "account", summary: "Manage the local LLM account pool." },
  { group: "UNGROUPED", verb: "llm-mesh", summary: "Manage the local LLM gateway (multi-account, cross-provider)." },

  { group: "HELP", verb: "help", summary: "Commander's per-command help for a runtime verb." }
];

/**
 * `conductor-launch` is BOTH a frozen core verb and a runtime command name. The
 * core wins routing (it is in `H2A_NATIVE_VERBS`), so the map lists it once,
 * from the core contract. Same for `connect` and `status`. Listing the runtime
 * twin would tell a human about a command they cannot reach.
 */
const RUNTIME_VERBS_SHADOWED_BY_CORE: readonly string[] = [
  "conductor-launch",
  "connect",
  "status"
];

export interface H2ACommandMapEntry {
  readonly verb: string;
  readonly summary: string;
  /** `"core"` = frozen CLI contract; `"track"` = Track façade; `"runtime"` = lazy runtime. */
  readonly origin: "core" | "track" | "runtime";
}

export interface H2ACommandMapSection {
  readonly group: H2ACommandGroup;
  readonly entries: readonly H2ACommandMapEntry[];
}

/** Longest summary kept on a verb line, so a verb never wraps onto a second row. */
const SUMMARY_MAX = 76;

/**
 * First sentence of a contract description, capped, so every verb gets exactly
 * one line. The authoritative full text stays one keystroke away:
 * `h2a <verb> --help`.
 */
function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  const stop = trimmed.search(/\.(?:\s|$)/u);
  const sentence = stop === -1 ? trimmed : trimmed.slice(0, stop + 1);
  if (sentence.length <= SUMMARY_MAX) return sentence;
  const cut = sentence.lastIndexOf(" ", SUMMARY_MAX - 1);
  return `${sentence.slice(0, cut > 0 ? cut : SUMMARY_MAX - 1).trimEnd()}…`;
}

/**
 * Build the map. Core entries are derived from `H2A_CLI_VERB_CONTRACTS` (so the
 * frozen contract is the single source of truth for them) and the Track façade
 * verb list; runtime entries come from `RUNTIME_VERBS`.
 *
 * A core verb whose first word has no group lands in `UNGROUPED` rather than
 * vanishing — an undocumented verb is a bug to see, not to hide.
 */
export function buildCommandMap(
  trackFacadeVerbs: readonly string[]
): readonly H2ACommandMapSection[] {
  const byGroup = new Map<H2ACommandGroupId, H2ACommandMapEntry[]>();
  for (const group of H2A_COMMAND_GROUPS) byGroup.set(group.id, []);
  const push = (id: H2ACommandGroupId, entry: H2ACommandMapEntry): void => {
    byGroup.get(id)?.push(entry);
  };

  for (const contract of H2A_CLI_VERB_CONTRACTS) {
    const firstWord = contract.verb.split(" ")[0] ?? contract.verb;
    push(CORE_GROUP_BY_FIRST_WORD[firstWord] ?? "UNGROUPED", {
      verb: contract.verb,
      summary: firstSentence(contract.description),
      origin: "core"
    });
  }

  for (const verb of trackFacadeVerbs) {
    push("WORK", {
      verb,
      summary: `Track \`${verb}\` — same argv, same JSON, same exit codes.`,
      origin: "track"
    });
  }

  const shadowed = new Set(RUNTIME_VERBS_SHADOWED_BY_CORE);
  for (const entry of RUNTIME_VERBS) {
    if (shadowed.has(entry.verb)) continue;
    push(entry.group, { verb: entry.verb, summary: entry.summary, origin: "runtime" });
  }

  return H2A_COMMAND_GROUPS.map((group) => ({
    group,
    entries: byGroup.get(group.id) ?? []
  })).filter((section) => section.entries.length > 0);
}

/** Runtime command names this map documents, for the drift test. */
export const H2A_COMMAND_MAP_RUNTIME_VERBS: readonly string[] = RUNTIME_VERBS.map(
  (entry) => entry.verb
);

/** Core first words this map classifies, for the completeness test. */
export const H2A_COMMAND_MAP_CORE_FIRST_WORDS: readonly string[] = Object.keys(
  CORE_GROUP_BY_FIRST_WORD
);

const VERB_COLUMN = 30;

/**
 * Render the map: one line per group heading, one line per verb. Text output —
 * the `explain` contract entry declares `outputShape: "text"`.
 */
export function renderCommandMap(trackFacadeVerbs: readonly string[]): string {
  const lines: string[] = [
    "h2a — grouped command map",
    "",
    "Grouped by what an operator is trying to do. Verbs marked (runtime) are served",
    "by the lazily-loaded @sentropic/h2a-runtime; you still type `h2a <verb>`.",
    "Grouping vocabulary: docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md.",
    ""
  ];

  for (const section of buildCommandMap(trackFacadeVerbs)) {
    lines.push(`${section.group.heading} — ${section.group.intention}`);
    for (const entry of section.entries) {
      const label = `h2a ${entry.verb}${entry.origin === "runtime" ? " (runtime)" : ""}`;
      lines.push(
        label.length >= VERB_COLUMN
          ? `  ${label}  ${entry.summary}`
          : `  ${label.padEnd(VERB_COLUMN)}${entry.summary}`
      );
    }
    lines.push("");
  }

  lines.push(
    "Full flag surface for one verb: h2a <verb> --help",
    "Flat usage list of the core verbs: h2a --help"
  );
  return lines.join("\n");
}

/**
 * Fail-closed per-verb policy table for verified CLI caller identity (Lot 1.1+1.2).
 *
 * Leaf module under `@sentropic/h2a` (zero dependency on `@sentropic/h2a-runtime`).
 * Every CLI verb — frozen contract (`H2A_CLI_VERB_CONTRACTS`), Track façade
 * (`TRACK_FACADE_VERBS`), and lazy runtime commands — must be classified here.
 * Unknown or unclassified verbs fail closed (`agentPolicy: "unclassified"`).
 */

export type AgentPolicyClass =
  | "allow"
  | "own-only"
  | "owner-authorized"
  | "owner-only"
  | "internal";

export type OwnerGrantActId = "central-stop" | "central-compact";

export interface H2AAgentVerbPolicy {
  readonly agentPolicy: AgentPolicyClass;
  readonly isolatedRootSafe: boolean;
  readonly callerFlags?: readonly string[];
  readonly privateKeyFlags?: readonly string[];
  readonly ownerOnlyFlags?: readonly string[];
  readonly ownerAuthorizedAct?: OwnerGrantActId;
  /** Disallowed flags in agent context BEFORE claiming an owner grant (NB-2). */
  readonly preGrantDisallowedFlags?: readonly string[];
  readonly ownOnlyKind?: "target-session" | "actor-scope";
  readonly scriptServiceAllowed?: boolean;
  readonly h2aShellAllowed?: boolean;
}

export interface ResolvedAgentVerbPolicy {
  readonly commandVerb: string;
  readonly agentPolicy: AgentPolicyClass | "unclassified";
  readonly isolatedRootSafe: boolean;
  readonly callerFlags: readonly string[];
  readonly privateKeyFlags: readonly string[];
  readonly ownerOnlyFlags: readonly string[];
  readonly matchedOwnerOnlyFlag?: string;
  readonly preGrantDisallowedFlags: readonly string[];
  readonly matchedPreGrantDisallowedFlag?: string;
  readonly ownerAuthorizedAct?: OwnerGrantActId;
  readonly ownOnlyKind?: "target-session" | "actor-scope";
  readonly scriptServiceAllowed: boolean;
  readonly h2aShellAllowed: boolean;
  readonly requiresTargetSessionOwnership: boolean;
  readonly isInternalMcpTransport: boolean;
  readonly isStatusWatchHostOnly: boolean;
  readonly isPresenceReapWithoutInstance: boolean;
  readonly isPresenceReapWithInstance: boolean;
  readonly isHookCommand: boolean;
}

const READ_ALLOW: H2AAgentVerbPolicy = {
  agentPolicy: "allow",
  isolatedRootSafe: false,
  scriptServiceAllowed: true,
  h2aShellAllowed: true,
};

const READ_ISOLATED_SAFE: H2AAgentVerbPolicy = {
  agentPolicy: "allow",
  isolatedRootSafe: true,
  scriptServiceAllowed: true,
  h2aShellAllowed: true,
};

const OWNER_ONLY: H2AAgentVerbPolicy = {
  agentPolicy: "owner-only",
  isolatedRootSafe: false,
  scriptServiceAllowed: false,
  h2aShellAllowed: false,
};

const INTERNAL_ENTRY: H2AAgentVerbPolicy = {
  agentPolicy: "internal",
  isolatedRootSafe: false,
  scriptServiceAllowed: true,
  h2aShellAllowed: true,
};

/**
 * Complete classification of all 109 frozen verbs in `H2A_CLI_VERB_CONTRACTS`.
 */
export const H2A_CONTRACT_VERB_POLICIES: Readonly<Record<string, H2AAgentVerbPolicy>> = {
  "--help": { ...INTERNAL_ENTRY },
  "explain": { ...READ_ALLOW },
  "hosts": { ...READ_ALLOW },
  "mcp-tools": { ...READ_ALLOW },
  "report-context": { ...READ_ISOLATED_SAFE },
  "doctor": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    ownerOnlyFlags: ["--repair", "--prune"],
    scriptServiceAllowed: true,
    h2aShellAllowed: true,
  },
  "status": { ...READ_ALLOW },
  "sessions": { ...READ_ALLOW },

  "init": { ...OWNER_ONLY },
  "register": { agentPolicy: "own-only", ownOnlyKind: "actor-scope", isolatedRootSafe: true },
  "discover": { ...READ_ISOLATED_SAFE },
  "send": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--from"],
  },
  "connect": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "presence-reap": {
    agentPolicy: "internal",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
    scriptServiceAllowed: true,
  },
  "authorize": { ...OWNER_ONLY },

  "central status": { ...READ_ALLOW },
  "central stop": {
    agentPolicy: "owner-authorized",
    ownerAuthorizedAct: "central-stop",
    isolatedRootSafe: false,
    preGrantDisallowedFlags: ["--force", "--root", "--runtime-base"],
    scriptServiceAllowed: false,
    h2aShellAllowed: false,
  },
  "central compact": {
    agentPolicy: "owner-authorized",
    ownerAuthorizedAct: "central-compact",
    isolatedRootSafe: false,
    preGrantDisallowedFlags: ["--dry-run", "--restore", "--force", "--root", "--runtime-base"],
    scriptServiceAllowed: true,
    h2aShellAllowed: false,
  },

  "inbox put": { agentPolicy: "allow", isolatedRootSafe: true },
  "inbox read": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "inbox pop": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "outbox put": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "outbox read": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "thread": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },

  "loop create": { agentPolicy: "allow", isolatedRootSafe: false },
  "loop enable-auto-tick": { agentPolicy: "allow", isolatedRootSafe: false },
  "loop list": { ...READ_ALLOW },
  "loop status": { ...READ_ALLOW },
  "loop agents": { ...READ_ALLOW },
  "loop attach": { agentPolicy: "allow", isolatedRootSafe: false },
  "loop logs": { ...READ_ALLOW },
  "loop tick": { agentPolicy: "allow", isolatedRootSafe: false },
  "loop watch": { agentPolicy: "allow", isolatedRootSafe: false, scriptServiceAllowed: true },

  "canevas list": { ...READ_ISOLATED_SAFE },
  "canevas serve": { ...OWNER_ONLY },
  "focus serve": { ...OWNER_ONLY },
  "focus web": { ...OWNER_ONLY },

  "subagent register": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--parent"],
  },
  "subagent list": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--parent"],
    scriptServiceAllowed: true,
  },
  "subagent route": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
  },
  "subagent inbox": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--parent"],
  },
  "subagent audit": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--parent"],
    scriptServiceAllowed: true,
  },
  "subagent revoke": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
  },

  "negotiate open": { agentPolicy: "allow", isolatedRootSafe: true },
  "negotiate status": { ...READ_ISOLATED_SAFE },
  "negotiate event": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "negotiate offer": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "negotiate counter": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "negotiate sign": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    callerFlags: ["--instance"],
    privateKeyFlags: ["--private-key"],
  },
  "negotiate stabilize": { agentPolicy: "allow", isolatedRootSafe: true },
  "negotiate journal": { ...READ_ISOLATED_SAFE },

  "declare-interest": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "conflict-posture": { ...READ_ISOLATED_SAFE },
  "dossier": { ...READ_ISOLATED_SAFE },
  "confiance": { ...READ_ISOLATED_SAFE },
  "attest-comprehension": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    callerFlags: ["--instance"],
    privateKeyFlags: ["--private-key"],
  },
  "comprehension list": { ...READ_ISOLATED_SAFE },
  "comprehension verify": { ...READ_ISOLATED_SAFE },

  "store index-launch": { ...OWNER_ONLY },
  "store migrate": { ...OWNER_ONLY },

  "mcp-serve": { ...INTERNAL_ENTRY },
  "track-mcp": { ...INTERNAL_ENTRY },
  "upgrade": {
    agentPolicy: "owner-only",
    isolatedRootSafe: false,
    scriptServiceAllowed: false,
    h2aShellAllowed: false,
  },

  "drive": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: false,
    callerFlags: ["--from"],
    privateKeyFlags: ["--private-key"],
  },
  "drive receive": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: false,
    callerFlags: ["--to"],
  },
  "drive serve": { ...OWNER_ONLY },
  "sysml verify": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    callerFlags: ["--by"],
  },

  "drumbeat record": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "drumbeat scan": { ...READ_ISOLATED_SAFE },
  "drumbeat clear": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "drumbeat escalations": { ...READ_ISOLATED_SAFE },
  "drumbeat relance-inbox": { ...OWNER_ONLY },
  "drumbeat watch": { ...OWNER_ONLY },

  "host setup": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    ownerOnlyFlags: ["--write", "--remove"],
  },
  "host plugin": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    ownerOnlyFlags: ["--write", "--scaffold"],
  },
  "host status": { ...READ_ALLOW },

  "registry catalog": { ...READ_ISOLATED_SAFE },
  "registry bootstrap": { ...OWNER_ONLY },
  "registry-bridge serve": { ...INTERNAL_ENTRY },
  "hosted-lock": { ...OWNER_ONLY },

  "keys generate": { ...OWNER_ONLY },
  "keys add": { ...OWNER_ONLY },
  "keys list": { ...READ_ISOLATED_SAFE },
  "keys revoke": { ...OWNER_ONLY },
  "keys prove-control": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },

  "nhi report": { ...READ_ISOLATED_SAFE },
  "nhi inventory": { ...READ_ISOLATED_SAFE },
  "nhi export": { ...READ_ISOLATED_SAFE },
  "nhi attest": {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: false,
    callerFlags: ["--instance"],
    privateKeyFlags: ["--private-key"],
  },
  "nhi offboard": { ...OWNER_ONLY },

  "org validate": { ...READ_ISOLATED_SAFE },
  "org show": { ...READ_ISOLATED_SAFE },
  "org diff": { ...READ_ISOLATED_SAFE },
  "org provision": { ...OWNER_ONLY },

  "coach propose": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--as"],
  },
  "coach ratify": { ...OWNER_ONLY },

  "blockage raise": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "blockage list": { ...READ_ISOLATED_SAFE },
  "blockage resolve": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--by"],
  },

  "install-skills": { ...OWNER_ONLY },
  "harness": { ...READ_ALLOW },
  "keepalive": {
    agentPolicy: "owner-only",
    isolatedRootSafe: false,
    scriptServiceAllowed: true,
    h2aShellAllowed: false,
  },
  "conductor": { ...READ_ALLOW },
  "conductor claim": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "conductor release": {
    agentPolicy: "allow",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  "conductor-launch-check": { ...READ_ALLOW },
  "conductor-launch": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    callerFlags: ["--instance"],
  },
  "deploy k8s-sidecar": { ...OWNER_ONLY },
  "deploy k8s-tenant": { ...OWNER_ONLY },
} as const;

// Clean any TS type-check helper placeholder without emitting keys at runtime.
delete (H2A_CONTRACT_VERB_POLICIES as Record<string, unknown>)["thread "];

/**
 * Policy for Track façade verbs (`TRACK_FACADE_VERBS`). Read-only and sync
 * write Track verbs are isolated-root safe; async `focus` follows subcommands.
 */
export const H2A_TRACK_VERB_POLICIES: Readonly<Record<string, H2AAgentVerbPolicy>> = {
  query: { ...READ_ISOLATED_SAFE },
  report: { ...READ_ISOLATED_SAFE },
  snapshot: { ...READ_ISOLATED_SAFE },
  decision: { agentPolicy: "allow", isolatedRootSafe: true },
  demand: { agentPolicy: "allow", isolatedRootSafe: true },
  item: { agentPolicy: "allow", isolatedRootSafe: true },
  accept: { agentPolicy: "allow", isolatedRootSafe: true },
  blocker: { agentPolicy: "allow", isolatedRootSafe: true },
  consolidate: { agentPolicy: "allow", isolatedRootSafe: true },
  priority: { agentPolicy: "allow", isolatedRootSafe: true },
  branch: { agentPolicy: "allow", isolatedRootSafe: true },
  ingest: { agentPolicy: "allow", isolatedRootSafe: true },
  restructure: { agentPolicy: "allow", isolatedRootSafe: true },
  focus: { agentPolicy: "allow", isolatedRootSafe: false },
};

/**
 * Complete policy table for every top-level runtime command in
 * `H2A_COMMAND_MAP_RUNTIME_VERBS` (subcommand overrides handled in resolver).
 */
export const H2A_RUNTIME_AGENT_POLICIES: Readonly<Record<string, H2AAgentVerbPolicy>> = {
  run: { agentPolicy: "allow", isolatedRootSafe: false },
  codex: { ...OWNER_ONLY },
  claude: { ...OWNER_ONLY },
  agy: { ...OWNER_ONLY },
  gemini: { ...OWNER_ONLY },
  mistral: { ...OWNER_ONLY },
  muse: { ...OWNER_ONLY },
  vibe: { ...OWNER_ONLY },
  opencode: { ...OWNER_ONLY },
  shell: { ...OWNER_ONLY },
  attach: { ...OWNER_ONLY },
  resume: {
    agentPolicy: "own-only",
    ownOnlyKind: "target-session",
    isolatedRootSafe: false,
    h2aShellAllowed: true,
  },
  stop: {
    agentPolicy: "own-only",
    ownOnlyKind: "target-session",
    isolatedRootSafe: false,
  },
  ls: { ...READ_ALLOW },
  status: { ...READ_ALLOW },
  agents: { ...READ_ALLOW },
  diff: { ...READ_ALLOW },
  "sync-status": { ...READ_ALLOW },
  logs: { ...READ_ALLOW },
  delegate: { agentPolicy: "allow", isolatedRootSafe: false },
  jobs: { ...READ_ALLOW },
  relay: { ...OWNER_ONLY },
  "wake-request": { agentPolicy: "allow", isolatedRootSafe: false },
  "conductor-launch": {
    agentPolicy: "allow",
    isolatedRootSafe: false,
    callerFlags: ["--instance"],
  },
  install: { ...OWNER_ONLY },
  connect: {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: true,
    callerFlags: ["--instance"],
  },
  disconnect: { ...OWNER_ONLY },
  config: { ...OWNER_ONLY },
  auth: { ...OWNER_ONLY },
  secrets: { ...OWNER_ONLY },
  refresh: { ...OWNER_ONLY },
  workspace: { ...READ_ALLOW },
  plugin: { ...READ_ALLOW },
  check: { ...OWNER_ONLY },
  sentropic: { ...OWNER_ONLY },
  tmux: { ...OWNER_ONLY },
  trust: { ...OWNER_ONLY },
  authorize: { ...OWNER_ONLY },
  identity: { ...READ_ALLOW },
  lock: { ...OWNER_ONLY },
  restore: { ...OWNER_ONLY },
  restart: {
    agentPolicy: "own-only",
    ownOnlyKind: "target-session",
    isolatedRootSafe: false,
    ownerOnlyFlags: ["--all"],
  },
  relaunch: {
    agentPolicy: "own-only",
    ownOnlyKind: "target-session",
    isolatedRootSafe: false,
    ownerOnlyFlags: ["--all"],
  },
  "resume-throttled": { ...OWNER_ONLY },
  layout: { ...OWNER_ONLY },
  rename: {
    agentPolicy: "own-only",
    ownOnlyKind: "actor-scope",
    isolatedRootSafe: false,
  },
  enroll: { ...OWNER_ONLY },
  lineage: { ...OWNER_ONLY },
  archive: {
    agentPolicy: "owner-only",
    isolatedRootSafe: false,
    scriptServiceAllowed: false,
  },
  sync: { ...OWNER_ONLY },
  "sync-files": { ...OWNER_ONLY },
  forward: { ...OWNER_ONLY },
  browser: { ...OWNER_ONLY },
  migrate: { ...OWNER_ONLY },
  "llm-mesh": { ...OWNER_ONLY },
  help: { ...INTERNAL_ENTRY },
};

/** Closed set of verbs eligible for `/tmp` isolated-root testing outside D16. */
export const H2A_ISOLATED_ROOT_SAFE_VERBS: ReadonlySet<string> = new Set(
  Object.entries({ ...H2A_CONTRACT_VERB_POLICIES, ...H2A_TRACK_VERB_POLICIES })
    .filter(([, p]) => p.isolatedRootSafe)
    .map(([verb]) => verb),
);

const INTERNAL_DIRECT_VERBS: Readonly<Record<string, H2AAgentVerbPolicy>> = {
  "--help": INTERNAL_ENTRY,
  "-h": INTERNAL_ENTRY,
  help: INTERNAL_ENTRY,
  "--version": INTERNAL_ENTRY,
  "-v": INTERNAL_ENTRY,
  version: INTERNAL_ENTRY,
  "mcp-serve": INTERNAL_ENTRY,
  "mcp-central-serve": INTERNAL_ENTRY,
  "mcp-central-connect": INTERNAL_ENTRY,
  "mcp-central-precheck": INTERNAL_ENTRY,
  "track-mcp": INTERNAL_ENTRY,
  "__operator-break": OWNER_ONLY,
};

function collectPresentFlags(tokens: readonly string[]): Set<string> {
  const present = new Set<string>();
  for (const tok of tokens) {
    if (tok === "--") break;
    if (!tok.startsWith("--") || tok.length <= 2) continue;
    const eq = tok.indexOf("=");
    present.add(eq === -1 ? tok : tok.slice(0, eq));
  }
  return present;
}

function finalizeResolution(
  commandVerb: string,
  policy: H2AAgentVerbPolicy | undefined,
  argv: readonly string[],
  extras: Partial<ResolvedAgentVerbPolicy> = {},
): ResolvedAgentVerbPolicy {
  const present = collectPresentFlags(argv);
  const ownerOnlyFlags = policy?.ownerOnlyFlags ?? [];
  const matchedOwnerOnlyFlag = ownerOnlyFlags.find((f) => present.has(f));
  const preGrantDisallowedFlags = policy?.preGrantDisallowedFlags ?? [];
  const matchedPreGrantDisallowedFlag = preGrantDisallowedFlags.find((f) => present.has(f));
  const effectivePolicy: AgentPolicyClass | "unclassified" = matchedOwnerOnlyFlag
    ? "owner-only"
    : (policy?.agentPolicy ?? "unclassified");

  return {
    commandVerb,
    agentPolicy: effectivePolicy,
    isolatedRootSafe: matchedOwnerOnlyFlag ? false : (policy?.isolatedRootSafe ?? false),
    callerFlags: policy?.callerFlags ?? [],
    privateKeyFlags: policy?.privateKeyFlags ?? [],
    ownerOnlyFlags,
    ...(matchedOwnerOnlyFlag ? { matchedOwnerOnlyFlag } : {}),
    preGrantDisallowedFlags,
    ...(matchedPreGrantDisallowedFlag ? { matchedPreGrantDisallowedFlag } : {}),
    ...(policy?.ownerAuthorizedAct ? { ownerAuthorizedAct: policy.ownerAuthorizedAct } : {}),
    ...(policy?.ownOnlyKind ? { ownOnlyKind: policy.ownOnlyKind } : {}),
    scriptServiceAllowed: matchedOwnerOnlyFlag ? false : (policy?.scriptServiceAllowed ?? false),
    h2aShellAllowed: matchedOwnerOnlyFlag ? false : (policy?.h2aShellAllowed ?? false),
    requiresTargetSessionOwnership: policy?.ownOnlyKind === "target-session" && !matchedOwnerOnlyFlag,
    isInternalMcpTransport: false,
    isStatusWatchHostOnly: false,
    isPresenceReapWithoutInstance: false,
    isPresenceReapWithInstance: false,
    isHookCommand: false,
    ...extras,
  };
}

const LEADING_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--root",
  "--track-dir",
  "--from",
  "--to",
  "--instance",
  "--by",
  "--out",
]);

const LEADING_BOOL_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--quiet",
  "--dry-run",
  "--force",
]);

function skipLeadingGlobalFlags(argv: readonly string[]): readonly string[] {
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (!tok.startsWith("-")) break;
    if (tok === "--") break;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      const flag = tok.slice(0, eq);
      if (LEADING_VALUE_FLAGS.has(flag)) {
        i += 1;
        continue;
      }
      break;
    }
    if (LEADING_VALUE_FLAGS.has(tok)) {
      i += 2;
      continue;
    }
    if (LEADING_BOOL_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

/**
 * Resolve fail-closed policy for a CLI invocation (`argv` without global `--as <login>`).
 * Returns `"unclassified"` whenever a verb or subcommand does not appear in any policy map.
 */
export function resolveVerbAgentPolicy(
  argv: readonly string[],
): ResolvedAgentVerbPolicy {
  const effectiveArgv = skipLeadingGlobalFlags(argv);
  if (effectiveArgv.length === 0) {
    return finalizeResolution("--help", INTERNAL_ENTRY, argv);
  }
  const first = effectiveArgv[0]!;
  const second = effectiveArgv[1] && !effectiveArgv[1].startsWith("-") ? effectiveArgv[1] : undefined;
  const present = collectPresentFlags(argv);

  if (INTERNAL_DIRECT_VERBS[first]) {
    const isMcp =
      first === "mcp-serve" || first === "mcp-central-connect" || first === "track-mcp";
    return finalizeResolution(first, INTERNAL_DIRECT_VERBS[first], argv, {
      isInternalMcpTransport: isMcp,
    });
  }

  // Host shortcuts normalized (`claude-code` -> `claude`, etc.)
  const hostAliasPolicy: Record<string, string> = {
    "claude-code": "claude",
    antigravity: "agy",
    "gemini-cli": "gemini",
    mistralcli: "mistral",
    "muse-code": "muse",
    "mistral-vibe": "vibe",
    smoke: "check",
    h2a: "relay",
  };
  const firstNorm = hostAliasPolicy[first] ?? first;

  // Special two-word core routes & conditional subcommands:
  if (first === "presence-reap") {
    const hasInstance = present.has("--instance");
    if (!hasInstance) {
      return finalizeResolution("presence-reap", H2A_CONTRACT_VERB_POLICIES["presence-reap"], argv, {
        isPresenceReapWithoutInstance: true,
        isHookCommand: true,
      });
    }
    return finalizeResolution(
      "presence-reap",
      {
        agentPolicy: "allow",
        isolatedRootSafe: true,
        callerFlags: ["--instance"],
        scriptServiceAllowed: true,
      },
      argv,
      { isPresenceReapWithInstance: true },
    );
  }

  if (first === "drive" && second === "receive") {
    const isHook = present.has("--stdin") && present.has("--ignore-non-drive");
    if (isHook) {
      return finalizeResolution(
        "drive receive",
        { ...INTERNAL_ENTRY, isolatedRootSafe: true },
        argv,
        { isHookCommand: true },
      );
    }
    return finalizeResolution("drive receive", H2A_CONTRACT_VERB_POLICIES["drive receive"], argv);
  }

  if (first === "drumbeat" && second === "record") {
    const isHook = present.has("--tmux-pane");
    if (isHook) {
      return finalizeResolution(
        "drumbeat record",
        { ...INTERNAL_ENTRY, isolatedRootSafe: true },
        argv,
        { isHookCommand: true },
      );
    }
    return finalizeResolution("drumbeat record", H2A_CONTRACT_VERB_POLICIES["drumbeat record"], argv);
  }

  if (first === "status") {
    if (present.has("--write-bars")) {
      return finalizeResolution("status", INTERNAL_ENTRY, argv);
    }
    if (present.has("--human") && present.has("--watch") && present.has("--tmux-session")) {
      return finalizeResolution("status", INTERNAL_ENTRY, argv, {
        isStatusWatchHostOnly: true,
      });
    }
    return finalizeResolution("status", H2A_CONTRACT_VERB_POLICIES["status"], argv);
  }

  if (first === "enroll") {
    if (present.has("--hook")) {
      return finalizeResolution("enroll", INTERNAL_ENTRY, argv, { isHookCommand: true });
    }
    return finalizeResolution("enroll", OWNER_ONLY, argv);
  }

  if (first === "auth") {
    if (second === "status") {
      return finalizeResolution("auth status", INTERNAL_ENTRY, argv);
    }
    return finalizeResolution(second ? `auth ${second}` : "auth", OWNER_ONLY, argv);
  }

  if (first === "remote") {
    if (second === "status" || second === "off" || second === "down" || second === "kill") {
      return finalizeResolution(`remote ${second}`, { ...READ_ALLOW }, argv);
    }
    if (second === "send") {
      return finalizeResolution(
        "remote send",
        {
          agentPolicy: "own-only",
          ownOnlyKind: "actor-scope",
          isolatedRootSafe: false,
          callerFlags: ["--instance"],
          privateKeyFlags: ["--private-key"],
        },
        argv,
      );
    }
    if (second === "mirror") {
      const intervalIdx = argv.indexOf("--interval-ms");
      const intervalVal = intervalIdx !== -1 ? Number(argv[intervalIdx + 1]) : Number.NaN;
      const validDaemon = Number.isFinite(intervalVal) && intervalVal >= 5000;
      return finalizeResolution(
        "remote mirror",
        {
          agentPolicy: "own-only",
          ownOnlyKind: "actor-scope",
          isolatedRootSafe: false,
          callerFlags: ["--instance"],
          privateKeyFlags: ["--private-key"],
          scriptServiceAllowed: validDaemon,
        },
        argv,
      );
    }
    if (
      second === "serve" ||
      second === "mirror-serve" ||
      second === "enrol" ||
      second === "up" ||
      second === "on" ||
      second === "revoke"
    ) {
      return finalizeResolution(`remote ${second}`, OWNER_ONLY, argv);
    }
    return finalizeResolution(second ? `remote ${second}` : "remote", undefined, argv);
  }

  if (first === "loop") {
    if (second === "supervise") {
      return finalizeResolution(
        "loop supervise",
        { ...OWNER_ONLY, scriptServiceAllowed: true },
        argv,
      );
    }
    if (second === "watch" || second === "run") {
      return finalizeResolution(
        `loop ${second}`,
        { agentPolicy: "allow", isolatedRootSafe: false, scriptServiceAllowed: true },
        argv,
      );
    }
    if (second === "join" || second === "report") {
      return finalizeResolution(
        `loop ${second}`,
        { agentPolicy: "allow", isolatedRootSafe: false, callerFlags: ["--instance"] },
        argv,
      );
    }
    if (second === "done") {
      return finalizeResolution(
        "loop done",
        {
          agentPolicy: "allow",
          isolatedRootSafe: false,
          callerFlags: ["--instance"],
          ownerOnlyFlags: ["--override-refs", "--confirm-human-override"],
        },
        argv,
      );
    }
    if (second === "stop") {
      return finalizeResolution(
        "loop stop",
        { agentPolicy: "allow", isolatedRootSafe: false },
        argv,
      );
    }
  }

  if (first === "jobs") {
    if (!second || ["ls", "leases", "status", "logs", "decisions"].includes(second)) {
      return finalizeResolution(second ? `jobs ${second}` : "jobs", READ_ALLOW, argv);
    }
    if (second === "decide" || second === "reclaim") {
      return finalizeResolution(
        `jobs ${second}`,
        {
          agentPolicy: "own-only",
          ownOnlyKind: "actor-scope",
          isolatedRootSafe: false,
          callerFlags: ["--from"],
        },
        argv,
      );
    }
    if (second === "conduct") {
      return finalizeResolution(
        "jobs conduct",
        { ...OWNER_ONLY, scriptServiceAllowed: true },
        argv,
      );
    }
    if (second === "attach") {
      return finalizeResolution("jobs attach", OWNER_ONLY, argv);
    }
    return finalizeResolution(`jobs ${second}`, undefined, argv);
  }

  if (first === "archive") {
    if (!second || second === "scan" || (second === "schedule" && argv[2] === "status")) {
      return finalizeResolution(
        second ? `archive ${second}` : "archive",
        READ_ALLOW,
        argv,
      );
    }
    if (second === "run" && present.has("--once")) {
      return finalizeResolution(
        "archive run",
        { ...OWNER_ONLY, scriptServiceAllowed: true },
        argv,
      );
    }
    return finalizeResolution(`archive ${second}`, OWNER_ONLY, argv);
  }

  if (first === "run" && second === "shell") {
    return finalizeResolution("run shell", OWNER_ONLY, argv);
  }

  if (first === "central" && second === "residues") {
    return finalizeResolution("central residues", READ_ALLOW, argv);
  }

  if (first === "focus") {
    const focusBuild =
      second === "build" || second === "check" || second === "template" || second === "feedback";
    if (focusBuild) {
      return finalizeResolution(`focus ${second}`, { agentPolicy: "allow", isolatedRootSafe: false }, argv);
    }
    if (second === "serve" || second === "web") {
      return finalizeResolution(`focus ${second}`, OWNER_ONLY, argv);
    }
    return finalizeResolution(second ? `focus ${second}` : "focus", { agentPolicy: "allow", isolatedRootSafe: false }, argv);
  }

  if (first === "identity") {
    if (second === "unlock") return finalizeResolution("identity unlock", OWNER_ONLY, argv);
    return finalizeResolution(second ? `identity ${second}` : "identity", READ_ALLOW, argv);
  }

  if (first === "tmux") {
    if (second === "status") return finalizeResolution("tmux status", READ_ALLOW, argv);
    return finalizeResolution(second ? `tmux ${second}` : "tmux", OWNER_ONLY, argv);
  }

  if (first === "layout") {
    if (second === "show") return finalizeResolution("layout show", READ_ALLOW, argv);
    return finalizeResolution(second ? `layout ${second}` : "layout", OWNER_ONLY, argv);
  }

  if (first === "lineage") {
    if (second === "logs") return finalizeResolution("lineage logs", READ_ALLOW, argv);
    return finalizeResolution(second ? `lineage ${second}` : "lineage", OWNER_ONLY, argv);
  }

  if (first === "plugin") {
    if (second === "ls") return finalizeResolution("plugin ls", READ_ALLOW, argv);
    return finalizeResolution(second ? `plugin ${second}` : "plugin", OWNER_ONLY, argv);
  }

  if (first === "workspace") {
    if (second === "list" || second === "status") {
      return finalizeResolution(`workspace ${second}`, READ_ALLOW, argv);
    }
    return finalizeResolution(second ? `workspace ${second}` : "workspace", OWNER_ONLY, argv);
  }

  if (first === "llm-mesh") {
    if (second === "status" || second === "logs") {
      return finalizeResolution(`llm-mesh ${second}`, READ_ALLOW, argv);
    }
    return finalizeResolution(second ? `llm-mesh ${second}` : "llm-mesh", OWNER_ONLY, argv);
  }

  if (first === "upgrade" && (second === "status" || present.has("--check"))) {
    return finalizeResolution(
      second ? `upgrade ${second}` : "upgrade",
      READ_ALLOW,
      argv,
    );
  }

  // Exact two-word contract verb match (e.g., "inbox put", "negotiate sign", "registry-bridge serve").
  if (second) {
    const twoWord = `${firstNorm} ${second}`;
    if (H2A_CONTRACT_VERB_POLICIES[twoWord]) {
      return finalizeResolution(twoWord, H2A_CONTRACT_VERB_POLICIES[twoWord], argv);
    }
  }

  // Exact single-word contract, Track, or runtime verb match.
  if (H2A_CONTRACT_VERB_POLICIES[firstNorm]) {
    return finalizeResolution(firstNorm, H2A_CONTRACT_VERB_POLICIES[firstNorm], argv);
  }
  if (H2A_TRACK_VERB_POLICIES[firstNorm]) {
    return finalizeResolution(firstNorm, H2A_TRACK_VERB_POLICIES[firstNorm], argv);
  }
  if (H2A_RUNTIME_AGENT_POLICIES[firstNorm]) {
    return finalizeResolution(firstNorm, H2A_RUNTIME_AGENT_POLICIES[firstNorm], argv);
  }

  // Unknown command/subcommand -> fail closed!
  return finalizeResolution(second ? `${firstNorm} ${second}` : firstNorm, undefined, argv);
}

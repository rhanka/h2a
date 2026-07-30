/**
 * `h2a` CLI dispatcher — stable JSON output contract + exit-code table (DEC-034).
 *
 * Output shapes
 * -------------
 * Every JSON-emitting verb writes ONE of three canonical envelopes on stdout:
 *
 * - **resource** — bare JSON of a single entity. Used by verbs that return the
 *   persisted/loaded record itself (`negotiate open`, `negotiate status`,
 *   `negotiate event`, `negotiate offer`, `negotiate counter`, `negotiate sign`,
 *   `inbox pop`, `host setup --print`).
 * - **list** — bare JSON array. Used by `hosts`, `mcp-tools`, `discover`,
 *   `inbox read`, `outbox read`, `negotiate journal`.
 * - **action** — `{ ok: true, ...details }` confirmation envelope. Used by
 *   verbs that perform side effects without a natural entity to return
 *   (`init`, `register`, `inbox put`, `outbox put`, `negotiate stabilize`,
 *   `host setup --write`).
 *
 * Stderr lines always follow `h2a <verb> [sub]: <message>` so callers can
 * grep them deterministically. The `mcp-serve` verb is a long-running
 * JSON-RPC 2.0 stdio transport and does not fit the envelope contract.
 *
 * Exit codes
 * ----------
 *
 * - `0` — success.
 * - `1` — user error: missing/bad flag, invalid JSON, validation failure on
 *   caller-supplied data, unknown verb/subverb/host.
 * - `2` — runtime/state error: store conflict or business-rule violation
 *   (negotiation not found, already open, already stabilized, signature
 *   fails verification, quorum incomplete, broken journal, divergent
 *   pre-existing config file refusing merge without `--force`).
 * - `3` — I/O / OS error: file unreadable, permission denied, write
 *   refused by the filesystem.
 *
 * The full machine-readable manifest lives in `./cli-contract.ts`
 * (`H2A_CLI_VERB_CONTRACTS`). Human-readable reference: `docs/cli-contract.md`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Static import — `@sentropic/track` is a LIGHT library (pure reader/model, no
// pty/aws/runtime). The golden rule (lazy-only) is scoped to
// `@sentropic/h2a-runtime`/node-pty/aws-sdk, which track is NOT. Importing its
// public `runCli` lets ④ run read-only track verbs IN-PROCESS (no spawn), on the
// same `.track` under the same lock as the surviving spawn facade.
import { runCli as runTrackCli, type CliIO } from "@sentropic/track";

// Static import — `h2a` is a LIGHT, zero-runtime-dep method
// library (host-agnostic code-work / PR-workflow layer, BR-42h). Like track it
// is NOT on the golden-rule lazy-only list (that is scoped to
// `@sentropic/h2a-runtime`/node-pty/aws-sdk). Its public `runHarnessCli` lets
// `h2a harness <verb>` run the harness method CLI IN-PROCESS (Slice A).
// `HARNESS_SKILLS` is the harness pack's canonical, programmatic inventory —
// `install-skills` renders `harness-<name>` from it (no hard-coded list, no
// skill copies committed here; SOURCE UNIQUE = the installed npm package).
import { runHarnessCli, HARNESS_SKILLS } from "./vendor/harness/index.js";
import { renderCommandMap } from "./cli-command-map.js";

import {
  H2A_ATTESTER_COMPREHENSION_RIGHT,
  H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
  H2A_DECLARATION_INTERET_BODY_KIND,
  H2A_ORG_MANIFEST_FILENAME,
  H2A_ORG_PROPOSAL_BODY_KIND,
  H2A_ORG_RATIFIED_BODY_KIND,
  H2A_ROLES,
  H2A_WORK_STATUSES,
  auditNhiPosture,
  buildComprehensionAttestation,
  canAttestComprehension,
  checkEnvelopeFreshness,
  computeHash,
  createEnvelope,
  deriveWorkspaceId,
  diffOrgManifest,
  effectiveOrgInstances,
  isComprehensionAttestation,
  nhiAttestationEnvelope,
  nhiInventory,
  deriveConnectionConfidence,
  nhiTrustBundle,
  orgAssignmentEnvelope,
  parseOrgManifest,
  signCanonical,
  signEnvelope,
  subagentAddress,
  validateOrgManifest,
  verifyComprehensionAttestation
} from "@sentropic/h2a";
import type {
  H2AActorRef,
  H2AActorRegistration,
  H2ALaunchContext,
  H2AEnvelope,
  H2AReplayGuard,
  H2ARole,
  H2AWorkspaceRef
} from "@sentropic/h2a";

import { H2A_CLAUDE_HOST } from "./hosts/claude.js";
import { H2A_CODEX_HOST } from "./hosts/codex.js";
import { H2A_GEMINI_HOST } from "./hosts/gemini.js";
import { H2A_AGY_HOST } from "./hosts/agy.js";
import { H2A_HERMES_HOST } from "./hosts/hermes.js";
import { H2A_OPENCODE_HOST } from "./hosts/opencode.js";
import {
  doctorHostInstallations,
  findLiveSessionsPredatingHostConfig,
  type HostInstallationDoctorOptions,
  type HostInstallationDoctorReport
} from "./hosts/installation-doctor.js";
import { H2A_CLI_MCP_TOOL_NAMES } from "./mcp.js";
import {
  renderStopHook,
  claudeStopHookEntry,
  claudeDriveReceiveHookEntry,
  isH2ADriveReceiveHook,
  isH2ARecordHook,
  codexPluginManifest,
  codexMarketplaceManifest,
  codexPluginTrustCommands,
  H2A_CODEX_PLUGIN_NAME,
  H2A_HOST_PLUGIN_HOSTS
} from "./hosts/plugin.js";
import {
  H2A_STORE_SCHEMA_VERSION,
  assertHostQualifiedAddress,
  canonicalAddress,
  createLocalStore,
  listPresence,
  reapAllDeadPresence,
  reapDeadInstancePresence,
  readPresence,
  resolveRecipient,
  safePathSegment,
  sanitizeStorePaths,
  writePresence
} from "./runtime/local-files/index.js";
import {
  H2A_MCP_READY_FILE_ENV,
  H2A_MCP_READY_NONCE_ENV,
  runMcpStdio
} from "./runtime/mcp/index.js";
import { renderK8sSidecar } from "./runtime/deploy/k8s-sidecar.js";
import { renderK8sTenant } from "./runtime/deploy/k8s-tenant.js";
import { remoteServerForStore, sendRemoteEnvelope } from "./runtime/remote/index.js";
import {
  buildInstanceMirror,
  isPushableHttpUrl,
  mirrorPushGloballyDisabled,
  mirrorServerForStore,
  redactEndpoint,
  runMirrorPushDaemon,
  MIN_MIRROR_PUSH_INTERVAL_MS,
  MIRROR_PUSH_INVALID_URL_MESSAGE,
  MIRROR_PUSH_OFF_ENV,
  type MirrorPushDaemonOptions
} from "./runtime/mirror/index.js";
import {
  recordStop,
  scanDrumbeat,
  listDrumbeat,
  clearDrumbeatEntry,
  runDrumbeatWatch as runDrumbeatWatchLoop,
  loggingRelauncher,
  localTmuxRelauncher,
  headlessRelauncher,
  remoteRelauncher,
  chainRelauncher,
  relanceFromInbox,
  loggingDecider,
  subagentDecider,
  H2A_DEFAULT_MAX_RELANCES,
  type H2ADrumbeatEntry,
  type H2ARelauncher,
  type H2ARelauncherKind,
  type ReflexiveDecider
} from "./runtime/drumbeat/index.js";
import { gatherNhiSnapshot } from "./runtime/nhi.js";
import {
  raiseBlockage,
  listBlockages,
  resolveBlockage
} from "./runtime/blockage/index.js";
import {
  recordEscalation,
  listEscalations,
  clearEscalation
} from "./runtime/escalation/index.js";
import {
  authorizeDrive,
  chainDriver,
  formatSignedDriveInstruction,
  headlessDriver,
  localTmuxDriver,
  loggingDriver,
  nativeBackchannelDriver,
  remoteDriveServerForStore,
  verifyDriveOnReceive,
  type H2ADriveInstructionPayload,
  type H2ADriver,
  type H2ADriverKind
} from "./runtime/drive/index.js";
import { verifyEnvelopeSysmlRef } from "./runtime/sysml/index.js";
import {
  checkUpgrade,
  performUpgrade,
  currentCliVersion,
  upgradeCachePath,
  canReexec,
  reexecSelf,
  H2A_AUTO_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  H2A_UPGRADE_CHECK_TTL_MS,
  type UpgradeRuntime
} from "./runtime/upgrade/index.js";
import {
  H2A_CLI_DECLARED_CAPABILITIES,
  createHostSessionNameRefresher,
  resolveLiveIdentity
} from "./runtime/identity/index.js";
import {
  buildEnrollmentProof,
  enrollmentProofSignedPayload,
  listUnusablePrivateKeys,
  sanitizeEnrollmentChallenge,
  type H2AEnrollmentChallenge
} from "./runtime/enrollment/index.js";
import { conductorFor } from "./runtime/governance/conductor.js";
import { appendConductorClaim } from "./runtime/governance/claims.js";
import { conductorLaunchCheck } from "./runtime/governance/launch-check.js";
import {
  lastSpawnRequestAt,
  recordSpawnRequest,
  spawnAllowed
} from "./runtime/governance/spawns.js";
import {
  createObjectiveLoop,
  declareObjectiveLoopDone,
  enableObjectiveLoopAutoTick,
  joinObjectiveLoop,
  listLoopEvents,
  listObjectiveLoops,
  readObjectiveLoop,
  reportObjectiveLoop,
  stopObjectiveLoop,
  validateLoopLaunchSpec,
  type H2ALoopAgent,
  type H2ALoopLaunchSpec,
  type H2ALoopRepoRef,
  type H2ALoopTrackRef
} from "./runtime/loop/index.js";
import { runLoopWatch, runTick } from "./runtime/loop/engine/tick.js";
import { runLoopSupervisor } from "./runtime/loop/supervisor.js";
import { gatherPendingDecisions } from "./runtime/canevas/gather.js";
import { runCanevasServe } from "./runtime/canevas/serve.js";
import { readH2AReportContext } from "./runtime/reporting/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// `dist/cli.js` lives in `packages/h2a-cli/dist/`; skills are at
// `packages/h2a-cli/skills/`. Two levels up from the dist file.
const SKILLS_DIR = resolvePath(HERE, "..", "skills");

/**
 * Pattern matchers used to map known store-level error messages to exit code
 * 2 (state/runtime conflict) instead of the default 1 (user error). Anything
 * not matched here keeps the conservative 1 — DEC-034 explicitly opts for
 * "don't over-promote".
 */
const STORE_STATE_ERROR_PATTERNS: readonly RegExp[] = [
  /already registered/i,
  /already open/i,
  /already stabilized/i,
  /not found/i,
  /no such envelope/i,
  /fails verification/i,
  /no artifactHash has the full quorum/i,
  /no offer\/counter event matches/i,
  /stabilized artifact already on disk/i,
  /attester-comprehension/i,
  // DEC-069/070/072: subagent binding/routing/revocation preconditions.
  /not registered/i,
  /revoked/i,
  /key not active/i,
  /parent-not-agents/,
  /parent-instance-mismatch/,
  /capabilities-exceed-parent/
];

function classifyStoreError(message: string): 1 | 2 {
  for (const pattern of STORE_STATE_ERROR_PATTERNS) {
    if (pattern.test(message)) return 2;
  }
  return 1;
}

export interface H2ACliStreams {
  stderr: Pick<typeof process.stderr, "write">;
  stdout: Pick<typeof process.stdout, "write">;
  cwd?: () => string;
  stdinText?: string | (() => string);
}

/** Injectable only for embedders that need hermetic host-installation checks. */
export interface H2ACliOptions {
  readonly doctorHostInstallations?: (
    options: HostInstallationDoctorOptions
  ) => HostInstallationDoctorReport;
}

const CLI_HOSTS = [
  H2A_CODEX_HOST,
  H2A_CLAUDE_HOST,
  H2A_GEMINI_HOST,
  H2A_AGY_HOST,
  H2A_HERMES_HOST,
  H2A_OPENCODE_HOST
] as const;

export function renderCliHelp(): string {
  return [
    "h2a",
    "",
    "Human-to-agent coordination CLI — the unified sentropic CLI and core.",
    "It also fronts agent work sessions, the work record (@sentropic/track) and the",
    "harness method; a verb it does not serve itself loads the h2a runtime on demand.",
    "h2a runs and coordinates agents; it is not itself an agent.",
    "",
    "The list below is a flat usage reference, and it is NOT exhaustive. For every",
    "command grouped by what you are trying to do — core and runtime, derived from",
    "the frozen verb contract so it cannot go stale — run:",
    "  h2a explain",
    "",
    "Usage:",
    "  h2a --help",
    "  h2a explain",
    "  h2a hosts",
    "  h2a mcp-tools",
    "  h2a init [--root <path>]",
    "  h2a register --json <json> [--root <path>]",
    "  h2a discover [--role <role>] [--scope <scope>] [--root <path>]",
    "  h2a subagent register --parent <instance> --name <name> [--capabilities a,b] [--root <path>]",
    "  h2a subagent list [--parent <instance>] [--root <path>]",
    "  h2a subagent route --to <subagent-address> --json <envelope> [--mailbox inbox|outbox] [--root <path>]",
    "  h2a subagent inbox --parent <instance> [--root <path>]",
    "  h2a subagent audit (--id <subagent-address> | --parent <instance>) [--root <path>]",
    "  h2a subagent revoke --id <subagent-address> [--reason <text>] [--root <path>]",
    "  h2a negotiate open --json <record-json> [--root <path>]",
    "  h2a negotiate status --id <id> --status <status> [--root <path>]",
    "  h2a negotiate event --id <id> --json <payload-json> [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate offer --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate counter --id <id> --instance <id> --artifact <json> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate sign --id <id> --instance <id> --artifact <json> --private-key <pem-path> [--event-id <id>] [--causation-id <id>] [--correlation-id <id>] [--root <path>]",
    "  h2a negotiate stabilize --id <id> [--event-id <id>] [--root <path>]",
    "  h2a negotiate journal --id <id> [--root <path>]",
    "  h2a declare-interest --negotiation <id> --instance <id> --interets <a,b> [--bindings <scope,...>] [--masque-impact-collectif] [--event-id <id>] [--root <path>]",
    "  h2a conflict-posture --negotiation <id> [--root <path>]",
    "  h2a dossier --negotiation <id> [--presenter <id>] [--advisory-gate] [--event-id <id>] [--root <path>]",
    "  h2a confiance --negotiation <id> [--root <path>]",
    "  h2a attest-comprehension --instance <id> --dossier <file|sha256:...> --private-key <pem-path> [--negotiation <id> | --to <instance>] [--role <role>] [--scope <scope>] [--root <path>]",
    "  h2a comprehension list --negotiation <id> [--root <path>]",
    "  h2a comprehension verify --json <event-or-envelope-json> --public-key <pem-file>",
    "",
    "Auto-propagation (DEC-033):",
    "  offer/counter/sign/event inherit causationId from the previous journal",
    "  entry's id, and correlationId from the previous entry's correlationId.",
    "  Explicit --causation-id / --correlation-id flags always override the",
    "  inherited default; pass them on the first offer to start a fresh thread.",
    "",
    // These 24 lines used to be nested under the "Auto-propagation (DEC-033):"
    // prose block above, which described only offer/counter/sign/event causation.
    // They have nothing to do with it — mailboxes, local servers and host wiring
    // were appended inside someone else's section. Heading added; every usage line
    // below is byte-identical to before.
    "Mailboxes, local services and host wiring:",
    "  h2a inbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a inbox read --instance <id> [--root <path>]",
    "  h2a inbox pop --instance <id> --envelope <id> [--root <path>]",
    "  h2a outbox put --instance <id> --json <envelope> [--root <path>]",
    "  h2a outbox read --instance <id> [--root <path>]",
    "  h2a mcp-serve [--root <path>] [--auto-open [--host <h>] [--instance <id>] [--scope <s>]] [--wake <native|logging>] [--upgrade-check | --auto-upgrade [--no-restart]]   (--auto-open joins the bus at startup; --wake injects a signed h2a-tagged wake into the host on inbox arrival, EVO-1, needs --auto-open; --auto-upgrade self-updates + restarts in place; --upgrade-check = notice only; both opt-in/no network by default; /h2a disconnect to leave)",
    "  h2a upgrade [--check]   (--check: report current vs latest; bare: npm i -g @sentropic/h2a@latest)",
    "  h2a remote serve [--port <n>] [--host <h>] [--path </h2a/envelopes>] [--root <path>]",
    "  h2a remote send --url <u> --instance <signer> --private-key <pem> --json <envelope>",
    "  h2a remote mirror-serve [--port <n>] [--host <h>] [--path </h2a/mirror>] [--enrolled-keys-file <json>] [--root <path>]   (EVO-13 instance-mirror ingester; enrolled keys also via H2A_MIRROR_ENROLLED_KEYS base64)",
    "  h2a remote mirror --url <u> --instance <id> --private-key <pem> [--root <path>] [--interval-ms <n> [--max <n>]]   (push this instance's registration to a remote ingester; ONE-SHOT by default. --interval-ms >= 5000 opts into the live daemon: same payload, repeated on a monotonic beat (15000-30000 recommended), overlap-guarded, backing off on transient errors and STOPPING on repeated 401/403 because re-enrollment is required. Kill-switch: H2A_MIRROR_PUSH_OFF)",
    "  h2a drive --from <instance> --to <instance> --instruction <text> --private-key <pem> [--driver logging|native|local-tmux|headless|auto] [--host <host>] [--root <path>]",
    "  h2a drive receive --to <instance> (--line <signed-line> | --stdin) [--ignore-non-drive] [--root <path>]   (verify-before-act gate for host hooks)",
    "  h2a drive serve --to <instance> --inject-command <command> [--port <n>] [--host <h>] [--path </h2a/drive>] [--root <path>]   (remote verify-before-inject service)",
    "  h2a drumbeat record --instance <id> --status <working|paused|done|blocked|out-of-tokens> [--command <c>] [--resume-command <c>] [--tmux-session <s> --tmux-pane <p>] [--root <path>]",
    "  h2a drumbeat scan [--max-relances <n>] [--root <path>]",
    "  h2a drumbeat clear --instance <id> [--root <path>]",
    "  h2a drumbeat escalations [--root <path>]",
    "  h2a drumbeat relance-inbox [--instance <id>] [--relauncher logging|local-tmux|headless|auto] [--root <path>]",
    "  h2a drumbeat watch [--interval-ms <n>] [--max-relances <n>] [--relauncher logging|local-tmux|remote|headless|auto] [--instance <signer> --private-key <pem>] [--decider logging|<command>] [--decider-after <k>] [--decider-enforce] [--root <path>]",
    "  h2a host setup --host <codex|claude|gemini|agy|hermes|opencode> [--endpoint local|remote] [--url <https://…/mcp>] [--root <path>] [--print | --write <file>] [--force] [--no-wake]   (selects exactly one h2a endpoint; local renders mcp-serve --auto-open --auto-upgrade --wake local-tmux by default)",
    "  h2a host status [--host <name>]",
    "  h2a host plugin --host <codex|claude|gemini|agy|hermes|opencode> --instance <id> [--status <work-status>] [--root <path>] [--write <settings.json> [--force]] [--scaffold <dir>]   (--write installs the Stop hook for claude|gemini|codex|hermes|opencode; --scaffold writes codex's full local marketplace + trust step; agy is poll-only)",
    "  h2a store migrate [--from <v>] [--to <v>] [--sanitize-paths] [--dry-run] [--root <path>]",
    "",
    "High-level coordination (DEC-054):",
    "  h2a connect --host <codex|claude|gemini|agy|hermes|opencode|remote> [--root <path>] [--instance <id>] [--name <display>]",
    "  h2a conductor [--workspace <id|path>] [--root <path>]   (who is the live conductor/owner of a workspace — derived from presence; conductor=role CONDUCTOR if set, else null; candidates=in-workspace live agents)",
    "  h2a conductor-launch-check [--workspace <id|path>] [--root <path>] [--idle-ms <ms>]   (DRY-RUN: polls track workspace-activity; recommends launching a conductor if work is stalled and none is live — h2a does NOT spawn; launch parked pending spawn policy + remote)",
    "  h2a conductor-launch --workspace <id|path> [--root <path>] [--idle-ms <ms>] [--confirm] [--remote <instance>] [--instance <self>]   (D3 EMIT: if stalled+no conductor, emits a launch-REQUEST envelope to a live remote agent — gated by --confirm + 1/30min/workspace cap; h2a NEVER spawns; remote does the actual spawn)",
    "  h2a doctor [--root <path>] [--scan <dir>] [--prune] [--repair]   (--repair converges Claude/Codex plugin installs; --prune deletes host-less/phantom/orphan inbox dirs + stray buses; dry-run by default)",
    "  h2a keepalive [--root <path>] [--interval <ms>] [--once]   (external keepalive prober — refreshes presence for agents whose tmux pane is still alive)",
    "  h2a rename --instance <id> --name <name> [--root <path>]   (set a live session's display name so peers can find it via discover --name)",
    "  h2a status [--root <path>] [--scope <s>] [--instance <i>]",
    "  h2a status --human [--watch] [--tmux-session <exact>] [--interval <duration>]   (read-only tmux/work/gateway/inbox/loop status; --bar is the terse tmux segment)",
    "  h2a sessions [--root <path>] [--scope <s>] [--instance <i>]",
    "  h2a thread --id <threadId> --instance <self> [--root <path>]   (the ordered conversation for a thread, from your inbox+outbox)",
    "  h2a keys generate --instance <id> [--out <dir>] [--root <path>]",
    "  h2a keys add --instance <id> --public-key <pem-file> [--root <path>]",
    "  h2a keys list --instance <id> [--root <path>]",
    "  h2a keys revoke --instance <id> --public-key <pem-file> [--root <path>]",
    "  h2a nhi report [--long-lived-days <n>] [--root <path>]",
    "  h2a nhi inventory [--long-lived-days <n>] [--root <path>]",
    "  h2a nhi attest --instance <id> --private-key <pem-file> [--role <role>] [--scope <scope>] [--root <path>]",
    "  h2a nhi offboard --instance <id> [--reason <text>] [--root <path>]",
    "  h2a nhi export --instance <id> --trust-domain <domain> [--root <path>]",
    "  h2a blockage raise --instance <id> --reason <text> [--scope <s>] [--needs <text>] [--root <path>]",
    "  h2a blockage list [--scope <s>] [--active] [--root <path>]",
    "  h2a blockage resolve --instance <id> [--by <id>] [--root <path>]",
    "  h2a sysml verify --json <envelope> --public-key <pem-file> [--by <id>] [--content-integrity --api-base <url> [--auth <token>]]",
    "  h2a install-skills --host <claude|codex|gemini|agy> [--scope user|project] [--force]",
    "  h2a deploy k8s-sidecar [--instance <id>] [--host <h>] [--root <path>] [--image <ref>] [--cli-version <ver>] [--write <file>]",
    "  h2a deploy k8s-tenant [--namespace <ns>] [--root <path>] [--replicas <n>] [--storage <size>] [--storage-class <sc>] [--lease-ms <ms>] [--image <ref>] [--cli-version <ver>] [--write <file>]",
    "  h2a loop create --name <n> --goal <text> [--auto-tick] [--repo <path[:role]>] [--track <json>] [--agent <host:role:placement> [--launch-stdin]] [--root <path>]",
    "  h2a loop enable-auto-tick <loopId> [--root <path>]",
    "  h2a loop join <loopId> --instance <id> [--agent-id <id>] [--role <role>] [--launch-stdin] [--root <path>]",
    "  h2a loop report <loopId> --note <text> [--instance <id>] [--agent-id <id>] [--auto-join] [--root <path>]",
    "  h2a loop done <loopId> [--note <text>] [--instance <id>] [--agent-id <id>] [--root <path>]",
    "  h2a loop stop <loopId> [--reason <text>] [--root <path>]",
    "  h2a loop list [--root <path>]",
    "  h2a loop status <loopId> [--root <path>]",
    "  h2a loop agents <loopId> [--root <path>]",
    "  h2a loop attach <loopId> --agent <selector> [--root <path>]",
    "  h2a loop logs <loopId> [--agent <selector>] [--root <path>]",
    "  h2a loop supervise [--interval-ms <n>] [--root <path>]",
    "",
    "Legacy Track context projection (leaf command; never calls Track report/snapshot):",
    "  h2a report-context --workspace-root <absolute-path> [--root <h2a-store>]",
    "",
    "Focus Web (packaged production app):",
    "  h2a focus serve [--repo <path>] [--track-events <path>] [--host <host>] [--port <0-65535>]",
    "  h2a focus web   [--repo <path>] [--track-events <path>] [--host <host>] [--port <0-65535>]   (exact alias)",
    "    (defaults to the nearest tracked repo and 127.0.0.1:5178; bare `h2a focus …` remains the Track facade)",
    "",
    "Track (délégué à @sentropic/track — le suivi/record du travail):",
    `  h2a ${[...TRACK_FACADE_VERBS].join(" · h2a ")}`,
    "    (ex: h2a decision new …, h2a report, h2a snapshot, h2a item ls — voir `track <verbe> --help`)",
    "",
    "Harness (délégué à h2a vendored harness — la méthode code-work / PR-workflow):",
    "  h2a harness <check|verify|init|audit|brainstorm|test|debug|review|plan|branch|skills> …",
    "    (namespacé pour éviter les collisions init/branch — voir `h2a harness --help`)",
    "",
    `Hosts: ${CLI_HOSTS.map((host) => host.host).join(", ")}`,
    `MCP tools: ${H2A_CLI_MCP_TOOL_NAMES.join(", ")}`
  ].join("\n");
}

interface ParsedFlags {
  command: string | undefined;
  flags: Record<string, string>;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

/**
 * Resolve the h2a store root, with its provenance.
 *
 * Precedence: explicit `--root` flag → `H2A_ROOT` env → the shared global
 * default `~/h2a-workspace/.h2a`. The global default lets all agents on the
 * same machine share one bus without any explicit configuration — eliminating
 * the split-brain failure (F4) that the old `cwd/.h2a` fallback caused.
 * Callers on long-lived paths (`mcp-serve`, `connect`) warn when a repo-local
 * `.h2a` exists and is being ignored in favour of the shared bus.
 */
function resolveRootInfo(
  flags: Record<string, string>,
  cwd: () => string
): { root: string; source: "flag" | "env" | "default" } {
  if (flags.root) return { root: flags.root, source: "flag" };
  const env = process.env.H2A_ROOT;
  if (env && env.length > 0) return { root: env, source: "env" };
  return { root: join(homedir(), "h2a-workspace", ".h2a"), source: "default" };
}

function resolveRoot(flags: Record<string, string>, cwd: () => string): string {
  return resolveRootInfo(flags, cwd).root;
}

/**
 * Warn (once, to stderr) when the resolved root (from the shared default OR
 * from H2A_ROOT env) differs from a repo-local `.h2a` that exists in the
 * current working directory. The user may have intended to use the local bus —
 * so we alert them to pass `--root <cwd>/.h2a` if that was their intent. When
 * no local `.h2a` exists around the cwd, or when an explicit `--root` flag was
 * used (the user was unambiguous), stay silent. Used by `mcp-serve` and `connect`.
 */
function warnIfCwdRootFallback(
  flags: Record<string, string>,
  cwd: () => string,
  streams: H2ACliStreams
): void {
  const info = resolveRootInfo(flags, cwd);
  // Only warn for implicit resolution (default or env). An explicit --root flag
  // means the user was unambiguous about which bus to use.
  if (info.source === "flag") return;
  const cwdLocal = join(cwd(), ".h2a");
  try {
    if (!existsSync(cwdLocal)) return;
    const resolvedLocal = realpathSync(cwdLocal);
    const resolvedRoot = (() => {
      try { return realpathSync(info.root); } catch { return info.root; }
    })();
    if (resolvedLocal === resolvedRoot) return;
    streams.stderr.write(
      `h2a: a repo-local .h2a exists here but I'm using the shared bus ${info.root}. ` +
        `Pass --root ${cwdLocal} if you meant the local one.\n`
    );
  } catch {
    // silently ignore filesystem errors
  }
}

/**
 * Resolve `causationId` / `correlationId` for a new negotiation event.
 *
 * - Explicit `--causation-id` / `--correlation-id` flags always win.
 * - Otherwise, the values are inherited from the **previous journal entry**
 *   on the same negotiation (DEC-033): `causationId` defaults to the previous
 *   entry's `id`, `correlationId` is propagated as-is so the whole negotiation
 *   acts as a single correlation thread by default.
 */
function resolveCausationCorrelation(
  flags: Record<string, string>,
  previous: { id: string; correlationId?: string } | undefined
): { causationId?: string; correlationId?: string } {
  const explicitCausation = flags["causation-id"];
  const explicitCorrelation = flags["correlation-id"];
  const out: { causationId?: string; correlationId?: string } = {};
  if (explicitCausation) {
    out.causationId = explicitCausation;
  } else if (previous) {
    out.causationId = previous.id;
  }
  if (explicitCorrelation) {
    out.correlationId = explicitCorrelation;
  } else if (previous && previous.correlationId !== undefined) {
    out.correlationId = previous.correlationId;
  }
  return out;
}

function cmdInit(flags: Record<string, string>, streams: H2ACliStreams): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  try {
    const store = createLocalStore({ root });
    streams.stdout.write(
      `${JSON.stringify({ ok: true, root: store.paths.root }, null, 2)}\n`
    );
    return 0;
  } catch (error) {
    // `createLocalStore` is the one place this verb can fail, and the only
    // failure mode in practice is filesystem-level (cannot mkdir under root,
    // permission denied, …). Surface those as exit code 3.
    streams.stderr.write(`h2a init: ${(error as Error).message}\n`);
    return 3;
  }
}

function cmdRegister(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.json) {
    streams.stderr.write("h2a register: --json <registration-json> is required\n");
    return 1;
  }
  let registration;
  try {
    registration = JSON.parse(flags.json);
  } catch (error) {
    streams.stderr.write(`h2a register: invalid JSON (${(error as Error).message})\n`);
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  if (store.findInstance(registration.id)) {
    const message = `Instance already registered: ${registration.id}`;
    streams.stderr.write(`h2a register: ${message}\n`);
    return classifyStoreError(message);
  }
  try {
    store.registerInstance(registration);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a register: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, id: registration.id, root: store.paths.root }, null, 2)}\n`
  );
  return 0;
}

function cmdSubagent(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  // DEC-068 (V2): manage addressable subagent bindings under a parent AGENTS
  // instance. `register` constructs + persists a binding; `list` enumerates.
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (sub === "list") {
    const entries = flags.parent
      ? store.listSubagentsOf(flags.parent)
      : store.listSubagents();
    // DEC-072: annotate each binding with its derived lifecycle status.
    const annotated = entries.map((b) => ({
      ...b,
      status: store.subagentStatus(b.id)
    }));
    streams.stdout.write(`${JSON.stringify(annotated, null, 2)}\n`);
    return 0;
  }

  if (sub === "revoke") {
    if (!flags.id) {
      streams.stderr.write("h2a subagent revoke: --id <subagent-address> is required\n");
      return 1;
    }
    try {
      store.revokeSubagent(flags.id, flags.reason);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent revoke: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: flags.id, status: "revoked", ...(flags.reason ? { reason: flags.reason } : {}) }, null, 2)}\n`
    );
    return 0;
  }

  if (sub === "route") {
    if (!flags.to || !flags.json) {
      streams.stderr.write(
        "h2a subagent route: --to <subagent-address> and --json <envelope-json> are required\n"
      );
      return 1;
    }
    const mailbox = flags.mailbox === "outbox" ? "outbox" : "inbox";
    if (flags.mailbox && flags.mailbox !== "inbox" && flags.mailbox !== "outbox") {
      streams.stderr.write(
        `h2a subagent route: --mailbox must be inbox or outbox (got "${flags.mailbox}")\n`
      );
      return 1;
    }
    let envelope;
    try {
      envelope = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a subagent route: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    try {
      store.routeToSubagent(flags.to, envelope, mailbox);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent route: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: envelope.id, to: flags.to, mailbox }, null, 2)}\n`
    );
    return 0;
  }

  if (sub === "inbox") {
    if (!flags.parent) {
      streams.stderr.write("h2a subagent inbox: --parent <instance> is required\n");
      return 1;
    }
    const fanIn = store.readSubagentInboxes(flags.parent);
    streams.stdout.write(`${JSON.stringify(fanIn, null, 2)}\n`);
    return 0;
  }

  if (sub === "audit") {
    if (!flags.id && !flags.parent) {
      streams.stderr.write(
        "h2a subagent audit: --id <subagent-address> or --parent <instance> is required\n"
      );
      return 1;
    }
    const events = flags.id
      ? store.readSubagentAudit(flags.id)
      : store.readSubagentAuditOf(flags.parent);
    streams.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
    return 0;
  }

  if (sub === "register") {
    if (!flags.parent || !flags.name) {
      streams.stderr.write(
        "h2a subagent register: --parent <instance> and --name <name> are required\n"
      );
      return 1;
    }
    const capabilities = flags.capabilities
      ? flags.capabilities.split(",").map((c) => c.trim()).filter((c) => c.length > 0)
      : undefined;
    const binding = {
      id: subagentAddress(flags.parent, flags.name),
      parentInstance: flags.parent,
      name: flags.name,
      ...(capabilities ? { capabilities } : {}),
      createdAt: new Date().toISOString()
    };
    try {
      store.registerSubagent(binding);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a subagent register: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, id: binding.id, parentInstance: binding.parentInstance, root: store.paths.root }, null, 2)}\n`
    );
    return 0;
  }

  streams.stderr.write(
    `h2a subagent: subcommand required (supported: register, list, route, inbox, audit, revoke)\n`
  );
  return 1;
}

function cmdMailbox(
  argv: readonly string[],
  mailbox: "inbox" | "outbox",
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (!flags.instance) {
    streams.stderr.write(`h2a ${mailbox} ${sub ?? ""}: --instance <id> required\n`);
    return 1;
  }

  if (sub === "put") {
    if (!flags.json) {
      streams.stderr.write(`h2a ${mailbox} put: --json <envelope-json> required\n`);
      return 1;
    }
    let envelope;
    try {
      envelope = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a ${mailbox} put: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    let inboxRecipient = flags.instance;
    let inboxResolution: ReturnType<typeof resolveRecipient> | undefined;
    if (mailbox === "inbox") {
      // WP-2/DOC-03: a display name resolves only to the presence's full
      // instance; a bare display name is never an inbox destination.
      const root = resolveRoot(flags, streams.cwd ?? (() => process.cwd()));
      const liveSessions = listPresence(root);
      const registeredIds = store.listInstances().map((i) => i.instance ?? i.id);
      inboxResolution = resolveRecipient({
        target: flags.instance,
        liveInstances: liveSessions,
        registeredInstances: registeredIds
      });
      if (inboxResolution.kind === "refuse") {
        streams.stderr.write(
          `\nh2a: ${inboxResolution.reason}${inboxResolution.candidates ? `\ncandidates: ${inboxResolution.candidates.join(", ")}` : ""}\n`
        );
        return 1;
      }
      if (inboxResolution.kind === "deliver-resolved") {
        inboxRecipient = inboxResolution.recipient;
      }
      try {
        assertHostQualifiedAddress(inboxRecipient, "recipient");
      } catch (error) {
        streams.stderr.write(`\n${(error as Error).message}\n`);
        return 1;
      }
    }
    try {
      if (mailbox === "inbox") {
        store.putInboxMessage(inboxRecipient, envelope);
      } else {
        store.putOutboxMessage(flags.instance, envelope);
      }
      // Bug-2 backstop: tell the caller whether the recipient is actually live
      // (the write always succeeds — a dormant deposit-for-wake is legitimate).
      const recipientLive =
        mailbox === "inbox"
          ? listPresence(store.paths.root).some(
              (s) => canonicalAddress(s.instance) === canonicalAddress(inboxRecipient)
            )
          : undefined;
      // WP-2: enrich stdout with resolution metadata.
      let resolutionMeta: Record<string, unknown> = {};
      if (inboxResolution) {
        resolutionMeta = {
          resolution: inboxResolution.kind,
          ...(inboxResolution.kind === "deliver-hint" ? { liveCandidate: inboxResolution.liveCandidate, reason: inboxResolution.reason } : {}),
          ...(inboxResolution.kind === "deliver-resolved" ? { recipient: inboxResolution.recipient, reason: inboxResolution.reason } : {}),
          ...(inboxResolution.kind === "deliver-dormant" ? { reason: inboxResolution.reason, dormant: true } : {})
        };
      }
      streams.stdout.write(
        `${JSON.stringify({ ok: true, id: envelope.id, mailbox, instance: mailbox === "inbox" ? inboxRecipient : flags.instance, ...(recipientLive !== undefined ? { recipientLive } : {}), ...resolutionMeta }, null, 2)}\n`
      );
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a ${mailbox} put: ${message}\n`);
      // Envelope-shape failures are user/validation errors (exit 1); only
      // state-level conflicts escalate to exit 2 (none currently emitted here,
      // but the classifier keeps the door open).
      return classifyStoreError(message);
    }
  }

  if (sub === "read") {
    let recipient = flags.instance;
    if (mailbox === "inbox") {
      const liveSessions = listPresence(root);
      const registeredIds = store.listInstances().map((i) => i.instance ?? i.id);
      const resolution = resolveRecipient({
        target: flags.instance,
        liveInstances: liveSessions,
        registeredInstances: registeredIds,
        operation: "read"
      });
      if (resolution.kind === "list") {
        streams.stdout.write(`${JSON.stringify({ candidates: resolution.candidates, reason: resolution.reason }, null, 2)}\n`);
        return 0;
      }
      if (resolution.kind === "refuse") {
        streams.stderr.write(
          `\nh2a: ${resolution.reason}${resolution.candidates ? `\ncandidates: ${resolution.candidates.join(", ")}` : ""}\n`
        );
        return 1;
      }
      if (resolution.kind === "deliver-resolved") {
        recipient = resolution.recipient;
      }
    }
    const messages =
      mailbox === "inbox" ? store.readInbox(recipient) : store.readOutbox(flags.instance);
    streams.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
    return 0;
  }

  if (sub === "pop" && mailbox === "inbox") {
    if (!flags.envelope) {
      streams.stderr.write("h2a inbox pop: --envelope <id> required\n");
      return 1;
    }
    const liveSessions = listPresence(root);
    const registeredIds = store.listInstances().map((i) => i.instance ?? i.id);
    const resolution = resolveRecipient({
      target: flags.instance,
      liveInstances: liveSessions,
      registeredInstances: registeredIds,
      operation: "read"
    });
    if (resolution.kind === "refuse") {
      streams.stderr.write(
        `\nh2a: ${resolution.reason}${resolution.candidates ? `\ncandidates: ${resolution.candidates.join(", ")}` : ""}\n`
      );
      return 1;
    }
    const recipient =
      resolution.kind === "deliver-resolved" ? resolution.recipient : flags.instance;
    const popped = store.popInboxMessage(recipient, flags.envelope);
    if (!popped) {
      streams.stderr.write(`h2a inbox pop: no such envelope ${flags.envelope}\n`);
      // State conflict against the local store (the envelope is not where the
      // caller expected it). Exit code 2 per DEC-034.
      return 2;
    }
    streams.stdout.write(`${JSON.stringify(popped, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(`Unknown ${mailbox} subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write(
    mailbox === "inbox" ? "Use one of: put, read, pop\n" : "Use one of: put, read\n"
  );
  return 1;
}

function cmdNegotiate(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });

  if (sub === "open") {
    if (!flags.json) {
      streams.stderr.write("h2a negotiate open: --json <record-json> required\n");
      return 1;
    }
    let record;
    try {
      record = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a negotiate open: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    try {
      const opened = store.openNegotiation(record);
      streams.stdout.write(`${JSON.stringify(opened, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate open: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "status") {
    if (!flags.id || !flags.status) {
      streams.stderr.write("h2a negotiate status: --id <id> and --status <status> required\n");
      return 1;
    }
    try {
      const updated = store.updateNegotiationStatus(
        flags.id,
        flags.status as Parameters<typeof store.updateNegotiationStatus>[1]
      );
      streams.stdout.write(`${JSON.stringify(updated, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate status: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "offer" || sub === "counter") {
    if (!flags.id || !flags.instance || !flags.artifact) {
      streams.stderr.write(
        `h2a negotiate ${sub}: --id <id> --instance <id> --artifact <json> required\n`
      );
      return 1;
    }
    const record = store.readNegotiation(flags.id);
    if (!record) {
      streams.stderr.write(`h2a negotiate ${sub}: negotiation ${flags.id} not found\n`);
      return 2;
    }
    let artifact;
    try {
      artifact = JSON.parse(flags.artifact);
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate ${sub}: invalid --artifact JSON (${(error as Error).message})\n`
      );
      return 1;
    }
    const existing = store.readNegotiationJournal(flags.id);
    const previous = existing[existing.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const chain = resolveCausationCorrelation(flags, previous);
    const payload = {
      id: flags["event-id"] ?? `evt-${Date.now().toString(36)}`,
      type: sub === "offer" ? "propose" : "counter",
      actor: { instance: flags.instance, role: "CONDUCTOR", scope: record.scope },
      body: { artifact },
      createdAt: new Date().toISOString(),
      ...chain
    } as const;
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate ${sub}: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "sign") {
    if (!flags.id || !flags.instance || !flags.artifact || !flags["private-key"]) {
      streams.stderr.write(
        "h2a negotiate sign: --id <id> --instance <id> --artifact <json> --private-key <pem-path> required\n"
      );
      return 1;
    }
    const record = store.readNegotiation(flags.id);
    if (!record) {
      streams.stderr.write(`h2a negotiate sign: negotiation ${flags.id} not found\n`);
      return 2;
    }
    let artifact;
    try {
      artifact = JSON.parse(flags.artifact);
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate sign: invalid --artifact JSON (${(error as Error).message})\n`
      );
      return 1;
    }
    let privateKeyPem;
    try {
      privateKeyPem = readFileSync(flags["private-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a negotiate sign: cannot read private key at ${flags["private-key"]} (${(error as Error).message})\n`
      );
      // File/OS error — exit code 3 per DEC-034.
      return 3;
    }
    const artifactHash = computeHash(artifact);
    const signature = signCanonical({ artifactHash }, { by: flags.instance, privateKeyPem });
    const existingForSign = store.readNegotiationJournal(flags.id);
    const previousForSign = existingForSign[existingForSign.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const signChain = resolveCausationCorrelation(flags, previousForSign);
    const payload = {
      id: flags["event-id"] ?? `evt-sign-${Date.now().toString(36)}`,
      type: "event" as const,
      actor: { instance: flags.instance, role: "CONDUCTOR" as const, scope: record.scope },
      body: { kind: "signature", artifactHash, signature },
      createdAt: new Date().toISOString(),
      ...signChain
    };
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate sign: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "stabilize") {
    if (!flags.id) {
      streams.stderr.write("h2a negotiate stabilize: --id <id> required\n");
      return 1;
    }
    try {
      const result = store.stabilizeNegotiation(flags.id, { eventId: flags["event-id"] });
      streams.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            record: result.record,
            artifactHash: result.artifactHash,
            signers: result.signers,
            artifactPath: result.artifactPath,
            advisoryEvents: result.advisoryEvents.map((entry) => ({
              id: entry.id,
              sequence: entry.sequence
            })),
            finalEvent: { id: result.finalEvent.id, sequence: result.finalEvent.sequence }
          },
          null,
          2
        )}\n`
      );
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate stabilize: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "event") {
    if (!flags.id || !flags.json) {
      streams.stderr.write("h2a negotiate event: --id <id> and --json <payload-json> required\n");
      return 1;
    }
    let payload;
    try {
      payload = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a negotiate event: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    const existingForEvent = store.readNegotiationJournal(flags.id);
    const previousForEvent = existingForEvent[existingForEvent.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const eventChain = resolveCausationCorrelation(flags, previousForEvent);
    // Explicit fields inside the user-supplied payload always take precedence
    // over the CLI-resolved defaults: this preserves the existing "just append
    // whatever JSON I gave you" contract while still adding the chain when the
    // user did not opt in.
    payload = { ...eventChain, ...payload };
    try {
      const entry = store.appendNegotiationEvent(flags.id, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate event: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "journal") {
    if (!flags.id) {
      streams.stderr.write("h2a negotiate journal: --id <id> required\n");
      return 1;
    }
    try {
      const entries = store.readNegotiationJournal(flags.id);
      streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a negotiate journal: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  streams.stderr.write(`Unknown negotiate subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use one of: open, status, event, offer, counter, sign, stabilize, journal\n");
  return 1;
}

function splitCsvFlag(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function findRegisteredInstance(
  store: ReturnType<typeof createLocalStore>,
  instance: string
): H2AActorRegistration | undefined {
  return store.findInstance(instance) ?? store.listInstances().find((entry) => entry.instance === instance);
}

function parseRoleFlag(value: string | undefined): H2ARole | undefined {
  if (!value) return undefined;
  return H2A_ROLES.includes(value as H2ARole) ? (value as H2ARole) : undefined;
}

function resolveDossierHash(dossier: string): string {
  if (SHA256_HASH_PATTERN.test(dossier)) {
    return dossier;
  }
  const content = readFileSync(dossier, "utf8");
  try {
    return computeHash(JSON.parse(content));
  } catch {
    return computeHash(content);
  }
}

function comprehensionActorFor(
  registration: H2AActorRegistration,
  flags: Record<string, string>
): H2AActorRef {
  const role = parseRoleFlag(flags.role) ?? registration.roles[0];
  if (!role) {
    throw new Error(`${registration.instance} has no role and --role was not provided`);
  }
  if (flags.role && !parseRoleFlag(flags.role)) {
    throw new Error(`unknown role ${flags.role}`);
  }
  const scope = flags.scope ?? registration.scopes[0];
  if (!scope) {
    throw new Error(`${registration.instance} has no scope and --scope was not provided`);
  }
  return { instance: registration.instance, role, scope };
}

function cmdDeclareInteret(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.negotiation || !flags.instance || !flags.interets) {
    streams.stderr.write(
      "h2a declare-interest: --negotiation <id> --instance <id> --interets <a,b> required\n"
    );
    return 1;
  }
  const interets = splitCsvFlag(flags.interets);
  if (interets.length === 0) {
    streams.stderr.write("h2a declare-interest: --interets must contain at least one value\n");
    return 1;
  }
  const bindings = splitCsvFlag(flags.bindings);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  const declaration: {
    kind: typeof H2A_DECLARATION_INTERET_BODY_KIND;
    subject: string;
    interets: string[];
    at: string;
    bindings?: string[];
    masqueImpactCollectif?: boolean;
  } = {
    kind: H2A_DECLARATION_INTERET_BODY_KIND,
    subject: flags.instance,
    interets,
    at: flags.at ?? new Date().toISOString()
  };
  if (bindings.length > 0) declaration.bindings = bindings;
  if (flags["masque-impact-collectif"] !== undefined) {
    declaration.masqueImpactCollectif = true;
  }
  try {
    const entry = store.declareConflitInteret(flags.negotiation, declaration, {
      eventId: flags["event-id"]
    });
    streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a declare-interest: ${message}\n`);
    return classifyStoreError(message);
  }
}

function cmdConflictPosture(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.negotiation) {
    streams.stderr.write("h2a conflict-posture: --negotiation <id> required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  try {
    streams.stdout.write(
      `${JSON.stringify(
        {
          negotiationId: flags.negotiation,
          postures: store.derivePosturesConflit(flags.negotiation)
        },
        null,
        2
      )}\n`
    );
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a conflict-posture: ${message}\n`);
    return classifyStoreError(message);
  }
}

function cmdDossier(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.negotiation) {
    streams.stderr.write("h2a dossier: --negotiation <id> required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  try {
    const result = store.deriveDecisionDossier(flags.negotiation, {
      presenter: flags.presenter,
      advisoryGate: flags["advisory-gate"] === "true",
      eventId: flags["event-id"]
    });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a dossier: ${message}\n`);
    return classifyStoreError(message);
  }
}

function cmdConfiance(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.negotiation) {
    streams.stderr.write("h2a confiance: --negotiation <id> required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  try {
    const posture = store.derivePostureConfiance(flags.negotiation);
    streams.stdout.write(
      `${JSON.stringify({ negotiationId: flags.negotiation, posture }, null, 2)}\n`
    );
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a confiance: ${message}\n`);
    return classifyStoreError(message);
  }
}

function cmdAttestComprehension(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.instance || !flags.dossier || !flags["private-key"]) {
    streams.stderr.write(
      "h2a attest-comprehension: --instance <id> --dossier <file|sha256:...> --private-key <pem-path> required\n"
    );
    return 1;
  }
  if (flags.negotiation && flags.to) {
    streams.stderr.write("h2a attest-comprehension: use either --negotiation or --to, not both\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  const registration = findRegisteredInstance(store, flags.instance);
  if (!registration) {
    streams.stderr.write(`h2a attest-comprehension: instance ${flags.instance} not registered\n`);
    return 2;
  }

  let actor: H2AActorRef;
  try {
    actor = comprehensionActorFor(registration, flags);
  } catch (error) {
    streams.stderr.write(`h2a attest-comprehension: ${(error as Error).message}\n`);
    return 1;
  }
  if (!canAttestComprehension(actor.role, registration.capabilities)) {
    streams.stderr.write(
      `h2a attest-comprehension: role ${actor.role} for ${flags.instance} cannot attest comprehension; AGENTS require ${H2A_ATTESTER_COMPREHENSION_RIGHT}\n`
    );
    return 2;
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = readFileSync(flags["private-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a attest-comprehension: cannot read private key at ${flags["private-key"]} (${(error as Error).message})\n`
    );
    return 3;
  }

  let dossierHash: string;
  try {
    dossierHash = resolveDossierHash(flags.dossier);
  } catch (error) {
    streams.stderr.write(
      `h2a attest-comprehension: cannot read dossier at ${flags.dossier} (${(error as Error).message})\n`
    );
    return 3;
  }

  let body;
  try {
    body = buildComprehensionAttestation({
      subject: flags.instance,
      dossierHash,
      ...(flags.at ? { at: flags.at } : {})
    });
  } catch (error) {
    streams.stderr.write(`h2a attest-comprehension: ${(error as Error).message}\n`);
    return 1;
  }
  const signature = signCanonical(body, { by: flags.instance, privateKeyPem });

  if (flags.negotiation) {
    const record = store.readNegotiation(flags.negotiation);
    if (!record) {
      streams.stderr.write(`h2a attest-comprehension: negotiation ${flags.negotiation} not found\n`);
      return 2;
    }
    const existing = store.readNegotiationJournal(flags.negotiation);
    const previous = existing[existing.length - 1] as
      | { id: string; correlationId?: string }
      | undefined;
    const chain = resolveCausationCorrelation(flags, previous);
    const payload = {
      id: flags["event-id"] ?? `evt-comprehension-${Date.now().toString(36)}`,
      type: "event" as const,
      actor: { ...actor, scope: flags.scope ?? record.scope },
      body,
      signatures: [signature],
      createdAt: body.at,
      ...chain
    };
    try {
      const entry = store.appendNegotiationEvent(flags.negotiation, payload);
      streams.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a attest-comprehension: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  const envelope = createEnvelope({
    id: flags["event-id"] ?? `env-comprehension-${Date.now().toString(36)}`,
    type: "event" as const,
    actor,
    ...(flags.to ? { target: { instance: flags.to } } : {}),
    body,
    signatures: [signature],
    createdAt: body.at
  });
  if (flags.to) {
    try {
      assertHostQualifiedAddress(flags.to, "recipient");
    } catch (error) {
      streams.stderr.write(`\n${(error as Error).message}\n`);
      return 1;
    }
    try {
      store.putInboxMessage(flags.to, envelope);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a attest-comprehension: ${message}\n`);
      return classifyStoreError(message);
    }
  }
  streams.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
}

function cmdComprehension(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "list") {
    if (!flags.negotiation) {
      streams.stderr.write("h2a comprehension list: --negotiation <id> required\n");
      return 1;
    }
    const store = createLocalStore({ root });
    if (!store.readNegotiation(flags.negotiation)) {
      streams.stderr.write(`h2a comprehension list: negotiation ${flags.negotiation} not found\n`);
      return 2;
    }
    try {
      const entries = store.readNegotiationJournal(flags.negotiation).filter((entry) =>
        isComprehensionAttestation(entry.body)
      );
      streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a comprehension list: ${message}\n`);
      return classifyStoreError(message);
    }
  }

  if (sub === "verify") {
    if (!flags.json || !flags["public-key"]) {
      streams.stderr.write("h2a comprehension verify: --json <event-or-envelope-json> --public-key <pem-file> required\n");
      return 1;
    }
    let envelopeOrEntry;
    try {
      envelopeOrEntry = JSON.parse(flags.json);
    } catch (error) {
      streams.stderr.write(`h2a comprehension verify: invalid JSON (${(error as Error).message})\n`);
      return 1;
    }
    let publicKeyPem: string;
    try {
      publicKeyPem = readFileSync(flags["public-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a comprehension verify: cannot read public key at ${flags["public-key"]} (${(error as Error).message})\n`
      );
      return 3;
    }
    const ok = verifyComprehensionAttestation(envelopeOrEntry, [publicKeyPem]);
    const body = isComprehensionAttestation(envelopeOrEntry?.body)
      ? envelopeOrEntry.body
      : undefined;
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok,
          ...(body
            ? {
                kind: H2A_COMPREHENSION_ATTESTATION_BODY_KIND,
                subject: body.subject,
                dossierHash: body.dossierHash
              }
            : {})
        },
        null,
        2
      )}\n`
    );
    return ok ? 0 : 2;
  }

  streams.stderr.write(`Unknown comprehension subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use one of: list, verify\n");
  return 1;
}

/**
 * `h2a mcp-serve` binds directly to the real process std streams because it
 * is a long-running JSON-RPC loop. The test-friendly `streams` interface
 * (write-only) cannot express a readable stdin; tests cover `runMcpStdio`
 * with `PassThrough` streams instead of going through this verb.
 */
/**
 * DEC-105 (EVO-6): resolve the auto-open session config from `mcp-serve` flags.
 * `--auto-open` enables it; the instance is `--instance <id>` or, if absent,
 * `<host>:<cwd-leaf>` (host = `--host` or "agent"). Pure + total so it can be
 * unit-tested without spawning the server. Returns undefined when not enabled.
 */
export function resolveAutoOpen(
  flags: Record<string, string>,
  cwd: () => string
): {
  instance: string;
  host?: string;
  workspace?: H2AWorkspaceRef;
  name?: string;
  scopes?: string[];
  migrationNotice?: string;
  privateKeyPath?: string;
  /**
   * Re-reads the host-native display title on each heartbeat (spec
   * 2026-07-25-h2a-lane-addressing §D1b). Present only when the operator did
   * NOT pass `--name`: an explicit name is the operator's, and must never be
   * overwritten by a host rename.
   */
  refreshDisplayName?: () => string | undefined;
  /** Only a locally-derived identity may attest an MCP delegation. */
  delegationEligible?: true;
} | undefined {
  if (flags["auto-open"] === undefined) return undefined;
  const host = flags.host;
  const identity = resolveLiveIdentity({
    root: resolveRoot(flags, cwd),
    host: host ?? "agent",
    cwd: cwd(),
    // Declared DISPLAY list only, never an authorization input (feed contract
    // ratification condition #3). Lands in the registration's
    // `declaredCapabilities`, never in the authority-bearing `capabilities`.
    declaredCapabilities: H2A_CLI_DECLARED_CAPABILITIES,
    ...(flags.instance !== undefined ? { explicitInstance: flags.instance } : {}),
    ...(flags.name !== undefined ? { name: flags.name } : {}),
    ...(flags.scope !== undefined ? { scopes: [flags.scope] } : {})
  });
  // §D1b: only follow the host title when the operator left the name implicit,
  // and only when a real provider session id was readable (the synthetic
  // `fallback:` id names no transcript, so there is nothing to re-read).
  //
  // The host gate is EXPLICIT, not incidental. `createHostSessionNameRefresher`
  // can only read `claude` and `codex` transcripts; for any other host it returns
  // `undefined` forever. `resolveProviderSession` does resolve a provider session
  // id for `remote`, `gemini` and `agy`, so without this gate those three install
  // a callback that is called on every heartbeat and can never return a name — a
  // guard whose premise cannot hold. Installing nothing is behaviourally
  // identical (the heartbeat keeps the previous name either way) and does not
  // pretend to a capability the reader does not have.
  const refreshableHost = host === "claude" || host === "codex";
  const refreshDisplayName =
    flags.name === undefined &&
    identity.providerSessionId !== undefined &&
    refreshableHost
      ? createHostSessionNameRefresher({
          host,
          cwd: cwd(),
          sessionId: identity.providerSessionId
        })
      : undefined;
  return {
    instance: identity.instance,
    ...(host ? { host } : {}),
    ...(identity.workspace !== undefined ? { workspace: identity.workspace } : {}),
    ...(identity.name !== undefined ? { name: identity.name } : {}),
    ...(refreshDisplayName ? { refreshDisplayName } : {}),
    ...(flags.scope ? { scopes: [flags.scope] } : {}),
    ...(identity.migrationNotice !== undefined
      ? { migrationNotice: identity.migrationNotice }
      : {}),
    ...(identity.privateKeyPath !== undefined
      ? { privateKeyPath: identity.privateKeyPath }
      : {}),
    // An explicit --instance is an operator-provided label, not an identity
    // derived and owned by this sidecar. It may open presence, but it cannot
    // cause h2a_run to be attributed to that claimed owner in the status bar.
    ...(flags.instance === undefined ? { delegationEligible: true as const } : {})
  };
}

/**
 * `h2a upgrade [--check]` (DEC-107, EVO-8 level 1): explicit self-upgrade.
 * `--check` reports current vs latest (no install); bare runs the global
 * install of `@latest`. Sync (spawnSync). `runtime` is injectable for tests.
 */
export function cmdUpgrade(
  flags: Record<string, string>,
  streams: H2ACliStreams,
  runtime?: UpgradeRuntime
): number {
  const current = currentCliVersion();
  if (flags.check !== undefined) {
    const result = checkUpgrade(current, { ...(runtime ? { runtime } : {}), force: true });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const result = checkUpgrade(current, { ...(runtime ? { runtime } : {}), force: true });
  if (!result.upgradeAvailable) {
    streams.stdout.write(
      `${JSON.stringify({ ok: true, current, latest: result.latest ?? current, upgraded: false, reason: "already current or registry unreachable" }, null, 2)}\n`
    );
    return 0;
  }
  const ok = performUpgrade(runtime);
  streams.stdout.write(
    `${JSON.stringify({ ok, current, latest: result.latest, upgraded: ok, package: "@sentropic/h2a" }, null, 2)}\n`
  );
  if (!ok) {
    streams.stderr.write(
      "h2a upgrade: global install failed — run `npm i -g @sentropic/h2a@latest` manually (or check your install method).\n"
    );
    return 1;
  }
  return 0;
}

/**
 * `h2a presence-reap` — false-live janitor. Deletes presence files whose owning
 * process is provably dead: the stale "live" presence a host (Claude Code /
 * Codex) leaves when it drops the MCP stdio connection WITHOUT killing the
 * child, so the lingering process's blind heartbeat kept the presence fresh and
 * peers kept routing to an unreachable agent. Safe by construction — a dead
 * process owns no live session — and it never mints identity, so it is safe to
 * call from a SessionStart hook. Default reaps EVERY dead-pid presence
 * (host-wide; assumes a single-machine bus); `--instance <id>` scopes it to one
 * instance (cross-machine-safe). Prints the reaped set as JSON for audit.
 */
export function cmdPresenceReap(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const instance = flags.instance;
  const reaped = instance
    ? reapDeadInstancePresence(root, instance, "").map((sessionId) => ({
        sessionId,
        instance
      }))
    : reapAllDeadPresence(root);
  streams.stdout.write(
    `${JSON.stringify(
      { ok: true, root, scope: instance ?? "all-dead-pid", count: reaped.length, reaped },
      null,
      2
    )}\n`
  );
  return 0;
}

export async function runMcpServe(
  flags: Record<string, string>,
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    /** Test seam for the internal structured-readiness environment. */
    env?: NodeJS.ProcessEnv;
    /** Test seam for boot upgrade ordering; production uses the default runtime. */
    upgradeRuntime?: UpgradeRuntime;
    /** Graceful-shutdown signal; bin.ts wires SIGTERM/SIGINT/SIGHUP to it. */
    signal?: AbortSignal;
  } = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  warnIfCwdRootFallback(flags, cwd, { stderr: io.stderr, stdout: io.stdout, cwd });
  const root = resolveRoot(flags, cwd);
  const autoOpen = resolveAutoOpen(flags, cwd);
  const readinessEnv = io.env ?? process.env;
  const readyFile = readinessEnv[H2A_MCP_READY_FILE_ENV];
  const readyNonce = readinessEnv[H2A_MCP_READY_NONCE_ENV];
  let readiness: { file: string; nonce: string } | undefined;
  if (readyFile !== undefined || readyNonce !== undefined) {
    if (
      !readyFile ||
      !isAbsolute(readyFile) ||
      readyFile.includes("\0") ||
      !readyNonce ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        readyNonce
      )
    ) {
      io.stderr.write("h2a mcp-serve: invalid internal readiness challenge\n");
      return 1;
    }
    readiness = { file: readyFile, nonce: readyNonce };
  }

  // DEC-107/108 (EVO-8 levels 2/3): version handling at boot. **Opt-in** — no
  // network on a default boot. `--auto-upgrade` self-installs @latest then
  // re-execs in place via process.execve (same PID/stdio, host stays connected;
  // falls back to next-launch where execve is unavailable or `--no-restart`).
  // `--upgrade-check` (notice only) prints a cached, bounded availability hint.
  // The H2A_REEXEC_GUARD_ENV flag (set across the re-exec) prevents a re-loop.
  const wantAutoUpgrade = flags["auto-upgrade"] !== undefined;
  const wantCheckOnly = flags["upgrade-check"] !== undefined;
  if (
    (wantAutoUpgrade || wantCheckOnly) &&
    process.env[H2A_REEXEC_GUARD_ENV] === undefined
  ) {
    try {
      const current = currentCliVersion();
      // `--auto-upgrade` is opt-in to stay current → short (1h) cache so a
      // same-day release isn't masked by the 24h notice cache; the passive
      // `--upgrade-check` notice keeps the 24h throttle.
      const ttlMs = wantAutoUpgrade ? H2A_AUTO_UPGRADE_CHECK_TTL_MS : H2A_UPGRADE_CHECK_TTL_MS;
      const result = checkUpgrade(current, {
        cachePath: upgradeCachePath(root),
        ttlMs,
        ...(io.upgradeRuntime ? { runtime: io.upgradeRuntime } : {})
      });
      if (result.upgradeAvailable) {
        if (wantAutoUpgrade) {
          const ok = performUpgrade(io.upgradeRuntime);
          if (ok && flags["no-restart"] === undefined && canReexec()) {
            io.stderr.write(
              `h2a mcp-serve: auto-upgraded ${current} → ${result.latest}; restarting into the new version…\n`
            );
            reexecSelf(); // on success the image is replaced (never returns)
          }
          io.stderr.write(
            ok
              ? `h2a mcp-serve: auto-upgraded ${current} → ${result.latest} (applies on next launch)\n`
              : `h2a mcp-serve: auto-upgrade to ${result.latest} failed; staying on ${current}\n`
          );
        } else {
          io.stderr.write(
            `h2a mcp-serve: h2a ${result.latest} available (current ${current}) — run \`h2a upgrade\`\n`
          );
        }
      }
    } catch {
      // best-effort: a check/upgrade failure must never block serving.
    }
  }

  // EVO-1 inbox wake (bug #3): --wake <driver-kind> injects a signed wake on
  // inbox arrival (requires --auto-open + a resolvable private key).
  const WAKE_KINDS: readonly string[] = ["logging", "native", "local-tmux", "headless", "auto"];
  let wake: { driver: H2ADriver; privateKeyPem: string } | undefined;
  if (flags.wake !== undefined && !WAKE_KINDS.includes(flags.wake)) {
    io.stderr.write(
      "h2a mcp-serve: --wake must be one of logging|native|local-tmux|headless|auto; ignored\n"
    );
  } else if (flags.wake === "headless") {
    // A self-wake must NEVER spawn a new agent. headless does exactly that.
    io.stderr.write(
      "h2a mcp-serve: --wake headless is unsafe (it would spawn a NEW agent on inbox arrival, not wake this one); use local-tmux. ignored\n"
    );
  } else if (flags.wake !== undefined && autoOpen?.privateKeyPath) {
    try {
      const privateKeyPem = readFileSync(autoOpen.privateKeyPath, "utf8");
      const log = (line: string) => io.stderr.write(`${line}\n`);
      // `auto` for a self-wake is native→local-tmux ONLY (no headless leg — its
      // fallback spawns a new agent, wrong for waking yourself).
      const driver =
        flags.wake === "auto"
          ? chainDriver(nativeBackchannelDriver(), localTmuxDriver({ log }))
          : buildDriveDriver(flags.wake as H2ADriverKind, log);
      wake = { driver, privateKeyPem };
    } catch (err) {
      io.stderr.write(`h2a mcp-serve: --wake disabled (cannot read key): ${(err as Error).message}\n`);
    }
  } else if (flags.wake !== undefined && !autoOpen) {
    io.stderr.write("h2a mcp-serve: --wake requires --auto-open; ignored\n");
  }

  try {
    if (autoOpen?.migrationNotice) {
      io.stderr.write(`h2a mcp-serve: ${autoOpen.migrationNotice}\n`);
    }
    await runMcpStdio({
      root,
      workspaceRoot: process.cwd(),
      stdin: io.stdin as never,
      stdout: io.stdout as never,
      stderr: io.stderr as never,
      ...(autoOpen ? { autoOpen } : {}),
      ...(readiness ? { readiness } : {}),
      ...(wake ? { wake } : {}),
      ...(io.signal ? { signal: io.signal } : {})
    });
    return 0;
  } catch (err) {
    io.stderr.write(`h2a mcp-serve: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * `h2a remote serve` (DEC-077): long-running HTTP listener that authenticates
 * POSTed envelopes against the store registry and delivers them to local
 * inboxes. Async + blocking, so it is dispatched from bin.ts (like mcp-serve),
 * not the synchronous runCli. Binds 127.0.0.1 by default — never expose to all
 * interfaces implicitly; pass `--host 0.0.0.0` to opt in.
 */
export async function runRemoteServe(
  flags: Record<string, string>,
  io: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    onListening?: (server: import("node:http").Server) => void;
  } = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const host = flags.host ?? "127.0.0.1";
  const port = flags.port ? Number.parseInt(flags.port, 10) : 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`h2a remote serve: invalid --port "${flags.port}"\n`);
    return 1;
  }
  let store;
  try {
    store = createLocalStore({ root });
  } catch (error) {
    io.stderr.write(`h2a remote serve: ${(error as Error).message}\n`);
    return 1;
  }
  const server = remoteServerForStore(store, { path: flags.path });
  return await new Promise<number>((resolve) => {
    server.on("error", (err) => {
      io.stderr.write(`h2a remote serve: ${err.message}\n`);
      resolve(1);
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      io.stdout.write(
        `h2a remote serve: listening on http://${host}:${boundPort}${flags.path ?? "/h2a/envelopes"} (root ${root})\n`
      );
      io.onListening?.(server);
    });
    server.on("close", () => resolve(0));
  });
}

export interface RunDriveServeOptions {
  readonly inject?: (
    payload: H2ADriveInstructionPayload,
    signedLine: string
  ) => boolean | Promise<boolean>;
}

function commandDriveInjector(
  command: string,
  io: Pick<H2ACliStreams, "stderr">
): (payload: H2ADriveInstructionPayload, signedLine: string) => boolean {
  return (payload, signedLine) => {
    const result = spawnSync(command, {
      shell: true,
      input: `${signedLine}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        H2A_DRIVE_LINE: signedLine,
        H2A_DRIVE_FROM: payload.from,
        H2A_DRIVE_TO: payload.to,
        H2A_DRIVE_INSTRUCTION: payload.instruction
      },
      timeout: 30_000
    });
    if (result.error) {
      io.stderr.write(`h2a drive serve: injector command failed: ${result.error.message}\n`);
      return false;
    }
    if (result.status !== 0) {
      io.stderr.write(
        `h2a drive serve: injector command exited ${result.status ?? "unknown"}\n`
      );
      return false;
    }
    return true;
  };
}

/**
 * `h2a drive serve` (EVO-1 E1d): long-running HTTP endpoint for remote/sidecar
 * injection. It verifies signature, target, authority, freshness, and replay
 * before crossing the remote trust boundary into the caller-provided injector.
 */
export async function runDriveServe(
  flags: Record<string, string>,
  io: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    onListening?: (server: import("node:http").Server) => void;
  } = { stdout: process.stdout, stderr: process.stderr },
  options: RunDriveServeOptions = {}
): Promise<number> {
  if (!flags.to) {
    io.stderr.write("h2a drive serve: --to is required\n");
    return 1;
  }
  const inject = options.inject ?? (
    flags["inject-command"] ? commandDriveInjector(flags["inject-command"], io) : undefined
  );
  if (!inject) {
    io.stderr.write("h2a drive serve: --inject-command is required\n");
    return 1;
  }
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const host = flags.host ?? "127.0.0.1";
  const port = flags.port ? Number.parseInt(flags.port, 10) : 8788;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`h2a drive serve: invalid --port "${flags.port}"\n`);
    return 1;
  }
  let store;
  try {
    store = createLocalStore({ root });
  } catch (error) {
    io.stderr.write(`h2a drive serve: ${(error as Error).message}\n`);
    return 1;
  }
  const server = remoteDriveServerForStore(store, {
    to: flags.to,
    path: flags.path,
    inject
  });
  return await new Promise<number>((resolve) => {
    server.on("error", (err) => {
      io.stderr.write(`h2a drive serve: ${err.message}\n`);
      resolve(1);
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      io.stdout.write(
        `h2a drive serve: listening on http://${host}:${boundPort}${flags.path ?? "/h2a/drive"} (to ${flags.to}, root ${root})\n`
      );
      io.onListening?.(server);
    });
    server.on("close", () => resolve(0));
  });
}

/**
 * `h2a remote send` (DEC-077): sign an envelope and POST it to a remote h2a
 * endpoint. Async (network), so dispatched from bin.ts. Exit 0 on a 2xx,
 * 1 otherwise; prints `{ status, body }`.
 */
export async function runRemoteSend(
  flags: Record<string, string>,
  streams: H2ACliStreams = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  if (!flags.url || !flags.instance || !flags["private-key"] || !flags.json) {
    streams.stderr.write(
      "h2a remote send: --url, --instance, --private-key and --json are required\n"
    );
    return 1;
  }
  let envelope;
  try {
    envelope = JSON.parse(flags.json);
  } catch (error) {
    streams.stderr.write(`h2a remote send: invalid --json (${(error as Error).message})\n`);
    return 1;
  }
  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(flags["private-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a remote send: cannot read --private-key (${(error as Error).message})\n`
    );
    return 1;
  }
  let result;
  try {
    result = await sendRemoteEnvelope(flags.url, envelope, {
      by: flags.instance,
      privateKeyPem
    });
  } catch (error) {
    streams.stderr.write(`h2a remote send: ${(error as Error).message}\n`);
    return 1;
  }
  streams.stdout.write(`${JSON.stringify({ status: result.status, body: result.body }, null, 2)}\n`);
  return result.status >= 200 && result.status < 300 ? 0 : 1;
}

/**
 * Operator-enrolled key PEMs the mirror ingester trusts (EVO-13). Source order:
 * `--enrolled-keys-file` (JSON array of PEM strings), else `H2A_MIRROR_ENROLLED_KEYS`
 * (base64 of that JSON array — newline-safe for a k8s Secret env). Empty = refuse
 * every not-yet-registered signer (no TOFU on the wire).
 */
function loadEnrolledKeys(
  flags: Record<string, string>,
  env: NodeJS.ProcessEnv
): string[] {
  const raw = flags["enrolled-keys-file"]
    ? readFileSync(flags["enrolled-keys-file"], "utf8")
    : env.H2A_MIRROR_ENROLLED_KEYS
      ? Buffer.from(env.H2A_MIRROR_ENROLLED_KEYS, "base64").toString("utf8")
      : "[]";
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== "string")) {
    throw new Error("enrolled keys must be a JSON array of PEM strings");
  }
  return parsed;
}

/**
 * `h2a remote mirror-serve` (EVO-13 P1): long-running ingester that applies
 * signed instance mirrors to the store registry. Authority = an operator-enrolled
 * key or an already-registered key (never a self-declared id). Binds 127.0.0.1
 * unless `--host 0.0.0.0`. Async + blocking → dispatched from bin.ts.
 */
export async function runMirrorServe(
  flags: Record<string, string>,
  io: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    onListening?: (server: import("node:http").Server) => void;
  } = { stdout: process.stdout, stderr: process.stderr }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const host = flags.host ?? "127.0.0.1";
  const port = flags.port ? Number.parseInt(flags.port, 10) : 8788;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`h2a remote mirror-serve: invalid --port "${flags.port}"\n`);
    return 1;
  }
  let enrolledKeys: string[];
  try {
    enrolledKeys = loadEnrolledKeys(flags, process.env);
  } catch (error) {
    io.stderr.write(`h2a remote mirror-serve: ${(error as Error).message}\n`);
    return 1;
  }
  let store;
  try {
    store = createLocalStore({ root });
  } catch (error) {
    io.stderr.write(`h2a remote mirror-serve: ${(error as Error).message}\n`);
    return 1;
  }
  const server = mirrorServerForStore(store, { enrolledKeys, ...(flags.path ? { path: flags.path } : {}) });
  return await new Promise<number>((resolve) => {
    server.on("error", (err) => {
      io.stderr.write(`h2a remote mirror-serve: ${err.message}\n`);
      resolve(1);
    });
    server.listen(port, host, () => {
      io.stdout.write(
        `h2a remote mirror-serve: listening on http://${host}:${port}${flags.path ?? "/h2a/mirror"} (root ${root}, ${enrolledKeys.length} enrolled keys)\n`
      );
      io.onListening?.(server);
    });
    server.on("close", () => resolve(0));
  });
}

/**
 * `h2a remote mirror` (EVO-13 P1): build the local instance's own registration
 * mirror, sign it with `--private-key`, and POST it to a remote ingester `--url`.
 * Exit 0 on a 2xx. Async (network) → dispatched from bin.ts.
 *
 * ONE-SHOT BY DEFAULT. Passing `--interval-ms <n>` — and only that — opts into
 * the live daemon (feed-contract P1 step 4a): the identical build → sign → POST
 * cycle, repeated on a monotonic beat with overlap prevention, transient-error
 * backoff, and a hard stop on repeated 401/403 (re-enrollment required). With no
 * `--interval-ms` the code path below is byte-identical to the pre-daemon one.
 * The global kill-switch `H2A_MIRROR_PUSH_OFF` disables the daemon entirely.
 */
export async function runMirrorPush(
  flags: Record<string, string>,
  streams: H2ACliStreams = { stdout: process.stdout, stderr: process.stderr },
  signal?: AbortSignal,
  overrides: H2AMirrorPushOverrides = {}
): Promise<number> {
  // OPT-IN GATE, evaluated BEFORE any validation. The daemon exists only for a
  // caller that explicitly asked for an interval — and on that path the
  // kill-switch has to be the very first thing that runs, ahead even of the
  // required-flag presence check. Otherwise a HALF-EDITED unit (placeholders
  // partly replaced, a `--private-key <path>` pair accidentally dropped) exits 1
  // and lands in systemd `failed`, while the README promises a disarmed unit is
  // `inactive (dead)`. Mid-edit is exactly when that promise has to hold.
  if (flags["interval-ms"] !== undefined) {
    return runMirrorPushWatch(flags, streams, signal, overrides);
  }
  // `--interval-ms=20000` parses as the flag KEY `interval-ms=20000` (this CLI
  // takes `--flag value`, never `--flag=value`), so the opt-in above would miss
  // it and this would silently run as a one-shot. Fail loudly instead of
  // quietly doing something other than what was asked.
  const equalsForm = Object.keys(flags).find((k) => k.startsWith("interval-ms="));
  if (equalsForm) {
    streams.stderr.write(
      `h2a remote mirror: use "--interval-ms ${equalsForm.slice("interval-ms=".length)}", not "--${equalsForm}" (this CLI does not take --flag=value)\n`
    );
    return 1;
  }
  // --- one-shot, byte-identical to the pre-daemon path from here down ---
  if (!flags.url || !flags.instance || !flags["private-key"]) {
    streams.stderr.write("h2a remote mirror: --url, --instance and --private-key are required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  let envelope;
  try {
    envelope = buildInstanceMirror(createLocalStore({ root }), flags.instance, Date.now());
  } catch (error) {
    streams.stderr.write(`h2a remote mirror: ${(error as Error).message}\n`);
    return 1;
  }
  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(flags["private-key"], "utf8");
  } catch (error) {
    streams.stderr.write(`h2a remote mirror: cannot read --private-key (${(error as Error).message})\n`);
    return 1;
  }
  let result;
  try {
    result = await sendRemoteEnvelope(flags.url, envelope, { by: flags.instance, privateKeyPem });
  } catch (error) {
    streams.stderr.write(`h2a remote mirror: ${(error as Error).message}\n`);
    return 1;
  }
  streams.stdout.write(`${JSON.stringify({ status: result.status, body: result.body }, null, 2)}\n`);
  return result.status >= 200 && result.status < 300 ? 0 : 1;
}

/**
 * Timing/transport seams for the live mirror push, so an integration test can
 * exercise the real CLI wiring at millisecond speed instead of sleeping through
 * real backoffs. Same intent as `sendImpl` on the drumbeat relaunchers. Never set
 * by any production caller — `bin.ts` passes nothing.
 */
export type H2AMirrorPushOverrides = Pick<
  MirrorPushDaemonOptions,
  "sleep" | "random" | "backoffBaseMs" | "backoffMaxMs" | "authFailureLimit" | "sendImpl" | "now"
>;

/**
 * `h2a remote mirror --interval-ms <n>` (feed-contract P1 step 4a): the SAME
 * one-shot push, live. Reached only from {@link runMirrorPush} when the operator
 * passed an interval — never by default, never as a side effect.
 *
 * Emits one JSON status line per cycle on stdout (no key material, no request or
 * response body — see `MirrorPushCycleLog`). Exit 0 when it stops cleanly
 * (SIGTERM, `--max`, or the kill-switch), 1 when it stops because the endpoint
 * refuses this instance's key and re-enrollment is required.
 */
async function runMirrorPushWatch(
  flags: Record<string, string>,
  streams: H2ACliStreams,
  signal?: AbortSignal,
  overrides: H2AMirrorPushOverrides = {}
): Promise<number> {
  // KILL-SWITCH FIRST, before ANY validation and before ANY input is read. A
  // disabled daemon short-circuits without touching the filesystem and without
  // judging its own arguments — including whether the required ones are even
  // present. That is what makes the promise "a disarmed unit is inactive (dead),
  // not failed" true for a PARTIALLY edited unit, which is the state an operator
  // is actually in while replacing the placeholders.
  if (mirrorPushGloballyDisabled(process.env)) {
    streams.stderr.write(
      `h2a remote mirror: ${MIRROR_PUSH_OFF_ENV} is set — the live push is disabled, nothing was sent\n`
    );
    return 0;
  }
  // Armed: now the same required-flag contract as the one-shot applies.
  if (!flags.url || !flags.instance || !flags["private-key"]) {
    streams.stderr.write("h2a remote mirror: --url, --instance and --private-key are required\n");
    return 1;
  }
  const intervalMs = Number.parseInt(flags["interval-ms"] ?? "", 10);
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_MIRROR_PUSH_INTERVAL_MS) {
    streams.stderr.write(
      `h2a remote mirror: --interval-ms must be an integer >= ${MIN_MIRROR_PUSH_INTERVAL_MS} (got "${flags["interval-ms"]}")\n`
    );
    return 1;
  }
  const max = flags.max !== undefined ? Number.parseInt(flags.max, 10) : undefined;
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    streams.stderr.write(`h2a remote mirror: --max must be an integer >= 1 (got "${flags.max}")\n`);
    return 1;
  }
  // The one-shot POSTs once and surfaces the transport error; a daemon would
  // instead classify an unusable --url as a transient failure and retry it
  // forever (an unfilled placeholder or a typo would look "active (running)"
  // while pushing nothing). So the daemon form requires a usable http(s) URL
  // up front and fails fast, like the other pre-flight checks.
  // Emits the SAME text the library's `config-invalid` stop carries, so the
  // string an operator greps for in the journal is the one the docs document —
  // the CLI's fail-fast makes the library branch unreachable in practice, and
  // two different wordings for one condition would send them looking for a
  // message that never appears.
  if (!isPushableHttpUrl(flags.url as string)) {
    streams.stderr.write(
      `h2a remote mirror: ${MIRROR_PUSH_INVALID_URL_MESSAGE} (got "${flags.url}")\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  // The key is read ONCE, at start, and kept only in memory: a rotated key needs
  // a restart, which a re-enrollment needs anyway.
  let privateKeyPem: string;
  try {
    privateKeyPem = readFileSync(flags["private-key"] as string, "utf8");
  } catch (error) {
    streams.stderr.write(`h2a remote mirror: cannot read --private-key (${(error as Error).message})\n`);
    return 1;
  }
  streams.stderr.write(
    `h2a remote mirror: pushing instance ${flags.instance} to ${redactEndpoint(flags.url as string)} every ${intervalMs}ms (root ${root})\n`
  );
  const summary = await runMirrorPushDaemon({
    root,
    url: flags.url as string,
    instance: flags.instance as string,
    privateKeyPem,
    intervalMs,
    ...(max !== undefined ? { max } : {}),
    ...(signal ? { signal } : {}),
    ...overrides,
    onCycle: (line) => {
      streams.stdout.write(`${JSON.stringify(line)}\n`);
    }
  });
  // Every stop that needs a human act carries its own actionable message and
  // exits 1, so systemd's RestartPreventExitStatus=1 keeps it stopped instead of
  // restarting into the same wall.
  if (summary.message) {
    streams.stderr.write(`h2a remote mirror: ${summary.message}\n`);
    return 1;
  }
  streams.stderr.write(
    `h2a remote mirror: stopped (${summary.stopReason}) after ${summary.cycles} cycles, ${summary.ok} accepted\n`
  );
  return 0;
}

function parseLoopRepo(value: string): H2ALoopRepoRef {
  const [path, role] = value.split(":");
  if (!path) throw new Error("--repo must be <path[:role]>");
  return { path, ...(role ? { role } : {}) };
}

function parseLoopTrack(value: string): H2ALoopTrackRef {
  const ref = JSON.parse(value) as H2ALoopTrackRef;
  if (ref.system !== "track" || !ref.repoKey || !ref.workspace || !ref.aggregateKind || !ref.aggregateId || !ref.role) {
    throw new Error("--track must be a JSON TrackRef with system, repoKey, workspace, aggregateKind, aggregateId and role");
  }
  return ref;
}

function parseLoopAgent(value: string, index: number): H2ALoopAgent {
  const [host, role, placement] = value.split(":");
  if (!host || !role || !placement) throw new Error("--agent must be <host:role:placement>");
  if (!["claude", "codex", "agy", "gemini", "mistral", "hermes", "opencode", "shell"].includes(host)) {
    throw new Error(`--agent host is unsupported: ${host}`);
  }
  if (!["local", "remote", "auto", "headless-local", "headless-remote", "interactive-local", "interactive-remote"].includes(placement)) {
    throw new Error(`--agent placement is unsupported: ${placement}`);
  }
  return {
    id: `agent-${index + 1}`,
    host: host as H2ALoopAgent["host"],
    role,
    placement: placement as H2ALoopAgent["placement"],
    status: "planned"
  };
}

function collectRepeatedFlag(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    out.push(value);
    i++;
  }
  return out;
}

function parseLoopLaunch(raw: string): H2ALoopLaunchSpec {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--launch-stdin must contain valid JSON");
  }
  return validateLoopLaunchSpec(value);
}

function selectLoopAgent(loop: { agents: readonly H2ALoopAgent[] }, selector: string | undefined): H2ALoopAgent | undefined {
  if (!selector) return undefined;
  return loop.agents.find(
    (agent) => agent.id === selector || agent.role === selector || agent.host === selector || agent.remoteAgentId === selector || agent.h2aInstance === selector
  );
}

function cmdLoop(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  try {
    if (sub === "create") {
      const repos = collectRepeatedFlag(argv, "--repo").map(parseLoopRepo);
      const refs = collectRepeatedFlag(argv, "--track").map(parseLoopTrack);
      let agents = collectRepeatedFlag(argv, "--agent").map(parseLoopAgent);
      if (flags.launch) throw new Error("--launch is unsafe because prompts must not be passed in argv; use --launch-stdin");
      if (flags["launch-stdin"] === "true") {
        if (agents.length !== 1) throw new Error("--launch-stdin requires exactly one --agent on loop create");
        const launch = parseLoopLaunch(stdinText(streams) ?? "");
        if (agents[0].host !== launch.profile) throw new Error("--agent host must match --launch-stdin profile");
        agents = [{ ...agents[0], launch }];
      }
      const loop = createObjectiveLoop(root, {
        ...(flags.id ? { id: flags.id } : {}),
        name: flags.name,
        goal: flags.goal,
        repos,
        refs,
        agents,
        ...(flags["auto-tick"] === "true" ? { policy: { autoTick: true } } : {})
      });
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "enable-auto-tick") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop enable-auto-tick: <loopId> is required\n");
        return 1;
      }
      const loop = enableObjectiveLoopAutoTick(root, loopId);
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "list") {
      streams.stdout.write(`${JSON.stringify(listObjectiveLoops(root), null, 2)}\n`);
      return 0;
    }

    if (sub === "join") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--") || !flags.instance) {
        streams.stderr.write("h2a loop join: <loopId> and --instance <id> are required\n");
        return 1;
      }
      if (flags.launch) throw new Error("--launch is unsafe because prompts must not be passed in argv; use --launch-stdin");
      const launch = flags["launch-stdin"] === "true" ? parseLoopLaunch(stdinText(streams) ?? "") : undefined;
      const loop = joinObjectiveLoop(root, loopId, {
        instance: flags.instance,
        ...(flags["agent-id"] ? { agentId: flags["agent-id"] } : {}),
        ...(flags.role ? { role: flags.role } : {}),
        ...(flags.required ? { required: flags.required !== "false" } : {}),
        ...(launch !== undefined ? { launch } : {})
      });
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "report") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--") || !flags.note) {
        streams.stderr.write("h2a loop report: <loopId> and --note <text> are required\n");
        return 1;
      }
      const loop = reportObjectiveLoop(root, loopId, {
        ...(flags.instance ? { instance: flags.instance } : {}),
        ...(flags["agent-id"] ? { agentId: flags["agent-id"] } : {}),
        ...(flags["auto-join"] === "true" ? { autoJoin: true } : {}),
        note: flags.note
      });
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "done") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop done: <loopId> is required\n");
        return 1;
      }
      const overrideRefs = flags["override-refs"] === "true";
      if (overrideRefs && flags["confirm-human-override"] !== "true") {
        streams.stderr.write("h2a loop done: --override-refs requires --confirm-human-override\n");
        return 1;
      }
      const loop = declareObjectiveLoopDone(root, loopId, {
        ...(flags.instance ? { instance: flags.instance } : {}),
        ...(flags["agent-id"] ? { agentId: flags["agent-id"] } : {}),
        ...(flags.note ? { note: flags.note } : {}),
        ...(overrideRefs ? { overrideRefs: true, human: true } : {})
      });
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "stop") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop stop: <loopId> is required\n");
        return 1;
      }
      const loop = stopObjectiveLoop(root, loopId, { ...(flags.reason ? { reason: flags.reason } : {}) });
      streams.stdout.write(`${JSON.stringify(loop, null, 2)}\n`);
      return 0;
    }

    if (sub === "status") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop status: <loopId> is required\n");
        return 1;
      }
      streams.stdout.write(`${JSON.stringify(readObjectiveLoop(root, loopId), null, 2)}\n`);
      return 0;
    }

    if (sub === "agents") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop agents: <loopId> is required\n");
        return 1;
      }
      streams.stdout.write(`${JSON.stringify(readObjectiveLoop(root, loopId).agents, null, 2)}\n`);
      return 0;
    }

    if (sub === "attach") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--") || !flags.agent) {
        streams.stderr.write("h2a loop attach: <loopId> and --agent <selector> are required\n");
        return 1;
      }
      const loop = readObjectiveLoop(root, loopId);
      const agent = selectLoopAgent(loop, flags.agent);
      if (!agent) throw new Error(`agent not found: ${flags.agent}`);
      streams.stdout.write(`${JSON.stringify({ ok: true, loopId, agent, action: "attach", supported: false, reason: "remote attach delegation is not implemented in h2a loop MVP" }, null, 2)}\n`);
      return 0;
    }

    if (sub === "logs") {
      const loopId = argv[1];
      if (!loopId || loopId.startsWith("--")) {
        streams.stderr.write("h2a loop logs: <loopId> is required\n");
        return 1;
      }
      const loop = readObjectiveLoop(root, loopId);
      const agent = selectLoopAgent(loop, flags.agent);
      streams.stdout.write(`${JSON.stringify({ loopId, ...(agent ? { agent } : {}), events: listLoopEvents(root, loopId) }, null, 2)}\n`);
      return 0;
    }

    // `tick` / `watch` are ASYNC (lazy runtime + periodic loop) → dispatched in
    // bin.ts via `runLoopEngineCli`, not here (cmdLoop is synchronous).
  } catch (error) {
    streams.stderr.write(`h2a loop ${sub ?? ""}: ${(error as Error).message}\n`);
    return classifyStoreError((error as Error).message);
  }

  streams.stderr.write("h2a loop: subcommand required (create, enable-auto-tick, join, report, done, stop, list, status, agents, attach, logs, tick, watch/run, supervise)\n");
  return 1;
}

/**
 * Async dispatcher for `h2a loop tick|watch` (SLICE-1: dry-run only — produces a
 * plan via the pure core + lazy adapters, executes nothing). Called from bin.ts
 * because these are async (lazy runtime import + periodic loop). `argv` is the
 * full bin argv: `["loop", "tick"|"watch", "<loopId>", ...flags]`.
 */
export async function runLoopEngineCli(
  argv: readonly string[],
  streams: H2ACliStreams,
  signal?: AbortSignal
): Promise<number> {
  const sub = argv[1];
  const loopId = argv[2];
  const { flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  // `supervise` is root-wide (all opted-in loops) — it takes NO loopId, so it is
  // handled before the per-loop guard below. This is the durable supervisor the
  // systemd --user unit runs; it ticks each auto-tick loop under its executor
  // lease every beat. Opt-in + kill-switch (H2A_LOOP_AUTOTICK_OFF) gate it.
  if (sub === "supervise") {
    const intervalMs = flags["interval-ms"] ? Number(flags["interval-ms"]) : undefined;
    const max = flags.max ? Number(flags.max) : undefined;
    try {
      await runLoopSupervisor(root, {
        ...(intervalMs !== undefined && Number.isFinite(intervalMs) ? { intervalMs } : {}),
        ...(max !== undefined && Number.isFinite(max) ? { max } : {}),
        ...(signal ? { signal } : {}),
        onBeat: (s) => {
          streams.stdout.write(`${JSON.stringify(s)}\n`);
        }
      });
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a loop supervise: ${(error as Error).message}\n`);
      return classifyStoreError((error as Error).message);
    }
  }

  if (!loopId || loopId.startsWith("--")) {
    streams.stderr.write(`h2a loop ${sub}: <loopId> is required\n`);
    return 1;
  }

  try {
    if (sub === "watch" || sub === "run") {
      const intervalMs = flags["interval-ms"] ? Number(flags["interval-ms"]) : undefined;
      const max = flags.max ? Number(flags.max) : undefined;
      return await runLoopWatch(root, loopId, {
        ...(intervalMs !== undefined && Number.isFinite(intervalMs) ? { intervalMs } : {}),
        ...(max !== undefined && Number.isFinite(max) ? { max } : {}),
        execute: !argv.includes("--dry-run"),
        ...(signal ? { signal } : {}),
        stdout: streams.stdout
      });
    }
    // tick — DRY-RUN by default; `--execute` runs the plan (tranche 1: close only).
    const execute = argv.includes("--execute");
    const { plan, exec } = await runTick(root, loopId, { execute });
    const out = exec ? { ...plan, exec } : plan;
    streams.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return plan.outcome === "failed" ? 1 : 0;
  } catch (error) {
    streams.stderr.write(`h2a loop ${sub}: ${(error as Error).message}\n`);
    return classifyStoreError((error as Error).message);
  }
}

// Canevas ③ — read-only tranche-1 : agrège les décisions humaines en attente
// (enveloppes `escalate` des inbox des instances live) en un JSON stable. La vue
// session (capturePane runtime lazy), le serveur Hono et le pont-réponse
// (reply-envelope gardé) sont des tranches ultérieures.
function cmdCanevas(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "list") {
    try {
      const decisions = gatherPendingDecisions(root);
      streams.stdout.write(
        `${JSON.stringify({ kind: "canevas-decisions", version: 1, decisions }, null, 2)}\n`
      );
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a canevas list: ${(error as Error).message}\n`);
      return classifyStoreError((error as Error).message);
    }
  }

  streams.stderr.write("h2a canevas: subcommand required (list, serve)\n");
  return 1;
}

// Façade harness (Slice A — the "one-CLI" endgame). `h2a` stays a
// LIB (never absorbed): a pure, zero-runtime-dep driver (no git, no fs writes, no
// process.exit) whose single `out` sink carries usage, JSON artifacts AND errors.
// We run it IN-PROCESS via the package's public `runHarnessCli` (same shape as
// track's `runCli`), but under the `harness` NAMESPACE (`h2a harness <verb>`)
// because the harness verbs `init` and `branch` collide with existing h2a/track
// first-words — a flat merge (like track's) would clobber them. `runHarnessCli`
// is SYNCHRONOUS (returns a `number`), so this dispatches like `cmdLoop`/
// `cmdCanevas`, not async via bin.ts. `argv` here is everything AFTER `harness`.
function cmdHarness(argv: readonly string[], streams: H2ACliStreams): number {
  // harness emits lines WITHOUT a trailing newline (its own bin appends "\n"); we
  // do the same so `h2a harness …` is byte-identical to the standalone `harness`.
  const out = (s: string): void => {
    streams.stdout.write(`${s}\n`);
  };
  try {
    const rc = runHarnessCli([...argv], out);
    // Defensive: the pinned harness is synchronous (`runHarnessCli(...): number`).
    // A Promise cannot be awaited on this sync path, so surface it rather than
    // leak a thenable as an exit code (unreachable for the shipped 0.3.0).
    if (
      rc !== null &&
      typeof rc === "object" &&
      typeof (rc as { then?: unknown }).then === "function"
    ) {
      streams.stderr.write(
        "h2a harness: h2a vendored harness returned a Promise (async) — unsupported in the sync facade.\n"
      );
      return 1;
    }
    return rc as number;
  } catch (err) {
    streams.stderr.write(`h2a harness: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * Async dispatcher for `h2a canevas serve` (read-only Hono server on 127.0.0.1).
 * Called from bin.ts (async + long-running). `argv` = full bin argv.
 */
export async function runCanevasServeCli(
  argv: readonly string[],
  streams: H2ACliStreams,
  signal?: AbortSignal
): Promise<number> {
  const { flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const port = flags.port ? Number(flags.port) : undefined;
  return runCanevasServe({
    root,
    ...(port !== undefined && Number.isFinite(port) ? { port } : {}),
    stderr: streams.stderr,
    ...(signal ? { signal } : {})
  });
}

function cmdDrumbeat(argv: readonly string[], streams: H2ACliStreams): number {
  // DEC-086 (D2): durable anti-stall registry — record stops, scan candidates,
  // clear. The long-running `watch` daemon is async (dispatched from bin.ts).
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "record") {
    if (!flags.instance || !flags.status) {
      streams.stderr.write("h2a drumbeat record: --instance <id> and --status <work-status> are required\n");
      return 1;
    }
    if (!(H2A_WORK_STATUSES as readonly string[]).includes(flags.status)) {
      streams.stderr.write(
        `h2a drumbeat record: --status must be one of ${H2A_WORK_STATUSES.join("|")} (got "${flags.status}")\n`
      );
      return 1;
    }
    const launchContext = flags.command
      ? {
          cwd: flags.cwd ?? cwd(),
          command: flags.command,
          ...(flags["resume-command"] ? { resumeCommand: flags["resume-command"] } : {}),
          ...(flags.tty ? { tty: flags.tty } : {}),
          ...(flags["tmux-session"] && flags["tmux-pane"]
            ? { tmux: { session: flags["tmux-session"], pane: flags["tmux-pane"], ...(flags["tmux-window"] ? { window: flags["tmux-window"] } : {}) } }
            : {})
        }
      : undefined;
    const entry = recordStop(root, {
      instance: flags.instance,
      workStatus: flags.status as (typeof H2A_WORK_STATUSES)[number],
      ...(launchContext ? { launchContext } : {})
    });
    streams.stdout.write(`${JSON.stringify({ ok: true, instance: entry.instance, workStatus: entry.workStatus }, null, 2)}\n`);
    return 0;
  }

  if (sub === "scan") {
    const maxRelances = flags["max-relances"] ? Number.parseInt(flags["max-relances"], 10) : undefined;
    const result = scanDrumbeat(root, maxRelances !== undefined ? { maxRelances } : {});
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (sub === "clear") {
    if (!flags.instance) {
      streams.stderr.write("h2a drumbeat clear: --instance <id> is required\n");
      return 1;
    }
    clearDrumbeatEntry(root, flags.instance);
    // DEC-095 (D7): a clean resume/finish also clears any open escalation.
    clearEscalation(root, flags.instance);
    streams.stdout.write(`${JSON.stringify({ ok: true, instance: flags.instance, cleared: true }, null, 2)}\n`);
    return 0;
  }

  if (sub === "escalations") {
    // DEC-095 (D7): the open escalations the daemon raised on relance-exhaustion.
    streams.stdout.write(`${JSON.stringify(listEscalations(root), null, 2)}\n`);
    return 0;
  }

  streams.stderr.write("h2a drumbeat: subcommand required (record, scan, clear, escalations, watch)\n");
  return 1;
}

/**
 * `h2a blockage` (DEC-092, EVO-3): the peer-facing blockage feedback loop —
 * distinct from the drumbeat (silent stall) and escalation (→ authority). Raise
 * a blockage so peers in scope are notified (`peer.blocked` push); resolve it
 * when unblocked (`peer.unblocked`).
 */
function cmdBlockage(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  if (sub === "raise") {
    if (!flags.instance || !flags.reason) {
      streams.stderr.write("h2a blockage raise: --instance <id> and --reason <text> are required\n");
      return 1;
    }
    const blockage = raiseBlockage(root, {
      instance: flags.instance,
      scope: flags.scope ?? "",
      reason: flags.reason,
      ...(flags.needs ? { needs: flags.needs } : {})
    });
    streams.stdout.write(`${JSON.stringify({ ok: true, ...blockage }, null, 2)}\n`);
    return 0;
  }

  if (sub === "list") {
    let blockages = listBlockages(root);
    // EVO-3 (DEC-110): one-shot poll digest for daemonless hosts (e.g. agy) —
    // `--instance <id>` returns only blockages in scopes that instance is a
    // member of, per the effective org view (registration ∪ provisioned grants).
    // A daemonless agent can poll a single command instead of one per scope.
    if (flags.instance) {
      const store = createLocalStore({ root });
      const effective = effectiveOrgInstances(store.listInstances(), store.listOrgMembership());
      const mine = effective.find((e) => e.instance === flags.instance);
      const scopes = new Set(mine?.scopes ?? []);
      blockages = blockages.filter((b) => scopes.has(b.scope));
    }
    if (flags.scope) blockages = blockages.filter((b) => b.scope === flags.scope);
    if (flags.active !== undefined) blockages = blockages.filter((b) => b.resolvedAt === undefined);
    streams.stdout.write(`${JSON.stringify(blockages, null, 2)}\n`);
    return 0;
  }

  if (sub === "resolve") {
    if (!flags.instance) {
      streams.stderr.write("h2a blockage resolve: --instance <id> is required\n");
      return 1;
    }
    const resolved = resolveBlockage(root, flags.instance, flags.by ? { by: flags.by } : {});
    if (!resolved) {
      streams.stderr.write(`h2a blockage resolve: no blockage recorded for "${flags.instance}"\n`);
      return 2;
    }
    streams.stdout.write(`${JSON.stringify({ ok: true, ...resolved }, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(`h2a blockage: unknown subcommand "${sub ?? ""}" (raise, list, resolve)\n`);
  return 1;
}

/** Resolve `--file` (default `org.h2a.yaml` in cwd) and read its text, or report an I/O error. */
function readOrgSource(
  flags: Record<string, string>,
  cwd: () => string,
  streams: H2ACliStreams,
  verb: string
): string | undefined {
  const file = flags.file
    ? resolvePath(cwd(), flags.file)
    : join(cwd(), H2A_ORG_MANIFEST_FILENAME);
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    streams.stderr.write(`${verb}: cannot read ${file}: ${code ?? (error as Error).message}\n`);
    return undefined;
  }
}

/**
 * `--deliver` for `coach propose`/`ratify`: drop the (un)signed org envelope into
 * each declared instance's inbox so affected agents actually receive it and can
 * have their say (counter) — closing the propose→counter→ratify loop over the
 * existing mailbox primitives. The envelope itself stays the stdout payload;
 * delivery is reported on stderr so the `resource` contract is preserved.
 */
function deliverOrgEnvelope(
  flags: Record<string, string>,
  cwd: () => string,
  streams: H2ACliStreams,
  manifest: { instances: ReadonlyArray<{ instance: string }> },
  envelope: Parameters<ReturnType<typeof createLocalStore>["putInboxMessage"]>[1],
  verb: string
): void {
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  const delivered: string[] = [];
  for (const inst of manifest.instances) {
    try {
      store.putInboxMessage(inst.instance, envelope);
      delivered.push(inst.instance);
    } catch (error) {
      streams.stderr.write(`${verb}: deliver to ${inst.instance} failed: ${(error as Error).message}\n`);
    }
  }
  streams.stderr.write(
    `${verb}: delivered to ${delivered.length} inbox(es)${delivered.length ? `: ${delivered.join(", ")}` : ""}\n`
  );
}

/**
 * `h2a org` (EVO-7 slice 2, DEC-109): read-only tooling over the committed org
 * manifest (`org.h2a.yaml`). `validate` parses + checks the h2a invariants;
 * `show` prints the normalized manifest with its validation result. The coach's
 * propose/ratify lifecycle is `h2a coach`; live provisioning is a later slice.
 */
export function cmdOrg(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());

  if (sub === "validate" || sub === "show") {
    const source = readOrgSource(flags, cwd, streams, `h2a org ${sub}`);
    if (source === undefined) return 3;
    const parsed = parseOrgManifest(source);
    if (!parsed.manifest) {
      streams.stdout.write(`${JSON.stringify({ ok: false, errors: parsed.errors }, null, 2)}\n`);
      return 1;
    }
    const validation = validateOrgManifest(parsed.manifest);
    if (sub === "validate") {
      streams.stdout.write(
        `${JSON.stringify({ ok: validation.ok, errors: validation.errors }, null, 2)}\n`
      );
      return validation.ok ? 0 : 1;
    }
    const m = parsed.manifest;
    streams.stdout.write(
      `${JSON.stringify(
        {
          scope: m.scope,
          ...(m.version !== undefined ? { version: m.version } : {}),
          instances: m.instances,
          ...(m.commEdges !== undefined ? { commEdges: m.commEdges } : {}),
          validation
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  if (sub === "diff") {
    const source = readOrgSource(flags, cwd, streams, "h2a org diff");
    if (source === undefined) return 3;
    const parsed = parseOrgManifest(source);
    if (!parsed.manifest) {
      streams.stderr.write(`h2a org diff: ${parsed.errors.join("; ")}\n`);
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const effective = effectiveOrgInstances(store.listInstances(), store.listOrgMembership());
    const diff = diffOrgManifest(parsed.manifest, effective);
    streams.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
    return 0;
  }

  if (sub === "provision") {
    const source = readOrgSource(flags, cwd, streams, "h2a org provision");
    if (source === undefined) return 3;
    const parsed = parseOrgManifest(source);
    if (!parsed.manifest) {
      streams.stderr.write(`h2a org provision: ${parsed.errors.join("; ")}\n`);
      return 1;
    }
    const validation = validateOrgManifest(parsed.manifest);
    if (!validation.ok) {
      streams.stderr.write(
        `h2a org provision: refusing to provision an invalid org (${validation.errors.join(", ")})\n`
      );
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const at = new Date().toISOString();
    const applied: Array<{ instance: string; role: string; grantedScopes: string[] }> = [];
    const unchanged: string[] = [];
    const pending: Array<{ instance: string; reason: string }> = [];

    for (const inst of parsed.manifest.instances) {
      // Re-derive the effective view each iteration so repeated declared
      // instances and prior grants this run are reflected (idempotent).
      const eff = effectiveOrgInstances(store.listInstances(), store.listOrgMembership());
      const reg = eff.find((e) => e.instance === inst.instance);
      if (!reg) {
        pending.push({ instance: inst.instance, reason: "not registered (needs key + register)" });
        continue;
      }
      const roleMissing = !reg.roles.includes(inst.role);
      const missingScopes = inst.scopes.filter((s) => !reg.scopes.includes(s));
      const scopesToGrant = roleMissing ? [...new Set(inst.scopes)] : missingScopes;
      if (scopesToGrant.length === 0) {
        unchanged.push(inst.instance);
        continue;
      }
      for (const scope of scopesToGrant) {
        store.grantOrgMembership({
          instance: inst.instance,
          role: inst.role,
          scope,
          ...(flags.by ? { by: flags.by } : {}),
          at
        });
      }
      applied.push({ instance: inst.instance, role: inst.role, grantedScopes: scopesToGrant });
    }

    streams.stdout.write(
      `${JSON.stringify(
        { ok: true, scope: parsed.manifest.scope, applied, unchanged, pending },
        null,
        2
      )}\n`
    );
    return 0;
  }

  streams.stderr.write(
    `h2a org: unknown subcommand "${sub ?? ""}" (validate, show, diff, provision)\n`
  );
  return 1;
}

/**
 * `h2a coach` (EVO-7 slice 2, DEC-109): the coach **proposes, does not impose**.
 * `propose` emits the *unsigned* `org-proposal` envelope for a validated
 * manifest, signed (later) by the coach (a CONDUCTOR); affected agents may
 * counter and the owning PRINCIPAL then ratifies. Read-only here — signing,
 * persistence and provisioning are later slices.
 */
export function cmdCoach(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());

  if (sub === "propose") {
    if (!flags.as) {
      streams.stderr.write("h2a coach propose: --as <coach-instance> is required\n");
      return 1;
    }
    const roleStr = flags.role ?? "CONDUCTOR";
    if (!(H2A_ROLES as readonly string[]).includes(roleStr)) {
      streams.stderr.write(
        `h2a coach propose: --role must be one of ${H2A_ROLES.join(", ")} (got "${flags.role}")\n`
      );
      return 1;
    }
    const source = readOrgSource(flags, cwd, streams, "h2a coach propose");
    if (source === undefined) return 3;
    const parsed = parseOrgManifest(source);
    if (!parsed.manifest) {
      streams.stderr.write(`h2a coach propose: ${parsed.errors.join("; ")}\n`);
      return 1;
    }
    const validation = validateOrgManifest(parsed.manifest);
    if (!validation.ok) {
      streams.stderr.write(
        `h2a coach propose: refusing to propose an invalid org (${validation.errors.join(", ")})\n`
      );
      return 1;
    }
    const envelope = orgAssignmentEnvelope({
      manifest: parsed.manifest,
      actor: {
        instance: flags.as,
        role: roleStr as H2ARole,
        scope: flags.scope ?? parsed.manifest.scope
      },
      kind: H2A_ORG_PROPOSAL_BODY_KIND
    });
    if (flags.deliver !== undefined) {
      deliverOrgEnvelope(flags, cwd, streams, parsed.manifest, envelope, "h2a coach propose");
    }
    streams.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return 0;
  }

  if (sub === "ratify") {
    if (!flags.as || !flags["private-key"]) {
      streams.stderr.write(
        "h2a coach ratify: --as <principal-instance> and --private-key <pem-file> are required\n"
      );
      return 1;
    }
    const roleStr = flags.role ?? "PRINCIPAL";
    if (!(H2A_ROLES as readonly string[]).includes(roleStr)) {
      streams.stderr.write(
        `h2a coach ratify: --role must be one of ${H2A_ROLES.join(", ")} (got "${flags.role}")\n`
      );
      return 1;
    }
    let privateKeyPem: string;
    try {
      privateKeyPem = readFileSync(flags["private-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a coach ratify: cannot read --private-key (${(error as Error).message})\n`
      );
      return 1;
    }
    const source = readOrgSource(flags, cwd, streams, "h2a coach ratify");
    if (source === undefined) return 3;
    const parsed = parseOrgManifest(source);
    if (!parsed.manifest) {
      streams.stderr.write(`h2a coach ratify: ${parsed.errors.join("; ")}\n`);
      return 1;
    }
    const validation = validateOrgManifest(parsed.manifest);
    if (!validation.ok) {
      streams.stderr.write(
        `h2a coach ratify: refusing to ratify an invalid org (${validation.errors.join(", ")})\n`
      );
      return 1;
    }
    const envelope = orgAssignmentEnvelope({
      manifest: parsed.manifest,
      actor: {
        instance: flags.as,
        role: roleStr as H2ARole,
        scope: flags.scope ?? parsed.manifest.scope
      },
      kind: H2A_ORG_RATIFIED_BODY_KIND
    });
    const signed = signEnvelope(envelope, { by: flags.as, privateKeyPem });
    if (flags.deliver !== undefined) {
      deliverOrgEnvelope(flags, cwd, streams, parsed.manifest, signed, "h2a coach ratify");
    }
    streams.stdout.write(`${JSON.stringify(signed, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(`h2a coach: unknown subcommand "${sub ?? ""}" (propose, ratify)\n`);
  return 1;
}

/**
 * `h2a nhi` (DEC-087): Non-Human-Identity posture over the local registry. P1
 * ships `report` — derive the OWASP NHI Top 10 / NIST CSF posture from
 * instances, subagent bindings and the keyring. See evaluations/nhi.md.
 */
function cmdNhi(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  const cwd = streams.cwd ?? (() => process.cwd());

  if (sub === "report") {
    let longLivedKeyMaxDays: number | undefined;
    if (flags["long-lived-days"] !== undefined) {
      longLivedKeyMaxDays = Number.parseInt(flags["long-lived-days"], 10);
      if (!Number.isInteger(longLivedKeyMaxDays) || longLivedKeyMaxDays < 1) {
        streams.stderr.write(
          `h2a nhi report: --long-lived-days must be a positive integer (got "${flags["long-lived-days"]}")\n`
        );
        return 1;
      }
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({
      instances,
      subagents,
      keyEvents,
      ...(longLivedKeyMaxDays !== undefined ? { longLivedKeyMaxDays } : {})
    });
    streams.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  if (sub === "inventory") {
    let longLivedKeyMaxDays: number | undefined;
    if (flags["long-lived-days"] !== undefined) {
      longLivedKeyMaxDays = Number.parseInt(flags["long-lived-days"], 10);
      if (!Number.isInteger(longLivedKeyMaxDays) || longLivedKeyMaxDays < 1) {
        streams.stderr.write(
          `h2a nhi inventory: --long-lived-days must be a positive integer (got "${flags["long-lived-days"]}")\n`
        );
        return 1;
      }
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const { instances, subagents, keyEvents, offboards } = gatherNhiSnapshot(store);
    const inventory = nhiInventory({
      instances,
      subagents,
      keyEvents,
      offboards,
      ...(longLivedKeyMaxDays !== undefined ? { longLivedKeyMaxDays } : {})
    });
    streams.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    return 0;
  }

  if (sub === "export") {
    if (!flags.instance || !flags["trust-domain"]) {
      streams.stderr.write(
        "h2a nhi export: --instance <id> and --trust-domain <domain> are required\n"
      );
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const activeKeys = store.listInstanceKeys(flags.instance);
    try {
      const bundle = nhiTrustBundle({
        instance: flags.instance,
        trustDomain: flags["trust-domain"],
        activeKeys
      });
      streams.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a nhi export: ${(error as Error).message}\n`);
      return 1;
    }
  }

  if (sub === "attest") {
    if (!flags.instance || !flags["private-key"]) {
      streams.stderr.write(
        "h2a nhi attest: --instance <id> and --private-key <pem-file> are required\n"
      );
      return 1;
    }
    let privateKeyPem: string;
    try {
      privateKeyPem = readFileSync(flags["private-key"], "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a nhi attest: cannot read --private-key (${(error as Error).message})\n`
      );
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    const registration = store.findInstance(flags.instance);
    const role = flags.role ?? registration?.roles?.[0];
    const scope = flags.scope ?? registration?.scopes?.[0];
    if (!role || !scope) {
      streams.stderr.write(
        `h2a nhi attest: cannot resolve actor for "${flags.instance}" — register it first, or pass --role and --scope\n`
      );
      return 2;
    }
    if (!(H2A_ROLES as readonly string[]).includes(role)) {
      streams.stderr.write(
        `h2a nhi attest: --role must be one of ${H2A_ROLES.join("|")} (got "${role}")\n`
      );
      return 1;
    }
    const { instances, subagents, keyEvents } = gatherNhiSnapshot(store);
    const report = auditNhiPosture({ instances, subagents, keyEvents });
    const envelope = nhiAttestationEnvelope({
      report,
      actor: { instance: flags.instance, role: role as H2ARole, scope }
    });
    const signed = signEnvelope(envelope, { by: flags.instance, privateKeyPem });
    streams.stdout.write(`${JSON.stringify(signed, null, 2)}\n`);
    return 0;
  }

  if (sub === "offboard") {
    if (!flags.instance) {
      streams.stderr.write("h2a nhi offboard: --instance <id> is required\n");
      return 1;
    }
    const store = createLocalStore({ root: resolveRoot(flags, cwd) });
    let tombstone;
    try {
      tombstone = store.offboardInstance(flags.instance, flags.reason);
    } catch (error) {
      const message = (error as Error).message;
      streams.stderr.write(`h2a nhi offboard: ${message}\n`);
      return classifyStoreError(message);
    }
    streams.stdout.write(`${JSON.stringify({ ok: true, ...tombstone }, null, 2)}\n`);
    return 0;
  }

  streams.stderr.write(
    `h2a nhi: unknown subcommand "${sub ?? ""}" (report, inventory, attest, offboard, export)\n`
  );
  return 1;
}

/**
 * Build the local relauncher used when consuming D4 resume envelopes on the
 * receiving host. `auto` here is intentionally local-only: resume envelopes
 * must not be re-relayed.
 */
function buildLocalInboxRelauncher(
  kind: H2ARelauncherKind | undefined,
  log: (line: string) => void
): H2ARelauncher {
  switch (kind) {
    case "local-tmux":
      return localTmuxRelauncher({ log });
    case "headless":
      return headlessRelauncher({ log });
    case "logging":
      return loggingRelauncher(log);
    case "remote":
    case "auto":
    case undefined:
      return chainRelauncher(localTmuxRelauncher({ log }), headlessRelauncher({ log }));
  }
}

function resolveRemoteActor(
  root: string,
  flags: Record<string, string>
): H2AActorRef | string {
  if (!flags.instance || !flags["private-key"]) {
    return "--instance and --private-key are required for --relauncher remote|auto";
  }
  const store = createLocalStore({ root });
  const registration = store.findInstance(flags.instance);
  // The actor role here is only metadata stamped on the signed resume envelope.
  // The receiving host re-derives its own `launchContext` and never grants the
  // sender authority from this role, so the `AGENTS` default cannot widen any
  // privilege — it is the safe least-authority fallback (DEC-117).
  const role = flags.role ?? registration?.roles?.[0] ?? "AGENTS";
  const scope = flags.scope ?? registration?.scopes?.[0] ?? "scope:default";
  if (!(H2A_ROLES as readonly string[]).includes(role)) {
    return `--role must be one of ${H2A_ROLES.join("|")} (got "${role}")`;
  }
  return { instance: flags.instance, role: role as H2ARole, scope };
}

function readPrivateKeyFlag(label: string, flags: Record<string, string>): string | Error {
  try {
    return readFileSync(flags["private-key"], "utf8");
  } catch (error) {
    return new Error(`${label}: cannot read --private-key (${(error as Error).message})`);
  }
}

function latestLaunchContext(root: string, instance: string): H2ALaunchContext | undefined {
  return listPresence(root)
    .filter((session) => session.instance === instance && session.launchContext)
    .sort((a, b) => Date.parse(b.heartbeatAt) - Date.parse(a.heartbeatAt))[0]?.launchContext;
}

function buildDriveDriver(kind: H2ADriverKind, log: (line: string) => void): H2ADriver {
  switch (kind) {
    case "logging":
      return loggingDriver(log);
    case "native":
      return nativeBackchannelDriver();
    case "local-tmux":
      return localTmuxDriver({ log });
    case "headless":
      return headlessDriver({ log });
    case "auto":
      return {
        drive(request) {
          for (const driver of [
            nativeBackchannelDriver(),
            localTmuxDriver({ log }),
            headlessDriver({ log })
          ]) {
            const result = driver.drive(request);
            if (result === true) return true;
          }
          return false;
        }
      };
  }
}

function driveReplayGuard(root: string): H2AReplayGuard {
  const dir = join(root, "drive-replay");
  return {
    accept(envelope: H2AEnvelope, now = Date.now()) {
      const freshness = checkEnvelopeFreshness(envelope, { now });
      if (!freshness.ok) return freshness;
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${safePathSegment(envelope.id)}.json`);
      try {
        writeFileSync(
          file,
          `${JSON.stringify({ id: envelope.id, createdAt: envelope.createdAt })}\n`,
          { encoding: "utf8", flag: "wx" }
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          return { ok: false, reason: "replayed" as const };
        }
        throw error;
      }
      return { ok: true };
    },
    size() {
      try {
        return readdirSync(dir).filter((entry) => entry.endsWith(".json")).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
    }
  };
}

function cmdDrive(flags: Record<string, string>, streams: H2ACliStreams): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  if (!flags.from || !flags.to || !flags.instruction || !flags["private-key"]) {
    streams.stderr.write(
      "h2a drive: --from, --to, --instruction and --private-key are required\n"
    );
    return 1;
  }
  const kind = (flags.driver ?? "auto") as H2ADriverKind;
  if (!["logging", "native", "local-tmux", "headless", "auto"].includes(kind)) {
    streams.stderr.write(
      `h2a drive: --driver must be one of logging|native|local-tmux|headless|auto (got "${flags.driver}")\n`
    );
    return 1;
  }
  const privateKeyPem = readPrivateKeyFlag("h2a drive", flags);
  if (privateKeyPem instanceof Error) {
    streams.stderr.write(`${privateKeyPem.message}\n`);
    return 1;
  }
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  const auth = authorizeDrive(store, { from: flags.from, to: flags.to });
  if (!auth.ok) {
    streams.stderr.write(`h2a drive: ${auth.reason} (${flags.from} -> ${flags.to})\n`);
    return 2;
  }

  const instructionLine = formatSignedDriveInstruction({
    from: flags.from,
    to: flags.to,
    instruction: flags.instruction,
    privateKeyPem,
    nonce: flags.nonce,
    at: flags.at
  });
  const log = (line: string): void => void streams.stderr.write(`${line}\n`);
  const driver = buildDriveDriver(kind, log);
  const result = driver.drive({
    to: flags.to,
    host: flags.host ?? flags.to.split(":", 1)[0],
    instructionLine,
    launchContext: latestLaunchContext(root, flags.to)
  });
  if (typeof (result as Promise<boolean>)?.then === "function") {
    streams.stderr.write("h2a drive: async driver unavailable in synchronous CLI path\n");
    return 1;
  }
  const driven = result === true;
  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        from: flags.from,
        to: flags.to,
        driver: kind,
        driven,
        instructionLine
      },
      null,
      2
    )}\n`
  );
  return driven ? 0 : 2;
}

function stdinText(streams: H2ACliStreams): string | undefined {
  if (typeof streams.stdinText === "function") return streams.stdinText();
  return streams.stdinText ?? readFileSync(0, "utf8");
}

function driveLineFromStdin(raw: string): string {
  return driveLineFromHookInput(raw) ?? "";
}

function cmdDriveReceive(flags: Record<string, string>, streams: H2ACliStreams): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const line = flags.line ?? (flags.stdin ? driveLineFromStdin(stdinText(streams) ?? "") : undefined);
  if (!flags.to) {
    streams.stderr.write("h2a drive receive: --to is required\n");
    return 1;
  }
  if (!line) {
    if (flags["ignore-non-drive"]) {
      streams.stdout.write(
        `${JSON.stringify({ ok: true, ignored: true, reason: "non-drive" }, null, 2)}\n`
      );
      return 0;
    }
    streams.stderr.write("h2a drive receive: --line or --stdin is required\n");
    return 1;
  }
  if (flags["ignore-non-drive"] && !line.trim().startsWith("[h2a ")) {
    streams.stdout.write(
      `${JSON.stringify({ ok: true, ignored: true, reason: "non-drive" }, null, 2)}\n`
    );
    return 0;
  }
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  const now = flags.now ? Number.parseInt(flags.now, 10) : undefined;
  if (flags.now && Number.isNaN(now)) {
    streams.stderr.write(
      `h2a drive receive: --now must be a millisecond timestamp (got "${flags.now}")\n`
    );
    return 1;
  }
  let result: ReturnType<typeof verifyDriveOnReceive>;
  try {
    result = verifyDriveOnReceive(store, line, {
      to: flags.to,
      guard: driveReplayGuard(root),
      ...(now !== undefined ? { now } : {})
    });
  } catch (error) {
    streams.stderr.write(`h2a drive receive: ${(error as Error).message}\n`);
    return 3;
  }
  if (!result.ok) {
    streams.stderr.write(`h2a drive receive: ${result.reason}\n`);
    return 2;
  }
  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

export async function runDrumbeatRelanceInbox(
  flags: Record<string, string>,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd?: () => string } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const kind = (flags.relauncher ?? "auto") as H2ARelauncherKind;
  if (!["logging", "local-tmux", "headless", "auto"].includes(kind)) {
    io.stderr.write(
      `h2a drumbeat relance-inbox: --relauncher must be one of logging|local-tmux|headless|auto (got "${flags.relauncher}")\n`
    );
    return 1;
  }
  const log = (line: string): void => void io.stdout.write(`${line}\n`);
  const result = await relanceFromInbox(root, {
    ...(flags.instance ? { instances: [flags.instance] } : {}),
    relauncher: buildLocalInboxRelauncher(kind, log)
  });
  io.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  return 0;
}

/**
 * D4 resume messages can only act on a durable, non-terminal stop record.
 * Keeping this projection bounded prevents one huge historical registry from
 * starving every drumbeat tick before its anti-stall scan runs.
 */
export function drumbeatResumeInboxTargets(
  entries: readonly Pick<H2ADrumbeatEntry, "instance" | "workStatus" | "terminal">[]
): string[] {
  return entries
    .filter((entry) => entry.workStatus !== "done" && entry.terminal === undefined)
    .map((entry) => entry.instance);
}

/**
 * `h2a drumbeat watch` (DEC-086): long-running anti-stall daemon. Async +
 * blocking, dispatched from bin.ts like mcp-serve. Uses the logging relauncher
 * by default; concrete relaunchers (local-tmux / remote) land in D3/D4.
 */
export async function runDrumbeatWatch(
  flags: Record<string, string>,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd?: () => string; signal?: AbortSignal } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = io.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const intervalMs = flags["interval-ms"] ? Number.parseInt(flags["interval-ms"], 10) : 30_000;
  const maxRelances = flags["max-relances"] ? Number.parseInt(flags["max-relances"], 10) : undefined;
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    io.stderr.write(`h2a drumbeat watch: --interval-ms must be >= 1000 (got "${flags["interval-ms"]}")\n`);
    return 1;
  }
  const kind = (flags.relauncher ?? "logging") as H2ARelauncherKind;
  const log = (line: string): void => void io.stdout.write(`${line}\n`);
  let relauncher: H2ARelauncher;
  let remoteActor: H2AActorRef | undefined;
  let remotePrivateKeyPem: string | undefined;
  if (kind === "remote" || kind === "auto") {
    const actor = resolveRemoteActor(root, flags);
    if (typeof actor === "string") {
      io.stderr.write(`h2a drumbeat watch: ${actor}\n`);
      return 1;
    }
    const pem = readPrivateKeyFlag("h2a drumbeat watch", flags);
    if (pem instanceof Error) {
      io.stderr.write(`${pem.message}\n`);
      return 1;
    }
    remoteActor = actor;
    remotePrivateKeyPem = pem;
  }
  // DEC-091/117: select the relauncher adapter. `auto` = local-tmux, then the
  // D4 remote relay, then headless fallback; `logging` stays the dry-run default.
  switch (kind) {
    case "local-tmux":
      relauncher = localTmuxRelauncher({ log });
      break;
    case "headless":
      relauncher = headlessRelauncher({ log });
      break;
    case "remote":
      relauncher = remoteRelauncher({
        root,
        actor: remoteActor!,
        privateKeyPem: remotePrivateKeyPem!,
        log
      });
      break;
    case "auto":
      relauncher = chainRelauncher(
        localTmuxRelauncher({ log }),
        remoteRelauncher({
          root,
          actor: remoteActor!,
          privateKeyPem: remotePrivateKeyPem!,
          log
        }),
        headlessRelauncher({ log })
      );
      break;
    case "logging":
      relauncher = loggingRelauncher(log);
      break;
    default:
      io.stderr.write(
        `h2a drumbeat watch: --relauncher must be one of logging|local-tmux|remote|headless|auto (got "${flags.relauncher}")\n`
      );
      return 1;
  }
  // DEC-111 (D5): the reflexive watchdog. Opt-in via --decider; consulted only
  // after --decider-after relances; decisions applied only with --decider-enforce.
  const deciderAfter = flags["decider-after"] ? Number.parseInt(flags["decider-after"], 10) : 1;
  if (!Number.isInteger(deciderAfter) || deciderAfter < 1) {
    io.stderr.write(`h2a drumbeat watch: --decider-after must be a positive integer (got "${flags["decider-after"]}")\n`);
    return 1;
  }
  const enforce = flags["decider-enforce"] !== undefined;
  let decider: ReflexiveDecider | undefined;
  let deciderLabel = "logging";
  if (flags.decider !== undefined && flags.decider !== "logging") {
    decider = subagentDecider({ command: flags.decider });
    deciderLabel = "subagent";
  } else if (flags.decider === "logging") {
    decider = loggingDecider();
  }
  const effectiveMax = maxRelances ?? H2A_DEFAULT_MAX_RELANCES;
  if (decider && deciderAfter >= effectiveMax) {
    io.stderr.write(
      `h2a drumbeat watch: --decider-after (${deciderAfter}) must be < --max-relances (${effectiveMax})\n`
    );
    return 1;
  }

  io.stdout.write(
    `h2a drumbeat watch: watching ${root} every ${intervalMs}ms (relauncher=${kind}, decider=${deciderLabel}${decider ? `, enforce=${enforce}` : ""})\n`
  );
  await runDrumbeatWatchLoop(root, relauncher, {
    intervalMs,
    ...(maxRelances !== undefined ? { maxRelances } : {}),
    signal: io.signal,
    // Gov D2/D4: pass the drumbeat runner's own identity so conductor-ownership
    // and cross-workspace CoI checks are active.  `--instance` is required for
    // the remote relauncher (the signer); when present it is also the self-id
    // for governance.  Without it the checks are silently skipped (default-allow).
    root,
    ...(flags.instance !== undefined ? { selfInstance: flags.instance } : {}),
    log,
    beforeScan: async () => {
      // A D4 `drumbeat.resume` is actionable only for an already-recorded,
      // non-terminal stop entry.  Scanning every registered instance here was
      // O(registry × inbox) on every beat: a shared bus with tens of thousands
      // of historical identities never reached its anti-stall scan at all.
      // Restrict the inbox pass to the bounded stop registry; messages for an
      // actor without a stop entry cannot be safely relanced and remain in its
      // inbox for ordinary handling instead of starving the watchdog.
      const resumeTargets = drumbeatResumeInboxTargets(listDrumbeat(root));
      const result = await relanceFromInbox(root, {
        instances: resumeTargets,
        relauncher: buildLocalInboxRelauncher(kind, log)
      });
      if (result.relanced.length || result.skipped.length) {
        io.stdout.write(
          `drumbeat inbox: relanced=[${result.relanced.join(",")}] skipped=${result.skipped.length}\n`
        );
      }
      return result.relanced;
    },
    ...(decider ? { decider, deciderAfter, enforce, deciderLabel } : {}),
    // DEC-095 (D7): an exhausted relance budget stops the loop for that agent
    // and escalates to the PRINCIPAL (the anti-loop cap is `maxRelances`).
    onExhausted: (entry) => {
      const record = recordEscalation(root, {
        instance: entry.instance,
        reason: "relance-exhausted",
        relanceCount: entry.relanceCount
      });
      io.stdout.write(
        `drumbeat: ESCALATE ${record.instance} → ${record.to} (${record.channel}, relances=${record.relanceCount})\n`
      );
    },
    // DEC-111 (D5): the decider's escalate/reroute verdicts route through the
    // same escalation registry (reroute = escalate-with-hint in v1).
    onEscalate: (finding, decision) => {
      recordEscalation(root, {
        instance: finding.instance,
        reason: "watchdog-escalate",
        relanceCount: finding.relanceCount
      });
      io.stdout.write(`drumbeat: WATCHDOG-ESCALATE ${finding.instance}${decision.reason ? ` — ${decision.reason}` : ""}\n`);
    },
    onReroute: (finding, decision) => {
      recordEscalation(root, {
        instance: finding.instance,
        reason: "reroute-suggested",
        relanceCount: finding.relanceCount
      });
      io.stdout.write(`drumbeat: REROUTE-SUGGESTED ${finding.instance}${decision.reason ? ` — ${decision.reason}` : ""}\n`);
    },
    onTick: (r) => {
      if (r.relanced.length || r.exhausted.length) {
        io.stdout.write(`drumbeat tick: relanced=[${r.relanced.join(",")}] exhausted=[${r.exhausted.join(",")}]\n`);
      }
    }
  });
  return 0;
}

/**
 * `h2a sysml verify` (DEC-099, S3): verify an envelope's embedded SysML ref —
 * commit-trust (signature) by default; add `--content-integrity` to re-fetch +
 * re-hash the element (network). Async → dispatched from bin.ts like remote.
 */
export async function runSysmlVerify(
  flags: Record<string, string>,
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; cwd?: () => string } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  if (!flags.json || !flags["public-key"]) {
    io.stderr.write("h2a sysml verify: --json <envelope> and --public-key <pem-file> are required\n");
    return 1;
  }
  let envelope: Parameters<typeof verifyEnvelopeSysmlRef>[0];
  try {
    envelope = JSON.parse(flags.json) as Parameters<typeof verifyEnvelopeSysmlRef>[0];
  } catch (error) {
    io.stderr.write(`h2a sysml verify: --json is not valid JSON (${(error as Error).message})\n`);
    return 1;
  }
  let publicKeyPem: string;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    io.stderr.write(`h2a sysml verify: cannot read --public-key (${(error as Error).message})\n`);
    return 1;
  }
  const result = await verifyEnvelopeSysmlRef(envelope, {
    publicKeyPem,
    ...(flags.by ? { by: flags.by } : {}),
    ...(flags["content-integrity"] ? { contentIntegrity: true } : {}),
    ...(flags["api-base"] ? { apiBase: flags["api-base"] } : {}),
    ...(flags.auth ? { auth: flags.auth } : {})
  });
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // Verification failure is a state/business outcome → exit 2 (DEC-034).
  return result.ok ? 0 : 2;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function configsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A host must not keep a second, standalone Track MCP beside its h2a endpoint. */
function isStandaloneTrackMcpServer(_name: string, config: unknown): boolean {
  // Names are not identity: `track-metrics`, for example, may be a third-party
  // server. Remove only a server whose executable/arguments prove it is the
  // legacy standalone Sentropic Track MCP.
  if (!isPlainObject(config)) return false;
  const values = [config.command, ...(Array.isArray(config.args) ? config.args : [])];
  return values.some(
    (value) =>
      typeof value === "string" &&
      (value === "track-mcp" ||
        /[\\/]track-mcp(?:\.cmd|\.exe)?$/i.test(value) ||
        /@sentropic[\\/]track[\\/].*[\\/]mcp[\\/]/i.test(value))
  );
}

/** A host config may contain only one h2a MCP, even if an old installer named it differently. */
function isH2aMcpServer(name: string, config: unknown): boolean {
  if (/^h2a(?:[-_.]|$)/i.test(name)) return true;
  if (!isPlainObject(config)) return false;
  const command = config.command;
  const args = Array.isArray(config.args) ? config.args : [];
  return (
    typeof command === "string" &&
    (command === "h2a" || /[\\/]h2a(?:\.cmd|\.exe)?$/i.test(command)) &&
    args.some((arg) => arg === "mcp-serve")
  );
}

/** Native YAML/JSONC parsers are intentionally not guessed by the JSON writer. */
function isUnsupportedHostWritePath(host: string, path: string): boolean {
  const normalized = path.toLowerCase();
  // The JSON merger is deliberately format-strict. Never reinterpret a native
  // TOML/YAML/JSONC file as JSON, even with --force: preserving unrelated MCP
  // configuration is stronger than a convenient write path.
  return (
    (host === "codex" && normalized.endsWith(".toml")) ||
    (host === "hermes" && (normalized.endsWith(".yaml") || normalized.endsWith(".yml"))) ||
    (host === "opencode" && normalized.endsWith(".jsonc"))
  );
}

function driveLineFromText(text: string): string | undefined {
  const matchingLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("[h2a "));
  return matchingLine ?? (text.trim() ? text.trim() : undefined);
}

function hookPromptText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = hookPromptText(item);
      if (text) return text;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  for (const key of ["prompt", "line", "message", "text", "input"]) {
    const text = hookPromptText(value[key]);
    if (text) return text;
  }
  if (isPlainObject(value.params)) {
    const text = hookPromptText(value.params);
    if (text) return text;
  }
  return undefined;
}

function driveLineFromHookInput(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    const promptText = hookPromptText(parsed);
    if (promptText) return driveLineFromText(promptText);
  } catch {
    // Non-JSON hook payloads may already be the prompt text.
  }
  return driveLineFromText(raw);
}

function cmdHostSetup(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const host = flags.host;
  if (!host) {
    streams.stderr.write(
      "h2a host setup: --host <codex|claude|gemini|agy|hermes|opencode> is required\n"
    );
    return 1;
  }
  const requestedEndpoint = flags.endpoint ?? "local";
  if (requestedEndpoint !== "local" && requestedEndpoint !== "remote") {
    streams.stderr.write(
      'h2a host setup: --endpoint must be "local" or "remote".\n'
    );
    return 1;
  }
  const endpoint: "local" | "remote" = requestedEndpoint;
  if (endpoint === "remote") {
    if (!flags.url) {
      streams.stderr.write(
        "h2a host setup: --endpoint remote requires --url <http(s)://…>.\n"
      );
      return 1;
    }
    try {
      const url = new URL(flags.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("protocol");
      }
    } catch {
      streams.stderr.write(
        "h2a host setup: --url must be an absolute http(s) MCP endpoint.\n"
      );
      return 1;
    }
    if (flags.root || flags["no-wake"] === "true") {
      streams.stderr.write(
        "h2a host setup: --root and --no-wake apply only to --endpoint local.\n"
      );
      return 1;
    }
  } else if (flags.url) {
    streams.stderr.write(
      "h2a host setup: --url requires --endpoint remote.\n"
    );
    return 1;
  }

  // The local stdio endpoint joins the bus, stays current, and is wakeable.
  // A remote endpoint owns those concerns itself, so the rendered config is a
  // URL only; local and remote fields are never mixed.
  const wakeEnabled = endpoint === "local" && flags["no-wake"] !== "true";
  const serveArgs = [
    "mcp-serve",
    "--auto-open",
    "--host",
    host,
    "--auto-upgrade",
    ...(wakeEnabled ? ["--wake", "local-tmux"] : [])
  ];
  if (endpoint === "local" && !wakeEnabled) {
    streams.stderr.write(
      "h2a host setup: WARNING --no-wake — this agent will NOT be woken on inbox arrival; coordination is degraded (peers' messages wait until you manually run /h2a receive).\n"
    );
  }
  const renderOpts =
    endpoint === "remote"
      ? { endpoint, url: flags.url }
      : {
          endpoint,
          ...(flags.root ? { root: flags.root } : {}),
          args: serveArgs
        };
  let snippet;
  if (host === "codex") {
    snippet = H2A_CODEX_HOST.renderMcpConfig(renderOpts);
  } else if (host === "claude") {
    snippet = H2A_CLAUDE_HOST.renderMcpConfig(renderOpts);
  } else if (host === "gemini") {
    snippet = H2A_GEMINI_HOST.renderMcpConfig(renderOpts);
  } else if (host === "agy") {
    snippet = H2A_AGY_HOST.renderMcpConfig(renderOpts);
  } else if (host === "hermes") {
    snippet = H2A_HERMES_HOST.renderMcpConfig(renderOpts);
  } else if (host === "opencode") {
    snippet = H2A_OPENCODE_HOST.renderMcpConfig(renderOpts);
  } else {
    streams.stderr.write(
      `h2a host setup: unknown --host "${host}". Supported: ${CLI_HOSTS.map((h) => h.host).join(", ")}.\n`
    );
    return 1;
  }

  const targetPath = flags.write;
  const printMode = flags.print === "true" || !targetPath;

  if (printMode && !targetPath) {
    streams.stdout.write(`${JSON.stringify(snippet.config, null, 2)}\n`);
    streams.stderr.write(
      `# ${host} — selected ${endpoint} h2a endpoint; paste this snippet under \`mcpServers\` in:\n# ${snippet.path.hint}\n# example path: ${snippet.path.example}\n`
    );
    return 0;
  }

  if (isUnsupportedHostWritePath(host, targetPath)) {
    streams.stderr.write(
      `h2a host setup: --write supports JSON only and will not rewrite ${targetPath.endsWith(".toml") ? "TOML" : targetPath.endsWith(".jsonc") ? "JSONC" : "YAML"} config. Use --print and the host-native editor/CLI.\n`
    );
    return 1;
  }

  // --write path: merge into the target file.
  let existing: Record<string, unknown> = {};
  if (existsSync(targetPath)) {
    let raw;
    try {
      raw = readFileSync(targetPath, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a host setup: cannot read ${targetPath} (${(error as Error).message})\n`
      );
      // File/OS error — exit code 3 per DEC-034.
      return 3;
    }
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          streams.stderr.write(
            `h2a host setup: ${targetPath} is valid JSON but not a JSON object; refusing to merge.\n`
          );
          // Pre-existing on-disk state we refuse to overwrite — state conflict.
          return 2;
        }
        existing = parsed;
      } catch (error) {
        streams.stderr.write(
          `h2a host setup: ${targetPath} is not valid JSON (${(error as Error).message}). Use --force to overwrite intentionally.\n`
        );
        if (flags.force !== "true") {
          // Pre-existing malformed file refused without --force — state conflict.
          return 2;
        }
        existing = {};
      }
    }
  }

  if (existing.mcpServers !== undefined && !isPlainObject(existing.mcpServers)) {
    streams.stderr.write(
      `h2a host setup: ${targetPath} has a non-object mcpServers value; refusing to replace it.\n`
    );
    return 2;
  }
  const existingMcpServers = isPlainObject(existing.mcpServers)
    ? existing.mcpServers
    : {};
  const incoming = snippet.config.mcpServers.h2a;
  const existingH2aMcpServers = Object.keys(existingMcpServers).filter((name) =>
    isH2aMcpServer(name, existingMcpServers[name])
  );
  const previous = existingMcpServers.h2a;
  const replacedH2a =
    existingH2aMcpServers.length > 0 &&
    (existingH2aMcpServers.some((name) => name !== "h2a") || !configsEqual(previous, incoming));
  const removedH2aMcpServers = existingH2aMcpServers.filter((name) => name !== "h2a");
  const removedTrackMcpServers = Object.keys(existingMcpServers).filter(
    (name) => !isH2aMcpServer(name, existingMcpServers[name]) && isStandaloneTrackMcpServer(name, existingMcpServers[name])
  );
  const retainedMcpServers = Object.fromEntries(
    Object.entries(existingMcpServers).filter(
      ([name, config]) =>
        !isH2aMcpServer(name, config) && !removedTrackMcpServers.includes(name)
    )
  );

  const merged: Record<string, unknown> = {
    ...existing,
    mcpServers: {
      ...retainedMcpServers,
      h2a: incoming
    }
  };

  try {
    const dir = dirname(targetPath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (error) {
    streams.stderr.write(
      `h2a host setup: cannot write ${targetPath} (${(error as Error).message})\n`
    );
    // File/OS error — exit code 3 per DEC-034.
    return 3;
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        host,
        endpoint,
        path: targetPath,
        merged: true,
        replacedH2a,
        removedH2aMcpServers,
        removedTrackMcpServers
      },
      null,
      2
    )}\n`
  );
  streams.stderr.write(
    `# wrote the selected ${endpoint} mcpServers.h2a endpoint for host=${host} to ${targetPath}\n# disabled duplicate h2a MCP entries: ${removedH2aMcpServers.join(", ") || "none"}\n# disabled standalone Track MCP entries: ${removedTrackMcpServers.join(", ") || "none"}\n# ${snippet.path.hint}\n`
  );
  return 0;
}

function cmdHostStatus(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const filter = flags.host;
  let selection: readonly (typeof CLI_HOSTS)[number][] = CLI_HOSTS;
  if (filter) {
    const match = CLI_HOSTS.find((h) => h.host === filter);
    if (!match) {
      streams.stderr.write(
        `h2a host status: unknown --host "${filter}". Supported: ${CLI_HOSTS.map(
          (h) => h.host
        ).join(", ")}.\n`
      );
      return 1;
    }
    selection = [match];
  }

  const hosts = selection.map((descriptor) => {
    const mcpAdapterShipped = true; // both stdio + in-process MCP back every host
    const hostSetupShipped =
      typeof descriptor.renderMcpConfig === "function";
    const hostScenarioShipped = descriptor.hostScenarioShipped === true;
    const summary =
      descriptor.wave === 1 && hostSetupShipped && hostScenarioShipped
        ? `wave 1 — host setup + MCP scenario shipped; MCP adapter (stdio + local) wired`
        : descriptor.wave === 1 && hostSetupShipped
          ? `wave 1 — host setup snippet shipped; MCP adapter (stdio + local) wired`
        : descriptor.wave === 2
          ? `wave 2 — descriptor only (DEC-028 defers full enablement)`
          : `wave 1 — MCP adapter wired but no setup snippet`;
    return {
      host: descriptor.host,
      wave: descriptor.wave,
      mcpAdapterShipped,
      hostSetupShipped,
      hostScenarioShipped,
      summary
    };
  });

  streams.stdout.write(
    `${JSON.stringify({ ok: true, hosts }, null, 2)}\n`
  );
  return 0;
}

/**
 * `h2a host plugin` (DEC-093, D6): render the per-host stop-hook command + where
 * it goes, so a stop is recorded with a launch context the drumbeat/D3 can
 * relance. Mirrors `host setup` (h2a renders, the host runtime places it).
 */
function cmdHostPlugin(flags: Record<string, string>, streams: H2ACliStreams): number {
  if (!flags.host) {
    streams.stderr.write(
      `h2a host plugin: --host <${H2A_HOST_PLUGIN_HOSTS.join("|")}> is required\n`
    );
    return 1;
  }
  if (!flags.instance) {
    streams.stderr.write("h2a host plugin: --instance <id> is required\n");
    return 1;
  }
  const render = renderStopHook(flags.host, {
    instance: flags.instance,
    ...(flags.root ? { root: flags.root } : {}),
    ...(flags.status ? { status: flags.status } : {})
  });
  if (!render) {
    streams.stderr.write(
      `h2a host plugin: unknown --host "${flags.host}". Supported: ${H2A_HOST_PLUGIN_HOSTS.join(", ")}.\n`
    );
    return 1;
  }

  // DEC-113 (D6 done): --scaffold <dir> writes codex's FULL local marketplace —
  // verified live, codex installs a plugin only from a marketplace dir, NOT a
  // bare plugin dir. Layout mirrors codex's own openai-curated marketplace:
  //   <dir>/.agents/plugins/marketplace.json          (marketplace manifest)
  //   <dir>/plugins/<name>/.codex-plugin/plugin.json  (plugin manifest)
  //   <dir>/plugins/<name>/hooks/hooks.json           (Claude-format Stop hook)
  // then emits the trust step (codex plugin marketplace add → plugin add).
  // codex-only: the manifests are codex-specific (claude/gemini merge a single
  // settings.json via --write; agy polls).
  if (flags.scaffold) {
    if (flags.host !== "codex") {
      streams.stderr.write(
        `h2a host plugin: --scaffold is codex-only (the marketplace/plugin manifests are codex-specific). ` +
          `For ${flags.host}, use --write <settings.json> (claude/gemini) or the poll path (agy).\n`
      );
      return 1;
    }
    const marketplaceDir = flags.scaffold;
    const pluginDir = join(marketplaceDir, "plugins", H2A_CODEX_PLUGIN_NAME);
    const hooksPath = join(pluginDir, "hooks", "hooks.json");
    const manifestPath = join(pluginDir, ".codex-plugin", "plugin.json");
    const marketplacePath = join(marketplaceDir, ".agents", "plugins", "marketplace.json");
    // The hooks.json is the same idempotent Claude-format merge as --write.
    const hooksMerge = mergeStopHooksFile(
      hooksPath,
      render.record,
      render.receive,
      flags.force === "true",
      streams
    );
    if (typeof hooksMerge === "number") return hooksMerge;
    // Manifests are stable identities — rewriting them is idempotent (same bytes).
    const writes: ReadonlyArray<readonly [string, unknown]> = [
      [manifestPath, codexPluginManifest(H2A_CODEX_PLUGIN_NAME)],
      [marketplacePath, codexMarketplaceManifest(H2A_CODEX_PLUGIN_NAME)]
    ];
    for (const [path, body] of writes) {
      try {
        const d = dirname(path);
        if (!existsSync(d)) mkdirSync(d, { recursive: true });
        writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
      } catch (error) {
        streams.stderr.write(`h2a host plugin: cannot write ${path} (${(error as Error).message})\n`);
        return 3;
      }
    }
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          host: "codex",
          scaffolded: marketplaceDir,
          marketplace: marketplacePath,
          manifest: manifestPath,
          hooks: hooksPath,
          mechanism: render.mechanism,
          hook: "hooks.Stop + hooks.UserPromptSubmit",
          // The trust step is surfaced, not silently dropped: codex cannot be
          // auto-trusted from outside, so run these to load the plugin.
          trust: codexPluginTrustCommands(marketplaceDir, H2A_CODEX_PLUGIN_NAME)
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  // DEC-102/103/104 (D6 slice b): --write installs the Claude-format `hooks.Stop`
  // entry for the three hosts that accept it — **claude** + **gemini** (single
  // settings.json; gemini via `gemini hooks migrate --from-claude`) and **codex**
  // (its plugin `hooks.json` uses the identical Claude-format hooks object;
  // verified against `~/.codex/.../hooks/hooks.json`). agy is poll-only (no
  // daemon), so --write is refused for it and the rendered hook + hint surface.
  if (flags.write) {
    if (flags.host === "agy") {
      streams.stderr.write(
        `h2a host plugin: --write is not available for agy (poll-only, no daemon). ` +
          `Use the poll path: ${render.poll}\n`
      );
      return 1;
    }
    const targetPath = flags.write;
    const merge = mergeStopHooksFile(
      targetPath,
      render.record,
      render.receive,
      flags.force === "true",
      streams
    );
    if (typeof merge === "number") return merge;
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          host: flags.host,
          written: targetPath,
          mechanism: render.mechanism,
          hook: "hooks.Stop + hooks.UserPromptSubmit",
          // codex loads hooks via a plugin (manifest → ./hooks/hooks.json); the
          // file written above is a valid codex hooks.json, but codex still
          // needs the manifest + trust. `--scaffold <dir>` does the full job;
          // this hint covers the manual wrap when only the hooks.json is wanted.
          ...(flags.host === "codex"
            ? {
                pluginHint:
                  "this is a codex hooks.json — run `h2a host plugin --host codex --scaffold <dir>` " +
                  "to also write the .codex-plugin/plugin.json manifest + emit the trust step " +
                  "(codex plugin marketplace add <dir> → codex plugin add <name>@<marketplace>)."
              }
            : {})
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  streams.stdout.write(`${JSON.stringify(render, null, 2)}\n`);
  return 0;
}

/**
 * Idempotently merge the h2a drumbeat-record `Stop` hook and the drive receive
 * `UserPromptSubmit` gate into a Claude-format hooks file (claude/gemini
 * `settings.json` or a codex `hooks.json`). Drops prior h2a hooks, appends the
 * freshly-rendered ones, and preserves unrelated keys/hooks. Returns an exit
 * code on failure, or `undefined` on success.
 * DEC-102/103/104; reused by `--scaffold` (DEC-113).
 */
function mergeStopHooksFile(
  targetPath: string,
  record: string,
  receive: string,
  force: boolean,
  streams: H2ACliStreams
): number | undefined {
  let existing: Record<string, unknown> = {};
  if (existsSync(targetPath)) {
    let raw: string;
    try {
      raw = readFileSync(targetPath, "utf8");
    } catch (error) {
      streams.stderr.write(`h2a host plugin: cannot read ${targetPath} (${(error as Error).message})\n`);
      return 3;
    }
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
          streams.stderr.write(`h2a host plugin: ${targetPath} is valid JSON but not an object; refusing to merge.\n`);
          return 2;
        }
        existing = parsed;
      } catch (error) {
        streams.stderr.write(
          `h2a host plugin: ${targetPath} is not valid JSON (${(error as Error).message}). Use --force to overwrite.\n`
        );
        if (!force) return 2;
        existing = {};
      }
    }
  }
  const existingHooks = isPlainObject(existing.hooks) ? existing.hooks : {};
  const existingStop = Array.isArray(existingHooks.Stop) ? [...existingHooks.Stop] : [];
  const existingUserPromptSubmit = Array.isArray(existingHooks.UserPromptSubmit)
    ? [...existingHooks.UserPromptSubmit]
    : [];
  // Idempotent: drop any prior h2a drumbeat-record Stop hook, then append ours.
  const withoutH2A = existingStop.filter((e) => !isH2ARecordHook(e));
  const mergedStop = [...withoutH2A, claudeStopHookEntry(record)];
  const withoutDriveReceive = existingUserPromptSubmit.filter(
    (e) => !isH2ADriveReceiveHook(e)
  );
  const mergedUserPromptSubmit = [
    ...withoutDriveReceive,
    claudeDriveReceiveHookEntry(receive)
  ];
  const merged: Record<string, unknown> = {
    ...existing,
    hooks: {
      ...existingHooks,
      Stop: mergedStop,
      UserPromptSubmit: mergedUserPromptSubmit
    }
  };
  try {
    const dir = dirname(targetPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`);
  } catch (error) {
    streams.stderr.write(`h2a host plugin: cannot write ${targetPath} (${(error as Error).message})\n`);
    return 3;
  }
  return undefined;
}

function cmdHost(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  if (sub === "setup") return cmdHostSetup(flags, streams);
  if (sub === "status") return cmdHostStatus(flags, streams);
  if (sub === "plugin") return cmdHostPlugin(flags, streams);
  streams.stderr.write(`Unknown host subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write(
    "Use: h2a host setup --host <codex|claude|gemini|agy|hermes|opencode> ...\n" +
      "     h2a host status [--host <name>]\n" +
      "     h2a host plugin --host <codex|claude|gemini|agy|hermes|opencode> --instance <id>\n"
  );
  return 1;
}

function cmdStoreMigrate(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const from = flags.from ?? H2A_STORE_SCHEMA_VERSION;
  const to = flags.to ?? H2A_STORE_SCHEMA_VERSION;
  const dryRun = flags["dry-run"] === "true";

  // DEC-064: opt-in within-version maintenance pass. Renames pre-DEC-062
  // store entries with `:` (or other forbidden chars) in their names to the
  // safePathSegment form, so a store created by <=0.1.23 works on Windows and
  // is consistent on every OS. Does not touch the schema version.
  if (flags["sanitize-paths"] === "true") {
    const result = sanitizeStorePaths(root, { dryRun });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // Conflicts (target already exists) are a state issue → exit 2.
    return result.ok ? 0 : 2;
  }

  const KNOWN_VERSIONS: readonly string[] = [H2A_STORE_SCHEMA_VERSION];
  if (!KNOWN_VERSIONS.includes(from)) {
    streams.stderr.write(
      `h2a store migrate: unknown --from version "${from}". Known versions: ${KNOWN_VERSIONS.join(",")}\n`
    );
    return 1;
  }
  if (!KNOWN_VERSIONS.includes(to)) {
    streams.stderr.write(
      `h2a store migrate: unknown --to version "${to}". Known versions: ${KNOWN_VERSIONS.join(",")}\n`
    );
    return 1;
  }

  // V1 → V1: no-op. Future bumps will branch here.
  if (from === H2A_STORE_SCHEMA_VERSION && to === H2A_STORE_SCHEMA_VERSION) {
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          fromVersion: from,
          toVersion: to,
          changed: false,
          dryRun,
          root
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  // Unreachable today (only one known version) — kept for future ramps.
  streams.stderr.write(
    `h2a store migrate: no migration registered for ${from} → ${to}\n`
  );
  return 1;
}

function cmdStore(argv: readonly string[], streams: H2ACliStreams): number {
  const { command: sub, flags } = parseFlags(argv);
  if (sub === "migrate") return cmdStoreMigrate(flags, streams);
  streams.stderr.write(`Unknown store subcommand: ${sub ?? "<none>"}\n`);
  streams.stderr.write("Use: h2a store migrate [--from <v>] [--to <v>] [--dry-run] [--root <path>]\n");
  return 1;
}

function cmdDiscover(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const store = createLocalStore({ root });
  let entries = store.listInstances();
  // DEC-110: filter by the EFFECTIVE org view (registration scopes/roles ∪
  // provisioned membership grants), so a `provision`-granted scope actually
  // gates discovery at runtime. Output stays the raw registration (grants only
  // widen the match set, never narrow it).
  const effective = effectiveOrgInstances(entries, store.listOrgMembership());
  const effByInstance = new Map(effective.map((e) => [e.instance, e]));
  if (flags.role) {
    const role = flags.role;
    entries = entries.filter((entry) => effByInstance.get(entry.instance)?.roles.includes(role));
  }
  if (flags.scope) {
    const scope = flags.scope;
    entries = entries.filter((entry) => effByInstance.get(entry.instance)?.scopes.includes(scope));
  }

  // `--live` (WP-C/WP-F): the answer to "which of these can I actually reach
  // RIGHT NOW?" — the full registry is the perennial ledger (every past
  // conversation mints an id, so it grows to hundreds and drowns the live ones).
  // Filter to instances with a fresh presence session and annotate each with
  // its connection-confidence (active = MCP channel carried traffic recently;
  // idle-uncertain = process alive but channel silent — possibly a false-live;
  // unknown = legacy/mirrored presence with no activity stamp). Compact output
  // (no public keys) so the reachable id is obvious. Heartbeat-fresh ≠ reachable.
  if (flags.live !== undefined) {
    const now = Date.now();
    // PRESENCE-FIRST: liveness lives in the presence files, not the registry.
    // An agent can hold a fresh presence on this bus without a registration here
    // (it registered on a forked repo-local bus — the split-brain that strands
    // mail). Enumerate live sessions and annotate from the registry where known,
    // so a presence-but-unregistered peer still surfaces as reachable.
    const sessions = listPresence(root);
    const regByInstance = new Map(entries.map((e) => [e.instance, e]));
    const byInstance = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const arr = byInstance.get(s.instance) ?? [];
      arr.push(s);
      byInstance.set(s.instance, arr);
    }
    const rank = { active: 0, "idle-uncertain": 1, unknown: 2 } as const;
    const live = Array.from(byInstance.entries())
      .map(([instance, ss]) => {
        const reg = regByInstance.get(instance);
        const eff = effByInstance.get(instance);
        // Best (most-reachable) confidence across this instance's sessions.
        let best: "active" | "idle-uncertain" | "unknown" = "unknown";
        let freshestActivity: string | undefined;
        let name: string | undefined = reg?.name;
        for (const s of ss) {
          const c = deriveConnectionConfidence(s, { now });
          if (rank[c] < rank[best]) best = c;
          const a = (s as { lastMcpActivityAt?: string }).lastMcpActivityAt;
          if (a && (!freshestActivity || a > freshestActivity)) freshestActivity = a;
          const sn = (s as { name?: string }).name;
          if (!name && sn) name = sn;
        }
        return {
          instance,
          ...(name !== undefined ? { name } : {}),
          ...(reg?.workspace !== undefined ? { workspace: reg.workspace } : {}),
          registered: reg !== undefined,
          roles: eff?.roles ?? reg?.roles ?? [],
          scopes: eff?.scopes ?? reg?.scopes ?? [],
          sessions: ss.length,
          connectionConfidence: best,
          ...(freshestActivity ? { lastMcpActivityAt: freshestActivity } : {})
        };
      })
      .filter((r) => {
        // honor --role / --scope filters against the annotated values
        if (flags.role && !r.roles.includes(flags.role)) return false;
        if (flags.scope && !r.scopes.includes(flags.scope)) return false;
        return true;
      })
      // Most-reachable first, so the addressable agent is at the top.
      .sort((a, b) => rank[a.connectionConfidence] - rank[b.connectionConfidence]);
    streams.stdout.write(`${JSON.stringify(live, null, 2)}\n`);
    return 0;
  }

  streams.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  return 0;
}

/**
 * `h2a thread --id <threadId> --instance <self> [--root <path>]`
 *
 * Derived read-only view: union of inbox and outbox for the given instance,
 * filtered to `envelope.threadId === id`, deduped by envelope id, sorted
 * ascending by `createdAt`. No new store — pure in-memory derivation.
 */
function cmdThread(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.id || !flags.instance) {
    streams.stderr.write("h2a thread: --id <threadId> and --instance <self> are required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  let store;
  try {
    store = createLocalStore({ root });
  } catch (error) {
    streams.stderr.write(`h2a thread: ${(error as Error).message}\n`);
    return 3;
  }
  let inboxEnvelopes: H2AEnvelope[];
  let outboxEnvelopes: H2AEnvelope[];
  try {
    inboxEnvelopes = store.readInbox(flags.instance);
    outboxEnvelopes = store.readOutbox(flags.instance);
  } catch (error) {
    streams.stderr.write(`h2a thread: ${(error as Error).message}\n`);
    return 3;
  }
  const threadId = flags.id;
  const seen = new Set<string>();
  const thread: H2AEnvelope[] = [];
  for (const env of [...inboxEnvelopes, ...outboxEnvelopes]) {
    if (env.threadId === threadId && !seen.has(env.id)) {
      seen.add(env.id);
      thread.push(env);
    }
  }
  thread.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  streams.stdout.write(`${JSON.stringify(thread, null, 2)}\n`);
  return 0;
}

function cmdSessions(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  try {
    let sessions = listPresence(root);
    if (flags.scope) {
      const wanted = flags.scope;
      sessions = sessions.filter((s) => s.interests.scopes.includes(wanted));
    }
    if (flags.instance) {
      const wanted = flags.instance;
      sessions = sessions.filter((s) => s.instance === wanted);
    }
    if (flags.name) {
      const needle = flags.name.toLowerCase();
      sessions = sessions.filter(
        (s) => typeof s.name === "string" && s.name.toLowerCase().includes(needle)
      );
    }
    streams.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a sessions: ${(error as Error).message}\n`);
    return 3;
  }
}

function cmdStatus(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  try {
    let sessions = listPresence(root);
    if (flags.scope) {
      const wanted = flags.scope;
      sessions = sessions.filter((s) => s.interests.scopes.includes(wanted));
    }
    if (flags.instance) {
      const wanted = flags.instance;
      sessions = sessions.filter((s) => s.instance === wanted);
    }
    if (flags.name) {
      const needle = flags.name.toLowerCase();
      sessions = sessions.filter(
        (s) => typeof s.name === "string" && s.name.toLowerCase().includes(needle)
      );
    }
    const indirect = sessions.filter((s) => typeof s.mirroredAt === "string");
    const direct = sessions.filter((s) => typeof s.mirroredAt !== "string");
    streams.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          root,
          counts: { direct: direct.length, indirect: indirect.length, total: sessions.length },
          direct,
          indirect
        },
        null,
        2
      )}\n`
    );
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a status: ${(error as Error).message}\n`);
    return 3;
  }
}

/**
 * Read the stable machine-id for workspace derivation (mirrors live.ts).
 * Used only by `cmdConductor` when the caller passes a filesystem path.
 */
function cliReadMachineId(): string {
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(p, "utf8").trim();
      if (id.length > 0) return id;
    } catch {
      // try next source
    }
  }
  return hostname() || "unknown-machine";
}

/**
 * Resolve a workspace id from CLI flags (workspace flag or cwd default).
 * Shared by `h2a conductor`, `h2a conductor claim`, and `h2a conductor release`.
 */
function resolveConductorWorkspaceId(
  flags: Record<string, string>,
  cwd: () => string
): string {
  const wsFlag = flags.workspace;
  if (!wsFlag) {
    // Default to cwd
    const cwdPath = cwd();
    let realPath = cwdPath;
    try { realPath = realpathSync(cwdPath); } catch { /* use cwd as-is */ }
    return deriveWorkspaceId({ machineId: cliReadMachineId(), path: realPath });
  } else if (wsFlag.startsWith("ws:")) {
    return wsFlag;
  } else {
    // Treat as a filesystem path
    let realPath = wsFlag;
    try { realPath = realpathSync(wsFlag); } catch { /* use as-is */ }
    return deriveWorkspaceId({ machineId: cliReadMachineId(), path: realPath });
  }
}

/**
 * `h2a conductor [claim|release] [--instance <self>] [--workspace <id|path>] [--root <path>]`
 *
 * - No subverb: resolve the live conductor/owner (WP-G1, read-only).
 * - `claim`:   append a claim event and return the post-claim resolution.
 * - `release`: append a release event and return the post-release resolution.
 *
 * Output shape: resource (JSON of ConductorResolution). Exit 0 on success,
 * exit 1 on user error (missing --instance for claim/release).
 */
function cmdConductor(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  // Only "claim"/"release" are subverbs. Otherwise the first token is a flag
  // (e.g. `conductor --workspace …`) — parseFlags would consume it as the
  // command and DROP --workspace, silently defaulting to cwd. Prepend a
  // placeholder so all flags parse from the full argv in the no-subverb case.
  const sub =
    argv[0] === "claim" || argv[0] === "release" ? argv[0] : undefined;
  const { flags } = parseFlags(sub ? argv : ["", ...argv]);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  // Subverbs: claim / release
  if (sub === "claim" || sub === "release") {
    if (!flags.instance) {
      streams.stderr.write(`h2a conductor ${sub}: --instance <self> is required\n`);
      return 1;
    }
    const workspaceId = resolveConductorWorkspaceId(flags, cwd);
    try {
      appendConductorClaim(root, {
        type: sub,
        workspaceId,
        instance: flags.instance,
        at: new Date().toISOString()
      });
      const result = conductorFor({ root, workspaceId });
      streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      streams.stderr.write(`h2a conductor ${sub}: ${(error as Error).message}\n`);
      return 1;
    }
  }

  // No subverb (or unrecognized subverb treated as workspace flag for back-compat):
  // resolve the conductor (read-only).
  const workspaceId = resolveConductorWorkspaceId(flags, cwd);
  try {
    const result = conductorFor({ root, workspaceId });
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a conductor: ${(error as Error).message}\n`);
    return 1;
  }
}

/**
 * `h2a conductor-launch-check [--workspace <id|path>] [--root <path>] [--idle-ms <ms>]`
 *
 * DRY-RUN: polls `track workspace-activity` and RECOMMENDS launching a
 * conductor if work is durably stalled and no conductor is live.
 *
 * h2a does NOT spawn anything. A `recommendation === "launch"` result is
 * purely advisory. The actual launch is parked pending a spawn policy and
 * remote-trigger support.
 *
 * Exit 0 on success. Exit 1 on bad flag value.
 * Output shape: resource (JSON of ConductorLaunchCheckResult).
 */
function cmdConductorLaunchCheck(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { flags } = parseFlags(["", ...argv]);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const workspaceId = resolveConductorWorkspaceId(flags, cwd);

  let idleMs: number | undefined;
  if (flags["idle-ms"] !== undefined) {
    const parsed = Number(flags["idle-ms"]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      streams.stderr.write(
        `h2a conductor-launch-check: --idle-ms must be a positive number (got "${flags["idle-ms"]}")\n`
      );
      return 1;
    }
    idleMs = parsed;
  }

  try {
    const result = conductorLaunchCheck({ root, workspaceId, idleMs });
    if (result.recommendation === "launch") {
      streams.stderr.write(
        "h2a conductor-launch-check: DRY-RUN — h2a does NOT spawn. " +
          "This is a recommendation only; the launch is parked pending a spawn policy + remote.\n"
      );
    }
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`h2a conductor-launch-check: ${(error as Error).message}\n`);
    return 1;
  }
}

/**
 * `h2a conductor-launch --workspace <id|path> [--root] [--idle-ms <ms>] [--confirm] [--remote <instance>] [--instance <self>]`
 *
 * D3 EMISSION: when `conductorLaunchCheck` returns recommendation="launch",
 * h2a emits a launch-REQUEST envelope to a live remote agent.
 *
 * Gates:
 * 1. `conductorLaunchCheck` recommendation must be "launch".
 * 2. Cooldown: at most 1 request per 30 min per workspace (checked via spawns store).
 * 3. Human confirmation: WITHOUT `--confirm`, only PREVIEW the request (dry-run).
 *    WITH `--confirm`, emit + record the marker.
 *
 * h2a NEVER spawns a process itself. It only puts a request envelope to remote.
 * The remote agent reads the envelope and executes the actual spawn.
 *
 * Exit 0 (success: none/cooldown/would-emit/no-remote/emitted).
 * Exit 1 (user error: missing --instance when --confirm given).
 */
/**
 * `h2a wake-request --to <instance>` (WP-F, Codex reachability): emit a signed
 * `wake-request` envelope to a live remote/launcher agent so IT wakes the TARGET
 * agent's tmux pane out-of-band.
 *
 * Why: a Codex agent tears down its h2a stdio MCP child on transport drop and
 * never reconnects, so h2a deletes its presence and the in-process EVO-1
 * self-wake can no longer fire — the agent is unreachable even though its pane
 * is alive. The launcher (remote) holds the target's DURABLE pane and performs
 * the actual wake; h2a never types into a pane here, so there is no stale-pane /
 * wrong-pane risk on the h2a side. Claude does NOT need this (its presence stays
 * live → the self-wake fires in-process).
 *
 * Flags: --to <target> (required), --instance <self> signer (required to emit),
 * --remote <r> (override; else first live remote, pane-preferred), --dry-run,
 * --reason <text>.
 */
export function cmdWakeRequest(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { flags } = parseFlags(["", ...argv]);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);

  const target = flags.to;
  if (!target) {
    streams.stderr.write("h2a wake-request: --to <instance> is required (the agent to wake)\n");
    return 1;
  }
  const request = {
    kind: "wake-request" as const,
    target,
    reason: flags.reason ?? "peer not live on the bus; wake its pane out-of-band",
    // Self-describing wake: the EXACT line the launcher should type into the
    // target's pane. The target's MCP is likely dead (that's why it's being
    // woken), so it must read its inbox via the CLI, not the MCP — and the bare
    // `h2a inbox read` errors without --instance. h2a composes the precise
    // command since it knows the target + root. Launchers SHOULD type this
    // verbatim (literal send-keys) rather than hard-coding their own line.
    instructionLine: `h2a inbox read --instance ${target} --root ${root}`
  };

  // --dry-run → preview only; never emit.
  if (flags["dry-run"] !== undefined) {
    streams.stdout.write(
      `${JSON.stringify({
        action: "would-emit",
        request,
        note: "DRY-RUN — pass --instance <self> (without --dry-run) to emit; remote performs the actual pane wake"
      }, null, 2)}\n`
    );
    return 0;
  }

  // Emitting requires the signer/sender identity.
  if (!flags.instance) {
    streams.stderr.write(
      "h2a wake-request: --instance <self> is required to emit (the signer/sender identity); or use --dry-run\n"
    );
    return 1;
  }
  const selfInstance = flags.instance;

  // Resolve the target remote/launcher instance.
  let remoteInstance: string;
  if (flags.remote) {
    remoteInstance = flags.remote;
  } else {
    const sessions = listPresence(root);
    const remoteSessions = sessions.filter(
      (s) => s.host === "remote" || (s.instance && s.instance.startsWith("remote:"))
    );
    if (remoteSessions.length === 0) {
      streams.stdout.write(
        `${JSON.stringify({
          action: "no-remote",
          reason: "no live remote/launcher agent to perform the out-of-band wake"
        }, null, 2)}\n`
      );
      return 0;
    }
    const withPane = remoteSessions.filter((s) => s.launchContext?.tmux?.pane);
    remoteInstance = (withPane.length > 0 ? withPane[0] : remoteSessions[0]).instance;
  }

  const store = createLocalStore({ root });
  const envelope = createEnvelope({
    id: `env-wake-${Date.now().toString(36)}`,
    type: "event" as const,
    actor: { instance: selfInstance, role: "AGENTS" as const, scope: "scope:default" },
    target: { instance: remoteInstance },
    body: {
      kind: "message" as const,
      topic: "wake-request",
      text: `Wake request for ${target}: ${request.reason}`,
      request
    },
    createdAt: new Date().toISOString()
  });

  try {
    store.putInboxMessage(remoteInstance, envelope);
  } catch (error) {
    streams.stderr.write(
      `h2a wake-request: failed to deliver to ${remoteInstance}: ${(error as Error).message}\n`
    );
    return 1;
  }

  streams.stdout.write(
    `${JSON.stringify({ action: "emitted", to: remoteInstance, request }, null, 2)}\n`
  );
  return 0;
}

export function cmdConductorLaunch(
  argv: readonly string[],
  streams: H2ACliStreams,
  opts?: {
    /** Injectable check for tests (bypasses conductorLaunchCheck). */
    injectedCheck?: import("./runtime/governance/launch-check.js").ConductorLaunchCheckResult;
  }
): number {
  const { flags } = parseFlags(["", ...argv]);
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const workspaceId = resolveConductorWorkspaceId(flags, cwd);

  let idleMs: number | undefined;
  if (flags["idle-ms"] !== undefined) {
    const parsed = Number(flags["idle-ms"]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      streams.stderr.write(
        `h2a conductor-launch: --idle-ms must be a positive number (got "${flags["idle-ms"]}")\n`
      );
      return 1;
    }
    idleMs = parsed;
  }

  // 1. Compute the launch recommendation (or use injected value for tests).
  let check: import("./runtime/governance/launch-check.js").ConductorLaunchCheckResult;
  if (opts?.injectedCheck !== undefined) {
    check = opts.injectedCheck;
  } else {
    check = conductorLaunchCheck({ root, workspaceId, ...(idleMs !== undefined ? { idleMs } : {}) });
  }

  if (check.recommendation !== "launch") {
    streams.stdout.write(
      `${JSON.stringify({ action: "none", ...check }, null, 2)}\n`
    );
    return 0;
  }

  // 2. Cooldown gate.
  const last = lastSpawnRequestAt(root, workspaceId);
  if (!spawnAllowed({ lastSpawnAt: last, now: Date.now() })) {
    streams.stdout.write(
      `${JSON.stringify({
        action: "cooldown",
        reason: "a launch request was emitted < 30min ago for this workspace",
        lastSpawnAt: last
      }, null, 2)}\n`
    );
    return 0;
  }

  // 3. Build the request object.
  const request = {
    kind: "conductor-launch-request" as const,
    workspaceId,
    hostPref: ["claude", "codex", "agy"] as const,
    stalled: check.stalled,
    reason: check.reason
  };

  // 4. Without --confirm → preview only (dry-run). Never emit, never record.
  if (!flags.confirm) {
    streams.stdout.write(
      `${JSON.stringify({
        action: "would-emit",
        request,
        note: "DRY-RUN — pass --confirm to emit this launch request to remote (h2a never spawns; remote does)"
      }, null, 2)}\n`
    );
    return 0;
  }

  // 5. With --confirm: --instance is required (the signer/sender identity).
  if (!flags.instance) {
    streams.stderr.write(
      "h2a conductor-launch: --instance <self> is required with --confirm (the signer/sender identity)\n"
    );
    return 1;
  }
  const selfInstance = flags.instance;

  // 6. Resolve the target remote instance.
  let remoteInstance: string;
  if (flags.remote) {
    remoteInstance = flags.remote;
  } else {
    // Find a live session whose host is "remote".
    const sessions = listPresence(root);
    const remoteSessions = sessions.filter(
      (s) => s.host === "remote" || (s.instance && s.instance.startsWith("remote:"))
    );
    if (remoteSessions.length === 0) {
      streams.stdout.write(
        `${JSON.stringify({
          action: "no-remote",
          reason: "no live remote agent to receive the launch request"
        }, null, 2)}\n`
      );
      return 0;
    }
    // Prefer one with a launchContext/pane (they can actually spawn); else take first.
    const withPaneCandidates = remoteSessions.filter((s) => s.launchContext?.tmux?.pane);
    const chosen = withPaneCandidates.length > 0 ? withPaneCandidates[0] : remoteSessions[0];
    remoteInstance = chosen.instance;
  }

  // 7. Compose the H2AEnvelope and deliver it to the remote's inbox.
  const store = createLocalStore({ root });
  const envelope = createEnvelope({
    id: `env-conductor-launch-${Date.now().toString(36)}`,
    type: "event" as const,
    actor: { instance: selfInstance, role: "CONDUCTOR" as const, scope: "scope:default" },
    target: { instance: remoteInstance },
    body: {
      kind: "message" as const,
      topic: "conductor-launch-request",
      text: `Conductor-launch request for workspace ${workspaceId}: ${check.reason}`,
      request
    },
    createdAt: new Date().toISOString()
  });

  try {
    store.putInboxMessage(remoteInstance, envelope);
  } catch (error) {
    streams.stderr.write(`h2a conductor-launch: failed to deliver to ${remoteInstance}: ${(error as Error).message}\n`);
    return 1;
  }

  // 8. Record the spawn marker (after successful delivery).
  recordSpawnRequest(root, {
    workspaceId,
    at: new Date().toISOString(),
    to: remoteInstance
  });

  streams.stdout.write(
    `${JSON.stringify({ action: "emitted", to: remoteInstance, request }, null, 2)}\n`
  );
  return 0;
}

function cmdDoctor(
  flags: Record<string, string>,
  streams: H2ACliStreams,
  options: H2ACliOptions = {}
): number {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const report: Record<string, unknown> = {
    ok: true,
    root,
    warnings: [] as Array<Record<string, unknown>>,
    checks: {}
  };
  const checks = report.checks as Record<string, unknown>;
  const warnings = report.warnings as Array<Record<string, unknown>>;

  // 1. Root reachable
  if (!existsSync(root)) {
    checks.rootExists = { ok: false, message: `root does not exist: ${root}` };
    report.ok = false;
  } else {
    checks.rootExists = { ok: true };
  }

  // 2. Schema sentinel present
  const schemaPath = join(root, ".h2a-schema.json");
  if (!existsSync(schemaPath)) {
    checks.schemaSentinel = {
      ok: false,
      message: `missing ${schemaPath}; run \`h2a init --root ${root}\``
    };
    report.ok = false;
  } else {
    try {
      const parsed = JSON.parse(readFileSync(schemaPath, "utf8"));
      checks.schemaSentinel = { ok: true, version: parsed.version };
      if (parsed.version !== H2A_STORE_SCHEMA_VERSION) {
        report.ok = false;
        checks.schemaSentinel = {
          ok: false,
          version: parsed.version,
          message: `expected schema version ${H2A_STORE_SCHEMA_VERSION}`
        };
      }
    } catch (error) {
      report.ok = false;
      checks.schemaSentinel = {
        ok: false,
        message: `cannot read schema sentinel: ${(error as Error).message}`
      };
    }
  }

  // 3. Live sessions on the bus
  try {
    const sessions = listPresence(root);
    checks.liveSessions = { ok: true, count: sessions.length };
  } catch (error) {
    report.ok = false;
    checks.liveSessions = {
      ok: false,
      message: (error as Error).message
    };
  }

  // 4. h2a binary reachable (self-check via existing API)
  checks.cliBinary = { ok: true };

  // 5. `doctor` remains the non-mutating bus-health probe used by automation.
  // `--repair` is the single explicit host-installation convergence action: it
  // is allowed to touch host configuration/caches and invoke native host CLIs.
  // That keeps an ordinary isolated-bus probe independent of the operator's
  // personal Claude/Codex setup while retaining a fail-closed repair surface.
  if (flags.repair === "true") {
    const hostInstallations = (options.doctorHostInstallations ?? doctorHostInstallations)({ repair: true });
    checks.hostInstallations = hostInstallations;
    if (!hostInstallations.ok) {
      report.ok = false;
      report.unrepaired = hostInstallations.hosts.flatMap((host) =>
        host.unrepaired.length > 0 ? host.unrepaired : host.findings
      );
    }

    // Config changes apply only when the host creates a new MCP stdio child.
    // Presence gives doctor the only reliable local proof of an already-running
    // H2A session. A session opened before its host config changed remains
    // explicitly unrepaired until restart; never report it as clean.
    try {
      const liveHostSessions = findLiveSessionsPredatingHostConfig(
        listPresence(root, { sweep: false }),
        hostInstallations.hosts
      );
      checks.liveHostSessions = {
        ok: liveHostSessions.length === 0,
        restartRequired: liveHostSessions
      };
      if (liveHostSessions.length > 0) {
        report.ok = false;
        const unrepaired = (report.unrepaired as Array<Record<string, unknown>> | undefined) ?? [];
        unrepaired.push(
          ...liveHostSessions.map((session) => ({
            code: "live-session-restart-required",
            message: session.message,
            host: session.host,
            sessionId: session.sessionId
          }))
        );
        report.unrepaired = unrepaired;
      }
    } catch (error) {
      report.ok = false;
      checks.liveHostSessions = {
        ok: false,
        message: `cannot verify live host sessions: ${(error as Error).message}`
      };
      const unrepaired = (report.unrepaired as Array<Record<string, unknown>> | undefined) ?? [];
      unrepaired.push({
        code: "live-session-check-unavailable",
        message: `cannot verify live host sessions: ${(error as Error).message}`
      });
      report.unrepaired = unrepaired;
    }
  } else {
    checks.hostInstallations = {
      ok: true,
      skipped: true,
      message: "pass --repair to detect and converge Claude/Codex host installation drift"
    };
  }

  // ── Warning checks (do NOT flip report.ok) ──────────────────────────────

  // (a) rootSource: record where the root came from
  const rootInfo = resolveRootInfo(flags, cwd);
  report.rootSource = rootInfo.source;
  if (rootInfo.source === "default") {
    warnings.push({
      check: "rootSource",
      message:
        `The bus root is the global shared default (${root}). ` +
        `Set H2A_ROOT or pass --root <path> to use a different bus. ` +
        `Agents on different roots cannot exchange messages.`
    });
  }

  // (b) splitBrain: a repo-local .h2a exists alongside a DIFFERENT active root
  const cwdLocal = join(cwd(), ".h2a");
  try {
    if (existsSync(cwdLocal)) {
      const resolvedLocal = realpathSync(cwdLocal);
      const resolvedRoot = (() => {
        try { return realpathSync(root); } catch { return root; }
      })();
      if (resolvedLocal !== resolvedRoot) {
        warnings.push({
          check: "splitBrain",
          message:
            `A repo-local .h2a (${cwdLocal}) exists alongside a DIFFERENT active root (${root}). ` +
            `Messages written to the repo-local bus are invisible to peers on ${root} — split-brain.`
        });
      }
    }
  } catch {
    // silently ignore (the cwd-local path may not be resolvable)
  }

  // (c) inboxHygiene: scan inbox for case/slug duplicates, host-less dirs, phantom 3-segment dirs
  const inboxDir = join(root, "inbox");
  // Collect dirs to prune (with --prune only).
  const pruned: Array<{ name: string; path: string }> = [];
  if (existsSync(inboxDir)) {
    let inboxEntries: string[] = [];
    try {
      inboxEntries = readdirSync(inboxDir);
    } catch {
      // not readable — skip hygiene check
    }
    if (inboxEntries.length > 0) {
      const KNOWN_HOSTS = new Set([
        "claude",
        "codex",
        "gemini",
        "agy",
        "hermes",
        "opencode",
        "remote"
      ]);

      // Reconstruct an address from a dir name: double-underscore → colon.
      function dirToAddress(name: string): string {
        return name.replace(/__/g, ":");
      }

      // Case/slug duplicates: two dir names that map to the same canonicalAddress
      const byCanonical = new Map<string, string[]>();
      for (const entry of inboxEntries) {
        const addr = dirToAddress(entry);
        let canonical: string;
        try { canonical = canonicalAddress(addr); } catch { canonical = addr.toLowerCase(); }
        const group = byCanonical.get(canonical) ?? [];
        group.push(entry);
        byCanonical.set(canonical, group);
      }
      const dupGroups = [...byCanonical.values()].filter((g) => g.length > 1);
      if (dupGroups.length > 0) {
        const examples = dupGroups.slice(0, 5).map((g) => g.join(" | "));
        warnings.push({
          check: "inboxHygiene",
          kind: "caseDuplicates",
          count: dupGroups.length,
          examples,
          message:
            `${dupGroups.length} case/slug duplicate group(s) in inbox — ` +
            `different dir names map to the same canonical address. ` +
            `Examples: ${examples.join(", ")}. (Not pruned — too risky; resolve manually.)`
        });
      }

      // Host-less dirs: first segment (before first __) is not a known host
      const hostless = inboxEntries.filter((entry) => {
        const firstSeg = entry.split("__")[0];
        return !KNOWN_HOSTS.has(firstSeg);
      });
      if (hostless.length > 0) {
        const examples = hostless.slice(0, 5);
        warnings.push({
          check: "inboxHygiene",
          kind: "hostlessDirs",
          count: hostless.length,
          examples,
          message:
            `${hostless.length} host-less inbox dir(s) (first segment is not ${[...KNOWN_HOSTS].join("/")}). ` +
            `Examples: ${examples.join(", ")}`
        });
        if (flags.prune !== undefined) {
          for (const name of hostless) {
            const dir = join(inboxDir, name);
            try {
              rmSync(dir, { recursive: true, force: true });
              pruned.push({ name, path: dir });
            } catch (error) {
              streams.stderr.write(`h2a doctor --prune: cannot remove ${dir}: ${(error as Error).message}\n`);
            }
          }
        }
      }

      // Phantom 3-segment dirs: exactly 3 __ segments but 3rd is not a 12-char hex session id
      const VALID_TAIL_RE = /^[0-9a-f]{12}$/i;
      const phantom = inboxEntries.filter((entry) => {
        const segs = entry.split("__");
        if (segs.length !== 3) return false;
        return !VALID_TAIL_RE.test(segs[2]);
      });
      if (phantom.length > 0) {
        const examples = phantom.slice(0, 5);
        warnings.push({
          check: "inboxHygiene",
          kind: "phantomThreeSegment",
          count: phantom.length,
          examples,
          message:
            `${phantom.length} phantom 3-segment inbox dir(s) where the tail is not a 12-char hex session id. ` +
            `Examples: ${examples.join(", ")}`
        });
        if (flags.prune !== undefined) {
          for (const name of phantom) {
            const dir = join(inboxDir, name);
            try {
              rmSync(dir, { recursive: true, force: true });
              pruned.push({ name, path: dir });
            } catch (error) {
              streams.stderr.write(`h2a doctor --prune: cannot remove ${dir}: ${(error as Error).message}\n`);
            }
          }
        }
      }

      // Orphan 3-segment dirs: 3 segments, valid hex tail, but UUID is NOT in registry/instances.jsonl
      if (flags.prune !== undefined) {
        const instancesFile = join(root, "registry", "instances.jsonl");
        let registeredUuids: Set<string> = new Set();
        try {
          const content = readFileSync(instancesFile, "utf8");
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed);
              const id: string = typeof obj.instance === "string" ? obj.instance : (typeof obj.id === "string" ? obj.id : "");
              // Extract the hex tail segment from the instance id (e.g. host:label:abc123456789)
              const parts = id.split(":");
              if (parts.length >= 3) {
                const tail = parts[parts.length - 1];
                if (VALID_TAIL_RE.test(tail)) registeredUuids.add(tail.toLowerCase());
              }
            } catch {
              // skip malformed
            }
          }
        } catch {
          // instances file absent — keep set empty (prune all orphans below)
        }
        const orphan3seg = inboxEntries.filter((entry) => {
          const segs = entry.split("__");
          if (segs.length !== 3) return false;
          if (!VALID_TAIL_RE.test(segs[2])) return false; // already handled as phantom
          return !registeredUuids.has(segs[2].toLowerCase());
        });
        for (const name of orphan3seg) {
          const dir = join(inboxDir, name);
          try {
            rmSync(dir, { recursive: true, force: true });
            pruned.push({ name, path: dir });
          } catch (error) {
            streams.stderr.write(`h2a doctor --prune: cannot remove ${dir}: ${(error as Error).message}\n`);
          }
        }
      }
    }
  }

  // (d) --scan <dir>: find immediate child buses (ONE level deep).
  // Safety model: a stray bus is ORPHAN only if it has zero live (fresh
  // heartbeat) presence — checked via the same listPresence() used for the
  // liveSessions hard check above. A bus with ANY live presence is reported
  // but NEVER pruned, --prune or not. This is a dry-run-by-default sweep:
  // the report always lists what --prune WOULD remove; only --prune deletes.
  const strayBuses: Array<Record<string, unknown>> = [];
  if (flags.scan) {
    try {
      const scanChildren = readdirSync(flags.scan);
      for (const child of scanChildren) {
        const candidateBus = join(flags.scan, child, ".h2a");
        if (existsSync(candidateBus)) {
          const instancesFile = join(candidateBus, "registry", "instances.jsonl");
          let instances = 0;
          try {
            const content = readFileSync(instancesFile, "utf8");
            instances = content.split("\n").filter((l) => l.trim().length > 0).length;
          } catch {
            instances = 0;
          }
          // Liveness gate: any fresh presence heartbeat in this bus makes it
          // ACTIVE, not orphan — never a deletion candidate.
          let live = false;
          try {
            live = listPresence(candidateBus).length > 0;
          } catch {
            // Unreadable presence dir — treat conservatively as NOT orphan.
            live = true;
          }
          strayBuses.push({ path: candidateBus, instances, live, orphan: !live });
        }
      }
    } catch (error) {
      streams.stderr.write(`h2a doctor: --scan ${flags.scan}: ${(error as Error).message}\n`);
    }
    if (strayBuses.length > 0) {
      const orphanBuses = strayBuses.filter((b) => b.orphan === true);
      const liveBuses = strayBuses.filter((b) => b.orphan !== true);
      warnings.push({
        check: "strayBuses",
        count: strayBuses.length,
        orphanCount: orphanBuses.length,
        liveCount: liveBuses.length,
        buses: strayBuses,
        message:
          `${strayBuses.length} stray repo-local .h2a bus(es) found under ${flags.scan} — ` +
          `candidate split-brain forks. ${orphanBuses.length} orphan (no live presence — ` +
          `${flags.prune !== undefined ? "removed by" : "would be removed by"} --prune), ` +
          `${liveBuses.length} live (has active presence — never pruned).`
      });
      if (flags.prune !== undefined) {
        for (const bus of orphanBuses) {
          const busPath = bus.path as string;
          try {
            rmSync(busPath, { recursive: true, force: true });
            pruned.push({ name: busPath, path: busPath });
          } catch (error) {
            streams.stderr.write(`h2a doctor --prune: cannot remove ${busPath}: ${(error as Error).message}\n`);
          }
        }
        if (liveBuses.length > 0) {
          streams.stderr.write(
            `h2a doctor --prune: skipped ${liveBuses.length} stray bus(es) with live presence (never pruned): ` +
              `${liveBuses.map((b) => b.path as string).join(", ")}\n`
          );
        }
      }
    }
  }

  if (flags.prune !== undefined) {
    report.pruned = pruned;
  }

  streams.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 2;
}

function cmdKeysGenerate(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.instance) {
    streams.stderr.write("h2a keys generate: --instance <id> is required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const outDir = flags.out ?? join(resolveRoot(flags, cwd), "keys");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    streams.stderr.write(
      `h2a keys generate: cannot create ${outDir} (${(error as Error).message})\n`
    );
    return 3;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  // File names are derived from the instance id with `:` and `/` replaced by `-`
  // so they map cleanly to filesystems on every OS.
  const safeName = flags.instance.replace(/[:/]/g, "-");
  const privatePath = join(outDir, `${safeName}.key.pem`);
  const publicPath = join(outDir, `${safeName}.pub.pem`);

  try {
    writeFileSync(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
    writeFileSync(publicPath, publicPem, "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys generate: cannot write key files (${(error as Error).message})\n`
    );
    return 3;
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        instance: flags.instance,
        privateKeyPath: privatePath,
        publicKeyPath: publicPath,
        publicKeyPem: publicPem
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function cmdKeysAdd(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-078: append a public key to an instance's keyring (rotate-in).
  if (!flags.instance || !flags["public-key"]) {
    streams.stderr.write(
      "h2a keys add: --instance <id> and --public-key <pem-file> are required\n"
    );
    return 1;
  }
  let publicKeyPem;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys add: cannot read --public-key (${(error as Error).message})\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  try {
    store.addInstanceKey(flags.instance, publicKeyPem);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a keys add: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, instance: flags.instance, keys: store.listInstanceKeys(flags.instance).length }, null, 2)}\n`
  );
  return 0;
}

function cmdKeysList(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.instance) {
    streams.stderr.write("h2a keys list: --instance <id> is required\n");
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  streams.stdout.write(`${JSON.stringify(store.listInstanceKeys(flags.instance), null, 2)}\n`);
  return 0;
}

function cmdKeysRevoke(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-079: revoke a public key from an instance's keyring (rotate-out).
  if (!flags.instance || !flags["public-key"]) {
    streams.stderr.write(
      "h2a keys revoke: --instance <id> and --public-key <pem-file> are required\n"
    );
    return 1;
  }
  let publicKeyPem;
  try {
    publicKeyPem = readFileSync(flags["public-key"], "utf8");
  } catch (error) {
    streams.stderr.write(
      `h2a keys revoke: cannot read --public-key (${(error as Error).message})\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const store = createLocalStore({ root: resolveRoot(flags, cwd) });
  try {
    store.revokeInstanceKey(flags.instance, publicKeyPem);
  } catch (error) {
    const message = (error as Error).message;
    streams.stderr.write(`h2a keys revoke: ${message}\n`);
    return classifyStoreError(message);
  }
  streams.stdout.write(
    `${JSON.stringify({ ok: true, instance: flags.instance, status: "revoked", keys: store.listInstanceKeys(flags.instance).length }, null, 2)}\n`
  );
  return 0;
}

/**
 * `h2a keys prove-control` — the OWNER-facing half of the principal↔agent
 * enrollment ceremony (Part B of the session-exposure feed contract ratified
 * 2026-07-24; step 3 of the P1 joint plan).
 *
 * The verb is named for what it does and only what it does: it PROVES CONTROL
 * of the live agent key over a gateway-issued challenge. It does not "enroll"
 * anything, because h2a cannot — the 39-auth principal is the authorizing
 * authority and sentropic mints the binding record. Naming this `enroll` would
 * misstate the authority model in the one place the owner reads it.
 *
 * It makes NO network call. The proof is printed for the owner to hand to the
 * gateway (which requires an active FIRST-PARTY session — deliberately not
 * reachable by a bearer token). Nothing is stored: no binding, no challenge,
 * no proof.
 */
function cmdKeysProveControl(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.host) {
    streams.stderr.write(
      "h2a keys prove-control: --host <codex|claude|gemini|agy|hermes|opencode|remote> is required\n"
    );
    return 1;
  }
  if (
    !["codex", "claude", "gemini", "agy", "hermes", "opencode", "remote"].includes(flags.host)
  ) {
    streams.stderr.write(
      `h2a keys prove-control: unknown --host "${flags.host}". Supported: codex, claude, gemini, agy, hermes, opencode, remote.\n`
    );
    return 1;
  }
  // A NAMED instance-id ROTS. A stale recorded mapping has already sent work to
  // the wrong instance in this project, and the 2026-06-07 identity re-anchor
  // means yesterday's id names yesterday's key. The ceremony therefore resolves
  // the LIVE identity itself, every run — so an override is refused loudly
  // rather than quietly honoured.
  if (flags.instance !== undefined) {
    streams.stderr.write(
      "h2a keys prove-control: --instance is refused. The ceremony must prove the key that is LIVE " +
        "now, so the identity is resolved at run time; a recorded id would name a key that may " +
        "already have been re-anchored away. Re-run `h2a connect` if the live identity is wrong.\n"
    );
    return 1;
  }

  if (flags.nonce !== undefined && flags.challenge !== undefined) {
    streams.stderr.write(
      "h2a keys prove-control: pass either --nonce <value> or --challenge <json-file>, not both\n"
    );
    return 1;
  }

  let challenge: H2AEnrollmentChallenge;
  if (flags.challenge !== undefined) {
    let raw: string;
    try {
      raw = readFileSync(flags.challenge, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a keys prove-control: cannot read --challenge (${(error as Error).message})\n`
      );
      return 1;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      streams.stderr.write(
        `h2a keys prove-control: --challenge is not valid JSON (${(error as Error).message})\n`
      );
      return 1;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      streams.stderr.write(
        "h2a keys prove-control: --challenge must be a JSON object { nonce, expiresAt? }\n"
      );
      return 1;
    }
    // MINIMAL DISCLOSURE is enforced by the challenge-key ALLOWLIST inside
    // `assertSignableEnrollmentChallenge` below, not by a check here. A top-level
    // `"principalSub" in parsed` blocklist used to live at this spot and was
    // incomplete against its own stated harm: `{ nonce, meta: { principalSub } }`
    // and `{ nonce, "__proto__": { principalSub } }` both put a principal id into
    // this process while passing it. The allowlist refuses every field that is
    // not `nonce` or `expiresAt`, so nesting is unreachable rather than hunted.
    challenge = parsed as H2AEnrollmentChallenge;
  } else if (flags.nonce !== undefined && flags.nonce !== "true") {
    // `"true"` is `parseFlags`' bare-flag sentinel (`--nonce` with no value), not
    // a nonce. It is also not a valid nonce under the base64url + 256-bit shape,
    // so rejecting it here only improves the error message.
    challenge = { nonce: flags.nonce };
  } else {
    streams.stderr.write(
      "h2a keys prove-control: --nonce <value> or --challenge <json-file> is required " +
        "(the gateway issues it to your authenticated session)\n"
    );
    return 1;
  }

  // The challenge is the caller's input, so a bad one is a USER error (exit 1);
  // a broken local key state is a STATE error (exit 2). Classified by checking
  // the two separately, never by matching on an error string.
  //
  // `sanitize` both validates (allowlist over own keys) and hands back a FRESH
  // null-prototype object, so nothing downstream carries a parsed document's own
  // `"__proto__"` key even by accident.
  try {
    challenge = sanitizeEnrollmentChallenge(challenge, Date.now());
  } catch (error) {
    streams.stderr.write(`h2a keys prove-control: ${(error as Error).message}\n`);
    return 1;
  }

  const cwd = streams.cwd ?? (() => process.cwd());
  warnIfCwdRootFallback(flags, cwd, streams);
  const root = resolveRoot(flags, cwd);

  // NAME A DAMAGED KEY BEFORE MINTING OVER IT. A corrupt, truncated or
  // passphrase-protected private key does not fail the ceremony: live resolution
  // silently mints a fresh identity and this verb exits 0 on a brand-new key. The
  // mint is defensible; doing it silently is not, because it is indistinguishable
  // from tampering. So say which file is unusable, on stderr, before it happens.
  for (const path of listUnusablePrivateKeys(root)) {
    streams.stderr.write(
      `h2a keys prove-control: WARNING — private key at ${path} exists but cannot be loaded ` +
        "(corrupt, truncated, or passphrase-protected). If it belongs to the identity you meant to " +
        "re-prove, a NEW identity will be minted instead and the proof will be for a different key.\n"
    );
  }

  let result;
  try {
    result = buildEnrollmentProof({ root, host: flags.host, cwd: cwd(), challenge });
  } catch (error) {
    streams.stderr.write(`h2a keys prove-control: ${(error as Error).message}\n`);
    return 2;
  }

  // Deliberately PATH-FREE output. This envelope exists to be copied into a
  // browser, so it holds no `root`, no key path and no private key — the same
  // discipline the feed applies to its descriptors, applied to the one h2a
  // output whose purpose is to leave the machine.
  const envelope: Record<string, unknown> = {
    ok: true,
    instance: result.instance,
    publicKeyFingerprint: result.publicKeyFingerprint,
    // So a MINT is never silent. `mint` means this run proved a key that did not
    // exist before — expected after a re-anchor, but also what a damaged key
    // produces, which is why the stderr warning above names the file.
    ...(result.identityAction !== undefined ? { identityAction: result.identityAction } : {}),
    // Explicit branch, not a defaulted field: h2a ships no transport at all, so
    // "not attempted" is an established fact about this run.
    submission: { attempted: false, reason: "no-transport-configured" },
    proof: result.proof,
    // Derived from the proof itself, never a hand-kept list: the signed set is
    // whatever the proof carries minus the signature.
    signedFields: Object.keys(enrollmentProofSignedPayload(result.proof)).sort(),
    authority:
      "Proof of KEY CONTROL only. The signature covers every field of the proof except itself — " +
      "including the versioned `type` tag, so the proof attests what it IS as well as what it " +
      "carries. But SIGNED IS NOT AUTHORIZED: it proves this key produced this payload; it proves " +
      "nothing about what the key may see. The 39-auth principal authorizes, and sentropic mints " +
      "and stores the binding."
  };
  streams.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
}

function cmdConnect(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  if (!flags.host) {
    streams.stderr.write(
      "h2a connect: --host <codex|claude|gemini|agy|hermes|opencode|remote> is required\n"
    );
    return 1;
  }
  if (
    !["codex", "claude", "gemini", "agy", "hermes", "opencode", "remote"].includes(
      flags.host
    )
  ) {
    streams.stderr.write(
      `h2a connect: unknown --host "${flags.host}". Supported: codex, claude, gemini, agy, hermes, opencode, remote.\n`
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  warnIfCwdRootFallback(flags, cwd, streams);
  const root = resolveRoot(flags, cwd);
  const identity = resolveLiveIdentity({
    root,
    host: flags.host,
    cwd: cwd(),
    // Declared DISPLAY list only, never an authorization input (feed contract
    // ratification condition #3). Lands in the registration's
    // `declaredCapabilities`, never in the authority-bearing `capabilities`.
    declaredCapabilities: H2A_CLI_DECLARED_CAPABILITIES,
    ...(flags.instance !== undefined ? { explicitInstance: flags.instance } : {}),
    ...(flags.name !== undefined ? { name: flags.name } : {})
  });
  const instance = identity.instance;

  const summary: Record<string, unknown> = {
    ok: true,
    root,
    host: flags.host,
    instance,
    identity,
    steps: []
  };
  const steps = summary.steps as Array<Record<string, unknown>>;

  // 1. h2a init
  try {
    createLocalStore({ root });
    steps.push({ step: "init", ok: true, root });
  } catch (error) {
    streams.stderr.write(`h2a connect: init failed (${(error as Error).message})\n`);
    return 3;
  }

  // 2. host setup snippet (print only — write requires explicit --write)
  if (flags.host === "remote") {
    steps.push({
      step: "host-setup",
      ok: true,
      pathHint: "@sentropic/remote bridge environment",
      pathExample: "remote session Pod env",
      snippet: {
        H2A_HOST: "remote",
        H2A_INSTANCE: instance,
        H2A_ROOT: root
      }
    });
  } else {
    // Resolve the descriptor from the host registry (not a ternary fall-through)
    // so every supported host renders ITS OWN snippet — a missing branch must
    // fail loudly, never silently render another host's config.
    const hostDescriptor = CLI_HOSTS.find((h) => h.host === flags.host);
    if (!hostDescriptor) {
      streams.stderr.write(
        `h2a connect: no host descriptor for "${flags.host}"\n`
      );
      return 1;
    }
    const snippet = hostDescriptor.renderMcpConfig({ root });
    steps.push({
      step: "host-setup",
      ok: true,
      pathHint: snippet.path.hint,
      pathExample: snippet.path.example,
      snippet: snippet.config
    });
  }

  // 3. Print follow-up instructions
  const followUp = [
    flags.host === "remote"
      ? "Use the bridge-provided environment in the remote session Pod"
      : `Merge the snippet above under \`mcpServers\` in ${steps[1].pathExample}`,
    identity.privateKeyPath
      ? `keypair ready: ${identity.privateKeyPath}`
      : `legacy override: run h2a keys generate --instance ${instance} --root ${root} if needed`,
    flags.host === "remote" ? "remote bridge skills are managed by the host" : `and: h2a install-skills --host ${flags.host}`
  ];
  summary.followUp = followUp;

  streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

interface ParsedSkill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/**
 * Parse a SKILL.md file into its YAML-frontmatter `name`/`description` and
 * the body markdown that follows. The parser is intentionally minimal: it
 * accepts the canonical `---\nname: ...\ndescription: ...\n---\n<body>` shape
 * that every shipped h2a skill uses. Multi-line description values are
 * supported via simple line-continuation indent.
 */
function parseSkill(raw: string): ParsedSkill {
  const match =
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(raw);
  if (!match) {
    throw new Error(
      "skill file missing YAML frontmatter (expected `---` delimiters)"
    );
  }
  const [, fmRaw, body] = match;
  const frontmatter: Record<string, string> = {};
  let currentKey: string | undefined;
  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      frontmatter[currentKey] = kv[2].trim().replace(/^["']|["']$/g, "");
    } else if (currentKey && /^\s+/.test(line)) {
      frontmatter[currentKey] = `${frontmatter[currentKey]} ${line.trim()}`;
    }
  }
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(
      "skill frontmatter must declare both `name` and `description`"
    );
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    body: body.trimStart()
  };
}

/**
 * Render a parsed skill as a Gemini CLI custom-command TOML file
 * (`~/.gemini/commands/<name>.toml`). Gemini consumes a top-level
 * `description` plus a `prompt` (multiline triple-quoted) which is what the
 * agent receives when the user types `/<name>`. We include the original
 * frontmatter so the prompt itself remains self-describing.
 */
function renderSkillAsGeminiToml(skill: ParsedSkill): string {
  const escapedDescription = skill.description.replace(/"/g, '\\"');
  const promptHeader = `You are the ${skill.name} custom command for Gemini CLI.\n\n`;
  const promptBody = `${promptHeader}${skill.body}`;
  // TOML multiline literal: '''...''' is verbatim, no escaping needed beyond
  // disallowing the closing triple-quote in content. The bundled skills do
  // not contain '''.
  return [
    `description = "${escapedDescription}"`,
    `prompt = '''`,
    promptBody,
    `'''`,
    ""
  ].join("\n");
}

interface HostSkillTargetSpec {
  readonly host: string;
  readonly userBase: string;
  readonly projectBase: string;
  readonly write: (
    base: string,
    skillName: string,
    parsed: ParsedSkill,
    rawSource: string
  ) => string;
  readonly extension: string;
}

function targetSpecFor(
  host: string,
  cwd: string
): HostSkillTargetSpec | undefined {
  if (host === "claude") {
    return {
      host: "claude",
      userBase: join(homedir(), ".claude", "skills"),
      projectBase: join(cwd, ".claude", "skills"),
      extension: "SKILL.md",
      write: (base, skillName, _parsed, raw) => {
        const dir = join(base, skillName);
        mkdirSync(dir, { recursive: true });
        const target = join(dir, "SKILL.md");
        writeFileSync(target, raw, "utf8");
        return target;
      }
    };
  }
  if (host === "codex" || host === "hermes" || host === "opencode") {
    const homeDir =
      host === "codex"
        ? ".codex"
        : host === "hermes"
          ? ".hermes"
          : join(".config", "opencode");
    const projectDir = host === "codex" ? ".codex" : host === "hermes" ? ".hermes" : ".opencode";
    return {
      host,
      userBase: join(homedir(), homeDir, "skills"),
      projectBase: join(cwd, projectDir, "skills"),
      extension: "SKILL.md",
      write: (base, skillName, _parsed, raw) => {
        const dir = join(base, skillName);
        mkdirSync(dir, { recursive: true });
        const target = join(dir, "SKILL.md");
        writeFileSync(target, raw, "utf8");
        return target;
      }
    };
  }
  if (host === "gemini") {
    return {
      host: "gemini",
      userBase: join(homedir(), ".gemini", "commands"),
      projectBase: join(cwd, ".gemini", "commands"),
      extension: ".toml",
      write: (base, skillName, parsed) => {
        mkdirSync(base, { recursive: true });
        const target = join(base, `${skillName}.toml`);
        writeFileSync(target, renderSkillAsGeminiToml(parsed), "utf8");
        return target;
      }
    };
  }
  if (host === "agy") {
    // DEC-096/101: agy (Antigravity) is in the Gemini ecosystem and shares
    // `~/.gemini/`; it has no own skill store but imports plugins from gemini
    // or claude (`agy plugin import gemini`). So installing the gemini TOML
    // command IS the agy source — same write/location as gemini; the import
    // step is surfaced as `importHint` in the summary.
    return {
      host: "agy",
      userBase: join(homedir(), ".gemini", "commands"),
      projectBase: join(cwd, ".gemini", "commands"),
      extension: ".toml",
      write: (base, skillName, parsed) => {
        mkdirSync(base, { recursive: true });
        const target = join(base, `${skillName}.toml`);
        writeFileSync(target, renderSkillAsGeminiToml(parsed), "utf8");
        return target;
      }
    };
  }
  return undefined;
}

/**
 * Skill names shipped before DEC-057 that consolidated into a single `h2a`
 * skill. The installer removes them on a fresh install so users do not end up
 * with both the legacy three-skill bundle and the unified one.
 */
const LEGACY_SKILL_NAMES = ["h2a-connect", "h2a-discover", "h2a-send"];

function pruneLegacy(
  spec: HostSkillTargetSpec,
  base: string
): Array<{ name: string; path: string }> {
  const pruned: Array<{ name: string; path: string }> = [];
  for (const legacyName of LEGACY_SKILL_NAMES) {
    if (spec.host === "gemini" || spec.host === "agy") {
      const file = join(base, `${legacyName}.toml`);
      if (existsSync(file)) {
        try {
          unlinkSync(file);
          pruned.push({ name: legacyName, path: file });
        } catch {
          // best-effort
        }
      }
    } else {
      const dir = join(base, legacyName);
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
          pruned.push({ name: legacyName, path: dir });
        } catch {
          // best-effort
        }
      }
    }
  }
  return pruned;
}

/**
 * The provenance of a skill collected for rendering by `install-skills`.
 * `h2a`   — this package's own bundled skill(s) (`packages/h2a/skills/`).
 * `track` — the `@sentropic/track` package's shipped `skills/` (in-repo source
 *           `packages/track/skills/`).
 * `harness` — the `h2a` npm package's shipped `skills/`, rendered
 *           under the `harness-<name>` prefix.
 */
type SkillProvenance = "h2a" | "track" | "harness";

interface CollectedSkill {
  /** Final skill id — the target dir/file name AND the rewritten frontmatter name. */
  readonly installName: string;
  readonly parsed: ParsedSkill;
  /** SKILL.md content whose frontmatter `name:` matches `installName`. */
  readonly raw: string;
  readonly source: SkillProvenance;
}

type ReadSkillOutcome =
  | { kind: "skill"; skill: CollectedSkill }
  | { kind: "skip" }
  | { kind: "error"; message: string; exit: number };

/**
 * Read one `<srcDir>/<dirName>/SKILL.md`, parse it, and (optionally) rewrite its
 * frontmatter `name:` to `renameTo` so the rendered skill id, its target
 * directory/file and its own frontmatter all agree on the host (Claude/Codex
 * reject a skill whose directory name does not match its `name`). A missing
 * SKILL.md is a soft `skip`; a read/parse failure is a hard error carrying the
 * exit code the caller should return (3 = I/O, 2 = malformed frontmatter).
 */
function readSkillFrom(
  srcDir: string,
  dirName: string,
  source: SkillProvenance,
  renameTo?: string
): ReadSkillOutcome {
  const src = join(srcDir, dirName, "SKILL.md");
  if (!existsSync(src)) return { kind: "skip" };
  let raw: string;
  try {
    raw = readFileSync(src, "utf8");
  } catch (error) {
    return {
      kind: "error",
      message: `cannot read ${src} (${(error as Error).message})`,
      exit: 3
    };
  }
  let parsed: ParsedSkill;
  try {
    parsed = parseSkill(raw);
  } catch (error) {
    return { kind: "error", message: `${dirName}: ${(error as Error).message}`, exit: 2 };
  }
  const installName = renameTo ?? parsed.name;
  if (installName !== parsed.name) {
    // Rewrite ONLY the first `name:` line (the frontmatter one lives in the
    // leading `---` block) so the on-host directory == frontmatter name.
    raw = raw.replace(/^(name:[ \t]*).*$/m, `$1${installName}`);
    parsed = { ...parsed, name: installName };
  }
  return { kind: "skill", skill: { installName, parsed, raw, source } };
}

/**
 * Resolve the on-disk `skills/` directory of an installed dependency package
 * (`@sentropic/track`, `h2a`) from h2a's own runtime location.
 *
 * SOURCE UNIQUE: the skills are rendered on demand from each package's shipped
 * `skills/` tree — never copied into this repo/plugin. Resolution honours the
 * packages' (possibly `import`-only) `exports` via `import.meta.resolve`, with a
 * `createRequire` fallback, then walks up to the package root that declares the
 * matching `name` and returns its `skills/` dir (or undefined if absent).
 */
function resolvePackageSkillsDir(pkgName: string): string | undefined {
  const resolver = (import.meta as unknown as {
    resolve?: (specifier: string) => string;
  }).resolve;
  let mainFile: string | undefined;
  if (typeof resolver === "function") {
    try {
      mainFile = fileURLToPath(resolver(pkgName));
    } catch {
      mainFile = undefined;
    }
  }
  if (!mainFile) {
    try {
      mainFile = createRequire(import.meta.url).resolve(pkgName);
    } catch {
      return undefined;
    }
  }
  let dir = dirname(mainFile);
  for (let depth = 0; depth < 8; depth++) {
    const pkgJsonPath = join(dir, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const name = JSON.parse(readFileSync(pkgJsonPath, "utf8")).name as string;
        if (name === pkgName) {
          const skillsDir = join(dir, "skills");
          return existsSync(skillsDir) ? skillsDir : undefined;
        }
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

interface SkillCollection {
  readonly skills: CollectedSkill[];
  readonly sources: Array<{ source: SkillProvenance; dir: string | null; count: number }>;
  readonly error?: { message: string; exit: number };
}

/**
 * Collect every installable skill from its SINGLE SOURCE, rendered on demand:
 *  1. `h2a`     — this package's `skills/` bundle (`SKILLS_DIR`).
 *  2. `track`   — `@sentropic/track`'s shipped `skills/` (native names).
 *  3. `harness` — `h2a`'s shipped `skills/`, enumerated from the
 *                 package's programmatic `HARNESS_SKILLS` manifest and rendered
 *                 under the `harness-<name>` prefix (anti-collision, tool-neutral).
 *
 * Nothing is copied into this repo/plugin. A dependency whose `skills/` cannot
 * be resolved is recorded as a source with `dir: null` / `count: 0` rather than
 * failing the whole install (the surviving sources still render).
 */
function collectInstallableSkills(): SkillCollection {
  const skills: CollectedSkill[] = [];
  const sources: SkillCollection["sources"] = [];

  const collectFromDir = (
    dir: string | undefined,
    source: SkillProvenance,
    names: readonly string[] | undefined,
    renameTo?: (name: string) => string
  ): { count: number; error?: { message: string; exit: number } } => {
    if (!dir || !existsSync(dir)) return { count: 0 };
    const dirNames =
      names ??
      readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    let count = 0;
    for (const name of dirNames) {
      const outcome = readSkillFrom(dir, name, source, renameTo?.(name));
      if (outcome.kind === "skip") continue;
      if (outcome.kind === "error") {
        return { count, error: { message: outcome.message, exit: outcome.exit } };
      }
      skills.push(outcome.skill);
      count++;
    }
    return { count };
  };

  // 1) h2a — this plugin's own bundled skill(s).
  const h2aRes = collectFromDir(SKILLS_DIR, "h2a", undefined);
  sources.push({ source: "h2a", dir: existsSync(SKILLS_DIR) ? SKILLS_DIR : null, count: h2aRes.count });
  if (h2aRes.error) return { skills, sources, error: h2aRes.error };

  // 2) track — rendered from the installed @sentropic/track package (native names).
  const trackDir = resolvePackageSkillsDir("@sentropic/track");
  const trackRes = collectFromDir(trackDir, "track", undefined);
  sources.push({ source: "track", dir: trackDir ?? null, count: trackRes.count });
  if (trackRes.error) return { skills, sources, error: trackRes.error };

  // 3) harness — rendered from the h2a vendored harness package, prefixed
  //    `harness-<name>`, enumerated via the package's programmatic manifest.
  const harnessDir = join(SKILLS_DIR, "harness");
  const harnessRes = collectFromDir(
    harnessDir,
    "harness",
    HARNESS_SKILLS.map((s) => s.name),
    (name) => `harness-${name}`
  );
  sources.push({ source: "harness", dir: harnessDir ?? null, count: harnessRes.count });
  if (harnessRes.error) return { skills, sources, error: harnessRes.error };

  return { skills, sources };
}

function cmdInstallSkills(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const host = flags.host;
  if (!host) {
    streams.stderr.write(
      "h2a install-skills: --host <claude|codex|gemini|agy|hermes|opencode> is required\n"
    );
    return 1;
  }
  const cwd = streams.cwd ?? (() => process.cwd());
  const spec = targetSpecFor(host, cwd());
  if (!spec) {
    streams.stderr.write(
      `h2a install-skills: unknown --host "${host}". Supported: claude, codex, gemini, agy, hermes, opencode.\n`
    );
    return 1;
  }

  if (!existsSync(SKILLS_DIR)) {
    streams.stderr.write(
      `h2a install-skills: skills bundle missing at ${SKILLS_DIR}\n`
    );
    return 3;
  }

  const scope = flags.scope ?? "user";
  if (scope !== "user" && scope !== "project") {
    streams.stderr.write(
      `h2a install-skills: --scope must be 'user' or 'project'\n`
    );
    return 1;
  }

  // Collect the full skill set from its single sources (h2a + track + harness),
  // rendered on demand — nothing is copied into the repo/plugin.
  const collection = collectInstallableSkills();
  if (collection.error) {
    streams.stderr.write(`h2a install-skills: ${collection.error.message}\n`);
    return collection.error.exit;
  }

  const targetBase = scope === "user" ? spec.userBase : spec.projectBase;
  // DEC-057: prune the pre-consolidation skill names if they linger on disk.
  const prunedLegacy = pruneLegacy(spec, targetBase);

  const installed: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const skill of collection.skills) {
    const skillName = skill.installName;
    // Probe the would-be target file before writing so existing files are
    // surfaced as skipped (mirrors the previous Claude-only behavior).
    const probeTarget =
      spec.host === "gemini" || spec.host === "agy"
        ? join(targetBase, `${skillName}.toml`)
        : join(targetBase, skillName, "SKILL.md");
    if (existsSync(probeTarget) && flags.force !== "true") {
      skipped.push({
        name: skillName,
        reason: `${probeTarget} already exists (use --force to overwrite)`
      });
      continue;
    }
    try {
      const targetPath = spec.write(targetBase, skillName, skill.parsed, skill.raw);
      installed.push(targetPath);
    } catch (error) {
      streams.stderr.write(
        `h2a install-skills: failed to write ${probeTarget} (${(error as Error).message})\n`
      );
      return 3;
    }
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        ok: skipped.length === 0,
        host,
        scope,
        targetBase,
        installed,
        skipped,
        prunedLegacy,
        // Provenance of the rendered set — one entry per single source
        // (h2a + track + harness), with the resolved dir and rendered count.
        sources: collection.sources,
        // DEC-101: agy has no own skill store — it imports from gemini/claude.
        // The TOML above is written to the shared ~/.gemini location; the user
        // then pulls it into agy with `agy plugin import gemini`.
        ...(host === "agy"
          ? { importHint: "agy plugin import gemini   # then: agy plugin enable h2a" }
          : {})
      },
      null,
      2
    )}\n`
  );
  return skipped.length === 0 ? 0 : 2;
}

function cmdDeploy(
  argv: readonly string[],
  streams: H2ACliStreams
): number {
  const { command: sub, flags } = parseFlags(argv);
  if (!sub) {
    streams.stderr.write(
      "h2a deploy: subcommand required (supported: k8s-sidecar, k8s-tenant)\n"
    );
    return 1;
  }
  if (sub === "k8s-tenant") {
    return cmdDeployTenant(flags, streams);
  }
  if (sub !== "k8s-sidecar") {
    streams.stderr.write(
      `h2a deploy: unknown subcommand "${sub}". Supported: k8s-sidecar, k8s-tenant.\n`
    );
    return 1;
  }
  // DEC-058: render the Kubernetes sidecar fragment for Scenario A
  // of DEC-056 (remote session sidecar).
  const fragment = renderK8sSidecar({
    instance: flags.instance,
    host: flags.host,
    root: flags.root,
    image: flags.image,
    cliVersion: flags["cli-version"]
  });

  const writeTo = flags.write;
  if (writeTo) {
    try {
      mkdirSync(dirname(writeTo), { recursive: true });
      writeFileSync(writeTo, fragment.yaml, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a deploy k8s-sidecar: cannot write ${writeTo} (${(error as Error).message})\n`
      );
      return 3;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, target: "k8s-sidecar", path: writeTo }, null, 2)}\n`
    );
    return 0;
  }

  // Default: emit a JSON resource envelope (DEC-034). Programmatic callers
  // can consume the structured `container` / `volume` / `volumeMount`
  // pieces; humans pipe `.yaml` to kubectl: `h2a deploy k8s-sidecar | jq -r .yaml`.
  streams.stdout.write(
    `${JSON.stringify(
      {
        target: "k8s-sidecar",
        container: fragment.container,
        volume: fragment.volume,
        mainContainerVolumeMount: fragment.mainContainerVolumeMount,
        yaml: fragment.yaml
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function cmdDeployTenant(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  // DEC-067: render the full cluster-tenant manifest for Scenario B of DEC-056
  // (shared RWX store coordinated by the lease lock, DEC-065/066).
  const replicas = flags.replicas ? Number.parseInt(flags.replicas, 10) : undefined;
  if (flags.replicas && (!Number.isFinite(replicas) || (replicas as number) < 1)) {
    streams.stderr.write(
      `h2a deploy k8s-tenant: --replicas must be a positive integer (got "${flags.replicas}")\n`
    );
    return 1;
  }
  const leaseMs = flags["lease-ms"] ? Number.parseInt(flags["lease-ms"], 10) : undefined;
  if (flags["lease-ms"] && (!Number.isFinite(leaseMs) || (leaseMs as number) < 1)) {
    streams.stderr.write(
      `h2a deploy k8s-tenant: --lease-ms must be a positive integer (got "${flags["lease-ms"]}")\n`
    );
    return 1;
  }

  const manifest = renderK8sTenant({
    namespace: flags.namespace,
    root: flags.root,
    replicas,
    storage: flags.storage,
    storageClass: flags["storage-class"],
    leaseMs,
    image: flags.image,
    cliVersion: flags["cli-version"]
  });

  const writeTo = flags.write;
  if (writeTo) {
    try {
      mkdirSync(dirname(writeTo), { recursive: true });
      writeFileSync(writeTo, manifest.yaml, "utf8");
    } catch (error) {
      streams.stderr.write(
        `h2a deploy k8s-tenant: cannot write ${writeTo} (${(error as Error).message})\n`
      );
      return 3;
    }
    streams.stdout.write(
      `${JSON.stringify({ ok: true, target: "k8s-tenant", path: writeTo }, null, 2)}\n`
    );
    return 0;
  }

  streams.stdout.write(
    `${JSON.stringify(
      {
        target: "k8s-tenant",
        documents: manifest.documents,
        yaml: manifest.yaml
      },
      null,
      2
    )}\n`
  );
  return 0;
}

// ── WP-5: keepalive ────────────────────────────────────────────────────────

/**
 * Single-pass keepalive logic, testable without real tmux.
 *
 * For each presence file under `root`, if the session has a
 * `launchContext.tmux.pane` that is in `livePanes`, rewrite its `heartbeatAt`
 * to `now` so the session does not expire.
 */
export function keepaliveOnce(opts: {
  root: string;
  livePanes: Set<string>;
  now?: Date;
}): Array<{ instance: string; sessionId: string; pane: string }> {
  const { root, livePanes } = opts;
  const nowIso = (opts.now ?? new Date()).toISOString();
  const refreshed: Array<{ instance: string; sessionId: string; pane: string }> = [];
  // includeExpired=true so we can refresh sessions that are about to expire
  const sessions = listPresence(root, { includeExpired: true });
  for (const session of sessions) {
    const pane = session.launchContext?.tmux?.pane;
    if (!pane) continue;
    if (!livePanes.has(pane)) continue;
    // Rewrite heartbeatAt to now
    const updated = { ...session, heartbeatAt: nowIso };
    try {
      writePresence(root, updated);
      refreshed.push({ instance: session.instance, sessionId: session.sessionId, pane });
    } catch {
      // best-effort — ignore write failures
    }
  }
  return refreshed;
}

/**
 * `h2a keepalive [--root <path>] [--interval <ms>] [--once]`
 *
 * External keepalive prober: runs by the launcher/remote so a host-suspended
 * `mcp-serve` still shows live as long as its tmux pane is alive. `--once`
 * does a single pass then exits 0. Without `--once`, loops on an unref'd
 * interval (default 30 000 ms).
 */
export async function cmdKeepalive(
  flags: Record<string, string>,
  streams: H2ACliStreams
): Promise<number> {
  const cwd = streams.cwd ?? (() => process.cwd());
  const root = resolveRoot(flags, cwd);
  const intervalMs = flags.interval ? Number.parseInt(flags.interval, 10) : 30_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    streams.stderr.write(
      `h2a keepalive: --interval must be >= 1000 ms (got "${flags.interval}")\n`
    );
    return 1;
  }

  function getLivePanes(): Set<string> {
    try {
      const out = execFileSync("tmux", ["list-panes", "-aF", "#{pane_id}"], {
        encoding: "utf8",
        timeout: 5000
      });
      const panes = new Set(
        out
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
      );
      return panes;
    } catch {
      streams.stderr.write(
        "h2a keepalive: tmux not available or returned an error — treating live-pane set as empty.\n"
      );
      return new Set<string>();
    }
  }

  function runOnce(): void {
    const livePanes = getLivePanes();
    const refreshed = keepaliveOnce({ root, livePanes });
    for (const item of refreshed) {
      streams.stdout.write(
        `h2a keepalive: refreshed ${item.instance} (session ${item.sessionId}, pane ${item.pane})\n`
      );
    }
  }

  runOnce();

  if (flags.once !== undefined) {
    return 0;
  }

  // Long-running loop — unref the interval so it does not keep the process alive.
  return new Promise<number>((resolve) => {
    const timer = setInterval(() => {
      runOnce();
    }, intervalMs);
    timer.unref();
    // The process will exit naturally when there is nothing else keeping it alive.
    // For tests that want to abort, they should pass --once.
    void resolve; // keep linter happy
  });
}

// P3 (façade track) — les verbes track sont délégués à la CLI `@sentropic/track`
// par shell-out (le store `.track` est append-only single-writer : pas de 2ᵉ writer).
// Verbes spécifiques, sans namespace `track` (dissous comme host/sub).
export const TRACK_FACADE_VERBS = new Set([
  "decision", "report", "accept", "blocker", "item", "query",
  "consolidate", "priority", "branch", "focus", "ingest", "restructure", "snapshot"
]);

// ④ de-spawn — a strict SUBSET of the facade verbs routed IN-PROCESS via
// `@sentropic/track`'s `runCli`, no child process. Every native verb is proven
// SYNC in the pinned track (dispatches through runCli's synchronous switch and
// returns a `number`); the ONLY async verb, `focus` (dynamic
// `import('@sentropic/focus')` → Promise), is deliberately excluded and keeps
// shelling out. All paths resolve the SAME `.track` (native uses
// `process.cwd()`, the spawn inherits it) and share track's single O_EXCL lock —
// no split-brain, no second writer.
//
// The native set is split READ-ONLY vs WRITE because the throw-fallback rule
// differs (RISK: double-write, see `delegateToTrackNative`):
//   • READ-ONLY (`query`/`report`/`snapshot`) — a native throw wrote nothing, so falling
//     back to the spawn facade is safe.
//   • WRITE (the rest) — track's `appendCommand` is ATOMIC under the O_EXCL lock
//     (read→validate→append→writeHead→verify): it throws either BEFORE the
//     append (validation → nothing written) or AFTER a landed write (the
//     verify receipt). A spawn fallback on that throw could DOUBLE-WRITE, so a
//     write NEVER falls back on throw — it propagates the error (rc≠0 + stderr).
export const TRACK_NATIVE_READONLY_VERBS = new Set(["query", "report", "snapshot"]);

// ④ tranche-2 — the SYNC write verbs, de-spawned in-process. Each dispatches
// through runCli's mutating switch as a plain sync `cmd…` returning a `number`.
// `focus` is absent (async); `restructure`/`ingest` are sync file-plan applies.
export const TRACK_NATIVE_WRITE_VERBS = new Set([
  "decision", "item", "accept", "blocker",
  "consolidate", "priority", "branch", "ingest", "restructure"
]);

// Union of the in-process verbs (read-only + sync writes). `focus` (async) is
// NOT here and keeps the spawn facade. Kept exported as the single "is this verb
// native?" predicate used by the dispatcher and the contract tests.
export const TRACK_NATIVE_VERBS = new Set([
  ...TRACK_NATIVE_READONLY_VERBS,
  ...TRACK_NATIVE_WRITE_VERBS
]);

/**
 * Consolidation ④-S2 — serve the read-only track MCP IN-PROCESS (native `h2a
 * track-mcp` verb). Reuses `@sentropic/track`'s shared `serveTrackMcpStdio`,
 * lazy-imported so the MCP stdio transport loads ONLY for this verb (not on every
 * h2a invocation). The store is resolved lazily by track per read call
 * (`--track-dir`→`TRACK_DIR`→nearest-ancestor `.track`). stdout stays pure
 * JSON-RPC (track logs to stderr); a real connect/transport failure → rc=1.
 */
export async function runTrackMcpServe(
  flags: Record<string, string>,
  io: { stderr: NodeJS.WritableStream; cwd?: () => string; signal?: AbortSignal } = {
    stderr: process.stderr
  }
): Promise<number> {
  const cwd = (io.cwd ?? (() => process.cwd()))();
  const flag = flags["track-dir"];
  const env = process.env["TRACK_DIR"];
  const source = {
    cwd,
    ...(flag !== undefined ? { flag } : {}),
    ...(env !== undefined ? { env } : {})
  };
  try {
    const { serveTrackMcpStdio } = await import("@sentropic/track/mcp");
    await serveTrackMcpStdio(source, io.signal !== undefined ? { signal: io.signal } : {});
    return 0;
  } catch (err) {
    io.stderr.write(`h2a track-mcp: ${(err as Error).message}\n`);
    return 1;
  }
}

function cmdReportContext(
  flags: Record<string, string>,
  streams: H2ACliStreams
): number {
  const workspaceRoot = flags["workspace-root"];
  if (!workspaceRoot || workspaceRoot === "true") {
    streams.stderr.write("h2a report-context: --workspace-root <absolute-path> is required\n");
    return 1;
  }
  if (!isAbsolute(workspaceRoot)) {
    streams.stderr.write("h2a report-context: --workspace-root must be an absolute path\n");
    return 1;
  }
  try {
    const context = readH2AReportContext({
      storeRoot: resolveRoot(flags, streams.cwd ?? (() => process.cwd())),
      workspaceRoot
    });
    streams.stdout.write(`${JSON.stringify(context)}\n`);
    return 0;
  } catch (err) {
    streams.stderr.write(`h2a report-context: ${(err as Error).message}\n`);
    return 3;
  }
}

function resolveTrackBin(): string {
  // Le champ `exports` de @sentropic/track bloque l'accès à ./package.json,
  // donc on résout l'entrée puis on remonte jusqu'au package.json du package.
  const req = createRequire(import.meta.url);
  let dir = dirname(req.resolve("@sentropic/track"));
  for (let depth = 0; depth < 8 && dir !== dirname(dir); depth++) {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      const pkg = JSON.parse(readFileSync(pj, "utf8")) as {
        name?: string;
        bin?: { track?: string };
      };
      if (pkg.name === "@sentropic/track" && pkg.bin?.track) {
        return join(dir, pkg.bin.track);
      }
    }
    dir = dirname(dir);
  }
  throw new Error("@sentropic/track: bin `track` introuvable");
}

function delegateToTrack(argv: readonly string[], streams: H2ACliStreams): number {
  try {
    const trackBin = resolveTrackBin();
    const res = spawnSync(process.execPath, [trackBin, ...argv], { stdio: "inherit" });
    return res.status ?? 1;
  } catch (err) {
    streams.stderr.write(
      `h2a ${argv[0]}: délégation à @sentropic/track échouée (${(err as Error).message}). ` +
        `Vérifie que @sentropic/track est installé.\n`
    );
    return 1;
  }
}

/**
 * ④ — run a track verb IN-PROCESS via `@sentropic/track`'s `runCli`.
 *
 * Split-brain mitigation (RISK #1): the native call resolves `.track` from
 * `process.cwd()` — the SAME cwd the spawn facade inherits (`spawnSync` with no
 * `cwd` option) — so both paths bind the identical store, and track's own
 * O_EXCL lock still serialises them. We deliberately do NOT wrap the call in any
 * h2a file-lock: track's lock is not re-entrant, and the facade never took one.
 *
 * Output is BUFFERED, then flushed only on a synchronous result.
 *
 * Two escape hatches, and the DOUBLE-WRITE rule (RISK #2) that separates them:
 *   • `runCli` returns a Promise — an async verb (e.g. `focus`) that has NOT yet
 *     written synchronously. The buffer is discarded and we fall back to the
 *     spawn facade. Safe for reads AND writes; unreachable for the shipped set
 *     (only sync verbs are routed here), so it is a defensive belt.
 *   • `runCli` throws — an UNEXPECTED escape from track's own try/catch. For a
 *     `readOnly` verb nothing was written, so we fall back to the spawn facade.
 *     For a WRITE verb we MUST NOT re-run: track's `appendCommand` is atomic
 *     (throws BEFORE the append on validation, or AFTER a landed write on the
 *     verify receipt), so a spawn retry could double-write. We flush the buffered
 *     native output and propagate a non-zero rc + stderr instead.
 */
function delegateToTrackNative(
  argv: readonly string[],
  streams: H2ACliStreams,
  readOnly: boolean
): number {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  const io: CliIO = {
    // CRITICAL: same root as the spawn facade inherits. Do NOT swap in
    // `streams.cwd` here — divergence would split-brain the two paths.
    cwd: process.cwd(),
    out: (s) => {
      outBuf.push(s);
    },
    err: (s) => {
      errBuf.push(s);
    }
  };
  try {
    const rc = runTrackCli([...argv], io);
    // Async verb (Promise) — nothing written synchronously yet, so a spawn
    // fallback cannot double-write. Not representable for the shipped sync set.
    if (rc !== null && typeof rc === "object" && typeof (rc as { then?: unknown }).then === "function") {
      return delegateToTrack(argv, streams);
    }
    for (const s of outBuf) streams.stdout.write(s);
    for (const s of errBuf) streams.stderr.write(s);
    return rc as number;
  } catch (err) {
    // READ-ONLY throw: nothing persisted → the spawn facade may safely re-run.
    if (readOnly) {
      return delegateToTrack(argv, streams);
    }
    // WRITE throw (anti-double-write): DO NOT re-run. `appendCommand` is atomic,
    // so either nothing landed or the write already landed — a spawn retry could
    // append a second event. Flush what the native path emitted and fail loud.
    for (const s of outBuf) streams.stdout.write(s);
    for (const s of errBuf) streams.stderr.write(s);
    streams.stderr.write(
      `h2a ${argv[0]}: track write failed in-process (${(err as Error).message}). ` +
        `No spawn retry — the store append is atomic; a retry could double-write.\n`
    );
    return 1;
  }
}

export function runCli(
  argv: readonly string[] = process.argv.slice(2),
  streams: H2ACliStreams = {
    stdout: process.stdout,
    stderr: process.stderr
  },
  options: H2ACliOptions = {}
): number {
  const { command, flags } = parseFlags(argv);

  if (command && TRACK_FACADE_VERBS.has(command)) {
    // ④: read-only + sync-write verbs run in-process; `focus` (async) keeps
    // shelling out. Same `.track`, same lock. A native WRITE never falls back to
    // spawn on throw (anti-double-write) — hence the read-only flag below.
    if (TRACK_NATIVE_VERBS.has(command)) {
      return delegateToTrackNative(argv, streams, TRACK_NATIVE_READONLY_VERBS.has(command));
    }
    return delegateToTrack(argv, streams);
  }

  if (!command || command === "--help" || command === "-h" || command === "help") {
    streams.stdout.write(`${renderCliHelp()}\n`);
    return 0;
  }

  // `explain` — the grouped command map. Added 2026-07-25 as a NEW verb; it
  // repurposes no existing argv and no existing output. DEC-034's no-argv-is-help
  // rule above is untouched: bare `h2a` still renders `renderCliHelp()`.
  //
  // GRAMMAR, and why it is strict. Review measured that this verb accepted
  // ANY trailing argv and returned the map with exit 0 — `explain foo`,
  // `explain --json`, `explain --root /tmp` all "succeeded". That contradicted
  // the contract, which declares no flags at all, and it manufactures a
  // successful-looking result for input nobody implemented: a caller who pipes
  // `explain --json` into a JSON parser gets prose and exit 0.
  //
  // The ambient convention in this file is laxer — `hosts foo` and
  // `mcp-tools --json` also exit 0, measured. `explain` is deliberately NOT
  // following it, because it is a NEW verb: no caller can already depend on
  // junk argv being tolerated, so strictness is free here and impossible to
  // retrofit later without a breaking change. Tightening the siblings is a
  // separate change against verbs that DO have callers, and is not in scope.
  //
  // Accepted: bare `explain`, plus `--help`/`-h` which print the same map (the
  // map IS this verb's help; erroring there would be user-hostile). Everything
  // else — any other flag, any positional — is a usage error: exit 1, nothing
  // on stdout, the offending token named on stderr. `optionalFlags: ["help"]`
  // and `exitCodes: [0, 1]` in cli-contract.ts say exactly this.
  if (command === "explain") {
    const rest = argv.slice(1);
    const unsupported = rest.filter((token) => token !== "--help" && token !== "-h");
    if (unsupported.length > 0) {
      streams.stderr.write(
        `h2a explain: unsupported argument${unsupported.length > 1 ? "s" : ""}: ${unsupported.join(", ")}\n` +
          "  usage: h2a explain [--help]\n" +
          "  `explain` takes no arguments; it always prints the whole grouped map.\n"
      );
      return 1;
    }
    streams.stdout.write(`${renderCommandMap([...TRACK_FACADE_VERBS])}\n`);
    return 0;
  }

  if (command === "hosts") {
    streams.stdout.write(`${JSON.stringify(CLI_HOSTS, null, 2)}\n`);
    return 0;
  }

  if (command === "mcp-tools") {
    streams.stdout.write(`${JSON.stringify(H2A_CLI_MCP_TOOL_NAMES, null, 2)}\n`);
    return 0;
  }

  if (command === "report-context") return cmdReportContext(flags, streams);

  if (command === "init") return cmdInit(flags, streams);
  if (command === "register") return cmdRegister(flags, streams);
  if (command === "discover") return cmdDiscover(flags, streams);
  if (command === "subagent") return cmdSubagent(argv.slice(1), streams);
  if (command === "loop") return cmdLoop(argv.slice(1), streams);
  if (command === "canevas") return cmdCanevas(argv.slice(1), streams);
  if (command === "harness") return cmdHarness(argv.slice(1), streams);
  if (command === "drumbeat") {
    const sub = argv[1];
    if (sub === "watch") {
      streams.stderr.write("h2a drumbeat watch: async daemon — run via the h2a binary, not the synchronous API.\n");
      return 1;
    }
    return cmdDrumbeat(argv.slice(1), streams);
  }
  if (command === "upgrade") return cmdUpgrade(flags, streams);
  if (command === "nhi") return cmdNhi(argv.slice(1), streams);
  if (command === "org") return cmdOrg(argv.slice(1), streams);
  if (command === "coach") return cmdCoach(argv.slice(1), streams);
  if (command === "blockage") return cmdBlockage(argv.slice(1), streams);
  if (command === "sysml") {
    const sub = argv[1];
    if (sub === "verify") {
      streams.stderr.write(
        "h2a sysml verify: async verb — run via the h2a binary, not the synchronous API.\n"
      );
      return 1;
    }
    streams.stderr.write("h2a sysml: subcommand required (verify).\n");
    return 1;
  }
  if (command === "negotiate") return cmdNegotiate(argv.slice(1), streams);
  if (command === "declare-interest") return cmdDeclareInteret(flags, streams);
  if (command === "conflict-posture") return cmdConflictPosture(flags, streams);
  if (command === "dossier") return cmdDossier(flags, streams);
  if (command === "confiance") return cmdConfiance(flags, streams);
  if (command === "attest-comprehension") return cmdAttestComprehension(flags, streams);
  if (command === "comprehension") return cmdComprehension(argv.slice(1), streams);
  if (command === "inbox") return cmdMailbox(argv.slice(1), "inbox", streams);
  if (command === "outbox") return cmdMailbox(argv.slice(1), "outbox", streams);
  if (command === "host") return cmdHost(argv.slice(1), streams);
  if (command === "store") return cmdStore(argv.slice(1), streams);
  if (command === "thread") return cmdThread(flags, streams);
  if (command === "sessions") return cmdSessions(flags, streams);
  if (command === "status") return cmdStatus(flags, streams);
  if (command === "doctor") return cmdDoctor(flags, streams, options);
  if (command === "presence-reap") return cmdPresenceReap(flags, streams);
  if (command === "connect") return cmdConnect(flags, streams);
  if (command === "conductor") return cmdConductor(argv.slice(1), streams);
  if (command === "conductor-launch-check") return cmdConductorLaunchCheck(argv.slice(1), streams);
  if (command === "conductor-launch") return cmdConductorLaunch(argv.slice(1), streams);
  if (command === "wake-request") return cmdWakeRequest(argv.slice(1), streams);
  if (command === "keepalive") {
    streams.stderr.write(
      "h2a keepalive: async command — run via the h2a binary, not the synchronous API.\n"
    );
    return 1;
  }
  if (command === "install-skills") return cmdInstallSkills(flags, streams);
  if (command === "deploy") return cmdDeploy(argv.slice(1), streams);
  if (command === "drive") {
    if (argv[1] === "receive") {
      return cmdDriveReceive(parseFlags(argv.slice(1)).flags, streams);
    }
    if (argv[1] === "serve") {
      streams.stderr.write(
        "h2a drive serve: async verb — run via the h2a binary, not the synchronous API.\n"
      );
      return 1;
    }
    return cmdDrive(flags, streams);
  }
  if (command === "remote") {
    // `remote serve`/`remote send` are async and dispatched from bin.ts; if we
    // reach here it is a misuse (e.g. via the sync runCli) or an unknown sub.
    const sub = argv[1];
    if (sub === "serve" || sub === "send") {
      streams.stderr.write(
        `h2a remote ${sub}: async verb — run via the h2a binary, not the synchronous API.\n`
      );
      return 1;
    }
    streams.stderr.write(
      `h2a remote: subcommand required (serve, send).\n`
    );
    return 1;
  }
  if (command === "keys") {
    const { command: sub, flags: subFlags } = parseFlags(argv.slice(1));
    if (sub === "generate") return cmdKeysGenerate(subFlags, streams);
    if (sub === "add") return cmdKeysAdd(subFlags, streams);
    if (sub === "list") return cmdKeysList(subFlags, streams);
    if (sub === "revoke") return cmdKeysRevoke(subFlags, streams);
    if (sub === "prove-control") return cmdKeysProveControl(subFlags, streams);
    streams.stderr.write(
      `h2a keys: unknown subcommand "${sub ?? ""}" (generate, add, list, revoke, prove-control)\n`
    );
    return 1;
  }

  streams.stderr.write(`Unknown command: ${command}\n`);
  streams.stderr.write("Run `h2a --help`.\n");
  return 1;
}

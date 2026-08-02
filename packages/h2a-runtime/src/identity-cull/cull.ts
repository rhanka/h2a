/**
 * Read-only DEF identity-cull analysis for SPEC #156.
 *
 * This module intentionally has no active-store mutation path.  It does,
 * however, implement and verify the canonical binding-fence + held-descriptor
 * CAS needed by a future, separately owner-authorized executor.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type GateVerdict = "PASS" | "FAIL" | "UNKNOWN";
export type CullDecision = "WOULD_CULL" | "KEEP";

export interface GateResult {
  readonly verdict: GateVerdict;
  readonly reason: string;
}

export interface IdentityBinding {
  readonly host: string;
  readonly providerSessionId: string;
  readonly workspaceId: string;
  readonly instance: string;
  readonly agentUuid: string;
  readonly at: string;
}

interface BindingRowBase {
  readonly lineNumber: number;
  readonly rowFingerprint: string;
  readonly exactLineBase64: string;
}

interface ValidBindingRow extends BindingRowBase {
  readonly kind: "valid";
  readonly binding: IdentityBinding;
}

interface MalformedBindingRow extends BindingRowBase {
  readonly kind: "malformed";
  readonly parseError: string;
}

type BindingRow = ValidBindingRow | MalformedBindingRow;

interface IdentityComponent {
  readonly id: string;
  readonly rows: readonly BindingRow[];
  readonly edges: readonly ComponentEdge[];
  readonly conflicts: readonly string[];
}

interface ComponentEdge {
  readonly kind: "instance" | "agentUuid" | "providerSession";
  readonly leftLine: number;
  readonly rightLine: number;
}

export interface BindingSnapshot {
  readonly canonicalPath: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly lineCount: number;
  readonly sha256: string;
  readonly bytes: Buffer;
}

export interface CullEvidenceInput {
  readonly life?: {
    readonly complete: boolean;
    readonly noLife: boolean;
    readonly twoObservationsAgree: boolean;
    readonly resumeSafe: boolean;
    readonly liveReferences?: readonly string[];
  };
  readonly ownership?: {
    readonly complete: boolean;
    readonly noOwnedWork: boolean;
    readonly ownedReferences?: readonly string[];
  };
  readonly protectedSetComplete?: boolean;
}

export interface IdentityCullInput {
  /** Must identify the canonical DEF .h2a root, never a loose bindings file. */
  readonly defRoot: string;
  /** A new directory outside both DEF and PIN where the immutable packet is written. */
  readonly outputDir: string;
  /** The protected PIN root. It is only read, never opened for output. */
  readonly pinRoot: string;
  readonly ownerAllowlist?: readonly string[];
  readonly evidence?: CullEvidenceInput;
  readonly operator?: string;
  readonly now?: () => Date;
  /** Test-only interleaving seam, invoked immediately before each packet mutation. */
  readonly beforePacketWrite?: (attempt: PacketWriteAttempt) => void;
}

export interface PacketWriteAttempt {
  readonly kind: "directory" | "file";
  readonly name: string;
  readonly packetRoot: string;
}

export interface CullRunResult {
  readonly packetDir: string;
  readonly componentCount: number;
  readonly cullSetSize: number;
  readonly keepReasonHistogram: Readonly<Record<string, number>>;
  readonly summaryPath: string;
  readonly snapshot: Pick<BindingSnapshot, "canonicalPath" | "size" | "sha256">;
}

const PIN_ACTORS = [
  "claude:h2a:e3c21fe83da3",
  "claude:h2a:c18853e319ea",
  "claude:h2a:87db03b72762",
  "e3c21fe8-3da3-4cf3-a837-6fdbadda8d95",
  "c18853e3-19ea-410f-bba8-88f69d97d9b5",
  "87db03b7-2762-43fb-8977-8dd67f625c82",
] as const;

const LIVE_DEF_CONTROLS = [
  "claude:h2a:16f6e26295a3",
  "claude:h2a:c3d1621ed118",
  "claude:h2a:8b329a6c9c31",
] as const;

const IDENTITY_BINDING_FENCE_PROTOCOL = "identity-binding-fence-v1";

/**
 * #160 only stages the §4-§6 proof packet. Per SPEC #156 §7.1 and §8, the
 * executor—not staging—owns the final compare-to-rename critical section.
 * A real staging-to-executor handoff transfers the held fence and descriptor;
 * staging must never release and then reacquire that fence around a rename.
 */
const EXECUTOR_FENCE_HANDOFF_CONTRACT = {
  specReference: "SPEC #156 §7.1 and §8",
  executorScope: "The executor holds the canonical fence exclusively from the final held-descriptor compare through descriptor-relative rename and read-back.",
  transferRule: "A staging-to-executor handoff transmits the held fence and descriptor; staging must not release and reacquire them around the rename.",
} as const;

function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: keyof IdentityBinding): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseBindingLine(bytes: Buffer, lineNumber: number): BindingRow {
  const fingerprint = sha256(bytes);
  const exactLineBase64 = bytes.toString("base64");
  let text = bytes.toString("utf8");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  if (text.endsWith("\r")) text = text.slice(0, -1);
  if (text.length === 0) {
    return { kind: "malformed", lineNumber, rowFingerprint: fingerprint, exactLineBase64, parseError: "EMPTY_JSONL_ROW" };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("JSON_VALUE_NOT_OBJECT");
    const host = requiredString(parsed, "host");
    const providerSessionId = requiredString(parsed, "providerSessionId");
    const workspaceId = requiredString(parsed, "workspaceId");
    const instance = requiredString(parsed, "instance");
    const agentUuid = requiredString(parsed, "agentUuid");
    const at = requiredString(parsed, "at");
    if (!host || !providerSessionId || !workspaceId || !instance || !agentUuid || !at) {
      throw new Error("BINDING_SCHEMA_INVALID");
    }
    return {
      kind: "valid",
      lineNumber,
      rowFingerprint: fingerprint,
      exactLineBase64,
      binding: { host, providerSessionId, workspaceId, instance, agentUuid, at },
    };
  } catch (error) {
    return {
      kind: "malformed",
      lineNumber,
      rowFingerprint: fingerprint,
      exactLineBase64,
      parseError: error instanceof Error ? error.message : "JSON_PARSE_FAILED",
    };
  }
}

function parseExactRows(bytes: Buffer): BindingRow[] {
  const rows: BindingRow[] = [];
  let start = 0;
  let lineNumber = 1;
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] !== 0x0a) continue;
    rows.push(parseBindingLine(bytes.subarray(start, offset + 1), lineNumber));
    start = offset + 1;
    lineNumber += 1;
  }
  if (start < bytes.length) rows.push(parseBindingLine(bytes.subarray(start), lineNumber));
  return rows;
}

function assertRegularNonSymlink(path: string, description: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${description} must be a regular non-symlink file: ${path}`);
  }
}

function captureBindings(root: string): BindingSnapshot {
  const canonicalRoot = realpathSync(root);
  const identityDir = join(canonicalRoot, "identity");
  const identityStat = lstatSync(identityDir);
  if (identityStat.isSymbolicLink() || !identityStat.isDirectory()) {
    throw new Error(`DEF identity directory must be a real directory: ${identityDir}`);
  }
  const bindingsPath = join(identityDir, "bindings.jsonl");
  assertRegularNonSymlink(bindingsPath, "DEF bindings");
  const fd = openSync(bindingsPath, "r");
  try {
    const before = fstatSync(fd);
    const bytes = Buffer.alloc(before.size);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, read);
      if (count === 0) throw new Error("DEF bindings changed while being captured");
      read += count;
    }
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error("DEF bindings descriptor changed while being captured");
    }
    return {
      canonicalPath: realpathSync(bindingsPath),
      device: Number(before.dev),
      inode: Number(before.ino),
      size: before.size,
      lineCount: parseExactRows(bytes).length,
      sha256: sha256(bytes),
      bytes,
    };
  } finally {
    closeSync(fd);
  }
}

function isInside(path: string, root: string): boolean {
  const result = relative(root, path);
  return result === "" || (!result.startsWith("..") && !isAbsolute(result));
}

interface HeldPacketDirectory {
  readonly fd: number;
  readonly canonicalPath: string;
  /** Approved packet root captured before the packet-writing window opens. */
  readonly packetRoot: string;
  readonly defRoot: string;
  readonly pinRoot: string;
  readonly beforePacketWrite?: (attempt: PacketWriteAttempt) => void;
}

function descriptorPath(fd: number, name?: string): string {
  if (name !== undefined && (name.length === 0 || name.includes(sep) || name === "." || name === "..")) {
    throw new Error(`unsafe descriptor-relative packet name: ${name}`);
  }
  return name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`;
}

function openNoFollowDirectory(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isDirectory()) throw new Error(`packet path component is not a directory: ${path}`);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function assertDirectoryOutsideProtectedRoots(fd: number, defRoot: string, pinRoot: string): string {
  const canonicalPath = realpathSync(descriptorPath(fd));
  if (isInside(canonicalPath, defRoot) || isInside(canonicalPath, pinRoot)) {
    throw new Error("packet output must be outside both DEF and PIN roots");
  }
  return canonicalPath;
}

/**
 * A directory descriptor follows its inode across rename. Therefore containment
 * is an operation guard, not a setup check: re-resolve the held target FD just
 * before every packet mutation and reject an escaped or protected location.
 */
function assertPacketWriteContainment(
  directory: HeldPacketDirectory,
  kind: PacketWriteAttempt["kind"],
  name: string,
): void {
  directory.beforePacketWrite?.({ kind, name, packetRoot: directory.packetRoot });
  const canonicalPath = realpathSync(descriptorPath(directory.fd));
  if (
    !isInside(canonicalPath, directory.packetRoot)
    || isInside(canonicalPath, directory.defRoot)
    || isInside(canonicalPath, directory.pinRoot)
  ) {
    throw new Error("packet write containment lost: directory escaped approved packet root or entered DEF/PIN");
  }
}

/**
 * Create and pin a fresh packet directory without trusting the supplied path
 * after traversal begins.  Every component is lstat'd and opened with
 * O_NOFOLLOW relative to the descriptor for its already-pinned parent; packet
 * members are subsequently opened relative to the returned descriptor only.
 */
function openPacketOutputDirectory(outputDir: string, defRoot: string, pinRoot: string): HeldPacketDirectory {
  const absoluteOutput = resolve(outputDir);
  const components = relative(sep, absoluteOutput).split(sep).filter(Boolean);
  if (components.length === 0) throw new Error("packet output directory must be a new non-root directory");

  let currentFd = openNoFollowDirectory(sep);
  try {
    for (const [index, component] of components.entries()) {
      const componentPath = descriptorPath(currentFd, component);
      const isFinalComponent = index === components.length - 1;
      let createdFinalComponent = false;
      let stat;
      try {
        stat = lstatSync(componentPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" || !isFinalComponent) {
          throw new Error(`packet output path has a missing or inaccessible ancestor: ${absoluteOutput}`);
        }
        assertDirectoryOutsideProtectedRoots(currentFd, defRoot, pinRoot);
        mkdirSync(componentPath, { recursive: false, mode: 0o700 });
        createdFinalComponent = true;
        stat = lstatSync(componentPath);
      }
      if (stat.isSymbolicLink()) {
        throw new Error(`packet output path refuses symlink component: ${component}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`packet output path component is not a directory: ${component}`);
      }
      if (isFinalComponent && !createdFinalComponent) {
        throw new Error(`packet output directory already exists: ${absoluteOutput}`);
      }
      const nextFd = openNoFollowDirectory(componentPath);
      closeSync(currentFd);
      currentFd = nextFd;
    }

    const canonicalPath = assertDirectoryOutsideProtectedRoots(currentFd, defRoot, pinRoot);
    return {
      fd: currentFd,
      canonicalPath,
      packetRoot: canonicalPath,
      defRoot,
      pinRoot,
    };
  } catch (error) {
    closeSync(currentFd);
    throw error;
  }
}

function createPacketDirectory(parent: HeldPacketDirectory, name: string): HeldPacketDirectory {
  assertPacketWriteContainment(parent, "directory", name);
  const path = descriptorPath(parent.fd, name);
  mkdirSync(path, { recursive: false, mode: 0o700 });
  const fd = openNoFollowDirectory(path);
  try {
    const canonicalPath = realpathSync(descriptorPath(fd));
    if (
      !isInside(canonicalPath, parent.packetRoot)
      || isInside(canonicalPath, parent.defRoot)
      || isInside(canonicalPath, parent.pinRoot)
    ) {
      throw new Error("packet write containment lost: directory escaped approved packet root or entered DEF/PIN");
    }
    const childDirectory = {
      fd,
      canonicalPath,
      packetRoot: parent.packetRoot,
      defRoot: parent.defRoot,
      pinRoot: parent.pinRoot,
    };
    return parent.beforePacketWrite === undefined
      ? childDirectory
      : { ...childDirectory, beforePacketWrite: parent.beforePacketWrite };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writePacketFile(directory: HeldPacketDirectory, name: string, bytes: string | Buffer, mode = 0o600): void {
  // Opening with O_CREAT is itself a mutation; protect that boundary first.
  assertPacketWriteContainment(directory, "file", name);
  const fd = openSync(
    descriptorPath(directory.fd, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    mode,
  );
  try {
    // The target directory FD is re-checked again immediately before bytes are written.
    assertPacketWriteContainment(directory, "file", name);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readPacketFile(directory: HeldPacketDirectory, name: string): Buffer {
  const fd = openSync(descriptorPath(directory.fd, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`packet member is not a regular file: ${name}`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readOptionalPinBindings(pinRoot: string):
  | { readonly snapshot: BindingSnapshot; readonly sourcePath: string }
  | { readonly reason: string } {
  try {
    const canonicalPin = realpathSync(pinRoot);
    const candidates = [
      join(canonicalPin, "identity", "bindings.jsonl"),
      join(canonicalPin, ".h2a", "identity", "bindings.jsonl"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) return { reason: "PIN_BINDINGS_UNAVAILABLE" };
    assertRegularNonSymlink(path, "PIN bindings");
    const root = path.endsWith(join(".h2a", "identity", "bindings.jsonl"))
      ? join(canonicalPin, ".h2a")
      : canonicalPin;
    return { snapshot: captureBindings(root), sourcePath: path };
  } catch (error) {
    return { reason: error instanceof Error ? `PIN_BINDINGS_ERROR:${error.message}` : "PIN_BINDINGS_ERROR" };
  }
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_value, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index];
    if (parent === undefined) throw new Error(`invalid union-find index ${index}`);
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function componentize(rows: readonly BindingRow[]): IdentityComponent[] {
  const unionFind = new UnionFind(rows.length);
  const edges: ComponentEdge[] = [];
  const byInstance = new Map<string, number>();
  const byUuid = new Map<string, number>();
  const byProviderSession = new Map<string, number>();
  const joinOn = (kind: ComponentEdge["kind"], key: string, index: number, map: Map<string, number>): void => {
    const first = map.get(key);
    if (first === undefined) {
      map.set(key, index);
      return;
    }
    unionFind.union(first, index);
    edges.push({ kind, leftLine: rows[first]!.lineNumber, rightLine: rows[index]!.lineNumber });
  };

  for (const [index, row] of rows.entries()) {
    if (row.kind !== "valid") continue;
    joinOn("instance", row.binding.instance, index, byInstance);
    joinOn("agentUuid", row.binding.agentUuid, index, byUuid);
    joinOn("providerSession", `${row.binding.host}\u0000${row.binding.providerSessionId}`, index, byProviderSession);
  }

  const grouped = new Map<number, BindingRow[]>();
  for (const [index, row] of rows.entries()) {
    const root = unionFind.find(index);
    const members = grouped.get(root);
    if (members) members.push(row);
    else grouped.set(root, [row]);
  }

  return [...grouped.values()]
    .map((members) => {
      const lineNumbers = new Set(members.map((row) => row.lineNumber));
      const memberEdges = edges.filter((edge) => lineNumbers.has(edge.leftLine) && lineNumbers.has(edge.rightLine));
      const conflicts: string[] = [];
      const uuidByInstance = new Map<string, Set<string>>();
      const instanceByUuid = new Map<string, Set<string>>();
      for (const row of members) {
        if (row.kind === "malformed") {
          conflicts.push(`MALFORMED_ROW:${row.lineNumber}`);
          continue;
        }
        const uuids = uuidByInstance.get(row.binding.instance) ?? new Set<string>();
        uuids.add(row.binding.agentUuid);
        uuidByInstance.set(row.binding.instance, uuids);
        const instances = instanceByUuid.get(row.binding.agentUuid) ?? new Set<string>();
        instances.add(row.binding.instance);
        instanceByUuid.set(row.binding.agentUuid, instances);
      }
      for (const [instance, uuids] of uuidByInstance) {
        if (uuids.size > 1) conflicts.push(`CONFLICTING_INSTANCE_UUID:${instance}`);
      }
      for (const [uuid, instances] of instanceByUuid) {
        if (instances.size > 1) conflicts.push(`CONFLICTING_UUID_INSTANCE:${uuid}`);
      }
      const orderedRows = [...members].sort((left, right) => left.lineNumber - right.lineNumber);
      return {
        id: `component:${sha256(orderedRows.map((row) => row.rowFingerprint).join("\n")).slice(7, 31)}`,
        rows: orderedRows,
        edges: memberEdges,
        conflicts: [...new Set(conflicts)].sort(),
      };
    })
    .sort((left, right) => left.rows[0]!.lineNumber - right.rows[0]!.lineNumber);
}

function componentValues(component: IdentityComponent): Set<string> {
  const values = new Set<string>();
  for (const row of component.rows) {
    if (row.kind !== "valid") continue;
    values.add(row.binding.instance);
    values.add(row.binding.agentUuid);
  }
  return values;
}

function gateLife(component: IdentityComponent, evidence: CullEvidenceInput): GateResult {
  const values = componentValues(component);
  const life = evidence.life;
  const live = life?.liveReferences?.some((reference) => values.has(reference)) ?? false;
  if (live) return { verdict: "FAIL", reason: "L_LIVE_EVIDENCE" };
  if (!life?.complete) return { verdict: "UNKNOWN", reason: "L_EVIDENCE_COVERAGE_MISSING" };
  if (!life.noLife || !life.twoObservationsAgree || !life.resumeSafe) {
    return { verdict: "UNKNOWN", reason: "L_POSITIVE_PROOF_MISSING" };
  }
  return { verdict: "PASS", reason: "L_POSITIVE_NO_LIFE_PROOF" };
}

function gateOwnership(component: IdentityComponent, evidence: CullEvidenceInput): GateResult {
  const values = componentValues(component);
  const ownership = evidence.ownership;
  const owned = ownership?.ownedReferences?.some((reference) => values.has(reference)) ?? false;
  if (owned) return { verdict: "FAIL", reason: "O_OWNED_WORK_REFERENCE" };
  if (!ownership?.complete) return { verdict: "UNKNOWN", reason: "O_EVIDENCE_COVERAGE_MISSING" };
  if (!ownership.noOwnedWork) return { verdict: "UNKNOWN", reason: "O_POSITIVE_NO_WORK_PROOF_MISSING" };
  return { verdict: "PASS", reason: "O_POSITIVE_NO_OWNED_WORK_PROOF" };
}

function ownerOrHumanReference(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("focus:local-human") || lower.includes("owner") || lower.includes("human") || lower.includes("principal") || lower.includes("antoinefa");
}

function gateProtected(
  component: IdentityComponent,
  protectedValues: ReadonlySet<string>,
  ownerAllowlist: readonly string[],
  pinAvailable: boolean,
  evidence: CullEvidenceInput,
): GateResult {
  const values = componentValues(component);
  if ([...values].some((value) => protectedValues.has(value))) {
    return { verdict: "FAIL", reason: "P_PROTECTED_IDENTITY" };
  }
  if ([...values].some(ownerOrHumanReference)) return { verdict: "FAIL", reason: "P_OWNER_HUMAN_AMBIGUITY" };
  if (ownerAllowlist.length === 0) return { verdict: "UNKNOWN", reason: "P_OWNER_ALLOWLIST_UNRATIFIED" };
  if (!pinAvailable) return { verdict: "UNKNOWN", reason: "P_PIN_SNAPSHOT_UNAVAILABLE" };
  if (!evidence.protectedSetComplete) return { verdict: "UNKNOWN", reason: "P_PROTECTED_SOURCE_COVERAGE_MISSING" };
  return { verdict: "PASS", reason: "P_POSITIVE_NOT_PROTECTED" };
}

function gateChurn(component: IdentityComponent): GateResult {
  // S_R is intentionally not accepted by this implementation.  A future root
  // fix must introduce owner-ratified, independently verified continuity edges
  // before a cull candidate can ever obtain C=PASS.
  void component;
  return { verdict: "UNKNOWN", reason: "C_MIGRATION_MAP_MISSING" };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(directory: HeldPacketDirectory, name: string, value: unknown): void {
  writePacketFile(directory, name, json(value));
}

function writeJsonLines(directory: HeldPacketDirectory, name: string, records: readonly unknown[]): void {
  writePacketFile(directory, name, records.map((record) => JSON.stringify(record)).join(records.length > 0 ? "\n" : "") + (records.length > 0 ? "\n" : ""));
}

function decisionRecord(
  component: IdentityComponent,
  gates: { readonly L: GateResult; readonly O: GateResult; readonly P: GateResult; readonly C: GateResult },
): Record<string, unknown> {
  const decision: CullDecision = Object.values(gates).every((gate) => gate.verdict === "PASS") ? "WOULD_CULL" : "KEEP";
  const keepReasons = Object.values(gates)
    .filter((gate) => gate.verdict !== "PASS")
    .map((gate) => gate.reason);
  return {
    componentId: component.id,
    rows: component.rows.map((row) => row.kind === "valid"
      ? { lineNumber: row.lineNumber, rowFingerprint: row.rowFingerprint, exactLineBase64: row.exactLineBase64, binding: row.binding }
      : { lineNumber: row.lineNumber, rowFingerprint: row.rowFingerprint, exactLineBase64: row.exactLineBase64, parseError: row.parseError }),
    edges: component.edges,
    conflicts: component.conflicts,
    gates,
    evidenceRefs: ["evidence/def-bindings.jsonl", "coverage.json", "dependencies.json"],
    decision,
    keepReasons,
  };
}

function makeLookupReplay(rows: readonly BindingRow[]): Record<string, unknown> {
  const lastWins = new Map<string, ValidBindingRow>();
  for (const row of rows) {
    if (row.kind !== "valid") continue;
    lastWins.set(`${row.binding.host}\u0000${row.binding.providerSessionId}`, row);
  }
  return {
    semantics: "last-wins(host,providerSessionId)",
    cullSetEmpty: true,
    keys: [...lastWins.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, row]) => ({
      key,
      before: { lineNumber: row.lineNumber, rowFingerprint: row.rowFingerprint, instance: row.binding.instance },
      after: { lineNumber: row.lineNumber, rowFingerprint: row.rowFingerprint, instance: row.binding.instance },
      predecessorExposed: false,
      legacyKeyRetired: false,
    })),
  };
}

function increment(histogram: Record<string, number>, reason: string): void {
  histogram[reason] = (histogram[reason] ?? 0) + 1;
}

/**
 * Produce the analysis packet.  This is intentionally the only runnable path
 * exposed by the CLI: it reads DEF/PIN and writes a new packet outside both.
 */
export function runIdentityCullDryRun(input: IdentityCullInput): CullRunResult {
  const canonicalDefRoot = realpathSync(input.defRoot);
  const canonicalPinRoot = realpathSync(input.pinRoot);
  if (isInside(canonicalDefRoot, canonicalPinRoot) || isInside(canonicalPinRoot, canonicalDefRoot)) {
    throw new Error("DEF and PIN roots must be distinct non-overlapping canonical paths");
  }
  const snapshot = captureBindings(canonicalDefRoot);
  const rows = parseExactRows(snapshot.bytes);
  const components = componentize(rows);
  const pin = readOptionalPinBindings(canonicalPinRoot);
  const pinRows = "snapshot" in pin ? parseExactRows(pin.snapshot.bytes) : [];
  const ownerAllowlist = [...(input.ownerAllowlist ?? [])].sort();
  const protectedValues = new Set<string>([...PIN_ACTORS, ...LIVE_DEF_CONTROLS, ...ownerAllowlist]);
  for (const row of pinRows) {
    if (row.kind !== "valid") continue;
    protectedValues.add(row.binding.instance);
    protectedValues.add(row.binding.agentUuid);
  }

  const evidence = input.evidence ?? {};
  const records = components.map((component) => decisionRecord(component, {
    L: gateLife(component, evidence),
    O: gateOwnership(component, evidence),
    P: gateProtected(component, protectedValues, ownerAllowlist, "snapshot" in pin, evidence),
    C: gateChurn(component),
  }));
  const wouldCull = records.filter((record) => record.decision === "WOULD_CULL");
  // An implementation error must never widen a cull set.  C is intentionally
  // UNKNOWN in this release, but retain this assertion as a hard invariant.
  if (wouldCull.length > 0) throw new Error("refusing: CULL set is not authorized in this release");
  const keep = records.filter((record) => record.decision === "KEEP");
  if (records.length !== components.length || keep.length !== components.length) {
    throw new Error("packet component reconciliation failed");
  }
  const keepReasonHistogram: Record<string, number> = {};
  for (const record of keep) {
    for (const reason of record.keepReasons as string[]) increment(keepReasonHistogram, reason);
  }

  const packet = openPacketOutputDirectory(input.outputDir, canonicalDefRoot, canonicalPinRoot);
  const packetWithWriteObserver: HeldPacketDirectory = input.beforePacketWrite === undefined
    ? packet
    : { ...packet, beforePacketWrite: input.beforePacketWrite };
  let evidenceDir: HeldPacketDirectory | undefined;
  try {
    const evidence = createPacketDirectory(packetWithWriteObserver, "evidence");
    evidenceDir = evidence;
    writePacketFile(evidence, "def-bindings.jsonl", snapshot.bytes, 0o400);
    if ("snapshot" in pin) writePacketFile(evidence, "pin-bindings.jsonl", pin.snapshot.bytes, 0o400);

    const now = (input.now ?? (() => new Date()))().toISOString();
    const coverage = {
    version: 1,
    sources: [
      { id: "def-bindings", status: "COMPLETE", parser: "strict-jsonl-v1", sha256: snapshot.sha256 },
      { id: "pin-bindings", status: "snapshot" in pin ? "COMPLETE" : "MISSING", reason: "snapshot" in pin ? undefined : pin.reason },
      { id: "owner-allowlist", status: ownerAllowlist.length > 0 ? "PRESENT_BUT_UNRATIFIED" : "MISSING" },
      { id: "fleet-presence-process-mcp-resume", status: "MISSING" },
      { id: "owned-work-and-attribution", status: "MISSING" },
      { id: "attested-defect-window", status: "MISSING" },
      { id: "S_R-root-fix-migration-map", status: "MISSING" },
    ],
  };
    const dependencies = {
    version: 1,
    gates: {
      L: ["fleet-presence-process-mcp-resume", "S_R-root-fix-migration-map"],
      O: ["owned-work-and-attribution"],
      P: ["pin-bindings", "owner-allowlist"],
      C: ["attested-defect-window", "S_R-root-fix-migration-map"],
    },
    edges: ["instance", "agentUuid", "host+providerSessionId"],
    expresslyNotEdges: ["name", "workspaceId"],
  };
    const runManifest = {
    version: 1,
    runId: randomUUID(),
    capturedAt: now,
    operator: input.operator ?? process.env.USER ?? "unknown",
    mode: "dry-run",
    def: { root: canonicalDefRoot, bindings: { path: snapshot.canonicalPath, device: snapshot.device, inode: snapshot.inode, size: snapshot.size, lineCount: snapshot.lineCount, sha256: snapshot.sha256 } },
    pin: "snapshot" in pin
      ? { root: canonicalPinRoot, bindings: { path: pin.sourcePath, sha256: pin.snapshot.sha256 } }
      : { root: canonicalPinRoot, unavailable: pin.reason },
    S_R_present: false,
    executionHardGated: true,
    fencePrimitiveProvided: true,
    checkActExecutedByStaging: false,
    "checkActIsExecutorScopePer_§7_1": true,
    handoffContract: EXECUTOR_FENCE_HANDOFF_CONTRACT,
    structuralWriterFence: {
      protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
      canonicalLockPath: join(canonicalDefRoot, "identity", ".lock"),
      epochRequired: true,
      heldDescriptorCas: "fstat+full-read+fstat size/hash primitive for the executor's immediately-pre-rename check",
      singleWriterVerification: "required before executor continuation; bypass inventory aborts",
    },
    writeSet: ["packet output only"],
  };
    const positiveControls = {
    version: 1,
    pinActors: PIN_ACTORS.map((identity) => ({ identity, presentInPin: pinRows.some((row) => row.kind === "valid" && (row.binding.instance === identity || row.binding.agentUuid === identity)), absentFromWouldCull: true })),
    liveDefActors: LIVE_DEF_CONTROLS.map((identity) => ({ identity, presentInDef: rows.some((row) => row.kind === "valid" && row.binding.instance === identity), absentFromWouldCull: true })),
    ownerAllowlist: { count: ownerAllowlist.length, absentFromWouldCull: true, status: ownerAllowlist.length > 0 ? "UNRATIFIED" : "MISSING" },
    quietSingleConversationMirror: { requiredResult: "KEEP", observedReason: "C_MIGRATION_MAP_MISSING" },
    concurrentSameNameWorkspace: { joinRule: "name/workspaceId are not component edges", observedResult: "KEEP" },
    fallbackAndOutsideWindow: { requiredResult: "KEEP", observedResult: "KEEP" },
  };
    const lookupReplay = makeLookupReplay(rows);
    const summary = {
    version: 1,
    componentCount: components.length,
    componentReconciliation: { decisions: records.length, wouldCull: wouldCull.length, keep: keep.length, reconciled: records.length === wouldCull.length + keep.length },
    cullSetSize: wouldCull.length,
    gateCounts: ["L", "O", "P", "C"].reduce<Record<string, Record<GateVerdict, number>>>((counts, name) => {
      counts[name] = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
      for (const record of records) {
        const gates = record.gates as { readonly L: GateResult; readonly O: GateResult; readonly P: GateResult; readonly C: GateResult };
        const gate = gates[name as "L" | "O" | "P" | "C"];
        counts[name]![gate.verdict] += 1;
      }
      return counts;
    }, {}),
    keepReasonHistogram,
    S_R_present: false,
    executionHardGated: true,
  };

    writeJson(packetWithWriteObserver, "run-manifest.json", runManifest);
    writeJson(packetWithWriteObserver, "coverage.json", coverage);
    writeJson(packetWithWriteObserver, "dependencies.json", dependencies);
    writeJson(evidence, "acquisition.json", { defBindings: { path: snapshot.canonicalPath, sha256: snapshot.sha256, size: snapshot.size }, pinStatus: "snapshot" in pin ? "COMPLETE" : pin.reason });
    writeJsonLines(packetWithWriteObserver, "decisions.jsonl", records);
    writeJsonLines(packetWithWriteObserver, "would-cull.jsonl", wouldCull);
    writeJsonLines(packetWithWriteObserver, "keep.jsonl", keep);
    writeJson(packetWithWriteObserver, "lookup-replay.json", lookupReplay);
    writeJson(packetWithWriteObserver, "positive-controls.json", positiveControls);
    writeJson(packetWithWriteObserver, "summary.json", summary);
    writePacketFile(packetWithWriteObserver, "report.txt", `DEF identity cull dry-run\ncomponents: ${components.length}\ncull-set: ${wouldCull.length}\nKEEP reasons: ${JSON.stringify(keepReasonHistogram)}\n`);

    const artifactPaths = [
    "run-manifest.json", "coverage.json", "dependencies.json", "evidence/def-bindings.jsonl", "evidence/acquisition.json", "decisions.jsonl", "would-cull.jsonl", "keep.jsonl", "lookup-replay.json", "positive-controls.json", "summary.json", "report.txt",
    ...("snapshot" in pin ? ["evidence/pin-bindings.jsonl"] : []),
  ];
    writeJson(packetWithWriteObserver, "member-hashes.json", {
      version: 1,
      members: artifactPaths.map((path) => {
        const [directory, name] = path.startsWith("evidence/")
          ? [evidence, path.slice("evidence/".length)]
          : [packet, path];
        return { path, sha256: sha256(readPacketFile(directory, name)) };
      }),
    });

    return {
      packetDir: packet.canonicalPath,
      componentCount: components.length,
      cullSetSize: wouldCull.length,
      keepReasonHistogram,
      summaryPath: join(packet.canonicalPath, "summary.json"),
      snapshot: { canonicalPath: snapshot.canonicalPath, size: snapshot.size, sha256: snapshot.sha256 },
    };
  } finally {
    if (evidenceDir) closeSync(evidenceDir.fd);
    closeSync(packetWithWriteObserver.fd);
  }
}

export interface ExecutionPrerequisites {
  readonly ownerAuthorizationValid?: boolean;
  readonly migrationMapRatified?: boolean;
  readonly verifiedNonEmptyCullSet?: boolean;
  readonly approvedPacketMatches?: boolean;
  readonly rootFixDeployedAndObserved?: boolean;
  readonly singleWriterInvariant?: boolean;
  readonly osWriteConfinement?: boolean;
  readonly descriptorRelativeRenameAvailable?: boolean;
}

export interface ExecutionRefusal {
  readonly executed: false;
  readonly refusalCodes: readonly string[];
}

/**
 * The hard execution gate. It deliberately has no write side effects, even if
 * supplied fixture values say that every prerequisite is true: this release has
 * no owner GO and no descriptor-relative Node rename primitive.
 */
export function refuseCullExecution(input: ExecutionPrerequisites = {}): ExecutionRefusal {
  const refusalCodes: string[] = [];
  if (!input.ownerAuthorizationValid) refusalCodes.push("OWNER_AUTHORIZATION_MISSING_OR_INVALID");
  if (!input.migrationMapRatified) refusalCodes.push("S_R_MISSING_OR_UNRATIFIED");
  if (!input.verifiedNonEmptyCullSet) refusalCodes.push("VERIFIED_NONEMPTY_CULL_SET_MISSING");
  if (!input.approvedPacketMatches) refusalCodes.push("APPROVED_PACKET_MISMATCH");
  if (!input.rootFixDeployedAndObserved) refusalCodes.push("ROOT_FIX_NOT_DEPLOYED_AND_OBSERVED");
  if (!input.singleWriterInvariant) refusalCodes.push("SINGLE_WRITER_INVARIANT_UNVERIFIED");
  if (!input.osWriteConfinement) refusalCodes.push("OS_WRITE_CONFINEMENT_UNVERIFIED");
  if (!input.descriptorRelativeRenameAvailable) refusalCodes.push("DESCRIPTOR_RELATIVE_RENAME_UNAVAILABLE");
  refusalCodes.push("EXECUTION_DISABLED_PENDING_SEPARATE_OWNER_GO");
  return { executed: false, refusalCodes };
}

export interface HeldDescriptorCasInput {
  readonly bindingPath: string;
  readonly expectedSize: number;
  readonly expectedSha256: string;
  /** Complete deployed binding-write-path inventory; omission fails closed. */
  readonly writerInventory: BindingWriterInventory;
  /** Test seam for an interleaving append before the immediately-pre-rename check. */
  readonly afterPreflight?: () => void;
  readonly rename?: () => void;
}

export interface BindingWriterPath {
  readonly id: string;
  readonly writesBindings: boolean;
  readonly requiresCanonicalFence: boolean;
  readonly fenceProtocol?: string;
  readonly fenceEpochRequired?: boolean;
  readonly canBypassFence?: boolean;
}

/** The executor accepts no partial or assumed writer inventory. */
export interface BindingWriterInventory {
  readonly complete: boolean;
  readonly paths: readonly BindingWriterPath[];
}

export interface SingleWriterVerification {
  readonly valid: boolean;
  readonly reason?: "WRITER_INVENTORY_INCOMPLETE" | "BINDING_WRITE_BYPASS_PRESENT" | "CANONICAL_WRITER_PATH_INVALID";
}

/**
 * Verify rather than construct the root-fix precondition.  The only accepted
 * binding writer is the deployed `reclaimOrMint` transaction, and every
 * inventory entry which writes bindings must require this lock + epoch.
 */
export function verifySingleWriterPrecondition(
  inventory: BindingWriterInventory,
): SingleWriterVerification {
  if (!inventory.complete) return { valid: false, reason: "WRITER_INVENTORY_INCOMPLETE" };
  const writers = inventory.paths.filter((path) => path.writesBindings);
  if (writers.some((path) => path.canBypassFence || !path.requiresCanonicalFence || !path.fenceEpochRequired)) {
    return { valid: false, reason: "BINDING_WRITE_BYPASS_PRESENT" };
  }
  if (
    writers.length !== 1
    || writers[0]!.id !== "reclaimOrMint"
    || writers[0]!.fenceProtocol !== IDENTITY_BINDING_FENCE_PROTOCOL
  ) {
    return { valid: false, reason: "CANONICAL_WRITER_PATH_INVALID" };
  }
  return { valid: true };
}

type HeldDescriptorAbortReason =
  | "HELD_DESCRIPTOR_SIZE_MISMATCH"
  | "HELD_DESCRIPTOR_HASH_MISMATCH"
  | "SINGLE_WRITER_PRECONDITION_FAILED"
  | "CANONICAL_BINDING_FENCE_UNAVAILABLE"
  | "CANONICAL_BINDING_FENCE_LOST";

type HeldDescriptorAbort = { readonly state: "ABORTED"; readonly reason: HeldDescriptorAbortReason };

export type HeldDescriptorCasResult = HeldDescriptorAbort | { readonly state: "STAGING_VERIFIED" };

type HeldDescriptorComparison = HeldDescriptorAbort | { readonly state: "READY" };

function compareHeldDescriptor(fd: number, expectedSize: number, expectedSha256: string): HeldDescriptorComparison {
  const before = fstatSync(fd);
  if (before.size !== expectedSize) return { state: "ABORTED", reason: "HELD_DESCRIPTOR_SIZE_MISMATCH" };
  const bytes = Buffer.alloc(before.size);
  let read = 0;
  while (read < bytes.length) {
    const count = readSync(fd, bytes, read, bytes.length - read, read);
    if (count === 0) return { state: "ABORTED", reason: "HELD_DESCRIPTOR_HASH_MISMATCH" };
    read += count;
  }
  const after = fstatSync(fd);
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== expectedSize) {
    return { state: "ABORTED", reason: "HELD_DESCRIPTOR_SIZE_MISMATCH" };
  }
  return sha256(bytes) === expectedSha256
    ? { state: "READY" }
    : { state: "ABORTED", reason: "HELD_DESCRIPTOR_HASH_MISMATCH" };
}

interface CanonicalBindingFence {
  readonly lockPath: string;
  readonly epoch: string;
}

function fencePayload(fence: CanonicalBindingFence): string {
  return JSON.stringify({
    protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
    fenceEpoch: fence.epoch,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
}

function fenceIsHeld(fence: CanonicalBindingFence): boolean {
  try {
    const stat = lstatSync(fence.lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    const payload: unknown = JSON.parse(readFileSync(fence.lockPath, "utf8"));
    return isRecord(payload)
      && payload.protocol === IDENTITY_BINDING_FENCE_PROTOCOL
      && payload.fenceEpoch === fence.epoch
      && payload.pid === process.pid;
  } catch {
    return false;
  }
}

function acquireCanonicalBindingFence(lockPath: string): CanonicalBindingFence | undefined {
  const fence: CanonicalBindingFence = { lockPath, epoch: randomUUID() };
  let fd: number;
  try {
    fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    writeFileSync(fd, fencePayload(fence));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // A failure to clean up an owned fence is safer than proceeding.
    }
    throw error;
  }
  closeSync(fd);
  return fence;
}

function releaseCanonicalBindingFence(fence: CanonicalBindingFence): void {
  if (!fenceIsHeld(fence)) throw new Error("canonical binding fence ownership was lost");
  unlinkSync(fence.lockPath);
}

/**
 * Exercises the authoritative len/hash primitive over one held descriptor.
 * This staging-only verification releases its test fence before it returns and
 * never authorizes a caller to rename. Per SPEC #156 §7.1 and §8, an executor
 * must instead retain its own transmitted fence and descriptor from its final
 * compare through descriptor-relative rename and read-back.
 */
export function verifyHeldDescriptorCas(input: HeldDescriptorCasInput): HeldDescriptorCasResult {
  if (!verifySingleWriterPrecondition(input.writerInventory).valid) {
    return { state: "ABORTED", reason: "SINGLE_WRITER_PRECONDITION_FAILED" };
  }
  const canonicalBindingPath = realpathSync(input.bindingPath);
  const fence = acquireCanonicalBindingFence(join(dirname(canonicalBindingPath), ".lock"));
  if (!fence) return { state: "ABORTED", reason: "CANONICAL_BINDING_FENCE_UNAVAILABLE" };
  try {
    if (!fenceIsHeld(fence)) return { state: "ABORTED", reason: "CANONICAL_BINDING_FENCE_LOST" };
    const fd = openSync(canonicalBindingPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(fd).isFile()) return { state: "ABORTED", reason: "HELD_DESCRIPTOR_HASH_MISMATCH" };
    const preflight = compareHeldDescriptor(fd, input.expectedSize, input.expectedSha256);
    if (preflight.state === "ABORTED") return preflight;
      // This seam runs while the canonical fence is held.  A direct append
      // here models a bypass; the immediately-pre-rename held-fd CAS below
      // must refuse it before any executor could rename.
    input.afterPreflight?.();
      if (!fenceIsHeld(fence)) return { state: "ABORTED", reason: "CANONICAL_BINDING_FENCE_LOST" };
    const final = compareHeldDescriptor(fd, input.expectedSize, input.expectedSha256);
    if (final.state === "ABORTED") return final;
      if (!fenceIsHeld(fence)) return { state: "ABORTED", reason: "CANONICAL_BINDING_FENCE_LOST" };
      // Never call rename: execution remains hard-gated for this release. This
      // staging verification releases its fence at return; an executor must not
      // use it as a released-then-reacquired rename precondition.
    void input.rename;
    return { state: "STAGING_VERIFIED" };
    } finally {
      closeSync(fd);
    }
  } finally {
    releaseCanonicalBindingFence(fence);
  }
}

export interface LosslessRestorationInput {
  readonly original: Buffer;
  readonly nPre: Buffer;
  readonly nPost: Buffer;
  readonly tailOrderProven: boolean;
}

export type LosslessRestorationPlan =
  | { readonly state: "REFUSED"; readonly reason: "TAIL_ORDER_AMBIGUOUS" | "TAIL_INVALID_JSONL" }
  | { readonly state: "READY"; readonly restored: Buffer; readonly restoredSha256: string };

function isValidTail(tail: Buffer): boolean {
  if (tail.length === 0) return true;
  if (tail[tail.length - 1] !== 0x0a) return false;
  return parseExactRows(tail).every((row) => row.kind === "valid");
}

/** Plan, but do not write, B_R || N_pre || N_post restoration bytes. */
export function planLosslessRestoration(input: LosslessRestorationInput): LosslessRestorationPlan {
  if (input.nPre.length > 0 && input.nPost.length > 0 && !input.tailOrderProven) {
    return { state: "REFUSED", reason: "TAIL_ORDER_AMBIGUOUS" };
  }
  if (!isValidTail(input.nPre) || !isValidTail(input.nPost)) {
    return { state: "REFUSED", reason: "TAIL_INVALID_JSONL" };
  }
  const restored = Buffer.concat([input.original, input.nPre, input.nPost]);
  return { state: "READY", restored, restoredSha256: sha256(restored) };
}

/**
 * TEST-ONLY simulated binary trunk peer, simulated contract provider,
 * controllable virtual clock, and LH-06 catalogue double (LH-07).
 *
 * Lives exclusively under `packages/h2a/test/helpers/`, outside `dist/`.
 * Enforces both `H2A_REMOTE_CONTROL=1` and `H2A_TEST_FAKES=1` before opening
 * any link. Never signs auth or instance-bind responses on behalf of the client;
 * observes and decodes raw binary frames sent over the in-memory transport.
 */

import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { isRemoteControlEnabled, REMOTE_CONTROL_DISABLED_REASON } from "../../dist/runtime/remote-agent/flag.js";
import {
  CATALOGUE_DELTA_MAX_ENTRIES,
  CATALOGUE_MAX_ROWS,
  CATALOGUE_PART_MAX_ROWS,
  CATALOGUE_SNAPSHOT_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_PARTS,
  TRUNK_PROTOCOL_VERSION,
  TRUNK_RECORD_MAX_BYTES,
  TRUNK_TERMINAL_TEXT_MAX_BYTES,
  canonicalTrunkJson,
  isTrunkRecord,
  verifyTrunkAuthPayload
} from "../../dist/runtime/remote-agent/types.js";
import { FakeTrunkEndpoint, WET2_TEXT_HASH } from "./remote-trunk-fakes.js";

export const PINNED_WET2_TEXT_HASH = WET2_TEXT_HASH;
const TEST_FAKES_ENV = "H2A_TEST_FAKES";
const FAKES_SEALED_REASON = "fakes-sealed";
const CHALLENGE_TTL_MS = 60_000;
const FAILED_SIG_WINDOW_MS = 10 * 60_000;
const MAX_FAILED_SIGS_PER_WINDOW = 5;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function assertPeerSealed(env) {
  if (!isRemoteControlEnabled(env)) return { ok: false, reason: REMOTE_CONTROL_DISABLED_REASON };
  if (env[TEST_FAKES_ENV] !== "1") return { ok: false, reason: FAKES_SEALED_REASON };
  return { ok: true };
}

function rawEd25519PublicKeyToKeyObject(rawB64) {
  const raw = Buffer.from(rawB64, "base64");
  if (raw.length !== 32) return null;
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function computeExpectedWET2Fingerprint(raw32Bytes) {
  const hash10 = createHash("sha256").update(raw32Bytes).digest().subarray(0, 10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of hash10) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

export class FakeClock {
  #now;
  #nextId = 1;
  #timers = new Map();

  constructor(startMs = 1_700_000_000_000) {
    this.#now = startMs;
  }

  now() {
    return this.#now;
  }

  setTimeout(fn, ms) {
    const id = this.#nextId++;
    const delay = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
    this.#timers.set(id, { id, at: this.#now + delay, fn });
    return id;
  }

  clearTimeout(handle) {
    this.#timers.delete(handle);
  }

  pendingTimerCount() {
    return this.#timers.size;
  }

  nextTimerDelayMs() {
    let min = Infinity;
    for (const timer of this.#timers.values()) {
      if (timer.at < min) min = timer.at;
    }
    return min === Infinity ? null : Math.max(0, min - this.#now);
  }

  advance(ms) {
    const target = this.#now + ms;
    while (true) {
      let earliest = null;
      for (const timer of this.#timers.values()) {
        if (timer.at <= target) {
          if (!earliest || timer.at < earliest.at || (timer.at === earliest.at && timer.id < earliest.id)) {
            earliest = timer;
          }
        }
      }
      if (!earliest) break;
      this.#timers.delete(earliest.id);
      this.#now = earliest.at;
      earliest.fn();
    }
    this.#now = target;
  }
}

function applyRevokedToRow(row, revokedIds) {
  if (!revokedIds || revokedIds.size === 0) return row;
  const origin = row.instanceId ?? row.instance;
  if (origin && revokedIds.has(origin)) {
    return { ...row, instanceId: origin, instanceStatus: "revoked" };
  }
  return row;
}

export function provisionalWireRow(row) {
  const out = { sid: row.sessionId };
  if (row.instanceId !== undefined) out.instanceId = row.instanceId;
  if (row.instanceStatus !== undefined) out.instanceStatus = row.instanceStatus;
  if (row.host !== undefined) out.cliHost = row.host;
  if (row.name !== undefined) out.name = row.name;
  if (row.workspaceLabel !== undefined) out.workspaceLabel = row.workspaceLabel;
  if (row.startedAt !== undefined) out.startedAt = row.startedAt;
  if (row.heartbeatAt !== undefined) out.heartbeatAt = row.heartbeatAt;
  if (row.workStatus !== undefined) out.workStatus = row.workStatus;
  if (row.hostKind !== undefined) out.terminalHost = row.hostKind;
  out.operable = Boolean(row.operable);
  if (row.excluded === true) out.excluded = true;
  return out;
}

export function createSimulatedTrunkContractProvider(options = {}) {
  const maxCatalogueRecordBytes = options.maxCatalogueRecordBytes ?? 8192;
  const maxSignallingRecordBytes = options.maxSignallingRecordBytes ?? 8192;
  const maxTermOutRawBytes = options.maxTermOutRawBytes ?? TRUNK_TERMINAL_TEXT_MAX_BYTES;
  const maxRecordBytes = options.maxRecordBytes ?? TRUNK_RECORD_MAX_BYTES;
  const wet2TextHash = options.wet2TextHash ?? PINNED_WET2_TEXT_HASH;
  if (wet2TextHash !== PINNED_WET2_TEXT_HASH) {
    throw new Error(`wet2TextHash-mismatch: expected ${PINNED_WET2_TEXT_HASH}, got ${wet2TextHash}`);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function measureJcsBytes(record) {
    return Buffer.byteLength(canonicalTrunkJson(record), "utf8");
  }

  function validateRecordLimits(record, bodyByteLength) {
    if (bodyByteLength < 1 || bodyByteLength > maxRecordBytes) {
      return { ok: false, code: "record-size-out-of-bounds" };
    }
    if (record.t === "cat.snapshot") {
      if (bodyByteLength > maxCatalogueRecordBytes) {
        return { ok: false, code: "catalogue-record-too-large" };
      }
      return { ok: false, code: "legacy-monolithic-snapshot" };
    }
    if (
      record.t === "cat.snapshot.part" ||
      record.t === "cat.snapshot.end" ||
      record.t === "cat.delta"
    ) {
      if (bodyByteLength > maxCatalogueRecordBytes) {
        return { ok: false, code: "catalogue-record-too-large" };
      }
    } else if (record.t === "term.out") {
      if (typeof record.dataB64 !== "string") {
        return { ok: false, code: "invalid-term-out" };
      }
      const rawBytes = Buffer.from(record.dataB64, "base64").byteLength;
      if (rawBytes > maxTermOutRawBytes) {
        return { ok: false, code: "term-out-too-large" };
      }
    } else {
      if (bodyByteLength > maxSignallingRecordBytes) {
        return { ok: false, code: "signalling-record-too-large" };
      }
    }
    return { ok: true };
  }

  function encodeFrame(record) {
    const bodyStr = canonicalTrunkJson(record);
    const body = Buffer.from(bodyStr, "utf8");
    const limitCheck = validateRecordLimits(record, body.byteLength);
    if (!limitCheck.ok) {
      throw new Error(`encodeFrame rejected: ${limitCheck.code}`);
    }
    const frame = Buffer.allocUnsafe(4 + body.byteLength);
    frame.writeUInt32BE(body.byteLength, 0);
    body.copy(frame, 4);
    return frame;
  }

  function decodeFrame(frame) {
    if (!(frame instanceof Uint8Array)) {
      return { ok: false, code: "text-frame-not-allowed" };
    }
    if (frame.byteLength < 4) {
      return { ok: false, code: "truncated-frame" };
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const declaredLen = view.getUint32(0, false);
    if (declaredLen < 1 || declaredLen > maxRecordBytes) {
      return { ok: false, code: "invalid-frame-length" };
    }
    if (declaredLen !== frame.byteLength - 4) {
      return { ok: false, code: declaredLen > frame.byteLength - 4 ? "truncated-frame" : "multiple-records-in-frame" };
    }
    let text;
    try {
      text = decoder.decode(frame.subarray(4));
    } catch {
      return { ok: false, code: "invalid-utf8" };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: "invalid-json" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, code: "invalid-record-object" };
    }
    const limitCheck = validateRecordLimits(parsed, declaredLen);
    if (!limitCheck.ok) return limitCheck;
    return { ok: true, record: parsed, encodedBodyBytes: declaredLen };
  }

  function canonicalAuthBytes(payload) {
    const obj = {
      nonce: payload.nonce,
      meshId: payload.meshId,
      endpoint: payload.endpoint,
      tenantId: payload.tenantId,
      serverTime: payload.serverTime,
      nodeId: payload.nodeId,
      enrolmentRef: payload.enrolmentRef,
      protocolVersions: payload.protocolVersions,
      clientTime: payload.clientTime
    };
    return Buffer.from(canonicalTrunkJson(obj), "utf8");
  }

  function canonicalInstanceBindBytes(payload) {
    const obj = {
      meshId: payload.meshId,
      endpoint: payload.endpoint,
      tenantId: payload.tenantId,
      enrolmentRef: payload.enrolmentRef,
      nodeId: payload.nodeId,
      instanceId: payload.instanceId,
      instancePublicKey: payload.instancePublicKey,
      bindNonce: payload.bindNonce
    };
    return Buffer.from(canonicalTrunkJson(obj), "utf8");
  }

  function buildSnapshotPages(wireRows) {
    const pages = [];
    let offset = 0;
    while (offset < wireRows.length) {
      const batch = [];
      while (offset < wireRows.length && batch.length < CATALOGUE_PART_MAX_ROWS) {
        const candidate = {
          v: TRUNK_PROTOCOL_VERSION,
          t: "cat.snapshot.part",
          ch: 1,
          s: 1,
          catSeq: 1,
          nodeId: "node",
          snapId: "snap",
          part: pages.length,
          rows: [...batch, wireRows[offset]]
        };
        if (batch.length > 0 && measureJcsBytes(candidate) > maxCatalogueRecordBytes) {
          break;
        }
        batch.push(wireRows[offset]);
        offset += 1;
      }
      pages.push(batch);
    }
    return pages;
  }

  function planCatalogueSnapshot(request) {
    const wireRows = (request.rows ?? []).map((r) => provisionalWireRow(r));
    const truncatedRows = request.truncatedRows ?? 0;
    const pages = buildSnapshotPages(wireRows);
    let totalEncodedBytes = 0;
    for (let i = 0; i < pages.length; i += 1) {
      const partRec = {
        v: TRUNK_PROTOCOL_VERSION,
        t: "cat.snapshot.part",
        ch: 1,
        s: i + 1,
        catSeq: i + 1,
        nodeId: request.nodeId,
        snapId: request.snapId,
        part: i,
        rows: pages[i]
      };
      totalEncodedBytes += measureJcsBytes(partRec);
    }
    const endRec = {
      v: TRUNK_PROTOCOL_VERSION,
      t: "cat.snapshot.end",
      ch: 1,
      s: pages.length + 1,
      catSeq: pages.length + 1,
      nodeId: request.nodeId,
      snapId: request.snapId,
      partCount: pages.length,
      totalRows: wireRows.length,
      truncatedRows
    };
    totalEncodedBytes += measureJcsBytes(endRec);
    return { partCount: pages.length, totalEncodedBytes };
  }

  function prepareNextCatalogueRecord(request) {
    const { mode, nodeId, nextCatSeq, nextSeq, cursor } = request;
    if (mode === "snapshot") {
      if (cursor?.phase === "done") return null;
      const wireRows = cursor?.wireRows ?? (request.rows ?? []).map((r) => provisionalWireRow(r));
      const pages = cursor?.pages ?? buildSnapshotPages(wireRows);
      const partIndex = cursor?.partIndex ?? 0;

      if (partIndex < pages.length) {
        const record = {
          v: TRUNK_PROTOCOL_VERSION,
          t: "cat.snapshot.part",
          ch: 1,
          s: nextSeq,
          catSeq: nextCatSeq,
          nodeId,
          snapId: request.snapId,
          part: partIndex,
          rows: pages[partIndex]
        };
        const encodedBytes = measureJcsBytes(record);
        if (encodedBytes > maxCatalogueRecordBytes) {
          throw new Error(`catalogue-record-too-large: ${encodedBytes}`);
        }
        return {
          record,
          encodedBytes,
          nextCursor: {
            phase: partIndex + 1 < pages.length ? "part" : "end",
            partIndex: partIndex + 1,
            wireRows,
            pages
          }
        };
      }

      const endRecord = {
        v: TRUNK_PROTOCOL_VERSION,
        t: "cat.snapshot.end",
        ch: 1,
        s: nextSeq,
        catSeq: nextCatSeq,
        nodeId,
        snapId: request.snapId,
        partCount: pages.length,
        totalRows: wireRows.length,
        truncatedRows: request.truncatedRows ?? 0
      };
      const encodedBytes = measureJcsBytes(endRecord);
      if (encodedBytes > maxCatalogueRecordBytes) {
        throw new Error(`catalogue-record-too-large: ${encodedBytes}`);
      }
      return {
        record: endRecord,
        encodedBytes,
        nextCursor: null
      };
    }

    // mode === "delta": removes BEFORE upserts, <= 16 total entries and <= maxCatalogueRecordBytes
    const removesLeft = cursor ? [...cursor.removesLeft] : [...(request.removes ?? [])];
    const upsertsLeft = cursor
      ? [...cursor.upsertsLeft]
      : (request.upserts ?? []).map((r) => provisionalWireRow(r));
    if (removesLeft.length === 0 && upsertsLeft.length === 0) {
      return null;
    }

    const chosenRemoves = [];
    const chosenUpserts = [];
    const buildDeltaCandidate = (r, u) => ({
      v: TRUNK_PROTOCOL_VERSION,
      t: "cat.delta",
      ch: 1,
      s: nextSeq,
      catSeq: nextCatSeq,
      nodeId,
      upserts: u,
      removes: r
    });

    while (
      removesLeft.length > 0 &&
      chosenRemoves.length + chosenUpserts.length < CATALOGUE_DELTA_MAX_ENTRIES
    ) {
      const next = removesLeft[0];
      if (measureJcsBytes(buildDeltaCandidate([...chosenRemoves, next], chosenUpserts)) <= maxCatalogueRecordBytes) {
        chosenRemoves.push(removesLeft.shift());
      } else {
        break;
      }
    }
    if (removesLeft.length === 0) {
      while (
        upsertsLeft.length > 0 &&
        chosenRemoves.length + chosenUpserts.length < CATALOGUE_DELTA_MAX_ENTRIES
      ) {
        const next = upsertsLeft[0];
        if (
          (chosenRemoves.length === 0 && chosenUpserts.length === 0) ||
          measureJcsBytes(buildDeltaCandidate(chosenRemoves, [...chosenUpserts, next])) <= maxCatalogueRecordBytes
        ) {
          chosenUpserts.push(upsertsLeft.shift());
        } else {
          break;
        }
      }
    }
    const record = buildDeltaCandidate(chosenRemoves, chosenUpserts);
    const encodedBytes = measureJcsBytes(record);
    if (encodedBytes > maxCatalogueRecordBytes) {
      throw new Error(`catalogue-record-too-large: ${encodedBytes}`);
    }
    const hasMore = removesLeft.length > 0 || upsertsLeft.length > 0;
    return {
      record,
      encodedBytes,
      nextCursor: hasMore ? { removesLeft, upsertsLeft } : null
    };
  }

  return {
    wet2TextHash,
    maxCatalogueRecordBytes,
    maxSignallingRecordBytes,
    maxTermOutRawBytes,
    maxRecordBytes,
    encodeFrame,
    decodeFrame,
    canonicalAuthBytes,
    canonicalInstanceBindBytes,
    measureJcsBytes,
    planCatalogueSnapshot,
    prepareNextCatalogueRecord
  };
}

export class CatalogueSliceStager {
  #expectedNodeId;
  #expectedCatSeq = 1;
  #committedSlice = null;
  #staged = null;

  constructor(options = {}) {
    this.#expectedNodeId = options.expectedNodeId;
  }

  getSlice() {
    return this.#committedSlice
      ? { rows: [...this.#committedSlice.rows], truncatedRows: this.#committedSlice.truncatedRows }
      : null;
  }

  hasPendingStage() {
    return this.#staged !== null;
  }

  discardPending() {
    this.#staged = null;
  }

  ingest(rec, encodedBytes) {
    const fail = (code) => {
      this.#staged = null;
      return { ok: false, code };
    };
    if (!rec || typeof rec !== "object") return fail("invalid-catalogue-record");
    if (rec.catSeq !== this.#expectedCatSeq) return fail("cat-seq-mismatch");
    if (rec.nodeId !== this.#expectedNodeId) return fail("cat-node-mismatch");

    if (rec.t === "cat.snapshot.part") {
      if (!Array.isArray(rec.rows) || rec.rows.length < 1 || rec.rows.length > CATALOGUE_PART_MAX_ROWS) {
        return fail("cat-invalid-part-rows");
      }
      if (!Number.isSafeInteger(rec.part) || rec.part < 0 || rec.part >= CATALOGUE_SNAPSHOT_MAX_PARTS) {
        return fail("cat-part-index-out-of-bounds");
      }
      if (typeof rec.snapId !== "string" || rec.snapId.length === 0) {
        return fail("cat-invalid-snap-id");
      }
      if (this.#staged === null) {
        if (rec.part !== 0) return fail("cat-part-out-of-order");
        this.#staged = {
          snapId: rec.snapId,
          nextPart: 0,
          totalBytes: 0,
          rows: [],
          seenSids: new Set()
        };
      } else if (this.#staged.snapId !== rec.snapId) {
        return fail("cat-concurrent-snapshot");
      }
      if (rec.part !== this.#staged.nextPart) {
        return fail("cat-part-out-of-order");
      }
      if (this.#staged.totalBytes + encodedBytes > CATALOGUE_SNAPSHOT_MAX_BYTES) {
        return fail("cat-snapshot-too-large");
      }
      for (const row of rec.rows) {
        if (!row || typeof row !== "object" || typeof row.sid !== "string" || row.sid.length === 0) {
          return fail("cat-invalid-wire-row");
        }
        if (this.#staged.seenSids.has(row.sid)) {
          return fail("cat-duplicate-sid");
        }
        this.#staged.seenSids.add(row.sid);
        this.#staged.rows.push(row);
      }
      this.#staged.nextPart += 1;
      this.#staged.totalBytes += encodedBytes;
      this.#expectedCatSeq += 1;
      return { ok: true, committed: false };
    }

    if (rec.t === "cat.snapshot.end") {
      if (
        !Number.isSafeInteger(rec.partCount) ||
        rec.partCount < 0 ||
        rec.partCount > CATALOGUE_SNAPSHOT_MAX_PARTS ||
        !Number.isSafeInteger(rec.totalRows) ||
        rec.totalRows < 0 ||
        rec.totalRows > CATALOGUE_MAX_ROWS ||
        !Number.isSafeInteger(rec.truncatedRows) ||
        rec.truncatedRows < 0
      ) {
        return fail("cat-invalid-end");
      }
      if (rec.partCount === 0) {
        if (this.#staged !== null) return fail("cat-end-part-count-mismatch");
        if (rec.totalRows !== 0) return fail("cat-end-total-rows-mismatch");
        if (encodedBytes > CATALOGUE_SNAPSHOT_MAX_BYTES) return fail("cat-snapshot-too-large");
        this.#committedSlice = { rows: [], truncatedRows: rec.truncatedRows };
        this.#expectedCatSeq += 1;
        return { ok: true, committed: true };
      }
      if (
        this.#staged === null ||
        this.#staged.snapId !== rec.snapId ||
        this.#staged.nextPart !== rec.partCount
      ) {
        return fail("cat-end-part-count-mismatch");
      }
      if (this.#staged.rows.length !== rec.totalRows) {
        return fail("cat-end-total-rows-mismatch");
      }
      if (this.#staged.totalBytes + encodedBytes > CATALOGUE_SNAPSHOT_MAX_BYTES) {
        return fail("cat-snapshot-too-large");
      }
      this.#committedSlice = {
        rows: [...this.#staged.rows],
        truncatedRows: rec.truncatedRows
      };
      this.#staged = null;
      this.#expectedCatSeq += 1;
      return { ok: true, committed: true };
    }

    if (rec.t === "cat.delta") {
      if (this.#staged !== null) return fail("cat-delta-during-snapshot");
      if (this.#committedSlice === null) return fail("cat-delta-before-snapshot");
      if (!Array.isArray(rec.upserts) || !Array.isArray(rec.removes)) {
        return fail("cat-invalid-delta");
      }
      const total = rec.upserts.length + rec.removes.length;
      if (total < 1 || total > CATALOGUE_DELTA_MAX_ENTRIES) {
        return fail("cat-delta-size-out-of-bounds");
      }
      const bySid = new Map(this.#committedSlice.rows.map((r) => [r.sid, r]));
      for (const sid of rec.removes) {
        if (typeof sid !== "string" || sid.length === 0) return fail("cat-invalid-remove-sid");
        bySid.delete(sid);
      }
      for (const row of rec.upserts) {
        if (!row || typeof row !== "object" || typeof row.sid !== "string" || row.sid.length === 0) {
          return fail("cat-invalid-upsert-row");
        }
        bySid.set(row.sid, row);
      }
      const sorted = [...bySid.values()].sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
      if (sorted.length > CATALOGUE_MAX_ROWS) return fail("cat-delta-exceeds-max-rows");
      this.#committedSlice = {
        rows: sorted,
        truncatedRows: this.#committedSlice.truncatedRows
      };
      this.#expectedCatSeq += 1;
      return { ok: true, committed: true };
    }

    return fail("cat-unknown-record");
  }
}

export class FakeCatalogueDouble {
  #clock;
  #emit = null;
  #rows = new Map();
  #revokedInstances = new Set();
  #truncatedRows = 0;
  calls = [];
  watching = false;

  constructor(options = {}) {
    this.#clock = options.clock ?? { now: () => Date.now() };
    for (const row of options.initialRows ?? []) {
      this.#rows.set(row.sessionId, { ...row });
    }
    this.#truncatedRows = options.truncatedRows ?? 0;
  }

  #buildProjection() {
    const sorted = [...this.#rows.values()]
      .map((row) => {
        const origin = row.instanceId ?? row.instance;
        if (origin && this.#revokedInstances.has(origin)) {
          return { ...row, instanceId: origin, instanceStatus: "revoked" };
        }
        return { ...row };
      })
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
    return {
      rows: sorted,
      truncatedRows: this.#truncatedRows
    };
  }

  setInitialRows(rows, truncatedRows = 0) {
    this.#rows.clear();
    for (const row of rows) {
      this.#rows.set(row.sessionId, { ...row });
    }
    this.#truncatedRows = truncatedRows;
  }

  applyRevokedInstances(ids) {
    this.calls.push({ op: "applyRevokedInstances", ids: [...ids], at: this.#clock.now() });
    for (const id of ids) {
      this.#revokedInstances.add(id);
      for (const [sid, row] of this.#rows.entries()) {
        if ((row.instanceId ?? row.instance) === id) {
          this.#rows.set(sid, { ...row, instanceId: id, instanceStatus: "revoked" });
        }
      }
    }
  }

  setInstanceStatus(instanceId, status) {
    this.calls.push({ op: "setInstanceStatus", instanceId, status, at: this.#clock.now() });
    if (status === "revoked") this.#revokedInstances.add(instanceId);
    else this.#revokedInstances.delete(instanceId);
    let changed = false;
    for (const [sid, row] of this.#rows.entries()) {
      if ((row.instanceId ?? row.instance) === instanceId) {
        this.#rows.set(sid, { ...row, instanceId, instanceStatus: status });
        changed = true;
      }
    }
    if (this.watching && this.#emit && changed) {
      this.#emit(this.#buildProjection());
    }
  }

  startWatch(emit) {
    this.calls.push({ op: "startWatch", at: this.#clock.now() });
    this.watching = true;
    this.#emit = emit;
    emit(this.#buildProjection());
  }

  stopWatch() {
    this.calls.push({ op: "stopWatch", at: this.#clock.now() });
    this.watching = false;
    this.#emit = null;
  }

  emitRow(row) {
    const origin = row.instanceId ?? row.instance;
    const adjusted = origin && this.#revokedInstances.has(origin)
      ? { ...row, instanceId: origin, instanceStatus: "revoked" }
      : { ...row };
    this.#rows.set(adjusted.sessionId, adjusted);
    if (this.watching && this.#emit) {
      this.#emit(this.#buildProjection());
    }
  }

  emitSnapshot(rows, truncatedRows = 0) {
    this.setInitialRows(rows, truncatedRows);
    if (this.watching && this.#emit) {
      this.#emit(this.#buildProjection());
    }
  }
}

export class FakeBinaryTrunkPeer {
  #meshId;
  #tenantId;
  #endpoint;
  #clock;
  #env;
  #contract;
  #trunk;
  #nonceGenerator;
  #enrolments = new Map();
  #liveConnections = new Map(); // scopeKey -> PeerConnection
  #allConnections = [];
  #attemptsByClient = new Map();
  #failedSigsByPubKey = new Map(); // pubKeyPem -> number[] timestamps
  #usedNonces = new Set();
  #nextConnId = 1;
  #autoPong = true;
  #nextBindNonceCounter = 1;

  constructor(options = {}) {
    this.#meshId = options.meshId ?? "mesh-test";
    this.#tenantId = options.tenantId ?? "tenant-test";
    this.#endpoint = options.endpoint ?? "wss://remote.sent-tech.ca/trunk/v1";
    this.#clock = options.clock ?? new FakeClock();
    this.#env = options.env ?? { H2A_REMOTE_CONTROL: "1", H2A_TEST_FAKES: "1" };
    this.#contract = options.contract ?? createSimulatedTrunkContractProvider();
    this.#trunk = new FakeTrunkEndpoint({
      meshId: this.#meshId,
      tenantId: this.#tenantId,
      endpoint: this.#endpoint,
      env: this.#env,
      wet2TextHash: this.#contract.wet2TextHash
    });
    this.#nonceGenerator = options.nonceGenerator ?? (() => randomBytes(16).toString("base64url"));
  }

  get endpoint() { return this.#endpoint; }
  get meshId() { return this.#meshId; }
  get tenantId() { return this.#tenantId; }
  get contract() { return this.#contract; }
  get trunkFake() { return this.#trunk; }

  setAutoPong(enabled) {
    this.#autoPong = enabled;
  }

  registerEnrolment(input) {
    const scopeKey = `${this.#meshId}|${this.#tenantId}|${input.userId ?? "owner"}|${input.nodeId}|${input.enrolmentRef}`;
    const record = {
      scopeKey,
      userId: input.userId ?? "owner",
      nodeId: input.nodeId,
      enrolmentRef: input.enrolmentRef,
      publicKeyPem: input.publicKeyPem,
      fingerprint: input.fingerprint ?? "fixture-fp",
      usages: input.usages ?? ["sessions.observe", "sessions.operate"],
      renewBy: input.renewBy ?? (this.#clock.now() + 180 * 24 * 60 * 60_000),
      revoked: Boolean(input.revoked),
      notProvisioned: Boolean(input.notProvisioned),
      revokedInstances: new Set(input.revokedInstances ?? []),
      boundInstances: new Map()
    };
    this.#enrolments.set(input.enrolmentRef, record);
    if (!record.notProvisioned) {
      this.#trunk.registerFixtureKey({
        nodeId: input.nodeId,
        publicKeyPem: input.publicKeyPem,
        enrolmentRef: input.enrolmentRef,
        fingerprint: record.fingerprint,
        userId: record.userId
      });
    }
    return record;
  }

  revokeEnrolment(enrolmentRef) {
    const rec = this.#enrolments.get(enrolmentRef);
    if (rec) rec.revoked = true;
  }

  attemptsFor(clientTag = "default") {
    return this.#attemptsByClient.get(clientTag) ?? 0;
  }

  liveConnections() {
    return [...this.#liveConnections.values()].filter((c) => !c.closed);
  }

  allConnections() {
    return [...this.#allConnections];
  }

  liveLinkCount() {
    return this.liveConnections().length;
  }

  createConnector(clientTag = "default") {
    return {
      open: (endpoint, handlers) => {
        this.#attemptsByClient.set(clientTag, (this.#attemptsByClient.get(clientTag) ?? 0) + 1);
        const sealed = assertPeerSealed(this.#env);
        if (!sealed.ok) {
          throw new Error(sealed.reason);
        }
        if (endpoint !== this.#endpoint) {
          throw new Error(`unexpected-endpoint:${endpoint}`);
        }
        const conn = this.#openConnection(clientTag, handlers);
        return {
          send: (frame) => this.#handleClientFrame(conn, frame),
          close: (reason) => {
            if (conn.closed) return;
            conn.closed = true;
            conn.closeReason = reason ?? "client-closed";
            if (conn.scopeKey && this.#liveConnections.get(conn.scopeKey) === conn) {
              this.#liveConnections.delete(conn.scopeKey);
            }
            if (conn.linkGeneration !== undefined && typeof this.#trunk.closeLink === "function") {
              this.#trunk.closeLink(conn.linkGeneration);
            }
          }
        };
      }
    };
  }

  #openConnection(clientTag, handlers) {
    const nonce = this.#nonceGenerator();
    const serverTime = this.#clock.now();
    const conn = {
      id: this.#nextConnId++,
      clientTag,
      handlers,
      closed: false,
      closeReason: null,
      phase: "hello-sent",
      nonce,
      nonceIssuedAt: serverTime,
      expectedClientSeq: 1,
      serverSeq: 0,
      linkGeneration: undefined,
      scopeKey: undefined,
      enrolmentRef: undefined,
      nodeId: undefined,
      currentBindNonce: undefined,
      observedClientFrames: [],
      decodedClientRecords: [],
      decodedServerRecords: [],
      receivedCatalogue: [],
      receivedTermOut: new Map(), // ch -> Array<{ record, rawBytes }>
      sentFrames: []
    };
    this.#allConnections.push(conn);

    const hello = {
      v: TRUNK_PROTOCOL_VERSION,
      t: "hello",
      ch: 0,
      s: ++conn.serverSeq,
      protocolVersions: [TRUNK_PROTOCOL_VERSION],
      nonce,
      meshId: this.#meshId,
      endpoint: this.#endpoint,
      tenantId: this.#tenantId,
      serverTime
    };
    this.#sendToClient(conn, hello);
    return conn;
  }

  #sendToClient(conn, record) {
    const frame = this.#contract.encodeFrame(record);
    conn.decodedServerRecords.push(record);
    conn.sentFrames.push(frame);
    conn.handlers.onMessage(frame);
  }

  sendRawBytes(conn, rawBytes) {
    conn.handlers.onMessage(rawBytes);
  }

  sendTextFrame(conn, text) {
    conn.handlers.onMessage(text);
  }

  sendRecord(conn, partialRecord) {
    const record = {
      v: TRUNK_PROTOCOL_VERSION,
      ...partialRecord,
      s: partialRecord.s !== undefined ? partialRecord.s : ++conn.serverSeq
    };
    this.#sendToClient(conn, record);
    return record;
  }

  sendWatchStart(conn) {
    return this.sendRecord(conn, { t: "watch.start", ch: 1 });
  }

  sendWatchStop(conn) {
    return this.sendRecord(conn, { t: "watch.stop", ch: 1 });
  }

  sendCredit(conn, ch, credit) {
    return this.sendRecord(conn, {
      t: "credit",
      ch,
      receivedThroughSeq: credit.receivedThroughSeq,
      receivedThroughBytes: credit.receivedThroughBytes,
      sendLimitSeq: credit.sendLimitSeq,
      sendLimitBytes: credit.sendLimitBytes
    });
  }

  sendTermOpen(conn, open) {
    return this.sendRecord(conn, {
      t: "term.open",
      ch: open.ch,
      sid: open.sid,
      mode: open.mode ?? "observe",
      afterSeq: open.afterSeq ?? null,
      receivedSegBytes: open.receivedSegBytes ?? 0,
      ...(open.cols !== undefined ? { cols: open.cols } : {}),
      ...(open.rows !== undefined ? { rows: open.rows } : {})
    });
  }

  sendTermClose(conn, ch, sid) {
    return this.sendRecord(conn, { t: "term.close", ch, sid });
  }

  sendInstanceRevoked(conn, instanceId, revokedBy = "user") {
    const rec = this.#enrolments.get(conn.enrolmentRef);
    if (rec) {
      rec.revokedInstances.add(instanceId);
      const existing = rec.boundInstances.get(instanceId);
      if (existing) existing.status = "revoked";
    }
    return this.sendRecord(conn, {
      t: "instance.revoked",
      ch: 0,
      instanceId,
      revokedAt: this.#clock.now(),
      revokedBy
    });
  }

  sendRevoked(conn, reason = "enrolment-revoked") {
    this.revokeEnrolment(conn.enrolmentRef);
    this.sendRecord(conn, { t: "revoked", ch: 0, reason });
    this.dropConnection(conn, "revoked");
  }

  sendKill(conn, reason = "site-kill") {
    this.sendRecord(conn, { t: "kill", ch: 0, reason });
    this.dropConnection(conn, "kill");
  }

  sendBye(conn) {
    this.sendRecord(conn, { t: "bye", ch: 0 });
    this.dropConnection(conn, "bye");
  }

  sendPing(conn) {
    return this.sendRecord(conn, { t: "ping", ch: 0, at: this.#clock.now() });
  }

  dropConnection(conn, reason = "network-drop") {
    if (conn.closed) return;
    conn.closed = true;
    conn.closeReason = reason;
    if (conn.scopeKey && this.#liveConnections.get(conn.scopeKey) === conn) {
      this.#liveConnections.delete(conn.scopeKey);
    }
    if (conn.linkGeneration !== undefined && typeof this.#trunk.closeLink === "function") {
      this.#trunk.closeLink(conn.linkGeneration);
    }
    conn.handlers.onClose(reason);
  }

  deliverErrorAndClose(conn, errorMessage = "socket-reset") {
    if (conn.closed) return;
    conn.closed = true;
    conn.closeReason = errorMessage;
    if (conn.scopeKey && this.#liveConnections.get(conn.scopeKey) === conn) {
      this.#liveConnections.delete(conn.scopeKey);
    }
    if (conn.linkGeneration !== undefined && typeof this.#trunk.closeLink === "function") {
      this.#trunk.closeLink(conn.linkGeneration);
    }
    conn.handlers.onError(new Error(errorMessage));
    conn.handlers.onClose(errorMessage);
  }

  #closePeerWithErr(conn, code, retryable = false, extra = {}) {
    if (conn.closed) return;
    this.sendRecord(conn, { t: "err", ch: 0, code, retryable, ...extra });
    this.dropConnection(conn, code);
  }

  #recordFailedSig(pubKeyPem) {
    const now = this.#clock.now();
    const list = (this.#failedSigsByPubKey.get(pubKeyPem) ?? []).filter((ts) => now - ts < FAILED_SIG_WINDOW_MS);
    list.push(now);
    this.#failedSigsByPubKey.set(pubKeyPem, list);
    return list;
  }

  #isHandshakeBusy(pubKeyPem) {
    const now = this.#clock.now();
    const list = (this.#failedSigsByPubKey.get(pubKeyPem) ?? []).filter((ts) => now - ts < FAILED_SIG_WINDOW_MS);
    this.#failedSigsByPubKey.set(pubKeyPem, list);
    if (list.length >= MAX_FAILED_SIGS_PER_WINDOW) {
      return { busy: true, retryAfterMs: Math.max(1000, FAILED_SIG_WINDOW_MS - (now - list[0])) };
    }
    return { busy: false, retryAfterMs: 0 };
  }

  #handleClientFrame(conn, frame) {
    if (conn.closed) return;
    conn.observedClientFrames.push(Buffer.from(frame));
    const decoded = this.#contract.decodeFrame(frame);
    if (!decoded.ok) {
      this.#closePeerWithErr(conn, decoded.code, false);
      return;
    }
    const rec = decoded.record;
    conn.decodedClientRecords.push(rec);

    if (rec.s !== conn.expectedClientSeq) {
      this.#closePeerWithErr(conn, "sequence-error", false);
      return;
    }
    conn.expectedClientSeq += 1;

    if (conn.phase === "hello-sent") {
      if (rec.ch !== 0 || rec.t !== "auth") {
        this.#closePeerWithErr(conn, "expected-auth", false);
        return;
      }
      this.#handleAuth(conn, rec);
      return;
    }

    if (rec.t === "ping" && rec.ch === 0) {
      if (this.#autoPong) {
        this.sendRecord(conn, { t: "pong", ch: 0, at: rec.at });
      }
      return;
    }
    if (rec.t === "pong" && rec.ch === 0) {
      return;
    }
    if (rec.t === "bye" && rec.ch === 0) {
      this.dropConnection(conn, "bye");
      return;
    }
    if (rec.t === "x-liveness" && rec.ch === 0) {
      return;
    }
    if (
      rec.t === "cat.snapshot.part" ||
      rec.t === "cat.snapshot.end" ||
      rec.t === "cat.delta"
    ) {
      conn.receivedCatalogue.push({ record: rec, encodedBytes: decoded.encodedBodyBytes });
      if (!isTrunkRecord(rec)) {
        conn.catalogueFault = "invalid-catalogue-record";
        this.#closePeerWithErr(conn, "invalid-catalogue-record", false);
        return;
      }
      const res = conn.catalogueStager.ingest(rec, decoded.encodedBodyBytes);
      if (!res.ok) {
        conn.catalogueFault = res.code;
        this.#closePeerWithErr(conn, res.code, false);
        return;
      }
      conn.catalogueView = conn.catalogueStager.getSlice();
      return;
    }
    if (rec.t === "term.out") {
      const list = conn.receivedTermOut.get(rec.ch) ?? [];
      list.push({ record: rec, rawBytes: Buffer.from(rec.dataB64, "base64").byteLength });
      conn.receivedTermOut.set(rec.ch, list);
      return;
    }
    if (rec.t === "instance.bind" && rec.ch === 0) {
      this.#handleInstanceBind(conn, rec);
      return;
    }
  }

  #handleAuth(conn, rec) {
    const sealed = assertPeerSealed(this.#env);
    if (!sealed.ok) {
      this.#closePeerWithErr(conn, sealed.reason, false);
      return;
    }
    // Check nonce length >= 128 bits (16 bytes raw or base64url >= 22 chars)
    const nonceBytes = Buffer.from(conn.nonce, "base64url");
    if (nonceBytes.byteLength < 16 && Buffer.byteLength(conn.nonce, "utf8") < 16) {
      this.#closePeerWithErr(conn, "nonce-too-short", false);
      return;
    }
    if (this.#usedNonces.has(conn.nonce)) {
      this.#closePeerWithErr(conn, "challenge-replayed", false);
      return;
    }
    const ageMs = this.#clock.now() - conn.nonceIssuedAt;
    if (ageMs < 0 || ageMs > CHALLENGE_TTL_MS) {
      this.#closePeerWithErr(conn, "challenge-expired", false);
      return;
    }
    const enrolment = this.#enrolments.get(rec.enrolmentRef);
    if (!enrolment) {
      this.#closePeerWithErr(conn, "unknown-enrolment", false);
      return;
    }
    if (enrolment.notProvisioned) {
      this.#closePeerWithErr(conn, "not-provisioned", false);
      return;
    }
    if (enrolment.revoked) {
      this.#closePeerWithErr(conn, "enrolment-revoked", false);
      return;
    }
    if (this.#clock.now() > enrolment.renewBy) {
      this.#closePeerWithErr(conn, "record-expired", false);
      return;
    }
    if (!enrolment.usages.includes("sessions.observe")) {
      this.#closePeerWithErr(conn, "missing-usage", false);
      return;
    }
    const busy = this.#isHandshakeBusy(enrolment.publicKeyPem);
    if (busy.busy) {
      this.#closePeerWithErr(conn, "handshake_busy", true, { retryAfterMs: busy.retryAfterMs });
      return;
    }

    const challenge = {
      nonce: conn.nonce,
      meshId: this.#meshId,
      tenantId: this.#tenantId,
      endpoint: this.#endpoint,
      serverTime: conn.nonceIssuedAt,
      nodeId: rec.nodeId,
      enrolmentRef: rec.enrolmentRef
    };
    const payload = {
      nonce: conn.nonce,
      meshId: this.#meshId,
      tenantId: this.#tenantId,
      endpoint: this.#endpoint,
      serverTime: conn.nonceIssuedAt,
      nodeId: rec.nodeId,
      enrolmentRef: rec.enrolmentRef,
      protocolVersions: rec.protocolVersions,
      clientTime: rec.clientTime
    };

    const issued = this.#trunk.issueChallenge(challenge);
    if (!issued.ok) {
      this.#closePeerWithErr(conn, issued.reason, false);
      return;
    }
    // Verify signature explicitly via contract canonical bytes too
    const opened = this.#trunk.openLink({
      challenge: issued.challenge,
      payload,
      signature: rec.signature
    });
    if (!opened.ok) {
      if (opened.reason === "invalid-signature") {
        this.#recordFailedSig(enrolment.publicKeyPem);
      }
      this.#closePeerWithErr(conn, opened.reason, false);
      return;
    }

    this.#usedNonces.add(conn.nonce);
    // Supersede existing live link for the same (meshId, tenantId, user, node, enrolmentRef)
    const previous = this.#liveConnections.get(enrolment.scopeKey);
    if (previous && !previous.closed) {
      this.sendRecord(previous, { t: "superseded", ch: 0, reason: "newer-link" });
      this.dropConnection(previous, "superseded");
    }

    conn.phase = "ready";
    conn.linkGeneration = opened.linkGeneration;
    conn.scopeKey = enrolment.scopeKey;
    conn.enrolmentRef = enrolment.enrolmentRef;
    conn.nodeId = enrolment.nodeId;
    conn.catalogueStager = new CatalogueSliceStager({ expectedNodeId: conn.nodeId });
    conn.catalogueView = null;
    conn.catalogueFault = null;
    conn.currentBindNonce = `bn-${conn.id}-${this.#nextBindNonceCounter++}-${randomBytes(12).toString("base64url")}`;
    this.#liveConnections.set(enrolment.scopeKey, conn);

    this.sendRecord(conn, {
      t: "ready",
      ch: 0,
      linkGeneration: conn.linkGeneration,
      serverTime: this.#clock.now(),
      bindNonce: conn.currentBindNonce,
      revokedInstances: [...enrolment.revokedInstances],
      limits: {
        maxCreditRecords: 8,
        maxCreditBytes: 131072,
        maxCatalogueRecordBytes: this.#contract.maxCatalogueRecordBytes
      }
    });
  }

  #handleInstanceBind(conn, rec) {
    const enrolment = this.#enrolments.get(conn.enrolmentRef);
    const nextBindNonce = `bn-${conn.id}-${this.#nextBindNonceCounter++}-${randomBytes(12).toString("base64url")}`;
    const expectedNonce = conn.currentBindNonce;
    conn.currentBindNonce = nextBindNonce;

    if (!enrolment || enrolment.revoked) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "record-revoked",
        bindNonce: nextBindNonce
      });
      return;
    }
    if (enrolment.revokedInstances.has(rec.instanceId)) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "instance-revoked",
        bindNonce: nextBindNonce
      });
      return;
    }
    if (rec.bindNonce !== expectedNonce) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "bad-signature",
        bindNonce: nextBindNonce
      });
      return;
    }
    const pubKeyObj = rawEd25519PublicKeyToKeyObject(rec.instancePublicKey);
    if (!pubKeyObj) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "bad-signature",
        bindNonce: nextBindNonce
      });
      return;
    }
    const expectedFp = computeExpectedWET2Fingerprint(Buffer.from(rec.instancePublicKey, "base64"));
    if (rec.instanceFingerprint !== expectedFp) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "bad-signature",
        bindNonce: nextBindNonce
      });
      return;
    }
    const payloadBytes = this.#contract.canonicalInstanceBindBytes({
      meshId: this.#meshId,
      endpoint: this.#endpoint,
      tenantId: this.#tenantId,
      enrolmentRef: conn.enrolmentRef,
      nodeId: conn.nodeId,
      instanceId: rec.instanceId,
      instancePublicKey: rec.instancePublicKey,
      bindNonce: rec.bindNonce
    });
    let validSig = false;
    try {
      validSig = verify(null, payloadBytes, pubKeyObj, Buffer.from(rec.sig, "base64"));
    } catch {
      validSig = false;
    }
    if (!validSig) {
      this.sendRecord(conn, {
        t: "instance.bound",
        ch: 0,
        instanceId: rec.instanceId,
        status: "refused",
        reason: "bad-signature",
        bindNonce: nextBindNonce
      });
      return;
    }
    enrolment.boundInstances.set(rec.instanceId, {
      instancePublicKey: rec.instancePublicKey,
      instanceFingerprint: rec.instanceFingerprint,
      status: "live"
    });
    this.sendRecord(conn, {
      t: "instance.bound",
      ch: 0,
      instanceId: rec.instanceId,
      status: "live",
      bindNonce: nextBindNonce
    });
  }
}

export function verifyIndependentAuthSignature(authRecord, helloRecord, publicKeyPem) {
  const payload = {
    nonce: helloRecord.nonce,
    meshId: helloRecord.meshId,
    endpoint: helloRecord.endpoint,
    tenantId: helloRecord.tenantId,
    serverTime: helloRecord.serverTime,
    nodeId: authRecord.nodeId,
    enrolmentRef: authRecord.enrolmentRef,
    protocolVersions: authRecord.protocolVersions,
    clientTime: authRecord.clientTime
  };
  return verifyTrunkAuthPayload(payload, authRecord.signature, publicKeyPem);
}

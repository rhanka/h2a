import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editVibeMcpServers } from "../../h2a/src/hosts/vibe-mcp.js";
import { SEAT_CLIS_5, makeSyntheticConsumerBundle, makeSyntheticSeatBundle } from "./cli-seat-fixtures.js";
import * as seats from "./cli-seat-materialization.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "seat-tour3-")); vi.stubEnv("XDG_RUNTIME_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const options = () => ({ parentDir: root, gateway: "off" as const, mode: "token" as const, labProfile: "lab-tour3" });

describe("review 348 round 2", () => {
  it("removes secret names without treating their short values as secret substrings", () => {
    const safe = { PATH: "/h2a/bin:/usr/bin", HOME: "/tmp/h2a-1", PWD: "/tmp/h2a", H2A_NATIVE_TERMINAL: "1", XDG_RUNTIME_DIR: "/tmp/runtime-1000", ENABLED: "true" };
    expect(seats.sanitizeEnvJson({ ...safe, AGY_ADC_AUTH: "1", GCLOUD_PROJECT: "h2a", SECRET_FLAG: "true", MAX_TOKENS: "1" }, []).env).toEqual(safe);
    expect(seats.sanitizeEnvJson({ SAFE: "prefix-explicit-secret", ENCODED: Buffer.from("explicit-secret").toString("base64") }, ["explicit-secret"]).env).toEqual({});
  });

  it.each(SEAT_CLIS_5)("writes the selected native reference for %s, without mesh or canonical material", cli => {
    const bundle = makeSyntheticConsumerBundle(cli);
    bundle.nativeUse!.accessRef = "synthetic-native-selected";
    bundle.meshUse.accessRef = "synthetic-mesh-unselected";
    const keyring = { materialize: vi.fn(({ runDir }) => ({ profileRef: "isolated", childEnv: { DBUS_SESSION_BUS_ADDRESS: `unix:path=${runDir}/keyring` }, dispose() {} })) };
    const seat = seats.materializeSeatBundle(bundle, { ...options(), keyring });
    try {
      const written = cli === "agy" ? JSON.stringify(keyring.materialize.mock.calls[0]![0]) : seat.credentialPaths.map(p => readFileSync(p, "utf8")).join("\n");
      expect(written).toContain("synthetic-native-selected");
      expect(written).not.toContain("synthetic-mesh-unselected");
      expect(written).not.toMatch(/refresh_token|refreshToken/);
    } finally { seats.destroyMaterializedSeat(seat); }
  });

  it.each(["codex", "claude", "muse", "agy"] as const)("delegates canonical renewable material for serialized-only %s", cli => {
    const bundle = makeSyntheticSeatBundle(cli);
    expect(bundle.nativeUse).toEqual({ kind: "unavailable", reason: "serialized-only" });
    bundle.canonical!.materialRef = "synthetic-canonical-selected";
    const ticket = seats.beginSerializedStream(bundle.identity.refreshFamilyRef!, bundle.lifecycle);
    const keyring = { materialize: vi.fn(({ runDir }) => ({ profileRef: "isolated", childEnv: { DBUS_SESSION_BUS_ADDRESS: `unix:path=${runDir}/keyring` }, dispose() {} })) };
    const seat = seats.materializeSeatBundle(bundle, { ...options(), delegate: true, trustedContext: { trustedAuthority: "custodian" }, streamTicket: ticket, keyring });
    try {
      expect(seat.receipt.capability).toBe("serialized");
      const written = cli === "agy" ? JSON.stringify(keyring.materialize.mock.calls[0]![0]) : seat.credentialPaths.map(p => readFileSync(p, "utf8")).join("\n");
      expect(written).toContain("synthetic-canonical-selected");
      expect(written).toMatch(/renewable|refresh_token|refreshToken/);
      expect(JSON.stringify({ env: seat.childEnv, receipt: seat.receipt })).not.toContain("synthetic-canonical-selected");
    } finally { seats.destroyMaterializedSeat(seat); }
    seats.captureSerializedResult(ticket, { failed: false, changed: false, ambiguous: false });
    expect(seats.validateStreamClearance(ticket, { ...ticket, cleanupComplete: true }).cleared).toBe(true);
  });

  it("renders Vibe MCP env inside the array entry so the native editor can update and remove it", () => {
    const seat = seats.materializeSeatBundle(makeSyntheticConsumerBundle("vibe"), options());
    try {
      const text = readFileSync(seat.mcpConfigPath, "utf8");
      const removed = editVibeMcpServers(text, null);
      expect(removed.text).not.toContain("mcp_servers.env");
      const updated = editVibeMcpServers(text, { name: "h2a", transport: "stdio", command: "/usr/bin/node", args: ["mcp-serve"] });
      expect(editVibeMcpServers(updated.text, null).text).not.toContain("h2a");
    } finally { seats.destroyMaterializedSeat(seat); }
  });

  it.each(["codex", "claude", "muse", "agy"] as const)("executes and clears a serialized %s diagonal cell", cli => {
    const a = makeSyntheticSeatBundle(cli), b = makeSyntheticSeatBundle(cli);
    b.identity.seatRef += "-peer"; b.identity.refreshFamilyRef += "-peer";
    a.nativeUse = b.nativeUse = { kind: "unavailable", reason: "serialized-only" };
    const result = seats.runSyntheticSeatCell(cli, cli, "loop", { parentDir: root, admission: { entitlementClass: "lab-seat", ownerApproved: true, q3Approved: true, consumedUnits: 0, requestedUnits: 1 }, bundles: [a, b] });
    expect(result.outcome).toBe("synthetic-pass");
    expect(result.actors.map(a => a.capability)).toEqual(["serialized", "serialized"]);
    for (const bundle of [a, b]) {
      const ticket = seats.beginSerializedStream(bundle.identity.refreshFamilyRef!, bundle.lifecycle);
      expect(existsSync(join(ticket.lockDir, "materialized.json"))).toBe(false);
      seats.captureSerializedResult(ticket, { failed: false, changed: false, ambiguous: false });
      expect(seats.validateStreamClearance(ticket, { ...ticket, cleanupComplete: true }).cleared).toBe(true);
    }
  });

  it.each(["nativeUse", "meshUse"])("classifies nested refresh fields in %s", projection => {
    const b = makeSyntheticConsumerBundle("codex");
    expect(seats.validateSeatBundleForMaterialization({ ...b, [projection]: { kind: "access", nested: [{ refresh_token: "invented" }] } })).toMatchObject({ ok: false, code: "nested-refresh-field" });
  });
  it("classifies the first renewal field consistently when nested and direct fields coexist", () => {
    const b = makeSyntheticConsumerBundle("codex");
    expect(seats.validateSeatBundleForMaterialization({ ...b, nativeUse: { kind: "access", hidden: { refreshToken: "invented" }, refresh_token: "invented" } })).toMatchObject({ ok: false, code: "nested-refresh-field" });
  });
  it("requires canonical renewable material on the custodian channel", () => {
    const b = makeSyntheticSeatBundle("codex"); delete b.canonical;
    expect(seats.validateSeatBundleForMaterialization(b, { trustedAuthority: "custodian" })).toMatchObject({ ok: false, code: "schema-mismatch" });
  });
  it.each(["access-only", "static-key"] as const)("refuses custody refresh for %s", cls => {
    const b = makeSyntheticSeatBundle(cls === "static-key" ? "vibe" : "codex");
    b.credentialClass = cls; b.lifecycle.refreshAuthority = "custody"; delete b.canonical;
    expect(seats.validateSeatBundleForMaterialization(b, { trustedAuthority: "custodian" })).toMatchObject({ ok: false, code: "invalid-lifecycle" });
  });
  it.each(["canonical", "custody"])("classifies consumer %s as authority escalation", field => {
    const b = makeSyntheticConsumerBundle("codex");
    if (field === "canonical") b.canonical = { kind: "static-key-material", materialRef: "invented" };
    else b.lifecycle.refreshAuthority = "custody";
    expect(seats.validateSeatBundleForMaterialization(b)).toMatchObject({ ok: false, code: "authority-escalation" });
  });
});

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as accounts from "./llm-mesh-accounts.js";
import { makeSyntheticConsumerBundle, SEAT_CLIS_5, SEAT_PACKAGE_PROVIDER_ID, SEAT_BUNDLE_MAX_BYTES } from "./cli-seat-fixtures.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "seat-enroll-")); vi.stubEnv("XDG_RUNTIME_DIR", root); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const enroll = (provider: string, options: object) => (accounts as unknown as Record<string, Function>).enrollSeatConsumerViaFacade!(provider, options);

for (const cli of SEAT_CLIS_5) for (const from of ["cli", "token"] as const) {
  it(`imports ${cli} from ${from} through the pinned L1 consumer boundary without renewable product fallback`, async () => {
    const bundle = makeSyntheticConsumerBundle(cli);
    bundle.lifecycle.providerExpiry = "2030-01-01T00:00:00Z";
    bundle.nativeUse = { kind: "unavailable", reason: "serialized-only" };
    const profile = { cli, ownerScope: bundle.identity.ownerScope, issuingClientRef: bundle.identity.issuingClientRef, endpointFamily: bundle.identity.endpointFamily, accessRef: bundle.meshUse.accessRef };
    const path = join(root, "private-profile.json"); writeFileSync(path, JSON.stringify(profile), { mode: 0o600 });
    const parsers = { parseCliSeatProfile: vi.fn().mockReturnValue(bundle), parseTokenSeatEnvelope: vi.fn().mockReturnValue(bundle) };
    const facade = { importSeatBundle: vi.fn().mockResolvedValue({ accountId: "account-synthetic", seatRef: bundle.identity.seatRef, generation: 1, idempotent: false }), enroll: vi.fn(), completeClaudeCredentialImport: vi.fn(), completeMuseImport: vi.fn(), acquire: vi.fn(), refresh: vi.fn() };
    const readInput = vi.fn().mockResolvedValue(JSON.stringify(bundle));
    const result = await enroll(cli, { from, ownerScope: bundle.identity.ownerScope, seatProfile: path, facade, parsers, readInput });
    expect(result).toMatchObject({ accountId: "account-synthetic", provider: SEAT_PACKAGE_PROVIDER_ID[cli] });
    expect(facade.importSeatBundle).toHaveBeenCalledExactlyOnceWith({ bundle, ownerScope: bundle.identity.ownerScope });
    expect(JSON.stringify(facade.importSeatBundle.mock.calls)).not.toMatch(/refresh_token|refreshToken|"custody"/);
    if (from === "cli") { expect(parsers.parseCliSeatProfile).toHaveBeenCalledExactlyOnceWith(profile); expect(readInput).not.toHaveBeenCalled(); }
    else expect(parsers.parseTokenSeatEnvelope).toHaveBeenCalledExactlyOnceWith({ raw: JSON.stringify(bundle), ownerScope: bundle.identity.ownerScope });
    for (const name of ["enroll", "completeClaudeCredentialImport", "completeMuseImport", "acquire", "refresh"] as const) expect(facade[name]).not.toHaveBeenCalled();
  });
}

it.each(SEAT_CLIS_5)("refuses an older facade before collecting %s input", async cli => {
  const readInput = vi.fn(), facade = { enroll: vi.fn(), completeClaudeCredentialImport: vi.fn() };
  await expect(enroll(cli, { from: "token", ownerScope: "owner-synth-01", facade, readInput })).rejects.toMatchObject({ code: "seat-import-unavailable" });
  expect(readInput).not.toHaveBeenCalled(); expect(facade.enroll).not.toHaveBeenCalled(); expect(facade.completeClaudeCredentialImport).not.toHaveBeenCalled();
});

it.each(["owner", "provider", "canonical", "refresh", "expiry", "oversize"])("refuses %s before any L1 persistence", async fault => {
  const b = makeSyntheticConsumerBundle("codex"); b.lifecycle.providerExpiry = "2030-01-01T00:00:00Z";
  if (fault === "owner") b.identity.ownerScope = "other-owner";
  if (fault === "provider") b.identity.cli = "claude";
  if (fault === "canonical") b.canonical = { kind: "renewable-material", materialRef: "invented" };
  if (fault === "refresh") b.lifecycle.refreshAuthority = "custody";
  if (fault === "expiry") delete b.lifecycle.providerExpiry;
  const raw = fault === "oversize" ? "x".repeat(SEAT_BUNDLE_MAX_BYTES + 1) : JSON.stringify(b);
  const facade = { importSeatBundle: vi.fn() };
  const parsers = { parseCliSeatProfile: vi.fn(), parseTokenSeatEnvelope: vi.fn().mockReturnValue(b) };
  await expect(enroll("codex", { from: "token", ownerScope: "owner-synth-01", facade, parsers, readInput: async () => raw })).rejects.toThrow();
  expect(facade.importSeatBundle).not.toHaveBeenCalled();
});

it("keeps dynamic L1 errors and profile bodies out of the public error", async () => {
  const b = makeSyntheticConsumerBundle("codex"); b.lifecycle.providerExpiry = "2030-01-01T00:00:00Z";
  const secret = "SYNTHETIC-IMPORT-ERROR-SECRET";
  const facade = { importSeatBundle: vi.fn().mockRejectedValue(new Error(secret)) };
  await expect(enroll("codex", { from: "token", ownerScope: b.identity.ownerScope, facade, parsers: { parseTokenSeatEnvelope: () => b }, readInput: async () => JSON.stringify(b) })).rejects.toThrow("seat consumer import failed");
});

it.each(["owner", "oversize", "permissions", "symlink"])("refuses a %s CLI profile before parsing or persistence", async fault => {
  const path = join(root, "profile.json");
  writeFileSync(path, fault === "oversize" ? "x".repeat(SEAT_BUNDLE_MAX_BYTES + 1) : JSON.stringify({ ownerScope: fault === "owner" ? "foreign" : "owner-synth-01" }), { mode: fault === "permissions" ? 0o644 : 0o600 });
  const link = join(root, "profile-link"); if (fault === "symlink") symlinkSync(path, link);
  const parsers = { parseCliSeatProfile: vi.fn() }, facade = { importSeatBundle: vi.fn() };
  await expect(enroll("codex", { from: "cli", ownerScope: "owner-synth-01", seatProfile: fault === "symlink" ? link : path, facade, parsers })).rejects.toMatchObject({ code: "seat-input-refused" });
  expect(parsers.parseCliSeatProfile).not.toHaveBeenCalled(); expect(facade.importSeatBundle).not.toHaveBeenCalled();
});

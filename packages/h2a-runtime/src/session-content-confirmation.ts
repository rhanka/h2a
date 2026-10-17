/** F2 native proof primitive. A valid result is not a transferable execution permission.
 * Native integration must supply its synchronous durable denial/consumption fence.
 * No content capture or remote effect is enabled by this module alone.
 */
import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { performance } from "node:perf_hooks";
import { canonicalJson, contentDigest, parseStrictJson } from "./session-content-json.js";

export interface ConfirmationChallenge {
  id: string;
  owner: { issuer: string; subject: string };
  project: { tenantId: string; workspaceId: string; workspaceIncarnation: string; projectId: string | null };
  source: { workstationId: string; bindingId: string; bindingVersion: number; sourceId: string;
    sourceGeneration: string; sourceBootId: string };
  clientId: string;
  purpose: "share" | "amend" | "remote-action";
  target: { kind: "policy"; policyDigest: string } | { kind: "action"; scopeDigest: string;
    operation: string; operationId: string; connectionId: string; controllerEpoch: number;
    byteLength: number; payloadHash: string };
  random: string;
  issuedAt: number;
  expiresAt: number;
}
export function confirmationNonce(challenge: ConfirmationChallenge): string {
  return Buffer.from(contentDigest("confirmation", challenge), "hex").toString("base64url");
}
type Jwk = JsonWebKey & { kid: string; alg: string; use: string };
function refused(reason = "invalid_confirmation"): never { throw new Error(reason); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refused();
  return value as Record<string, unknown>;
}
function decode(part: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return refused();
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) return refused();
  return bytes;
}
function claimsPart(part: string): Record<string, unknown> {
  return object(parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(decode(part)), 16384));
}

/** One shared instance per native host, not per connection or claimed source. */
export class ConfirmationBudget {
  private pending = new Map<object, { owner: string; source: string; deadline: number }>();
  private owners = new Map<string, { tokens: number; at: number }>();
  private host = { tokens: 16, at: 0 };
  constructor(private readonly now: () => number = () => performance.now()) { this.host.at = now(); }
  reserve(owner: string, source: string, deadline: number): object {
    const now = this.now();
    for (const [key, value] of this.pending) if (value.deadline <= now) this.pending.delete(key);
    for (const [key, value] of this.owners) if (now - value.at >= 40_000) this.owners.delete(key);
    if (this.pending.size >= 16 || [...this.pending.values()].filter(p => p.owner === owner && p.source === source).length >= 4) return refused("resource_busy");
    const bucket = this.owners.get(owner) ?? { tokens: 4, at: now };
    const available = Math.min(4, bucket.tokens + (now - bucket.at) / 10000);
    const hostAvailable = Math.min(16, this.host.tokens + (now - this.host.at) / 2500);
    if (available < 1 || hostAvailable < 1) return refused("rate_limited");
    // Bound owner accounting too. Entries fully refill in 40s and can then be forgotten.
    if (!this.owners.has(owner) && this.owners.size >= 256) return refused("resource_busy");
    this.owners.set(owner, { tokens: available - 1, at: now });
    this.host = { tokens: hostAvailable - 1, at: now };
    const key = Object.freeze({}); this.pending.set(key, { owner, source, deadline }); return key;
  }
  live(key: object): boolean { const p = this.pending.get(key); return !!p && p.deadline > this.now(); }
  release(key: object): void { this.pending.delete(key); }
}
interface Pending { challenge: ConfirmationChallenge; wall: number; mono: number; deadline: number; slot: object }
interface Config {
  issuer: string; clientId: string; tenantId: string; subject: string; keys: readonly Jwk[];
  source: ConfirmationChallenge["source"];
  measuredClockErrorMs: number | null; budget: ConfirmationBudget;
  wallNow?: () => number; monotonicNow?: () => number;
}
export class ConfirmationVerifier {
  private keys = new Map<string, KeyObject>();
  private pending = new Map<object, Pending>();
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly config: Config;
  constructor(config: Config) {
    this.config = { ...config, source: structuredClone(config.source) };
    this.wallNow = config.wallNow ?? Date.now;
    this.monotonicNow = config.monotonicNow ?? (() => performance.now());
    if (config.measuredClockErrorMs === null || !Number.isFinite(config.measuredClockErrorMs)
      || config.measuredClockErrorMs < 0 || config.measuredClockErrorMs > 5000) refused("unknown_clock");
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash) refused();
    this.replaceKeys(config.keys);
  }
  /** Only a trusted pinned-issuer JWKS loader may call this; JWT headers never choose keys/URLs. */
  replaceKeys(keys: readonly Jwk[]): void {
    if (keys.length < 1 || keys.length > 16) refused();
    const next = new Map<string, KeyObject>();
    for (const key of keys) {
      if (key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" || key.d || !key.kid
        || key.kid.length > 128 || next.has(key.kid)) refused();
      const publicKey = createPublicKey({ key, format: "jwk" });
      if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) refused();
      next.set(key.kid, publicKey);
    }
    this.keys = next;
  }
  stage(input: ConfirmationChallenge): object {
    const wall = this.wallNow(), mono = this.monotonicNow();
    this.prune();
    const ch = structuredClone(input);
    if (ch.owner.issuer !== this.config.issuer || ch.owner.subject !== this.config.subject
      || ch.project.tenantId !== this.config.tenantId || ch.clientId !== this.config.clientId
      || canonicalJson(ch.source) !== canonicalJson(this.config.source)
      || !Number.isSafeInteger(ch.issuedAt) || !Number.isSafeInteger(ch.expiresAt)
      || ch.issuedAt !== wall || ch.expiresAt <= wall || ch.expiresAt - wall > 60000
      || !/^[A-Za-z0-9_-]{43}$/.test(ch.random) || decode(ch.random).length !== 32
      || !(ch.purpose === "remote-action" ? ch.target.kind === "action"
        : ["share", "amend"].includes(ch.purpose) && ch.target.kind === "policy")
      || Buffer.byteLength(JSON.stringify(ch)) > 8192) refused();
    // This primitive accepts a native-generated challenge; the wire-schema validates exact fields.
    confirmationNonce(ch);
    const deadline = mono + ch.expiresAt - wall;
    const slot = this.config.budget.reserve(JSON.stringify([ch.owner.issuer, ch.owner.subject]),
      JSON.stringify([ch.source.workstationId, ch.source.bindingId, ch.source.bindingVersion,
        ch.source.sourceId, ch.source.sourceGeneration, ch.source.sourceBootId]), deadline);
    const handle = Object.freeze({}); this.pending.set(handle, { challenge: ch, wall, mono, deadline, slot });
    return handle;
  }
  cancelAll(): void {
    for (const p of this.pending.values()) this.config.budget.release(p.slot);
    this.pending.clear();
  }
  private prune(): void {
    for (const [handle, p] of this.pending) if (!this.config.budget.live(p.slot)) this.pending.delete(handle);
  }
  consume(handle: object, token: string, fence: { commit: (challengeId: string, proofDigest: string) => void }): {
    challengeId: string; proofDigest: string; purpose: ConfirmationChallenge["purpose"];
  } {
    const p = this.pending.get(handle);
    if (!p || !this.config.budget.live(p.slot)) return refused();
    const wall = this.wallNow(), mono = this.monotonicNow();
    const skew = this.config.measuredClockErrorMs!;
    if (mono < p.mono || mono >= p.deadline || Math.abs((wall - p.wall) - (mono - p.mono)) > 1000) return refused("unknown_clock");
    if (typeof token !== "string" || token.length > 24576) return refused();
    const parts = token.split(".");
    if (parts.length !== 3) return refused();
    const [h, c, s] = parts as [string, string, string];
    const header = claimsPart(h), claims = claimsPart(c);
    if (Object.keys(header).some(k => !["alg", "kid", "typ"].includes(k)) || header.alg !== "RS256"
      || (header.typ !== undefined && header.typ !== "JWT") || typeof header.kid !== "string") return refused();
    const key = this.keys.get(header.kid);
    if (!key || !verify("RSA-SHA256", Buffer.from(`${h}.${c}`), key, decode(s))) return refused();
    const ch = p.challenge;
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!Array.isArray(audiences) || !audiences.every(x => typeof x === "string") || !audiences.includes(ch.clientId)
      || (audiences.length > 1 && claims.azp !== ch.clientId)
      || (claims.azp !== undefined && claims.azp !== ch.clientId)
      || claims.iss !== ch.owner.issuer || claims.sub !== ch.owner.subject || claims.tenantId !== ch.project.tenantId
      || claims.nonce !== confirmationNonce(ch) || claims.acr !== "urn:sentropic:loa:passkey-fresh"
      || !Array.isArray(claims.amr) || !["hwk", "user", "mfa"].every(x => (claims.amr as unknown[]).includes(x))) return refused();
    for (const name of ["exp", "iat", "auth_time"]) if (!Number.isSafeInteger(claims[name]) || (claims[name] as number) < 0) return refused();
    const exp = (claims.exp as number) * 1000, iat = (claims.iat as number) * 1000, auth = (claims.auth_time as number) * 1000;
    if (![exp, iat, auth].every(Number.isSafeInteger) || exp <= wall || exp <= iat || iat > wall + skew
      || iat < p.wall - skew - 1000 || auth < p.wall - skew - 1000 || auth > wall + skew
      || auth > iat + skew + 1000 || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) * 1000 > wall))) return refused();
    const proofDigest = createHash("sha256").update(token).digest("hex");
    // Remove before the fence: uncertain journal outcomes must never get an automatic retry.
    this.pending.delete(handle); this.config.budget.release(p.slot);
    const result: unknown = fence.commit(ch.id, proofDigest);
    if (result && typeof (result as unknown as { then?: unknown }).then === "function") return refused("invalid_fence");
    return { challengeId: ch.id, proofDigest, purpose: ch.purpose };
  }
}

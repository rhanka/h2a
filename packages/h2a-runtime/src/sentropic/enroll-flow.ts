/**
 * sentropic enrollment — Lot 0: the D1 auth flow SHAPE (PKCE authorization_code + device-code
 * fallback), pure. Spec §3. The actual HTTP exchange is injected as a SEAM (`TokenExchange`) — this
 * module owns only the deterministic, testable parts: building the /authorize request (PKCE S256 +
 * state), and the device-code polling state machine (backoff, slow_down, expiry). No live 39-auth
 * call is wired in Lot 0 (that leg + the server are later lots).
 *
 * pkceS256 is mirrored from packages/h2a/.../oauth/crypto.ts on purpose: h2a-runtime must not import
 * the @sentropic/h2a core (anti-cycle: core stays a leaf). It is 3 lines of node:crypto.
 */

import { createHash, randomBytes } from "node:crypto";

import type { SentropicAuthToken } from "./auth-token.js";

/** A fresh PKCE S256 pair. The verifier is held locally; the challenge goes on the wire. */
export function pkceS256(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export interface AuthorizeConfig {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface AuthorizeRequest {
  /** the full /authorize URL to open in the browser. */
  url: string;
  /** the PKCE verifier to keep locally for the token exchange. */
  verifier: string;
  /** the CSRF/replay state to match on the callback. */
  state: string;
}

/** Build the browser authorization_code+PKCE request (deterministic given the injected pkce/state). */
export function buildAuthorizeRequest(
  cfg: AuthorizeConfig,
  pkce: { verifier: string; challenge: string } = pkceS256(),
  state: string = randomState(),
): AuthorizeRequest {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", pkce.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return { url: u.toString(), verifier: pkce.verifier, state };
}

/** Verify the callback state matches the one we issued (CSRF/replay guard). */
export function verifyCallbackState(issued: string, returned: string): boolean {
  return issued.length > 0 && issued === returned;
}

// ---- device-code fallback (headless) ---------------------------------------------------------

export type DevicePollStatus =
  | "pending"
  | "slow_down"
  | "authorized"
  | "denied"
  | "expired";

export interface DevicePollResult {
  status: DevicePollStatus;
  token?: SentropicAuthToken;
}

/**
 * Next poll delay for the device-code loop: honour `slow_down` by growing the interval, and never
 * poll past `expiresAt`. Pure — the loop driver supplies the clock.
 */
export function nextDevicePollDelayMs(
  currentMs: number,
  gotSlowDown: boolean,
  { minMs = 1000, maxMs = 15000, growthMs = 5000 }: { minMs?: number; maxMs?: number; growthMs?: number } = {},
): number {
  const base = Math.max(minMs, currentMs);
  return Math.min(maxMs, gotSlowDown ? base + growthMs : base);
}

export function deviceFlowExpired(expiresAtMs: number, now: number): boolean {
  return now >= expiresAtMs;
}

// ---- the network SEAM ------------------------------------------------------------------------

/** Injected HTTP exchange (browser code→token, or device poll→token). Not implemented in Lot 0. */
export type TokenExchange = (args: {
  server: string;
  verifier?: string;
  code?: string;
  deviceCode?: string;
}) => Promise<SentropicAuthToken>;

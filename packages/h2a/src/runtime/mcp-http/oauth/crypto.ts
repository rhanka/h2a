/**
 * EVO-12 hosted OAuth — token crypto helpers (ported from mcp-wave, generic).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenHashPrefix(tokenHash: string): string {
  return tokenHash.slice(0, 12);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(sha256Hex(a), "hex");
  const right = Buffer.from(sha256Hex(b), "hex");
  return timingSafeEqual(left, right);
}

/**
 * EVO-12 P2 (mode 3): a fresh PKCE pair for the gateway's upstream 39-auth leg.
 * The verifier is held server-side (broker pending state); the S256 challenge
 * goes on the wire to /authorize.
 */
export function pkceS256(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

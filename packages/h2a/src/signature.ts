import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { canonicalize } from "./canonical.js";
import type { H2ASignature } from "./types.js";

export interface SignOptions {
  by: string;
  privateKeyPem: string;
}

export function signCanonical(value: unknown, options: SignOptions): H2ASignature {
  const key = createPrivateKey({ key: options.privateKeyPem, format: "pem" });
  const message = Buffer.from(canonicalize(value), "utf8");
  const signature = sign(null, message, key);
  return {
    by: options.by,
    alg: "ed25519",
    value: signature.toString("base64")
  };
}

export function verifyCanonical(
  value: unknown,
  signature: H2ASignature,
  publicKeyPem: string
): boolean {
  if (signature.alg !== "ed25519") {
    return false;
  }
  let key;
  try {
    key = createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch {
    return false;
  }
  const message = Buffer.from(canonicalize(value), "utf8");
  let raw: Buffer;
  try {
    raw = Buffer.from(signature.value, "base64");
  } catch {
    return false;
  }
  try {
    return verify(null, message, key, raw);
  } catch {
    return false;
  }
}

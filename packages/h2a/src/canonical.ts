import { createHash } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function toCanonical(value: unknown): CanonicalValue {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonical(entry));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sortedKeys = Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort();
    const out: Record<string, CanonicalValue> = {};
    for (const key of sortedKeys) {
      out[key] = toCanonical(source[key]);
    }
    return out;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`canonicalize: non-finite numbers are not supported (${value})`);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new Error(`canonicalize: unsupported value type (${typeof value})`);
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(toCanonical(value));
}

export function computeHash(value: unknown): string {
  const canonical = canonicalize(value);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

/** Bounded duplicate-rejecting JSON and RFC 8785 canonicalization for F2. No credentials in errors. */
export function canonicalJson(value: unknown): string {
  function encode(v: unknown, depth: number): string {
    if (depth > 32) throw new Error("invalid_json");
    if (v === null || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v === "string") {
      if (Buffer.from(v).toString("utf8") !== v) throw new Error("invalid_unicode");
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return `[${v.map(x => encode(x, depth + 1)).join(",")}]`;
    if (typeof v === "object" && v && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      return `{${Object.keys(v).sort().map(k => `${encode(k, depth + 1)}:${encode((v as Record<string, unknown>)[k], depth + 1)}`).join(",")}}`;
    }
    throw new Error("invalid_json");
  }
  return encode(value, 0);
}

export function parseStrictJson(text: string, maxBytes = 65536): unknown {
  if (Buffer.byteLength(text) > maxBytes || Buffer.from(text).toString("utf8") !== text) throw new Error("invalid_json");
  let at = 0, nodes = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(text[at] ?? "!") && at < text.length) at++; };
  const fail = (): never => { throw new Error("invalid_json"); };
  function string(): string {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === "\\") at++;
      else if (c === '"') {
        const result: unknown = JSON.parse(text.slice(start, at));
        if (typeof result !== "string" || Buffer.from(result).toString("utf8") !== result) return fail();
        return result;
      }
    }
    return fail();
  }
  function value(depth: number): unknown {
    if (++nodes > 10000 || depth > 32) return fail();
    ws();
    if (text[at] === '"') return string();
    const c = text[at];
    if (c === "{" || c === "[") {
      at++; ws();
      const object = Object.create(null) as Record<string, unknown>, array: unknown[] = [];
      const close = c === "{" ? "}" : "]";
      if (text[at] === close) { at++; return c === "{" ? object : array; }
      while (true) {
        ws();
        if (c === "{") {
          if (text[at] !== '"') return fail();
          const key = string(); ws();
          if (Object.hasOwn(object, key) || text[at++] !== ":") return fail();
          object[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        ws();
        if (text[at] === close) { at++; break; }
        if (text[at++] !== ",") return fail();
      }
      return c === "{" ? object : array;
    }
    const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) return fail();
    at += match[0].length;
    const result: unknown = JSON.parse(match[0]);
    if (typeof result === "number" && !Number.isFinite(result)) return fail();
    return result;
  }
  const result = value(0); ws();
  if (at !== text.length) return fail();
  return result;
}

export function contentDigest(purpose: string, value: unknown): string {
  // Kept separate from raw payload hashes; domains are contract constants, never secrets.
  return createHash("sha256").update(`h2a.session-content/2/${purpose}\n`).update(canonicalJson(value)).digest("hex");
}
import { createHash } from "node:crypto";

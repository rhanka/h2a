/**
 * Injection ledger writer for `@sentropic/h2a-runtime` (Lot 3b, spec §7.6 & §8).
 *
 * Implements the file contract independently (no cross-package import with
 * `@sentropic/h2a`; conformance is pinned by
 * `packages/h2a/fixtures/injection-ledger-vectors.json`).
 *
 * File contract:
 *  - Folder: `<stateHome>/h2a/injected/`, mode 0700
 *    (`stateHome` = `XDG_STATE_HOME` when non-empty, else `<HOME>/.local/state`)
 *  - File per session: SHA-256 hex digest of `sessionKey` (`native:<name>` or `tmux:<name>`), mode 0600
 *  - Line format (JSONL): `{ "at": <epoch ms>, "digest": <SHA-256 hex of normalised text> }`
 *  - Normalisation: CRLF & lone CR -> LF, trailing line breaks removed, surrounding whitespace trimmed, UTF-8
 *  - Window: 120 seconds; older entries dropped at each write and ignored at each read
 *  - Raw injected text is NEVER stored in the ledger file.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const INJECTION_LEDGER_WINDOW_MS = 120_000;

const HEX64_RE = /^[0-9a-f]{64}$/;

export interface InjectionLedgerEntry {
  readonly at: number;
  readonly digest: string;
}

export interface InjectionLedgerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: number;
}

export function normalizeInjectionText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/g, "")
    .trim();
}

export function digestInjectionText(text: string): string {
  return createHash("sha256")
    .update(normalizeInjectionText(text), "utf8")
    .digest("hex");
}

export function sessionKeyFileName(sessionKey: string): string {
  return createHash("sha256").update(sessionKey, "utf8").digest("hex");
}

export function resolveInjectionLedgerDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env["XDG_STATE_HOME"];
  const stateBase =
    typeof xdg === "string" && xdg.length > 0
      ? xdg
      : join(env["HOME"] || homedir(), ".local", "state");
  return join(stateBase, "h2a", "injected");
}

export function resolveInjectionLedgerPath(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveInjectionLedgerDir(env), sessionKeyFileName(sessionKey));
}

function readExistingEntries(
  filePath: string,
  now: number,
  windowMs: number,
): InjectionLedgerEntry[] {
  let raw: string;
  try {
    const st = lstatSync(filePath);
    if (!st.isFile() || st.isSymbolicLink()) return [];
    raw = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const kept: InjectionLedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      continue;
    }
    const { at, digest } = parsed as { at?: unknown; digest?: unknown };
    if (
      typeof at !== "number" ||
      !Number.isFinite(at) ||
      typeof digest !== "string" ||
      !HEX64_RE.test(digest)
    ) {
      continue;
    }
    const age = now - at;
    if (age >= 0 && age <= windowMs) {
      kept.push({ at, digest });
    }
  }
  return kept;
}

export function readInjectionLedger(
  sessionKey: string,
  options: InjectionLedgerOptions = {},
): InjectionLedgerEntry[] {
  if (!sessionKey) return [];
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  return readExistingEntries(
    resolveInjectionLedgerPath(sessionKey, env),
    now,
    INJECTION_LEDGER_WINDOW_MS,
  );
}

export function recordInjection(
  sessionKey: string,
  text: string,
  options: InjectionLedgerOptions = {},
): InjectionLedgerEntry | undefined {
  if (!sessionKey) return undefined;
  const normalized = normalizeInjectionText(text);
  if (normalized.length === 0) return undefined;

  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const dir = resolveInjectionLedgerDir(env);

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dirStat = lstatSync(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error(`injection ledger directory is not a regular directory: ${dir}`);
  }
  chmodSync(dir, 0o700);

  const filePath = join(dir, sessionKeyFileName(sessionKey));
  const kept = readExistingEntries(filePath, now, INJECTION_LEDGER_WINDOW_MS);
  const entry: InjectionLedgerEntry = {
    at: now,
    digest: createHash("sha256").update(normalized, "utf8").digest("hex"),
  };
  kept.push(entry);

  const body = `${kept.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const tmpPath = join(
    dir,
    `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
  return entry;
}

/**
 * Best-effort wrapper for live runtime injection paths: recording into the
 * ledger must never change whether or when an injection executes.
 */
export function recordInjectionBestEffort(
  sessionKey: string | undefined,
  text: string,
  options: InjectionLedgerOptions = {},
): void {
  if (!sessionKey) return;
  try {
    recordInjection(sessionKey, text, options);
  } catch {
    // Best-effort ledger write: never block or alter runtime injection paths.
  }
}

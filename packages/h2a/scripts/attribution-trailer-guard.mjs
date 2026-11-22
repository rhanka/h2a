#!/usr/bin/env node
/**
 * Attribution trailer & owner-only commit identity guard — single source of
 * truth for commit-msg hooks, PreToolUse guards, audit tooling, and reusable
 * GitHub Actions PR/commit checks.
 *
 * Owner policy:
 *  - Zero `Co-Authored-By:` lines of any kind (human or AI, including GitHub squash trailers).
 *  - Identity criterion is EMAIL only by default: author email and committer email
 *    must be `fabien.antoine@m4x.org` (GitHub account `rhanka`); the display name is
 *    free (`Fabien Antoine`, `rhanka`, `antoinefa`, `Fabien ANTOINE`, etc. are compliant
 *    when the email matches).
 *  - Optional per-repo strict name enforcement via `--require-name "Fabien Antoine"`.
 *  - Committer exception: GitHub web-flow `GitHub <noreply@github.com>` ONLY for
 *    verified merges made by `rhanka` (>= 2 parents, owner author, GitHub web-flow
 *    PGP signature in CI, and `GITHUB_ACTOR=rhanka` on push).
 *  - Zero AI attribution trailers, footers, session URLs, or AI vendor emails.
 *  - Bare emoji (e.g. `🤖` in release notes / dependency PR bodies) is NOT attribution.
 *
 * Zero dependencies, Node-only, no /tmp writes.
 *
 * CLI usage:
 *   node attribution-trailer-guard.mjs check-file <msg-file> [--mode reject|strip] [--strip]
 *   node attribution-trailer-guard.mjs check-range <git-rev-range> [--repo <path>] [--require-name <name>] [--allow-unsigned-webflow]
 *   node attribution-trailer-guard.mjs check-pr [--repo <path>] [--base <sha>] [--head <sha>]
 *                                               [--require-name <name>]
 *                                               [--pr-author <login>] [--pr-author-env <VAR>]
 *                                               [--pr-title-env <VAR>] [--pr-body-env <VAR>]
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const GUARD_VERSION = "2";
export const GUARD_MARKER = "# h2a-attribution-trailer-guard: v2";

export const OWNER_NAME = "Fabien Antoine";
export const OWNER_EMAIL = "fabien.antoine@m4x.org";
export const OWNER_GITHUB_LOGIN = "rhanka";
export const GITHUB_WEBFLOW_NAME = "GitHub";
export const GITHUB_WEBFLOW_EMAIL = "noreply@github.com";
export const GITHUB_WEBFLOW_KEY_IDS = Object.freeze([
  "B5690EEEBB952194",
  "4AEE18F83AFDEB23",
]);
export const GITHUB_WEBFLOW_LEGACY_EXPIRED_KEY_IDS = Object.freeze([
  "4AEE18F83AFDEB23",
]);
export const GITHUB_WEBFLOW_KEY_FINGERPRINTS = Object.freeze([
  "968479A1AFF927E37D1A566BB5690EEEBB952194",
  "5DE3E0509C47EA3CF04A42D34AEE18F83AFDEB23",
]);

/**
 * Vendored GitHub web-flow commit-signing public keys (https://github.com/web-flow.gpg):
 *  - 4AEE18F83AFDEB23 (legacy, expired 2024-01-16)
 *  - B5690EEEBB952194 (active)
 */
export const GITHUB_WEBFLOW_GPG_PUBLIC_KEY = [
  "-----BEGIN PGP PUBLIC KEY BLOCK-----",
  "",
  "xsBNBFmUaEEBCACzXTDt6ZnyaVtueZASBzgnAmK13q9Urgch+sKYeIhdymjuMQta",
  "x15OklctmrZtqre5kwPUosG3/B2/ikuPYElcHgGPL4uL5Em6S5C/oozfkYzhwRrT",
  "SQzvYjsE4I34To4UdE9KA97wrQjGoz2Bx72WDLyWwctD3DKQtYeHXswXXtXwKfjQ",
  "7Fy4+Bf5IPh76dA8NJ6UtjjLIDlKqdxLW4atHe6xWFaJ+XdLUtsAroZcXBeWDCPa",
  "buXCDscJcLJRKZVc62gOZXXtPfoHqvUPp3nuLA4YjH9bphbrMWMf810Wxz9JTd3v",
  "yWgGqNY0zbBqeZoGv+TuExlRHT8ASGFS9SVDABEBAAHNNUdpdEh1YiAod2ViLWZs",
  "b3cgY29tbWl0IHNpZ25pbmcpIDxub3JlcGx5QGdpdGh1Yi5jb20+wsBoBBMBCAAc",
  "BQJZlGhBCRBK7hj4Ov3rIwIbAwUJDBJ3/wIZAQAA0O4IAJd0k8M+urETyMvTqNTj",
  "/U6nbqyOdKE4V93uUj5G7sNTfno7wod/Qjj6Zv5KodvA93HmEdQqsmVq5YJ5KGiw",
  "cmGCpd/GqJRPaYSY0hSUSBqYHiHLusCJkPBpQTBhcEMtfVCB2J6fVeoX2DV0K1xf",
  "CGblrSVB0viAxUMnmL5C55RuvbYZsTu8szXhkvIR96CtWbJ8QGaEf1/KSpWz8ept",
  "Y/omf3UPfvdOjnsxc8jVEqPNaR9xC6Q6t53rBa/XgMY6IYyesnyYnc5O6JuexUFa",
  "VjykRFtAiYfDaMARpXOmgMm0lhoBRKb/uMUaN3CSYTmE4pZweJcUi7eWgmoQljX2",
  "ut6ZAg0EZabFdgEQALI37i+IVAzpBCgqvQDZbSsZ0yhtMnA5myjZA+l7BvIGy4ve",
  "s1bk6YetbBcCE8o2pQjI7N2rwyhLGhNO6ouSyhqGLEQv9fafKE4HFH0aRjP+gj1H",
  "edhwtFoVChImhV863rWimQtTNtYB6GluBPwQqWfwmwQ2rT7ScOVZCLSHZD2gaaqW",
  "BXOyTCZVnwt7K/gyDuE3qzDJnuahl+SSkPn5TtnZdW6sLORJJ+DjNvaUxEsmizZ4",
  "IBzvj0QKxfS3s4F+0X5iqCMheLFeybZGtSq9Tjs6Q61l4CG8Bh6dsLemv0WFrk3G",
  "gFQRr7XUwr1bo5xGHC/FUJSsxRHoVNJnIL/9WldNO2tGU6qlTnAYxs/fOmf2B6o5",
  "cKXysXv7WAA8b+j5AVBMGxUSu7CLglaiCJC5DI7AAiUV7/t29rFZkam//Jbb4veC",
  "4vvFocoVUaxrKGWK1BDldr4/WJKApJcPJF4Jtai1+oB6ak/JIjbkseHdJxcjo2B0",
  "dKtIFoWiPAB+DFs9MRDpp0iwocJCh+ucus1rdQ54YMaI44rRphXeOIQMYCi5q2Q1",
  "/arzkSiyPV/2VoKoAfdgskPt1xKd7WIKErmpFMHIy8jJ5IPQ1s2dUwU4alfJLJa0",
  "pvaV2m7wBYFAmwmz0WZgFxYAYEDamn4jFoKfqsEgcixRUVE3w5VkqwSwGRbLABEB",
  "AAG0G0dpdEh1YiA8bm9yZXBseUBnaXRodWIuY29tPokCTgQTAQoAOBYhBJaEeaGv",
  "+SfjfRpWa7VpDu67lSGUBQJlpsV2AhsDBQsJCAcCBhUKCQgLAgQWAgMBAh4BAheA",
  "AAoJELVpDu67lSGUgy4QAKW9XAL416iKrQB2LElmxqAoenHVCswlau0xGLh5dVNN",
  "p5f4/W6eEL8CZI7hfF3e5Gh6Me99aHgXSCK1QnxcqCJ6Oea4ZyrsNu3k6g7Um5ca",
  "VbYFD4yIahhXDYHSw6FYM2sgFY479YvgvKRwacC2tFfChLRbHgwLJ3O1dBjmVycJ",
  "Zpbyu+7taZ26g6KQfgcj3uuo3nz3p1ziIEpLHwtl/7joNEIIP/lJ8AKmUHPiGznN",
  "6fxMvzN37PGMWtdvOi1rSNIMQYr1YY7jPnlLbFJwLrO/q/cGPU5HwGzlqh0a2ZqY",
  "dnuwT3DREmgJ83H71xH+sTzZKs5oGlVTu6st7iWDvNpo2GoN01XzKa5caYglqsOC",
  "uZ6IHlsdL50sXMtSROCi3hEWU9r1sWIm4k3pNz20y7lElD2X/MqbEMcgpawCV7lH",
  "rm7MSrTgu6BNAF0SisbF9AKwXaBr2dwpMMyIBOFZO9mk4/c0n9q2FlGY4GkbgH2J",
  "HqulFTwX/4yiQbh8gzCe+06FZAWITN1OQntTkkCQ+1MCZPf+bOfC08RTsOsVZIYB",
  "2qAgw6XE0IF4a+PAtHSoYftwH2ocMY2gMuSNpQWm7m0+/j+K+RBoeUcnGNPQgszq",
  "N60IDMqkqHjyubrm2aslfopWmPSvaQoyxwV/uztdo+UI0IV2z9gD7Sm49vMkpYp8",
  "=uMz0",
  "-----END PGP PUBLIC KEY BLOCK-----",
  "",
].join("\n");

/**
 * Strict catalog of GitHub automation bots that a caller repo may explicitly opt
 * into via `allowed-bot-identities` / `--allowed-bots`. Empty by default (owner
 * policy refuses all bots unless opted in per repo). AI bots are NEVER allowlistable.
 */
export const KNOWN_ALLOWED_BOTS = Object.freeze({
  "dependabot[bot]": Object.freeze({
    login: "dependabot[bot]",
    authorNames: Object.freeze(["dependabot[bot]"]),
    authorEmails: Object.freeze(["49699333+dependabot[bot]@users.noreply.github.com"]),
    allowSelfCommitter: false,
    allowGithubWebFlowCommitter: true,
  }),
  "github-actions[bot]": Object.freeze({
    login: "github-actions[bot]",
    authorNames: Object.freeze(["github-actions[bot]", "github-actions"]),
    authorEmails: Object.freeze(["41898282+github-actions[bot]@users.noreply.github.com"]),
    allowSelfCommitter: true,
    allowGithubWebFlowCommitter: true,
  }),
});

export function parseAllowedBots(raw) {
  const items = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(",")
        .map((s) => s.trim());
  const out = [];
  for (const item of items) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (!Object.prototype.hasOwnProperty.call(KNOWN_ALLOWED_BOTS, normalized)) {
      throw new Error(
        `Unsupported entry "${item}" in allowed-bot-identities (only known GitHub automation bots are supported: ${Object.keys(KNOWN_ALLOWED_BOTS).join(", ")})`,
      );
    }
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function escapeGithubCommand(value) {
  return String(value ?? "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

export function isVerifiedGithubWebFlowSignature(sigStatus = "", sigKey = "") {
  const status = String(sigStatus ?? "").trim();
  const key = String(sigKey ?? "").trim().toUpperCase();
  if (!key) return false;
  if (status === "G" && GITHUB_WEBFLOW_KEY_IDS.includes(key)) return true;
  if (status === "Y" && GITHUB_WEBFLOW_LEGACY_EXPIRED_KEY_IDS.includes(key)) return true;
  return false;
}

export function withGithubWebFlowKeyring(fn) {
  const gnupgHome = mkdtempSync(join(tmpdir(), "gpg-"));
  try {
    chmodSync(gnupgHome, 0o700);
    const gpgEnv = { ...process.env, GNUPGHOME: gnupgHome };
    execFileSync("gpg", ["--homedir", gnupgHome, "--batch", "--quiet", "--import"], {
      input: GITHUB_WEBFLOW_GPG_PUBLIC_KEY,
      env: gpgEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const ownertrust = GITHUB_WEBFLOW_KEY_FINGERPRINTS.map((fp) => `${fp}:6:`).join("\n") + "\n";
    execFileSync("gpg", ["--homedir", gnupgHome, "--batch", "--quiet", "--import-ownertrust"], {
      input: ownertrust,
      env: gpgEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return fn(gnupgHome);
  } finally {
    rmSync(gnupgHome, { recursive: true, force: true });
  }
}

export function buildPrRevArgs(repo, baseSha, headSha, { excludeRefs = [] } = {}) {
  const excludes = [];
  for (const ref of excludeRefs) {
    const cleanRef = String(ref ?? "").trim();
    if (!cleanRef) continue;
    try {
      const sha = execFileSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", cleanRef], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (sha && sha !== baseSha && !excludes.includes(sha)) {
        excludes.push(sha);
      }
    } catch {
      // ref does not exist in this repository; ignore safely
    }
  }
  if (excludes.length > 0) {
    return [headSha, "--not", baseSha, ...excludes];
  }
  return [`${baseSha}..${headSha}`];
}

const SCISSORS_RE = /^# -{3,} >8 -{3,}$/;

const AI_TOKENS =
  "(?:claude|anthropic|codex|openai|gpt\\d*|chatgpt|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor|windsurf|codeium|aider|cline|devin|deepseek|qwen|grok|llm|ai)";

/**
 * Forbidden attribution trailer / AI-generation patterns (all case-insensitive).
 *
 * - `co-authored-by`, `claude-session`, `assisted-by`, and `generated-by-ai` are
 *   line-anchored so prose mentioning them mid-sentence is allowed.
 * - `generated-with-ai`, `robot-generated`, Claude URLs, and AI vendor emails
 *   match anywhere on a non-comment line.
 * - Bare `🤖` is intentionally NOT matched: an emoji alone is not attribution.
 */
export const TRAILER_RULES = Object.freeze([
  {
    id: "co-authored-by",
    label: "Co-Authored-By: … (all co-author trailers forbidden)",
    pattern: /^\s*co-authored-by\s*:/i,
  },
  {
    id: "claude-session",
    label: "Claude-Session: …",
    pattern: /^\s*claude-session\s*:/i,
  },
  {
    id: "assisted-by",
    label: "(AI-)Assisted-By: …",
    pattern: /^\s*(?:ai-)?assisted-by\s*:/i,
  },
  {
    id: "generated-by-ai",
    label: "Generated-By/With: <AI>",
    pattern: new RegExp(
      `^\\s*generated-(?:by|with)\\s*:.*(?:^|[^a-z0-9])${AI_TOKENS}(?:[^a-z0-9]|$)`,
      "i",
    ),
  },
  {
    id: "generated-with-ai",
    label: "Generated with/by <AI>",
    pattern: new RegExp(
      `\\bgenerated\\s+(?:with|by)\\s+(?:(?:the|an?)\\s+)?[\\[*_\`~]*(?:(?:github|google|meta|openai|anthropic|mistral)\\s+)?${AI_TOKENS}(?:[^a-z0-9]|$)`,
      "i",
    ),
  },
  {
    id: "robot-generated",
    label: "🤖 Generated with/by …",
    pattern: /🤖\uFE0F?\s*generated\s+(?:with|by)\b/i,
  },
  {
    id: "claude-code-url",
    label: "claude.com/claude-code",
    pattern: /claude\.com\/claude-code/i,
  },
  {
    id: "claude-session-url",
    label: "claude.ai/code/session_…",
    pattern: /claude\.ai\/code\/session_[a-z0-9_-]+/i,
  },
  {
    id: "ai-email",
    label: "AI attribution email (<…@anthropic.com|openai.com|mistral.ai|cursor.sh|cursor.com|copilot@github.com>)",
    pattern:
      /(?:<[^@\s>]+@(?:anthropic\.com|openai\.com|mistral\.ai|cursor\.com|cursor\.sh)>|(?:^|[\s<("'`])(?:(?:noreply|claude|codex|vibe|mistral|cursor|assist|assistant|agent|ai|bot)[^@\s>)"'`]*@(?:anthropic\.com|openai\.com|mistral\.ai|cursor\.com|cursor\.sh)|(?:claude|codex|copilot|github-copilot|cursor|gemini-code-assist|antigravity|mistral-vibe)(?:\[bot\])?@(?:users\.noreply\.github\.com|github\.com))(?=$|[\s>)"'`,.;]))/i,
  },
]);

export function isBotIdentity(name = "", email = "") {
  const combined = `${name} <${email}>`;
  return (
    /\[bot\]/i.test(combined) ||
    /\b(?:dependabot|renovate|github-actions|greenkeeper|snyk-bot|codecov|mergify)\b/i.test(
      combined,
    ) ||
    /@(?:anthropic\.com|openai\.com|mistral\.ai|cursor\.com|cursor\.sh)$/i.test(
      String(email).trim(),
    ) ||
    /\b(?:claude|codex|copilot|cursor|mistral\s+vibe|muse-spark|h2a-agent|h-cond)\b/i.test(
      combined,
    )
  );
}

export function isBotLogin(login = "") {
  return (
    /\[bot\]$/i.test(login) ||
    /^(?:dependabot|renovate|github-actions|greenkeeper|snyk-bot|codecov|mergify)(?:\[bot\])?$/i.test(
      login,
    )
  );
}

/**
 * Classify a non-owner commit email for audit reporting:
 *  - `BOT`: automated/bot or AI vendor identity
 *  - `LOCAL_AGENT`: local placeholder email (`@localhost`, `@local`, `.local`)
 *  - `GITHUB_NON_MERGE`: `GitHub <noreply@github.com>` used outside an allowed merge
 *  - `OWNER_ALT`: known owner alternate emails (`antoinefa@users.noreply.github.com`,
 *    `fabien.antoine.*`, `rhanka*`, `@sent-tech.ca`, `@m4x.org`)
 *  - `UPSTREAM`: external / upstream fork author email (owner to decide)
 */
export function classifyNonOwnerEmail(name = "", email = "") {
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  if (isBotIdentity(cleanName, cleanEmail)) return "BOT";
  if (cleanName === GITHUB_WEBFLOW_NAME && cleanEmail === GITHUB_WEBFLOW_EMAIL) {
    return "GITHUB_NON_MERGE";
  }
  if (/@(?:localhost|local|[^@]+\.local)$/i.test(cleanEmail)) return "LOCAL_AGENT";
  if (
    cleanEmail === "antoinefa@users.noreply.github.com" ||
    /^\d+\+(?:antoinefa|rhanka)@users\.noreply\.github\.com$/i.test(cleanEmail) ||
    /^(?:fabien\.antoine|antoinefa|rhanka)(?:[._+-]|@)/i.test(cleanEmail) ||
    /@(?:sent-tech\.ca|m4x\.org)$/i.test(cleanEmail)
  ) {
    return "OWNER_ALT";
  }
  return "UPSTREAM";
}

export function isGithubSquashCoAuthorLine(line = "") {
  return /^\s*co-authored-by\s*:.*@users\.noreply\.github\.com\b/i.test(String(line));
}

/**
 * Verify that a commit's author and committer comply with the owner-only
 * identity policy.
 *
 * Allowed:
 *  - Author: email matches `<ownerEmail>` (case-insensitive). Display name is free
 *    by default; when `requireName` is non-empty, `authorName === requireName` is
 *    also enforced.
 *  - Committer: email matches `<ownerEmail>` (plus `requireName` if set), OR
 *    `GitHub <noreply@github.com>` ONLY for merges made by `<ownerLogin>`:
 *      1. Merge commit (`parents.length >= 2`).
 *      2. Author is the owner (GitHub sets merge commit author to the user who merged).
 *      3. Signature status is not bad (`sigStatus !== "B"`).
 *      4. When `requireWebFlowSignature` is true (live CI / push / PR), commit carries
 *         a PGP signature (`sigStatus` in G/U/E/X/Y, never N) with a known GitHub
 *         web-flow key ID (unless cryptographically verified `G`).
 *      5. When `githubActor` is provided (GitHub Actions push), `githubActor` matches `ownerLogin`.
 *
 * Informational name mismatch tracking (`nameMismatch`, `authorNameMismatch`,
 * `committerNameMismatch`, `nonCanonicalNames`) is always computed against
 * `requireName || canonicalName` (default `"Fabien Antoine"`) when the email is valid.
 */
function findMatchingAllowedBot(name, email, allowedBots) {
  const lowerEmail = String(email ?? "").trim().toLowerCase();
  const cleanName = String(name ?? "").trim();
  for (const botId of allowedBots) {
    const spec = KNOWN_ALLOWED_BOTS[botId];
    if (
      spec &&
      spec.authorEmails.includes(lowerEmail) &&
      spec.authorNames.includes(cleanName)
    ) {
      return spec;
    }
  }
  return null;
}

function checkWebFlowCommitterSignature(
  sigStatus,
  sigKey,
  { requireWebFlowSignature, contextLabel, violations },
) {
  let isUnsignedGithubMerge = false;
  if (sigStatus === "B") {
    violations.push({
      rule: "bad-github-merge-signature",
      message: `committer "GitHub <noreply@github.com>" ${contextLabel} carries an invalid PGP signature`,
    });
  } else if (!sigStatus || sigStatus === "N") {
    isUnsignedGithubMerge = true;
    if (requireWebFlowSignature) {
      violations.push({
        rule: "unsigned-github-merge-committer",
        message: `committer "GitHub <noreply@github.com>" ${contextLabel} lacks a GitHub web-flow PGP signature (locally forged or unsigned commit)`,
      });
    }
  } else if (
    requireWebFlowSignature &&
    !isVerifiedGithubWebFlowSignature(sigStatus, sigKey)
  ) {
    if (sigKey && !GITHUB_WEBFLOW_KEY_IDS.includes(sigKey)) {
      violations.push({
        rule: "unknown-github-merge-key",
        message: `committer "GitHub <noreply@github.com>" ${contextLabel} was signed by unrecognized key ${sigKey} (expected GitHub web-flow key)`,
      });
    } else {
      violations.push({
        rule: "unverified-github-merge-signature",
        message: `committer "GitHub <noreply@github.com>" ${contextLabel} PGP signature could not be cryptographically verified against GitHub web-flow keys (status=${sigStatus})`,
      });
    }
  }
  return { isUnsignedGithubMerge };
}

export function checkCommitIdentity(
  commit,
  {
    ownerEmail = OWNER_EMAIL,
    requireName = "",
    canonicalName = OWNER_NAME,
    ownerLogin = OWNER_GITHUB_LOGIN,
    requireWebFlowSignature = false,
    githubActor = "",
    allowedBots = [],
  } = {},
) {
  const normalizedAllowedBots = parseAllowedBots(allowedBots);
  const authorName = String(commit?.authorName ?? "").trim();
  const authorEmail = String(commit?.authorEmail ?? "").trim();
  const committerName = String(commit?.committerName ?? "").trim();
  const committerEmail = String(commit?.committerEmail ?? "").trim();
  const parents = Array.isArray(commit?.parents) ? commit.parents.filter(Boolean) : [];
  const sigStatus = String(commit?.sigStatus ?? "").trim();
  const sigKey = String(commit?.sigKey ?? "").trim().toUpperCase();

  const expectedEmail = ownerEmail.toLowerCase();
  const requiredName = String(requireName ?? "").trim();
  const refCanonicalName = requiredName || String(canonicalName ?? OWNER_NAME).trim();

  const authorEmailOk = authorEmail.toLowerCase() === expectedEmail;
  const authorNameOk = !requiredName || authorName === requiredName;
  const authorIsOwner = authorEmailOk && authorNameOk;
  const allowedBotAuthor = !authorEmailOk
    ? findMatchingAllowedBot(authorName, authorEmail, normalizedAllowedBots)
    : null;

  const committerEmailOk = committerEmail.toLowerCase() === expectedEmail;
  const committerNameOk = !requiredName || committerName === requiredName;
  const committerIsOwner = committerEmailOk && committerNameOk;

  const committerIsGithub =
    committerName === GITHUB_WEBFLOW_NAME &&
    committerEmail.toLowerCase() === GITHUB_WEBFLOW_EMAIL;

  const authorNameMismatch = Boolean(refCanonicalName) && authorEmailOk && authorName !== refCanonicalName;
  const committerNameMismatch =
    Boolean(refCanonicalName) && committerEmailOk && committerName !== refCanonicalName;
  const nameMismatch = authorNameMismatch || committerNameMismatch;
  const nonCanonicalNames = [];
  if (authorNameMismatch && authorName) nonCanonicalNames.push(authorName);
  if (committerNameMismatch && committerName && !nonCanonicalNames.includes(committerName)) {
    nonCanonicalNames.push(committerName);
  }

  const expectedLabel = requiredName ? `"${requiredName} <${ownerEmail}>"` : `email "${ownerEmail}"`;
  const violations = [];
  let isGithubWebFlowMerge = false;
  let isUnsignedGithubMerge = false;
  const isAllowedBotCommit = Boolean(allowedBotAuthor);

  if (!authorEmailOk && !allowedBotAuthor) {
    const bot = isBotIdentity(authorName, authorEmail);
    violations.push({
      rule: bot ? "bot-author" : "invalid-author",
      message: bot
        ? `author "${authorName} <${authorEmail}>" is a bot/automated account and violates the owner-only identity policy (expected ${expectedLabel})`
        : `author "${authorName} <${authorEmail}>" does not use the owner email (expected ${expectedLabel})`,
    });
  } else if (authorEmailOk && !authorNameOk) {
    violations.push({
      rule: "invalid-author-name",
      message: `author name "${authorName}" does not match required per-repo name "${requiredName}" (email "${authorEmail}" is valid)`,
    });
  }

  if (allowedBotAuthor) {
    if (!committerIsOwner) {
      const committerIsSameBot =
        allowedBotAuthor.allowSelfCommitter &&
        allowedBotAuthor.authorEmails.includes(committerEmail.toLowerCase()) &&
        allowedBotAuthor.authorNames.includes(committerName);
      if (committerIsGithub && allowedBotAuthor.allowGithubWebFlowCommitter) {
        const sigCheck = checkWebFlowCommitterSignature(sigStatus, sigKey, {
          requireWebFlowSignature,
          contextLabel: `bot commit (${allowedBotAuthor.login})`,
          violations,
        });
        isUnsignedGithubMerge = sigCheck.isUnsignedGithubMerge;
      } else if (!committerIsSameBot) {
        const bot = isBotIdentity(committerName, committerEmail);
        violations.push({
          rule: bot ? "bot-committer" : "invalid-committer",
          message: `committer "${committerName} <${committerEmail}>" is not allowed for allowlisted bot commit "${allowedBotAuthor.login}" (expected ${expectedLabel} or cryptographically verified GitHub web-flow committer)`,
        });
      }
    }

    return {
      ok: violations.length === 0,
      violations,
      isGithubWebFlowMerge,
      isUnsignedGithubMerge,
      isAllowedBotCommit,
      nameMismatch,
      authorNameMismatch,
      committerNameMismatch,
      nonCanonicalNames,
    };
  }

  if (!committerIsOwner) {
    if (committerIsGithub) {
      if (parents.length < 2) {
        violations.push({
          rule: "non-merge-github-committer",
          message: `committer "GitHub <noreply@github.com>" is only allowed for GitHub web-flow merge commits (>= 2 parents), got ${parents.length} parent(s)`,
        });
      } else if (!authorIsOwner) {
        violations.push({
          rule: "unverified-github-merge-committer",
          message: `committer "GitHub <noreply@github.com>" merge is not authored by owner (${expectedLabel})`,
        });
      } else {
        isGithubWebFlowMerge = true;
        const sigCheck = checkWebFlowCommitterSignature(sigStatus, sigKey, {
          requireWebFlowSignature,
          contextLabel: "merge",
          violations,
        });
        isUnsignedGithubMerge = sigCheck.isUnsignedGithubMerge;

        if (
          githubActor &&
          githubActor.toLowerCase() !== ownerLogin.toLowerCase()
        ) {
          violations.push({
            rule: "non-owner-github-actor",
            message: `GitHub web-flow merge triggered by actor "${githubActor}" violates owner-only identity policy (expected "${ownerLogin}")`,
          });
        }
      }
    } else if (committerEmailOk && !committerNameOk) {
      violations.push({
        rule: "invalid-committer-name",
        message: `committer name "${committerName}" does not match required per-repo name "${requiredName}" (email "${committerEmail}" is valid)`,
      });
    } else {
      const bot = isBotIdentity(committerName, committerEmail);
      violations.push({
        rule: bot ? "bot-committer" : "invalid-committer",
        message: bot
          ? `committer "${committerName} <${committerEmail}>" is a bot/automated account and violates the owner-only identity policy (expected ${expectedLabel})`
          : `committer "${committerName} <${committerEmail}>" does not use the owner email (expected ${expectedLabel} or verified GitHub web-flow merge)`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    isGithubWebFlowMerge,
    isUnsignedGithubMerge,
    isAllowedBotCommit,
    nameMismatch,
    authorNameMismatch,
    committerNameMismatch,
    nonCanonicalNames,
  };
}

/**
 * Split text into authored lines and optional git scissors suffix.
 */
function splitScissors(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((line) => SCISSORS_RE.test(line));
  if (idx === -1) return { bodyLines: lines, suffixLines: [] };
  return { bodyLines: lines.slice(0, idx), suffixLines: lines.slice(idx) };
}

/**
 * Find the first matching trailer rule for a single line, or null.
 */
export function matchTrailerLine(line) {
  for (const rule of TRAILER_RULES) {
    if (rule.pattern.test(line)) return rule;
  }
  return null;
}

/**
 * Scan arbitrary text for attribution trailers.
 * - For commit messages: ignoreComments=true, respectScissors=true.
 * - For PR titles/bodies: ignoreComments=false, respectScissors=false.
 */
export function scanText(
  text,
  { ignoreComments = true, respectScissors = true } = {},
) {
  const { bodyLines } = respectScissors
    ? splitScissors(text)
    : { bodyLines: String(text ?? "").replace(/\r\n/g, "\n").split("\n") };
  const matches = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (ignoreComments && line.startsWith("#")) continue;
    const rule = matchTrailerLine(line);
    if (rule) {
      matches.push({ line: i + 1, rule: rule.id, label: rule.label, text: line });
    }
  }
  return { ok: matches.length === 0, matches };
}

export function scanCommitMessage(text) {
  return scanText(text, { ignoreComments: true, respectScissors: true });
}

export function scanPrText(text) {
  return scanText(text, { ignoreComments: false, respectScissors: false });
}

/**
 * Strip matching attribution trailer lines from a commit message while
 * preserving comments and any git `commit -v` scissors diff suffix verbatim.
 */
export function stripCommitTrailers(text) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const hadTrailingNewline = raw.endsWith("\n");
  const { bodyLines, suffixLines } = splitScissors(raw);
  const kept = [];
  const removed = [];

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!line.startsWith("#")) {
      const rule = matchTrailerLine(line);
      if (rule) {
        removed.push({ line: i + 1, rule: rule.id, text: line });
        continue;
      }
    }
    kept.push(line);
  }

  // Trim blank lines left dangling at the end of the authored message after removal.
  if (removed.length > 0) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
      kept.pop();
    }
  }

  const remainingAuthored = kept
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();

  const outLines =
    suffixLines.length > 0 ? [...kept, "", ...suffixLines] : kept;
  let out = outLines.join("\n");
  if (hadTrailingNewline && out.length > 0 && !out.endsWith("\n")) {
    out += "\n";
  }

  return {
    text: out,
    removed,
    empty: remainingAuthored.length === 0,
  };
}

/**
 * Inspect a shell command string (PreToolUse / pre_tool hook) for `git commit`
 * or `gh pr create|edit|merge` invocations carrying forbidden trailers.
 *
 * Deliberately scoped to git commit / gh pr commands so unrelated commands
 * (e.g. `grep Co-Authored-By`, `git log --grep`, unit test fixtures) pass.
 */
export function scanBashCommand(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return { ok: true, matches: [] };
  }
  const targetsGitCommit =
    /(?:^|[;|&\n]\s*)(?:(?:env\s+(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*)|command\s+|sudo\s+(?:-\w+\s+)*)*(?:git\b[^\n;|&]*\bcommit\b|gh\s+pr\s+(?:create|edit|merge)\b)/m.test(
      command,
    );
  if (!targetsGitCommit) {
    return { ok: true, matches: [] };
  }

  // Check both line-by-line (heredocs, multiline quotes) and escaped \n sequences
  // passed inside `-m "..."` or `--body "..."`.
  const expanded = command.replace(/\\n/g, "\n");
  const direct = scanText(expanded, {
    ignoreComments: false,
    respectScissors: false,
  });
  if (!direct.ok) return direct;

  // Also catch inline `-m "feat: x; Co-Authored-By: Claude"` or single-line
  // quote payloads where `Co-Authored-By:` immediately follows a quote.
  const inlineTrailerRe =
    /(?:["'`]|^|\n)\s*(co-authored-by|claude-session|(?:ai-)?assisted-by)\s*:/im;
  const inlineMatch = expanded.match(inlineTrailerRe);
  if (inlineMatch) {
    return {
      ok: false,
      matches: [
        {
          line: 1,
          rule: inlineMatch[1].toLowerCase(),
          label: inlineMatch[1],
          text: inlineMatch[0].trim(),
        },
      ],
    };
  }
  return { ok: true, matches: [] };
}

export function formatRejection(matches, context = "commit message") {
  const lines = [
    `✗ blocked — AI attribution / co-authorship trailer detected in ${context}.`,
    "",
    "  Forbidden lines (case-insensitive):",
    "    • Co-Authored-By: … (all co-author lines, human or AI)",
    "    • Claude-Session: … / (AI-)Assisted-By: …",
    "    • Generated-By/With: <AI> / Generated with|by <AI> / 🤖 Generated with|by …",
    "    • claude.com/claude-code / claude.ai/code/session_…",
    "    • AI vendor emails (e.g. anthropic.com / openai.com / mistral.ai / cursor.sh)",
    "",
  ];
  if (matches?.length) {
    lines.push("  Matched:");
    for (const m of matches.slice(0, 5)) {
      lines.push(`    line ${m.line} [${m.rule}]: ${m.text.trim()}`);
    }
    lines.push("");
  }
  lines.push("  Remove the offending line(s) and try again.");
  return lines.join("\n") + "\n";
}

export function readGitCommits(repo, revArgs, { verifyWebFlowSignatures = false } = {}) {
  const REC = "\x1e";
  const FLD = "\x1f";
  const format = `${REC}%H${FLD}%an${FLD}%ae${FLD}%cn${FLD}%ce${FLD}%P${FLD}%G?${FLD}%GK${FLD}%s${FLD}%B`;
  const runGitLog = (extraEnv = {}) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "gpg.ssh.allowedSignersFile=/dev/null", "log", ...revArgs, `--format=${format}`],
      {
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...extraEnv },
      },
    );
  const raw = verifyWebFlowSignatures
    ? withGithubWebFlowKeyring((gnupgHome) => runGitLog({ GNUPGHOME: gnupgHome }))
    : runGitLog();
  return raw
    .split(REC)
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(FLD);
      const parentsRaw = (parts[5] ?? "").trim();
      return {
        sha: (parts[0] ?? "").trim(),
        authorName: parts[1] ?? "",
        authorEmail: parts[2] ?? "",
        committerName: parts[3] ?? "",
        committerEmail: parts[4] ?? "",
        parents: parentsRaw ? parentsRaw.split(/\s+/) : [],
        sigStatus: (parts[6] ?? "").trim(),
        sigKey: (parts[7] ?? "").trim(),
        subject: parts[8] ?? "",
        body: parts.slice(9).join(FLD),
      };
    });
}

function runCheckFile(filePath, mode) {
  const content = readFileSync(filePath, "utf8");
  if (mode === "strip") {
    const stripped = stripCommitTrailers(content);
    if (stripped.removed.length === 0) return 0;
    if (stripped.empty) {
      process.stderr.write(
        "✗ commit blocked — stripping AI attribution trailers left an empty commit message.\n",
      );
      return 1;
    }
    // Atomic same-directory rename (never touches /tmp).
    const tmp = join(
      dirname(resolve(filePath)),
      `.${basename(filePath)}.h2a-strip.${process.pid}`,
    );
    writeFileSync(tmp, stripped.text, "utf8");
    renameSync(tmp, filePath);
    process.stderr.write(
      `⚠ stripped ${stripped.removed.length} AI attribution line(s) from commit message.\n`,
    );
    return 0;
  }

  const result = scanCommitMessage(content);
  if (!result.ok) {
    process.stderr.write(formatRejection(result.matches, "commit message"));
    return 1;
  }
  return 0;
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

export function runCli(argv) {
  const { positionals, flags } = parseArgs(argv);
  const cmd = positionals[0];
  const repo = typeof flags.repo === "string" ? flags.repo : process.cwd();
  const requireWebFlowSignature = flags["allow-unsigned-webflow"] !== true;
  const githubActor = typeof flags["github-actor"] === "string" ? flags["github-actor"] : "";
  const requireName = typeof flags["require-name"] === "string" ? flags["require-name"] : "";
  const ownerEmail = typeof flags["owner-email"] === "string" ? flags["owner-email"] : OWNER_EMAIL;
  const allowedBotsRaw = typeof flags["allowed-bots"] === "string" ? flags["allowed-bots"] : "";
  const excludeRefsRaw = typeof flags["exclude-ref"] === "string" ? flags["exclude-ref"] : "";
  const excludeRefs = excludeRefsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let allowedBots = [];
  if (allowedBotsRaw) {
    try {
      allowedBots = parseAllowedBots(allowedBotsRaw);
    } catch (err) {
      process.stderr.write(`::error::${escapeGithubCommand(err.message)}\n`);
      return 2;
    }
  }

  if (cmd === "check-file") {
    const target = positionals[1];
    if (!target) {
      process.stderr.write("usage: attribution-trailer-guard.mjs check-file <msg-file> [--mode reject|strip]\n");
      return 2;
    }
    const envMode = process.env.H2A_TRAILER_GUARD_MODE;
    const mode =
      flags.strip === true
        ? "strip"
        : typeof flags.mode === "string"
          ? flags.mode
          : envMode === "strip"
            ? "strip"
            : "reject";
    if (mode !== "reject" && mode !== "strip") {
      process.stderr.write(`invalid mode: ${mode} (expected reject or strip)\n`);
      return 2;
    }
    return runCheckFile(target, mode);
  }

  if (cmd === "check-range") {
    const range = positionals[1];
    if (!range) {
      process.stderr.write(
        "usage: attribution-trailer-guard.mjs check-range <rev-range> [--repo <path>] [--require-name <name>] [--allowed-bots <list>]\n",
      );
      return 2;
    }
    const commits = readGitCommits(repo, [range], {
      verifyWebFlowSignatures: requireWebFlowSignature,
    });
    let failed = 0;
    for (const c of commits) {
      const idRes = checkCommitIdentity(c, {
        ownerEmail,
        requireName,
        requireWebFlowSignature,
        githubActor,
        allowedBots,
      });
      for (const v of idRes.violations) {
        failed++;
        process.stderr.write(
          `::error::${escapeGithubCommand(`commit ${c.sha.slice(0, 10)} (${c.subject}) identity violation [${v.rule}]: ${v.message}`)}\n`,
        );
      }
      const res = scanCommitMessage(c.body);
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::${escapeGithubCommand(`commit ${c.sha.slice(0, 10)} (${c.subject}) carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})`)}\n`,
        );
      }
    }
    if (failed > 0) {
      process.stderr.write(
        `FAIL — ${failed} identity / attribution violation(s) found across ${commits.length} commit(s).\n`,
      );
      return 1;
    }
    process.stdout.write(
      `OK — ${commits.length} commit(s) scanned, owner identity verified and no forbidden attribution trailers.\n`,
    );
    return 0;
  }

  if (cmd === "check-pr") {
    const base = typeof flags.base === "string" ? flags.base : "";
    const head = typeof flags.head === "string" ? flags.head : "";
    const prAuthorEnv = typeof flags["pr-author-env"] === "string" ? flags["pr-author-env"] : "";
    const prAuthor =
      typeof flags["pr-author"] === "string"
        ? flags["pr-author"]
        : prAuthorEnv
          ? process.env[prAuthorEnv] ?? ""
          : "";
    const prTitleEnv = typeof flags["pr-title-env"] === "string" ? flags["pr-title-env"] : "";
    const prBodyEnv = typeof flags["pr-body-env"] === "string" ? flags["pr-body-env"] : "";
    const prTitle =
      typeof flags["pr-title"] === "string"
        ? flags["pr-title"]
        : prTitleEnv
          ? process.env[prTitleEnv] ?? ""
          : "";
    const prBody =
      typeof flags["pr-body"] === "string"
        ? flags["pr-body"]
        : prBodyEnv
          ? process.env[prBodyEnv] ?? ""
          : "";

    let failed = 0;
    if (
      prAuthor &&
      prAuthor.toLowerCase() !== OWNER_GITHUB_LOGIN.toLowerCase() &&
      !allowedBots.includes(prAuthor.toLowerCase())
    ) {
      failed++;
      const botNote = isBotLogin(prAuthor) ? " is a bot account and" : "";
      process.stderr.write(
        `::error::${escapeGithubCommand(`PR author "${prAuthor}"${botNote} violates the owner-only identity policy (only ${OWNER_GITHUB_LOGIN} is allowed)`)}\n`,
      );
    }

    let scannedCommits = 0;
    if (base && head) {
      const revArgs = buildPrRevArgs(repo, base, head, { excludeRefs });
      const commits = readGitCommits(repo, revArgs, {
        verifyWebFlowSignatures: requireWebFlowSignature,
      });
      scannedCommits = commits.length;
      for (const c of commits) {
        const idRes = checkCommitIdentity(c, {
          ownerEmail,
          requireName,
          requireWebFlowSignature,
          githubActor,
          allowedBots,
        });
        for (const v of idRes.violations) {
          failed++;
          process.stderr.write(
            `::error::${escapeGithubCommand(`commit ${c.sha.slice(0, 10)} (${c.subject}) identity violation [${v.rule}]: ${v.message}`)}\n`,
          );
        }
        const res = scanCommitMessage(c.body);
        if (!res.ok) {
          failed++;
          process.stderr.write(
            `::error::${escapeGithubCommand(`commit ${c.sha.slice(0, 10)} (${c.subject}) carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})`)}\n`,
          );
        }
      }
    }
    if (prTitle) {
      const res = scanPrText(prTitle);
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::${escapeGithubCommand(`PR title carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})`)}\n`,
        );
      }
    }
    if (prBody) {
      const res = scanPrText(prBody);
      if (!res.ok) {
        failed++;
        process.stderr.write(
          `::error::${escapeGithubCommand(`PR body / squash message carries a forbidden attribution trailer (${res.matches.map((m) => m.rule).join(", ")})`)}\n`,
        );
      }
    }
    if (failed > 0) {
      process.stderr.write(
        `FAIL — ${failed} violation(s) found across ${scannedCommits} commit(s) and PR metadata.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `OK — ${scannedCommits} commit(s) and PR metadata clean.\n`,
    );
    return 0;
  }

  process.stderr.write(
    "usage: attribution-trailer-guard.mjs <check-file|check-range|check-pr> ...\n",
  );
  return 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}

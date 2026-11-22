#!/usr/bin/env node
/**
 * Strictly read-only commit identity & attribution audit tool.
 *
 * Scans one or more Git repositories across every local branch (`refs/heads/*`)
 * and `origin/*` remote tracking ref (`refs/remotes/origin/*`, excluding symbolic
 * `origin/HEAD`), reporting commits that violate the owner-only identity and
 * zero-attribution policy:
 *  - Identity criterion is EMAIL only by default: author email and committer email
 *    must be `fabien.antoine@m4x.org` (any display name is compliant; optional
 *    per-repo strict name enforcement via `--require-name "Fabien Antoine"`).
 *  - Name mismatches relative to canonical `"Fabien Antoine"` (when email is valid)
 *    are reported in a separate, informational column.
 *  - Committer exception: `GitHub <noreply@github.com>` ONLY for merges (>= 2 parents)
 *    authored by owner (add `--strict-webflow-sig` to also require a PGP signature).
 *  - Zero `Co-Authored-By:` lines of any kind (human or AI, with explicit reporting
 *    of GitHub squash `Co-authored-by: ... <...@users.noreply.github.com>` trailers).
 *  - Zero AI attribution trailers, footers, session URLs, or AI vendor emails.
 *  - Categorizes non-compliant emails (`OWNER_ALT`, `LOCAL_AGENT`, `BOT`, `UPSTREAM`,
 *    `GITHUB_NON_MERGE`) so upstream fork authors are clearly marked `UPSTREAM`.
 *
 * Zero dependencies, Node-only, never writes to /tmp, never mutates any repo.
 *
 * Usage:
 *   node scripts/audit-commit-identity.mjs [--scan-dir <dir>] [--require-name <name>]
 *                                          [--canonical-name <name>] [--strict-webflow-sig]
 *                                          [--max-examples <n>] [--json] [--markdown <path>]
 *                                          [<repo>...]
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  OWNER_EMAIL,
  OWNER_GITHUB_LOGIN,
  OWNER_NAME,
  checkCommitIdentity,
  classifyNonOwnerEmail,
  isGithubSquashCoAuthorLine,
  readGitCommits,
  scanCommitMessage,
} from "../packages/h2a/scripts/attribution-trailer-guard.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  "tmp",
  ".git",
  ".worktrees",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".cache-tmp",
]);

/**
 * Recursively discover primary Git repositories (where `.git` is a directory,
 * skipping linked worktrees where `.git` is a file, plus `node_modules` and `tmp/`).
 */
export function discoverRepos(rootDir, { maxDepth = 5 } = {}) {
  const base = resolve(rootDir);
  const repos = [];

  function walk(dir, depth) {
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }

    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const st = lstatSync(gitPath);
        if (st.isDirectory()) {
          repos.push(dir);
        }
        // Whether primary repo or linked worktree, do not descend into worktree internals.
        return;
      } catch {
        return;
      }
    }

    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
        walk(full, depth + 1);
      } catch {
        // ignore unreadable entries
      }
    }
  }

  walk(base, 0);
  return repos;
}

function listAuditedRefs(repo) {
  let out = "";
  try {
    out = execFileSync(
      "git",
      [
        "-C",
        repo,
        "for-each-ref",
        "--format=%(refname:short)\t%(refname)\t%(symref)",
        "refs/heads",
        "refs/remotes/origin",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [shortName, fullName, symref] = line.split("\t");
      return { shortName, fullName, symref: (symref ?? "").trim() };
    })
    .filter((r) => !r.symref);
}

function readRevList(repo, fullRefName) {
  try {
    const out = execFileSync(
      "git",
      ["-C", repo, "rev-list", fullRefName],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readOriginUrl(repo) {
  try {
    return execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function auditRepo(
  repoPath,
  {
    strictWebFlowSig = false,
    requireName = "",
    canonicalName = OWNER_NAME,
    ownerEmail = OWNER_EMAIL,
    maxExamples = 5,
    displayName = null,
  } = {},
) {
  const repo = resolve(repoPath);
  const name = displayName ?? basename(repo);
  const originUrl = readOriginUrl(repo);
  const refs = listAuditedRefs(repo);
  if (refs.length === 0) {
    return {
      repo,
      name,
      originUrl,
      refsScanned: 0,
      totalUniqueCommits: 0,
      uniqueViolatingCommits: 0,
      uniqueCounts: {
        badIdentity: 0,
        coAuthoredBy: 0,
        githubSquashCoAuthor: 0,
        aiAttribution: 0,
      },
      uniqueNameMismatches: 0,
      nonCanonicalNames: [],
      badEmailBreakdown: [],
      githubSquashCoAuthorLines: [],
      unsignedGithubMerges: 0,
      refs: [],
    };
  }

  // Scan every reachable commit across refs/heads + refs/remotes/origin ONCE.
  let commits = [];
  try {
    commits = readGitCommits(repo, ["--branches", "--remotes=origin"]);
  } catch (err) {
    return {
      repo,
      name,
      originUrl,
      error: err?.message ?? String(err),
      refsScanned: refs.length,
      totalUniqueCommits: 0,
      uniqueViolatingCommits: 0,
      uniqueCounts: {
        badIdentity: 0,
        coAuthoredBy: 0,
        githubSquashCoAuthor: 0,
        aiAttribution: 0,
      },
      uniqueNameMismatches: 0,
      nonCanonicalNames: [],
      badEmailBreakdown: [],
      githubSquashCoAuthorLines: [],
      unsignedGithubMerges: 0,
      refs: [],
    };
  }

  const expectedEmail = ownerEmail.toLowerCase();
  const commitEval = new Map();
  let uniqueViolatingCommits = 0;
  let uniqueBadIdentity = 0;
  let uniqueCoAuthoredBy = 0;
  let uniqueGithubSquashCoAuthor = 0;
  let uniqueAiAttribution = 0;
  let uniqueNameMismatches = 0;
  let uniqueUnsignedGithubMerges = 0;

  const badEmailCounts = new Map(); // email -> { email, count, category, sampleName }
  const nonCanonicalNameCounts = new Map(); // name -> count
  const ghSquashLineCounts = new Map(); // trimmed line -> count

  for (const c of commits) {
    const idRes = checkCommitIdentity(c, {
      ownerEmail,
      requireName,
      canonicalName,
      requireWebFlowSignature: strictWebFlowSig,
    });
    const msgRes = scanCommitMessage(c.body);

    const hasBadIdentity = !idRes.ok;
    const coAuthorMatches = msgRes.matches.filter((m) => m.rule === "co-authored-by");
    const hasCoAuthoredBy = coAuthorMatches.length > 0;
    const ghSquashMatches = coAuthorMatches.filter((m) => isGithubSquashCoAuthorLine(m.text));
    const hasGithubSquashCoAuthor = ghSquashMatches.length > 0;
    const hasAiAttribution = msgRes.matches.some((m) => m.rule !== "co-authored-by");
    const hasNameMismatch = idRes.nameMismatch;
    const violating = hasBadIdentity || hasCoAuthoredBy || hasAiAttribution;

    if (idRes.isUnsignedGithubMerge) uniqueUnsignedGithubMerges++;
    if (hasNameMismatch) {
      uniqueNameMismatches++;
      for (const nm of idRes.nonCanonicalNames) {
        nonCanonicalNameCounts.set(nm, (nonCanonicalNameCounts.get(nm) ?? 0) + 1);
      }
    }
    if (hasGithubSquashCoAuthor) {
      uniqueGithubSquashCoAuthor++;
      const seenLines = new Set();
      for (const m of ghSquashMatches) {
        const line = m.text.trim();
        if (seenLines.has(line)) continue;
        seenLines.add(line);
        ghSquashLineCounts.set(line, (ghSquashLineCounts.get(line) ?? 0) + 1);
      }
    }
    if (violating) {
      uniqueViolatingCommits++;
      if (hasBadIdentity) {
        uniqueBadIdentity++;
        // Record distinct non-owner emails observed on this commit.
        const seenEmails = new Set();
        const authorEmailLower = c.authorEmail.trim().toLowerCase();
        if (authorEmailLower !== expectedEmail) {
          seenEmails.add(authorEmailLower);
          const prev = badEmailCounts.get(authorEmailLower);
          if (prev) {
            prev.count++;
          } else {
            badEmailCounts.set(authorEmailLower, {
              email: authorEmailLower || "<empty>",
              count: 1,
              category: classifyNonOwnerEmail(c.authorName, authorEmailLower),
              sampleName: c.authorName.trim(),
            });
          }
        }
        const committerEmailLower = c.committerEmail.trim().toLowerCase();
        const isAllowedGithubMerge = idRes.isGithubWebFlowMerge && !idRes.violations.some((v) => v.rule.includes("committer"));
        if (
          committerEmailLower !== expectedEmail &&
          !isAllowedGithubMerge &&
          !seenEmails.has(committerEmailLower)
        ) {
          const prev = badEmailCounts.get(committerEmailLower);
          if (prev) {
            prev.count++;
          } else {
            badEmailCounts.set(committerEmailLower, {
              email: committerEmailLower || "<empty>",
              count: 1,
              category: classifyNonOwnerEmail(c.committerName, committerEmailLower),
              sampleName: c.committerName.trim(),
            });
          }
        }
      }
      if (hasCoAuthoredBy) uniqueCoAuthoredBy++;
      if (hasAiAttribution) uniqueAiAttribution++;
    }

    const rules = [
      ...idRes.violations.map((v) => v.rule),
      ...new Set(msgRes.matches.map((m) => m.rule)),
    ];

    commitEval.set(c.sha, {
      violating,
      hasBadIdentity,
      hasCoAuthoredBy,
      hasGithubSquashCoAuthor,
      hasAiAttribution,
      hasNameMismatch,
      isUnsignedGithubMerge: idRes.isUnsignedGithubMerge,
      rules,
    });
  }

  const refResults = [];
  for (const r of refs) {
    const shas = readRevList(repo, r.fullName);
    let violatingCommits = 0;
    let badIdentity = 0;
    let coAuthoredBy = 0;
    let githubSquashCoAuthor = 0;
    let aiAttribution = 0;
    let nameMismatches = 0;
    let unsignedGithubMerges = 0;
    const exampleShas = [];

    for (const sha of shas) {
      const ev = commitEval.get(sha);
      if (!ev) continue;
      if (ev.isUnsignedGithubMerge) unsignedGithubMerges++;
      if (ev.hasNameMismatch) nameMismatches++;
      if (!ev.violating) continue;
      violatingCommits++;
      if (ev.hasBadIdentity) badIdentity++;
      if (ev.hasCoAuthoredBy) coAuthoredBy++;
      if (ev.hasGithubSquashCoAuthor) githubSquashCoAuthor++;
      if (ev.hasAiAttribution) aiAttribution++;
      if (exampleShas.length < maxExamples) {
        exampleShas.push(sha.slice(0, 10));
      }
    }

    refResults.push({
      ref: r.shortName,
      fullRef: r.fullName,
      totalCommits: shas.length,
      violatingCommits,
      counts: { badIdentity, coAuthoredBy, githubSquashCoAuthor, aiAttribution },
      nameMismatches,
      unsignedGithubMerges,
      exampleShas,
    });
  }

  const badEmailBreakdown = [...badEmailCounts.values()].sort(
    (a, b) => b.count - a.count || a.email.localeCompare(b.email),
  );
  const nonCanonicalNames = [...nonCanonicalNameCounts.entries()]
    .map(([label, count]) => ({ name: label, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const githubSquashCoAuthorLines = [...ghSquashLineCounts.entries()]
    .map(([line, count]) => ({ line, count }))
    .sort((a, b) => b.count - a.count || a.line.localeCompare(b.line));

  return {
    repo,
    name,
    originUrl,
    refsScanned: refs.length,
    totalUniqueCommits: commits.length,
    uniqueViolatingCommits,
    uniqueCounts: {
      badIdentity: uniqueBadIdentity,
      coAuthoredBy: uniqueCoAuthoredBy,
      githubSquashCoAuthor: uniqueGithubSquashCoAuthor,
      aiAttribution: uniqueAiAttribution,
    },
    uniqueNameMismatches,
    nonCanonicalNames,
    badEmailBreakdown,
    githubSquashCoAuthorLines,
    unsignedGithubMerges: uniqueUnsignedGithubMerges,
    refs: refResults,
  };
}

function formatBadEmailsSummary(breakdown, maxItems = 4) {
  if (!breakdown || breakdown.length === 0) return "—";
  const shown = breakdown
    .slice(0, maxItems)
    .map((b) => `\`${b.email}\` [${b.category}] (${b.count})`);
  if (breakdown.length > maxItems) {
    shown.push(`+${breakdown.length - maxItems} autre(s)`);
  }
  return shown.join(", ");
}

function formatNameMismatchSummary(count, names) {
  if (!count) return "0";
  const top = (names ?? [])
    .slice(0, 3)
    .map((n) => `\`${n.name}\` (${n.count})`)
    .join(", ");
  return top ? `${count} (${top})` : String(count);
}

export function renderMarkdownReport(report) {
  const dirtyRepos = report.repos.filter((r) => r.uniqueViolatingCommits > 0);
  const cleanWithNameDiff = report.repos.filter(
    (r) => r.uniqueViolatingCommits === 0 && !r.error && r.uniqueNameMismatches > 0,
  );
  const fullyCleanRepos = report.repos.filter(
    (r) => r.uniqueViolatingCommits === 0 && !r.error && r.uniqueNameMismatches === 0,
  );
  const errorRepos = report.repos.filter((r) => Boolean(r.error));

  const nameRuleText = report.requireName
    ? `nom exigé \`${report.requireName}\` (\`--require-name\`)`
    : `nom libre (écarts vs \`${report.canonicalName || OWNER_NAME}\` indiqués à titre informatif)`;

  const lines = [
    "# Audit d'identité et d'attribution des commits",
    "",
    `- Date (UTC) : \`${report.generatedAt}\``,
    `- Politique : **email seul** \`${OWNER_EMAIL}\` (\`${OWNER_GITHUB_LOGIN}\`), ${nameRuleText}, committer identique ou merge GitHub web-flow \`GitHub <noreply@github.com>\` (>= 2 parents, auteur owner${report.strictWebFlowSig ? ", signature PGP requise" : ""}), zéro \`Co-Authored-By:\` (y compris squash GitHub), zéro attribution IA.`,
    `- Catégories d'emails non conformes : \`OWNER_ALT\` (autres emails de l'owner), \`LOCAL_AGENT\` (\`@localhost\`), \`BOT\` (bots / IA), \`UPSTREAM\` (auteurs tiers / forks amont — décision owner), \`GITHUB_NON_MERGE\` (committer GitHub hors merge).`,
    `- Périmètre : **${report.repos.length}** dépôts scannés (lecture seule, \`refs/heads/*\` + \`refs/remotes/origin/*\`).`,
    `- Résultat : **${dirtyRepos.length}** dépôt(s) avec violations, **${cleanWithNameDiff.length}** dépôt(s) conformes email avec écart de nom informatif, **${fullyCleanRepos.length}** dépôt(s) 100 % propres${errorRepos.length ? `, **${errorRepos.length}** erreur(s)` : ""}.`,
    "",
    "## Synthèse par dépôt avec violations",
    "",
  ];

  if (dirtyRepos.length === 0) {
    lines.push("Aucune violation détectée.");
  } else {
    lines.push(
      "| Dépôt | Refs violées / total | Violations (uniques) | Email invalide | Détail emails non conformes | Co-Authored-By (dont GH squash) | Attribution IA | Écart nom ≠ Fabien Antoine (info) | Exemples SHA (ref principale) |",
    );
    lines.push("|---|---:|---:|---:|---|---:|---:|---|---|");
    for (const r of dirtyRepos.sort(
      (a, b) => b.uniqueViolatingCommits - a.uniqueViolatingCommits || a.name.localeCompare(b.name),
    )) {
      const dirtyRefs = r.refs.filter((ref) => ref.violatingCommits > 0);
      const primaryRef =
        dirtyRefs.find((ref) => ref.ref === "origin/main") ??
        dirtyRefs.find((ref) => ref.ref === "main") ??
        dirtyRefs.find((ref) => ref.ref === "origin/master") ??
        dirtyRefs.find((ref) => ref.ref === "master") ??
        dirtyRefs[0];
      const examples = primaryRef
        ? primaryRef.exampleShas.map((s) => `\`${s}\``).join(", ")
        : "—";
      const coauthorCell =
        r.uniqueCounts.githubSquashCoAuthor > 0
          ? `${r.uniqueCounts.coAuthoredBy} (GH squash: ${r.uniqueCounts.githubSquashCoAuthor})`
          : String(r.uniqueCounts.coAuthoredBy);
      lines.push(
        `| \`${r.name}\` | ${dirtyRefs.length} / ${r.refsScanned} | ${r.uniqueViolatingCommits} | ${r.uniqueCounts.badIdentity} | ${formatBadEmailsSummary(r.badEmailBreakdown)} | ${coauthorCell} | ${r.uniqueCounts.aiAttribution} | ${formatNameMismatchSummary(r.uniqueNameMismatches, r.nonCanonicalNames)} | ${examples} |`,
      );
    }
  }

  if (cleanWithNameDiff.length > 0) {
    lines.push(
      "",
      "## Dépôts conformes (email OK, 0 violation) avec écart de nom informatif",
      "",
      "<details>",
      `<summary>${cleanWithNameDiff.length} dépôt(s) conformes email mais avec nom ≠ ${report.canonicalName || OWNER_NAME}</summary>`,
      "",
      "| Dépôt | Refs | Commits uniques | Écart nom ≠ Fabien Antoine (info) |",
      "|---|---:|---:|---|",
    );
    for (const r of cleanWithNameDiff.sort(
      (a, b) => b.uniqueNameMismatches - a.uniqueNameMismatches || a.name.localeCompare(b.name),
    )) {
      lines.push(
        `| \`${r.name}\` | ${r.refsScanned} | ${r.totalUniqueCommits} | ${formatNameMismatchSummary(r.uniqueNameMismatches, r.nonCanonicalNames)} |`,
      );
    }
    lines.push("", "</details>", "");
  }

  const totalDirtyRefs = dirtyRepos.reduce(
    (n, r) => n + r.refs.filter((x) => x.violatingCommits > 0).length,
    0,
  );
  lines.push(
    "",
    "## Détail par dépôt et par ref (violations uniquement)",
    "",
    "<details>",
    `<summary>Table complète par ref (${totalDirtyRefs} refs en violation)</summary>`,
    "",
    "| repo | ref | violations | bad-email | co-authored-by | gh-squash-coauthor | ai-attribution | name-mismatch (info) | examples SHA |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  );

  for (const r of dirtyRepos.sort((a, b) => a.name.localeCompare(b.name))) {
    for (const ref of r.refs) {
      if (ref.violatingCommits === 0) continue;
      const examples = ref.exampleShas.map((s) => `\`${s}\``).join(", ");
      lines.push(
        `| \`${r.name}\` | \`${ref.ref}\` | ${ref.violatingCommits} | ${ref.counts.badIdentity} | ${ref.counts.coAuthoredBy} | ${ref.counts.githubSquashCoAuthor} | ${ref.counts.aiAttribution} | ${ref.nameMismatches} | ${examples} |`,
      );
    }
  }

  lines.push("", "</details>", "");

  if (fullyCleanRepos.length > 0) {
    lines.push(
      "## Dépôts 100 % propres (0 violation, 0 écart de nom)",
      "",
      "<details>",
      `<summary>${fullyCleanRepos.length} dépôt(s) sans violation ni écart de nom</summary>`,
      "",
      "| repo | refs | commits uniques | merges GitHub non signés (historique) |",
      "|---|---:|---:|---:|",
    );
    for (const r of fullyCleanRepos.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `| \`${r.name}\` | ${r.refsScanned} | ${r.totalUniqueCommits} | ${r.unsignedGithubMerges} |`,
      );
    }
    lines.push("", "</details>", "");
  }

  if (errorRepos.length > 0) {
    lines.push("## Dépôts en erreur de lecture", "");
    for (const r of errorRepos) {
      lines.push(`- \`${r.name}\` (${r.repo}): ${r.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseArgs(argv) {
  const positionals = [];
  const flags = { "scan-dir": [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scan-dir" && argv[i + 1]) {
      flags["scan-dir"].push(argv[++i]);
    } else if (a.startsWith("--scan-dir=")) {
      flags["scan-dir"].push(a.slice("--scan-dir=".length));
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (
          next !== undefined &&
          !next.startsWith("--") &&
          ["markdown", "max-examples", "require-name", "canonical-name", "owner-email"].includes(key)
        ) {
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
  const strictWebFlowSig = flags["strict-webflow-sig"] === true;
  const requireName = typeof flags["require-name"] === "string" ? flags["require-name"] : "";
  const canonicalName =
    typeof flags["canonical-name"] === "string" ? flags["canonical-name"] : OWNER_NAME;
  const ownerEmail =
    typeof flags["owner-email"] === "string" ? flags["owner-email"] : OWNER_EMAIL;
  const maxExamples = Number.parseInt(flags["max-examples"] ?? "5", 10) || 5;
  const json = flags.json === true;
  const markdownPath = typeof flags.markdown === "string" ? flags.markdown : null;

  const repoEntries = [];
  const seen = new Set();
  for (const dir of flags["scan-dir"]) {
    const absRoot = resolve(dir);
    for (const r of discoverRepos(absRoot)) {
      if (seen.has(r)) continue;
      seen.add(r);
      repoEntries.push({ path: r, displayName: relative(absRoot, r) || basename(r) });
    }
  }
  for (const p of positionals) {
    const abs = resolve(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    repoEntries.push({ path: abs, displayName: basename(abs) });
  }

  if (repoEntries.length === 0) {
    process.stderr.write(
      "usage: audit-commit-identity.mjs [--scan-dir <dir>] [--require-name <name>] [--strict-webflow-sig] [--json] [--markdown <path>] <repo>...\n",
    );
    return 2;
  }

  const repos = repoEntries.map((entry) =>
    auditRepo(entry.path, {
      strictWebFlowSig,
      requireName,
      canonicalName,
      ownerEmail,
      maxExamples,
      displayName: entry.displayName,
    }),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    strictWebFlowSig,
    requireName: requireName || null,
    canonicalName,
    ownerEmail,
    repos,
  };

  if (markdownPath) {
    const outPath = resolve(markdownPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, renderMarkdownReport(report), "utf8");
  }

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const dirty = repos.filter((r) => r.uniqueViolatingCommits > 0);
    process.stdout.write(
      `Audited ${repos.length} repo(s): ${dirty.length} with violations, ${repos.length - dirty.length} clean.\n`,
    );
    for (const r of dirty) {
      process.stdout.write(
        `  ${r.name}: ${r.uniqueViolatingCommits} unique violating commit(s) (id:${r.uniqueCounts.badIdentity} coauthor:${r.uniqueCounts.coAuthoredBy} gh-squash:${r.uniqueCounts.githubSquashCoAuthor} ai:${r.uniqueCounts.aiAttribution} name-info:${r.uniqueNameMismatches})\n`,
      );
    }
  }

  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}

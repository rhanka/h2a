/**
 * Commander registration for `h2a archive` subcommands (Lot 1: keep-only Claude Code).
 */

import { Command } from "commander";
import {
  ARCHIVE_ALERT_EXIT_CODE,
  DEFAULT_GRACE_HOURS,
  DEFAULT_OLDER_THAN_DAYS,
  formatArchiveAlertLine,
  listSessionArchives,
  rebuildArchiveIndex,
  restoreSessionArchive,
  runArchivePassOnce,
  runSessionArchive,
  scanClaudeSessions,
  SessionArchiveError,
  verifySessionArchives,
} from "./session-archive.js";

function parseCliFlag(value: string | undefined): "claude" {
  const normalized = (value ?? "claude").trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code") {
    return "claude";
  }
  process.stderr.write(
    `h2a archive: unsupported --cli "${value}" (Lot 1 supports only "claude")\n`,
  );
  process.exit(1);
}

function parseOlderThanDays(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OLDER_THAN_DAYS;
  const match = /^(\d+(?:\.\d+)?)\s*d?$/i.exec(value.trim());
  if (!match) {
    process.stderr.write(
      `h2a archive: invalid --older-than "${value}" (expected integer days like 14 or 14d)\n`,
    );
    process.exit(1);
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    process.stderr.write(`h2a archive: --older-than must be >= 0\n`);
    process.exit(1);
  }
  return parsed;
}

function parseGraceHours(value: string | undefined, olderThanDays: number): number {
  if (value === undefined) {
    return olderThanDays < 1 ? 0 : DEFAULT_GRACE_HOURS;
  }
  const match = /^(\d+(?:\.\d+)?)\s*h?$/i.exec(value.trim());
  if (!match) {
    process.stderr.write(`h2a archive: invalid --grace-hours "${value}"\n`);
    process.exit(1);
  }
  return Number(match[1]);
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatGiB(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
}

function handleArchiveCliError(prefix: string, error: unknown, json?: boolean): void {
  const msg = error instanceof Error ? error.message : String(error);
  const errorCode = error instanceof SessionArchiveError ? error.code : undefined;
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, ...(errorCode ? { errorCode } : {}), error: msg })}\n`,
    );
  } else {
    process.stderr.write(`${prefix}: ${msg}\n`);
  }
  process.exitCode = error instanceof SessionArchiveError ? error.exitCode : 2;
}

export function registerArchiveCommand(program: Command): void {
  const archive = program
    .command("archive")
    .description("Manage verified local Claude session archives")
    .action(() => {
      archive.outputHelp();
    });

  archive
    .command("scan")
    .description("Inspect Claude sessions, purge deadlines, and archive readiness")
    .option("--cli <name>", "Target CLI (Lot 1: claude)", "claude")
    .option("--older-than <days>", "Inactivity threshold before archiving (e.g. 14d)", `${DEFAULT_OLDER_THAN_DAYS}d`)
    .option("--grace-hours <hours>", "Recent-activity grace window in hours")
    .option("--json", "Emit machine-readable JSON")
    .action((opts: { cli?: string; olderThan?: string; graceHours?: string; json?: boolean }) => {
      parseCliFlag(opts.cli);
      const olderThanDays = parseOlderThanDays(opts.olderThan);
      const graceHours = parseGraceHours(opts.graceHours, olderThanDays);
      try {
        const result = scanClaudeSessions({ olderThanDays, graceHours });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }

        process.stdout.write(
          `Claude archive scan (${result.scannedAt})\n` +
            `  Archive root : ${result.paths.root} (${formatMiB(result.archiveRepoBytes)} stored)\n` +
            `  Index status : ${result.indexStatus}${result.indexError ? ` (${result.indexError})` : ""}\n` +
            `  Disk guard   : ${result.disk.ok ? "OK" : "LOW"} (${formatGiB(result.disk.availBytes)} free, reserve ${formatGiB(result.disk.reserveBytes)})\n` +
            `  PID guard    : ${result.pidGuard.ok ? "host init OK" : `blocked (${result.pidGuard.reason})`}\n` +
            `  Sessions     : ${result.sessions.length} (${result.sessions.filter((s) => s.eligibleForArchive).length} eligible now)\n`,
        );

        if (result.orphanCompanionDirs.length > 0) {
          process.stdout.write(`  Orphan companion dirs (ignored): ${result.orphanCompanionDirs.length}\n`);
          for (const orphan of result.orphanCompanionDirs) {
            process.stdout.write(`    - ${orphan.sessionId} (${orphan.path})\n`);
          }
        }

        for (const s of result.sessions) {
          const blockerText = s.blockers.length > 0 ? ` blockers=[${s.blockers.join(", ")}]` : "";
          const notesText = s.copyNotes.length > 0 ? ` notes=[${s.copyNotes.join(", ")}]` : "";
          process.stdout.write(
            `  - ${s.sessionId}  ${s.archiveState}  purge=${s.purgeAt.slice(0, 10)} (${s.daysUntilPurge}d)  cwd=${s.originCwd}${blockerText}${notesText}\n`,
          );
        }

        if (result.alerts.length > 0) {
          process.stdout.write(`\nAlerts (${result.alerts.length}):\n`);
          for (const alert of result.alerts) {
            process.stdout.write(`  ${formatArchiveAlertLine(alert)}\n`);
          }
        }
      } catch (error) {
        handleArchiveCliError("h2a archive scan", error, opts.json);
      }
    });

  archive
    .command("run")
    .description("Archive inactive unarchived or updated Claude sessions cleanly")
    .option("--cli <name>", "Target CLI (Lot 1: claude)", "claude")
    .option("--older-than <days>", "Inactivity threshold (e.g. 14d)", `${DEFAULT_OLDER_THAN_DAYS}d`)
    .option("--grace-hours <hours>", "Recent-activity grace window in hours")
    .option("--session <id>", "Restrict to one session UUID")
    .option("--dry-run", "Show planned archives without writing tarballs")
    .option("--once", "Run via external-scheduler pass entrypoint (writes last-run.json, honors H2A_ARCHIVE_OFF=1)")
    .option("--scheduled", "Alias for --once (external scheduler entrypoint)")
    .option("--json", "Emit machine-readable JSON")
    .action(
      (opts: {
        cli?: string;
        olderThan?: string;
        graceHours?: string;
        session?: string;
        dryRun?: boolean;
        once?: boolean;
        scheduled?: boolean;
        json?: boolean;
      }) => {
        parseCliFlag(opts.cli);
        const olderThanDays = parseOlderThanDays(opts.olderThan);
        const graceHours = parseGraceHours(opts.graceHours, olderThanDays);

        if (opts.once || opts.scheduled) {
          try {
            const pass = runArchivePassOnce({
              olderThanDays,
              graceHours,
              dryRun: opts.dryRun === true,
              ...(opts.session ? { sessionId: opts.session } : {}),
            });
            if (opts.json) {
              process.stdout.write(`${JSON.stringify(pass, null, 2)}\n`);
            } else {
              process.stdout.write(
                `h2a archive pass: status=${pass.witness.status} archived=${pass.witness.archived} skippedIdempotent=${pass.witness.skippedIdempotent} blocked=${pass.witness.skippedBlocked}\n`,
              );
              if (pass.witness.reason) {
                process.stdout.write(`  reason: ${pass.witness.reason}\n`);
              }
              if (pass.witness.error) {
                process.stderr.write(`h2a archive run: ${pass.witness.error}\n`);
              }
              for (const alert of pass.alerts) {
                process.stderr.write(`h2a archive run: ${formatArchiveAlertLine(alert)}\n`);
              }
            }
            if (pass.exitCode !== 0) process.exitCode = pass.exitCode;
          } catch (error) {
            handleArchiveCliError("h2a archive run", error, opts.json);
          }
          return;
        }

        try {
          const result = runSessionArchive({
            olderThanDays,
            graceHours,
            dryRun: opts.dryRun === true,
            ...(opts.session ? { sessionId: opts.session } : {}),
          });
          if (opts.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else if (result.dryRun) {
            process.stdout.write(
              `Dry-run archive plan: wouldArchive=${result.wouldArchive.length} skippedIdempotent=${result.skippedIdempotent.length} blocked=${result.skippedBlocked.length}\n`,
            );
            for (const id of result.wouldArchive) {
              process.stdout.write(`  would archive: ${id}\n`);
            }
          } else {
            process.stdout.write(
              `Archive run: archived=${result.archived.length} skippedIdempotent=${result.skippedIdempotent.length} blocked=${result.skippedBlocked.length} failed=${result.failedSessions.length}\n`,
            );
            for (const item of result.archived) {
              process.stdout.write(
                `  + ${item.archiveId} (${formatMiB(item.archiveBytes)}) cwd=${item.originCwd} sha256=${item.archiveSha256.slice(0, 12)}...\n`,
              );
            }
            if (result.errorMessage) {
              process.stderr.write(`h2a archive run: ${result.errorMessage}\n`);
            }
            for (const alert of result.alerts) {
              process.stderr.write(`h2a archive run: ${formatArchiveAlertLine(alert)}\n`);
            }
          }
          if (!result.ok) {
            process.exitCode = 2;
          } else if (!result.dryRun && result.alerts.length > 0) {
            process.exitCode = ARCHIVE_ALERT_EXIT_CODE;
          }
        } catch (error) {
          handleArchiveCliError("h2a archive run", error, opts.json);
        }
      },
    );

  archive
    .command("pass")
    .description("Run one archive pass for an external scheduler (writes last-run.json)")
    .option("--cli <name>", "Target CLI (Lot 1: claude)", "claude")
    .option("--older-than <days>", "Inactivity threshold (e.g. 14d)", `${DEFAULT_OLDER_THAN_DAYS}d`)
    .option("--grace-hours <hours>", "Recent-activity grace window in hours")
    .option("--dry-run", "Evaluate pass without writing archives")
    .option("--json", "Emit machine-readable JSON")
    .action((opts: { cli?: string; olderThan?: string; graceHours?: string; dryRun?: boolean; json?: boolean }) => {
      parseCliFlag(opts.cli);
      const olderThanDays = parseOlderThanDays(opts.olderThan);
      const graceHours = parseGraceHours(opts.graceHours, olderThanDays);
      try {
        const pass = runArchivePassOnce({
          olderThanDays,
          graceHours,
          dryRun: opts.dryRun === true,
        });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(pass, null, 2)}\n`);
        } else {
          process.stdout.write(
            `h2a archive pass: status=${pass.witness.status} archived=${pass.witness.archived} skippedIdempotent=${pass.witness.skippedIdempotent} alerts=${pass.witness.alertsCount}\n`,
          );
          if (pass.witness.reason) {
            process.stdout.write(`  reason: ${pass.witness.reason}\n`);
          }
          if (pass.witness.error) {
            process.stderr.write(`h2a archive pass: ${pass.witness.error}\n`);
          }
          for (const alert of pass.alerts) {
            process.stderr.write(`h2a archive pass: ${formatArchiveAlertLine(alert)}\n`);
          }
        }
        if (pass.exitCode !== 0) process.exitCode = pass.exitCode;
      } catch (error) {
        handleArchiveCliError("h2a archive pass", error, opts.json);
      }
    });

  archive
    .command("verify")
    .description("Verify archive tarballs and SHA-256 digests")
    .argument("[id]", "Session UUID or archiveId (defaults to all archives)")
    .option("--json", "Emit machine-readable JSON")
    .action((id: string | undefined, opts: { json?: boolean }) => {
      try {
        const result = verifySessionArchives(id ? { id } : {});
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          process.stdout.write(
            `Archive verify: checked=${result.checkedCount} passed=${result.passedCount} failed=${result.failedCount}\n`,
          );
          for (const r of result.results) {
            const label = r.ok ? "OK" : `FAIL (${r.error})`;
            process.stdout.write(`  - ${r.archiveId}: ${label}\n`);
          }
        }
        if (!result.ok) process.exitCode = 2;
      } catch (error) {
        handleArchiveCliError("h2a archive verify", error, opts.json);
      }
    });

  archive
    .command("list")
    .description("List stored session archives and origin folders")
    .option("--cli <name>", "Target CLI (Lot 1: claude)", "claude")
    .option("--json", "Emit machine-readable JSON")
    .action((opts: { cli?: string; json?: boolean }) => {
      parseCliFlag(opts.cli);
      try {
        const rows = listSessionArchives();
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
          return;
        }
        if (rows.length === 0) {
          process.stdout.write("No Claude session archives stored yet.\n");
          return;
        }
        process.stdout.write(`Claude session archives (${rows.length}):\n`);
        for (const row of rows) {
          const missingTag = row.archiveExists ? "" : " [MISSING ON DISK]";
          const restoredTag = row.restoredAt ? ` restoredAt=${row.restoredAt}` : "";
          process.stdout.write(
            `  - ${row.sessionId}  id=${row.archiveId}  v${row.version}  ${formatMiB(row.archiveBytes)}  created=${row.createdAt.slice(0, 19)}Z  origin=${row.originCwd}${restoredTag}${missingTag}\n`,
          );
        }
      } catch (error) {
        handleArchiveCliError("h2a archive list", error, opts.json);
      }
    });

  archive
    .command("rebuild-index")
    .description("Verify stored tarballs and reconstruct claude/index.json from embedded manifests")
    .option("--cli <name>", "Target CLI (Lot 1: claude)", "claude")
    .option("--force", "Allow rebuilding over an unknown index schema version (backs up existing index)")
    .option("--json", "Emit machine-readable JSON")
    .action((opts: { cli?: string; force?: boolean; json?: boolean }) => {
      parseCliFlag(opts.cli);
      try {
        const result = rebuildArchiveIndex({ force: opts.force === true });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          process.stdout.write(
            `Rebuilt archive index (${result.indexPath}): sessions=${result.sessionsCount} versions=${result.versionsCount} skippedCorrupted=${result.skippedCorrupted.length}\n`,
          );
          if (result.backupPath) {
            process.stdout.write(`  previous index backup: ${result.backupPath}\n`);
          }
          for (const bad of result.skippedCorrupted) {
            process.stderr.write(`  skipped corrupted archive ${bad.archiveRelPath}: ${bad.error}\n`);
          }
        }
        if (!result.ok) process.exitCode = 2;
      } catch (error) {
        handleArchiveCliError("h2a archive rebuild-index", error, opts.json);
      }
    });

  archive
    .command("restore")
    .description("Verify and restore an archived Claude session to disk")
    .argument("<id>", "Session UUID or archiveId")
    .option("--version <archiveId>", "Specific archiveId version to restore")
    .option("--on-conflict <mode>", "Conflict behavior: refuse | backup", "refuse")
    .option("--json", "Emit machine-readable JSON")
    .action(
      (
        id: string,
        opts: { version?: string; onConflict?: string; json?: boolean },
      ) => {
        const onConflict =
          opts.onConflict === "backup"
            ? "backup"
            : opts.onConflict === "refuse" || opts.onConflict === undefined
              ? "refuse"
              : undefined;
        if (!onConflict) {
          process.stderr.write(
            `h2a archive restore: invalid --on-conflict "${opts.onConflict}" (expected refuse or backup)\n`,
          );
          process.exit(1);
        }

        try {
          const result = restoreSessionArchive({
            id,
            ...(opts.version ? { version: opts.version } : {}),
            onConflict,
          });
          if (opts.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            process.stdout.write(
              `Restored ${result.sessionId} from ${result.archiveId} into ${result.targetProjectDir} (${result.restoredFiles.length} file(s), mtime refreshed)\n` +
                `  Next: cd ${result.originCwd} && claude --resume ${result.sessionId}\n`,
            );
            for (const alert of result.alerts) {
              process.stderr.write(`h2a archive restore: ${formatArchiveAlertLine(alert)}\n`);
            }
          }
        } catch (error) {
          handleArchiveCliError("h2a archive restore", error, opts.json);
        }
      },
    );
}

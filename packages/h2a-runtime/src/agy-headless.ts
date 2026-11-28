import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agyClaudeQuotaError, detectAgyClaudeQuotaExhaustion, isAgyClaudeModel, readAgyClaudeQuotaStatus, writeAgyClaudeQuotaStatus } from "./agy-claude.js";
import { AGY_AUTH_DIAGNOSTIC, AGY_AUTH_REQUIRED } from "./agy-auth.js";
import {
  hasSandboxOrQualificationRuntime,
  resolveSessionRuntimeDir,
  SESSION_KEY_RE,
  SESSION_PROOF_PATH_ENV,
  SESSION_REF_ENV,
  waitForSessionFiche,
} from "./session-auth.js";

function waitForLauncherFicheBeforeExec(): { ok: true } | { ok: false; error: string } {
  const sessionKey = process.env[SESSION_REF_ENV]?.trim();
  if (!sessionKey) return { ok: true };
  if (!SESSION_KEY_RE.test(sessionKey)) {
    return { ok: false, error: `invalid ${SESSION_REF_ENV}` };
  }
  const proofPath = process.env[SESSION_PROOF_PATH_ENV]?.trim();
  let runtimeDir: string | undefined;
  if (proofPath) {
    runtimeDir = dirname(dirname(proofPath));
  } else {
    try {
      const allowD16 = hasSandboxOrQualificationRuntime();
      runtimeDir = resolveSessionRuntimeDir({ createIfMissing: allowD16 }).dir;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  const fiche = waitForSessionFiche(runtimeDir, sessionKey, { timeoutMs: 10_000 });
  if (!fiche) {
    if (proofPath) {
      try {
        rmSync(proofPath, { force: true });
      } catch {
        /* best-effort */
      }
    }
    return { ok: false, error: `session fiche missing after 10s for ${sessionKey}` };
  }
  return { ok: true };
}

/** Private run-once supervisor, shared by native and tmux launch paths. */
export async function runAgyHeadless(options: {
  command: string; args: string[]; model: string; resultPath: string; logPath: string;
  promptFile?: string | undefined; outputFile?: string | undefined;
}): Promise<Record<string, unknown>> {
  const priorOutput = options.outputFile && existsSync(options.outputFile) ? statSync(options.outputFile) : undefined;
  const input = options.promptFile ? readFileSync(options.promptFile) : undefined;
  if (options.promptFile) unlinkSync(options.promptFile);
  const log = createWriteStream(options.logPath, { mode: 0o600 });
  const diagnostic = { stdout: "", stderr: "" };
  const claude = isAgyClaudeModel(options.model);
  let authRequired = false;
  let observedModel: string | undefined;
  let modelMismatch = false;
  let pendingLine = "";
  let quotaError: ReturnType<typeof agyClaudeQuotaError> | undefined;
  const observeModel = (line: string) => {
    try {
      const event = JSON.parse(line);
      if (typeof event.model === "string") {
        observedModel = event.model;
        modelMismatch ||= observedModel !== options.model;
      }
    } catch { /* Provider text is retained in the log. */ }
  };
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    log.write(chunk);
    if (!claude && stream === "stdout") return;
    // Preserve a quota observation even if later output fills the bounded tail.
    // Keep the streams separate: stderr JSON can span chunks interleaved with stdout.
    const collected = diagnostic[stream] + chunk.toString("utf8");
    diagnostic[stream] = collected.slice(-65_536);
    if (!claude) return;
    const verdict = detectAgyClaudeQuotaExhaustion(collected);
    if (verdict.exhausted && (!quotaError || (!quotaError.resetsAt && verdict.resetsAt))) {
      quotaError = agyClaudeQuotaError(verdict.signature!, collected);
    }
    if (stream !== "stdout") return;
    const lines = (pendingLine + chunk.toString("utf8")).split("\n");
    // Consume complete events before bounding the unfinished line. A large
    // following event must not erase a preceding model declaration.
    pendingLine = lines.pop()!.slice(-65_536);
    for (const line of lines) observeModel(line);
  };
  const ficheCheck = waitForLauncherFicheBeforeExec();
  if (!ficheCheck.ok) {
    process.stderr.write(`[h2a] ${ficheCheck.error}\n`);
    writeFileSync(
      options.resultPath,
      `${JSON.stringify({
        kind: "h2a.run.failure",
        version: 1,
        state: "failed",
        exitCode: 2,
        code: "session-fiche-missing",
        error: ficheCheck.error,
        retrySafe: false,
        retryable: false,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    return { exitCode: 2, result: { state: "failed", exitCode: 2 } };
  }
  const completion = await new Promise<{ exitCode: number; spawnError?: string }>((done) => {
    const child = spawn(options.command, options.args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
    const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
    for (const signal of signals) process.on(signal, forward);
    let killTimer: NodeJS.Timeout | undefined;
    child.stdout.on("data", chunk => {
      if (!authRequired) collect("stdout", chunk);
    });
    child.stderr.on("data", chunk => {
      if (authRequired) return;
      if (AGY_AUTH_DIAGNOSTIC.test(diagnostic.stderr + chunk.toString("utf8"))) {
        // A run-once job cannot answer OAuth. Keep the challenge URL out of
        // the log and terminate only this supervisor's provider process.
        authRequired = true;
        log.write(`\n${AGY_AUTH_REQUIRED.reason}. ${AGY_AUTH_REQUIRED.hint}.\n`);
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
        return;
      }
      collect("stderr", chunk);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let spawnError: string | undefined;
    child.on("error", error => { spawnError = error.message; });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      for (const signal of signals) process.removeListener(signal, forward);
      done({ exitCode: code ?? 1,
        ...(spawnError || signal ? { spawnError: spawnError ?? `agy terminated by ${signal}` } : {}) });
    });
  });
  observeModel(pendingLine);
  await new Promise<void>(done => log.end(done));
  let quota = claude ? readAgyClaudeQuotaStatus() : undefined;
  if (quotaError) {
    quota = quotaError.quota;
    try { writeAgyClaudeQuotaStatus(quota); } catch { /* Final result still carries the observation. */ }
  }
  const output = options.outputFile ? (() => {
    if (!existsSync(options.outputFile!)) return { path: options.outputFile, state: "missing" };
    const current = statSync(options.outputFile!);
    return { path: options.outputFile, state: !priorOutput || current.mtimeMs !== priorOutput.mtimeMs || current.ctimeMs !== priorOutput.ctimeMs ? "written" : "unchanged" };
  })() : { state: "not-requested" };
  let failure: { code: string; error: string; resetsAt?: string } | undefined;
  if (authRequired) {
    failure = { code: AGY_AUTH_REQUIRED.code, error: `${AGY_AUTH_REQUIRED.reason}. ${AGY_AUTH_REQUIRED.hint}.` };
  } else if (quotaError) {
    failure = { code: quotaError.code, error: quotaError.message, ...(quotaError.resetsAt ? { resetsAt: quotaError.resetsAt } : {}) };
  } else if (modelMismatch) {
    failure = { code: "agy-model-mismatch", error: "AGY reported a different model; no fallback permitted" };
  } else if (output.state === "missing" || output.state === "unchanged") {
    failure = { code: "agy-output-missing", error: "AGY exited without writing the expected output file" };
  } else if (completion.exitCode !== 0) {
    failure = { code: "agy-process-failed", error: completion.spawnError ?? `AGY exited with code ${completion.exitCode}` };
  }
  const result = {
    kind: failure ? "h2a.run.failure" : "h2a.run.completion", version: 1,
    state: failure ? "failed" : "done",
    ...completion, ...(options.model ? { model: options.model, modelSource: "launch-argument" } : {}),
    effectiveModel: observedModel ?? "unknown", ...(claude ? { quota, output } : {}),
    ...(failure ? { ...failure, retrySafe: false, retryable: false } : {}),
  };
  const temporary = `${options.resultPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(result) + "\n", { mode: 0o600 });
  renameSync(temporary, options.resultPath);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resultPath, logPath, promptFile, model, outputFile, command, ...args] = process.argv.slice(2);
  if (!resultPath || !logPath || model === undefined || !command) throw new Error("invalid private AGY supervisor arguments");
  const result = await runAgyHeadless({ command, args, model, resultPath, logPath, promptFile: promptFile || undefined, outputFile: outputFile || undefined });
  process.exitCode = result.state === "done" ? 0 : 1;
}

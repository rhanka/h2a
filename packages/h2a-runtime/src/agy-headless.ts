import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agyClaudeQuotaError, detectAgyClaudeQuotaExhaustion, readAgyClaudeQuotaStatus, writeAgyClaudeQuotaStatus } from "./agy-claude.js";

/** Private run-once supervisor, shared by native and tmux launch paths. */
export async function runAgyClaudeHeadless(options: {
  command: string; args: string[]; model: string; resultPath: string; logPath: string;
  promptFile?: string | undefined; outputFile?: string | undefined;
}): Promise<Record<string, unknown>> {
  const priorOutput = options.outputFile && existsSync(options.outputFile) ? statSync(options.outputFile) : undefined;
  const input = options.promptFile ? readFileSync(options.promptFile) : undefined;
  if (options.promptFile) unlinkSync(options.promptFile);
  const log = createWriteStream(options.logPath, { mode: 0o600 });
  const diagnostic = { stdout: "", stderr: "" };
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
    // Preserve a quota observation even if later output fills the bounded tail.
    // Keep the streams separate: stderr JSON can span chunks interleaved with stdout.
    const collected = diagnostic[stream] + chunk.toString("utf8");
    const verdict = detectAgyClaudeQuotaExhaustion(collected);
    if (verdict.exhausted && (!quotaError || (!quotaError.resetsAt && verdict.resetsAt))) {
      quotaError = agyClaudeQuotaError(verdict.signature!, collected);
    }
    diagnostic[stream] = collected.slice(-65_536);
    if (stream !== "stdout") return;
    const lines = (pendingLine + chunk.toString("utf8")).split("\n");
    // Consume complete events before bounding the unfinished line. A large
    // following event must not erase a preceding model declaration.
    pendingLine = lines.pop()!.slice(-65_536);
    for (const line of lines) observeModel(line);
  };
  const completion = await new Promise<{ exitCode: number; spawnError?: string }>((done) => {
    const child = spawn(options.command, options.args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
    const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
    for (const signal of signals) process.on(signal, forward);
    child.stdout.on("data", chunk => collect("stdout", chunk));
    child.stderr.on("data", chunk => collect("stderr", chunk));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let spawnError: string | undefined;
    child.on("error", error => { spawnError = error.message; });
    child.on("close", (code, signal) => {
      for (const signal of signals) process.removeListener(signal, forward);
      done({ exitCode: code ?? 1,
        ...(spawnError || signal ? { spawnError: spawnError ?? `agy terminated by ${signal}` } : {}) });
    });
  });
  observeModel(pendingLine);
  await new Promise<void>(done => log.end(done));
  let quota = readAgyClaudeQuotaStatus();
  if (quotaError) {
    quota = quotaError.quota;
    try { writeAgyClaudeQuotaStatus(quota); } catch { /* Final result still carries the observation. */ }
  }
  const output = options.outputFile ? (() => {
    if (!existsSync(options.outputFile!)) return { path: options.outputFile, state: "missing" };
    const current = statSync(options.outputFile!);
    return { path: options.outputFile, state: !priorOutput || current.mtimeMs !== priorOutput.mtimeMs || current.ctimeMs !== priorOutput.ctimeMs ? "written" : "unchanged" };
  })() : { state: "not-requested" };
  const mismatch = modelMismatch;
  const code = quotaError?.code ?? (mismatch ? "agy-model-mismatch" : output.state === "missing" || output.state === "unchanged" ? "agy-output-missing" : completion.exitCode !== 0 ? "agy-process-failed" : undefined);
  const result = {
    kind: code ? "h2a.run.failure" : "h2a.run.completion", version: 1,
    state: code || completion.exitCode !== 0 ? "failed" : "done",
    ...completion, model: options.model, modelSource: "launch-argument",
    effectiveModel: observedModel ?? "unknown", quota, output,
    ...(code ? { code, error: quotaError?.message ?? (mismatch ? "AGY reported a different model; no fallback permitted" : code === "agy-process-failed" ? completion.spawnError ?? `AGY exited with code ${completion.exitCode}` : "AGY exited without writing the expected output file"), retrySafe: false, retryable: false,
      ...(quotaError?.resetsAt ? { resetsAt: quotaError.resetsAt } : {}) } : {}),
  };
  const temporary = `${options.resultPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(result) + "\n", { mode: 0o600 });
  renameSync(temporary, options.resultPath);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resultPath, logPath, promptFile, model, outputFile, command, ...args] = process.argv.slice(2);
  if (!resultPath || !logPath || !model || !command) throw new Error("invalid private AGY supervisor arguments");
  const result = await runAgyClaudeHeadless({ command, args, model, resultPath, logPath, promptFile: promptFile || undefined, outputFile: outputFile || undefined });
  process.exitCode = result.state === "done" ? 0 : 1;
}

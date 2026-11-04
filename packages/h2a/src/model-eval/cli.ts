#!/usr/bin/env node
/**
 * Runnable model-eval helper (no new `h2a` CLI verb — the public contract is
 * untouched). Usage with the built package:
 *
 *   node packages/h2a/dist/model-eval/cli.js fetch [--state-dir <dir>]
 *   node packages/h2a/dist/model-eval/cli.js status [--state-dir <dir>]
 *   node packages/h2a/dist/model-eval/cli.js recommend --role design|build|review
 *     --name <label> --workspace <abs path> [--prompt <text>]
 *     [--author-model <id>] [--owner-authorized-opus] [--build-min-intel <n>]
 *     [--state-dir <dir>]
 *
 * `--state-dir` (like `$MODEL_EVAL_STATE_DIR`) names the parent state dir;
 * the module appends `model-eval/` itself.
 *
 * `fetch` needs `$ARTIFICIAL_ANALYSIS_API_KEY` (name only on the CLI; the
 * value is never printed). All other commands work offline from the dated
 * cache. Exit codes: 0 ok · 1 bad input · 2 state error (no source, no
 * candidate, bad cache) · 3 fetch failure.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  AA_API_KEY_ENV,
  fetchAaIndex,
  loadCache,
  loadQuotaOverrides,
  quotaFilePath,
  recommend,
  resolveModelEvalStateDir,
  saveCache
} from "./index.js";
import { ModelEvalError } from "./types.js";
import type { ModelEvalRole } from "./types.js";

function usage(): string {
  return [
    "model-eval: pick h2a launch targets from the Artificial Analysis index",
    "  fetch                              fetch AA index (needs $ARTIFICIAL_ANALYSIS_API_KEY)",
    "  status                             show cache date + quota overrides (offline)",
    "  recommend --role <design|build|review> --name <label> --workspace <dir> [opts]",
    "Options: --prompt <text> --author-model <id> --owner-authorized-opus",
    "         --build-min-intel <n> --state-dir <dir>"
  ].join("\n");
}

/** Flags allowed per command (anything else is a typed refusal, not ignored). */
const FETCH_FLAGS = new Set(["state-dir"]);
const STATUS_FLAGS = new Set(["state-dir"]);
const RECOMMEND_FLAGS = new Set([
  "role",
  "name",
  "workspace",
  "prompt",
  "author-model",
  "owner-authorized-opus",
  "build-min-intel",
  "state-dir"
]);

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith("--")) {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_INPUT",
        `Unexpected positional argument ${JSON.stringify(arg)} (only flags are accepted).\n${usage()}`
      );
    }
    const key = arg.slice(2);
    if (key === "owner-authorized-opus") {
      flags[key] = "true";
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ModelEvalError("MODEL_EVAL_BAD_INPUT", `Missing value for --${key}.`);
    }
    flags[key] = value;
    i++;
  }
  return { cmd: cmd ?? "", flags };
}

function stateDirFrom(flags: Record<string, string>): string | undefined {
  return flags["state-dir"] === undefined ? undefined : flags["state-dir"];
}

function assertKnownFlags(cmd: string, flags: Record<string, string>): void {
  const allowed =
    cmd === "fetch" ? FETCH_FLAGS : cmd === "status" ? STATUS_FLAGS : RECOMMEND_FLAGS;
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_INPUT",
        `Unknown flag --${key} for command '${cmd}'.\n${usage()}`
      );
    }
  }
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${usage()}\n`);
    return 1;
  }
  const { cmd, flags } = parsed;
  try {
    if (cmd !== "fetch" && cmd !== "status" && cmd !== "recommend") {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_INPUT",
        `Unknown command ${JSON.stringify(cmd)} (want fetch|status|recommend).\n${usage()}`
      );
    }
    assertKnownFlags(cmd, flags);
    if (cmd === "fetch") {
      const apiKey = process.env[AA_API_KEY_ENV];
      if (apiKey === undefined || apiKey.length === 0) {
        throw new ModelEvalError(
          "MODEL_EVAL_NO_SOURCE",
          `Cannot fetch: $${AA_API_KEY_ENV} is unset and no usable source exists. ` +
            `Export the key (value never printed) or work offline from an existing cache.`
        );
      }
      const { cache, skipped } = await fetchAaIndex(apiKey);
      const path = saveCache(cache, stateDirFrom(flags));
      process.stdout.write(
        `${JSON.stringify({ ok: true, path, fetchedAt: cache.fetchedAt, models: cache.models.length, skipped }, null, 2)}\n`
      );
      return 0;
    }
    if (cmd === "status") {
      const dir = resolveModelEvalStateDir(stateDirFrom(flags));
      let cache: { fetchedAt: string; models: number; source: string } | null = null;
      try {
        const loaded = loadCache(stateDirFrom(flags));
        cache = { fetchedAt: loaded.fetchedAt, models: loaded.models.length, source: loaded.source };
      } catch (error) {
        // Missing cache is a normal offline state; anything else (corrupt
        // cache) must surface instead of hiding behind `cache: null`.
        if (error instanceof ModelEvalError && error.code === "MODEL_EVAL_NO_SOURCE") {
          cache = null;
        } else {
          throw error;
        }
      }
      const overrides = loadQuotaOverrides(stateDirFrom(flags));
      process.stdout.write(
        `${JSON.stringify({ ok: true, dir, quotaFile: quotaFilePath(stateDirFrom(flags)), cache, overrides }, null, 2)}\n`
      );
      return 0;
    }
    if (cmd === "recommend") {
      const role = flags["role"] as ModelEvalRole | undefined;
      if (role !== "design" && role !== "build" && role !== "review") {
        throw new ModelEvalError(
          "MODEL_EVAL_BAD_INPUT",
          `Missing or invalid --role (want design|build|review).\n${usage()}`
        );
      }
      const name = flags["name"];
      const workspace = flags["workspace"];
      if (name === undefined || workspace === undefined) {
        throw new ModelEvalError(
          "MODEL_EVAL_BAD_INPUT",
          `recommend needs --name and --workspace.\n${usage()}`
        );
      }
      const cache = loadCache(stateDirFrom(flags));
      const overrides = loadQuotaOverrides(stateDirFrom(flags));
      const outcome = recommend({
        role,
        models: cache.models,
        source: { endpoint: cache.source, fetchedAt: cache.fetchedAt },
        overrides,
        ownerAuthorizedOpus: flags["owner-authorized-opus"] === "true",
        buildMinIntelligence:
          flags["build-min-intel"] === undefined
            ? undefined
            : Number(flags["build-min-intel"]),
        authorModel: flags["author-model"],
        launch: {
          name,
          workspace,
          prompt: flags["prompt"] ?? `model-eval ${role} task`
        }
      });
      process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
      return 0;
    }
    process.stderr.write(`Unknown command '${cmd}'.\n${usage()}\n`);
    return 1;
  } catch (error) {
    if (error instanceof ModelEvalError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      if (error.code === "MODEL_EVAL_BAD_INPUT") return 1;
      if (error.code === "MODEL_EVAL_FETCH_FAILED") return 3;
      return 2;
    }
    process.stderr.write(`unexpected: ${(error as Error).message}\n`);
    return 3;
  }
}

const here = fileURLToPath(import.meta.url);
// Resolve the caller's script path the same way on every platform.
const invokedAsMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(here);
if (invokedAsMain) {
  void main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`unexpected: ${(error as Error).message}\n`);
      process.exitCode = 3;
    }
  );
}

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRelauncherRuntime } from "../drumbeat/relaunchers.js";
import {
  headlessDriver,
  localTmuxDriver,
  loggingDriver,
  nativeBackchannelDriver,
  type H2ADriver,
  type H2ADriverKind
} from "./index.js";

const H2A_NATIVE_TARGET_SESSION_ENV = "H2A_NATIVE_TARGET_SESSION";

/** Validates an explicit native PTY session wake target from env. */
export function nativePtyWakeTarget(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[H2A_NATIVE_TARGET_SESSION_ENV];
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

/** Resolves the lazy `@sentropic/h2a-runtime` native-terminal op entrypoint. */
export function nativeTerminalOpPath(): string | undefined {
  let entry: string | undefined;
  try {
    const resolver = (import.meta as unknown as {
      resolve?: (specifier: string) => string;
    }).resolve;
    if (typeof resolver === "function") {
      entry = fileURLToPath(resolver("@sentropic/h2a-runtime"));
    }
  } catch {
    entry = undefined;
  }
  if (entry === undefined) {
    try {
      entry = createRequire(import.meta.url).resolve("@sentropic/h2a-runtime");
    } catch {
      return undefined;
    }
  }
  const operation = join(dirname(entry), "native-terminal", "op.js");
  return existsSync(operation) ? operation : undefined;
}

/** Builds a signed wake driver backed by the native PTY backchannel operation. */
export function nativePtyBackchannelDriver(log: (line: string) => void, env: NodeJS.ProcessEnv = process.env): H2ADriver {
  return nativeBackchannelDriver({
    log,
    runtime: createRelauncherRuntime(env),
    send(request) {
      const operation = nativeTerminalOpPath();
      if (operation === undefined) {
        log(`drive[native-pty]: runtime unavailable for ${request.to}`);
        return undefined;
      }
      const result = spawnSync(
        process.execPath,
        [
          operation,
          "drive",
          "--target",
          request.to,
          "--b64",
          Buffer.from(request.instructionLine, "utf8").toString("base64")
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }
      );
      let outcome: string | undefined;
      if (result.status === 0) {
        try {
          const line = result.stdout.trim().split("\n").at(-1);
          const payload = line ? JSON.parse(line) as { outcome?: unknown } : undefined;
          outcome = typeof payload?.outcome === "string" ? payload.outcome : undefined;
        } catch {
          outcome = undefined;
        }
      }
      const ok = outcome === "driven";
      log(`drive[native-pty]: ${request.to} (${ok ? "ok" : "failed"})`);
      if (outcome === "unresolved") return undefined;
      return ok;
    }
  });
}

/** Constructs the concrete wake/drive delivery driver for the requested kind. */
export function buildDriveDriver(kind: H2ADriverKind, log: (line: string) => void, env: NodeJS.ProcessEnv = process.env): H2ADriver {
  const runtime = createRelauncherRuntime(env);
  switch (kind) {
    case "logging":
      return loggingDriver(log);
    case "native":
      return nativePtyBackchannelDriver(log, env);
    case "local-tmux":
      return localTmuxDriver({ log, runtime });
    case "headless":
      return headlessDriver({ log, runtime });
    case "auto":
      return {
        drive(request) {
          for (const driver of [
            nativePtyBackchannelDriver(log, env),
            localTmuxDriver({ log, runtime }),
            headlessDriver({ log, runtime })
          ]) {
            const result = driver.drive(request);
            if (result === true) return true;
          }
          return false;
        }
      };
  }
}

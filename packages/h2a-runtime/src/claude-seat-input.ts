/**
 * Trusted local masked terminal input boundary for Claude seat credentials.
 * Disables echo, history and external capture; restores terminal state on exit.
 * No secret-bearing argv/env/MCP interfaces or filesystem discovery.
 */
import type { Readable, Writable } from "node:stream";

export const MAX_CLAUDE_INPUT_BYTES = 65536; // 64 KiB UTF-8
export const DEFAULT_CLAUDE_INPUT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface ClaudeSeatInputOptions {
  readonly stdin?: Readable & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  readonly stdout?: Writable & {
    isTTY?: boolean;
  };
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly multiline?: boolean;
}

export class ClaudeSeatInputError extends Error {
  readonly code: string;
  constructor(message: string, code = "input_error") {
    super(message);
    this.name = "ClaudeSeatInputError";
    this.code = code;
  }
}

/**
 * Read masked input from a trusted local TTY without terminal echo or command history.
 * Never logs or prints the entered secret value.
 */
export async function readMaskedInput(
  prompt: string,
  options: ClaudeSeatInputOptions = {},
): Promise<string> {
  const stdin = (options.stdin ?? process.stdin) as Readable & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const stdout = (options.stdout ?? process.stdout) as Writable & {
    isTTY?: boolean;
  };

  // Safe noninteractive refusal: non-TTY environments cannot guarantee capture-free input
  if (!stdin.isTTY) {
    throw new ClaudeSeatInputError(
      "trusted local terminal required for Claude credential entry",
      "non_tty",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_CLAUDE_INPUT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_CLAUDE_INPUT_BYTES;
  const multiline = options.multiline ?? false;

  // Print prompt to terminal
  if (prompt) {
    stdout.write(prompt);
  }

  return new Promise<string>((resolve, reject) => {
    let resolved = false;
    let timer: NodeJS.Timeout | null = null;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        stdin.setRawMode?.(false);
      } catch {
        // Best-effort terminal mode restoration
      }
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("error", onError);
      try {
        stdout.write("\n");
      } catch {
        // Output might be closed
      }
    };

    const finish = (value: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: Error) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    // Set raw mode to disable echo and line buffering
    try {
      stdin.setRawMode?.(true);
      stdin.resume();
    } catch {
      fail(
        new ClaudeSeatInputError(
          "trusted local terminal required for Claude credential entry",
          "raw_mode_failed",
        ),
      );
      return;
    }

    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        fail(
          new ClaudeSeatInputError(
            "Claude credential entry timed out",
            "timeout",
          ),
        );
      }, timeoutMs);
    }

    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      totalBytes += buf.length;

      if (totalBytes > maxBytes) {
        fail(
          new ClaudeSeatInputError(
            `Claude credential input exceeded maximum allowed size (${Math.round(maxBytes / 1024)} KiB)`,
            "oversized",
          ),
        );
        return;
      }

      // Check for control characters: Ctrl-C (0x03)
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x03) {
          fail(
            new ClaudeSeatInputError(
              "Claude enrollment cancelled",
              "cancelled",
            ),
          );
          return;
        }
      }

      chunks.push(buf);

      const fullContent = Buffer.concat(chunks).toString("utf8");

      // Check for Ctrl-D (0x04) in buffer
      if (fullContent.includes("\u0004")) {
        const withoutEof = fullContent.replace(/\u0004/g, "").trim();
        if (!withoutEof) {
          fail(
            new ClaudeSeatInputError(
              "Claude credential entry received EOF",
              "eof",
            ),
          );
          return;
        }
        finish(withoutEof);
        return;
      }

      if (!multiline) {
        // Single-line entry (e.g. code#state): Enter (\r or \n) completes
        if (fullContent.includes("\r") || fullContent.includes("\n")) {
          const line = (fullContent.split(/[\r\n]/)[0] ?? "").trim();
          if (!line) {
            fail(
              new ClaudeSeatInputError(
                "Claude credential entry received empty input",
                "empty",
              ),
            );
            return;
          }
          finish(line);
          return;
        }
      } else {
        // Multiline JSON entry:
        // If Enter is pressed, check if the buffer already forms a valid JSON object,
        // or if a double newline / empty line was submitted.
        if (fullContent.endsWith("\n") || fullContent.endsWith("\r")) {
          const trimmed = fullContent.trim();
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && typeof parsed === "object") {
                finish(trimmed);
                return;
              }
            } catch {
              // Keep accumulating
            }
          }
          if (fullContent.endsWith("\n\n") || fullContent.endsWith("\r\n\r\n")) {
            if (trimmed) {
              finish(trimmed);
              return;
            }
          }
        }
      }
    };

    const onEnd = () => {
      const fullContent = Buffer.concat(chunks).toString("utf8").trim();
      if (!fullContent) {
        fail(
          new ClaudeSeatInputError(
            "Claude credential entry received EOF",
            "eof",
          ),
        );
        return;
      }
      finish(fullContent);
    };

    const onError = () => {
      fail(
        new ClaudeSeatInputError(
          "Claude credential entry input stream error",
          "stream_error",
        ),
      );
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
  });
}

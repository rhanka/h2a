import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeSeatInputError,
  DEFAULT_CLAUDE_INPUT_TIMEOUT_MS,
  MAX_CLAUDE_INPUT_BYTES,
  readMaskedInput,
  readPipedCredentialInput,
} from "./claude-seat-input.js";

function createMockTtyStream() {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
  };
  stream.isTTY = true;
  stream.setRawMode = vi.fn();
  return stream;
}

describe("claude-seat-input", () => {
  it("refuses non-TTY environments with a static refusal", async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;
    const stdout = new PassThrough();

    await expect(
      readMaskedInput("Enter code: ", { stdin, stdout }),
    ).rejects.toThrow("trusted local terminal required for Claude credential entry");
  });

  it("sets raw mode on stdin to disable terminal echo and restores it on completion", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);

    stdin.write("fake-code-123#fake-state-456\n");
    const result = await inputPromise;

    expect(result).toBe("fake-code-123#fake-state-456");
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("never echoes secret characters to stdout", async () => {
    const stdin = createMockTtyStream();
    let written = "";
    const stdout = new PassThrough();
    stdout.on("data", (chunk) => {
      written += chunk.toString("utf8");
    });

    const secretCode = "super-secret-auth-code#state-xyz";
    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    stdin.write(`${secretCode}\n`);
    await inputPromise;

    // Prompt is printed, but the secret itself is NEVER written to stdout
    expect(written).toContain("Code: ");
    expect(written).not.toContain(secretCode);
    expect(written).not.toContain("super-secret");
  });

  it("handles cancellation via Ctrl-C (0x03) and restores terminal state", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    // Write Ctrl-C byte
    stdin.write(Buffer.from([0x03]));

    await expect(inputPromise).rejects.toThrow("Claude enrollment cancelled");
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("handles EOF via Ctrl-D (0x04) without empty input", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    stdin.write("code-from-ctrl-d\u0004");
    const result = await inputPromise;

    expect(result).toBe("code-from-ctrl-d");
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("refuses premature EOF on empty input and restores terminal state", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    stdin.end();

    await expect(inputPromise).rejects.toThrow("Claude credential entry received EOF");
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("enforces timeout deadline and restores terminal state", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", {
      stdin,
      stdout,
      timeoutMs: 50,
    });

    await expect(inputPromise).rejects.toThrow("Claude credential entry timed out");
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("enforces max input size (64 KiB) and restores terminal state", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", {
      stdin,
      stdout,
      maxBytes: 1024,
    });

    // Write oversized data (> 1024 bytes)
    const largeChunk = Buffer.alloc(2048, "a");
    stdin.write(largeChunk);

    await expect(inputPromise).rejects.toThrow(
      "Claude credential input exceeded maximum allowed size (1 KiB)",
    );
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("reads multiline JSON credential input and restores terminal state", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const jsonSecret = JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600000,
        scopes: ["user:inference"],
      },
    }, null, 2);

    const inputPromise = readMaskedInput("JSON: ", {
      stdin,
      stdout,
      multiline: true,
    });

    stdin.write(`${jsonSecret}\n`);
    const result = await inputPromise;

    expect(result).toBe(jsonSecret);
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it("applies Backspace/DEL edits without incorporating them into the secret", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    stdin.write(Buffer.from("ab"));
    stdin.write(Buffer.from([0x7f])); // DEL removes "b"
    stdin.write(Buffer.from([0x08])); // Backspace removes "a"
    stdin.write(Buffer.from([0xc3, 0xa9])); // é
    stdin.write(Buffer.from([0x7f])); // DEL removes the whole multibyte char
    stdin.write("ok\n");

    await expect(inputPromise).resolves.toBe("ok");
  });

  it("pauses stdin and restores the previous raw mode on completion", async () => {
    const stdin = createMockTtyStream();
    (stdin as unknown as { isRaw: boolean }).isRaw = true;
    const pauseSpy = vi.spyOn(stdin, "pause");
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    stdin.write("done\n");
    await inputPromise;

    expect(pauseSpy).toHaveBeenCalled();
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(true);
  });

  it("handles multibyte UTF-8 input correctly across chunk boundaries", async () => {
    const stdin = createMockTtyStream();
    const stdout = new PassThrough();

    const inputPromise = readMaskedInput("Code: ", { stdin, stdout });
    // Write multibyte character (e.g. é: 0xc3 0xa9) split across chunks
    stdin.write(Buffer.from([0xc3]));
    stdin.write(Buffer.from([0xa9, 0x0a]));

    const result = await inputPromise;
    expect(result).toBe("é");
  });

  it("never reflects canary secret code/JSON/path in errors or stdout/stderr", async () => {
    const canaryCode = "CANARY_SECRET_AUTH_CODE_XYZ123";
    const canaryPath = "/secret/path/to/credentials.json";
    const stdin = createMockTtyStream();
    let stdoutBuffer = "";
    const stdout = new PassThrough();
    stdout.on("data", (chunk) => { stdoutBuffer += chunk.toString("utf8"); });

    const inputPromise = readMaskedInput("Prompt: ", {
      stdin,
      stdout,
      maxBytes: 50,
    });

    // Write canary that triggers oversized error
    stdin.write(`${canaryPath}-${canaryCode}-exceeding-fifty-bytes-overflow-now`);

    let caughtError: unknown;
    try {
      await inputPromise;
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ClaudeSeatInputError);
    const errorMessage = (caughtError as Error).message;
    expect(errorMessage).not.toContain(canaryCode);
    expect(errorMessage).not.toContain(canaryPath);
    expect(stdoutBuffer).not.toContain(canaryCode);
    expect(stdoutBuffer).not.toContain(canaryPath);
  });

  it("reads piped secret-manager output without echo or logging", async () => {
    const canary = `{"claudeAiOauth":{"accessToken":"CANARY_PIPE_ACCESS","refreshToken":"CANARY_PIPE_REFRESH"}}`;
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;

    const pending = readPipedCredentialInput({ stdin });
    stdin.write(canary);
    stdin.end();

    const result = await pending;
    expect(result).toBe(canary);
  });

  it("refuses empty piped input and TTY stdin with static errors", async () => {
    const emptyPipe = new PassThrough() as PassThrough & { isTTY?: boolean };
    emptyPipe.isTTY = false;
    const pendingEmpty = readPipedCredentialInput({ stdin: emptyPipe });
    emptyPipe.end();
    await expect(pendingEmpty).rejects.toThrow(
      "Claude token entry received empty input",
    );

    const tty = createMockTtyStream();
    await expect(readPipedCredentialInput({ stdin: tty })).rejects.toThrow(
      "piped input required for Claude token entry",
    );
  });

  it("bounds piped input and never reflects canary material", async () => {
    const canary = "CANARY_PIPE_OVERFLOW_";
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;

    const pending = readPipedCredentialInput({ stdin, maxBytes: 16 });
    stdin.write(`${canary}-payload-exceeding-sixteen-bytes`);

    let caughtError: unknown;
    try {
      await pending;
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeInstanceOf(ClaudeSeatInputError);
    expect((caughtError as Error).message).not.toContain(canary);
  });
});

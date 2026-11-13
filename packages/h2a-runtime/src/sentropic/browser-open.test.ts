/**
 * The system browser opener of `h2a sentropic login`. The authorization URL carries `&` in its
 * query and its path comes from discovery: on Windows it must reach the browser as ONE argument
 * and never pass through cmd.exe (`cmd /c start "" <url>` cut it at the first `&` and ran the
 * rest as commands). Only an https URL — plain http on a loopback host, for local test servers —
 * is ever handed to an opener.
 */

import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import { browserCommand, openInSystemBrowser, type SpawnLike } from "./browser-open.js";

const AUTHORIZE =
  "https://preprod.auth.sent-tech.ca/api/v1/auth/oauth/authorize?response_type=code&client_id=h2a-cli" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A50123%2Fcallback&scope=mcp%3Adiscover&state=st&code_challenge=ch" +
  "&code_challenge_method=S256";
/** What discovery could hand over as an authorization_endpoint path: https, same origin, no space. */
const HOSTILE_PATH = "https://preprod.auth.sent-tech.ca/a&calc.exe,arg?response_type=code&x=1|whoami";

describe("system browser opener", () => {
  it("opens the URL on Windows through rundll32 url.dll,FileProtocolHandler as ONE argument, never through cmd", () => {
    for (const url of [AUTHORIZE, HOSTILE_PATH]) {
      const cmd = browserCommand("win32", url, { SystemRoot: "C:\\Windows" });
      expect(cmd.command).toBe("C:\\Windows\\System32\\rundll32.exe");
      expect(cmd.args).toEqual(["url.dll,FileProtocolHandler", new URL(url).href]);
      expect(cmd.args[1]).toContain("&");
      expect([cmd.command, ...cmd.args].some((part) => /^(?:cmd(?:\.exe)?|\/c|start)$/iu.test(part))).toBe(false);
    }
    // A SystemRoot that is not an absolute drive path is not trusted for the opener's location.
    expect(browserCommand("win32", AUTHORIZE, { SystemRoot: "..\\planted" }).command).toBe("C:\\Windows\\System32\\rundll32.exe");
  });

  it("uses open on macOS and xdg-open elsewhere, with the URL as one argument", () => {
    expect(browserCommand("darwin", AUTHORIZE)).toEqual({ command: "open", args: [new URL(AUTHORIZE).href] });
    expect(browserCommand("linux", AUTHORIZE)).toEqual({ command: "xdg-open", args: [new URL(AUTHORIZE).href] });
  });

  it("refuses a URL that is not https, except plain http on a loopback host", () => {
    for (const bad of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ms-settings:privacy",
      "\\\\attacker\\share\\x.exe",
      "C:\\Windows\\System32\\calc.exe",
      "http://auth.example/authorize",
      "https://user:secret@auth.example/authorize",
      "not a url",
    ]) {
      expect(() => browserCommand("win32", bad), bad).toThrow();
    }
    expect(browserCommand("linux", "http://127.0.0.1:4567/authorize?x=1&y=2").args).toEqual(["http://127.0.0.1:4567/authorize?x=1&y=2"]);
  });

  it("spawns detached and hidden with an error listener, and spawns nothing for a refused URL", () => {
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions; listeners: string[] }> = [];
    const spawn: SpawnLike = (command, args, options) => {
      const call = { command, args, options, listeners: [] as string[] };
      calls.push(call);
      const child = {
        on(event: string) {
          call.listeners.push(event);
          return child;
        },
        unref() {},
      };
      return child as unknown as ReturnType<SpawnLike>;
    };
    expect(openInSystemBrowser(AUTHORIZE, { platform: "win32", spawn })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command.toLowerCase().endsWith("\\system32\\rundll32.exe")).toBe(true);
    expect(calls[0]!.args).toEqual(["url.dll,FileProtocolHandler", new URL(AUTHORIZE).href]);
    expect(calls[0]!.options).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
    expect(calls[0]!.options.shell).toBeFalsy();
    expect(calls[0]!.listeners).toContain("error");
    expect(openInSystemBrowser("file:///etc/passwd", { platform: "win32", spawn })).toBe(false);
    expect(openInSystemBrowser("http://auth.example/authorize", { platform: "linux", spawn })).toBe(false);
    expect(calls).toHaveLength(1);
    const throwing: SpawnLike = () => {
      throw new Error("ENOENT");
    };
    expect(openInSystemBrowser(AUTHORIZE, { platform: "linux", spawn: throwing })).toBe(false);
  });
});

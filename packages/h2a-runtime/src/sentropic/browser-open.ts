/**
 * Open the sign-in URL in the system browser, detached, WITHOUT a shell.
 *
 * - Windows: `%SystemRoot%\System32\rundll32.exe url.dll,FileProtocolHandler <url>`. The URL
 *   travels as ONE argument and no cmd.exe ever parses it. The former `cmd /c start "" <url>`
 *   let cmd.exe read the `&` of the query string as a command separator: the browser received a
 *   truncated URL (no client_id) and the rest of the query ran as commands — an injection vector,
 *   since the authorization_endpoint path comes from discovery and keeps `&` and `,`. The opener
 *   is named by its absolute path, so no planted `rundll32.exe` in the working directory is run.
 * - macOS: `open <url>`; elsewhere: `xdg-open <url>`.
 *
 * Only an https URL (plain http on a loopback host, for local test servers), without
 * credentials, is ever handed to an opener: a file or UNC path, or another scheme, would make the
 * opener run or show something other than the sign-in page. The URL is the authorization request
 * (state, nonce, PKCE challenge — no secret) and is printed as the fallback either way.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { win32 } from "node:path";

import { isLoopbackHostname } from "./publish-config.js";
import { SentropicPublishError } from "./publish-errors.js";

export interface BrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, "on" | "unref">;

const WINDOWS_ROOT_FALLBACK = "C:\\Windows";
const ABSOLUTE_WINDOWS_DIR = /^[A-Za-z]:\\[^"<>|?*\r\n]*$/u;

/** The URL to open, normalized, or a refusal (the URL itself is never echoed). */
export function assertBrowserUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SentropicPublishError("authorization", "the sign-in URL is not an absolute URL; no browser was opened");
  }
  if (url.username || url.password) {
    throw new SentropicPublishError("authorization", "the sign-in URL carries credentials; no browser was opened");
  }
  const loopbackHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new SentropicPublishError("authorization", "the sign-in URL is not https; no browser was opened");
  }
  return url.href;
}

/** The opener and its arguments for `platform`; the URL is always exactly one argument. */
export function browserCommand(
  platform: NodeJS.Platform,
  raw: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BrowserCommand {
  const url = assertBrowserUrl(raw);
  if (platform === "win32") {
    const root = env.SystemRoot !== undefined && ABSOLUTE_WINDOWS_DIR.test(env.SystemRoot) ? env.SystemRoot : WINDOWS_ROOT_FALLBACK;
    return { command: win32.join(root, "System32", "rundll32.exe"), args: ["url.dll,FileProtocolHandler", url] };
  }
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Launch the system browser on `url`; false when the URL is refused or no opener could be
 * started. A missing opener reports asynchronously: the error listener keeps Node from printing
 * spawnargs (which carry the URL).
 */
export function openInSystemBrowser(url: string, opts: { platform?: NodeJS.Platform; spawn?: SpawnLike } = {}): boolean {
  let command: BrowserCommand;
  try {
    command = browserCommand(opts.platform ?? process.platform, url);
  } catch {
    return false;
  }
  const spawn: SpawnLike = opts.spawn ?? nodeSpawn;
  try {
    const child = spawn(command.command, [...command.args], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

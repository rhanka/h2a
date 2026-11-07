/** RED stub — see publish-client.test.ts. */
import type { Command } from "commander";
export interface SentropicCliDeps {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  now: () => number;
  openBrowser: (url: string) => boolean;
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: () => string;
  resolveWorkspace: (cwd: string) => string | undefined;
  setExitCode: (code: number) => void;
  homeDir: () => string;
}
export function registerSentropicCommand(program: Command, _deps: Partial<SentropicCliDeps> = {}): Command {
  return program.command("sentropic").description("not implemented");
}

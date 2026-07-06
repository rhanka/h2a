export type FlagValue = string | boolean;
export interface ParsedArgs {
    positionals: string[];
    flags: Record<string, FlagValue>;
}
/** Split argv into positionals and `--key [value]` flags (a bare `--key` is boolean true). */
export declare function parseFlags(args: string[]): ParsedArgs;
export declare function str(v: FlagValue | undefined): string | undefined;
export declare function list(v: FlagValue | undefined): string[];

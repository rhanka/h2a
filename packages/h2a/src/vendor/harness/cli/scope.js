// Shared scope-check input resolution — used by `check scope`, `verify`, and `audit` so the
// BRANCH.md parsing + boundary wiring lives in ONE place (no duplicated file IO).
import { readFileSync } from 'node:fs';
import { parseBranchMd } from '../branch-md/parse.js';
import { checkScope } from '../checks/scope-check.js';
import { list, str } from './args.js';
/** Resolve `--branch-md` + `--staged-files` into a C2 scope CheckResult (pure but for the file read). */
export function scopeFromFlags(flags, profile) {
    const branchMdPath = str(flags['branch-md']);
    let parsed;
    if (branchMdPath) {
        try {
            parsed = parseBranchMd(readFileSync(branchMdPath, 'utf8'));
        }
        catch {
            return { unreadable: branchMdPath };
        }
    }
    const result = checkScope({
        stagedFiles: list(flags['staged-files']),
        boundary: {
            allowed: parsed?.allowedPaths ?? [],
            forbidden: parsed?.forbiddenPaths ?? [],
            conditional: parsed?.conditionalPaths ?? [],
        },
        profile,
        declaredExceptions: parsed?.exceptions ?? [],
    });
    return { result };
}

import { describe, expect, it } from 'vitest';
import { runVulnerabilitySeatTask, type SeatTask } from './vuln-seat.js';

const task = (kind: 'author' | 'review' = 'author'): SeatTask => ({
  kind, seat: { id: 'fixture', profile: 'claude', model: 'fixture-model', effort: 'high' },
  workspace: '/fixture/repo/tmp/worktrees/author', baseline: 'b'.repeat(40), sha: 'a'.repeat(40),
  scopeCommand: "'node' '/trusted/workspace-scope-guard.mjs' --workspace '/fixture/repo/tmp/worktrees/author' --host claude",
  locks: ['package-lock.json'], findings: [{ id: 'GHSA-fixture', severity: 'high' }],
});

describe('local vulnerability seat runner', () => {
  it('should pin workspace and scope hooks while keeping prompts off argv and disabling shell/MCP tools', async () => {
    let observed: any;
    const result = await runVulnerabilitySeatTask(task(), { execute: async (command, args, options) => {
      observed = { command, args, options }; return { code: 0, stdout: 'done', stderr: '' };
    } });
    expect(result.code).toBe(0);
    expect(observed.command).toBe('claude');
    expect(observed.options.cwd).toBe(task().workspace);
    expect(observed.args.join(' ')).not.toContain('GHSA-fixture');
    expect(observed.options.input).toContain('GHSA-fixture');
    expect(observed.args).toContain('--strict-mcp-config');
    expect(observed.args[observed.args.indexOf('--tools') + 1]).not.toContain('Bash');
    expect(observed.args[observed.args.indexOf('--settings') + 1]).toContain('PreToolUse');
    expect(observed.args[observed.args.indexOf('--settings') + 1]).toContain('initialize-session');
    expect(observed.options.input).toContain('Never merge');
  });

  it('should make reviewers read-only and demand an exact SHA receipt', async () => {
    await runVulnerabilitySeatTask(task('review'), { execute: async (_command, args, options) => {
      expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
      expect(options.input).toContain('"sha":"' + 'a'.repeat(40));
      expect(options.input).toContain('independent');
      return { code: 0, stdout: '{}', stderr: '' };
    } });
  });

  it('should use Codex native sandbox restrictions without network or inherited API credit keys', async () => {
    const codex: SeatTask = { ...task(), seat: { ...task().seat, profile: 'codex' },
      nativeScope: { workspace: task().workspace, host: 'codex', plugin: 'h2a@sentropic', bundleSha256: 'a'.repeat(64), qualifiedAt: new Date().toISOString() } };
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'fixture-do-not-forward';
    try {
      await runVulnerabilitySeatTask(codex, { execute: async (_command, args, options) => {
        expect(args).toContain('workspace-write');
        expect(args).toContain('sandbox_workspace_write.network_access=false');
        expect(args).toContain('plugins."h2a@sentropic".enabled=true');
        expect(options.env.OPENAI_API_KEY).toBeUndefined();
        expect(options.input).toContain('Lockfile-only');
        return { code: 0, stdout: '', stderr: '' };
      } });
    } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
  });

  it('should refuse unsupported native lanes, missing scope binding and mismatched workspace', async () => {
    const execute = async () => { throw new Error('must never spawn'); };
    for (const changed of [
      { ...task(), scopeCommand: undefined },
      { ...task(), seat: { ...task().seat, profile: 'vibe' } },
      { ...task(), workspace: 'relative' },
    ]) await expect(runVulnerabilitySeatTask(changed as SeatTask, { execute })).rejects.toThrow();
  });

  it('should refuse Codex before spawning unless its trusted native scope plugin was admitted for this exact workspace', async () => {
    const codex: SeatTask = { ...task(), seat: { ...task().seat, profile: 'codex' } };
    let spawned = false;
    await expect(runVulnerabilitySeatTask(codex, { execute: async () => { spawned = true; return { code: 0, stdout: '', stderr: '' }; } })).rejects.toThrow(/native scope/);
    expect(spawned).toBe(false);
  });

  it('should keep large author inventories in local artifacts instead of exceeding the native prompt limit', async () => {
    const large = { ...task(), findingsFile: '.h2a/vuln-fix-author/findings.json', findings: [{ detail: 'x'.repeat(70_000) }] };
    await expect(runVulnerabilitySeatTask(large, { execute: async (_command, _args, options) => {
      expect(options.input).toContain('findings.json');
      expect(options.input.length).toBeLessThan(10_000);
      return { code: 0, stdout: '', stderr: '' };
    } })).resolves.toMatchObject({ code: 0 });
  });
});

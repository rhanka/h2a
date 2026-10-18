import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { npmTreeIncludes } from './scan.mjs';
import { redactOutput, redactSecretsText } from './redact.mjs';

export async function supplyChain(repo, now) {
  const results = { ok: true, checks: [], errors: [] };
  for (const file of repo.locks) {
    try {
      const cwd = join(repo.workspace, dirname(file));
      for (const args of [['ci', '--ignore-scripts', ...npmTreeIncludes], ['audit', 'signatures', '--json', ...npmTreeIncludes]]) {
        const output = redactOutput(await repo.execute('npm', args, { cwd }));
        results.checks.push({ command: 'npm', args, lockfile: file, ...output });
        if (output.code !== 0) throw new Error(`npm ${args.join(' ')} failed`);
      }
      const before = JSON.parse(repo.originalLocks.get(file));
      const after = JSON.parse(readFileSync(repo.file(file), 'utf8'));
      const seen = new Set();
      for (const [path, pkg] of Object.entries(after.packages)) {
        if (!path.includes('node_modules/') || pkg.link || JSON.stringify(pkg) === JSON.stringify(before.packages[path])) continue;
        const name = pkg.name ?? path.split('node_modules/').at(-1);
        const identity = `${name}@${pkg.version}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const output = redactOutput(await repo.execute('npm', ['view', identity, 'dist', 'time', '--json', '--registry=https://registry.npmjs.org'], { cwd }));
        if (output.code !== 0) throw new Error(`registry metadata unavailable: ${identity}`);
        const metadata = JSON.parse(output.stdout);
        const age = now.getTime() - Date.parse(metadata.time?.[pkg.version]);
        if (!Number.isFinite(age) || age < 7 * 86_400_000) throw new Error(`release maturation below 7 days or unknown: ${identity}`);
        if (!pkg.integrity || metadata.dist?.integrity !== pkg.integrity || !metadata.dist?.signatures?.length ||
          !metadata.dist?.attestations?.provenance) throw new Error(`integrity/signature/provenance absent or inconsistent: ${identity}`);
        results.checks.push({ package: identity, ageDays: Math.floor(age / 86_400_000), integrity: pkg.integrity,
          signaturePresent: true, provenancePresent: true });
      }
    } catch (error) { if (error.quarantine) throw error; results.errors.push(redactSecretsText(`${file}: ${error.message}`)); }
  }
  results.ok = results.errors.length === 0;
  return results;
}

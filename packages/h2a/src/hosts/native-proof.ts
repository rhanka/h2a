import { join } from 'node:path';
import { digest, snapshot } from './native-files.js';
import { semanticDigest } from './native-toml.js';
import { verifyRuntimeRecord } from './native-runtime-record.js';
export const PROOF_COMPONENTS = ['skills', 'guard', 'lifecycle', 'MCP', 'context'] as const;
export type ProofComponent = typeof PROOF_COMPONENTS[number];
export interface NativeQualification {
  schema: 1; host: string; root: string; fixture: boolean; recordedAt: string;
  runtime: { distribution: 'mistral-vibe' | 'muse' | 'agy'; version: string; recordSha256: string; recordPath: string; metadataPath: string; generatedFiles?: Record<string, string> };
  components: Partial<Record<ProofComponent, { status: 'qualified' | 'partial' | 'failed'; dependencies: Record<string, string>; evidence: string[]; evidenceHashes: Record<string, string>; scope: string }>>;
}
export function inspectNativeQualification(state: string, host: string, root: string, observed: Record<string, string>) {
  const file = snapshot(join(state, 'qualification.json'));
  const components = Object.fromEntries(PROOF_COMPONENTS.map(c => [c, 'absent'])) as Record<ProofComponent, string>;
  if (!file) return { status: 'absent', components, guardEligible: false };
  const proof = JSON.parse(file.bytes.toString()) as NativeQualification;
  if (proof.schema !== 1 || proof.host !== host || proof.root !== root || typeof proof.fixture !== 'boolean' || !Number.isFinite(Date.parse(proof.recordedAt)) || !proof.components || !proof.runtime?.recordPath || !proof.runtime.metadataPath)
    return { status: 'incompatible', components, guardEligible: false };
  const metadata = snapshot(proof.runtime.metadataPath)?.bytes.toString() ?? '';
  const runtimeCurrent = fileFingerprint(proof.runtime.recordPath) === proof.runtime.recordSha256 && verifyRuntimeRecord(proof.runtime.recordPath, proof.runtime.generatedFiles) && /^Version: ([^\r\n]+)$/m.exec(metadata)?.[1] === proof.runtime.version &&
    (host !== 'vibe' || proof.runtime.distribution === 'mistral-vibe' && /Name: mistral[-_]vibe/i.test(metadata));
  for (const component of PROOF_COMPONENTS) {
    const result = proof.components[component];
    if (!result) continue;
    const evidenceCurrent = Array.isArray(result.evidence) && result.evidence.length > 0 && result.evidence.every(path => !!snapshot(path) && result.evidenceHashes?.[path] === fileFingerprint(path));
    const fresh = runtimeCurrent && evidenceCurrent && result.dependencies && Object.keys(result.dependencies).length > 0 && Object.entries(result.dependencies).every(([name, hash]) => observed[name] === hash);
    components[component] = proof.fixture ? 'fixture-only' : !fresh ? 'obsolete' : result.status;
  }
  const mcp = proof.components.MCP;
  const guardEligible = components.MCP === 'qualified' && !!mcp?.evidence?.length && ['MCP', 'profile', 'entrypoint', 'node'].every(k => !!mcp.dependencies[k]);
  return { status: proof.fixture ? 'fixture-only' : Object.values(components).every(s => s === 'qualified') ? 'qualified' : 'partial', components, guardEligible };
}
export function mcpFingerprint(config: Record<string, unknown>): string { return semanticDigest(config); }
export function fileFingerprint(path: string): string { return digest(snapshot(path)?.bytes ?? 'missing'); }

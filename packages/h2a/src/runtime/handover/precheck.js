import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { verifyImage } from './image.js';
import { digest } from './wire.js';
import { readState, publishState } from './state.js';
import { currentIdentity } from './admission.js';
import { classifyDurableProcFrame } from './proc-identity.js';

export function verifyTarget(installation, target, selectionEpoch) {
  const selection = readState(join(installation.managedRoot, 'state', 'selected-build.json'), 'selection')?.value;
  if (!selection || selection.selectionEpoch !== selectionEpoch || selection.manifestDigest !== target.manifestDigest ||
    selection.buildId !== target.buildId || selection.packageVersion !== target.packageVersion || selection.prefixId !== installation.prefixId) throw new Error('target_selection_mismatch');
  const root = join(installation.managedRoot, 'images', target.manifestDigest.slice(7));
  const path = join(root, 'manifest.json');
  if (!fs.lstatSync(path).isFile()) throw new Error('image_manifest_required');
  const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
  verifyImage(root, manifest, target.manifestDigest);
  if (manifest.buildId !== target.buildId || manifest.packageVersion !== target.packageVersion ||
    manifest.profile.nodeMajor !== Number(process.versions.node.split('.')[0]) || manifest.profile.nodeAbi !== process.versions.modules ||
    manifest.profile.arch !== process.arch) throw new Error('target_profile_mismatch');
  if (join(root, selection.entrypoint) !== target.entrypoint || !Object.values(manifest.entrypoints).includes(selection.entrypoint)) throw new Error('target_entrypoint_mismatch');
  return { root, manifest };
}
export function verifyPrecheckEvidence(directory, evidenceDigest, target, selectionEpoch, frame = currentIdentity()) {
  if (!/^sha256:[0-9a-f]{64}$/.test(evidenceDigest)) throw new Error('precheck_evidence_required');
  const evidence = readState(join(directory, `precheck-${evidenceDigest.slice(7)}.json`), 'precheckEvidence')?.value;
  if (!evidence || digest(evidence) !== evidenceDigest || evidence.targetBuildId !== target.buildId ||
    evidence.targetManifestDigest !== target.manifestDigest || evidence.targetEntrypoint !== target.entrypoint ||
    evidence.selectionEpoch !== selectionEpoch || !evidence.cleanupVerified) throw new Error('precheck_evidence_mismatch');
  if (classifyDurableProcFrame(evidence.trialIdentity, frame) !== 'current' || evidence.trialIdentity.nsNet !== frame.nsNet) throw new Error('precheck_frame_mismatch');
  return evidence;
}

// Controller helper. The only process signalled is the child created here.
// No shared store path or authority is passed into its neutral environment.
export async function runIsolatedPrecheck(installation, target, selectionEpoch, evidenceDirectory) {
  const { root, manifest } = verifyTarget(installation, target, selectionEpoch);
  const directory = fs.mkdtempSync(join(tmpdir(), 'h2a-mcp-precheck-'));
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
  for (const [name, leaf] of Object.entries({ HOME: 'home', XDG_RUNTIME_DIR: 'run', XDG_CONFIG_HOME: 'config',
    XDG_STATE_HOME: 'state', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', TMPDIR: 'tmp', H2A_ROOT: 'store' })) {
    env[name] = join(directory, leaf); fs.mkdirSync(env[name], { mode: 0o700 });
  }
  const started = Date.now(); let child, output = '', trialIdentity;
  try {
    child = spawn(process.execPath, [target.entrypoint, 'mcp-central-precheck', '--root', env.H2A_ROOT,
      '--runtime-base', env.XDG_RUNTIME_DIR, '--image-root', root, '--manifest-digest', target.manifestDigest],
      { env, cwd: env.HOME, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    let escalation;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 500); }, manifest.startupWaitBudgetMs);
    const cap = bytes => { output += bytes; if (Buffer.byteLength(output) > 64 * 1024) child.kill('SIGTERM'); };
    child.stdout.on('data', cap); child.stderr.on('data', cap);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => { clearTimeout(timer); clearTimeout(escalation); });
    if (code !== 0 || timedOut) throw new Error('precheck_failed', {
      cause: { exitCode: code, timedOut, output: output.slice(-4096) }
    });
    const result = output.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(r => r?.precheckReady);
    if (!result || result.manifestDigest !== target.manifestDigest || result.buildId !== target.buildId) throw new Error('precheck_readiness_mismatch');
    trialIdentity = result.processIdentity;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  if (fs.existsSync(directory)) throw new Error('precheck_cleanup_failed');
  const evidence = { schemaVersion: 1, targetBuildId: target.buildId, targetManifestDigest: target.manifestDigest,
    targetEntrypoint: target.entrypoint, selectionEpoch, trialIdentity, elapsedMs: Date.now() - started, cleanupVerified: true };
  const hash = digest(evidence); publishState(join(evidenceDirectory, `precheck-${hash.slice(7)}.json`), evidence, 'precheckEvidence');
  return hash;
}

export function readPrecheckManifest(root, expectedDigest) {
  const manifest = JSON.parse(fs.readFileSync(join(root, 'manifest.json'), 'utf8'));
  verifyImage(root, manifest, expectedDigest);
  return { manifest, processIdentity: currentIdentity() };
}

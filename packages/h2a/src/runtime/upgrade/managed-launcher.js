import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prefixLayout } from '../handover/authority.js';
import { privateDirectory, readState } from '../handover/state.js';
import { resolveSelectedEntry } from '../handover/selection.js';
import { validate } from '../handover/formats.js';
import { verifyImage } from '../handover/image.js';

function installationAt(url) {
  const launcher = fs.realpathSync(fileURLToPath(url)), root = dirname(dirname(launcher));
  if (join(root, 'launcher/h2a.mjs') !== launcher || dirname(root).split('/').at(-1) !== 'h2a-managed' ||
    root.split('/').at(-1) !== String(process.getuid())) throw new Error('managed_launcher_location_invalid');
  privateDirectory(root);
  const installation = readState(join(root, 'installation.json'), 'installation')?.value;
  if (!installation) throw new Error('installation_incomplete');
  const physical = prefixLayout(dirname(dirname(root)), dirname(dirname(root)), process.getuid());
  for (const key of ['canonicalPrefix', 'prefixId', 'uid', 'managedRoot']) {
    if (installation[key] !== physical[key]) throw new Error('foreign_installation_authority');
  }
  return { installation, launcher };
}
function loadingProfile() {
  if (process.platform !== 'linux' || ![22, 24].includes(Number(process.versions.node.split('.')[0])) ||
    !process.report.getReport().header.glibcVersionRuntime) throw new Error('authority_profile_unqualified');
  // NODE_PATH is removed for both the image and any children. Loading options
  // already supplied to Node cannot be undone; refuse before importing an image.
  delete process.env.NODE_PATH;
  const options = [process.env.NODE_OPTIONS ?? '', ...process.execArgv].join(' ').trim();
  if (options && !/^(?:--max-old-space-size=[0-9]+\s*)+$/.test(options)) throw new Error('external_loader_unqualified');
}
function entryState(installation, launcher) {
  const path = join(installation.canonicalPrefix, 'bin/h2a');
  let externalInstallDetected = true;
  try { externalInstallDetected = fs.realpathSync(path) !== launcher; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let pathShadowing = false;
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const command = join(directory, 'h2a');
    try {
      fs.accessSync(command, fs.constants.X_OK);
      pathShadowing = fs.realpathSync(command) !== launcher; break;
    } catch (e) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(e.code)) throw e; }
  }
  return { externalInstallDetected, pathShadowing };
}
function verifiedHistory(installation) {
  const state = join(installation.managedRoot, 'state'), history = join(state, 'selection-history');
  const candidates = [join(state, 'last-valid-selection.json')];
  for (const name of fs.readdirSync(history).filter(n => /^[1-9][0-9]*\.json$/.test(n)).sort((a, b) => Number.parseInt(b) - Number.parseInt(a))) {
    candidates.push(join(history, name));
  }
  for (const path of candidates) {
    try {
      const selection = readState(path, 'selection')?.value;
      if (!selection) continue;
      validate('selection', selection);
      if (['prefixId', 'canonicalPrefix', 'uid'].some(k => selection[k] !== installation[k])) continue;
      const root = join(installation.managedRoot, 'images', selection.manifestDigest.slice(7)); privateDirectory(root);
      const manifestPath = join(root, 'manifest.json');
      if (!fs.lstatSync(manifestPath).isFile()) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      verifyImage(root, manifest, selection.manifestDigest);
      if (manifest.buildId !== selection.buildId || manifest.packageVersion !== selection.packageVersion ||
        !Object.values(manifest.entrypoints).includes(selection.entrypoint) || manifest.profile.nodeMajor !== Number(process.versions.node.split('.')[0]) ||
        manifest.profile.nodeAbi !== process.versions.modules || manifest.profile.arch !== process.arch || process.platform !== 'linux') continue;
      return selection;
    } catch { /* A malformed candidate grants no execution or mutation right. */ }
  }
  return null;
}
function transactionsAt(installation) {
  const directory = join(installation.managedRoot, 'state/upgrade/transactions');
  return fs.readdirSync(directory).sort().map(name => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name)) throw new Error('RECOVERY_BLOCKED:unknown_journal');
    const tx = readState(join(directory, name), 'upgradeTransaction')?.value;
    if (!tx || tx.upgradeId + '.json' !== name || ['prefixId', 'canonicalPrefix', 'uid'].some(k => tx[k] !== installation[k])) throw new Error('foreign_installation_authority');
    return { upgradeId: tx.upgradeId, revision: tx.revision, phase: tx.installationState,
      selectionEpoch: tx.selectionEpoch, controllerEpoch: tx.controllerEpoch, controllerBuildId: tx.controllerBuildId,
      controllerAuthorityState: tx.controllerAuthorityState };
  });
}
export async function launchManaged(url) {
  loadingProfile();
  const { installation, launcher } = installationAt(url), observation = entryState(installation, launcher);
  const args = process.argv.slice(2), status = args[0] === 'upgrade' && args[1] === 'status';
  let current, selectionError;
  try { current = resolveSelectedEntry(installation); } catch (error) { selectionError = error; }
  const transactions = transactionsAt(installation);
  if (status) {
    const selection = current?.selection ?? verifiedHistory(installation);
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, installationLayout: 'managed', ...observation,
      selectionState: current ? 'verified' : 'unreadable', selection: current?.selection ?? null,
      recoveryCandidate: current ? null : selection, mutationsAllowed: false, transactions }) + '\n');
    return;
  }
  if (selectionError) throw selectionError;
  if (observation.externalInstallDetected) throw new Error('external_install_detected');
  if (observation.pathShadowing) throw new Error('path_shadowing');
  if (transactions.some(tx => tx.phase === 'SELECTING')) throw new Error('selection_recovery_required');
  process.argv[1] = current.entrypoint;
  await import(pathToFileURL(current.entrypoint).href);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await launchManaged(import.meta.url); }
  catch (error) {
    if (process.argv.includes('--json') || process.argv[2] === 'upgrade') process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, reason: error.message }) + '\n');
    else process.stderr.write(`h2a: ${error.message}\n`);
    process.exitCode = 1;
  }
}

import fs from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest } from './wire.js';
import { readState, privateDirectory } from './state.js';
import { verifyImage } from './image.js';
import { ensureManagedImageExecution } from '../upgrade/image-entry.js';

export function installationForEntry(entry) {
  const absolute = fs.realpathSync(entry);
  const npm = absolute.match(/^(.*)\/lib\/node_modules\/@sentropic\/h2a\/dist\/bin\.js$/);
  const managed = absolute.match(/^(.*)\/h2a-managed\/(\d+)\/images\/[0-9a-f]{64}\//);
  if (!npm && !managed) return undefined; // Unadopted development payload.
  const prefix = fs.realpathSync((npm ?? managed)[1]);
  const root = join(prefix, 'h2a-managed', String(process.getuid()));
  if (!fs.existsSync(root)) return undefined;
  privateDirectory(root);
  const record = readState(join(root, 'installation.json'), 'installation');
  if (!record) throw new Error('installation_incomplete');
  const installation = record.value;
  if (installation.canonicalPrefix !== prefix || installation.managedRoot !== root || installation.uid !== process.getuid() ||
    installation.prefixId !== digest({ canonicalPrefix: prefix, uid: process.getuid() })) throw new Error('foreign_installation_authority');
  return installation;
}
export function physicalPrefixForEntry(entry) {
  const absolute = fs.realpathSync(entry);
  const match = absolute.match(/^(.*)\/lib\/node_modules\/@sentropic\/h2a\/dist\/bin\.js$/) ??
    absolute.match(/^(.*)\/h2a-managed\/(\d+)\/images\/[0-9a-f]{64}\//);
  return match ? fs.realpathSync(match[1]) : undefined;
}
export function resolveSelectedEntry(installation) {
  if (installation.uid !== process.getuid() || fs.realpathSync(installation.canonicalPrefix) !== installation.canonicalPrefix ||
    installation.prefixId !== digest({ canonicalPrefix: installation.canonicalPrefix, uid: installation.uid })) throw new Error('foreign_installation_authority');
  let selection;
  try { selection = readState(join(installation.managedRoot, 'state', 'selected-build.json'), 'selection')?.value; }
  catch (cause) { throw new Error('selection_unreadable', { cause }); }
  if (!selection) throw new Error('selection_unreadable');
  if (selection.prefixId !== installation.prefixId || selection.canonicalPrefix !== installation.canonicalPrefix || selection.uid !== installation.uid) throw new Error('foreign_installation_authority');
  const imageRoot = join(installation.managedRoot, 'images', selection.manifestDigest.slice(7));
  privateDirectory(imageRoot);
  const manifestPath = join(imageRoot, 'manifest.json');
  if (!fs.lstatSync(manifestPath).isFile()) throw new Error('image_manifest_required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  verifyImage(imageRoot, manifest, selection.manifestDigest);
  if (manifest.buildId !== selection.buildId || manifest.packageVersion !== selection.packageVersion ||
    !Object.values(manifest.entrypoints).includes(selection.entrypoint) ||
    manifest.profile.nodeMajor !== Number(process.versions.node.split('.')[0]) || manifest.profile.nodeAbi !== process.versions.modules ||
    manifest.profile.arch !== process.arch || process.platform !== 'linux') throw new Error('selection_profile_mismatch');
  return { selection, manifest, imageRoot, entrypoint: resolve(imageRoot, selection.entrypoint) };
}
/** @param {*} options */
export function starterPlan({ installation, directory, kind, fallbackEntry, expectedReservation }) {
  if (!['shim', 'run', 'restore', 'auto-serve', 'explicit-serve', 'controller'].includes(kind)) throw new Error('starter_unknown');
  privateDirectory(directory);
  const pause = readState(join(directory, 'operator-stop.json'), 'pause')?.value.paused ?? false;
  if (pause && kind !== 'explicit-serve') throw new Error('deferred_paused');
  const selected = installation ? resolveSelectedEntry(installation) : { entrypoint: fs.realpathSync(fallbackEntry), selection: undefined,
    manifest: undefined, imageRoot: undefined };
  const control = readState(join(directory, 'component-control.json'), 'componentControl')?.value;
  let reservation;
  if (control?.activeTransaction) {
    reservation = readState(join(directory, control.activeTransaction), 'componentTransaction')?.value;
    if (!reservation) throw new Error('successor_reservation_missing');
    if (!['ABORTED', 'READY'].includes(reservation.state)) {
      if (reservation.state === 'SUCCESSOR_FAILED') throw new Error('successor_failed');
      if (!['STOP_COMMITTED', 'STOPPED', 'STARTING'].includes(reservation.state)) throw new Error('transaction_reserved');
      if (!selected.selection || selected.entrypoint !== reservation.target.entrypoint ||
        selected.selection.selectionEpoch !== reservation.successorReservation.selectionEpoch ||
        selected.selection.manifestDigest !== reservation.target.manifestDigest) throw new Error('successor_selection_mismatch');
      if (expectedReservation && (expectedReservation.handoverId !== reservation.handoverId ||
        expectedReservation.transactionEpoch !== reservation.transactionEpoch)) throw new Error('transaction_authority_mismatch');
    }
  }
  return { ...selected, reservation, transactionPath: control?.activeTransaction ? join(directory, control.activeTransaction) : null,
    requiresExplicitResume: pause && kind === 'explicit-serve' };
}

// QF B: npm owns its normal bin link; its router imports the protected selection
// in this same process. QF A's initial external launcher is provided by MH-L6.
export async function routeSelectedEntrypoint(entryUrl) {
  const entry = fileURLToPath(entryUrl), installation = installationForEntry(entry);
  if (!installation) return false;
  if (process.env.NODE_PATH || /(?:--require|--import|--loader|--experimental-loader)/.test(process.env.NODE_OPTIONS ?? '')) throw new Error('external_loader_unqualified');
  const current = resolveSelectedEntry(installation);
  const loaded = relative(current.imageRoot, fs.realpathSync(entry));
  await ensureManagedImageExecution(pathToFileURL(current.entrypoint));
  if (current.manifest.files.some(f => f.path === loaded && f.type === 'file')) return false;
  delete process.env.NODE_PATH;
  process.argv[1] = current.entrypoint;
  await import(pathToFileURL(current.entrypoint).href);
  return true;
}

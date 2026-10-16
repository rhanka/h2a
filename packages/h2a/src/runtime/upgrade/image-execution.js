import fs from 'node:fs';
import cp from 'node:child_process';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { privateDirectory, readState } from '../handover/state.js';
import { prefixLayout } from '../handover/authority.js';
import { installImagePolicy } from './image-policy.js';

const contextKey = Symbol.for('sentropic.h2a.image-context/v1');
const memory = /^--max-old-space-size=[0-9]+$/;
const inside = (root, path) => path === root || path.startsWith(root + sep);
export function imageExecutionContext() { return globalThis[contextKey]; }

export function verifyImageLoader(path, managedRoot, expectedDigest) {
  privateDirectory(managedRoot); privateDirectory(join(managedRoot, 'bootstrap'));
  const name = basename(path), match = /^image-loader-([0-9a-f]{64})\.mjs$/.exec(name);
  if (!match || path !== join(managedRoot, 'bootstrap', name) || fs.realpathSync(path) !== path) throw new Error('image_loader_location_invalid');
  const info = fs.lstatSync(path);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw new Error('image_loader_integrity');
  const actual = 'sha256:' + createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  if (actual !== 'sha256:' + match[1] || (expectedDigest && actual !== expectedDigest)) throw new Error('image_loader_integrity');
  return path;
}

function imageAt(managedRoot, file, base = process.cwd()) {
  let requested;
  try { requested = file instanceof URL || (typeof file === 'string' && file.startsWith('file:')) ? fileURLToPath(file) : resolve(base, file); }
  catch (error) { if (typeof file === 'string' && file.startsWith('file:')) return undefined; throw error; }
  const prefix = join(managedRoot, 'images') + sep;
  let path;
  try { path = fs.realpathSync(requested); }
  catch (error) {
    if (!requested.startsWith(prefix) && ['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'EINVAL'].includes(error.code)) return undefined;
    throw error;
  }
  if (!path.startsWith(prefix)) {
    if (requested.startsWith(prefix)) throw new Error('image_external_module');
    return undefined;
  }
  const hash = path.slice(prefix.length).split(sep)[0];
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('image_root_invalid');
  if (requested.startsWith(prefix) && requested.slice(prefix.length).split(sep)[0] !== hash) throw new Error('image_external_module');
  const root = join(managedRoot, 'images', hash);
  if (!inside(root, path)) throw new Error('image_external_module');
  return { root, manifestDigest: 'sha256:' + hash, entrypoint: path };
}

function cleanEnv(env = process.env) {
  const result = { ...env };
  const options = (result.NODE_OPTIONS ?? '').trim().split(/\s+/).filter(Boolean);
  if (options.some(option => !memory.test(option))) throw new Error('external_loader_unqualified');
  delete result.NODE_PATH;
  return result;
}

export function installImageExecutionPolicy(root, manifest, manifestDigest, loader) {
  const managedRoot = dirname(dirname(root));
  verifyImageLoader(loader, managedRoot);
  const previous = imageExecutionContext();
  if (previous) {
    if (previous.root !== root || previous.manifestDigest !== manifestDigest || previous.loader !== loader) throw new Error('image_context_conflict');
    return previous;
  }
  const preload = target => {
    verifyImageLoader(loader, managedRoot);
    const url = pathToFileURL(loader); url.searchParams.set('image', target.root);
    return '--import=' + url.href;
  };
  const ownImport = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'file:' && fileURLToPath(url) === loader;
    } catch { return false; }
  };
  const withoutOwnPreload = values => {
    const result = [];
    for (let i = 0; i < values.length; i++) {
      const arg = values[i];
      if (arg === '--import' && ownImport(values[i + 1])) { i++; continue; }
      if (arg.startsWith('--import=') && ownImport(arg.slice(9))) continue;
      result.push(arg);
    }
    return result;
  };
  const flags = values => {
    const result = withoutOwnPreload(values);
    if (result.some(arg => !memory.test(arg))) throw new Error('external_loader_unqualified');
    return result;
  };
  cleanEnv(); delete process.env.NODE_PATH;
  // The one authenticated preload may already be present in a child/worker.
  flags(process.execArgv);
  installImagePolicy(root, manifest, manifestDigest);
  const context = Object.freeze({ root, manifestDigest, loader });
  Object.defineProperty(globalThis, contextKey, { value: context, configurable: false, writable: false });

  const currentNode = fs.realpathSync(process.execPath);
  const qualifiedNode = (command, env) => {
    let path = command;
    if (!isAbsolute(path)) {
      path = (env.PATH ?? '').split(':').map(dir => join(dir, command)).find(candidate => {
        try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
      });
    }
    if (!path || fs.realpathSync(path) !== currentNode) throw new Error('image_child_runtime_unqualified');
  };
  const original = Object.fromEntries(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'].map(key => [key, cp[key]]));
  const nodeArgs = (command, args, options = {}) => {
    const cwd = options.cwd ? (options.cwd instanceof URL ? fileURLToPath(options.cwd) : resolve(options.cwd)) : process.cwd();
    let nodeCommand = ['node', 'nodejs'].includes(basename(command)) || command === process.execPath;
    if (!nodeCommand && isAbsolute(command)) {
      try { nodeCommand = fs.realpathSync(command) === currentNode; } catch { /* Original spawn diagnoses an unavailable external command. */ }
    }
    if (!nodeCommand) return { args, options };
    let first = -1;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--import') { index++; continue; }
      if (args[index] === '--') { first = index + 1; break; }
      if (!args[index].startsWith('-')) { first = index; break; }
    }
    if (first >= 0 && first < args.length) {
      const prefixFlags = args.slice(0, first).filter(arg => arg !== '--');
      const target = imageAt(managedRoot, args[first], cwd);
      if (target) {
        if (options.shell) throw new Error('image_child_entry_unqualified');
        const qualified = flags(prefixFlags), env = cleanEnv(options.env); qualifiedNode(command, env);
        // Once the script is known, subsequent argv are opaque application
        // data. Never resolve or inspect paths supplied there by a tool user.
        return { args: [...qualified, preload(target), target.entrypoint, ...args.slice(first + 1)], options: { ...options, env } };
      }
      let qualified = false;
      try { flags(prefixFlags); qualified = true; } catch { /* Ambiguous options are examined below. */ }
      if (qualified && !options.shell) return { args: [...withoutOwnPreload(args.slice(0, first)), ...args.slice(first)], options };
    }
    // An unknown option can consume the apparent script. Refuse ambiguous
    // shell/eval/loading forms when they refer to any physical image file.
    const referencesImage = args.some(arg => {
      if (typeof arg !== 'string') return false;
      const split = arg.startsWith('--') ? arg.indexOf('=') : -1;
      const value = split >= 0 ? arg.slice(split + 1) : arg;
      return inside(join(managedRoot, 'images'), resolve(cwd, value)) || imageAt(managedRoot, value, cwd);
    });
    if (referencesImage) throw new Error(options.shell ? 'image_child_entry_unqualified' : 'external_loader_unqualified');
    return { args, options };
  };
  for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    cp[key] = function(command, args, options, callback) {
      // Keep Node's overloads intact for external programs. Internal callers
      // use explicit argv; they cannot disguise image entry as shell/eval.
      if (!Array.isArray(args)) return original[key].apply(this, arguments);
      const planned = nodeArgs(command, args, typeof options === 'object' && options !== null ? options : {});
      const tail = typeof options === 'function' ? options : callback;
      return original[key].call(this, command, planned.args, planned.options, ...(tail ? [tail] : []));
    };
  }
  cp.fork = function(file, args, options) {
    if (!Array.isArray(args)) { options = args ?? {}; args = []; }
    options ??= {};
    const cwd = options.cwd ? (options.cwd instanceof URL ? fileURLToPath(options.cwd) : resolve(options.cwd)) : process.cwd();
    const target = imageAt(managedRoot, file, cwd);
    if (!target) {
      // External Node applications must not inherit an h2a image restriction.
      return original.fork.call(this, file, args, { ...options, execArgv: withoutOwnPreload(options.execArgv ?? process.execArgv) });
    }
    const env = cleanEnv(options.env); qualifiedNode(options.execPath ?? process.execPath, env);
    return original.fork.call(this, file, args, { ...options, env,
      execArgv: [...flags(options.execArgv ?? process.execArgv), preload(target)] });
  };
  const OriginalWorker = threads.Worker;
  threads.Worker = class ImageWorker extends OriginalWorker {
    constructor(file, options = {}) {
      if (options.eval || (file instanceof URL && file.protocol !== 'file:')) throw new Error('image_worker_entry_unqualified');
      const target = imageAt(managedRoot, file);
      if (!target) throw new Error('image_worker_entry_unqualified');
      const env = options.env === threads.SHARE_ENV ? options.env : cleanEnv(options.env);
      const workerFlags = flags(options.execArgv ?? process.execArgv);
      // Worker rejects V8 memory flags in explicit execArgv. Preserve their
      // qualified limit through the supported per-isolate option instead.
      const limit = workerFlags.at(-1)?.split('=')[1];
      const resourceLimits = { ...(limit ? { maxOldGenerationSizeMb: Number(limit) } : {}), ...options.resourceLimits };
      super(file, { ...options, env, resourceLimits, execArgv: [preload(target)] });
    }
  };
  syncBuiltinESMExports();
  return context;
}

// Invoked only by the builtin-only standalone preloader. No selection is
// inferred: an already-running process keeps its exact image across H4.
export function preloadImage(url) {
  const parsed = new URL(url), loader = fileURLToPath(parsed), managedRoot = dirname(dirname(loader));
  verifyImageLoader(loader, managedRoot);
  const installation = readState(join(managedRoot, 'installation.json'), 'installation')?.value;
  const physical = prefixLayout(dirname(dirname(managedRoot)), dirname(dirname(managedRoot)), process.getuid());
  if (!installation || ['prefixId', 'canonicalPrefix', 'uid', 'managedRoot'].some(key => installation[key] !== physical[key])) throw new Error('foreign_installation_authority');
  if ([...parsed.searchParams.keys()].join(',') !== 'image') throw new Error('image_loader_context_invalid');
  const root = parsed.searchParams.get('image');
  if (!root || root !== resolve(root)) throw new Error('image_root_invalid');
  const target = imageAt(managedRoot, root);
  if (!target || root !== target.root) throw new Error('image_root_invalid');
  const manifest = JSON.parse(fs.readFileSync(join(root, 'manifest.json'), 'utf8'));
  installImageExecutionPolicy(root, manifest, target.manifestDigest, loader);
}

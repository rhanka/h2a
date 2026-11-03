import fs from 'node:fs';
import Module from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyImage } from '../handover/image.js';
import { privateDirectory } from '../handover/state.js';

export function assertImageRuntime(manifest) {
  const glibc = process.report.getReport().header.glibcVersionRuntime;
  const libc = typeof glibc === 'string' ? /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(glibc) : null;
  if (typeof Module.registerHooks !== 'function' || process.platform !== 'linux' ||
    ![22, 24].includes(Number(process.versions.node.split('.')[0])) || !libc ||
    Number(libc[1]) < 2 || (Number(libc[1]) === 2 && Number(libc[2]) < 31) ||
    manifest.profile.nodeMajor !== Number(process.versions.node.split('.')[0]) || manifest.profile.nodeAbi !== process.versions.modules ||
    manifest.profile.arch !== process.arch || manifest.profile.libc !== 'glibc') throw new Error('image_loader_unqualified');
}

// This policy constrains one process. Worker/child entry coverage is a separate
// qualification; merely installing it in a parent does not guard descendants.
export function installImagePolicy(directory, manifest, manifestDigest) {
  const root = resolve(directory); privateDirectory(root);
  if (fs.realpathSync(root) !== root) throw new Error('image_root_invalid');
  const snapshot = structuredClone(manifest);
  assertImageRuntime(snapshot); verifyImage(root, snapshot, manifestDigest);
  const entries = new Map(snapshot.files.map(row => [row.path, row]));
  const inside = path => path === root || path.startsWith(root + sep);
  const fromUrl = url => { try { return url?.startsWith('file:') ? fileURLToPath(url) : null; } catch { return null; } };
  const inImage = url => { const path = fromUrl(url); return path !== null && inside(path); };
  const fail = reason => { const error = new Error(reason); error.code = 'ERR_IMAGE_MODULE'; throw error; };
  const bytesFor = requested => {
    const path = fs.realpathSync(requested);
    if (!inside(path)) fail('image_external_module');
    const row = entries.get(relative(root, path).split(sep).join('/'));
    if (!row || row.type !== 'file') fail('image_module_missing');
    const info = fs.lstatSync(path);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== row.mode) fail('image_module_integrity');
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      if (opened.dev !== info.dev || opened.ino !== info.ino || !opened.isFile() || opened.nlink !== 1 ||
        (opened.mode & 0o777) !== row.mode) fail('image_module_integrity');
      const bytes = fs.readFileSync(fd);
      if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== row.digest) fail('image_module_integrity');
      return bytes;
    } finally { fs.closeSync(fd); }
  };
  const metadataFor = file => {
    for (let cursor = dirname(file); inside(cursor); cursor = dirname(cursor)) {
      const path = join(cursor, 'package.json'), key = relative(root, path).split(sep).join('/');
      if (entries.has(key)) bytesFor(path);
      else if (fs.existsSync(path)) fail('image_module_integrity');
      if (cursor === root) break;
    }
  };
  const rootPackagePath = join(root, 'package.json');
  const rootParentURL = pathToFileURL(rootPackagePath).href;
  const rootName = entries.has('package.json') ? JSON.parse(bytesFor(rootPackagePath)).name : null;
  const rootRequire = typeof rootName === 'string' ? Module.createRequire(rootPackagePath) : null;
  const rootRequest = specifier => typeof rootName === 'string' && rootName.length > 0 &&
    !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') &&
    (specifier === rootName || specifier.startsWith(rootName + '/'));
  const resolveRoot = (specifier, context, nextResolve) => {
    metadataFor(rootPackagePath);
    // Node's own package self-reference resolver keeps exports/conditions. A
    // nested package does not normally inherit the enclosing root's scope.
    // CJS nextResolve captures its original parent in Node 22/24; changing only
    // parentURL does not retarget it. Use a real root require and keep its hooks.
    if (context.conditions?.includes('require')) return {
      url: pathToFileURL(rootRequire.resolve(specifier)).href, shortCircuit: true
    };
    return nextResolve(specifier, { ...context, parentURL: rootParentURL });
  };
  const hooks = Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromImage = inImage(context.parentURL);
      const bindRoot = fromImage && context.parentURL !== rootParentURL && rootRequest(specifier);
      if (fromImage) metadataFor(fromUrl(context.parentURL));
      let result;
      try {
        try { result = nextResolve(specifier, context); }
        catch (cause) {
          if (!bindRoot) throw cause;
          result = resolveRoot(specifier, context, nextResolve);
        }
        if (bindRoot && !result.url.startsWith('node:') && !inImage(result.url)) {
          result = resolveRoot(specifier, context, nextResolve);
        }
      }
      catch (cause) {
        if (!fromImage) throw cause;
        throw Object.assign(new Error('image_dependency_missing', { cause }), { code: cause.code });
      }
      if (result.url.startsWith('node:')) return result;
      // A createRequire base is supplied by its caller. Trusting that base as
      // provenance would permit image code to masquerade as an outside caller.
      if (!inImage(result.url)) fail('image_external_module');
      const path = fromUrl(result.url); bytesFor(path); metadataFor(path);
      return result;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      if (!inImage(url)) fail('image_external_module');
      const path = fromUrl(url); metadataFor(path);
      const result = nextLoad(url, context), bytes = bytesFor(path);
      // Execute these verified bytes rather than a second filesystem read.
      // Native addons retain Node's loader after the resolved file was checked.
      if (['module', 'commonjs', 'json'].includes(result.format)) return { ...result, source: bytes };
      return result;
    }
  });
  return Object.freeze({ root, manifestDigest, deregister() { hooks.deregister(); } });
}

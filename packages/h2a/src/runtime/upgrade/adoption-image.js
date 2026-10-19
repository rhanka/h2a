import fs from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { verifyImage } from '../handover/image.js';
import { digest } from '../handover/wire.js';
import { assertImageRuntime } from './image-policy.js';
import { assertBootstrapSessionUnchanged } from './bootstrap-session.js';

// Independent image preparation (§8.6.3–4): under the verified bootstrap
// session, check the staged image against its expected digest, verify the
// closed manifest and the qualified runtime profile, then move it
// atomically to its digest address. A differing occupant refuses;
// an identical occupant returns idempotently. Nothing is resolved from
// the mutable npm tree.
function syncDirectory(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function prepareAdoptionImage(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('adoption_image_invalid');
  const { session, stageDir, imagesDir, expectedDigest } = envelope;
  if (!session || typeof session !== 'object' || typeof stageDir !== 'string' || !isAbsolute(stageDir) ||
    typeof imagesDir !== 'string' || !isAbsolute(imagesDir) ||
    typeof expectedDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
    throw new Error('adoption_image_invalid');
  }
  let parent;
  try {
    if (!fs.lstatSync(stageDir).isDirectory() || !fs.lstatSync(imagesDir).isDirectory()) throw new Error('unusable');
    parent = imagesDir;
  } catch { throw new Error('adoption_image_invalid'); }
  assertBootstrapSessionUnchanged(session);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(join(stageDir, 'manifest.json'), 'utf8')); } catch { throw new Error('adoption_image_invalid'); }
  if (digest(manifest) !== expectedDigest) throw new Error('adoption_image_digest_mismatch');
  verifyImage(stageDir, manifest, expectedDigest);
  assertImageRuntime(manifest);
  const dest = join(imagesDir, expectedDigest.slice(7));
  let clash = false;
  try { if (fs.lstatSync(dest)) clash = true; } catch {}
  if (clash) {
    verifyImage(dest, manifest, expectedDigest);
    return Object.freeze({ manifestDigest: expectedDigest, imageDir: dest });
  }
  fs.renameSync(stageDir, dest);
  syncDirectory(parent);
  return Object.freeze({ manifestDigest: expectedDigest, imageDir: dest });
}

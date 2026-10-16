import { spawnSync } from 'node:child_process';
import { listDrumbeat } from '../dist/runtime/drumbeat/index.js';
export function ownedRecordSnapshot(root, instance) {
  const records = listDrumbeat(root);
  return { own: records.find(r => r.instance === instance), others: records.filter(r => r.instance !== instance) };
}
export function clearQualificationRecords({ root, instances, entrypoint, env, run = spawnSync }) {
  const before = listDrumbeat(root).filter(r => !instances.includes(r.instance));
  for (const instance of instances) {
    const child = run(process.execPath, [entrypoint, 'drumbeat', 'clear', '--instance', instance, '--root', root], { env, encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
    if (child.status !== 0) throw new Error('qualification drumbeat cleanup failed');
  }
  const after = listDrumbeat(root);
  if (after.some(r => instances.includes(r.instance)) || JSON.stringify(after) !== JSON.stringify(before)) throw new Error('qualification cleanup verification failed');
}

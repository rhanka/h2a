import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { json, readJson } from './support.mjs';

// During setup, cache registry traffic. Qualification then runs without a network namespace route.
export async function registry(lab, manifests, { offline = false, upgrade = false } = {}) {
  const cache = join(lab.root, 'registry-cache'); mkdirSync(cache, { recursive: true });
  const tarballs = new Map(manifests.map(m => [m.file, m]));
  const log = [];
  let address;
  const server = createServer(async (req, res) => {
    log.push({ method: req.method, url: req.url });
    try {
      const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
      if (tarballs.has(path)) { res.end(readFileSync(join(lab.root, 'tarballs', path))); return; }
      const candidates = manifests.filter(m => m.manifest.name === path);
      if (candidates.length) {
        const versions = Object.fromEntries(candidates.map(m => [m.manifest.version, {
          ...m.manifest, dist: { tarball: `${address}/${m.file}`, shasum: createHash('sha1').update(readFileSync(join(lab.root, 'tarballs', m.file))).digest('hex') },
        }]));
        const latest = candidates.find(m => m.upgrade === upgrade) ?? candidates[0];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: path, 'dist-tags': { latest: latest.manifest.version }, versions })); return;
      }
      const key = createHash('sha256').update(req.url).digest('hex');
      const metadata = join(cache, key + '.json'), body = join(cache, key + '.body');
      if (!existsSync(metadata)) {
        if (offline) throw new Error(`Uncached registry request: ${req.url}`);
        const upstream = await fetch('https://registry.npmjs.org' + req.url, { headers: { accept: req.headers.accept ?? '*/*' }, signal: AbortSignal.timeout(20000) });
        writeFileSync(body, Buffer.from(await upstream.arrayBuffer()));
        json(metadata, { status: upstream.status, contentType: upstream.headers.get('content-type') });
      }
      const info = readJson(metadata);
      res.statusCode = info.status;
      if (info.contentType) res.setHeader('content-type', info.contentType);
      // Keep npm's dependency downloads on the local proxy as well.
      if (info.contentType?.includes('json')) res.end(readFileSync(body, 'utf8').replaceAll('https://registry.npmjs.org', address));
      else res.end(readFileSync(body));
    } catch (error) {
      appendFileSync(join(lab.evidence, 'registry-errors.jsonl'), JSON.stringify({ url: req.url, error: error.message, cause: error.cause?.message }) + '\n');
      res.statusCode = 502; res.end(error.message);
    }
  });
  const port = offline ? readJson(join(lab.root, 'registry-port.json')).port : 0;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  address = `http://127.0.0.1:${server.address().port}`;
  if (!offline) json(join(lab.root, 'registry-port.json'), { port: server.address().port });
  lab.env.npm_config_registry = address;
  return { address, async close() { json(join(lab.evidence, `registry-${offline ? 'offline' : 'setup'}.json`), log); await new Promise(done => server.close(done)); } };
}

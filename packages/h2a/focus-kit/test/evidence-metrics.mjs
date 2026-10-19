import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { portable, isolatedEnvironment } from './evidence-harness.mjs';
import { digest } from './evidence-fixtures.mjs';

/** Only descend from the exact Chromium PID spawned here, never enumerate host processes. */
export function residentBytes(status, readStatm) {
  const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
  if (match) return Number(match[1]) * 1024;
  if (/^State:\s+Z\b/m.test(status)) return 0;
  // exit_mm can remove VmRSS before exit_notify changes the task state to Z.
  // statm is an independent observation of the same PID's empty address space.
  const fields = readStatm().trim().split(/\s+/);
  assert.ok(fields.length === 7 && fields.every(v => v === '0'), 'RSS instrumentation absent for owned process with no confirmed empty address space');
  return 0;
}
function ownedRss(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  let bytes = residentBytes(status, () => readFileSync(`/proc/${pid}/statm`, 'utf8'));
  if (bytes === 0) return 0;
  const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
  for (const child of children) try { bytes += ownedRss(child); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  return bytes;
}
const afterPaint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const domCounts = page => page.evaluate(() => ({ lines: document.querySelectorAll('.source-line').length,
  nodes: document.querySelector('[aria-label="Pièces justificatives"]')?.querySelectorAll('*').length ?? 0 }));

export async function measure(root, documents, { coldRuns, taskRuns, onSample = () => {}, onDom = () => {} }) {
  assert.equal(process.platform, 'linux', 'Whole Chromium tree RSS qualification requires Linux /proc');
  const server = await chromium.launchServer({ headless: true, env: isolatedEnvironment(root) });
  const browser = await chromium.connect(server.wsEndpoint()), pid = server.process().pid;
  let peak = 0, timer, instrumentationError;
  const result = { browser: browser.version(), artifacts: {}, metrics: {} };
  try {
    peak = ownedRss(pid);
    timer = setInterval(() => { try { peak = Math.max(peak, ownedRss(pid)); } catch (e) { instrumentationError = e; } }, 20);
    for (const [name, doc] of Object.entries(documents)) {
      const artifact = portable(root, doc), htmlBytes = artifact.html.length;
      result.artifacts[name] = { inputSha256: digest(readFileSync(artifact.input)), htmlSha256: digest(artifact.html), htmlBytes,
        evidenceBytes: doc.sources?.reduce((n, s) => n + s.size, 0) ?? 0, sources: doc.sources?.length ?? 0,
        lines: doc.sources?.filter(s => !s.mediaType.startsWith('image/')).map(s => ({ id: s.id, lines: Buffer.from(s.data, 'base64').toString('utf8').split(/\r\n|\r|\n/).length })) ?? [] };
      const stats = { cold: [], citation: [], search: [], dom: [], memory: {} };
      const recordDom = async page => { const value = await domCounts(page); stats.dom.push(value); onDom(value); };
      result.metrics[name] = stats;
      for (let i = 0; i < (name === 'doubled' ? 1 : coldRuns); i++) {
        const context = await browser.newContext({ offline: true, serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        const page = await context.newPage(), errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
        const before = performance.now(); await page.goto(artifact.url);
        await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 1500 });
        if (doc.schemaVersion === 2) await page.getByRole('heading', { name: 'Pièces justificatives', exact: true }).waitFor({ timeout: 1500 });
        await afterPaint(page); stats.cold.push(performance.now() - before);
        if (i === 0 && doc.schemaVersion === 2) {
          const session = await context.newCDPSession(page);
          await session.send('HeapProfiler.collectGarbage');
          stats.memory.initialRss = ownedRss(pid); stats.memory.initialHeap = (await session.send('Runtime.getHeapUsage')).usedSize;
          for (let j = 0; j < taskRuns; j++) {
            const id = name === 'large' && j % 2 ? 'real' : 'late', c = doc.citations.find(c => c.id === id);
            const opener = page.getByRole('region', { name: 'Pièces justificatives', exact: true }).getByRole('button', { name: c.label, exact: true }).first();
            const t = performance.now(); await opener.click();
            const panel = page.getByRole('region', { name: 'Source consultée', exact: true });
            await panel.locator(`[data-line="${c.locator.start}"]`).waitFor({ timeout: 1500 }); await afterPaint(page);
            stats.citation.push(performance.now() - t);
            const original = Buffer.from(doc.sources.find(s => s.id === c.sourceId).data, 'base64').toString('utf8').split(/\r\n|\r|\n/);
            assert.ok((await panel.locator(`[data-line="${c.locator.start}"]`).innerText()).endsWith(original[c.locator.start - 1] || ' '));
            await recordDom(page);
            const queries = id === 'real' ? ['h2a','import','absent-marker'] : ['Ligne 1 ','fin distante','café','preuve','absent-marker'];
            const query = queries[j % queries.length], expected = original.filter(l => l.toLocaleLowerCase().includes(query.toLocaleLowerCase())).length;
            const q = panel.getByRole('searchbox', { name: 'Rechercher dans toute la source' }), s = performance.now();
            await q.fill('obsolete-query'); await q.fill(query);
            await page.waitForFunction(count => document.querySelector('[data-search-status]')?.textContent === `${count} résultat(s)`, expected, { timeout: 1500 });
            await afterPaint(page); stats.search.push(performance.now() - s); await recordDom(page);
            await panel.locator('.source-scroll').evaluate(el => { el.scrollTop = el.scrollHeight / 2; }); await afterPaint(page);
            await recordDom(page);
            await panel.getByRole('button', { name: 'Retour au contexte' }).click(); await afterPaint(page); await recordDom(page);
          }
          await session.send('HeapProfiler.collectGarbage');
          stats.memory.retainedRss = ownedRss(pid); stats.memory.retainedHeap = (await session.send('Runtime.getHeapUsage')).usedSize;
          stats.memory.peakRss = peak;
          await session.detach();
        }
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        await context.close(); onSample({ name, sample: i + 1, coldMs: stats.cold.at(-1) });
      }
    }
    if (instrumentationError) result.instrumentationError = { message: instrumentationError.message };
    return result;
  } finally { clearInterval(timer); await browser.close(); await server.close(); }
}

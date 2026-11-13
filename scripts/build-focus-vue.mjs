/** Candidate packaging only. Hosted compilation is owned by cluster-mesh (L2). */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const kit = fileURLToPath(new URL('../packages/h2a/focus-kit/', import.meta.url));
const root = join(kit, 'vue');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => readFileSync(join(kit, name), 'utf8');
const inputs = ['vue/package.json', 'vue/package-lock.json', ...readdirSync(root).filter(n => /\.(vue|js)$/.test(n)).sort().map(n => `vue/${n}`),
  'src/style.css', 'src/evidence-search.js', '../../focus/src/render/presentation.ts', '../../focus/src/render/evidence.ts',
  '../../focus/src/validation/evidence-bytes.ts', '../../../scripts/build-focus-vue.mjs'];
const sources = () => Object.fromEntries(inputs.map(n => [n, hash(read(n))]));
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(read('renderer-vue-manifest.json'));
  if (manifest.backend !== 'vue' || manifest.html !== hash(read('renderer-vue.html')) || manifest.validator !== hash(read('validator.mjs')) ||
    JSON.stringify(manifest.sources) !== JSON.stringify(sources())) throw new Error('Vue portable assets are stale');
  console.log('Vue portable closure verified');
} else {
  // Reject the tempting older-package overrides: they omit mandatory host exports.
  for (const [name, version] of Object.entries({ vue: '3.6.0-rc.15', '@vue/compiler-sfc': '3.6.0-rc.15',
    '@sentropic/design-system-vue': '0.41.0-next.1', '@sentropic/diagram-canvas': '0.2.0', '@sentropic/design-system-themes': '0.14.0' })) {
    let installed;
    try { installed = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'))).version; } catch { /* Report the missing public package only. */ }
    if (installed !== version) throw new Error(`Vue dependency closure unavailable: requires ${name}@${version}`);
  }
  const { build } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')));
  const { default: vue } = await import(pathToFileURL(join(root, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
  const staging = mkdtempSync(join(tmpdir(), 'focus-vue-'));
  try {
    const result = await build({ root, configFile: false, plugins: [vue()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { dedupe: ['vue'] },
      build: { outDir: staging, emptyOutDir: true, target: 'es2022', minify: true, cssCodeSplit: false,
        lib: { entry: join(root, 'main.js'), name: 'FocusVue', formats: ['iife'], fileName: () => 'renderer.js' },
        rollupOptions: { output: { inlineDynamicImports: true } } } });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap(r => r.output).filter(o => o.type === 'chunk');
    if (chunks.some(c => c.imports.length || c.dynamicImports.length)) throw new Error('Vue export has external imports');
    const modules = chunks.flatMap(c => Object.entries(c.modules).filter(([, m]) => m.renderedLength).map(([id]) => id));
    if (modules.some(id => /svelte|xyflow|lucide-vue-next/.test(id))) throw new Error('Vue export contains an unqualified renderer dependency');
    const licenses = new Map();
    for (const id of modules) {
      if (!id.includes('/node_modules/')) continue;
      let directory = dirname(id.split('?')[0]);
      while (directory.includes('/node_modules/')) {
        try {
          const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
          const license = readdirSync(directory).find(n => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(n));
          licenses.set(`${pkg.name}@${pkg.version}`, license ? readFileSync(join(directory, license), 'utf8') : `License: ${pkg.license}`); break;
        } catch { directory = dirname(directory); }
      }
    }
    const css = readdirSync(staging).filter(n => n.endsWith('.css')).map(n => readFileSync(join(staging, n), 'utf8')).join('\n');
    const js = readFileSync(join(staging, 'renderer.js'), 'utf8');
    if (/@import\s|url\(["']?(?:https?:|\/|\.\/)/i.test(css) || /\beval\s*\(|\bnew Function\s*\(/.test(js)) throw new Error('Vue export is not an offline CSP closure');
    const notices = [...licenses].sort(([a], [b]) => a.localeCompare(b)).map(([name, license]) => `${name}\n${license}`).join('\n\n');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title><!--FOCUS_TITLE--></title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><!--FOCUS_PAYLOAD--><div id="app"></div><noscript>Activez JavaScript pour lire le dossier interactif.</noscript><script type="text/plain" data-focus-licenses>${notices.replace(/</g, '&lt;')}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
    const baseline = JSON.parse(read('renderer-manifest.json'));
    const manifest = { backend: 'vue', increment: baseline.increment, formats: baseline.formats, capabilities: baseline.capabilities,
      rendererVersion: baseline.rendererVersion, validatorVersion: baseline.validatorVersion, sources: sources(), html: hash(html), validator: hash(read('validator.mjs')),
      modules: modules.map(id => id.startsWith(root + '/') ? id.slice(root.length + 1) : id.startsWith(kit) ? id.slice(kit.length) : id.split('/packages/').at(-1)).sort(),
      packages: [...licenses.keys()].sort() };
    writeFileSync(join(kit, 'renderer-vue.html'), html);
    writeFileSync(join(kit, 'renderer-vue-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

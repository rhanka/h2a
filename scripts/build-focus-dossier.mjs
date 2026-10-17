/** Rebuild the shipped offline renderer, or check it without frontend dependencies. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const kit = fileURLToPath(new URL('../packages/h2a/focus-kit/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = ['package.json', 'package-lock.json', 'dossier.template.json', 'ecosystem.json',
  '../../../scripts/build-focus-dossier.mjs', '../../focus/schemas/decision-dossier-document.v1.schema.json',
  '../../focus/src/validation/index.ts', '../../focus/src/validation/readability.ts', '../../focus/src/model.ts',
  '../../focus/LICENSE',
  ...readdirSync(join(kit, 'src')).sort().map(n => `src/${n}`)];
const sources = () => Object.fromEntries(inputs.map(n => [n, digest(readFileSync(join(kit, n)))]));
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(join(kit, 'renderer-manifest.json'), 'utf8'));
  if (JSON.stringify(manifest.sources) !== JSON.stringify(sources()) || manifest.html !== digest(readFileSync(join(kit, 'renderer.html'))) ||
    manifest.validator !== digest(readFileSync(join(kit, 'validator.mjs'))) ||
    digest(readFileSync(join(kit, 'dossier.schema.json'))) !== digest(readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v1.schema.json')))) {
    throw new Error('Focus dossier renderer is stale: npm --prefix packages/h2a/focus-kit ci && node scripts/build-focus-dossier.mjs');
  }
  console.log('Focus dossier renderer sources and portable asset: verified');
} else {
  const { build } = await import(pathToFileURL(join(kit, 'node_modules/vite/dist/node/index.js')).href);
  const { svelte } = await import(pathToFileURL(join(kit, 'node_modules/@sveltejs/vite-plugin-svelte/src/index.js')).href);
  const { build: bundleValidator } = await import(pathToFileURL(join(kit, 'node_modules/esbuild/lib/main.js')).href);
  const staging = mkdtempSync(join(tmpdir(), 'focus-renderer-'));
  try {
    const result = await build({ configFile: false, root: kit, plugins: [svelte()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { dedupe: ['svelte'] },
      build: { outDir: staging, emptyOutDir: true, target: 'es2022', minify: true, cssCodeSplit: false,
        lib: { entry: join(kit, 'src/main.js'), name: 'FocusDossier', formats: ['iife'], fileName: () => 'renderer.js' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const css = readdirSync(staging).filter(n => n.endsWith('.css')).map(n => readFileSync(join(staging, n), 'utf8')).join('\n');
    const js = readFileSync(join(staging, 'renderer.js'), 'utf8');
    const notices = new Map();
    for (const chunk of (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output).filter(item => item.type === 'chunk')) {
      for (const [id, module] of Object.entries(chunk.modules)) {
        if (!module.renderedLength || !id.startsWith(join(kit, 'node_modules/'))) continue;
        let dir = dirname(id.split('?')[0]);
        while (dir.startsWith(join(kit, 'node_modules/'))) {
          try {
            const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
            if (pkg.name) {
              const license = readdirSync(dir).find(name => /^(?:LICENSE|LICENCE|COPYING)(?:\.|$)/i.test(name));
              notices.set(`${pkg.name}@${pkg.version}`, license ? readFileSync(join(dir, license), 'utf8') : `License: ${pkg.license ?? 'see package metadata'}`);
              break;
            }
          } catch { /* A module subdirectory; keep walking within node_modules. */ }
          dir = dirname(dir);
        }
      }
    }
    const licenseText = [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([name, license]) => `${name}\n${license}`).join('\n\n');
    if (/@import\s|url\(["']?(?:https?:|\/|\.\/)/i.test(css)) throw new Error('Renderer CSS has external assets');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title><!--FOCUS_TITLE--></title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><!--FOCUS_PAYLOAD--><div id="app"></div><noscript>Activez JavaScript pour lire le dossier interactif.</noscript><script type="text/plain" data-focus-licenses>${licenseText.replace(/</g, '&lt;')}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
    writeFileSync(join(kit, 'renderer.html'), html);
    await bundleValidator({ entryPoints: [join(kit, '../../focus/src/validation/index.ts')], bundle: true,
      platform: 'node', target: 'node22', format: 'esm', outfile: join(kit, 'validator.mjs'),
      banner: { js: `/*!\n${readFileSync(join(kit, '../../focus/LICENSE'), 'utf8')}\n*/` } });
    writeFileSync(join(kit, 'dossier.schema.json'), readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v1.schema.json')));
    writeFileSync(join(kit, 'renderer-manifest.json'), JSON.stringify({ sources: sources(), html: digest(html), validator: digest(readFileSync(join(kit, 'validator.mjs'))) }, null, 2) + '\n');
    console.log(`Portable Focus renderer: ${html.length} bytes`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

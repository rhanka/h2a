/** Rebuild the shipped offline renderer, or check it without frontend dependencies. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const kit = fileURLToPath(new URL('../packages/h2a/focus-kit/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = ['package.json', 'package-lock.json', 'dossier.template.json', 'ecosystem.json',
  'dossier.evidence.template.json', '../../focus/schemas/decision-dossier-document.v2.schema.json',
  ...readdirSync(join(kit, '../../focus/src/validation')).filter(n => n.startsWith('evidence')).sort().map(n => `../../focus/src/validation/${n}`),
  '../../focus/src/render/evidence.ts', '../../focus/schemas/report-document.v1.schema.json',
  '../../../scripts/build-focus-dossier.mjs', '../../focus/schemas/decision-dossier-document.v1.schema.json',
  '../../focus/src/validation/index.ts', '../../focus/src/validation/readability.ts', '../../focus/src/model.ts',
  '../../focus/src/render/presentation.ts',
  '../../focus/src/render/markdown-table.ts',
  '../../focus-interactive/src/response-line.ts',
  '../../focus/LICENSE',
  ...readdirSync(join(kit, 'src')).sort().map(n => `src/${n}`)];
const sources = () => Object.fromEntries(inputs.map(n => [n, digest(readFileSync(join(kit, n)))]));
/** Third-party notices of the bundled modules that come from the kit's node_modules, by package. */
const noticesOf = (moduleIds) => {
  const notices = new Map();
  for (const id of moduleIds) {
    if (!id.startsWith(join(kit, 'node_modules/'))) continue;
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
  return [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([name, license]) => `${name}\n${license}`).join('\n\n');
};
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(join(kit, 'renderer-manifest.json'), 'utf8'));
  if (digest(readFileSync(join(kit, 'report.schema.json'))) !== digest(readFileSync(join(kit, '../../focus/schemas/report-document.v1.schema.json'))) ||
    JSON.stringify(manifest.sources) !== JSON.stringify(sources()) || manifest.html !== digest(readFileSync(join(kit, 'renderer.html'))) ||
    manifest.validator !== digest(readFileSync(join(kit, 'validator.mjs'))) ||
    manifest.diagramViews !== digest(readFileSync(join(kit, 'diagram-views.mjs'))) ||
    digest(readFileSync(join(kit, 'dossier.schema.json'))) !== digest(readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v1.schema.json'))) ||
    digest(readFileSync(join(kit, 'dossier.v2.schema.json'))) !== digest(readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v2.schema.json')))) {
    throw new Error('Focus dossier renderer is stale: npm --prefix packages/h2a/focus-kit ci && node scripts/build-focus-dossier.mjs');
  }
  console.log('Focus dossier renderer sources and portable asset: verified');
} else {
  const { build } = await import(pathToFileURL(join(kit, 'node_modules/vite/dist/node/index.js')).href);
  const { svelte } = await import(pathToFileURL(join(kit, 'node_modules/@sveltejs/vite-plugin-svelte/src/index.js')).href);
  const { build: bundleWithEsbuild } = await import(pathToFileURL(join(kit, 'node_modules/esbuild/lib/main.js')).href);
  const staging = mkdtempSync(join(tmpdir(), 'focus-renderer-'));
  try {
    const result = await build({ configFile: false, envDir: false, root: kit, plugins: [svelte()],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { dedupe: ['svelte'] },
      build: { outDir: staging, emptyOutDir: true, target: 'es2022', minify: true, cssCodeSplit: false,
        lib: { entry: join(kit, 'src/main.js'), name: 'FocusDossier', formats: ['iife'], fileName: () => 'renderer.js' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const css = readdirSync(staging).filter(n => n.endsWith('.css')).map(n => readFileSync(join(staging, n), 'utf8')).join('\n');
    const js = readFileSync(join(staging, 'renderer.js'), 'utf8');
    const licenseText = noticesOf((Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output)
      .filter(item => item.type === 'chunk')
      .flatMap(chunk => Object.entries(chunk.modules).filter(([, module]) => module.renderedLength).map(([id]) => id)));
    if (/@import\s|url\(["']?(?:https?:|\/|\.\/)/i.test(css)) throw new Error('Renderer CSS has external assets');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title><!--FOCUS_TITLE--></title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><!--FOCUS_PAYLOAD--><div id="app"></div><noscript>Activez JavaScript pour lire le dossier interactif.</noscript><script type="text/plain" data-focus-licenses>${licenseText.replace(/</g, '&lt;')}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>\n`;
    writeFileSync(join(kit, 'renderer.html'), html);
    await bundleWithEsbuild({ entryPoints: [join(kit, '../../focus/src/validation/index.ts')], bundle: true,
      platform: 'node', target: 'node22', format: 'esm', absWorkingDir: kit, outfile: join(kit, 'validator.mjs'),
      banner: { js: `/*!\n${readFileSync(join(kit, '../../focus/LICENSE'), 'utf8')}\n*/` } });
    // The build-time DC-1 views ship self-contained: the pure design-system card/zone renderers are
    // bundled from the kit's single DS pin (the one the renderer bundles), so the published CLI
    // installs no frontend package. Any other module in that graph (Svelte, editors) fails the build.
    const mustReplace = (src, target, replacement, label) => {
      const next = src.replace(target, replacement);
      if (next === src) throw new Error(`build-focus-dossier patch mismatch (${label})`);
      return next;
    };
    const optimizeDiagramRouterPlugin = {
      name: 'h2a-bound-diagram-routing',
      setup(buildApi) {
        buildApi.onLoad({ filter: /[\\/]@sentropic[\\/]diagram-core[\\/]dist[\\/]sha256\.js$/ }, (args) => {
          let src = readFileSync(args.path, 'utf8');
          src = mustReplace(
            src,
            'export function sha256Hex(text) {',
            'const _nodeCrypto = typeof globalThis.process?.getBuiltinModule === "function" ? globalThis.process.getBuiltinModule("node:crypto") : undefined;\nexport function sha256Hex(text) {\n    if (_nodeCrypto !== undefined) return _nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");',
            'sha256Hex'
          );
          return { contents: src, loader: 'js' };
        });
        buildApi.onLoad({ filter: /[\\/]@sentropic[\\/]diagram-canvas[\\/]dist[\\/]layout[\\/]route\.js$/ }, (args) => {
          let src = readFileSync(args.path, 'utf8');
          src = mustReplace(
            src,
            '    for (const y of input.ys) {\n        tryRoute([{ x: s.x, y }, { x: t.x, y }]);\n        for (const x of input.xs) {\n            tryRoute([{ x, y: s.y }, { x, y }, { x: t.x, y }]);\n            tryRoute([{ x: s.x, y }, { x, y }, { x, y: t.y }]);\n        }\n    }',
            '    let detourYs = input.ys;\n    let detourXs = input.xs;\n    if (detourYs.length * detourXs.length > 144) {\n        const midY = (s.y + t.y) / 2;\n        const midX = (s.x + t.x) / 2;\n        if (detourYs.length > 12) detourYs = [...detourYs].sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY)).slice(0, 12);\n        if (detourXs.length > 12) detourXs = [...detourXs].sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX)).slice(0, 12);\n    }\n    let detourAttempts = 0;\n    const detourCap = input.ys.length * input.xs.length > 144 ? 256 : Number.POSITIVE_INFINITY;\n    for (const y of detourYs) {\n        tryRoute([{ x: s.x, y }, { x: t.x, y }]);\n        if (++detourAttempts >= detourCap) break;\n        for (const x of detourXs) {\n            tryRoute([{ x, y: s.y }, { x, y }, { x: t.x, y }]);\n            tryRoute([{ x: s.x, y }, { x, y }, { x, y: t.y }]);\n            detourAttempts += 2;\n            if (detourAttempts >= detourCap) break;\n        }\n        if (detourAttempts >= detourCap) break;\n    }',
            'labelDetour'
          );
          src = mustReplace(
            src,
            '                if (isCorridor && span <= 300) {\n                    tracks.push(...subdivideChannelTracks(low, high, routeSpacing));\n                }',
            '                if (isCorridor && span <= 300) {\n                    const effSpacing = (grown.length > 20 || requests.length > 24) ? Math.max(routeSpacing, span / 4) : routeSpacing;\n                    tracks.push(...subdivideChannelTracks(low, high, effSpacing));\n                }',
            'withChannels'
          );
          src = mustReplace(
            src,
            '        const earlier = pairFull.get(request.pairKey) ?? [];\n        const hasSamePair = earlier.length > 0;',
            '        const earlier = pairFull.get(request.pairKey) ?? [];\n        const hasSamePair = earlier.length > 0;\n        const pairH = [];\n        const pairV = [];\n        if (hasSamePair) {\n            for (const er of earlier) {\n                for (let ej = 1; ej < er.length; ej += 1) {\n                    const p1 = er[ej - 1], p2 = er[ej];\n                    if (p1.y === p2.y && p1.x !== p2.x) pairH.push(p1.y, Math.min(p1.x, p2.x), Math.max(p1.x, p2.x));\n                    else if (p1.x === p2.x && p1.y !== p2.y) pairV.push(p1.x, Math.min(p1.y, p2.y), Math.max(p1.y, p2.y));\n                }\n            }\n        }\n        const fastPairBlocks = (a1, a2) => {\n            if (a1.x === a2.x && a1.y === a2.y) return false;\n            if (a1.y === a2.y) {\n                const y = a1.y, lo = Math.min(a1.x, a2.x), hi = Math.max(a1.x, a2.x);\n                for (let k = 0; k < pairH.length; k += 3) {\n                    if (pairH[k] === y && Math.min(hi, pairH[k + 2]) - Math.max(lo, pairH[k + 1]) > 0) return true;\n                }\n                for (let k = 0; k < pairV.length; k += 3) {\n                    const x = pairV[k];\n                    if (x > lo && x < hi && y > pairV[k + 1] && y < pairV[k + 2]) return true;\n                }\n            } else if (a1.x === a2.x) {\n                const x = a1.x, lo = Math.min(a1.y, a2.y), hi = Math.max(a1.y, a2.y);\n                for (let k = 0; k < pairV.length; k += 3) {\n                    if (pairV[k] === x && Math.min(hi, pairV[k + 2]) - Math.max(lo, pairV[k + 1]) > 0) return true;\n                }\n                for (let k = 0; k < pairH.length; k += 3) {\n                    const y = pairH[k];\n                    if (y > lo && y < hi && x > pairH[k + 1] && x < pairH[k + 2]) return true;\n                }\n            }\n            return false;\n        };',
            'pairIndex'
          );
          src = mustReplace(
            src,
            '                if (strictSpacing && ++pops > 24000)\n                    break;',
            '                const maxPops = strictSpacing ? 24000 : (orderedRequests.length > 20 ? 6000 : 12000);\n                if (++pops > maxPops)\n                    break;',
            'maxPops'
          );
          src = mustReplace(
            src,
            '                        if (crossesSamePair(a1, a2, earlier) || sharesSamePair(a1, a2, earlier))\n                            continue;',
            '                        if (fastPairBlocks(a1, a2))\n                            continue;',
            'fastPairBlocks'
          );
          src = mustReplace(
            src,
            '                    if (strictSpacing && nb + hb > 12)\n                        continue;',
            '                    const maxBends = strictSpacing ? 12 : (orderedRequests.length > 20 ? 14 : 18);\n                    if (nb + hb > maxBends)\n                        continue;',
            'maxBends'
          );
          return { contents: src, loader: 'js' };
        });
        buildApi.onLoad({ filter: /[\\/]@sentropic[\\/]diagram-canvas[\\/]dist[\\/]layout[\\/]measured\.js$/ }, (args) => {
          let src = readFileSync(args.path, 'utf8');
          src = mustReplace(
            src,
            '                const maxStage2Calls = rects.size > 25 ? 6 : 18;',
            '                const maxStage2Calls = plan === undefined ? (rects.size > 25 ? 4 : 12) : (rects.size > 25 ? 2 : 4);',
            'maxStage2Calls'
          );
          src = mustReplace(
            src,
            '        for (const entry of entries) {',
            '        let redockLabelBudget = drawnEdges.length > 18 ? 6 : Number.POSITIVE_INFINITY;\n        for (const entry of entries) {',
            'redockBudget'
          );
          src = mustReplace(
            src,
            '                if (choice === undefined && edge.source.entity !== edge.target.entity && !sharesPort',
            '                if (choice === undefined && redockLabelBudget > 0 && edge.source.entity !== edge.target.entity && !sharesPort',
            'redockBudgetGuard'
          );
          src = mustReplace(
            src,
            '                    for (const [source, target] of facePairs) {',
            '                    redockLabelBudget -= 1;\n                    const activeFacePairs = drawnEdges.length > 18 ? facePairs.slice(0, 6) : facePairs;\n                    for (const [source, target] of activeFacePairs) {',
            'activeFacePairs'
          );
          src = mustReplace(
            src,
            '    for (let round = 0; round < 24 && (outcome.requested.size > 0 || outcome.unused.length > 0); round += 1) {',
            '    let stagnantRounds = 0;\n    let prevDemand = outcome.requested.size + outcome.unused.length;\n    for (let round = 0; round < 24 && (outcome.requested.size > 0 || outcome.unused.length > 0); round += 1) {',
            'stagnantInit'
          );
          src = mustReplace(
            src,
            '        previous = outcome;\n        outcome = runPass({ frozen, widen, external });\n    }',
            '        previous = outcome;\n        outcome = runPass({ frozen, widen, external });\n        const curDemand = outcome.requested.size + outcome.unused.length;\n        stagnantRounds = curDemand >= prevDemand ? stagnantRounds + 1 : 0;\n        prevDemand = curDemand;\n        if (drawnEdges.length >= 18 && (stagnantRounds >= 2 || round >= 7)) break;\n    }',
            'stagnantBreak'
          );
          return { contents: src, loader: 'js' };
        });
      },
    };
    const views = await bundleWithEsbuild({ entryPoints: [join(kit, 'src/diagram-model.js')], bundle: true,
      minify: true,
      // Preserve `\n` escapes in string constants (e.g. PINNED_ADAPTER_BYTES) so static import scans do not match string contents.
      supported: { 'template-literal': false },
      plugins: [optimizeDiagramRouterPlugin],
      platform: 'node', target: 'node22', format: 'esm', absWorkingDir: kit, metafile: true, write: false,
      outfile: join(kit, 'diagram-views.mjs') });
    const viewInputs = Object.keys(views.metafile.inputs);
    const foreign = viewInputs.filter(input => !/^(?:ecosystem\.json|src\/(?:diagram-model|ds-diagram-bridge)\.js|node_modules\/@sentropic\/(?:diagram-canvas|diagram-core)\/dist\/[\w./-]+\.js)$/.test(input));
    if (foreign.length) throw new Error(`diagram-views.mjs bundles only the pure DS diagram bridge and canvas/core modules; refused inputs: ${foreign.join(', ')}`);
    const viewsBanner = `${readFileSync(join(kit, '../../../LICENSE'), 'utf8')}\nBundled third-party code:\n\n${noticesOf(viewInputs.map(input => join(kit, input)))}\n`;
    if (viewsBanner.includes('*/')) throw new Error('A bundled notice would close the diagram-views.mjs banner');
    writeFileSync(join(kit, 'diagram-views.mjs'), `/*!\n${viewsBanner}*/\n${views.outputFiles[0].text}`);
    writeFileSync(join(kit, 'dossier.schema.json'), readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v1.schema.json')));
    writeFileSync(join(kit, 'dossier.v2.schema.json'), readFileSync(join(kit, '../../focus/schemas/decision-dossier-document.v2.schema.json')));
    writeFileSync(join(kit, 'report.schema.json'), readFileSync(join(kit, '../../focus/schemas/report-document.v1.schema.json')));
    writeFileSync(join(kit, 'renderer-manifest.json'), JSON.stringify({ increment: 'H1', formats: [1, 2],
      capabilities: ['report', 'embedded-offline', 'evidence-citations', 'evidence-search', 'evidence-download', 'evidence-annexes'],
      rendererVersion: JSON.parse(readFileSync(join(kit, '../package.json'))).version,
      validatorVersion: JSON.parse(readFileSync(join(kit, '../../focus/package.json'))).version,
      sources: sources(), html: digest(html), validator: digest(readFileSync(join(kit, 'validator.mjs'))),
      diagramViews: digest(readFileSync(join(kit, 'diagram-views.mjs'))) }, null, 2) + '\n');
    console.log(`Portable Focus renderer: ${html.length} bytes`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

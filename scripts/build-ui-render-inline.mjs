/** DS §8.3 pilot derivatives. Original vendored bytes remain untouched. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadUiRenderAssetsSync } from "../packages/h2a/dist/runtime/mcp/ui-render/assets.js";

const assets = loadUiRenderAssetsSync();
const browser = new URL("dist/browser/", assets.vendorDir);
const output = new URL("../packages/h2a/vendor/ui-render-inline/", import.meta.url);
const check = process.argv.includes("--check");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = { sourceCommit: assets.manifest.sourceCommit,
  sourceManifestSha256: hash(JSON.stringify(assets.manifest)),
  bundler: "esbuild@0.27.7", modulePreload: false, files: {} };
function emit(name, text) {
  if (check) {
    if (readFileSync(new URL(name, output), "utf8") !== text) throw new Error(`stale inline artifact: ${name}`);
  } else {
    mkdirSync(output, { recursive: true });
    writeFileSync(new URL(name, output), text);
  }
}
for (const component of ["render", "BarChart", "BpmnCanvas", "DecisionDossier"]) {
  const result = await build({
    entryPoints: [new URL("elements.js", browser).pathname],
    bundle: true, splitting: false, format: "esm", minify: true,
    write: false, metafile: true, legalComments: "none",
    plugins: [{ name: "requested-component", setup(builder) {
      builder.onLoad({ filter: /elements\.js$/ }, ({ path }) => {
        let contents = readFileSync(path, "utf8");
        // Keep both theme closures. Only an unrelated component engine is
        // unavailable in a per-component entry; never cut its own closure.
        for (const [name, prefix] of [["BpmnCanvas", "bpmn-canvas"], ["DecisionDossier", "focus-renderer"]]) {
          if (component !== "render" && component !== name) {
            contents = contents.replace(/import\(`([^`]+)`\)/g, (match, specifier) =>
              specifier.startsWith(`./chunks/${prefix}-`)
                ? 'Promise.reject(new Error("engine not included in this per-component resource"))' : match);
          }
        }
        return { contents, loader: "js" };
      });
    } }]
  });
  const text = result.outputFiles[0].text;
  const inputs = Object.keys(result.metafile.inputs).map(path => {
    const relative = path.slice(path.indexOf("dist/browser/"));
    if (!assets.manifest.files[relative]) throw new Error(`unverified bundle input: ${path}`);
    return relative;
  }).sort();
  manifest.files[`${component}.js`] = { sha256: hash(text), rawBytes: Buffer.byteLength(text), inputs };
  emit(`${component}.js`, text);
  console.log(`${component}: ${Buffer.byteLength(text)} bytes, ${inputs.length} verified modules`);
}
emit("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

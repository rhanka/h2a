// Read the rejected product modules directly from Git; no checkout or owner state.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const repo = path.resolve(import.meta.dirname, '../..'), directory = repo+'/.qual-tmp/red';
fs.mkdirSync(directory,{recursive:true});
const sha = execFileSync('git',['rev-parse','8b3a5a16'],{cwd:repo,encoding:'utf8'}).trim();
for (const [relative, name] of [
  ['packages/h2a-runtime/src/claude-native-driver.ts','claude-native-driver'],
  ['packages/h2a-runtime/src/launch-capacity.ts','launch-capacity'],
  ['packages/h2a/src/runtime/mcp/agent-launch.ts','agent-launch'],
]) {
  const source=execFileSync('git',['show',sha+':'+relative],{cwd:repo,encoding:'utf8'});
  let output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const built=path.dirname(repo+'/'+relative.replace('/src/','/dist/'));
  output=output.replace(/from "(\.\.?\/[^\"]+)"/g,(_match,module)=>'from '+JSON.stringify(path.resolve(built,module)));
  fs.writeFileSync(directory+'/'+name+'.mjs',output);
}
fs.writeFileSync(directory+'/source-sha.txt',sha+'\n');
console.log(JSON.stringify({sha,directory}));

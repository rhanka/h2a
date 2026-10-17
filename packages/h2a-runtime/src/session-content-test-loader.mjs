// Source-worker tests only. Built JS workers use normal Node resolution and no loader.
// The TypeScript JS API keeps these tests free of compiler subprocesses, including
// distribution builds of Node that omit the optional built-in TypeScript support.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
const directory=new URL('./',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.startsWith(directory)&&specifier.startsWith('./')&&specifier.endsWith('.js')) {
    const source=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
    if(!existsSync(new URL(specifier,context.parentURL))&&existsSync(source))return next(source.href,context);
  }
  return next(specifier,context);
},load(url,context,next){
  if(url.startsWith(directory)&&url.endsWith('.ts'))return {format:'module',shortCircuit:true,
    source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
  return next(url,context);
}});

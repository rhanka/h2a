import { runMcpStdio } from '../../dist/runtime/mcp/stdio.js';
const root=process.argv[2];
await runMcpStdio({root,workspaceRoot:root,stdin:process.stdin,stdout:process.stdout,stderr:process.stderr,
 identityActivation:{buildAutoOpen:identity=>({instance:identity.instance,host:identity.host,name:identity.name})},
 identityRequest:{root,cwd:root,host:'claude',name:'incident',providerEnv:{CLAUDE_CODE_SESSION_ID:'stdio-incident'}}});

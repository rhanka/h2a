import { handleH2aRun } from '../../packages/h2a/dist/runtime/mcp/agent-launch.js';
let input = '';
for await (const data of process.stdin) input += data;
const args = JSON.parse(input);
const result = await handleH2aRun(args, args.workspace);
process.stdout.write(JSON.stringify(result)+'\n');
if (result.state !== 'started') process.exitCode = 1;

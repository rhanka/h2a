#!/usr/bin/env node
// A strict, local gh adapter: unsupported PR JSON fields are errors, as in gh itself.
const args = process.argv.slice(2);
const endpoint = process.env.OWNER_LAB_GITHUB;
if (!endpoint?.startsWith('http://127.0.0.1:')) throw new Error('Private GitHub API required');
const value = (...flags) => { const i = args.findIndex(a => flags.includes(a)); return i >= 0 ? args[i + 1] : undefined; };
function reject(message) { console.error(message); process.exit(2); }
if (args[0] === 'pr') {
  const repo = value('--repo', '-R');
  if (repo && !['fixture/own', 'github.com/fixture/own'].includes(repo)) reject('Unknown fixture repository');
  const number = args[2]?.startsWith('-') ? undefined : args[2];
  if (number && number !== '42') reject('Unknown fixture pull request');
}
async function request(path, method = 'GET') {
  const r = await fetch(endpoint + '/' + path.replace(/^\//, ''), { method });
  const body = await r.text();
  if (!r.ok) { console.error(body); process.exit(1); }
  const jq = value('--jq', '-q');
  if (jq) {
    if (!/^\.[A-Za-z]+(?:\.[A-Za-z]+)*$/.test(jq)) reject('Unsupported fixture jq expression');
    const selected = jq.slice(1).split('.').reduce((o, k) => o?.[k], JSON.parse(body));
    if (selected === undefined) reject('Missing fixture jq field');
    process.stdout.write(typeof selected === 'string' ? selected : JSON.stringify(selected));
  } else process.stdout.write(body);
}
if (args[0] === 'api') {
  const path = args.slice(1).find(a => /^\/?repos\//.test(a));
  if (!path || !/^\/?repos\/fixture\/own\/(pulls\/42|contents\/package.json(?:\?ref=[a-f0-9]{40,64})?)$/.test(path)) reject('Unknown fixture REST endpoint');
  if (value('--hostname') && value('--hostname') !== 'github.com') reject('Unknown fixture hostname');
  if (value('--method', '-X') && value('--method', '-X') !== 'GET') reject('Unsupported fixture REST method');
  await request(path);
} else if (args[0] === 'pr' && args[1] === 'diff') await request('repos/fixture/own/pulls/42.diff');
else if (args[0] === 'pr' && args[1] === 'view') {
  const fields = args[args.indexOf('--json') + 1]?.split(',') ?? [];
  const allowed = ['number', 'headRefOid', 'baseRefName', 'headRefName', 'url'];
  if (fields.some(f => !allowed.includes(f))) { console.error('Unknown JSON field: ' + fields.find(f => !allowed.includes(f))); process.exit(1); }
  await request('repos/fixture/own/pulls/42.view');
} else if (args[0] === 'pr' && args[1] === 'merge') await request('repos/fixture/own/pulls/42/merge', 'PUT');
else { console.error('Unsupported fake gh invocation: ' + JSON.stringify(args)); process.exit(2); }

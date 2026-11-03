// Common `h2a upgrade` command parsing and exit codes (F, spec section 8.1):
// `parseUpgradeCommand` turns an argv tail (after `h2a upgrade`) into a
// frozen execution intent without executing anything, and `upgradeExitCode`
// maps a structured outcome to the 0/1/2 contract. Unknown or misplaced
// flags, missing identities and unknown components are usage errors; a real
// failure (even beside a completed selection, e.g. SUCCESSOR_FAILED) always
// exits 1, never 0.
const ACTIONS = ['run', 'check', 'status', 'resume', 'abort', 'compensate', 'unmanage', 'help'];
const COMPONENTS = ['mcp', 'gateway'];
const FLAG_SUPPORT = {
  run: ['to', 'dryRun', 'json', 'strict'],
  check: ['json'],
  status: ['json'],
  resume: ['json', 'strict'],
  abort: ['json'],
  compensate: ['json', 'strict', 'component'],
  unmanage: ['dryRun', 'json'],
  help: [],
};
const invalid = () => { throw new Error('upgrade_cli_invalid'); };
const usage = detail => { throw new Error(`upgrade_cli_usage:${detail}`); };
const blank = action => ({ action, upgradeId: null, component: null, to: null, dryRun: false, json: false, strict: false });

export function parseUpgradeCommand(argv = []) {
  if (!Array.isArray(argv) || argv.some(token => typeof token !== 'string')) invalid();
  if (argv.length && ['help', '-h', '--help'].includes(argv[0])) {
    if (argv.length !== 1) usage('help_takes_no_arguments');
    return Object.freeze(blank('help'));
  }
  const [head, ...rest] = argv;
  const action = head === undefined || head.startsWith('-') && head !== '--check' ? 'run' :
    head === '--check' ? 'check' : (ACTIONS.includes(head) && head !== 'run' ? head : null);
  if (action === null) usage('unknown_action');
  const intent = blank(action);
  const supported = FLAG_SUPPORT[action];
  const tokens = action === 'run' && head !== undefined ? argv : rest;
  const seen = new Set();
  const take = (flag, value) => {
    if (!supported.includes(flag) || seen.has(flag)) usage(`${flag}_not_supported`);
    seen.add(flag);
    return value;
  };
  let positional = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--json') { intent.json = take('json', true); continue; }
    if (token === '--strict') { intent.strict = take('strict', true); continue; }
    if (token === '--dry-run') { intent.dryRun = take('dryRun', true); continue; }
    if (token === '--to' || token === '--component') {
      const flag = token === '--to' ? 'to' : 'component', value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) usage(`${flag}_requires_value`);
      index += 1;
      if (flag === 'to') intent.to = take('to', value);
      else intent.component = take('component', value);
      continue;
    }
    if (token.startsWith('-')) usage('unknown_flag');
    if (positional !== null) usage('unexpected_argument');
    positional = token;
  }
  if (['resume', 'abort', 'compensate'].includes(action) && (positional === null || positional === '')) usage('upgrade_id_required');
  if (!['resume', 'abort', 'compensate'].includes(action) && positional !== null) usage('unexpected_argument');
  if (action === 'compensate') {
    if (intent.component === null) usage('component_required');
    if (!COMPONENTS.includes(intent.component)) usage('unknown_component');
  }
  if (positional !== null) intent.upgradeId = positional;
  return Object.freeze(intent);
}

export function upgradeExitCode(outcome = {}, options = {}) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome) ||
    !options || typeof options !== 'object' || Array.isArray(options)) invalid();
  const { completed = false, failed = false, deferred = false } = outcome;
  const { strict = false } = options;
  if (![completed, failed, deferred, strict].every(flag => typeof flag === 'boolean')) invalid();
  if (failed === true) return 1;
  if (completed === true) return 0;
  if (deferred === true) return strict === true ? 2 : 0;
  return 2;
}

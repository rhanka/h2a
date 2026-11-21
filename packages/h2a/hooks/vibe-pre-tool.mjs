// Vibe pre_tool: explicit allow/deny JSON, status 0; the host fails open.
// Self-contained (copied verbatim to ~/.vibe/.h2a-install/hooks/vibe-pre-tool.mjs).
let raw = '';
const allow = () => { process.stdout.write('{"decision":"allow"}'); process.exit(0); };
const timer = setTimeout(allow, 4000);

function hasForbiddenAttributionTrailer(command) {
  const targetsGitOrPr = /(?:^|[;|&\n]\s*)(?:(?:env\s+(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*)|command\s+|sudo\s+(?:-\w+\s+)*)*(?:git\b[^\n;|&]*\bcommit\b|gh\s+pr\s+(?:create|edit|merge)\b)/m.test(command);
  if (!targetsGitOrPr) return false;
  const expanded = command.replace(/\\n/g, '\n');
  const rules = [
    /^\s*co-authored-by\s*:/im,
    /^\s*claude-session\s*:/im,
    /^\s*generated-by\s*:.*\b(?:claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor|ai)\b/im,
    /generated\s+(?:with|by)\s+\[?(?:claude|anthropic|codex|openai|gemini|antigravity|agy|mistral|vibe|muse|copilot|cursor|ai)\b/i,
    /claude\.com\/claude-code/i,
    /claude\.ai\/code\/session_[a-z0-9_-]+/i,
    /🤖/u,
    /(?:["'`]|^|\n)\s*(?:co-authored-by|claude-session)\s*:/im
  ];
  return rules.some(re => re.test(expanded));
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 1_048_576) allow(); });
process.stdin.on('error', allow);
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const payload = JSON.parse(raw);
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string') return allow();
    if (hasForbiddenAttributionTrailer(command)) {
      process.stderr.write('Forbidden AI attribution trailer in git commit / gh pr command refused.\n');
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Remove Co-Authored-By / Claude-Session / Generated with attribution trailers before committing or creating a PR.' }));
      return;
    }
    // Quoted arguments stay single words. Separators inside an argument are
    // data, including the benign Node expression containing "|h2a send".
    const tokens = [];
    let word = '', quote = '', escape = false, started = false;
    const flush = () => { if (started) tokens.push(word); word = ''; started = false; };
    for (const ch of command) {
      if (escape) { word += ch; started = true; escape = false; continue; }
      if (ch === '\\' && quote !== "'") { escape = true; started = true; continue; }
      if (quote) { if (ch === quote) quote = ''; else word += ch; continue; }
      if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
      if (';|&\n()'.includes(ch)) { flush(); tokens.push(null); }
      else if (/\s/.test(ch)) flush(); else { word += ch; started = true; }
    }
    flush();
    let executable = true, denied = false;
    for (const token of tokens) {
      if (token === null) { executable = true; continue; }
      if (!executable) continue;
      if (/^[A-Za-z_][\w]*=/.test(token) || ['env', 'command', 'sudo'].includes(token) || token.startsWith('-')) continue;
      if (token === 'h2a') { denied = true; break; }
      executable = false;
    }
    if (!denied) return allow();
    process.stderr.write('Use the H2A MCP tools/skill; manual h2a CLI invocation refused.\n');
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Use h2a_* or track_* MCP tools and the H2A skill.' }));
  } catch { allow(); }
});

// Deterministic PTY provider for the isolated runtime launch lab. No inference.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write('\x1b[2J\x1b[HClaude Code synthetic lab\r\nmodel · /synthetic\r\n❯ ');
let buffer = '';
process.stdin.on('data', chunk => {
  const text = chunk.toString();
  if (text.includes('\x15')) { buffer = ''; return; }
  buffer += text.replace(/\x1b\[20[01]~/g, '').replace(/[\r\n]/g, '');
  process.stdout.write('\x1b[2J\x1b[HClaude Code synthetic lab\r\nmodel · /synthetic\r\n❯ ' + buffer);
  if (text.includes('\r') || text.includes('\n')) {
    process.stdout.write('\r\n✻ Working…\r\n');
    // Observable post-submit CPU activity, matching the production guard.
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) Math.sqrt(Math.random());
  }
});

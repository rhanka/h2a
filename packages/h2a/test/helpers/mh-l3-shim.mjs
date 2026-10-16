// Launch the byte-identical compiled shim from the test image. No routing or
// machine-state substitutions; this executable and its input are test-only.
const [modulePath, root, runtimeBase] = process.argv.slice(2);
const { runCentralShim } = await import(modulePath);
process.exitCode = await runCentralShim({ host: 'claude', ...(process.argv[5] === 'identity-disabled' ? {} : { 'auto-open': 'true' }), 'runtime-base': runtimeBase }, root);

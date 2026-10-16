import { withIdentityFence } from '../../dist/runtime/local-files/identity-fence.js';

await withIdentityFence(process.argv[2], async () => {
  const keepAlive = setInterval(() => {}, 10_000);
  process.send({ ready: true });
  try { await new Promise(() => {}); }
  finally { clearInterval(keepAlive); }
});

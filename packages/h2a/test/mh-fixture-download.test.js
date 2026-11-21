import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { downloadWithRetry } from '../../../scripts/mh-l5-artifacts.mjs';

async function withServer(handler, body) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await body(baseUrl);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('MH fixture download retries stalled timeout attempts and succeeds on fresh connection', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    if (requests === 1) {
      // Simulate a stalled upstream socket that never responds before per-attempt timeout.
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end('recovered-payload');
  }, async (baseUrl) => {
    const bytes = await downloadWithRetry(`${baseUrl}/zig.tar.xz`, {
      stage: 'native-toolchain:zig.tar.xz',
      attemptTimeoutsMs: [150, 5_000],
      baseBackoffMs: 10,
      jitterMs: 0,
    });
    assert.equal(requests, 2);
    assert.equal(bytes.toString('utf8'), 'recovered-payload');
  });
});

test('MH fixture download retries transient HTTP 503/429 and connection resets', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    if (requests === 1) {
      res.writeHead(503);
      res.end('busy');
      return;
    }
    if (requests === 2) {
      res.writeHead(429, { 'retry-after': '0' });
      res.end('rate limited');
      return;
    }
    if (requests === 3) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200);
    res.end('ok-after-transient-errors');
  }, async (baseUrl) => {
    const bytes = await downloadWithRetry(`${baseUrl}/archive.tgz`, {
      stage: 'legacy-pin:archive.tgz',
      attemptTimeoutsMs: [5_000, 5_000, 5_000, 5_000],
      baseBackoffMs: 5,
      jitterMs: 0,
    });
    assert.equal(requests, 4);
    assert.equal(bytes.toString('utf8'), 'ok-after-transient-errors');
  });
});

test('MH fixture download fails immediately on non-retryable HTTP 404 with clear context', async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    await assert.rejects(
      () => downloadWithRetry(`${baseUrl}/missing.tgz`, {
        stage: 'legacy-pin:missing.tgz',
        attemptTimeoutsMs: [5_000, 5_000, 5_000],
        baseBackoffMs: 5,
        jitterMs: 0,
      }),
      error => {
        assert.match(error.message, /fixture_download_failed:legacy-pin:missing\.tgz:404:/);
        assert.match(error.message, /missing\.tgz/);
        return true;
      },
    );
    assert.equal(requests, 1, 'HTTP 404 must not be retried');
  });
});

test('MH fixture download exhaustion surfaces stage, URL, attempt count, and timeout details', async () => {
  let requests = 0;
  await withServer(() => {
    requests++;
    // Never respond on any attempt.
  }, async (baseUrl) => {
    await assert.rejects(
      () => downloadWithRetry(`${baseUrl}/stalled.tar.xz`, {
        stage: 'native-toolchain:stalled.tar.xz',
        attemptTimeoutsMs: [350, 400],
        baseBackoffMs: 10,
        jitterMs: 0,
      }),
      error => {
        assert.match(error.message, /fixture_download_failed:native-toolchain:stalled\.tar\.xz:exhausted:/);
        assert.match(error.message, /stalled\.tar\.xz/);
        assert.match(error.message, /2\/2 attempts/);
        assert.match(error.message, /TimeoutError/);
        assert.match(error.message, /timeout=350ms/);
        assert.match(error.message, /timeout=400ms/);
        return true;
      },
    );
    assert.equal(requests, 2);
  });
});

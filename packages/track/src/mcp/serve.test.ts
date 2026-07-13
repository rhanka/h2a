import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createTrackMcpServer, runServerUntilClosed, serveTrackMcpStdio } from './serve.js'

describe('@sentropic/track/mcp — export surface', () => {
  it('re-exports the server factory and the serve helpers', () => {
    expect(typeof createTrackMcpServer).toBe('function')
    expect(typeof serveTrackMcpStdio).toBe('function')
    expect(typeof runServerUntilClosed).toBe('function')
  })
})

describe('runServerUntilClosed — graceful shutdown contract (in-process host)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'track-serve-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function connectedServer(): Promise<{ server: ReturnType<typeof createTrackMcpServer>; client: Client }> {
    const server = createTrackMcpServer({ cwd: dir })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0' }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    return { server, client }
  }

  it('serves before shutdown, then resolves when the signal aborts', async () => {
    const { server, client } = await connectedServer()
    // sanity: the server is live and advertising read tools
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)

    const ac = new AbortController()
    const done = runServerUntilClosed(server, { signal: ac.signal })
    ac.abort()
    await expect(done).resolves.toBeUndefined()
  })

  it('resolves immediately when the signal is already aborted', async () => {
    const { server } = await connectedServer()
    await expect(
      runServerUntilClosed(server, { signal: AbortSignal.abort() }),
    ).resolves.toBeUndefined()
  })

  it('resolves when the peer closes the transport (stdin-EOF analogue)', async () => {
    const { server, client } = await connectedServer()
    const done = runServerUntilClosed(server)
    await client.close()
    await expect(done).resolves.toBeUndefined()
  })
})

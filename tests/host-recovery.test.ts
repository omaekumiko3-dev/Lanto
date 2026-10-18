import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { initializeHost } from '../src/host/config.ts'
import { startHost } from '../src/host/service.ts'
import { HostClient } from '../src/controller/host-client.ts'
import { TrustStore } from '../src/controller/trust-store.ts'
import { HostRequestError } from '../src/protocol/request.ts'
import type { HostStatus } from '../src/protocol/host.ts'
import { removeTestDirectory } from './temp.ts'

const vault = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function until(check: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout
  while (!check()) {
    assert.ok(Date.now() < end, 'State did not recover before the deadline')
    await delay(10)
  }
}

test('background checks recover a real TLS Host after an outage without pairing again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-recovery-'))
  const config = await initializeHost(directory, {
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  let service: Awaited<ReturnType<typeof startHost>> | undefined = await startHost(
    config,
    directory,
    { discovery: false }
  )
  const port = service.port
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  const client = new HostClient(trust, {
    pollIntervalMs: 20,
    retryDelays: [5],
    requestTimeoutMs: 200
  })
  try {
    const paired = await client.pair(service.createTicket())
    const before = trust.connection(paired.id)
    let changes = 0
    client.startMonitoring(() => changes++)
    await service.close()
    service = undefined
    await until(() => client.list()[0]?.errorKind === 'network')
    assert.equal(client.list()[0]?.status, undefined)
    assert.doesNotMatch(client.list()[0]!.error!, /authorization|pair.*again/i)
    service = await startHost({ ...config, port }, directory, { discovery: false })
    // No explicit refresh/probe: the normal background timer must clear the stale error.
    await until(() => Boolean(client.list()[0]?.status))
    assert.equal(client.list()[0]?.error, undefined)
    assert.equal(client.list()[0]?.errorKind, undefined)
    assert.deepEqual(trust.connection(paired.id), before)
    assert.ok(changes >= 2)
  } finally {
    client.close()
    await service?.close()
    await removeTestDirectory(directory, 'lanto-host-recovery-')
  }
})

test('short network failures retry, but rejected authorization and changed identity do not', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-retry-'))
  const config = await initializeHost(directory)
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  await trust.put(
    config.identity,
    { address: '127.0.0.1', port: 48199, certificate: config.certificate },
    'a'.repeat(43)
  )
  const status: HostStatus = {
    identity: config.identity,
    startedAt: new Date().toISOString(),
    sunshineReachable: true
  }
  let calls = 0
  let issue: 'network' | 'authorization' | 'certificate' | 'identity' = 'network'
  const client = new HostClient(trust, {
    retryDelays: [1, 1],
    request: async () => {
      calls++
      if (issue === 'network' && calls < 3)
        throw Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
      if (issue === 'authorization') throw new HostRequestError('rejected', 401)
      if (issue === 'certificate')
        throw Object.assign(new Error('certificate changed'), {
          code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
        })
      if (issue === 'identity')
        return {
          ...status,
          identity: { ...status.identity, id: '62b5e2c6-96e6-4500-9a78-8758de7cf8d5' }
        }
      return status
    }
  })
  try {
    const first = client.refresh(config.identity.id)
    const second = client.refresh(config.identity.id)
    assert.equal(first, second, 'Manual and background checks share one request')
    assert.ok((await first).status)
    assert.equal(calls, 3)
    for (const [failure, expected] of [
      ['authorization', 'authorization'],
      ['certificate', 'identity'],
      ['identity', 'identity']
    ] as const) {
      issue = failure
      calls = 0
      const state = await client.refresh(config.identity.id)
      assert.equal(state.errorKind, expected)
      assert.equal(state.status, undefined)
      assert.equal(calls, 1)
    }
  } finally {
    client.close()
    await removeTestDirectory(directory, 'lanto-host-retry-')
  }
})

test('an in-flight response for an old address cannot overwrite the updated device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-stale-'))
  const config = await initializeHost(directory)
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  await trust.put(
    config.identity,
    { address: '127.0.0.1', port: 48199, certificate: config.certificate },
    'a'.repeat(43)
  )
  const status: HostStatus = {
    identity: config.identity,
    startedAt: new Date().toISOString(),
    sunshineReachable: true
  }
  let finish!: (value: unknown) => void
  const client = new HostClient(trust, {
    request: async (endpoint) =>
      endpoint.address === '127.0.0.1'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : status
  })
  try {
    const old = client.refresh(config.identity.id)
    const cancelled = assert.rejects(old, /abort/i)
    await client.updateAddress(config.identity.id, '127.0.0.2')
    assert.ok((await client.refresh(config.identity.id)).status)
    finish({ ...status, sunshineReachable: false })
    await cancelled
    assert.equal(client.list()[0]?.address, '127.0.0.2')
    assert.equal(client.list()[0]?.status?.sunshineReachable, true)
  } finally {
    client.close()
    await removeTestDirectory(directory, 'lanto-host-stale-')
  }
})

test('closing the monitor cancels a pending connection and prevents later notifications', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-stop-'))
  const config = await initializeHost(directory)
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  await trust.put(
    config.identity,
    { address: '127.0.0.1', port: 48199, certificate: config.certificate },
    'a'.repeat(43)
  )
  let signal: AbortSignal | undefined
  let calls = 0
  let changes = 0
  const client = new HostClient(trust, {
    pollIntervalMs: 5,
    request: async (_endpoint, _path, options) => {
      calls++
      signal = options?.signal
      await delay(1000, undefined, { signal })
      return null
    }
  })
  try {
    client.startMonitoring(() => changes++)
    assert.equal(calls, 1)
    client.close()
    assert.equal(signal?.aborted, true)
    await delay(40)
    assert.equal(calls, 1)
    assert.equal(changes, 0)
    assert.equal(client.list()[0]?.error, undefined)
  } finally {
    client.close()
    await removeTestDirectory(directory, 'lanto-host-stop-')
  }
})

test('a silent HTTPS Host times out with a network error and a bounded retry count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-timeout-'))
  const config = await initializeHost(directory)
  let requests = 0
  const server = createServer({ cert: config.certificate, key: config.privateKey }, () => {
    requests++
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  await trust.put(
    config.identity,
    { address: '127.0.0.1', port: address.port, certificate: config.certificate },
    'a'.repeat(43)
  )
  const client = new HostClient(trust, { requestTimeoutMs: 100, retryDelays: [5] })
  try {
    const state = await client.refresh(config.identity.id)
    assert.equal(state.errorKind, 'network')
    assert.equal(requests, 2)
  } finally {
    client.close()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    await removeTestDirectory(directory, 'lanto-host-timeout-')
  }
})

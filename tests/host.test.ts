import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeHost } from '../src/host/config.ts'
import { PairingService } from '../src/host/pairing.ts'
import { startHost } from '../src/host/service.ts'
import { HostClient } from '../src/controller/host-client.ts'
import { TrustStore } from '../src/controller/trust-store.ts'
import { decodeTicket } from '../src/protocol/pair-ticket.ts'
import { hostRequest } from '../src/protocol/request.ts'
import { parseAnnouncement } from '../src/protocol/discovery.ts'
import { removeTestDirectory } from './temp.ts'

test('real TLS pairing, restart persistence, token hashing and revocation work end to end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-host-'))
  const config = await initializeHost(directory, {
    name: 'Test Host',
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  const service = await startHost(config, directory, { discovery: false })
  const endpoint = { address: '127.0.0.1', port: service.port, certificate: config.certificate }
  // Test vault checks the storage boundary; production uses Electron's OS-backed safeStorage.
  const vault = {
    encrypt: (value: string) => Buffer.from(value).toString('base64'),
    decrypt: (value: string) => Buffer.from(value, 'base64').toString()
  }
  try {
    const again = await initializeHost(directory, { name: 'Do not overwrite' })
    assert.equal(again.identity.id, config.identity.id)
    assert.equal(again.identity.name, 'Test Host')
    await assert.rejects(hostRequest(endpoint, '/v1/status'), /invalid authorization/)
    await assert.rejects(
      hostRequest(endpoint, '/admin/pair', {
        method: 'POST',
        token: randomBytes(32).toString('base64url')
      }),
      /rejected/
    )
    const trust = new TrustStore(join(directory, 'client'), vault)
    await trust.load()
    const client = new HostClient(trust)
    const ticket = service.createTicket()
    const paired = await client.pair(ticket)
    assert.equal(paired.id, config.identity.id)
    assert.equal(paired.status?.identity.name, 'Test Host')
    const token = trust.connection(paired.id).token
    const authorizationFile = await readFile(join(directory, 'controllers.json'), 'utf8')
    assert.equal(authorizationFile.includes(token), false)
    assert.equal(authorizationFile.includes(decodeTicket(ticket).secret), false)
    assert.equal(JSON.stringify(client.list()).includes(token), false)
    await assert.rejects(client.pair(ticket), /already used/)
    const restored = new TrustStore(join(directory, 'client'), vault)
    await restored.load()
    const restoredClient = new HostClient(restored)
    assert.equal((await restoredClient.refresh(paired.id)).status?.identity.id, paired.id)
    await restoredClient.unpair(paired.id)
    await assert.rejects(hostRequest(endpoint, '/v1/status', { token }), /invalid authorization/)
    assert.deepEqual(restoredClient.list(), [])
    assert.deepEqual(
      await hostRequest(endpoint, '/admin/controllers', { token: config.adminToken }),
      []
    )
  } finally {
    await service.close()
    await removeTestDirectory(directory, 'lanto-host-')
  }
})

test('a different TLS certificate is rejected before a pairing secret is sent', async () => {
  const first = await mkdtemp(join(tmpdir(), 'lanto-pin-'))
  const second = await mkdtemp(join(tmpdir(), 'lanto-pin-'))
  const config = await initializeHost(first, { listen: '127.0.0.1', address: '127.0.0.1', port: 0 })
  const other = await initializeHost(second)
  const service = await startHost(config, first, { discovery: false })
  try {
    await assert.rejects(
      hostRequest(
        { address: '127.0.0.1', port: service.port, certificate: other.certificate },
        '/v1/identity'
      )
    )
    assert.equal(
      (
        (await hostRequest(
          { address: '127.0.0.1', port: service.port, certificate: config.certificate },
          '/v1/identity'
        )) as { id: string }
      ).id,
      config.identity.id
    )
  } finally {
    await service.close()
    await removeTestDirectory(first, 'lanto-pin-')
    await removeTestDirectory(second, 'lanto-pin-')
  }
})

test('a paired Host can change address while preserving credentials and rejecting another identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-address-'))
  const config = await initializeHost(directory, {
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  let service = await startHost(config, directory, { discovery: false })
  const port = service.port
  const clientDirectory = join(directory, 'client')
  const vault = {
    encrypt: (value: string) => Buffer.from(value).toString('base64'),
    decrypt: (value: string) => Buffer.from(value, 'base64').toString()
  }
  try {
    const trust = new TrustStore(clientDirectory, vault)
    await trust.load()
    const client = new HostClient(trust)
    const paired = await client.pair(service.createTicket())
    const before = JSON.parse(await readFile(join(clientDirectory, 'trusted-hosts.json'), 'utf8'))
    await client.updateAddress(paired.id, '127.0.0.2')
    assert.equal(client.list()[0]?.status, undefined)
    assert.equal(client.list()[0]?.address, '127.0.0.2')
    const after = JSON.parse(await readFile(join(clientDirectory, 'trusted-hosts.json'), 'utf8'))
    assert.deepEqual(after.hosts[0], { ...before.hosts[0], address: '127.0.0.2' })

    await service.close()
    service = await startHost({ ...config, listen: '0.0.0.0', port }, directory, {
      discovery: false
    })
    const restored = new TrustStore(clientDirectory, vault)
    await restored.load()
    const restoredClient = new HostClient(restored)
    assert.equal((await restoredClient.refresh(paired.id)).status?.identity.id, paired.id)

    await service.close()
    const unrelatedDirectory = join(directory, 'unrelated')
    const unrelated = await initializeHost(unrelatedDirectory, { listen: '0.0.0.0', port })
    service = await startHost(unrelated, unrelatedDirectory, { discovery: false })
    const rejected = await restoredClient.refresh(paired.id)
    assert.equal(rejected.status, undefined)
    assert.ok(rejected.error)
    assert.equal(restored.connection(paired.id).endpoint.certificate, config.certificate)
    assert.equal(restored.connection(paired.id).token, trust.connection(paired.id).token)
  } finally {
    await service.close()
    await removeTestDirectory(directory, 'lanto-address-')
  }
})

test('pairing tickets expire, are replaced, and persisted controllers survive Host reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-grant-'))
  let now = Date.now()
  try {
    const config = await initializeHost(directory)
    const pairing = new PairingService(directory, () => now)
    await pairing.load()
    const endpoint = {
      hostId: config.identity.id,
      address: '127.0.0.1',
      port: 48199,
      certificate: config.certificate
    }
    const input = { controllerId: randomUUID(), controllerName: 'Client' }
    const first = decodeTicket(pairing.createTicket(endpoint))
    const second = decodeTicket(pairing.createTicket(endpoint))
    await assert.rejects(pairing.pair({ ...input, secret: first.secret }), /PAIR_REJECTED/)
    now += 300001
    await assert.rejects(pairing.pair({ ...input, secret: second.secret }), /PAIR_REJECTED/)
    const current = decodeTicket(pairing.createTicket(endpoint), now)
    const token = await pairing.pair({ ...input, secret: current.secret })
    const reloaded = new PairingService(directory)
    await reloaded.load()
    assert.equal(reloaded.authenticate(token)?.id, input.controllerId)
    await reloaded.revoke(input.controllerId)
    assert.equal(reloaded.authenticate(token), undefined)
  } finally {
    await removeTestDirectory(directory, 'lanto-grant-')
  }
})

test('discovery validates version and metadata without treating announcements as trust', () => {
  const message = {
    txt: { v: '1', id: randomUUID(), name: 'Linux1', platform: 'linux' },
    addresses: ['192.168.1.20'],
    port: 48199
  }
  assert.equal(parseAnnouncement(message)?.address, '192.168.1.20')
  assert.equal(parseAnnouncement({ ...message, txt: { ...message.txt, v: '99' } }), null)
  assert.equal(parseAnnouncement({ ...message, port: -1 }), null)
  assert.equal(parseAnnouncement({ ...message, addresses: ['--help'] }), null)
})

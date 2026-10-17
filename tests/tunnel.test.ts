import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { DirectTunnels } from '../src/controller/tunnel.ts'
import {
  tunnelEndpointSchema,
  tunnelEndpointText,
  tunnelPeerSchema
} from '../src/protocol/tunnel.ts'
import { sshConnectionSchema } from '../src/protocol/deployment.ts'

test('direct endpoints accept IPv4, IPv6 and hostnames without accepting URLs or commands', () => {
  for (const address of ['192.168.1.20', '2001:db8::2', '[2001:db8::2]', 'desktop.example.net'])
    assert.equal(tunnelEndpointSchema.parse({ address, port: 48200 }).port, 48200)
  assert.equal(tunnelEndpointText({ address: '[2001:db8::2]', port: 48200 }), '[2001:db8::2]:48200')
  for (const address of [
    'https://example.net',
    'example.net:48200',
    '--proxy',
    'host;echo secret',
    '192.168.1.1\ncommand'
  ])
    assert.throws(() => tunnelEndpointSchema.parse({ address, port: 48200 }))
  for (const port of [0, 65536, 1.5])
    assert.throws(() => tunnelEndpointSchema.parse({ address: 'example.net', port }))
  const input = {
    name: 'Target',
    host: '192.168.1.20',
    username: 'desktop',
    auth: 'password',
    password: 'temporary'
  }
  assert.equal(sshConnectionSchema.parse(input).network, 'direct')
  assert.equal(sshConnectionSchema.parse({ ...input, network: 'tunnel' }).tunnelPort, 48200)
})

test('tunnel keys survive restart through the secret vault and never enter plain configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-tunnel-keys-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const secrets = new Map<string, string>()
  const vault = {
    encrypt(value: string) {
      const token = 'sealed-' + randomUUID()
      secrets.set(token, value)
      return token
    },
    decrypt(value: string) {
      const result = secrets.get(value)
      if (!result) throw new Error('Invalid vault value')
      return result
    }
  }
  const options = { directory, resources: '.', vault }
  const id = randomUUID(),
    first = new DirectTunnels(options)
  await first.load()
  const publicKey = await first.key(id)
  const server = generateKeyPairSync('x25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64')
  await first.configure(id, { publicKey: server, address: '10.203.12.34' })
  const text = await readFile(join(directory, 'direct-tunnels.json'), 'utf8')
  const stored = JSON.parse(text)
  assert.equal(stored.version, 1)
  assert.match(stored.profiles[id], /^sealed-/)
  assert.ok(!text.includes(publicKey) && !text.includes(server) && !text.includes('privateKey'))
  const second = new DirectTunnels(options)
  await second.load()
  assert.equal(await second.key(id), publicKey)
  assert.equal(second.address(id), first.address(id))
  assert.match(first.address(id), /^127\./)
  await second.remove(id)
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'direct-tunnels.json'), 'utf8')).profiles,
    {}
  )
  await first.close()
  await second.close()
})

test('invalid tunnel state is preserved and peer addressing cannot grant arbitrary routes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-tunnel-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'direct-tunnels.json')
  await writeFile(file, 'broken state')
  const tunnels = new DirectTunnels({
    directory,
    resources: '.',
    vault: { encrypt: (value) => value, decrypt: (value) => value }
  })
  await assert.rejects(tunnels.load())
  assert.equal(await readFile(file, 'utf8'), 'broken state')
  const publicKey = generateKeyPairSync('x25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64')
  for (const address of ['0.0.0.0/0', '192.168.1.1', '10.203.0.1', '10.203.256.3'])
    assert.throws(() => tunnelPeerSchema.parse({ publicKey, address }))
  assert.throws(() =>
    tunnelPeerSchema.parse({ publicKey, address: '10.203.0.2', endpoint: 'attacker.example' })
  )
})

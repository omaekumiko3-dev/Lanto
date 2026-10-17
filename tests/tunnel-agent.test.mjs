import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, generateKeyPairSync, createHash } from 'node:crypto'
import { createTunnelAgent } from '../scripts/deploy/tunnel.mjs'

test('remote tunnel enrollment preserves its identity, reuses peers, and restricts media pairing to an enrolled controller', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'lanto-tunnel-agent-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const hostId = randomUUID(),
    controllerId = randomUUID(),
    hostData = join(home, 'host')
  await mkdir(hostData)
  await writeFile(join(hostData, 'host.json'), JSON.stringify({ identity: { id: hostId } }))
  const binary = join(home, 'helper')
  await writeFile(binary, 'owned test helper')
  const asset = {
    name: 'lanto-tunnel-linux-x64',
    sha256: createHash('sha256')
      .update(await readFile(binary))
      .digest('hex')
  }
  const publicKey = () =>
    generateKeyPairSync('x25519')
      .publicKey.export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('base64')
  const request = { hostId, tunnelControllerId: controllerId, tunnelPublicKey: publicKey(), asset }
  const calls = []
  const context = {
    home,
    platform: 'linux',
    system: { hostData },
    request,
    exists: async (path) =>
      access(path).then(
        () => true,
        () => false
      ),
    run: async (file, args) => {
      calls.push([file, ...args])
      return { code: args.join(' ') === '-c command -v ufw' ? 1 : 0, stdout: '', stderr: '' }
    },
    must: async (file, args) => {
      calls.push([file, ...args])
      return ''
    },
    verify: async (name, hash) => {
      assert.equal(name, asset.name)
      assert.equal(hash, asset.sha256)
      return binary
    },
    sudo: async () => {
      throw new Error('Unexpected system change')
    },
    userEnvironment: {}
  }
  const agent = createTunnelAgent(context),
    first = await agent.ensure()
  assert.equal(first.port, 48200)
  assert.match(first.address, /^10\.203\./)
  assert.deepEqual(Object.keys(first).sort(), ['address', 'port', 'publicKey'])
  assert.equal(await agent.peerAddress(), '127.0.0.1')
  const second = await agent.ensure()
  assert.deepEqual(second, first)
  const identityPath = join(home, '.lanto/direct-tunnel/identity.json')
  const original = JSON.parse(await readFile(identityPath, 'utf8'))
  assert.equal(original.peers.length, 1)
  request.tunnelPublicKey = publicKey()
  await assert.rejects(agent.peerAddress(), /peer-invalid/)
  const rotated = await agent.ensure()
  assert.equal(rotated.publicKey, first.publicKey)
  const after = JSON.parse(await readFile(identityPath, 'utf8'))
  assert.equal(after.privateKey, original.privateKey)
  assert.equal(after.peers.length, 1)
  request.hostId = randomUUID()
  await assert.rejects(agent.ensure(), /peer-invalid/)
  assert.equal(JSON.parse(await readFile(identityPath, 'utf8')).hostId, hostId)
  assert.ok(!calls.some((call) => call.some((arg) => /tailscale|login|curl|wget/.test(arg))))
})

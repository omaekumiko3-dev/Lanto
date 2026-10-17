import test from 'node:test'
import assert from 'node:assert/strict'
import ssh2 from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SshTransport, shellQuote, powershell } from '../src/deploy/ssh.ts'
import { sshConnectionSchema } from '../src/protocol/deployment.ts'
import type { RemoteSystem } from '../src/protocol/deployment.ts'
import { loadCatalog, selectAssets } from '../src/deploy/assets.ts'
import { removeTestDirectory } from './temp.ts'

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs1',
  format: 'pem'
})
async function serverFixture() {
  let authenticated = 0
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client.on('error', () => {})
    client.on('authentication', (context) => {
      if (
        context.method === 'password' &&
        context.username === 'desktop' &&
        context.password === 'test-secret'
      ) {
        authenticated++
        context.accept()
      } else context.reject()
    })
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept()
        session.on('exec', (accept, _reject, info) => {
          const stream = accept()
          if (info.command === 'wait') return
          let input = ''
          stream.on('data', (data: Buffer) => (input += data.toString()))
          stream.on('end', () => {
            stream.write(input)
            stream.exit(0)
            stream.end()
          })
        })
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address)
  return { server, port: address.port, authenticated: () => authenticated }
}

test('SSH pins keys only after authenticated approval, transports stdin, rejects changed keys and cancels commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-ssh-'))
  const fixture = await serverFixture()
  const input = sshConnectionSchema.parse({
    name: 'Test',
    host: '127.0.0.1',
    port: fixture.port,
    username: 'desktop',
    auth: 'password',
    password: 'test-secret'
  })
  const abort = new AbortController()
  const ssh = new SshTransport(abort.signal)
  try {
    let fingerprint = ''
    await ssh.connect(input, directory, async (value, previous) => {
      assert.equal(previous, undefined)
      fingerprint = value
      return true
    })
    assert.match(fingerprint, /^SHA256:/)
    assert.equal(fixture.authenticated(), 1)
    const output = await ssh.exec('echo-input', 'Unicode 中文\nsecret only on stdin')
    assert.equal(output.stdout, 'Unicode 中文\nsecret only on stdin')
    const known = await readFile(join(directory, 'ssh-known-hosts.json'), 'utf8')
    assert.ok(known.includes(fingerprint))
    assert.ok(!known.includes('test-secret'))
    await assert.rejects(ssh.exec('wait', '', 25), /timed out/)
    const waiting = ssh.exec('wait')
    abort.abort()
    await assert.rejects(waiting, /cancelled/)
    const secondAbort = new AbortController()
    const second = new SshTransport(secondAbort.signal)
    await second.connect(input, directory, async () => {
      throw new Error('Known host must not prompt')
    })
    secondAbort.abort()
    const previous = 'SHA256:' + 'A'.repeat(43)
    await writeFile(
      join(directory, 'ssh-known-hosts.json'),
      JSON.stringify({ ['127.0.0.1:' + fixture.port]: previous })
    )
    const changedAbort = new AbortController(),
      changed = new SshTransport(changedAbort.signal)
    await assert.rejects(
      changed.connect(input, directory, async (current, old) => {
        assert.equal(old, previous)
        assert.notEqual(current, old)
        return false
      }),
      /identity/
    )
    changedAbort.abort()
    assert.equal(
      JSON.parse(await readFile(join(directory, 'ssh-known-hosts.json'), 'utf8'))[
        '127.0.0.1:' + fixture.port
      ],
      previous
    )
  } finally {
    abort.abort()
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
    await removeTestDirectory(directory, 'lanto-ssh-')
  }
})

test('SSH rejected identity and authentication failure never persist credentials or host trust', async () => {
  const fixture = await serverFixture()
  const directory = await mkdtemp(join(tmpdir(), 'lanto-ssh-reject-'))
  try {
    const input = sshConnectionSchema.parse({
      name: 'Test',
      host: '127.0.0.1',
      port: fixture.port,
      username: 'desktop',
      auth: 'password',
      password: 'test-secret'
    })
    const rejected = new AbortController(),
      ssh = new SshTransport(rejected.signal)
    await assert.rejects(
      ssh.connect(input, directory, async () => false),
      /identity/
    )
    rejected.abort()
    assert.equal(fixture.authenticated(), 0)
    const failed = new AbortController(),
      other = new SshTransport(failed.signal)
    await assert.rejects(
      other.connect({ ...input, password: 'wrong' }, directory, async () => true),
      /authentication failed/
    )
    failed.abort()
    await assert.rejects(readFile(join(directory, 'ssh-known-hosts.json')), { code: 'ENOENT' })
  } finally {
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
    await removeTestDirectory(directory, 'lanto-ssh-reject-')
  }
})

test('catalog covers fresh x64/ARM64 Windows, macOS and Ubuntu; existing unsupported distributions are reused', async () => {
  const catalog = await loadCatalog('scripts/deploy')
  for (const platform of ['windows', 'macos', 'linux'] as const)
    for (const architecture of ['x64', 'arm64'] as const) {
      const system: RemoteSystem = {
        platform,
        architecture,
        name: 'Test',
        user: 'desktop',
        home: '/home/desktop',
        administrator: false,
        hostInstalled: false,
        sunshineInstalled: false,
        sunshineRunning: false,
        distribution: 'ubuntu',
        version: '26.04'
      }
      const assets = selectAssets(catalog, system)
      assert.ok(assets.node && assets.sunshine)
      assert.match(assets.node.sha256, /^[a-f0-9]{64}$/)
      assert.match(assets.sunshine.sha256, /^[a-f0-9]{64}$/)
      assert.equal(
        selectAssets(catalog, {
          ...system,
          distribution: 'unknown',
          nodePath: '/node',
          sunshineInstalled: true
        }).sunshine,
        undefined
      )
      if (platform === 'linux')
        assert.throws(
          () => selectAssets(catalog, { ...system, distribution: 'unknown' }),
          /distribution/
        )
    }
  assert.equal(shellQuote("a'b; $HOME"), "'a'\\''b; $HOME'")
  const script = "Write-Output '中文; $value'"
  assert.equal(
    Buffer.from(powershell(script).split(' ').at(-1)!, 'base64').toString('utf16le'),
    script
  )
  assert.throws(() =>
    sshConnectionSchema.parse({
      name: 'a',
      host: 'host; rm',
      username: 'a',
      auth: 'password',
      password: 'x'
    })
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initializeHost } from '../src/host/config.ts'
import { startHost } from '../src/host/service.ts'
import { systemdUnit } from '../src/host/systemd.ts'
import { writeJSON } from '../src/common/json-file.ts'
import { decodeTicket } from '../src/protocol/pair-ticket.ts'
import { removeTestDirectory } from './temp.ts'

test('headless CLI uses authenticated local management without loading Electron', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-cli-'))
  const config = await initializeHost(directory, {
    name: 'CLI Host',
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  const service = await startHost(config, directory, { discovery: false })
  try {
    await writeJSON(join(directory, 'host.json'), { ...config, port: service.port })
    const run = (command: string) =>
      promisify(execFile)(
        process.execPath,
        [resolve('src/host/cli.ts'), command, '--data-dir', directory],
        { windowsHide: true, timeout: 10000 }
      )
    const pair = await run('pair')
    const ticket = pair.stdout.split('\n').find((line) => line.startsWith('LANTO1.'))
    assert.ok(ticket, 'CLI must emit a pairing credential')
    assert.equal(decodeTicket(ticket).hostId, config.identity.id)
    assert.equal(JSON.parse((await run('status')).stdout).identity.name, 'CLI Host')
    assert.deepEqual(JSON.parse((await run('controllers')).stdout), [])
  } finally {
    await service.close()
    await removeTestDirectory(directory, 'lanto-cli-')
  }
})

test('systemd service generation quotes paths and does not allow injected directives', () => {
  const unit = systemdUnit('/usr/bin/node', '/home/dev/Lanto Host/cli.js', '/home/dev/a%b$root')
  assert.ok(unit.includes('"/home/dev/Lanto Host/cli.js"'))
  assert.ok(unit.includes('"/home/dev/a%%b$$root"'))
  assert.ok(unit.includes('WantedBy=default.target'))
  assert.throws(
    () => systemdUnit('/usr/bin/node', 'bad\nExecStart=other', '/tmp/host'),
    /control characters/
  )
})

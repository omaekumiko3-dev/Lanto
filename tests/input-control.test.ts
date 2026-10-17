import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInputControl, switchBinding } from '../src/main/input-control.ts'
import { launchMedia } from '../src/main/moonlight.ts'
import { defaultConfig } from '../src/shared/model.ts'
import { removeTestDirectory } from './temp.ts'

test('native switch bindings preserve exact modifiers and reject unsupported accelerators', () => {
  assert.deepEqual(switchBinding('Control+`'), { key: 0xc0, modifiers: 2 })
  assert.deepEqual(switchBinding('Ctrl+Alt+Shift+F12'), { key: 0x7b, modifiers: 7 })
  assert.deepEqual(switchBinding('Super+K'), { key: 75, modifiers: 8 })
  for (const value of ['`', 'Control+Control+A', 'Control+MediaPlayPause', 'Alt+F25', 'Ctrl+'])
    assert.throws(() => switchBinding(value), /switch|switching/)
})

test('session input control updates mode and binding atomically and cannot be revived after close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-input-'))
  const settings = defaultConfig().settings
  const control = await createInputControl(directory, settings)
  const file = control.environment.LANTO_INPUT_FILE
  const read = async () => JSON.parse(await readFile(file, 'utf8'))
  try {
    assert.deepEqual(await read(), { key: 192, modifiers: 2, locked: true, remote: true })
    await control.setRemote(false)
    await control.configure({ ...settings, returnShortcut: 'Control+Alt+F10' })
    assert.deepEqual(await read(), { key: 121, modifiers: 6, locked: true, remote: false })
    await control.setRemote(true)
    assert.equal((await read()).remote, true)
    await control.close()
    await assert.rejects(access(file))
    await assert.rejects(control.setRemote(true), /stream ended/)
  } finally {
    await control.close()
    await removeTestDirectory(directory, 'lanto-input-')
  }
})

test('only the owned player stdout protocol requests switching, including split pipe messages', async () => {
  const requests: number[] = []
  const script = `process.stdout.write('noise\\nLANTO_'); setTimeout(() => {
    process.stdout.write('SWITCH\\nLANTO_SWITCH_extra\\n');
    process.stderr.write('LANTO_SWITCH\\n');
  }, 20)`
  const player = await launchMedia(process.execPath, ['-e', script], undefined, {}, (pid) =>
    requests.push(pid)
  )
  assert.equal((await player.closed).code, 0)
  assert.deepEqual(requests, [player.pid])
})

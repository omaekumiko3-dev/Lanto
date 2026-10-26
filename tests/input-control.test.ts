import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInputControl, switchBinding } from '../src/main/input-control.ts'
import { launchMedia } from '../src/main/moonlight.ts'
import { defaultConfig } from '../src/shared/model.ts'
import { removeTestDirectory } from './temp.ts'
import koffi from 'koffi'

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
    assert.deepEqual(await read(), {
      key: 192,
      modifiers: 2,
      locked: true,
      remote: true,
      emergency: 0
    })
    await control.setRemote(false)
    await control.configure({ ...settings, returnShortcut: 'Control+Alt+F10' })
    assert.deepEqual(await read(), {
      key: 121,
      modifiers: 6,
      locked: true,
      remote: false,
      emergency: 0
    })
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

test('only an explicit input selection acknowledges a new native emergency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-input-'))
  let sequence = 0
  const control = await createInputControl(directory, defaultConfig().settings, () => sequence)
  const read = async () => JSON.parse(await readFile(control.environment.LANTO_INPUT_FILE, 'utf8'))
  try {
    sequence = 1
    await control.configure(defaultConfig().settings)
    assert.equal((await read()).emergency, 0)
    await control.setRemote(false)
    assert.equal((await read()).emergency, 1)
    assert.equal((await read()).remote, false)
    await control.setRemote(true)
    assert.equal((await read()).emergency, 1)
  } finally {
    await control.close()
    await removeTestDirectory(directory, 'lanto-input-')
  }
})

test(
  'input handoff retries transient Windows file sharing and preserves state on persistent failure',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lanto-input-'))
    const control = await createInputControl(directory, defaultConfig().settings)
    const file = control.environment.LANTO_INPUT_FILE
    const kernel = koffi.load('kernel32.dll')
    const open = kernel.func(
      'uintptr_t __stdcall CreateFileW(str16 path, uint32_t access, uint32_t share, uintptr_t security, uint32_t creation, uint32_t flags, uintptr_t templateFile)'
    )
    const close = kernel.func('int __stdcall CloseHandle(uintptr_t handle)')
    let handle = 0
    try {
      handle = open(file, 0x80000000, 3, 0, 3, 0, 0) // Reader deliberately denies deletion.
      assert.notEqual(handle, -1)
      const update = control.setRemote(false)
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(JSON.parse(await readFile(file, 'utf8')).remote, true)
      close(handle)
      handle = 0
      await update
      assert.equal(JSON.parse(await readFile(file, 'utf8')).remote, false)
      handle = open(file, 0x80000000, 3, 0, 3, 0, 0)
      await assert.rejects(control.setRemote(true), /EPERM|EACCES|EBUSY/)
      assert.equal(JSON.parse(await readFile(file, 'utf8')).remote, false)
    } finally {
      if (handle) close(handle)
      await control.close()
      await removeTestDirectory(directory, 'lanto-input-')
    }
  }
)

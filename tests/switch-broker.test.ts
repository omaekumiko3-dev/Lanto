import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { SwitchBroker } from '../src/main/switch-broker.ts'

const executable = resolve('out/native/LantoSwitch.exe')
test(
  'native broker reserves bindings, rejects conflicts, updates live, and releases on close',
  { skip: process.platform !== 'win32' || !existsSync(executable) },
  async () => {
    let callbacks = 0
    const first = new SwitchBroker(
      executable,
      () => {
        callbacks++
      },
      () => {}
    )
    const second = new SwitchBroker(
      executable,
      () => {
        callbacks++
      },
      () => {}
    )
    try {
      await first.start('Control+Alt+Shift+F23')
      assert.equal(first.registered, true)
      await assert.rejects(second.start('Control+Alt+Shift+F23'), /unavailable/)
      await second.start('Control+Alt+Shift+F24')
      await assert.rejects(first.bind('Control+Alt+Shift+F24'), /already in use/)
      assert.equal(first.registered, true)
      await first.bind('Control+Alt+Shift+F22')
      await second.bind('Control+Alt+Shift+F23')
      assert.equal(callbacks, 0) // No physical key events are injected by this test.
    } finally {
      first.close()
      second.close()
    }
  }
)

test('missing helper fails cleanly without reporting a registered shortcut', async () => {
  const broker = new SwitchBroker(
    resolve('out/native/does-not-exist.exe'),
    () => {},
    () => {}
  )
  try {
    await assert.rejects(broker.start('Alt+`'), /unavailable/)
    assert.equal(broker.registered, false)
  } finally {
    broker.close()
  }
})

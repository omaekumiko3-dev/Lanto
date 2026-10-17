import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchMedia } from '../src/main/moonlight.ts'
import { createMediaWindow } from '../src/main/media-window.ts'
import { defaultConfig } from '../src/shared/model.ts'

test(
  'Windows control rejects a player without a window and never owns the player lifetime',
  { skip: process.platform !== 'win32' },
  async () => {
    const player = await launchMedia(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const window = createMediaWindow(player.pid, defaultConfig().settings)
    try {
      await assert.rejects(window.toggle(), /still opening/)
      await window.configure({ ...defaultConfig().settings, lockInput: false })
      window.close()
      window.close()
      await assert.rejects(window.show(), /has closed/)
      assert.equal(process.kill(player.pid, 0), true)
    } finally {
      window.close()
      await player.stop()
    }
  }
)

test(
  'Windows control stops using its original process handle after the player exits',
  { skip: process.platform !== 'win32' },
  async () => {
    const player = await launchMedia(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const window = createMediaWindow(player.pid, defaultConfig().settings)
    try {
      await player.stop()
      await player.closed
      await assert.rejects(window.toggle(), /has closed/)
      await assert.rejects(window.show(), /has closed/)
    } finally {
      window.close()
      await player.stop()
    }
  }
)

test('locked mode ignores external activation, hides again, and keeps native return idempotent', async () => {
  let foreground = 10
  let visible = true
  let focused = true
  const modes: boolean[] = []
  const api = {
    foreground: () => foreground,
    visible: () => (visible ? 1 : 0),
    owner: (window: number) => (window === 10 ? 42 : 99),
    find: () => 10,
    minimized: () => 0,
    show: (_window: number, command: number) => {
      visible = command !== 0
      if (!visible && foreground === 10) foreground = 20
      return 1
    },
    focus: () => {
      if (focused) foreground = 10
      return focused ? 1 : 0
    },
    open: () => 1,
    wait: () => 258,
    close: () => 1
  }
  const control = createMediaWindow(
    42,
    defaultConfig().settings,
    {
      async setRemote(remote) {
        modes.push(remote)
      },
      async configure() {}
    },
    api
  )
  try {
    assert.equal(await control.toggle(), 'local')
    assert.equal(visible, false)
    // Simulate an external activation instead of sending physical mouse or keyboard input.
    visible = true
    foreground = 10
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(visible, false)
    assert.equal(await control.toggle(), 'remote')
    assert.equal(visible, true)
    foreground = 20
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(visible, false)
    // The native message can arrive after the focus watcher already hid the window.
    await control.hide()
    assert.equal(visible, false)
    assert.equal(await control.toggle(), 'remote')
    await control.hide()
    focused = false
    await assert.rejects(control.toggle(), /switch shortcut to retry/)
    assert.equal(visible, false)
    assert.equal(modes.at(-1), false)
    assert.equal(modes.filter(Boolean).length, 3)
  } finally {
    control.close()
  }
})

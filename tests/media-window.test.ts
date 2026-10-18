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

test('locked selection survives local popups and releases protection only on explicit return', async () => {
  let foreground = 10
  let visible = true
  let focused = true
  let topmost = false
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
    topmost: (_window: number, enabled: boolean) => {
      topmost = enabled
      return 1
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
    foreground = 20
    visible = false
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(foreground, 20) // An opening/hidden player cannot take focus.
    visible = true
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(foreground, 10) // Finish a delayed handshake behind a local app.
    assert.equal(topmost, true)
    assert.equal(await control.toggle(), 'local')
    assert.equal(visible, false)
    assert.equal(topmost, false)
    // Simulate an external activation instead of sending physical mouse or keyboard input.
    visible = true
    foreground = 10
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(visible, false)
    assert.equal(await control.toggle(), 'remote')
    assert.equal(visible, true)
    assert.equal(topmost, true)
    foreground = 20
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(foreground, 10)
    assert.equal(visible, true)
    assert.equal(control.mode, 'remote')
    assert.equal(modes.at(-1), true)
    // Even if Windows temporarily denies activation, it must not select local mode.
    focused = false
    foreground = 20
    visible = false
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(visible, true)
    assert.equal(control.mode, 'remote')
    assert.equal(modes.at(-1), true)
    await control.hide()
    assert.equal(visible, false)
    assert.equal(topmost, false)
    focused = true
    assert.equal(await control.toggle(), 'remote')
    await control.configure({ ...defaultConfig().settings, lockInput: false })
    assert.equal(topmost, false)
    foreground = 20
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(foreground, 20)
    await control.configure(defaultConfig().settings)
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

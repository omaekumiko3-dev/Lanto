import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { launchMedia } from '../src/main/moonlight.ts'
import { createMediaWindow, focusWindow, windowsAPI } from '../src/main/media-window.ts'
import { defaultConfig } from '../src/shared/model.ts'

const recoveryFixture = fileURLToPath(new URL('../out/native/LantoTestMedia.exe', import.meta.url))
test(
  'Windows finds a hidden Qt error window after the hidden SDL stream disappears',
  { skip: process.platform !== 'win32' || !existsSync(recoveryFixture), timeout: 5000 },
  async () => {
    const child = spawn(recoveryFixture, ['--window-recovery'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    try {
      const first = await lines.next()
      const [stream, dialog] = first.value!.split(' ').map(Number)
      assert.ok(stream && dialog)
      const api = windowsAPI()
      assert.equal(api.visible(stream!), 0)
      assert.equal(api.visible(dialog!), 0)
      assert.equal(api.find(child.pid!), stream)
      child.stdin.write('x')
      assert.equal((await lines.next()).value, 'SDL_CLOSED')
      assert.equal(api.find(child.pid!), dialog)
      assert.equal(api.owner(dialog!), child.pid)
      assert.equal(api.visible(dialog!), 0) // Discovery must not change selection.
    } finally {
      child.stdin.end()
      child.kill()
      await lines.return?.()
    }
  }
)

test(
  'Windows control releases an opening player without owning its lifetime',
  { skip: process.platform !== 'win32' },
  async () => {
    const player = await launchMedia(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const window = createMediaWindow(player.pid, defaultConfig().settings)
    try {
      assert.equal(await window.toggle(), 'local')
      await assert.rejects(window.show(), /still opening/)
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

test('activation includes the selected target queue and always detaches both queues', () => {
  const attached = new Set<number>()
  const released: number[] = []
  let active = false
  let fail = false
  const api = {
    foreground: () => 10,
    thread: (window: number) => (window === 10 ? 2 : 3),
    currentThread: () => 1,
    attach: (_from: number, to: number, enabled: number) => {
      if (enabled) attached.add(to)
      else {
        attached.delete(to)
        released.push(to)
      }
      return 1
    },
    activate: () => {
      assert.deepEqual([...attached], [2, 3])
      if (fail) throw new Error('activation failed')
      active = true
      return 1
    },
    focus: () => Number(active && attached.has(3))
  }
  assert.equal(focusWindow(20, api), 1)
  assert.deepEqual(released, [3, 2])
  assert.equal(attached.size, 0)
  active = false
  fail = true
  assert.throws(() => focusWindow(20, api), /activation failed/)
  assert.equal(attached.size, 0)
})

test('a hidden opening player stays local when its window appears later', async () => {
  let window = 0
  let visible = true
  let remote = true
  const api = {
    foreground: () => 0,
    owner: (target: number) => (target === 10 ? 42 : 0),
    find: () => window,
    visible: () => Number(visible),
    minimized: () => 0,
    show: (_target: number, command: number) => {
      visible = command !== 0
      return 1
    },
    focus: () => 0,
    topmost: () => 1,
    open: () => 1,
    wait: () => 258,
    close: () => 1
  }
  const control = createMediaWindow(
    42,
    defaultConfig().settings,
    {
      async setRemote(value) {
        remote = value
      },
      async configure() {}
    },
    api
  )
  try {
    await control.hide()
    await control.configure(defaultConfig().settings)
    assert.equal(remote, false)
    window = 10
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(visible, false)
    assert.equal(control.mode, 'local')
  } finally {
    control.close()
  }
})

test('local mode follows a replacement window and can select it on the next switch', async () => {
  let current = 10
  let front = 10
  let visible = true
  const api = {
    foreground: () => front,
    owner: (target: number) => (target === current ? 42 : 0),
    find: () => current,
    visible: () => Number(visible),
    minimized: () => 0,
    show: (_target: number, command: number) => {
      visible = command !== 0
      if (!visible) front = 0
      return 1
    },
    focus: (target: number) => {
      front = target
      return 1
    },
    topmost: () => 1,
    open: () => 1,
    wait: () => 258,
    close: () => 1
  }
  const control = createMediaWindow(42, defaultConfig().settings, undefined, api)
  try {
    await control.hide()
    current = 20 // Streaming ended and Qt displayed its connection error.
    visible = true
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(visible, false)
    assert.equal(control.mode, 'local')
    await control.show()
    assert.equal(front, 20)
    assert.equal(visible, true)
    assert.equal(control.mode, 'remote')
  } finally {
    control.close()
  }
})

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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchMedia } from '../src/main/moonlight.ts'
import { createMediaWindow } from '../src/main/media-window.ts'

test(
  'Windows control rejects a player without a window and never owns the player lifetime',
  { skip: process.platform !== 'win32' },
  async () => {
    const player = await launchMedia(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    const window = createMediaWindow(player.pid, true)
    try {
      await assert.rejects(window.toggle(), /still opening/)
      await window.configure(false)
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
    const window = createMediaWindow(player.pid, true)
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

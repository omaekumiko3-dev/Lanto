import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import koffi from 'koffi'
import { SwitchBroker } from '../src/main/switch-broker.ts'

process.env.LANTO_SWITCH_DIRECT = '1'
const executable = resolve('out/native/LantoSwitch.exe')
test(
  'native message loop dispatches registered hotkeys without physical hook events',
  { skip: process.platform !== 'win32' || !existsSync(executable), timeout: 10000 },
  async () => {
    const child = spawn(
      executable,
      [String(process.pid), `Local\\LantoSwitch-${randomUUID()}`, '132', '7'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const closed = new Promise((resolve) => child.once('exit', resolve))
    const lines: string[] = []
    const reader = createInterface({ input: child.stdout })
    reader.on('line', (line) => lines.push(line.trim()))
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 2500
      while (!check() && Date.now() < deadline) await delay(10)
      assert.ok(check(), `Native helper did not respond: ${lines.join(', ')}`)
    }
    try {
      await until(() => lines.includes('READY'))
      const kernel = koffi.load('kernel32.dll')
      const user = koffi.load('user32.dll')
      const entry = koffi.struct('LantoBrokerThreadEntry', {
        size: 'uint32_t',
        usage: 'uint32_t',
        thread: 'uint32_t',
        process: 'uint32_t',
        priority: 'int32_t',
        delta: 'int32_t',
        flags: 'uint32_t'
      })
      const snapshot = kernel.func(
        'uintptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags,uint32_t pid)'
      )
      const first = kernel.func(
        'int __stdcall Thread32First(uintptr_t handle,_Inout_ LantoBrokerThreadEntry *entry)'
      )
      const next = kernel.func(
        'int __stdcall Thread32Next(uintptr_t handle,_Inout_ LantoBrokerThreadEntry *entry)'
      )
      const close = kernel.func('int __stdcall CloseHandle(uintptr_t handle)')
      const post = user.func(
        'int __stdcall PostThreadMessageW(uint32_t thread,uint32_t message,uintptr_t wparam,intptr_t lparam)'
      )
      const handle = snapshot(4, 0)
      assert.notEqual(handle, -1)
      const threads: number[] = []
      try {
        const row = {
          size: koffi.sizeof(entry),
          usage: 0,
          thread: 0,
          process: 0,
          priority: 0,
          delta: 0,
          flags: 0
        }
        if (first(handle, row)) {
          do {
            if (row.process === child.pid) threads.push(row.thread)
          } while (next(handle, row))
        }
      } finally {
        close(handle)
      }
      // Only the broker's message-loop thread has a queue; its stdin worker
      // does not. These are owned-process messages, never keyboard injection.
      const receivers = threads.filter((thread) => post(thread, 0x312, 2, 7 | (132 << 16)))
      assert.equal(receivers.length, 1)
      const thread = receivers[0]!
      assert.ok(post(thread, 0x312, 1, 1 | (132 << 16))) // Wrong modifiers.
      assert.ok(post(thread, 0x312, 1, 7 | (131 << 16))) // Wrong key.
      await delay(80)
      assert.equal(lines.filter((line) => line.startsWith('SWITCH ')).length, 0)
      assert.ok(post(thread, 0x312, 1, 7 | (132 << 16)))
      await until(() => lines.filter((line) => line.startsWith('SWITCH ')).length === 1)
      await delay(1100) // Cross a hook renewal while the binding remains registered.
      assert.ok(post(thread, 0x312, 1, 7 | (132 << 16)))
      await until(() => lines.filter((line) => line.startsWith('SWITCH ')).length === 2)
      child.stdin.write('131 7\n')
      await until(() => lines.includes('BOUND'))
      assert.ok(post(thread, 0x312, 1, 7 | (132 << 16))) // Queued old registration.
      assert.ok(post(thread, 0x312, 2, 7 | (132 << 16))) // Old key with new registration.
      await delay(80)
      assert.equal(lines.filter((line) => line.startsWith('SWITCH ')).length, 2)
      assert.ok(post(thread, 0x312, 2, 7 | (131 << 16)))
      await until(() => lines.filter((line) => line.startsWith('SWITCH ')).length === 3)
    } finally {
      reader.close()
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 1500)
      await closed
      clearTimeout(timer)
    }
  }
)

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

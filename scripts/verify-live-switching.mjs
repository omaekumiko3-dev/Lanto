import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import koffi from 'koffi'
// Opt-in acceptance with two real streams. Only the app's switch sequence is
// advanced; no physical keyboard/mouse events or key-state bytes are injected.
const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    report: { type: 'string' },
    count: { type: 'string', default: '30' }
  }
})
assert.equal(process.platform, 'win32', 'Live switching verification requires Windows')
assert.ok(values['data-dir'], 'Pass --data-dir with the running controller profile directory')
const data = resolve(values['data-dir'])
const count = Number(values.count)
assert.ok(Number.isInteger(count) && count > 0 && count <= 600, 'Count must be between 1 and 600')
const [port] = (await readFile(`${data}/DevToolsActivePort`, 'utf8')).split(/\r?\n/)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts()[0].pages()[0]
const before = await page.evaluate(() => window.lanto.getState())
assert.equal(resolve(before.runtime.configDirectory).toLowerCase(), data.toLowerCase())
assert.equal(before.config.settings.lockInput, true, 'Enable input locking before this check')
assert.equal(before.sessions.length, 2)
const command = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process -Filter "Name=\'LantoSwitch.exe\'" | Select-Object -ExpandProperty CommandLine'
  ],
  { windowsHide: true, encoding: 'utf8' }
)
const maps = command.match(/Local\\LantoSwitch-[0-9a-f-]+/g)
assert.equal(maps?.length, 1)
const k = koffi.load('kernel32.dll'),
  u = koffi.load('user32.dll')
const open = k.func('uintptr_t __stdcall OpenFileMappingW(uint32_t access,int inherit,str16 name)')
const view = k.func(
  'void * __stdcall MapViewOfFile(uintptr_t handle,uint32_t access,uint32_t high,uint32_t low,uintptr_t bytes)'
)
const unmap = k.func('int __stdcall UnmapViewOfFile(void *address)')
const close = k.func('int __stdcall CloseHandle(uintptr_t handle)')
const handle = open(6, 0, maps[0]),
  memory = view(handle, 6, 0, 0, 20)
assert.ok(memory)
const fg = u.func('uintptr_t __stdcall GetForegroundWindow()')
const owner = u.func(
  'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window,_Out_ uint32_t *pid)'
)
const visible = u.func('int __stdcall IsWindowVisible(uintptr_t window)')
const klass = u.func(
  'int __stdcall GetClassNameW(uintptr_t window,_Out_ uint16_t *buffer,int capacity)'
)
const enumerate = u.func('__stdcall', 'EnumWindows', 'int', [
  koffi.pointer(koffi.proto('int __stdcall CycleEnum(uintptr_t window,intptr_t data)')),
  'intptr_t'
])
const windows = []
enumerate((window) => {
  const pid = [0]
  owner(window, pid)
  const session = before.sessions.find((session) => session.pid === pid[0])
  if (!session) return 1
  const buffer = Buffer.alloc(512),
    length = klass(window, buffer, 256)
  if (buffer.subarray(0, length * 2).toString('utf16le') === 'SDL_app')
    windows.push({ window, pid: pid[0], id: session.deviceId })
  return 1
}, 0)
assert.equal(windows.length, 2)
const cycle = [null, ...before.sessions.map((s) => s.deviceId)]
let selected = before.controlDeviceId
const rows = []
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (target) => {
  const foreground = fg(),
    pid = [0]
  owner(foreground, pid)
  return {
    good:
      windows.every((w) => Boolean(visible(w.window)) === (w.id === target)) &&
      (target
        ? pid[0] === windows.find((w) => w.id === target).pid
        : !windows.some((w) => w.pid === pid[0])),
    foregroundPid: pid[0],
    visible: windows.filter((w) => visible(w.window)).map((w) => w.id),
    inputOwner: koffi.decode(memory, 8, 'int32_t')
  }
}
try {
  for (let i = 0; i < count; i++) {
    const target = cycle[(cycle.indexOf(selected) + 1) % cycle.length]
    const started = performance.now()
    koffi.encode(memory, 12, 'int32_t', koffi.decode(memory, 12, 'int32_t') + 1)
    let reached = null,
      flashes = 0,
      last
    while (performance.now() - started < 1200) {
      last = check(target)
      if (last.good) {
        reached ??= performance.now() - started
        if (performance.now() - started - reached >= 220) break
      } else if (reached !== null) {
        flashes++
        reached = null
      }
      await delay(5)
    }
    const after = await page.evaluate(() => window.lanto.getState())
    const row = {
      step: i + 1,
      target: target === null ? 'local' : `remote-${cycle.indexOf(target)}`,
      latencyMs: reached === null ? null : Math.round(reached * 10) / 10,
      flashes,
      selected: after.controlDeviceId,
      ...last
    }
    rows.push(row)
    console.log(JSON.stringify(row))
    assert.ok(
      last.good && reached !== null && after.controlDeviceId === target,
      'Switch did not settle on the requested system'
    )
    assert.equal(flashes, 0, 'Window flashed back after reaching the target')
    assert.equal(last.inputOwner, target ? windows.find((w) => w.id === target).pid : 0)
    assert.deepEqual(
      after.sessions.map((s) => s.pid),
      before.sessions.map((s) => s.pid),
      'A stream restarted during switching'
    )
    selected = target
  }
  const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      switches: rows.length,
      medianMs: latencies[Math.floor(count / 2)],
      p95Ms: latencies[Math.ceil(count * 0.95) - 1],
      maxMs: latencies.at(-1),
      flashes: rows.reduce((a, b) => a + b.flashes, 0)
    })
  )
} finally {
  if (values.report) await writeFile(values.report, JSON.stringify({ rows, windows }, null, 2))
  unmap(memory)
  close(handle)
  await browser.close()
}

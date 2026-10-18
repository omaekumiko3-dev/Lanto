import koffi from 'koffi'
import type { InputSettings } from './input-control.ts'

export interface MediaWindow {
  readonly mode?: 'local' | 'remote'
  toggle(): Promise<'local' | 'remote'>
  show(): Promise<void>
  hide(): Promise<void>
  configure(settings: InputSettings): Promise<void>
  close(): void
}

interface WindowAPI {
  foreground(): number
  visible(window: number): number
  minimized(window: number): number
  show(window: number, command: number): number
  focus(window: number): number
  topmost(window: number, enabled: boolean): number
  open(access: number, inherit: number, pid: number): number
  wait(handle: number, timeout: number): number
  close(handle: number): number
  owner(window: number): number
  find(pid: number): number
}

interface FocusAPI {
  foreground(): number
  thread(window: number): number
  currentThread(): number
  attach(from: number, to: number, enabled: number): number
  activate(window: number): number
  focus(window: number): number
}

/** Complete activation in the target's queue, then release every temporary attachment. */
export function focusWindow(window: number, api: FocusAPI): number {
  if (api.focus(window)) return 1
  const current = api.currentThread()
  const threads = new Set([api.thread(api.foreground()), api.thread(window)])
  const attached: number[] = []
  try {
    for (const thread of threads) {
      if (thread && thread !== current && api.attach(current, thread, 1)) attached.push(thread)
    }
    // Merely borrowing the previous foreground queue can leave a hidden player
    // active there. Activate the selected player's queue before requesting focus.
    api.activate(window)
    return api.focus(window)
  } finally {
    for (const thread of attached.reverse()) api.attach(current, thread, 0)
  }
}

function windowsAPI(): WindowAPI {
  const user = koffi.load('user32.dll')
  const kernel = koffi.load('kernel32.dll')
  const rect = koffi.struct({
    left: 'int32_t',
    top: 'int32_t',
    right: 'int32_t',
    bottom: 'int32_t'
  })
  const callback = koffi.proto(
    'int __stdcall LantoEnumWindowsProc(uintptr_t window, intptr_t data)'
  )
  const enumerate = user.func('__stdcall', 'EnumWindows', 'int', [
    koffi.pointer(callback),
    'intptr_t'
  ])
  const bounds = user.func('__stdcall', 'GetWindowRect', 'int', [
    'uintptr_t',
    koffi.out(koffi.pointer(rect))
  ])
  const visible = user.func('int __stdcall IsWindowVisible(uintptr_t window)')
  const className = user.func(
    'int __stdcall GetClassNameW(uintptr_t window, _Out_ uint16_t *buffer, int capacity)'
  )
  const parent = user.func('uintptr_t __stdcall GetWindow(uintptr_t window, uint32_t command)')
  const processId = user.func(
    'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *pid)'
  )
  const setForeground = user.func('int __stdcall SetForegroundWindow(uintptr_t window)')
  const position = user.func(
    'int __stdcall SetWindowPos(uintptr_t window, intptr_t after, int x, int y, int width, int height, uint32_t flags)'
  )
  const currentThread = kernel.func('uint32_t __stdcall GetCurrentThreadId()')
  const activate = user.func('uintptr_t __stdcall SetActiveWindow(uintptr_t window)')
  const attachInput = user.func(
    'int __stdcall AttachThreadInput(uint32_t from, uint32_t to, int attach)'
  )
  const api = {
    visible,
    foreground: user.func('uintptr_t __stdcall GetForegroundWindow()'),
    minimized: user.func('int __stdcall IsIconic(uintptr_t window)'),
    show: user.func('int __stdcall ShowWindowAsync(uintptr_t window, int command)'),
    topmost: (window: number, enabled: boolean) =>
      position(window, enabled ? -1 : -2, 0, 0, 0, 0, 0x4013), // async, no move/size/activation
    focus(window: number): number {
      return focusWindow(window, {
        foreground: api.foreground,
        thread: (target) => processId(target, [0]),
        currentThread,
        attach: attachInput,
        activate,
        focus: setForeground
      })
    },
    open: kernel.func(
      'uintptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'
    ),
    wait: kernel.func('uint32_t __stdcall WaitForSingleObject(uintptr_t handle, uint32_t timeout)'),
    close: kernel.func('int __stdcall CloseHandle(uintptr_t handle)'),
    owner(window: number): number {
      const pid = [0]
      processId(window, pid)
      return pid[0]!
    },
    find(pid: number): number {
      let best = 0
      let area = 0
      enumerate((window: number) => {
        if (api.owner(window) !== pid || parent(window, 4)) return 1
        const name = Buffer.alloc(512)
        const length = className(window, name, 256)
        const stream = name.subarray(0, length * 2).toString('utf16le') === 'SDL_app'
        if (!stream && !visible(window)) return 1
        const box = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!bounds(window, box)) return 1
        const size = (stream ? 1e12 : 0) + (box.right - box.left) * (box.bottom - box.top)
        if (!best || size > area) {
          best = window
          area = size
        }
        return 1
      }, 0)
      return best
    }
  }
  return api
}

let native: ReturnType<typeof windowsAPI> | undefined

export function focusControllerWindow(handle: Buffer): void {
  if (process.platform !== 'win32') return
  const window = handle.length >= 8 ? Number(handle.readBigUInt64LE()) : handle.readUInt32LE()
  const api = (native ??= windowsAPI())
  if (window && api.owner(window) === process.pid) api.focus(window)
}

export interface WindowInputControl {
  setRemote(remote: boolean): Promise<void>
  configure(settings: InputSettings): Promise<void>
}

/** Keep control mode independent of mouse focus; verify ownership before each mutation. */
export function createMediaWindow(
  pid: number,
  settings: InputSettings,
  input?: WindowInputControl,
  api = (native ??= windowsAPI())
): MediaWindow {
  const processHandle = api.open(0x100000, 0, pid)
  if (!processHandle) throw new Error('Cannot access the remote window process')
  let closed = false
  let window = 0
  let mode: 'local' | 'remote' = 'remote'
  let seenRemote = false
  let pending: Promise<unknown> = Promise.resolve()
  let polling = false
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task)
    pending = result.catch(() => {})
    return result
  }
  function alive(): boolean {
    return !closed && api.wait(processHandle, 0) === 258
  }
  function ownedWindow(required = true): number {
    if (!alive()) throw new Error('The remote window has closed')
    const front = api.foreground()
    if (front && api.owner(front) === pid) window = front
    const found = api.find(pid)
    if (found) window = found
    if (window && api.owner(window) !== pid) window = 0
    if (!window && required)
      throw new Error('The remote window is still opening; try again in a moment')
    return window
  }
  async function local() {
    const target = ownedWindow(false)
    await input?.setRemote(false)
    mode = 'local'
    seenRemote = false
    if (target) {
      api.show(target, settings.lockInput ? 0 : 6) // SW_HIDE / SW_MINIMIZE
      api.topmost(target, false)
    }
  }
  async function show() {
    const target = ownedWindow()
    await input?.setRemote(true)
    mode = 'remote'
    seenRemote = false
    api.show(target, api.minimized(target) ? 9 : 5) // SW_RESTORE / SW_SHOW
    api.topmost(target, settings.lockInput)
    api.focus(target)
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!alive()) throw new Error('The remote window has closed')
      if (api.owner(api.foreground()) === pid) {
        seenRemote = true
        return
      }
      if (api.visible(target)) api.focus(target)
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    await local()
    throw new Error('Windows could not focus the remote window; press the switch shortcut to retry')
  }
  function close() {
    if (closed) return
    if (alive() && window && api.owner(window) === pid) api.topmost(window, false)
    closed = true
    clearInterval(timer)
    api.close(processHandle)
  }
  const timer = setInterval(() => {
    if (!alive()) {
      close()
      return
    }
    if (polling) return
    polling = true
    void enqueue(async () => {
      if (!alive()) return
      const front = api.foreground()
      if (front && api.owner(front) === pid) window = front
      if (mode === 'local' && settings.lockInput) {
        // A click, task switcher, or external activation cannot change the selected system.
        if (!window) window = api.find(pid)
        if (window && api.owner(window) === pid && api.visible(window)) api.show(window, 0)
      } else if (mode === 'remote') {
        // A slow host handshake can outlive Windows' initial activation grant.
        // Start protection once the selected player's window is actually visible,
        // even if a local app prevented its first foreground activation.
        if (!seenRemote && settings.lockInput) {
          const target = api.find(pid)
          if (target && api.owner(target) === pid && api.visible(target)) {
            window = target
            seenRemote = true
          }
        }
        if (front && api.owner(front) === pid) seenRemote = true
        if (seenRemote && settings.lockInput && window && api.owner(window) === pid) {
          // Focus loss is not a switch request. Games and screen-capture tools may
          // activate themselves; keep the selected stream above ordinary popups.
          api.topmost(window, true)
          if (!api.visible(window) || api.minimized(window)) api.show(window, 9)
          if (front && api.owner(front) !== pid) api.focus(window)
        }
      }
    })
      .catch(() => {})
      .finally(() => {
        polling = false
      })
  }, 50)
  timer.unref()
  return {
    get mode() {
      return mode
    },
    toggle: () =>
      enqueue(async () => {
        // Free window mode follows focus; locked mode only follows explicit transitions.
        if (settings.lockInput ? mode === 'remote' : api.owner(api.foreground()) === pid) {
          await local()
          return 'local'
        }
        await show()
        return 'remote'
      }),
    show: () => enqueue(show),
    hide: () => enqueue(local),
    configure: (value) =>
      enqueue(async () => {
        if (value.lockInput && !input)
          throw new Error('Reconnect with the latest Lanto player to lock input')
        await input?.configure(value)
        settings = value
        if (mode === 'local' && settings.lockInput) {
          const target = ownedWindow(false)
          if (target) api.show(target, 0)
        }
        if (window && api.owner(window) === pid)
          api.topmost(window, mode === 'remote' && settings.lockInput)
      }),
    close
  }
}

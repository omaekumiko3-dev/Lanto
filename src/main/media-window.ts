import koffi from 'koffi'

export interface MediaWindow {
  toggle(): Promise<'local' | 'remote'>
  show(): Promise<void>
  configure(minimize: boolean): Promise<void>
  close(): void
}

function windowsAPI() {
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
  const parent = user.func('uintptr_t __stdcall GetWindow(uintptr_t window, uint32_t command)')
  const processId = user.func(
    'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t window, _Out_ uint32_t *pid)'
  )
  const api = {
    foreground: user.func('uintptr_t __stdcall GetForegroundWindow()'),
    minimized: user.func('int __stdcall IsIconic(uintptr_t window)'),
    show: user.func('int __stdcall ShowWindowAsync(uintptr_t window, int command)'),
    focus: user.func('int __stdcall SetForegroundWindow(uintptr_t window)'),
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
        if (api.owner(window) !== pid || !visible(window) || parent(window, 4)) return 1
        const box = { left: 0, top: 0, right: 0, bottom: 0 }
        if (!bounds(window, box)) return 1
        const size = (box.right - box.left) * (box.bottom - box.top)
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

/** Run in the process receiving the global shortcut, so Windows permits activation. */
export function createMediaWindow(pid: number, minimize: boolean): MediaWindow {
  const api = (native ??= windowsAPI())
  const process = api.open(0x100000, 0, pid) // SYNCHRONIZE
  if (!process) throw new Error('Cannot access the remote window process')
  let closed = false
  let window = 0
  let wasRemote = false

  function alive(): boolean {
    return !closed && api.wait(process, 0) === 258
  }
  function ownedWindow(): number {
    if (!alive()) throw new Error('The remote window has closed')
    const front = api.foreground()
    if (front && api.owner(front) === pid) window = front
    if (!window || api.owner(window) !== pid) window = api.find(pid)
    if (!window) throw new Error('The remote window is still opening; try again in a moment')
    return window
  }
  function close() {
    if (closed) return
    closed = true
    clearInterval(timer)
    api.close(process)
  }
  // Track the original process handle and check window ownership before every mutation.
  // Startup and zero-foreground transitions must not minimize a window never focused.
  const timer = setInterval(() => {
    if (!alive()) {
      close()
      return
    }
    const front = api.foreground()
    if (!front) return
    const remote = api.owner(front) === pid
    if (remote) window = front
    if (wasRemote && !remote && minimize && window && api.owner(window) === pid) api.show(window, 6)
    wasRemote = remote
  }, 50)
  timer.unref()

  async function show() {
    const target = ownedWindow()
    if (api.minimized(target)) api.show(target, 9) // SW_RESTORE
    api.focus(target)
    // Cross-process restoration is asynchronous. Verify actual focus before reporting success.
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!alive()) throw new Error('The remote window has closed')
      if (api.owner(api.foreground()) === pid) {
        wasRemote = true
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Windows could not focus the remote window; select it from the taskbar')
  }

  return {
    async toggle() {
      const target = ownedWindow()
      if (api.owner(api.foreground()) === pid) {
        if (minimize) api.show(target, 6) // SW_MINIMIZE
        wasRemote = false
        return 'local'
      }
      await show()
      return 'remote'
    },
    show,
    async configure(value) {
      minimize = value
    },
    close
  }
}

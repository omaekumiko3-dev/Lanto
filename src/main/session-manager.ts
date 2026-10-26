import type { Device, DeviceAudio, SessionState, Settings } from '../shared/model.ts'
import type { MediaWindow } from './media-window.ts'
import type { InputSettings } from './input-control.ts'

export interface MediaExit {
  code: number | null
  signal: string | null
}
export interface MediaHandle {
  pid: number
  closed: Promise<MediaExit>
  stop(): Promise<void>
  setAudio?(audio: DeviceAudio): Promise<void>
  window?: MediaWindow
}
export interface MediaAdapter {
  start(device: Device, settings: Settings): Promise<MediaHandle>
}
const idle = (): SessionState => ({
  phase: 'idle',
  deviceId: null,
  pid: null,
  startedAt: null,
  error: null
})
interface Active {
  handle: MediaHandle
  device: Device
  stopping: boolean
  state: SessionState
  input: InputSettings
}

export class SessionManager {
  state = idle()
  private selected: string | null = null
  private active = new Map<string, Active>()
  private pending: Promise<unknown> = Promise.resolve()
  private inputEpoch = 0
  private readonly adapter: MediaAdapter
  private readonly onState: (state: SessionState) => void
  private readonly onActivity: (message: string, error?: boolean) => void
  constructor(
    adapter: MediaAdapter,
    onState: (state: SessionState) => void,
    onActivity: (message: string, error?: boolean) => void
  ) {
    this.adapter = adapter
    this.onState = onState
    this.onActivity = onActivity
  }

  get sessions(): SessionState[] {
    return [...this.active.values()].map((entry) => ({ ...entry.state }))
  }
  get controlDeviceId(): string | null {
    return this.selected && this.active.get(this.selected)?.handle.window?.mode === 'local'
      ? null
      : this.selected
  }
  get busy(): boolean {
    return this.active.size > 0 || this.state.phase === 'launching'
  }
  has(id: string): boolean {
    return this.active.has(id)
  }
  owns(pid: number): boolean {
    return [...this.active.values()].some((entry) => entry.handle.pid === pid)
  }
  private set(state: SessionState): void {
    this.state = state
    this.onState({ ...state })
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.pending.then(task)
    this.pending = result.catch(() => {})
    return result
  }

  connect(device: Device, settings: Settings): Promise<void> {
    const epoch = this.inputEpoch
    return this.enqueue(async () => {
      if (epoch !== this.inputEpoch) return
      if (!device.host) throw new Error('Enter the IP address or hostname of this device first')
      if (this.active.has(device.id)) return
      if (this.active.size >= 2)
        throw new Error(
          'Two devices are already connected; disconnect one before connecting another'
        )
      // Release the previous owner before a new player can acquire focus or capture input.
      await this.select(null, epoch)
      this.set({ ...idle(), phase: 'launching', deviceId: device.id })
      try {
        const handle = await this.adapter.start(device, settings)
        const state: SessionState = {
          phase: 'running',
          deviceId: device.id,
          pid: handle.pid,
          startedAt: new Date().toISOString(),
          error: null
        }
        const active = {
          handle,
          device,
          stopping: false,
          state,
          input: { lockInput: settings.lockInput, returnShortcut: settings.returnShortcut }
        }
        this.active.set(device.id, active)
        if (epoch !== this.inputEpoch) {
          if (handle.window?.emergency) await handle.window.emergency()
          else await handle.window?.hide()
          this.selected = null
        } else this.selected = device.id
        this.set(state)
        this.onActivity(
          `${device.name} Moonlight client started; see its window for streaming status`
        )
        void handle.closed.then(({ code, signal }) => {
          if (this.active.get(device.id) !== active) return
          this.active.delete(device.id)
          if (this.selected === device.id) this.selected = null
          if (active.stopping || code === 0) this.set(this.sessions.at(-1) ?? idle())
          else {
            const error = `${device.name}: Moonlight exited (${signal || code || 'unknown reason'}); check pairing, host address, and Sunshine status`
            this.set({ ...state, phase: 'failed', pid: null, error })
            this.onActivity(error, true)
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Client startup failed'
        this.set({ ...idle(), phase: 'failed', deviceId: device.id, error: message })
        this.onActivity(message, true)
        throw error
      }
    })
  }

  disconnect(id?: string): Promise<void> {
    return this.enqueue(async () => {
      const targets = id
        ? [this.active.get(id)].filter((value): value is Active => Boolean(value))
        : [...this.active.values()]
      const failures: unknown[] = []
      for (const active of targets) {
        active.stopping = true
        active.state = { ...active.state, phase: 'stopping' }
        this.set(active.state)
        try {
          // A window may already have disappeared; stopping its owned process must still run.
          await active.handle.window?.hide().catch(() => {})
          if (this.selected === active.device.id) this.selected = null
          await active.handle.stop()
          if (this.active.get(active.device.id) === active) this.active.delete(active.device.id)
          this.onActivity(`Stopped ${active.device.name} local streaming client`)
        } catch (error) {
          active.stopping = false
          active.state = {
            ...active.state,
            phase: 'failed',
            error: 'The client could not exit; disconnect manually in Moonlight and retry'
          }
          this.set(active.state)
          failures.push(error)
        }
      }
      if (failures.length) throw failures[0]
      this.set(this.sessions.at(-1) ?? idle())
    })
  }

  setAudio(id: string, audio: DeviceAudio): Promise<void> {
    return this.enqueue(async () => {
      const active = this.active.get(id)
      if (!active || active.stopping) return
      if (!active.handle.setAudio)
        throw new Error(
          'The current player does not support volume control; select the latest Lanto player in settings and reconnect'
        )
      await active.handle.setAudio(audio)
    })
  }

  private async select(id: string | null, epoch = this.inputEpoch): Promise<void> {
    if (epoch !== this.inputEpoch) return
    for (const entry of this.active.values()) {
      if (entry.device.id !== id) await entry.handle.window?.hide()
    }
    this.selected = null
    if (epoch !== this.inputEpoch) return
    if (id) {
      const active = this.active.get(id)
      if (!active || active.stopping) {
        this.onState(this.state)
        return
      }
      if (!active.handle.window) throw new Error('Window switching requires the Windows controller')
      try {
        await active.handle.window.show()
        if (epoch !== this.inputEpoch) {
          await active.handle.window.hide()
          return
        }
        this.selected = id
      } finally {
        this.onState(this.state)
      }
    } else this.onState(this.state)
  }

  toggleWindow(): Promise<'local' | 'remote'> {
    const epoch = this.inputEpoch
    return this.enqueue(async () => {
      if (epoch !== this.inputEpoch) return 'local'
      const cycle: Array<string | null> = [
        null,
        ...[...this.active.values()]
          .filter((entry) => !entry.stopping)
          .map((entry) => entry.device.id)
      ]
      const next = cycle[(Math.max(0, cycle.indexOf(this.controlDeviceId)) + 1) % cycle.length]!
      await this.select(next, epoch)
      return this.controlDeviceId ? 'remote' : 'local'
    })
  }
  hideWindow(): Promise<void> {
    return this.enqueue(() => this.select(null))
  }
  showWindow(id?: string): Promise<void> {
    const epoch = this.inputEpoch
    return this.enqueue(() => this.select(id ?? this.active.keys().next().value ?? null, epoch))
  }
  async emergencyReturn(): Promise<void> {
    ++this.inputEpoch
    this.selected = null
    this.onState(this.state)
    await Promise.all(
      [...this.active.values()].map((entry) => {
        const window = entry.handle.window
        return window?.emergency ? window.emergency() : window?.hide()
      })
    )
  }
  configureWindow(settings: InputSettings): Promise<void> {
    return this.enqueue(async () => {
      const changed: Array<{ entry: Active; previous: InputSettings }> = []
      try {
        for (const entry of this.active.values()) {
          const previous = entry.input
          // A configure call may update the player before a later window operation fails.
          changed.push({ entry, previous })
          await entry.handle.window?.configure(settings)
          entry.input = { lockInput: settings.lockInput, returnShortcut: settings.returnShortcut }
        }
      } catch (error) {
        for (const { entry, previous } of changed.reverse()) {
          await entry.handle.window?.configure(previous).catch(async () => {
            await entry.handle.window?.hide().catch(() => {})
            this.onActivity(`Reconnect ${entry.device.name} to restore its input settings`, true)
          })
          entry.input = previous
        }
        throw error
      }
    })
  }
}

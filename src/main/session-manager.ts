import type { Device, DeviceAudio, SessionState, Settings } from '../shared/model.ts'

export interface MediaExit {
  code: number | null
  signal: string | null
}

export interface MediaHandle {
  pid: number
  closed: Promise<MediaExit>
  stop(): Promise<void>
  setAudio?(audio: DeviceAudio): Promise<void>
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

export class SessionManager {
  state = idle()
  private active: { handle: MediaHandle; device: Device; stopping: boolean } | null = null
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    privateAdapter: MediaAdapter,
    onState: (state: SessionState) => void,
    onActivity: (message: string, error?: boolean) => void
  ) {
    this.adapter = privateAdapter
    this.onState = onState
    this.onActivity = onActivity
  }

  private readonly adapter: MediaAdapter
  private readonly onState: (state: SessionState) => void
  private readonly onActivity: (message: string, error?: boolean) => void

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
    return this.enqueue(async () => {
      if (!device.host) throw new Error('Enter this device’s IP address or hostname first')
      if (this.active?.device.id === device.id && !this.active.stopping) return
      await this.stopActive()
      this.set({ ...idle(), phase: 'launching', deviceId: device.id })
      try {
        const handle = await this.adapter.start(device, settings)
        const active = { handle, device, stopping: false }
        this.active = active
        this.set({
          phase: 'running',
          deviceId: device.id,
          pid: handle.pid,
          startedAt: new Date().toISOString(),
          error: null
        })
        this.onActivity(`${device.name} Moonlight client has started; check its window for streaming status`)
        void handle.closed.then(({ code, signal }) => {
          if (this.active !== active) return
          this.active = null
          if (active.stopping || code === 0) {
            this.set(idle())
          } else {
            const error = `Moonlight exited (${signal || code || 'unknown reason'}), check pairing, host address, and Sunshine status`
            this.set({ ...this.state, phase: 'failed', pid: null, error })
            this.onActivity(error, true)
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Client failed to start'
        this.set({ ...idle(), phase: 'failed', deviceId: device.id, error: message })
        this.onActivity(message, true)
        throw error
      }
    })
  }

  disconnect(): Promise<void> {
    return this.enqueue(async () => {
      await this.stopActive()
      this.set(idle())
    })
  }

  setAudio(id: string, audio: DeviceAudio): Promise<void> {
    return this.enqueue(async () => {
      if (!this.active || this.active.device.id !== id || this.active.stopping) return
      if (!this.active.handle.setAudio)
        throw new Error('The current player does not support volume control. Select a newer Lanto player in Settings, then reconnect')
      await this.active.handle.setAudio(audio)
    })
  }

  private async stopActive(): Promise<void> {
    const active = this.active
    if (!active) return
    active.stopping = true
    this.set({ ...this.state, phase: 'stopping' })
    try {
      await active.handle.stop()
      if (this.active === active) this.active = null
      this.set(idle())
      this.onActivity(`Ended ${active.device.name} local streaming client`)
    } catch (error) {
      const message = 'Client failed to exit. Disconnect manually in Moonlight and try again'
      this.set({ ...this.state, phase: 'failed', error: message })
      this.onActivity(message, true)
      throw error
    }
  }
}

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../common/serial-queue.ts'
import { HostClient } from '../controller/host-client.ts'
import { TrustStore } from '../controller/trust-store.ts'
import { discoverHosts } from '../protocol/discovery.ts'
import { defaultConfig } from '../shared/model.ts'
import type { Activity, AppState, Config, Device, ProbeResult } from '../shared/model.ts'
import {
  deviceIdSchema,
  deviceInputSchema,
  readableError,
  settingsSchema
} from '../shared/validation.ts'
import { ConfigStore } from './config-store.ts'
import { findMoonlight, MoonlightAdapter } from './moonlight.ts'
import { probeSunshine } from './probe.ts'
import { systemVault } from './secret-vault.ts'
import { SessionManager } from './session-manager.ts'
import { ReturnShortcut } from './shortcuts.ts'

export class Workbench {
  private config: Config = defaultConfig()
  private readonly store: ConfigStore
  private readonly trust: TrustStore
  private readonly hosts: HostClient
  private readonly queue = new SerialQueue()
  private readonly adapter = new MoonlightAdapter()
  private readonly session: SessionManager
  private readonly shortcut: ReturnShortcut
  private readonly activity: Activity[] = []
  private readonly directory: string
  private readonly version: string
  private readonly changed: () => void
  private readonly focusLocal: () => void
  private moonlightPath: string | null = null
  private epoch = 0
  private closing = false

  constructor(options: {
    directory: string
    version: string
    changed: () => void
    focusLocal: () => void
  }) {
    this.directory = options.directory
    this.version = options.version
    this.changed = options.changed
    this.focusLocal = options.focusLocal
    this.store = new ConfigStore(this.directory)
    this.trust = new TrustStore(this.directory, systemVault)
    this.hosts = new HostClient(this.trust)
    this.session = new SessionManager(this.adapter, this.changed, (message, error) =>
      this.log(message, error)
    )
    this.shortcut = new ReturnShortcut(() => {
      void this.returnLocal().catch((error: unknown) => this.log(readableError(error), true))
    })
  }

  async load(): Promise<void> {
    this.config = await this.store.load()
    await this.trust.load()
    this.moonlightPath = await findMoonlight(this.config.settings.moonlightPath)
    this.shortcut.start(this.config.settings.returnShortcut)
    this.log('Local workbench is ready')
    if (!this.shortcut.registered) this.log('Failed to register the return shortcut. Change the key combination in Settings', true)
  }

  snapshot(): AppState {
    return {
      config: this.config,
      session: this.session.state,
      trustedHosts: this.hosts.list(),
      runtime: {
        version: this.version,
        platform: process.platform,
        moonlightPath: this.moonlightPath,
        shortcutRegistered: this.shortcut.registered,
        configDirectory: this.directory
      },
      activity: [...this.activity]
    }
  }

  log(message: string, error = false): void {
    this.activity.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: error ? 'error' : 'info',
      message
    })
    this.activity.splice(60)
    this.changed()
  }

  private async persist(config: Config): Promise<void> {
    await this.store.save(config)
    this.config = config
    this.moonlightPath = await findMoonlight(config.settings.moonlightPath)
    this.changed()
  }

  private device(input: unknown): Device {
    const id = deviceIdSchema.parse(input)
    const device = this.config.devices.find((entry) => entry.id === id)
    if (!device) throw new Error('Device does not exist. Refresh and try again')
    return device
  }

  saveDevice(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const value = deviceInputSchema.parse(input)
      const previous = value.id ? this.device(value.id) : undefined
      if (previous?.hostId !== value.hostId) throw new Error('Host identity can only be established through pairing')
      if (
        previous?.hostId &&
        (previous.host !== value.host || previous.platform !== value.platform)
      )
        throw new Error('The address and system of a paired device are managed by Host identity; pair again after the address changes')
      if (value.id === this.session.state.deviceId && this.session.state.pid !== null)
        throw new Error('Return to this machine before editing the current session’s device')
      const device = { ...value, id: value.id || randomUUID() }
      const devices = previous
        ? this.config.devices.map((entry) => (entry.id === device.id ? device : entry))
        : [...this.config.devices, device]
      await this.persist({ ...this.config, devices })
      this.log(`${device.name} configuration saved`)
      return this.snapshot()
    })
  }

  removeDevice(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const device = this.device(input)
      if (device.id === this.session.state.deviceId && this.session.state.pid !== null)
        throw new Error('Return to this machine before removing this device')
      if (device.hostId) await this.hosts.unpair(device.hostId)
      await this.persist({
        ...this.config,
        devices: this.config.devices.filter((entry) => entry.id !== device.id)
      })
      this.log(`Removed ${device.name}${device.hostId ? ' and revoked Host authorization' : ''}`)
      return this.snapshot()
    })
  }

  saveSettings(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const settings = settingsSchema.parse(input)
      if (settings.moonlightPath && !isAbsolute(settings.moonlightPath))
        throw new Error('Moonlight path must be an absolute path')
      if (settings.moonlightPath && !(await findMoonlight(settings.moonlightPath)))
        throw new Error('The selected Moonlight file does not exist or is not executable')
      await this.shortcut.update(settings.returnShortcut, () =>
        this.persist({ ...this.config, settings })
      )
      this.log('Client settings saved')
      return this.snapshot()
    })
  }

  connect(input: unknown): Promise<void> {
    const epoch = this.epoch
    return this.queue.run(async () => {
      if (this.closing || epoch !== this.epoch) return
      if (!this.shortcut.registered) throw new Error('Register an available return shortcut in Settings first')
      const device = this.device(input)
      if (device.hostId) {
        const host = await this.hosts.refresh(device.hostId)
        this.changed()
        if (!host.status || !host.status.sunshineReachable)
          throw new Error(host.error || 'Host is connected, but Sunshine has not started or its port is unreachable')
      }
      if (this.closing || epoch !== this.epoch) return
      await this.session.connect(device, this.config.settings)
    })
  }

  async returnLocal(): Promise<void> {
    this.epoch++
    this.focusLocal()
    await this.session.disconnect()
    this.focusLocal()
  }

  openMoonlight(): Promise<void> {
    return this.queue.run(async () => {
      if (this.session.state.pid !== null)
        throw new Error('Return to this machine before opening the Moonlight pairing window')
      await this.adapter.open(this.config.settings)
      this.log('Moonlight opened. Complete streaming pairing there')
    })
  }

  async probe(input: unknown): Promise<ProbeResult> {
    const device = this.device(input)
    if (!device.hostId) return probeSunshine(device.host)
    const host = await this.hosts.refresh(device.hostId)
    this.changed()
    return {
      reachable: Boolean(host.status),
      message:
        host.error ||
        (host.status?.sunshineReachable
          ? 'Host is connected and the Sunshine port is reachable; streaming pairing still needs to be confirmed in Moonlight'
          : 'Host is connected, but Sunshine has not started or its port is unreachable')
    }
  }

  discoverHosts() {
    return discoverHosts()
  }

  pairHost(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      if (this.session.state.pid !== null) throw new Error('Return to this machine before pairing the Host')
      const ticket = z.string().max(16000).parse(input)
      const host = await this.hosts.pair(ticket)
      const existing = this.config.devices.find((entry) => entry.hostId === host.id)
      const device: Device = {
        id: existing?.id || randomUUID(),
        hostId: host.id,
        name: host.name.slice(0, 50),
        platform: host.platform,
        host: host.address,
        appName: existing?.appName || 'Desktop'
      }
      const devices = existing
        ? this.config.devices.map((entry) => (entry.id === device.id ? device : entry))
        : [...this.config.devices, device]
      await this.persist({ ...this.config, devices })
      this.log(`${host.name} Host pairing for the device is complete; Moonlight pairing is still required for the first stream`)
      return this.snapshot()
    })
  }

  async close(): Promise<void> {
    this.closing = true
    this.epoch++
    this.shortcut.close()
    await this.queue.drain()
    await this.session.disconnect()
  }
}

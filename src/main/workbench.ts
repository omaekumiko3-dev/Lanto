import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../common/serial-queue.ts'
import { HostClient } from '../controller/host-client.ts'
import { TrustStore } from '../controller/trust-store.ts'
import { discoverHosts } from '../protocol/discovery.ts'
import { defaultConfig } from '../shared/model.ts'
import type { Activity, AppState, Config, Device, ProbeResult } from '../shared/model.ts'
import {
  deviceIdSchema,
  deviceAudioSchema,
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
import { ClipboardSync } from './clipboard-sync.ts'
import { DeploymentManager } from '../deploy/manager.ts'
import { decodeTicket } from '../protocol/pair-ticket.ts'
import { DirectTunnels } from '../controller/tunnel.ts'
import type { TunnelEndpoint } from '../protocol/tunnel.ts'

export class Workbench {
  private config: Config = defaultConfig()
  private readonly store: ConfigStore
  private readonly trust: TrustStore
  private readonly hosts: HostClient
  private readonly queue = new SerialQueue()
  private readonly adapter: MoonlightAdapter
  private readonly session: SessionManager
  private readonly shortcut: ReturnShortcut
  private readonly clipboard: ClipboardSync
  readonly deployment: DeploymentManager
  private readonly tunnels: DirectTunnels
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
    deploymentResources: string
  }) {
    this.directory = options.directory
    this.version = options.version
    this.changed = options.changed
    this.focusLocal = options.focusLocal
    this.store = new ConfigStore(this.directory)
    this.trust = new TrustStore(this.directory, systemVault)
    this.tunnels = new DirectTunnels({
      directory: this.directory,
      resources: options.deploymentResources,
      vault: systemVault
    })
    this.hosts = new HostClient(this.trust)
    this.clipboard = new ClipboardSync(this.trust, this.directory, this.changed)
    this.deployment = new DeploymentManager({
      directory: this.directory,
      resources: options.deploymentResources,
      changed: this.changed,
      available: () => !this.closing && this.session.state.pid === null,
      media: () => findMoonlight(this.config.settings.moonlightPath),
      tunnels: this.tunnels,
      controllerId: () => this.trust.controllerId,
      pair: async (ticket, tunnel) => {
        const id = decodeTicket(ticket).hostId
        const state = await this.pairHost(ticket, tunnel)
        const device = state.config.devices.find((entry) => entry.hostId === id)
        if (!device) throw new Error('Failed to add device')
        const trusted = state.trustedHosts.find((entry) => entry.id === id)
        if (!trusted?.status) throw new Error(trusted?.error || 'Cannot connect to Host')
        await this.clipboard.configure({
          enabled: this.config.settings.shareClipboard,
          files: this.config.settings.shareFiles
        })
        return device.id
      }
    })
    this.adapter = new MoonlightAdapter(join(this.directory, 'media-logs'))
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
    await this.tunnels.load()
    for (const device of this.config.devices) {
      if (!device.tunnel) continue
      if (!device.hostId || device.host !== this.tunnels.address(device.hostId))
        throw new Error(
          'A direct tunnel device has an invalid local address; restore its saved configuration'
        )
      await this.tunnels
        .start(device.hostId, device.tunnel)
        .catch((error) => this.log(readableError(error), true))
    }
    // Device config is authoritative if a previous save stopped between the two files.
    for (const host of this.trust.list()) {
      const device = this.config.devices.find((entry) => entry.hostId === host.id)
      if (device && device.host !== host.address)
        await this.trust.updateAddress(host.id, device.host)
    }
    this.moonlightPath = await findMoonlight(this.config.settings.moonlightPath)
    this.shortcut.start(this.config.settings.returnShortcut)
    await this.clipboard.configure({
      enabled: this.config.settings.shareClipboard,
      files: this.config.settings.shareFiles
    })
    this.log('Local workspace ready')
    if (!this.shortcut.registered)
      this.log(
        'The return shortcut could not be registered; choose another combination in settings',
        true
      )
  }

  snapshot(): AppState {
    return {
      config: this.config,
      session: this.session.state,
      clipboard: this.clipboard.snapshot(),
      deployment: this.deployment.snapshot(),
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
    if (!device) throw new Error('Device not found; refresh and retry')
    return device
  }

  saveDevice(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const value = deviceInputSchema.parse(input)
      const previous = value.id ? this.device(value.id) : undefined
      if (previous?.hostId !== value.hostId)
        throw new Error('Host identity can only be established through pairing')
      if (Boolean(previous?.tunnel) !== Boolean(value.tunnel))
        throw new Error('Set up or change the connection mode through Add device via SSH')
      if (previous?.tunnel && value.host !== previous.host)
        throw new Error('Edit the tunnel endpoint; its local address is managed by Lanto')
      if (previous?.hostId && previous.platform !== value.platform)
        throw new Error(
          'The system of a paired device is managed by its Host identity; pair again after changing systems'
        )
      if (previous?.hostId && !value.host)
        throw new Error('Paired devices require an IP address or hostname')
      const device = {
        ...value,
        id: value.id || randomUUID(),
        volume: previous?.volume ?? value.volume,
        muted: previous?.muted ?? value.muted
      }
      const devices = previous
        ? this.config.devices.map((entry) => (entry.id === device.id ? device : entry))
        : [...this.config.devices, device]
      const addressChanged = previous?.hostId && previous.host !== device.host
      if (addressChanged) await this.hosts.updateAddress(previous.hostId!, device.host)
      try {
        await this.persist({ ...this.config, devices })
      } catch (error) {
        if (addressChanged) await this.hosts.updateAddress(previous.hostId!, previous.host)
        throw error
      }
      this.log(`${device.name} configuration saved`)
      return this.snapshot()
    })
  }

  removeDevice(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const device = this.device(input)
      if (device.id === this.session.state.deviceId && this.session.state.pid !== null)
        throw new Error('Disconnect before removing this device')
      if (device.hostId) await this.hosts.unpair(device.hostId)
      await this.persist({
        ...this.config,
        devices: this.config.devices.filter((entry) => entry.id !== device.id)
      })
      if (device.tunnel && device.hostId) await this.tunnels.remove(device.hostId)
      this.log(`Removed ${device.name}${device.hostId ? ' and revoked Host authorization' : ''}`)
      return this.snapshot()
    })
  }

  setDeviceAudio(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const audio = deviceAudioSchema.parse(input)
      const device = this.device(audio.id)
      if (device.volume === audio.volume && device.muted === audio.muted) return this.snapshot()
      await this.session.setAudio(device.id, audio)
      try {
        await this.persist({
          ...this.config,
          devices: this.config.devices.map((entry) =>
            entry.id === device.id ? { ...entry, volume: audio.volume, muted: audio.muted } : entry
          )
        })
      } catch (error) {
        await this.session.setAudio(device.id, device)
        throw error
      }
      return this.snapshot()
    })
  }

  saveSettings(input: unknown): Promise<AppState> {
    return this.queue.run(async () => {
      const settings = settingsSchema.parse(input)
      if (settings.moonlightPath && !isAbsolute(settings.moonlightPath))
        throw new Error('The Moonlight path must be absolute')
      if (settings.moonlightPath && !(await findMoonlight(settings.moonlightPath)))
        throw new Error('The selected Moonlight file does not exist or is not executable')
      await this.shortcut.update(settings.returnShortcut, () =>
        this.persist({ ...this.config, settings })
      )
      await this.clipboard.configure({
        enabled: settings.shareClipboard,
        files: settings.shareFiles
      })
      this.log('Client settings saved')
      return this.snapshot()
    })
  }

  connect(input: unknown): Promise<void> {
    if (
      ['connecting', 'host-key', 'inspecting', 'deploying'].includes(
        this.deployment.snapshot().phase
      )
    )
      return Promise.reject(new Error('Wait for device deployment to finish or cancel it first'))
    const epoch = this.epoch
    return this.queue.run(async () => {
      if (this.closing || epoch !== this.epoch) return
      if (!this.shortcut.registered)
        throw new Error('Register an available return shortcut in settings first')
      const device = this.device(input)
      if (device.tunnel && device.hostId) {
        await this.tunnels.start(device.hostId, device.tunnel)
        await this.tunnels.verify(device.hostId)
      }
      if (device.hostId) {
        const host = await this.hosts.refresh(device.hostId)
        this.changed()
        if (!host.status || !host.status.sunshineReachable)
          throw new Error(
            host.error || 'Host is connected but Sunshine is not running or its port is unreachable'
          )
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
        throw new Error('Disconnect before opening the Moonlight pairing window')
      await this.adapter.open(this.config.settings)
      this.log('Moonlight opened; complete streaming pairing there')
    })
  }

  async probe(input: unknown): Promise<ProbeResult> {
    const device = this.device(input)
    if (device.tunnel && device.hostId) {
      try {
        await this.tunnels.start(device.hostId, device.tunnel)
        await this.tunnels.verify(device.hostId)
      } catch (error) {
        return { reachable: false, message: readableError(error) }
      }
    }
    if (!device.hostId) return probeSunshine(device.host)
    const host = await this.hosts.refresh(device.hostId)
    this.changed()
    return {
      reachable: Boolean(host.status),
      message:
        host.error ||
        (host.status?.sunshineReachable
          ? 'Host connected and Sunshine port reachable; confirm streaming pairing in Moonlight'
          : 'Host connected; Sunshine is not running or its port is unreachable')
    }
  }

  discoverHosts() {
    return discoverHosts()
  }

  pairHost(input: unknown, tunnel?: TunnelEndpoint): Promise<AppState> {
    return this.queue.run(async () => {
      if (this.session.state.pid !== null) throw new Error('Disconnect before pairing Host')
      const ticket = z.string().max(16000).parse(input)
      const host = await this.hosts.pair(ticket)
      const existing = this.config.devices.find((entry) => entry.hostId === host.id)
      const device: Device = {
        id: existing?.id || randomUUID(),
        hostId: host.id,
        name: existing?.name || host.name.slice(0, 50),
        platform: host.platform,
        host: host.address,
        appName: existing?.appName || 'Desktop',
        volume: existing?.volume ?? 100,
        muted: existing?.muted ?? false,
        ...(tunnel ? { tunnel } : {})
      }
      const devices = existing
        ? this.config.devices.map((entry) => (entry.id === device.id ? device : entry))
        : [...this.config.devices, device]
      await this.persist({ ...this.config, devices })
      if (existing?.tunnel && !tunnel) await this.tunnels.stop(host.id)
      this.log(`${host.name} Host pairing completed`)
      return this.snapshot()
    })
  }

  async close(): Promise<void> {
    this.closing = true
    this.deployment.cancel()
    this.epoch++
    this.shortcut.close()
    await this.queue.drain()
    await this.clipboard.stop()
    await this.session.disconnect()
    await this.tunnels.close()
  }
  cancelClipboardTransfer(): void {
    this.clipboard.cancel()
  }
}

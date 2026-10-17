import type { DiscoveredHost, TrustedHostView } from '../protocol/host.ts'
import type { ClipboardView } from '../protocol/clipboard.ts'
import type { DeploymentView, SshConnectionInput } from '../protocol/deployment.ts'
import type { TunnelEndpoint } from '../protocol/tunnel.ts'
export type Platform = 'linux' | 'macos' | 'windows'

export interface DeviceAudio {
  volume: number
  muted: boolean
}

export interface Device extends DeviceAudio {
  id: string
  name: string
  host: string
  platform: Platform
  appName: string
  hostId?: string
  tunnel?: TunnelEndpoint
}

export type DeviceInput = Omit<Device, 'id' | keyof DeviceAudio> &
  Partial<DeviceAudio> & { id?: string }

export interface Settings {
  moonlightPath: string
  returnShortcut: string
  resolution: '3840x2160' | '2560x1440' | '1920x1080'
  fps: number
  bitrateMbps: number
  windowMode: 'borderless' | 'windowed'
  lowLatency: boolean
  showPerformanceOverlay: boolean
  windowsPipeline: 'auto' | 'shared-bind'
  localCursor: boolean
  shareClipboard: boolean
  shareFiles: boolean
}

export interface Config {
  schemaVersion: 1
  devices: Device[]
  settings: Settings
}

export interface SessionState {
  phase: 'idle' | 'launching' | 'running' | 'stopping' | 'failed'
  deviceId: string | null
  pid: number | null
  startedAt: string | null
  error: string | null
}

export interface Activity {
  id: string
  timestamp: string
  level: 'info' | 'error'
  message: string
}

export interface AppState {
  config: Config
  session: SessionState
  clipboard: ClipboardView
  deployment: DeploymentView
  runtime: {
    version: string
    platform: string
    moonlightPath: string | null
    shortcutRegistered: boolean
    configDirectory: string
  }
  activity: Activity[]
  trustedHosts: TrustedHostView[]
}

export interface ProbeResult {
  reachable: boolean
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface LantoAPI {
  controlWindow(action: WindowAction): Promise<void>
  getState(): Promise<AppState>
  saveDevice(input: DeviceInput): Promise<AppState>
  setDeviceAudio(input: DeviceAudio & { id: string }): Promise<AppState>
  removeDevice(id: string): Promise<AppState>
  saveSettings(input: Settings): Promise<AppState>
  cancelClipboardTransfer(): Promise<void>
  openClipboardFiles(): Promise<void>
  chooseMoonlight(): Promise<string | null>
  openMoonlight(): Promise<void>
  connect(id: string): Promise<void>
  returnLocal(): Promise<void>
  probe(id: string): Promise<ProbeResult>
  discoverHosts(): Promise<DiscoveredHost[]>
  pairHost(ticket: string): Promise<AppState>
  inspectDeployment(input: SshConnectionInput): Promise<void>
  confirmSshHost(accepted: boolean): Promise<void>
  startDeployment(): Promise<void>
  cancelDeployment(): Promise<void>
  chooseSshKey(): Promise<string | null>
  openHelp(topic: 'moonlight' | 'sunshine'): Promise<void>
  onState(callback: (state: AppState) => void): () => void
}

export const channels = {
  controlWindow: 'lanto:control-window',
  state: 'lanto:state',
  getState: 'lanto:get-state',
  saveDevice: 'lanto:save-device',
  setDeviceAudio: 'lanto:set-device-audio',
  removeDevice: 'lanto:remove-device',
  saveSettings: 'lanto:save-settings',
  cancelClipboardTransfer: 'lanto:cancel-clipboard-transfer',
  openClipboardFiles: 'lanto:open-clipboard-files',
  chooseMoonlight: 'lanto:choose-moonlight',
  openMoonlight: 'lanto:open-moonlight',
  connect: 'lanto:connect',
  returnLocal: 'lanto:return-local',
  probe: 'lanto:probe',
  discoverHosts: 'lanto:discover-hosts',
  pairHost: 'lanto:pair-host',
  inspectDeployment: 'lanto:inspect-deployment',
  confirmSshHost: 'lanto:confirm-ssh-host',
  startDeployment: 'lanto:start-deployment',
  cancelDeployment: 'lanto:cancel-deployment',
  chooseSshKey: 'lanto:choose-ssh-key',
  openHelp: 'lanto:open-help'
} as const

export function defaultConfig(): Config {
  return {
    schemaVersion: 1,
    devices: [],
    settings: {
      moonlightPath: '',
      returnShortcut: 'Control+Alt+F12',
      resolution: '3840x2160',
      fps: 30,
      bitrateMbps: 60,
      windowMode: 'borderless',
      lowLatency: false,
      showPerformanceOverlay: false,
      windowsPipeline: 'auto',
      localCursor: false,
      shareClipboard: false,
      shareFiles: false
    }
  }
}

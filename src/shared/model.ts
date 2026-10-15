import type { DiscoveredHost, TrustedHostView } from '../protocol/host.ts'
export type Platform = 'linux' | 'macos' | 'windows'

export interface Device {
  id: string
  name: string
  host: string
  platform: Platform
  appName: string
  hostId?: string
}

export type DeviceInput = Omit<Device, 'id'> & { id?: string }

export interface Settings {
  moonlightPath: string
  returnShortcut: string
  resolution: '2560x1440' | '1920x1080'
  fps: number
  bitrateMbps: number
  windowMode: 'borderless' | 'windowed'
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

export interface LantoAPI {
  getState(): Promise<AppState>
  saveDevice(input: DeviceInput): Promise<AppState>
  removeDevice(id: string): Promise<AppState>
  saveSettings(input: Settings): Promise<AppState>
  chooseMoonlight(): Promise<string | null>
  openMoonlight(): Promise<void>
  connect(id: string): Promise<void>
  returnLocal(): Promise<void>
  probe(id: string): Promise<ProbeResult>
  discoverHosts(): Promise<DiscoveredHost[]>
  pairHost(ticket: string): Promise<AppState>
  openHelp(topic: 'moonlight' | 'sunshine'): Promise<void>
  onState(callback: (state: AppState) => void): () => void
}

export const channels = {
  state: 'lanto:state',
  getState: 'lanto:get-state',
  saveDevice: 'lanto:save-device',
  removeDevice: 'lanto:remove-device',
  saveSettings: 'lanto:save-settings',
  chooseMoonlight: 'lanto:choose-moonlight',
  openMoonlight: 'lanto:open-moonlight',
  connect: 'lanto:connect',
  returnLocal: 'lanto:return-local',
  probe: 'lanto:probe',
  discoverHosts: 'lanto:discover-hosts',
  pairHost: 'lanto:pair-host',
  openHelp: 'lanto:open-help'
} as const

export function defaultConfig(): Config {
  return {
    schemaVersion: 1,
    devices: [
      {
        id: 'ce95a76a-e2d8-40fe-bf61-1a01b779216f',
        name: 'Linux1',
        host: '',
        platform: 'linux',
        appName: 'Desktop'
      },
      {
        id: '9e0b728a-b610-4d94-b026-a9f8a85338da',
        name: 'Mac',
        host: '',
        platform: 'macos',
        appName: 'Desktop'
      }
    ],
    settings: {
      moonlightPath: '',
      returnShortcut: 'Control+Alt+F12',
      resolution: '2560x1440',
      fps: 30,
      bitrateMbps: 20,
      windowMode: 'borderless'
    }
  }
}

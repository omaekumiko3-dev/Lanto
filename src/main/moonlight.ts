import { spawn } from 'node:child_process'
import { mkdir, open, stat } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import type { Device, Settings } from '../shared/model.ts'
import type { MediaAdapter, MediaExit, MediaHandle } from './session-manager.ts'
import { hasMediaFeature, nativeEnvironment } from './native-profile.ts'
import { createAudioControl } from './audio-control.ts'

export function streamArguments(device: Device, settings: Settings): string[] {
  const args = [
    'stream',
    device.host,
    device.appName,
    '--resolution',
    settings.resolution,
    '--fps',
    String(settings.fps),
    '--bitrate',
    String(settings.bitrateMbps * 1000),
    '--display-mode',
    settings.windowMode,
    '--absolute-mouse',
    '--no-quit-after',
    '--no-mute-on-focus-loss',
    '--audio-on-host',
    '--no-background-gamepad',
    '--capture-system-keys',
    'never'
  ]
  if (settings.lowLatency) args.push('--no-vsync', '--no-frame-pacing')
  args.push(settings.showPerformanceOverlay ? '--performance-overlay' : '--no-performance-overlay')
  return args
}

async function validExecutable(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false
  if (process.platform === 'win32' && extname(path).toLowerCase() !== '.exe') return false
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isFile())
}

export async function findMoonlight(configured: string): Promise<string | null> {
  if (configured) return (await validExecutable(configured)) ? configured : null
  const candidates =
    process.platform === 'win32'
      ? [
          join(
            process.env.ProgramFiles || 'C:\\Program Files',
            'Moonlight Game Streaming',
            'Moonlight.exe'
          ),
          join(
            process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            'Moonlight Game Streaming',
            'Moonlight.exe'
          )
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Moonlight.app/Contents/MacOS/Moonlight']
        : ['/usr/bin/moonlight', '/usr/local/bin/moonlight']
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    candidates.push(join(directory, process.platform === 'win32' ? 'Moonlight.exe' : 'moonlight'))
  }
  for (const candidate of new Set(candidates)) {
    if (await validExecutable(candidate)) return candidate
  }
  return null
}

async function waitForExit(closed: Promise<MediaExit>, timeout: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export class MoonlightAdapter implements MediaAdapter {
  private readonly logDirectory: string

  constructor(logDirectory: string) {
    this.logDirectory = logDirectory
  }

  async start(device: Device, settings: Settings): Promise<MediaHandle> {
    const executable = await findMoonlight(settings.moonlightPath)
    if (!executable) throw new Error('Moonlight not found. Select the Moonlight executable in Settings')
    let logFile: string | undefined
    if (settings.showPerformanceOverlay) {
      await mkdir(this.logDirectory, { recursive: true, mode: 0o700 })
      logFile = join(this.logDirectory, `moonlight-${Date.now()}.log`)
    }
    const environmentOverrides = await nativeEnvironment(executable, settings, device.platform)
    const audioSupported = await hasMediaFeature(executable, 'audioVolumeProtocol')
    if (!audioSupported && (device.volume !== 100 || device.muted))
      throw new Error('Device volume settings require a newer Lanto player. Select the companion app in Settings')
    const control = audioSupported
      ? await createAudioControl(join(this.logDirectory, '..', 'media-controls'), device)
      : undefined
    try {
      const handle = await launchMedia(executable, streamArguments(device, settings), logFile, {
        ...environmentOverrides,
        LANTO_VOLUME_FILE: '',
        LANTO_VOLUME: '100',
        ...control?.environment
      })
      if (control) {
        handle.setAudio = (audio) => control.setAudio(audio)
        void handle.closed.then(() => control.close())
      }
      return handle
    } catch (error) {
      await control?.close()
      throw error
    }
  }

  async open(settings: Settings): Promise<void> {
    const executable = await findMoonlight(settings.moonlightPath)
    if (!executable) throw new Error('Install Moonlight first, or select its executable in Settings')
    const handle = await launchMedia(executable, [])
    // The setup window is user-owned; only stream processes are managed by SessionManager.
    void handle.closed
  }
}

export async function launchMedia(
  executable: string,
  args: string[],
  logFile?: string,
  environmentOverrides: Record<string, string> = {}
): Promise<MediaHandle> {
  const log = logFile ? await open(logFile, 'wx', 0o600) : undefined
  try {
    const child = spawn(executable, args, {
      shell: false,
      stdio: log ? ['ignore', 'ignore', log.fd] : 'ignore',
      env: { ...process.env, ...environmentOverrides },
      windowsHide: true
    })
    let ended = false
    let resolveClosed: (exit: MediaExit) => void = () => {}
    const closed = new Promise<MediaExit>((resolve) => {
      resolveClosed = resolve
    })
    child.once('exit', (code, signal) => {
      ended = true
      resolveClosed({ code, signal })
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', () => {
        ended = true
        resolveClosed({ code: -1, signal: null })
        reject(new Error('Unable to start Moonlight. Check the selected app and file permissions'))
      })
    })
    return {
      pid: child.pid!,
      closed,
      async stop() {
        if (ended) return
        if (process.platform === 'win32') {
          // PID is generated by the OS. No user text is interpolated into this fixed script.
          const helper = spawn(
            'powershell.exe',
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-WindowStyle',
              'Hidden',
              '-Command',
              `$lantoMediaProcess = Get-Process -Id ${child.pid!} -ErrorAction SilentlyContinue; if ($null -ne $lantoMediaProcess) { [void]$lantoMediaProcess.CloseMainWindow() }`
            ],
            { shell: false, stdio: 'ignore', windowsHide: true }
          )
          helper.on('error', () => {})
          const helperTimeout = setTimeout(() => {
            helper.kill()
          }, 2000)
          helper.once('exit', () => clearTimeout(helperTimeout))
        } else {
          child.kill('SIGTERM')
        }
        if (await waitForExit(closed, 2500)) return
        child.kill('SIGTERM')
        if (await waitForExit(closed, 1500)) return
        child.kill('SIGKILL')
        if (!(await waitForExit(closed, 1500))) throw new Error('Moonlight process did not exit')
      }
    }
  } finally {
    await log?.close()
  }
}
